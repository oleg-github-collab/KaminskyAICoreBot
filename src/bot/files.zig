const std = @import("std");
const tg_client = @import("../telegram/client.zig");
const tg_types = @import("../telegram/types.zig");
const db_users = @import("../db/users.zig");
const db_files = @import("../db/files_db.zig");
const sqlite = @import("../db/sqlite.zig");
const pricing = @import("../processing/pricing.zig");
const storage = @import("../storage/filesystem.zig");
const msgs = @import("messages_ua.zig");

/// Handle a file message during upload state
pub fn handleFileMessage(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    msg: *const tg_types.Message,
    user: *const db_users.UserRecord,
    project_id: i64,
    category: []const u8,
    data_dir: []const u8,
    admin_chat_id: i64,
) !void {
    const fid = tg_types.fileId(msg) orelse return;
    const original_name = tg_types.fileName(msg) orelse "file";
    const mime = tg_types.mimeType(msg);
    const fsize = tg_types.mediaFileSize(msg) orelse 0;

    // Check Telegram Bot API file size limit (20 MB)
    if (fsize > 20 * 1024 * 1024) {
        const resp = try tg.sendMessage(
            msg.chat.id,
            "Файл завеликий (понад 20 МБ). Telegram обмежує розмір файлів для ботів.\n\nБудь ласка, завантажте файл через панель управління (кнопка «Панель»).",
            null,
        );
        allocator.free(resp);
        return;
    }

    // 1. Get file info from Telegram
    const file_resp = try tg.getFile(fid);
    defer allocator.free(file_resp);

    // Parse file_path from response
    var tg_file_path: []const u8 = "";
    if (std.json.parseFromSlice(struct {
        ok: bool = false,
        result: ?struct { file_path: ?[]const u8 = null } = null,
    }, allocator, file_resp, .{ .ignore_unknown_fields = true })) |parsed| {
        defer parsed.deinit();
        if (parsed.value.result) |r| {
            if (r.file_path) |fp| {
                tg_file_path = try allocator.dupe(u8, fp);
            }
        }
    } else |_| {}

    if (tg_file_path.len == 0) {
        const resp = try tg.sendMessage(
            msg.chat.id,
            "Не вдалося отримати файл. Можливо, він перевищує ліміт Telegram (20 МБ).\n\nСпробуйте завантажити через панель управління.",
            null,
        );
        allocator.free(resp);
        return;
    }
    defer allocator.free(tg_file_path);

    // 2. Generate unique filename
    const ts: u64 = @intCast(std.time.timestamp());
    var name_buf: [256]u8 = undefined;
    const stored_name = try std.fmt.bufPrint(&name_buf, "{d}_{s}", .{ ts, original_name });

    // 3. Build storage path
    var path_buf: [512]u8 = undefined;
    const store_path = try storage.filePath(&path_buf, data_dir, project_id, category, stored_name);

    // Ensure directory exists
    storage.createProjectDirs(data_dir, project_id) catch {};

    // 4. Download from Telegram
    tg.downloadFile(tg_file_path, store_path) catch |err| {
        std.log.err("File download failed: {}", .{err});
        const resp = try tg.sendMessage(msg.chat.id, "Помилка завантаження файлу. Спробуйте ще раз.", null);
        allocator.free(resp);
        return;
    };

    // 5. Calculate pricing
    var char_count: i64 = 0;
    var page_count: i64 = 0;
    var price_cents: i64 = 0;

    if (mime != null and std.mem.eql(u8, mime.?, "application/pdf")) {
        // Read file for PDF page count
        const file = std.fs.openFileAbsolute(store_path, .{}) catch null;
        if (file) |f| {
            defer f.close();
            const data = f.readToEndAlloc(allocator, 50 * 1024 * 1024) catch null;
            if (data) |d| {
                defer allocator.free(d);
                page_count = @intCast(pricing.countPdfPages(d));
                price_cents = pricing.priceForPages(@intCast(page_count));
            }
        }
    } else {
        // Read file for character count (text-based files)
        const file = std.fs.openFileAbsolute(store_path, .{}) catch null;
        if (file) |f| {
            defer f.close();
            const data = f.readToEndAlloc(allocator, 10 * 1024 * 1024) catch null;
            if (data) |d| {
                defer allocator.free(d);
                char_count = @intCast(pricing.countChars(d));
                price_cents = pricing.priceForChars(@intCast(char_count));
            }
        }
    }

    // 6. Store in DB
    _ = try db_files.store(db, project_id, user.id, stored_name, original_name, mime, fsize, category, store_path, fid, char_count, page_count, price_cents);

    // 7. Confirm to user
    var size_buf: [32]u8 = undefined;
    const size_str = formatFileSize(&size_buf, @intCast(fsize));

    var detail_buf: [64]u8 = undefined;
    const detail = if (page_count > 0)
        std.fmt.bufPrint(&detail_buf, "Сторінок: {d}", .{page_count}) catch ""
    else if (char_count > 0)
        std.fmt.bufPrint(&detail_buf, "Символів: {d}", .{char_count}) catch ""
    else
        "";

    var resp_buf: [512]u8 = undefined;
    const resp_text = std.fmt.bufPrint(&resp_buf,
        \\Файл отримано: <b>{s}</b>
        \\Розмір: {s}
        \\{s}
        \\
        \\Продовжуйте надсилати файли або натисніть "Завершити завантаження".
    , .{ original_name, size_str, detail }) catch "File received";

    const resp = try tg.sendMessage(msg.chat.id, resp_text, null);
    allocator.free(resp);

    // 8. Notify admin
    var admin_buf: [512]u8 = undefined;
    const admin_text = std.fmt.bufPrint(&admin_buf, "Файл від <b>{s}</b>: {s} ({s})", .{
        user.first_name, original_name, size_str,
    }) catch "New file";
    const admin_resp = try tg.sendMessage(admin_chat_id, admin_text, null);
    allocator.free(admin_resp);
}

fn formatFileSize(buf: []u8, size: u64) []const u8 {
    if (size < 1024) {
        return std.fmt.bufPrint(buf, "{d} B", .{size}) catch "? B";
    } else if (size < 1024 * 1024) {
        return std.fmt.bufPrint(buf, "{d} KB", .{size / 1024}) catch "? KB";
    } else {
        return std.fmt.bufPrint(buf, "{d}.{d} MB", .{ size / (1024 * 1024), (size % (1024 * 1024)) / 102400 }) catch "? MB";
    }
}
