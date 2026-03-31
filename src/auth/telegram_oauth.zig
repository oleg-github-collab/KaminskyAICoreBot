const std = @import("std");
const httpz = @import("httpz");
const handler = @import("../webhook/handler.zig");
const db_users = @import("../db/users.zig");

/// Telegram OAuth Web Login
/// https://core.telegram.org/widgets/login

pub fn handleTelegramAuth(req: *httpz.Request, res: *httpz.Response) !void {
    const a = handler.app();

    // Extract Telegram auth data from query params
    const id_str = req.query().get("id") orelse {
        res.status = 400;
        res.body = "Missing id parameter";
        return;
    };
    const first_name = req.query().get("first_name") orelse "";
    const last_name = req.query().get("last_name");
    const username = req.query().get("username");
    _ = req.query().get("photo_url"); // Optional, not used yet
    const auth_date_str = req.query().get("auth_date") orelse {
        res.status = 400;
        res.body = "Missing auth_date";
        return;
    };
    _ = req.query().get("hash") orelse {
        res.status = 400;
        res.body = "Missing hash";
        return;
    };

    // Parse Telegram user ID
    const telegram_id = std.fmt.parseInt(i64, id_str, 10) catch {
        res.status = 400;
        res.body = "Invalid id";
        return;
    };

    // Verify hash (prevents forgery)
    const valid = try verifyTelegramHash(a.allocator, a.config.bot_token, req);
    if (!valid) {
        res.status = 403;
        res.body = "Invalid hash";
        std.log.warn("Telegram auth hash verification failed", .{});
        return;
    }

    // Check auth_date (must be recent, <1 hour old)
    const auth_date = std.fmt.parseInt(i64, auth_date_str, 10) catch {
        res.status = 400;
        res.body = "Invalid auth_date";
        return;
    };
    const now = std.time.timestamp();
    if (now - auth_date > 3600) {
        res.status = 403;
        res.body = "Auth expired";
        return;
    }

    // Find or create user
    const user = try db_users.findOrCreate(
        a.allocator,
        &a.db,
        telegram_id,
        first_name,
        last_name,
        username,
    );
    defer a.allocator.free(user.first_name);
    defer if (user.last_name) |ln| a.allocator.free(ln);
    defer if (user.username) |un| a.allocator.free(un);

    // Create web session
    const session_token = try createWebSession(a, user.id, req);
    defer a.allocator.free(session_token);

    // Redirect to app with session token
    const redirect_url = try std.fmt.allocPrint(
        a.allocator,
        "/app?session_token={s}",
        .{session_token},
    );
    defer a.allocator.free(redirect_url);

    res.status = 302;
    res.header("Location", redirect_url);
    std.log.info("Telegram OAuth: user {d} logged in", .{telegram_id});
}

fn verifyTelegramHash(allocator: std.mem.Allocator, bot_token: []const u8, req: *httpz.Request) !bool {
    // Telegram uses HMAC-SHA256 to sign auth data
    // https://core.telegram.org/widgets/login#checking-authorization

    const hash_param = req.query().get("hash") orelse return false;

    // Build data_check_string from all params except hash
    var data_parts = std.ArrayList([]const u8).init(allocator);
    defer data_parts.deinit();

    var iter = req.query().iterator();
    while (iter.next()) |entry| {
        if (std.mem.eql(u8, entry.key, "hash")) continue;

        const part = try std.fmt.allocPrint(allocator, "{s}={s}", .{ entry.key, entry.value });
        try data_parts.append(part);
    }

    // Sort alphabetically
    std.mem.sort([]const u8, data_parts.items, {}, struct {
        fn lessThan(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.order(u8, a, b) == .lt;
        }
    }.lessThan);

    // Join with \n
    const data_check_string = try std.mem.join(allocator, "\n", data_parts.items);
    defer allocator.free(data_check_string);
    for (data_parts.items) |part| allocator.free(part);

    // Compute secret_key = SHA256(bot_token)
    var secret_key: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(bot_token, &secret_key, .{});

    // Compute HMAC-SHA256(data_check_string, secret_key)
    var hmac_out: [32]u8 = undefined;
    std.crypto.auth.hmac.sha2.HmacSha256.create(&hmac_out, data_check_string, &secret_key);

    // Convert to hex
    var computed_hash: [64]u8 = undefined;
    _ = std.fmt.bufPrint(&computed_hash, "{}", .{std.fmt.fmtSliceHexLower(&hmac_out)}) catch return false;

    // Compare with provided hash
    return std.mem.eql(u8, &computed_hash, hash_param);
}

fn createWebSession(a: *handler.App, user_id: i64, req: *httpz.Request) ![]const u8 {
    // Generate random session token
    var token_bytes: [32]u8 = undefined;
    std.crypto.random.bytes(&token_bytes);

    var token_buf: [64]u8 = undefined;
    const token = try std.fmt.bufPrint(&token_buf, "{}", .{std.fmt.fmtSliceHexLower(&token_bytes)});
    const token_owned = try a.allocator.dupe(u8, token);

    // Get IP and User-Agent
    const ip = req.header("X-Forwarded-For") orelse req.header("X-Real-IP") orelse "unknown";
    const ua = req.header("User-Agent") orelse "unknown";

    // Create session (valid for 30 days)
    const now = std.time.timestamp();
    const expires_at = now + (30 * 24 * 60 * 60);

    var stmt = try a.db.prepare(
        \\INSERT INTO web_sessions (user_id, session_token, ip_address, user_agent, created_at, expires_at, last_used_at)
        \\VALUES (?, ?, ?, ?, ?, ?, ?)
    );
    defer stmt.deinit();

    try stmt.bindInt(1, user_id);
    try stmt.bindText(2, token_owned);
    try stmt.bindText(3, ip);
    try stmt.bindText(4, ua);
    try stmt.bindInt(5, now);
    try stmt.bindInt(6, expires_at);
    try stmt.bindInt(7, now);

    try stmt.exec();

    return token_owned;
}

pub fn verifyWebSession(_: std.mem.Allocator, db: *@import("../db/sqlite.zig").Db, token: []const u8) !?i64 {
    var stmt = try db.prepare(
        \\SELECT user_id, expires_at FROM web_sessions
        \\WHERE session_token = ? AND expires_at > unixepoch('now')
    );
    defer stmt.deinit();

    try stmt.bindText(1, token);

    if (!(try stmt.step())) {
        return null; // Session not found or expired
    }

    const user_id = stmt.columnInt(0);

    // Update last_used_at
    var update_stmt = try db.prepare("UPDATE web_sessions SET last_used_at = unixepoch('now') WHERE session_token = ?");
    defer update_stmt.deinit();
    try update_stmt.bindText(1, token);
    try update_stmt.exec();

    return user_id;
}
