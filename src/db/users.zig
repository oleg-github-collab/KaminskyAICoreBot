const std = @import("std");
const sqlite = @import("sqlite.zig");

pub const UserRecord = struct {
    id: i64,
    telegram_id: i64,
    username: ?[]const u8,
    first_name: []const u8,
    last_name: ?[]const u8,
    is_admin: bool,
};

pub fn findOrCreate(allocator: std.mem.Allocator, db: *sqlite.Db, telegram_id: i64, first_name: []const u8, last_name: ?[]const u8, username: ?[]const u8) !UserRecord {
    // Try to find existing
    var find = try db.prepare(
        "SELECT id, telegram_id, username, first_name, last_name, is_admin FROM users WHERE telegram_id = ?",
    );
    defer find.deinit();
    try find.bindInt(1, telegram_id);

    if (try find.step()) {
        return UserRecord{
            .id = find.columnInt(0),
            .telegram_id = find.columnInt(1),
            .username = if (find.columnText(2)) |value| try allocator.dupe(u8, value) else null,
            .first_name = try allocator.dupe(u8, find.columnText(3) orelse ""),
            .last_name = if (find.columnText(4)) |value| try allocator.dupe(u8, value) else null,
            .is_admin = find.columnInt(5) == 1,
        };
    }

    // Create new user
    const now = std.time.timestamp();
    var insert = try db.prepare(
        "INSERT INTO users (telegram_id, username, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    defer insert.deinit();
    try insert.bindInt(1, telegram_id);
    try insert.bindText(2, username);
    try insert.bindText(3, first_name);
    try insert.bindText(4, last_name);
    try insert.bindInt(5, now);
    try insert.bindInt(6, now);
    try insert.exec();

    const new_id = db.lastInsertRowId();
    return UserRecord{
        .id = new_id,
        .telegram_id = telegram_id,
        .username = if (username) |value| try allocator.dupe(u8, value) else null,
        .first_name = try allocator.dupe(u8, first_name),
        .last_name = if (last_name) |value| try allocator.dupe(u8, value) else null,
        .is_admin = false,
    };
}

pub fn findByRelayedMsgId(db: *sqlite.Db, relayed_msg_id: i64) !?struct { sender_telegram_id: i64, project_id: ?i64 } {
    var stmt = try db.prepare(
        \\SELECT u.telegram_id, m.project_id FROM messages m
        \\JOIN users u ON u.id = m.sender_id
        \\WHERE m.relayed_msg_id = ? AND m.direction = 'client_to_admin'
        \\ORDER BY m.created_at DESC LIMIT 1
    );
    defer stmt.deinit();
    try stmt.bindInt(1, relayed_msg_id);

    if (try stmt.step()) {
        return .{
            .sender_telegram_id = stmt.columnInt(0),
            .project_id = if (stmt.columnIsNull(1)) null else @as(?i64, stmt.columnInt(1)),
        };
    }
    return null;
}

pub fn setAdmin(db: *sqlite.Db, telegram_id: i64) !void {
    var stmt = try db.prepare("UPDATE users SET is_admin = 1 WHERE telegram_id = ?");
    defer stmt.deinit();
    try stmt.bindInt(1, telegram_id);
    try stmt.exec();
}
