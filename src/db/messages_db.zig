const std = @import("std");
const sqlite = @import("sqlite.zig");

pub fn storeMessage(
    db: *sqlite.Db,
    project_id: ?i64,
    sender_id: i64,
    direction: []const u8,
    message_type: []const u8,
    content: ?[]const u8,
    telegram_file_id: ?[]const u8,
    original_msg_id: i64,
    relayed_msg_id: i64,
    target_chat_id: i64,
) !i64 {
    var stmt = try db.prepare(
        \\INSERT INTO messages (project_id, sender_id, direction, message_type, content,
        \\  telegram_file_id, original_msg_id, relayed_msg_id, target_chat_id, created_at)
        \\VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    );
    defer stmt.deinit();

    if (project_id) |pid| {
        try stmt.bindInt(1, pid);
    } else {
        try stmt.bindNull(1);
    }
    try stmt.bindInt(2, sender_id);
    try stmt.bindText(3, direction);
    try stmt.bindText(4, message_type);
    try stmt.bindText(5, content);
    try stmt.bindText(6, telegram_file_id);
    try stmt.bindInt(7, original_msg_id);
    try stmt.bindInt(8, relayed_msg_id);
    try stmt.bindInt(9, target_chat_id);
    try stmt.bindInt(10, std.time.timestamp());
    try stmt.exec();

    return db.lastInsertRowId();
}
