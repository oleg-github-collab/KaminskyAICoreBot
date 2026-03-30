const std = @import("std");
const sqlite = @import("sqlite.zig");

pub const FileRecord = struct {
    id: i64,
    project_id: i64,
    uploader_id: i64,
    file_name: []const u8,
    original_name: []const u8,
    mime_type: ?[]const u8,
    file_size: i64,
    category: []const u8,
    storage_path: []const u8,
    telegram_file_id: ?[]const u8,
    char_count: i64,
    page_count: i64,
    estimated_price_cents: i64,
};

pub fn store(
    db: *sqlite.Db,
    project_id: i64,
    uploader_id: i64,
    file_name: []const u8,
    original_name: []const u8,
    mime_type: ?[]const u8,
    file_size: i64,
    category: []const u8,
    storage_path: []const u8,
    telegram_file_id: ?[]const u8,
    char_count: i64,
    page_count: i64,
    price_cents: i64,
) !i64 {
    var stmt = try db.prepare(
        \\INSERT INTO files (project_id, uploader_id, file_name, original_name, mime_type,
        \\  file_size, category, storage_path, telegram_file_id, char_count, page_count,
        \\  estimated_price_cents, created_at)
        \\VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, uploader_id);
    try stmt.bindText(3, file_name);
    try stmt.bindText(4, original_name);
    try stmt.bindText(5, mime_type);
    try stmt.bindInt(6, file_size);
    try stmt.bindText(7, category);
    try stmt.bindText(8, storage_path);
    try stmt.bindText(9, telegram_file_id);
    try stmt.bindInt(10, char_count);
    try stmt.bindInt(11, page_count);
    try stmt.bindInt(12, price_cents);
    try stmt.bindInt(13, std.time.timestamp());
    try stmt.exec();

    return db.lastInsertRowId();
}

pub fn countByProjectCategory(db: *sqlite.Db, project_id: i64, category: []const u8) !struct { count: i64, total_chars: i64, total_pages: i64, total_price_cents: i64 } {
    var stmt = try db.prepare(
        \\SELECT COUNT(*), COALESCE(SUM(char_count),0), COALESCE(SUM(page_count),0),
        \\  COALESCE(SUM(estimated_price_cents),0)
        \\FROM files WHERE project_id = ? AND category = ?
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindText(2, category);

    if (try stmt.step()) {
        return .{
            .count = stmt.columnInt(0),
            .total_chars = stmt.columnInt(1),
            .total_pages = stmt.columnInt(2),
            .total_price_cents = stmt.columnInt(3),
        };
    }
    return .{ .count = 0, .total_chars = 0, .total_pages = 0, .total_price_cents = 0 };
}

pub fn totalPriceForProject(db: *sqlite.Db, project_id: i64) !i64 {
    var stmt = try db.prepare(
        "SELECT COALESCE(SUM(estimated_price_cents), 0) FROM files WHERE project_id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) {
        return stmt.columnInt(0);
    }
    return 0;
}
