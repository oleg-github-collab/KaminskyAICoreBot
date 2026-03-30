const std = @import("std");
const httpz = @import("httpz");
const handler = @import("../webhook/handler.zig");
const sqlite = @import("../db/sqlite.zig");
const db_users = @import("../db/users.zig");
const db_projects = @import("../db/projects_db.zig");
const db_files = @import("../db/files_db.zig");
const storage = @import("../storage/filesystem.zig");
const pricing = @import("../processing/pricing.zig");
const processor_client = @import("../processing/processor_client.zig");
const deepl_client = @import("../deepl/client.zig");
const glossary_versions_db = @import("../db/glossary_versions_db.zig");

const MembershipRole = enum {
    owner,
    member,
};

const AuthError = error{
    Unauthorized,
    InvalidAuth,
    ExpiredAuth,
    MissingUser,
};

const ProjectAccess = struct {
    project_id: i64,
    project: db_projects.ProjectRecord,
    role: MembershipRole,
};

const MiniAppUser = struct {
    id: i64,
    first_name: []const u8 = "",
    last_name: ?[]const u8 = null,
    username: ?[]const u8 = null,
};

const ParsedInitData = struct {
    hash: ?[]const u8,
    user_json: ?[]const u8,
    auth_date: ?i64,
    data_check_string: []const u8,
};

pub const StripeSession = struct {
    id: []const u8,
    url: []const u8,
};

fn app() *handler.App {
    return &handler.app_global;
}

fn jsonError(res: *httpz.Response, status: u16, message: []const u8) void {
    res.status = status;
    res.json(.{ .@"error" = message }, .{}) catch {
        res.body = "{\"error\":\"internal\"}";
    };
}

fn dupOrEmpty(allocator: std.mem.Allocator, value: ?[]const u8) ![]const u8 {
    return allocator.dupe(u8, value orelse "");
}

fn dupSlice(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn authenticate(req: *httpz.Request, res: *httpz.Response) ?db_users.UserRecord {
    return authenticateImpl(req) catch |err| {
        switch (err) {
            AuthError.Unauthorized => jsonError(res, 401, "Потрібна авторизація Telegram Mini App."),
            AuthError.InvalidAuth => jsonError(res, 401, "Невірний підпис Telegram Mini App."),
            AuthError.ExpiredAuth => jsonError(res, 401, "Telegram-сесія застаріла. Відкрийте Mini App ще раз."),
            AuthError.MissingUser => jsonError(res, 401, "Не вдалося визначити користувача Telegram."),
            else => {
                std.log.err("Mini App auth failed: {}", .{err});
                jsonError(res, 500, "Помилка авторизації.");
            },
        }
        return null;
    };
}

fn authenticateImpl(req: *httpz.Request) !db_users.UserRecord {
    const a = app();
    const auth_header = req.header("authorization");

    if (auth_header == null) {
        if (!a.config.is_production) {
            return devUser();
        }
        return AuthError.Unauthorized;
    }

    const header_value = auth_header.?;

    // Browser session token: "Bearer <hex_token>"
    if (std.mem.startsWith(u8, header_value, "Bearer ")) {
        const token = header_value[7..];
        if (token.len > 0) {
            return authenticateBearer(a, token) catch {
                return AuthError.InvalidAuth;
            };
        }
    }

    if (!std.mem.startsWith(u8, header_value, "tma ")) {
        if (!a.config.is_production) {
            return devUser();
        }
        return AuthError.Unauthorized;
    }

    const raw_init_data = std.mem.trim(u8, header_value[4..], &std.ascii.whitespace);
    if (raw_init_data.len == 0) {
        if (!a.config.is_production) {
            return devUser();
        }
        return AuthError.Unauthorized;
    }

    const parsed = try parseInitData(req.arena, raw_init_data);
    const received_hash = parsed.hash orelse return AuthError.InvalidAuth;
    try validateInitData(parsed.data_check_string, received_hash, a.config.bot_token);

    if (parsed.auth_date) |auth_date| {
        const now = std.time.timestamp();
        if (auth_date > now + 300 or now - auth_date > 86400) {
            return AuthError.ExpiredAuth;
        }
    }

    const user_json = parsed.user_json orelse return AuthError.MissingUser;
    const tg_user = try std.json.parseFromSliceLeaky(MiniAppUser, req.arena, user_json, .{
        .ignore_unknown_fields = true,
    });

    var user = try db_users.findOrCreate(
        req.arena,
        &a.db,
        tg_user.id,
        if (tg_user.first_name.len == 0) "Telegram User" else tg_user.first_name,
        tg_user.last_name,
        tg_user.username,
    );

    if (user.telegram_id == a.config.admin_chat_id) {
        db_users.setAdmin(&a.db, user.telegram_id) catch {};
        user.is_admin = true;
    }

    return user;
}

fn authenticateBearer(a: *handler.App, token: []const u8) !db_users.UserRecord {
    // Hash the token to compare with stored hash
    var hash_out: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(token, &hash_out, .{});
    var hash_hex_buf: [64]u8 = undefined;
    const hash_hex = try std.fmt.bufPrint(&hash_hex_buf, "{}", .{std.fmt.fmtSliceHexLower(&hash_out)});

    var stmt = try a.db.prepare(
        "SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.username, u.is_admin FROM web_sessions ws JOIN users u ON u.id = ws.user_id WHERE ws.token_hash = ? AND ws.expires_at > ?",
    );
    defer stmt.deinit();
    try stmt.bindText(1, hash_hex);
    try stmt.bindInt(2, std.time.timestamp());

    if (try stmt.step()) {
        return db_users.UserRecord{
            .id = stmt.columnInt(0),
            .telegram_id = stmt.columnInt(1),
            .first_name = try a.allocator.dupe(u8, stmt.columnText(2) orelse ""),
            .last_name = if (stmt.columnText(3)) |ln| try a.allocator.dupe(u8, ln) else null,
            .username = if (stmt.columnText(4)) |un| try a.allocator.dupe(u8, un) else null,
            .is_admin = stmt.columnInt(5) == 1,
        };
    }
    return AuthError.InvalidAuth;
}

fn devUser() !db_users.UserRecord {
    const a = app();
    var user = try db_users.findOrCreate(a.allocator, &a.db, a.config.admin_chat_id, "Dev", null, "admin");
    db_users.setAdmin(&a.db, user.telegram_id) catch {};
    user.is_admin = true;
    return user;
}

fn parseInitData(allocator: std.mem.Allocator, raw: []const u8) !ParsedInitData {
    const Pair = struct {
        key: []const u8,
        value: []const u8,
    };

    var pairs = std.ArrayList(Pair).init(allocator);
    var hash: ?[]const u8 = null;
    var user_json: ?[]const u8 = null;
    var auth_date: ?i64 = null;

    var iter = std.mem.splitScalar(u8, raw, '&');
    while (iter.next()) |chunk| {
        if (chunk.len == 0) continue;

        const sep = std.mem.indexOfScalar(u8, chunk, '=') orelse chunk.len;
        const key = try decodeFormComponent(allocator, chunk[0..sep]);
        const value = if (sep < chunk.len)
            try decodeFormComponent(allocator, chunk[sep + 1 ..])
        else
            try allocator.dupe(u8, "");

        if (std.mem.eql(u8, key, "hash")) {
            hash = value;
            continue;
        }

        if (std.mem.eql(u8, key, "user")) {
            user_json = value;
        } else if (std.mem.eql(u8, key, "auth_date")) {
            auth_date = std.fmt.parseInt(i64, value, 10) catch null;
        }

        try pairs.append(.{ .key = key, .value = value });
    }

    // Small insertion sort is enough for Telegram initData.
    var items = pairs.items;
    var i: usize = 1;
    while (i < items.len) : (i += 1) {
        const current = items[i];
        var j = i;
        while (j > 0 and std.mem.order(u8, current.key, items[j - 1].key) == .lt) : (j -= 1) {
            items[j] = items[j - 1];
        }
        items[j] = current;
    }

    var dcs = std.ArrayList(u8).init(allocator);
    var writer = dcs.writer();
    for (items, 0..) |pair, idx| {
        if (idx > 0) try writer.writeByte('\n');
        try writer.writeAll(pair.key);
        try writer.writeByte('=');
        try writer.writeAll(pair.value);
    }

    return .{
        .hash = hash,
        .user_json = user_json,
        .auth_date = auth_date,
        .data_check_string = try dcs.toOwnedSlice(),
    };
}

fn decodeFormComponent(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var out = std.ArrayList(u8).init(allocator);
    var i: usize = 0;
    while (i < input.len) : (i += 1) {
        switch (input[i]) {
            '+' => try out.append(' '),
            '%' => {
                if (i + 2 >= input.len) return error.InvalidEncoding;
                const hi = try hexNibble(input[i + 1]);
                const lo = try hexNibble(input[i + 2]);
                try out.append((hi << 4) | lo);
                i += 2;
            },
            else => try out.append(input[i]),
        }
    }
    return out.toOwnedSlice();
}

fn encodeFormComponent(writer: anytype, input: []const u8) !void {
    for (input) |ch| {
        const is_unreserved =
            (ch >= 'a' and ch <= 'z') or
            (ch >= 'A' and ch <= 'Z') or
            (ch >= '0' and ch <= '9') or
            ch == '-' or ch == '_' or ch == '.' or ch == '~';

        if (is_unreserved) {
            try writer.writeByte(ch);
        } else if (ch == ' ') {
            try writer.writeByte('+');
        } else {
            var buf: [3]u8 = undefined;
            _ = try std.fmt.bufPrint(&buf, "%{X:0>2}", .{ch});
            try writer.writeAll(&buf);
        }
    }
}

fn hexNibble(ch: u8) !u8 {
    return switch (ch) {
        '0'...'9' => ch - '0',
        'a'...'f' => ch - 'a' + 10,
        'A'...'F' => ch - 'A' + 10,
        else => error.InvalidHex,
    };
}

fn validateInitData(data_check_string: []const u8, received_hash: []const u8, bot_token: []const u8) !void {
    const HmacSha256 = std.crypto.auth.hmac.sha2.HmacSha256;

    var secret_key: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&secret_key, bot_token, "WebAppData");

    var actual_hash: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&actual_hash, data_check_string, secret_key[0..]);

    var buf: [HmacSha256.mac_length * 2]u8 = undefined;
    const actual_hex = try std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(&actual_hash)});
    if (!std.mem.eql(u8, actual_hex, received_hash)) {
        return AuthError.InvalidAuth;
    }
}

fn parseProjectAccess(req: *httpz.Request, res: *httpz.Response, user: db_users.UserRecord) ?ProjectAccess {
    return parseProjectAccessImpl(req, user) catch |err| {
        switch (err) {
            error.InvalidProjectId => jsonError(res, 400, "Некоректний ідентифікатор проєкту."),
            error.ProjectNotFound => jsonError(res, 404, "Проєкт не знайдено."),
            error.ProjectForbidden => jsonError(res, 403, "Немає доступу до цього проєкту."),
            else => {
                std.log.err("Project access check failed: {}", .{err});
                jsonError(res, 500, "Не вдалося перевірити доступ до проєкту.");
            },
        }
        return null;
    };
}

fn parseProjectAccessImpl(req: *httpz.Request, user: db_users.UserRecord) !ProjectAccess {
    const project_id = parseIntParam(req, "project_id") catch return error.InvalidProjectId;
    const a = app();
    const project = try db_projects.getById(req.arena, &a.db, project_id) orelse return error.ProjectNotFound;

    if (user.is_admin) {
        return .{
            .project_id = project_id,
            .project = project,
            .role = .owner,
        };
    }

    const role = try membershipRole(&a.db, project_id, user.id) orelse return error.ProjectForbidden;
    return .{
        .project_id = project_id,
        .project = project,
        .role = role,
    };
}

fn parseIntParam(req: *httpz.Request, name: []const u8) !i64 {
    const raw = req.param(name) orelse return error.MissingParam;
    return std.fmt.parseInt(i64, raw, 10);
}

fn membershipRole(db: *sqlite.Db, project_id: i64, user_id: i64) !?MembershipRole {
    var stmt = try db.prepare(
        "SELECT role FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, user_id);

    if (try stmt.step()) {
        const role = stmt.columnText(0) orelse "member";
        return if (std.mem.eql(u8, role, "owner")) .owner else .member;
    }
    return null;
}

fn inviteLink(allocator: std.mem.Allocator, bot_username: []const u8, invite_code: []const u8) ![]const u8 {
    return std.fmt.allocPrint(allocator, "https://t.me/{s}?start=invite_{s}", .{
        bot_username,
        invite_code,
    });
}

fn normalizeCategory(raw: ?[]const u8, file_name: []const u8) []const u8 {
    if (raw) |category| {
        if (std.mem.eql(u8, category, "source") or
            std.mem.eql(u8, category, "reference") or
            std.mem.eql(u8, category, "glossary") or
            std.mem.eql(u8, category, "translated") or
            std.mem.eql(u8, category, "document") or
            std.mem.eql(u8, category, "media") or
            std.mem.eql(u8, category, "instructions"))
        {
            return category;
        }
    }
    return pricing.categorizeFile(null, file_name);
}

fn isPdf(file_name: []const u8) bool {
    if (file_name.len < 4) return false;
    const suffix = file_name[file_name.len - 4 ..];
    return std.ascii.eqlIgnoreCase(suffix, ".pdf");
}

fn sanitizeFilename(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var out = std.ArrayList(u8).init(allocator);
    const max_len: usize = 160;

    for (input) |ch| {
        if (out.items.len >= max_len) break;
        switch (ch) {
            '/', '\\', ':', '*', '?', '"', '<', '>', '|' => try out.append('_'),
            0...31 => try out.append('_'),
            else => try out.append(ch),
        }
    }

    if (out.items.len == 0) {
        try out.appendSlice("upload.bin");
    }
    return out.toOwnedSlice();
}

fn collectGlossaryTSV(allocator: std.mem.Allocator, db: *sqlite.Db, project_id: i64, approved_only: bool) ![]const u8 {
    var stmt = if (approved_only)
        try db.prepare("SELECT source_term, target_term FROM glossary_terms WHERE project_id = ? AND is_approved = 1 ORDER BY source_term ASC")
    else
        try db.prepare("SELECT source_term, target_term FROM glossary_terms WHERE project_id = ? ORDER BY source_term ASC");
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    var tsv = std.ArrayList(u8).init(allocator);
    var row_idx: usize = 0;
    while (try stmt.step()) {
        if (row_idx > 0) try tsv.append('\n');
        try tsv.appendSlice(stmt.columnText(0) orelse "");
        try tsv.append('\t');
        try tsv.appendSlice(stmt.columnText(1) orelse "");
        row_idx += 1;
    }

    return tsv.toOwnedSlice();
}

fn approvedGlossaryCount(db: *sqlite.Db, project_id: i64) !i64 {
    var stmt = try db.prepare(
        "SELECT COUNT(*) FROM glossary_terms WHERE project_id = ? AND is_approved = 1",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) {
        return stmt.columnInt(0);
    }
    return 0;
}

/// Public wrapper for bot commands to create Stripe sessions
pub fn createStripeSession(
    allocator: std.mem.Allocator,
    secret_key: []const u8,
    amount_cents: i64,
    project_name: []const u8,
    mini_app_url: []const u8,
    project_id: i64,
    user_telegram_id: i64,
) !StripeSession {
    return createStripeCheckoutSession(allocator, secret_key, amount_cents, project_name, mini_app_url, project_id, user_telegram_id);
}

fn createStripeCheckoutSession(
    allocator: std.mem.Allocator,
    secret_key: []const u8,
    amount_cents: i64,
    project_name: []const u8,
    mini_app_url: []const u8,
    project_id: i64,
    user_telegram_id: i64,
) !StripeSession {
    // Build form-urlencoded body
    var body = std.ArrayList(u8).init(allocator);
    defer body.deinit();

    var success_buf: [512]u8 = undefined;
    const success_url = std.fmt.bufPrint(&success_buf, "{s}?payment=success", .{mini_app_url}) catch "https://example.com/success";
    var cancel_buf: [512]u8 = undefined;
    const cancel_url = std.fmt.bufPrint(&cancel_buf, "{s}?payment=cancel", .{mini_app_url}) catch "https://example.com/cancel";
    var pid_buf: [20]u8 = undefined;
    const project_id_str = std.fmt.bufPrint(&pid_buf, "{d}", .{project_id}) catch "0";
    var uid_buf: [20]u8 = undefined;
    const user_id_str = std.fmt.bufPrint(&uid_buf, "{d}", .{user_telegram_id}) catch "0";
    var amt_buf: [20]u8 = undefined;
    const amount_str = std.fmt.bufPrint(&amt_buf, "{d}", .{amount_cents}) catch "0";
    var name_buf: [256]u8 = undefined;
    const item_name = std.fmt.bufPrint(&name_buf, "KI Beratung \u{2014} {s}", .{project_name}) catch "KI Beratung";

    try appendFormField(&body, "mode", "payment");
    try appendFormField(&body, "line_items[0][price_data][currency]", "eur");
    try appendFormField(&body, "line_items[0][price_data][unit_amount]", amount_str);
    try appendFormField(&body, "line_items[0][price_data][product_data][name]", item_name);
    try appendFormField(&body, "line_items[0][quantity]", "1");
    try appendFormField(&body, "success_url", success_url);
    try appendFormField(&body, "cancel_url", cancel_url);
    try appendFormField(&body, "metadata[project_id]", project_id_str);
    try appendFormField(&body, "metadata[user_telegram_id]", user_id_str);
    try appendFormField(&body, "client_reference_id", project_id_str);

    const form_data = try allocator.dupe(u8, body.items);
    defer allocator.free(form_data);

    var auth_header_buf: [512]u8 = undefined;
    const auth_header = std.fmt.bufPrint(&auth_header_buf, "Authorization: Bearer {s}", .{secret_key}) catch return error.StripeSessionFailed;

    std.log.info("Stripe: creating checkout via curl, amount={d} cents, project={s}", .{ amount_cents, project_name });

    // Use curl for bulletproof HTTPS — Zig's TLS can fail in Docker
    const result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl", "-s", "--max-time", "30",
            "-X", "POST",
            "-H", auth_header,
            "-H", "Content-Type: application/x-www-form-urlencoded",
            "-d", form_data,
            "https://api.stripe.com/v1/checkout/sessions",
        },
        .max_output_bytes = 1024 * 1024,
    }) catch |err| {
        std.log.err("Stripe: curl spawn failed: {}", .{err});
        return error.StripeSessionFailed;
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    if (result.stdout.len == 0) {
        std.log.err("Stripe: curl returned empty response, stderr: {s}", .{result.stderr[0..@min(result.stderr.len, 500)]});
        return error.StripeSessionFailed;
    }

    std.log.info("Stripe curl response ({d} bytes): {s}", .{ result.stdout.len, result.stdout[0..@min(result.stdout.len, 500)] });

    // Parse response — stdout contains JSON from Stripe
    const parsed = std.json.parseFromSliceLeaky(struct {
        id: ?[]const u8 = null,
        url: ?[]const u8 = null,
        @"error": ?struct {
            message: ?[]const u8 = null,
            type: ?[]const u8 = null,
        } = null,
    }, allocator, result.stdout, .{
        .ignore_unknown_fields = true,
    }) catch |err| {
        std.log.err("Stripe JSON parse error: {}, raw: {s}", .{ err, result.stdout[0..@min(result.stdout.len, 200)] });
        return error.StripeSessionFailed;
    };

    if (parsed.@"error") |stripe_error| {
        std.log.err("Stripe API error: {s} (type: {s})", .{
            stripe_error.message orelse "unknown",
            stripe_error.type orelse "unknown",
        });
        return error.StripeSessionFailed;
    }

    const session_id = parsed.id orelse {
        std.log.err("Stripe: no id in response", .{});
        return error.StripeSessionFailed;
    };
    const session_url = parsed.url orelse {
        std.log.err("Stripe: no url in response", .{});
        return error.StripeSessionFailed;
    };

    // Dupe into allocator so they survive after stdout is freed
    return .{
        .id = try allocator.dupe(u8, session_id),
        .url = try allocator.dupe(u8, session_url),
    };
}

fn appendFormField(body: *std.ArrayList(u8), key: []const u8, value: []const u8) !void {
    var writer = body.writer();
    if (body.items.len > 0) try writer.writeByte('&');
    try writer.writeAll(key);
    try writer.writeByte('=');
    try encodeFormComponent(writer, value);
}

pub fn handleProjects(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT p.id, p.owner_id, p.name, p.description, p.source_lang, p.target_lang,
        \\       p.invite_code, p.is_active, pm.role
        \\FROM projects p
        \\JOIN project_members pm ON pm.project_id = p.id
        \\WHERE pm.user_id = ? AND p.is_active = 1
        \\ORDER BY p.updated_at DESC, p.created_at DESC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, user.id);

    const Item = struct {
        id: i64,
        owner_id: i64,
        name: []const u8,
        description: []const u8,
        source_lang: []const u8,
        target_lang: []const u8,
        invite_code: []const u8,
        invite_link: []const u8,
        is_active: bool,
        role: []const u8,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        const invite_code = stmt.columnText(6) orelse "";
        try items.append(.{
            .id = stmt.columnInt(0),
            .owner_id = stmt.columnInt(1),
            .name = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .description = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .source_lang = try dupOrEmpty(res.arena, stmt.columnText(4)),
            .target_lang = try dupOrEmpty(res.arena, stmt.columnText(5)),
            .invite_code = try dupSlice(res.arena, invite_code),
            .invite_link = try inviteLink(res.arena, a.config.bot_username, invite_code),
            .is_active = stmt.columnInt(7) == 1,
            .role = try dupOrEmpty(res.arena, stmt.columnText(8)),
        });
    }

    try res.json(.{ .projects = try items.toOwnedSlice() }, .{});
}

pub fn handleCreateProject(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const a = app();

    const Body = struct {
        name: []const u8,
        description: ?[]const u8 = null,
    };

    const payload = (try req.json(Body)) orelse {
        jsonError(res, 400, "Тіло запиту порожнє.");
        return;
    };

    const name = std.mem.trim(u8, payload.name, &std.ascii.whitespace);
    if (name.len == 0 or name.len > 100) {
        jsonError(res, 400, "Назва проєкту має містити від 1 до 100 символів.");
        return;
    }

    const description = std.mem.trim(u8, payload.description orelse "", &std.ascii.whitespace);
    const project = try db_projects.create(res.arena, &a.db, user.id, name, description);
    storage.createProjectDirs(a.config.data_dir, project.id) catch |err| {
        std.log.err("Failed to create project directories: {}", .{err});
        jsonError(res, 500, "Не вдалося створити папки проєкту.");
        return;
    };

    res.status = 201;
    try res.json(.{
        .project = .{
            .id = project.id,
            .owner_id = project.owner_id,
            .name = project.name,
            .description = project.description,
            .source_lang = project.source_lang,
            .target_lang = project.target_lang,
            .invite_code = project.invite_code,
            .invite_link = try inviteLink(res.arena, a.config.bot_username, project.invite_code),
            .is_active = project.is_active,
        },
    }, .{});
}

pub fn handleGetProject(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    try res.json(.{
        .project = .{
            .id = access.project.id,
            .owner_id = access.project.owner_id,
            .name = access.project.name,
            .description = access.project.description,
            .source_lang = access.project.source_lang,
            .target_lang = access.project.target_lang,
            .invite_code = access.project.invite_code,
            .invite_link = try inviteLink(res.arena, a.config.bot_username, access.project.invite_code),
            .is_active = access.project.is_active,
        },
    }, .{});
}

pub fn handleListFiles(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const query = try req.query();
    const category = query.get("category");
    const a = app();

    var stmt = if (category != null and category.?.len > 0)
        try a.db.prepare(
            \\SELECT id, original_name, file_size, category, file_name, mime_type,
            \\       estimated_price_cents, char_count, page_count, created_at
            \\FROM files
            \\WHERE project_id = ? AND category = ?
            \\ORDER BY created_at DESC
        )
    else
        try a.db.prepare(
            \\SELECT id, original_name, file_size, category, file_name, mime_type,
            \\       estimated_price_cents, char_count, page_count, created_at
            \\FROM files
            \\WHERE project_id = ?
            \\ORDER BY created_at DESC
        );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);
    if (category != null and category.?.len > 0) {
        try stmt.bindText(2, category.?);
    }

    const Item = struct {
        id: i64,
        original_name: []const u8,
        file_size: i64,
        category: []const u8,
        file_name: []const u8,
        mime_type: []const u8,
        estimated_price_cents: i64,
        char_count: i64,
        page_count: i64,
        created_at: i64,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        try items.append(.{
            .id = stmt.columnInt(0),
            .original_name = try dupOrEmpty(res.arena, stmt.columnText(1)),
            .file_size = stmt.columnInt(2),
            .category = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .file_name = try dupOrEmpty(res.arena, stmt.columnText(4)),
            .mime_type = try dupOrEmpty(res.arena, stmt.columnText(5)),
            .estimated_price_cents = stmt.columnInt(6),
            .char_count = stmt.columnInt(7),
            .page_count = stmt.columnInt(8),
            .created_at = stmt.columnInt(9),
        });
    }

    try res.json(.{ .files = try items.toOwnedSlice() }, .{});
}

pub fn handleUploadFile(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const form = req.multiFormData() catch |err| {
        std.log.err("Multipart parse error: {}", .{err});
        jsonError(res, 400, "Не вдалося прочитати multipart-запит.");
        return;
    };

    const file_field = form.get("file") orelse {
        jsonError(res, 400, "Поле file є обов'язковим.");
        return;
    };

    const original_name = file_field.filename orelse "upload.bin";
    const category = normalizeCategory(if (form.get("category")) |f| f.value else null, original_name);
    const safe_name = try sanitizeFilename(res.arena, original_name);

    var random_bytes: [4]u8 = undefined;
    std.crypto.random.bytes(&random_bytes);
    var random_buf: [8]u8 = undefined;
    const random_hex = try std.fmt.bufPrint(&random_buf, "{}", .{std.fmt.fmtSliceHexLower(&random_bytes)});
    const stored_name = try std.fmt.allocPrint(res.arena, "{d}_{s}_{s}", .{
        std.time.timestamp(),
        random_hex,
        safe_name,
    });

    storage.createProjectDirs(a.config.data_dir, access.project_id) catch |err| {
        std.log.err("Project directory creation failed: {}", .{err});
        jsonError(res, 500, "Не вдалося підготувати папку для файлу.");
        return;
    };

    var path_buf: [1024]u8 = undefined;
    const store_path = try storage.filePath(&path_buf, a.config.data_dir, access.project_id, category, stored_name);
    try storage.atomicWrite(store_path, file_field.value);

    const file_size: i64 = @intCast(file_field.value.len);
    var char_count: i64 = 0;
    var page_count: i64 = 0;
    var price_cents: i64 = 0;

    // Instructions are never billed
    if (!std.mem.eql(u8, category, "instructions")) {
        // Try Python processor first (accurate counting with proper libraries)
        if (processor_client.countDocument(res.arena, &a.config, store_path, original_name)) |result| {
            char_count = result.chars;
            page_count = result.pages;
            price_cents = result.pricing_cents;
        } else |_| {
            // Fallback to local pricing
            const is_pdf = isPdf(original_name) or pricing.isPdfContent(file_field.value);
            if (is_pdf) {
                page_count = @intCast(pricing.countPdfPages(file_field.value));
                price_cents = pricing.priceForPages(@intCast(page_count));
            } else if (pricing.isTextContent(file_field.value)) {
                char_count = @intCast(pricing.countChars(file_field.value));
                price_cents = pricing.priceForChars(@intCast(char_count));
            } else {
                page_count = @intCast(pricing.estimateDocPages(file_field.value.len));
                price_cents = pricing.priceForPages(@intCast(page_count));
            }
        }
    }

    const file_id = try db_files.store(
        &a.db,
        access.project_id,
        user.id,
        stored_name,
        original_name,
        null,
        file_size,
        category,
        store_path,
        null,
        char_count,
        page_count,
        price_cents,
    );

    res.status = 201;
    try res.json(.{
        .file = .{
            .id = file_id,
            .original_name = original_name,
            .file_name = stored_name,
            .file_size = file_size,
            .category = category,
            .estimated_price_cents = price_cents,
            .char_count = char_count,
            .page_count = page_count,
        },
    }, .{});
}

pub fn handleDeleteFile(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const file_id = parseIntParam(req, "file_id") catch {
        jsonError(res, 400, "Некоректний ідентифікатор файлу.");
        return;
    };
    const a = app();

    var find = try a.db.prepare(
        "SELECT storage_path FROM files WHERE id = ? AND project_id = ? LIMIT 1",
    );
    defer find.deinit();
    try find.bindInt(1, file_id);
    try find.bindInt(2, access.project_id);

    if (!(try find.step())) {
        jsonError(res, 404, "Файл не знайдено.");
        return;
    }

    const file_path = try dupOrEmpty(res.arena, find.columnText(0));
    storage.deleteFile(file_path) catch |err| {
        std.log.warn("Failed to delete file from storage: {}", .{err});
    };

    var delete_stmt = try a.db.prepare(
        "DELETE FROM files WHERE id = ? AND project_id = ?",
    );
    defer delete_stmt.deinit();
    try delete_stmt.bindInt(1, file_id);
    try delete_stmt.bindInt(2, access.project_id);
    try delete_stmt.exec();

    try res.json(.{ .ok = true }, .{});
}

pub fn handleListTeam(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT pm.id, u.telegram_id, u.username, u.first_name, u.last_name, pm.role, pm.joined_at
        \\FROM project_members pm
        \\JOIN users u ON u.id = pm.user_id
        \\WHERE pm.project_id = ?
        \\ORDER BY CASE pm.role WHEN 'owner' THEN 0 ELSE 1 END, pm.joined_at ASC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    const Item = struct {
        id: i64,
        telegram_id: i64,
        username: []const u8,
        first_name: []const u8,
        last_name: []const u8,
        role: []const u8,
        joined_at: i64,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        try items.append(.{
            .id = stmt.columnInt(0),
            .telegram_id = stmt.columnInt(1),
            .username = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .first_name = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .last_name = try dupOrEmpty(res.arena, stmt.columnText(4)),
            .role = try dupOrEmpty(res.arena, stmt.columnText(5)),
            .joined_at = stmt.columnInt(6),
        });
    }

    try res.json(.{ .members = try items.toOwnedSlice() }, .{});
}

pub fn handleCreateInvite(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    try res.json(.{
        .invite_code = access.project.invite_code,
        .invite_link = try inviteLink(res.arena, a.config.bot_username, access.project.invite_code),
    }, .{});
}

pub fn handleRemoveMember(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const member_id = parseIntParam(req, "member_id") catch {
        jsonError(res, 400, "Некоректний ідентифікатор учасника.");
        return;
    };

    if (!user.is_admin and access.role != .owner) {
        jsonError(res, 403, "Лише власник проєкту може видаляти учасників.");
        return;
    }

    const a = app();
    var check = try a.db.prepare(
        "SELECT role FROM project_members WHERE id = ? AND project_id = ? LIMIT 1",
    );
    defer check.deinit();
    try check.bindInt(1, member_id);
    try check.bindInt(2, access.project_id);

    if (!(try check.step())) {
        jsonError(res, 404, "Учасника не знайдено.");
        return;
    }

    const role = check.columnText(0) orelse "member";
    if (std.mem.eql(u8, role, "owner")) {
        jsonError(res, 400, "Власника проєкту не можна видалити.");
        return;
    }

    var delete_stmt = try a.db.prepare(
        "DELETE FROM project_members WHERE id = ? AND project_id = ?",
    );
    defer delete_stmt.deinit();
    try delete_stmt.bindInt(1, member_id);
    try delete_stmt.bindInt(2, access.project_id);
    try delete_stmt.exec();

    try res.json(.{ .ok = true }, .{});
}

pub fn handleListGlossary(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT id, source_term, target_term, domain, confidence, is_approved, created_at
        \\FROM glossary_terms
        \\WHERE project_id = ?
        \\ORDER BY is_approved DESC, confidence DESC, source_term ASC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    const Item = struct {
        id: i64,
        source_term: []const u8,
        target_term: []const u8,
        domain: []const u8,
        confidence: f64,
        is_approved: bool,
        created_at: i64,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        try items.append(.{
            .id = stmt.columnInt(0),
            .source_term = try dupOrEmpty(res.arena, stmt.columnText(1)),
            .target_term = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .domain = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .confidence = stmt.columnReal(4),
            .is_approved = stmt.columnInt(5) == 1,
            .created_at = stmt.columnInt(6),
        });
    }

    try res.json(.{
        .terms = try items.toOwnedSlice(),
        .approved_count = try approvedGlossaryCount(&a.db, access.project_id),
    }, .{});
}

pub fn handleApproveGlossary(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const Body = struct {
        term_ids: []const i64,
    };

    const payload = (try req.json(Body)) orelse {
        jsonError(res, 400, "Потрібен список term_ids.");
        return;
    };

    if (payload.term_ids.len == 0) {
        jsonError(res, 400, "Список term_ids порожній.");
        return;
    }

    var stmt = try a.db.prepare(
        "UPDATE glossary_terms SET is_approved = 1, approved_by = ? WHERE project_id = ? AND id = ?",
    );
    defer stmt.deinit();

    for (payload.term_ids) |term_id| {
        stmt.reset();
        try stmt.bindInt(1, user.id);
        try stmt.bindInt(2, access.project_id);
        try stmt.bindInt(3, term_id);
        try stmt.exec();
    }

    try res.json(.{ .ok = true, .updated = payload.term_ids.len }, .{});
}

pub fn handleRejectGlossary(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const Body = struct {
        term_ids: []const i64,
    };

    const payload = (try req.json(Body)) orelse {
        jsonError(res, 400, "Потрібен список term_ids.");
        return;
    };

    if (payload.term_ids.len == 0) {
        jsonError(res, 400, "Список term_ids порожній.");
        return;
    }

    var stmt = try a.db.prepare(
        "DELETE FROM glossary_terms WHERE project_id = ? AND id = ?",
    );
    defer stmt.deinit();

    for (payload.term_ids) |term_id| {
        stmt.reset();
        try stmt.bindInt(1, access.project_id);
        try stmt.bindInt(2, term_id);
        try stmt.exec();
    }

    try res.json(.{ .ok = true, .deleted = payload.term_ids.len }, .{});
}

pub fn handleExportGlossary(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const query = try req.query();
    const format = query.get("format") orelse "tsv";

    if (!std.mem.eql(u8, format, "tsv")) {
        jsonError(res, 400, "Поки що підтримується лише формат TSV.");
        return;
    }

    const a = app();
    var content = try collectGlossaryTSV(res.arena, &a.db, access.project_id, true);
    if (content.len == 0) {
        content = try collectGlossaryTSV(res.arena, &a.db, access.project_id, false);
    }

    try res.json(.{
        .format = "tsv",
        .filename = "glossary.tsv",
        .content = content,
    }, .{});
}

pub fn handleSyncDeepL(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;

    const a = app();
    if (a.config.deepl_api_key.len == 0) {
        jsonError(res, 400, "DEEPL_API_KEY не налаштовано.");
        return;
    }

    const terms_tsv = try collectGlossaryTSV(res.arena, &a.db, access.project_id, true);
    if (terms_tsv.len == 0) {
        jsonError(res, 400, "Немає затверджених термінів для синхронізації.");
        return;
    }

    var existing = try a.db.prepare(
        "SELECT id, deepl_glossary_id, name FROM deepl_glossaries WHERE project_id = ? LIMIT 1",
    );
    defer existing.deinit();
    try existing.bindInt(1, access.project_id);

    var existing_row_id: ?i64 = null;
    var existing_glossary_id: ?[]const u8 = null;
    var existing_name: ?[]const u8 = null;
    if (try existing.step()) {
        existing_row_id = existing.columnInt(0);
        existing_glossary_id = try dupOrEmpty(res.arena, existing.columnText(1));
        existing_name = try dupOrEmpty(res.arena, existing.columnText(2));
    }

    var deepl = deepl_client.DeepLClient.init(res.arena, a.config.deepl_api_key);
    if (existing_glossary_id) |glossary_id| {
        const delete_resp = deepl.deleteGlossary(glossary_id) catch |err| blk: {
            std.log.warn("DeepL glossary delete failed before re-sync: {}", .{err});
            break :blk &[_]u8{};
        };
        _ = delete_resp;
    }

    const glossary_name = existing_name orelse try std.fmt.allocPrint(res.arena, "{s} #{d}", .{
        access.project.name,
        access.project.id,
    });

    const create_resp = try deepl.createGlossary(
        glossary_name,
        access.project.source_lang,
        access.project.target_lang,
        terms_tsv,
    );

    const created = try std.json.parseFromSliceLeaky(struct {
        glossary_id: ?[]const u8 = null,
        name: ?[]const u8 = null,
        dictionaries: ?[]const struct {
            entry_count: ?i64 = null,
        } = null,
    }, res.arena, create_resp, .{
        .ignore_unknown_fields = true,
    });

    const glossary_id = created.glossary_id orelse {
        jsonError(res, 502, "DeepL не повернув glossary_id.");
        return;
    };
    const entry_count = if (created.dictionaries) |dicts|
        if (dicts.len > 0) dicts[0].entry_count orelse 0 else 0
    else
        0;

    if (existing_row_id) |row_id| {
        var update_stmt = try a.db.prepare(
            \\UPDATE deepl_glossaries
            \\SET deepl_glossary_id = ?, name = ?, source_lang = ?, target_lang = ?, entry_count = ?, synced_at = ?
            \\WHERE id = ?
        );
        defer update_stmt.deinit();
        try update_stmt.bindText(1, glossary_id);
        try update_stmt.bindText(2, created.name orelse glossary_name);
        try update_stmt.bindText(3, access.project.source_lang);
        try update_stmt.bindText(4, access.project.target_lang);
        try update_stmt.bindInt(5, entry_count);
        try update_stmt.bindInt(6, std.time.timestamp());
        try update_stmt.bindInt(7, row_id);
        try update_stmt.exec();
    } else {
        var insert_stmt = try a.db.prepare(
            \\INSERT INTO deepl_glossaries
            \\  (project_id, deepl_glossary_id, name, source_lang, target_lang, entry_count, synced_at)
            \\VALUES (?, ?, ?, ?, ?, ?, ?)
        );
        defer insert_stmt.deinit();
        try insert_stmt.bindInt(1, access.project_id);
        try insert_stmt.bindText(2, glossary_id);
        try insert_stmt.bindText(3, created.name orelse glossary_name);
        try insert_stmt.bindText(4, access.project.source_lang);
        try insert_stmt.bindText(5, access.project.target_lang);
        try insert_stmt.bindInt(6, entry_count);
        try insert_stmt.bindInt(7, std.time.timestamp());
        try insert_stmt.exec();
    }

    try res.json(.{
        .ok = true,
        .glossary_id = glossary_id,
        .entry_count = entry_count,
    }, .{});
}

pub fn handleMessages(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT id, direction, message_type, content, created_at
        \\FROM messages
        \\WHERE project_id = ?
        \\ORDER BY created_at DESC
        \\LIMIT 100
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    const Item = struct {
        id: i64,
        direction: []const u8,
        message_type: []const u8,
        content: []const u8,
        created_at: i64,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        try items.append(.{
            .id = stmt.columnInt(0),
            .direction = try dupOrEmpty(res.arena, stmt.columnText(1)),
            .message_type = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .content = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .created_at = stmt.columnInt(4),
        });
    }

    try res.json(.{ .messages = try items.toOwnedSlice() }, .{});
}

pub fn handlePricing(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT COUNT(*), COALESCE(SUM(char_count), 0), COALESCE(SUM(page_count), 0),
        \\       COALESCE(SUM(estimated_price_cents), 0)
        \\FROM files
        \\WHERE project_id = ?
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    var total_files: i64 = 0;
    var total_chars: i64 = 0;
    var total_pages: i64 = 0;
    var total_price_cents: i64 = 0;
    if (try stmt.step()) {
        total_files = stmt.columnInt(0);
        total_chars = stmt.columnInt(1);
        total_pages = stmt.columnInt(2);
        total_price_cents = stmt.columnInt(3);
    }

    try res.json(.{
        .pricing = .{
            .total_files = total_files,
            .total_chars = total_chars,
            .total_pages = total_pages,
            .total_price_cents = total_price_cents,
            .currency = "EUR",
        },
    }, .{});
}

pub fn handleCreateInvoice(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const amount_cents = try db_files.totalPriceForProject(&a.db, access.project_id);
    if (amount_cents <= 0) {
        jsonError(res, 400, "Для цього проєкту ще немає файлів для виставлення рахунку.");
        return;
    }

    const description = try std.fmt.allocPrint(res.arena, "KI Beratung — {s}", .{access.project.name});
    var stripe_session_id: ?[]const u8 = null;
    var payment_url: ?[]const u8 = null;

    if (a.config.stripe_secret_key.len > 0) {
        const session = createStripeCheckoutSession(
            res.arena,
            a.config.stripe_secret_key,
            amount_cents,
            access.project.name,
            a.config.mini_app_url,
            access.project_id,
            user.telegram_id,
        ) catch |err| {
            std.log.err("Stripe checkout session failed: {}", .{err});
            jsonError(res, 502, "Не вдалося створити Stripe Checkout Session.");
            return;
        };
        stripe_session_id = session.id;
        payment_url = session.url;
    }

    var stmt = try a.db.prepare(
        \\INSERT INTO invoices
        \\  (project_id, user_id, amount_cents, currency, description, stripe_session_id, stripe_payment_url, status, created_at)
        \\VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?)
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);
    try stmt.bindInt(2, user.id);
    try stmt.bindInt(3, amount_cents);
    try stmt.bindText(4, description);
    try stmt.bindText(5, stripe_session_id);
    try stmt.bindText(6, payment_url);
    try stmt.bindText(7, if (payment_url != null) "pending" else "manual_review");
    try stmt.bindInt(8, std.time.timestamp());
    try stmt.exec();

    const invoice_id = a.db.lastInsertRowId();

    if (payment_url) |url| {
        const msg = try std.fmt.allocPrint(res.arena,
            "Рахунок для проєкту <b>{s}</b> створено.\n\nСума: €{d}.{d:0>2}\nОплата: {s}",
            .{
                access.project.name,
                @divTrunc(amount_cents, 100),
                @mod(amount_cents, 100),
                url,
            },
        );
        const tg_resp = a.tg.sendMessage(user.telegram_id, msg, null) catch null;
        if (tg_resp) |resp_body| {
            a.allocator.free(resp_body);
        }
    } else {
        const admin_note = try std.fmt.allocPrint(res.arena,
            "Створено manual invoice для проєкту <b>{s}</b>, user_id={d}, amount={d} cents",
            .{ access.project.name, user.telegram_id, amount_cents },
        );
        const tg_resp = a.tg.sendMessage(a.config.admin_chat_id, admin_note, null) catch null;
        if (tg_resp) |resp_body| {
            a.allocator.free(resp_body);
        }
    }

    res.status = 201;
    try res.json(.{
        .invoice_id = invoice_id,
        .amount_cents = amount_cents,
        .currency = "EUR",
        .payment_url = payment_url,
    }, .{});
}

pub fn handleListInvoices(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        \\SELECT id, amount_cents, currency, description, status, stripe_payment_url, created_at, paid_at
        \\FROM invoices
        \\WHERE project_id = ?
        \\ORDER BY created_at DESC
        \\LIMIT 50
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    const Item = struct {
        id: i64,
        amount_cents: i64,
        currency: []const u8,
        description: []const u8,
        status: []const u8,
        payment_url: []const u8,
        created_at: i64,
        paid_at: i64,
    };

    var items = std.ArrayList(Item).init(res.arena);
    while (try stmt.step()) {
        try items.append(.{
            .id = stmt.columnInt(0),
            .amount_cents = stmt.columnInt(1),
            .currency = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .description = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .status = try dupOrEmpty(res.arena, stmt.columnText(4)),
            .payment_url = try dupOrEmpty(res.arena, stmt.columnText(5)),
            .created_at = stmt.columnInt(6),
            .paid_at = stmt.columnInt(7),
        });
    }

    try res.json(.{ .invoices = try items.toOwnedSlice() }, .{});
}

// ─── Delete Project ─────────────────────────────────────────────────────────

pub fn handleDeleteProject(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    // Only owner can delete
    if (access.role != .owner) {
        jsonError(res, 403, "Тільки власник може видалити проєкт.");
        return;
    }

    var stmt = try a.db.prepare(
        "UPDATE projects SET is_active = 0, updated_at = ? WHERE id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, std.time.timestamp());
    try stmt.bindInt(2, access.project_id);
    try stmt.exec();

    try res.json(.{ .deleted = true }, .{});
}

// ─── Glossary Versions ──────────────────────────────────────────────────────

pub fn handleListGlossaryVersions(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const versions = try glossary_versions_db.getVersions(res.arena, &a.db, access.project_id);

    const VersionItem = struct {
        id: i64,
        version_number: i64,
        change_summary: []const u8,
        terms_added: i64,
        terms_removed: i64,
        terms_modified: i64,
        created_at: i64,
    };

    var items = try std.ArrayList(VersionItem).initCapacity(res.arena, versions.len);
    for (versions) |v| {
        try items.append(.{
            .id = v.id,
            .version_number = v.version_number,
            .change_summary = v.change_summary,
            .terms_added = v.terms_added,
            .terms_removed = v.terms_removed,
            .terms_modified = v.terms_modified,
            .created_at = v.created_at,
        });
    }

    try res.json(.{ .versions = try items.toOwnedSlice() }, .{});
}

pub fn handleGetGlossaryVersion(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    _ = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const vid = parseIntParam(req, "version_id") catch {
        jsonError(res, 400, "Некоректний ідентифікатор версії.");
        return;
    };

    const version = try glossary_versions_db.getVersion(res.arena, &a.db, vid) orelse {
        jsonError(res, 404, "Версію не знайдено.");
        return;
    };

    try res.json(.{
        .id = version.id,
        .version_number = version.version_number,
        .snapshot_tsv = version.snapshot_tsv,
        .change_summary = version.change_summary,
        .terms_added = version.terms_added,
        .terms_removed = version.terms_removed,
        .terms_modified = version.terms_modified,
        .created_at = version.created_at,
    }, .{});
}

pub fn handleGlossaryDiff(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    _ = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const query = req.query() orelse {
        jsonError(res, 400, "Параметри a та b обов'язкові.");
        return;
    };

    const a_str = query.get("a") orelse {
        jsonError(res, 400, "Параметр a обов'язковий.");
        return;
    };
    const b_str = query.get("b") orelse {
        jsonError(res, 400, "Параметр b обов'язковий.");
        return;
    };

    const vid_a = std.fmt.parseInt(i64, a_str, 10) catch {
        jsonError(res, 400, "Некоректний параметр a.");
        return;
    };
    const vid_b = std.fmt.parseInt(i64, b_str, 10) catch {
        jsonError(res, 400, "Некоректний параметр b.");
        return;
    };

    const ver_a = try glossary_versions_db.getVersion(res.arena, &a.db, vid_a) orelse {
        jsonError(res, 404, "Версію A не знайдено.");
        return;
    };
    const ver_b = try glossary_versions_db.getVersion(res.arena, &a.db, vid_b) orelse {
        jsonError(res, 404, "Версію B не знайдено.");
        return;
    };

    // Compute diff: parse TSV into hashmaps, compare
    var map_a = std.StringHashMap([]const u8).init(res.arena);
    var map_b = std.StringHashMap([]const u8).init(res.arena);

    parseTsvIntoMap(ver_a.snapshot_tsv, &map_a, res.arena) catch {};
    parseTsvIntoMap(ver_b.snapshot_tsv, &map_b, res.arena) catch {};

    // Build diff JSON manually
    var json_buf = std.ArrayList(u8).init(res.arena);
    var writer = json_buf.writer();
    try writer.writeAll("{\"changes\":[");

    var first = true;

    // Added: in B but not in A
    var it_b = map_b.iterator();
    while (it_b.next()) |entry| {
        if (!map_a.contains(entry.key_ptr.*)) {
            if (!first) try writer.writeAll(",");
            first = false;
            try writer.writeAll("{\"type\":\"added\",\"source\":");
            try std.json.stringify(entry.key_ptr.*, .{}, writer);
            try writer.writeAll(",\"target\":");
            try std.json.stringify(entry.value_ptr.*, .{}, writer);
            try writer.writeAll("}");
        }
    }

    // Removed: in A but not in B
    var it_a = map_a.iterator();
    while (it_a.next()) |entry| {
        if (!map_b.contains(entry.key_ptr.*)) {
            if (!first) try writer.writeAll(",");
            first = false;
            try writer.writeAll("{\"type\":\"removed\",\"source\":");
            try std.json.stringify(entry.key_ptr.*, .{}, writer);
            try writer.writeAll(",\"target\":");
            try std.json.stringify(entry.value_ptr.*, .{}, writer);
            try writer.writeAll("}");
        }
    }

    // Modified: in both, different target
    var it_mod = map_a.iterator();
    while (it_mod.next()) |entry| {
        if (map_b.get(entry.key_ptr.*)) |new_target| {
            if (!std.mem.eql(u8, entry.value_ptr.*, new_target)) {
                if (!first) try writer.writeAll(",");
                first = false;
                try writer.writeAll("{\"type\":\"modified\",\"source\":");
                try std.json.stringify(entry.key_ptr.*, .{}, writer);
                try writer.writeAll(",\"old_target\":");
                try std.json.stringify(entry.value_ptr.*, .{}, writer);
                try writer.writeAll(",\"new_target\":");
                try std.json.stringify(new_target, .{}, writer);
                try writer.writeAll("}");
            }
        }
    }

    try writer.writeAll("]}");

    res.status = 200;
    res.header("Content-Type", "application/json");
    res.body = json_buf.items;
}

fn parseTsvIntoMap(tsv: []const u8, map: *std.StringHashMap([]const u8), arena: std.mem.Allocator) !void {
    var lines = std.mem.splitScalar(u8, tsv, '\n');
    while (lines.next()) |line| {
        const trimmed = std.mem.trim(u8, line, &std.ascii.whitespace);
        if (trimmed.len == 0) continue;
        if (std.mem.indexOfScalar(u8, trimmed, '\t')) |tab_idx| {
            const source = try arena.dupe(u8, std.mem.trim(u8, trimmed[0..tab_idx], &std.ascii.whitespace));
            const target = try arena.dupe(u8, std.mem.trim(u8, trimmed[tab_idx + 1 ..], &std.ascii.whitespace));
            if (source.len > 0 and target.len > 0) {
                try map.put(source, target);
            }
        }
    }
}

// ─── Translation Settings ───────────────────────────────────────────────────

pub fn handleGetSettings(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        "SELECT formality, split_sentences, preserve_formatting, context, tag_handling FROM translation_settings WHERE project_id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    if (try stmt.step()) {
        try res.json(.{
            .formality = try dupOrEmpty(res.arena, stmt.columnText(0)),
            .split_sentences = try dupOrEmpty(res.arena, stmt.columnText(1)),
            .preserve_formatting = stmt.columnInt(2) == 1,
            .context = try dupOrEmpty(res.arena, stmt.columnText(3)),
            .tag_handling = try dupOrEmpty(res.arena, stmt.columnText(4)),
        }, .{});
    } else {
        try res.json(.{
            .formality = "default",
            .split_sentences = "1",
            .preserve_formatting = true,
            .context = "",
            .tag_handling = "",
        }, .{});
    }
}

pub fn handleUpdateSettings(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const body = req.body() orelse {
        jsonError(res, 400, "Пустий запит.");
        return;
    };

    const parsed = std.json.parseFromSlice(struct {
        formality: ?[]const u8 = null,
        split_sentences: ?[]const u8 = null,
        preserve_formatting: ?bool = null,
        context: ?[]const u8 = null,
        tag_handling: ?[]const u8 = null,
    }, res.arena, body, .{ .ignore_unknown_fields = true }) catch {
        jsonError(res, 400, "Невірний формат JSON.");
        return;
    };
    defer parsed.deinit();

    const now = std.time.timestamp();
    var stmt = try a.db.prepare(
        "INSERT INTO translation_settings (project_id, formality, split_sentences, preserve_formatting, context, tag_handling, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET formality=excluded.formality, split_sentences=excluded.split_sentences, preserve_formatting=excluded.preserve_formatting, context=excluded.context, tag_handling=excluded.tag_handling, updated_at=excluded.updated_at",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);
    try stmt.bindText(2, parsed.value.formality orelse "default");
    try stmt.bindText(3, parsed.value.split_sentences orelse "1");
    try stmt.bindInt(4, if (parsed.value.preserve_formatting orelse true) 1 else 0);
    try stmt.bindText(5, parsed.value.context orelse "");
    try stmt.bindText(6, parsed.value.tag_handling orelse "");
    try stmt.bindInt(7, now);
    try stmt.exec();

    try res.json(.{ .ok = true }, .{});
}

// ─── Send Message (Web App → Telegram) ──────────────────────────────────────

pub fn handleSendMessage(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    const body = req.body() orelse {
        jsonError(res, 400, "Пустий запит.");
        return;
    };

    const parsed = std.json.parseFromSlice(struct {
        content: ?[]const u8 = null,
    }, res.arena, body, .{ .ignore_unknown_fields = true }) catch {
        jsonError(res, 400, "Невірний формат JSON.");
        return;
    };
    defer parsed.deinit();

    const content = parsed.value.content orelse {
        jsonError(res, 400, "Поле content обов'язкове.");
        return;
    };

    if (content.len == 0 or content.len > 4096) {
        jsonError(res, 400, "Повідомлення має бути від 1 до 4096 символів.");
        return;
    }

    const now = std.time.timestamp();

    // Generate UUID for dedup
    var uuid_bytes: [16]u8 = undefined;
    std.crypto.random.bytes(&uuid_bytes);
    var uuid_buf: [36]u8 = undefined;
    const uuid = std.fmt.bufPrint(&uuid_buf, "{x:0>2}{x:0>2}{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}", .{
        uuid_bytes[0],  uuid_bytes[1],  uuid_bytes[2],  uuid_bytes[3],
        uuid_bytes[4],  uuid_bytes[5],  uuid_bytes[6],  uuid_bytes[7],
        uuid_bytes[8],  uuid_bytes[9],  uuid_bytes[10], uuid_bytes[11],
        uuid_bytes[12], uuid_bytes[13], uuid_bytes[14], uuid_bytes[15],
    }) catch "no-uuid";

    // Store message
    var msg_stmt = try a.db.prepare(
        "INSERT INTO messages (project_id, sender_id, direction, message_type, content, target_chat_id, sender_name, message_uuid, created_at) VALUES (?, ?, 'to_admin', 'text', ?, ?, ?, ?, ?)",
    );
    defer msg_stmt.deinit();
    try msg_stmt.bindInt(1, access.project_id);
    try msg_stmt.bindInt(2, user.id);
    try msg_stmt.bindText(3, content);
    try msg_stmt.bindInt(4, a.config.admin_chat_id);
    try msg_stmt.bindText(5, user.first_name);
    try msg_stmt.bindText(6, uuid);
    try msg_stmt.bindInt(7, now);
    try msg_stmt.exec();

    // Insert SSE event
    var sse_stmt = try a.db.prepare(
        "INSERT INTO sse_events (project_id, event_type, payload, created_at) VALUES (?, 'message', ?, ?)",
    );
    defer sse_stmt.deinit();
    try sse_stmt.bindInt(1, access.project_id);

    const payload = try std.json.stringifyAlloc(res.arena, .{
        .content = content,
        .sender_name = user.first_name,
        .direction = "to_admin",
        .uuid = uuid,
        .created_at = now,
    }, .{});
    try sse_stmt.bindText(2, payload);
    try sse_stmt.bindInt(3, now);
    try sse_stmt.exec();

    // Forward to admin via Telegram
    var fwd_buf: [4200]u8 = undefined;
    const fwd_text = std.fmt.bufPrint(&fwd_buf, "💬 <b>{s}</b> (проєкт #{d}):\n\n{s}", .{
        user.first_name, access.project_id, content,
    }) catch content;
    const fwd_resp = a.tg.sendMessage(a.config.admin_chat_id, fwd_text, null) catch |err| {
        std.log.err("Failed to forward message to admin: {}", .{err});
        try res.json(.{ .sent = true, .uuid = uuid }, .{});
        return;
    };
    a.allocator.free(fwd_resp);

    try res.json(.{ .sent = true, .uuid = uuid }, .{});
}

// ─── SSE Message Stream ─────────────────────────────────────────────────────

pub fn handleMessageStream(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    res.status = 200;
    res.header("Content-Type", "text/event-stream");
    res.header("Cache-Control", "no-cache");
    res.header("Connection", "keep-alive");
    res.header("X-Accel-Buffering", "no");

    // Get last known event ID from client
    const last_id_str = req.header("last-event-id") orelse "0";
    var last_id = std.fmt.parseInt(i64, last_id_str, 10) catch 0;

    // Build response body with recent events
    var body_buf = std.ArrayList(u8).init(res.arena);
    var writer = body_buf.writer();

    // Send any queued events since last_id
    var stmt = try a.db.prepare(
        "SELECT id, event_type, payload FROM sse_events WHERE project_id = ? AND id > ? ORDER BY id ASC LIMIT 50",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);
    try stmt.bindInt(2, last_id);

    while (try stmt.step()) {
        const eid = stmt.columnInt(0);
        const payload = stmt.columnText(2) orelse "{}";
        try std.fmt.format(writer, "id: {d}\ndata: {s}\n\n", .{ eid, payload });
        last_id = eid;
    }

    // Send heartbeat if no events
    if (body_buf.items.len == 0) {
        try writer.writeAll(": heartbeat\n\n");
    }

    res.body = body_buf.items;
}

// ─── Workflow Status ────────────────────────────────────────────────────────

pub fn handleWorkflowStatus(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const access = parseProjectAccess(req, res, user) orelse return;
    const a = app();

    var stmt = try a.db.prepare(
        "SELECT step_number, step_type, status, created_at, completed_at FROM workflow_steps WHERE project_id = ? ORDER BY step_number ASC",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, access.project_id);

    const Step = struct {
        step_number: i64,
        step_type: []const u8,
        status: []const u8,
        created_at: i64,
        completed_at: i64,
    };

    var steps = std.ArrayList(Step).init(res.arena);
    while (try stmt.step()) {
        try steps.append(.{
            .step_number = stmt.columnInt(0),
            .step_type = try dupOrEmpty(res.arena, stmt.columnText(1)),
            .status = try dupOrEmpty(res.arena, stmt.columnText(2)),
            .created_at = stmt.columnInt(3),
            .completed_at = stmt.columnInt(4),
        });
    }

    try res.json(.{ .steps = try steps.toOwnedSlice() }, .{});
}

// ─── Auth Session (for desktop browser) ─────────────────────────────────────

pub fn handleCreateSession(req: *httpz.Request, res: *httpz.Response) !void {
    const user = authenticate(req, res) orelse return;
    const a = app();

    // Generate random token
    var token_bytes: [32]u8 = undefined;
    std.crypto.random.bytes(&token_bytes);
    var token_buf: [64]u8 = undefined;
    const token = try std.fmt.bufPrint(&token_buf, "{}", .{std.fmt.fmtSliceHexLower(&token_bytes)});

    // Hash token for storage
    var hash: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(token, &hash, .{});
    var hash_hex_buf: [64]u8 = undefined;
    const hash_hex = try std.fmt.bufPrint(&hash_hex_buf, "{}", .{std.fmt.fmtSliceHexLower(&hash)});

    const now = std.time.timestamp();
    const expires = now + 30 * 24 * 60 * 60; // 30 days

    var stmt = try a.db.prepare(
        "INSERT INTO web_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, user.id);
    try stmt.bindText(2, hash_hex);
    try stmt.bindInt(3, expires);
    try stmt.bindInt(4, now);
    try stmt.exec();

    try res.json(.{
        .token = token,
        .expires_at = expires,
    }, .{});
}
