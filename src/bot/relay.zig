const std = @import("std");
const tg_client = @import("../telegram/client.zig");
const tg_types = @import("../telegram/types.zig");
const db_users = @import("../db/users.zig");
const db_messages = @import("../db/messages_db.zig");
const sqlite = @import("../db/sqlite.zig");
const msgs = @import("messages_ua.zig");

/// Handle a free-text message from client -> relay to admin
pub fn handleClientMessage(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    admin_chat_id: i64,
    msg: *const tg_types.Message,
    user: *const db_users.UserRecord,
    project_id: ?i64,
) !void {
    // 1. Send header to admin
    var header_buf: [512]u8 = undefined;
    const header = std.fmt.bufPrint(&header_buf, "<b>{s} {s}</b> (@{s})", .{
        user.first_name,
        user.last_name orelse "",
        user.username orelse "---",
    }) catch "Client message";

    const header_resp = try tg.sendMessage(admin_chat_id, header, null);
    allocator.free(header_resp);

    // 2. Copy the original message to admin
    const copy_resp = try tg.copyMessage(admin_chat_id, msg.chat.id, msg.message_id);
    defer allocator.free(copy_resp);

    // Extract relayed message_id from copyMessage response
    var relayed_msg_id: i64 = 0;
    if (std.json.parseFromSlice(struct {
        ok: bool = false,
        result: ?struct { message_id: i64 = 0 } = null,
    }, allocator, copy_resp, .{ .ignore_unknown_fields = true })) |parsed| {
        defer parsed.deinit();
        if (parsed.value.result) |r| {
            relayed_msg_id = r.message_id;
        }
    } else |_| {}

    // 3. Store in DB
    _ = try db_messages.storeMessage(
        db,
        project_id,
        user.id,
        "client_to_admin",
        tg_types.messageType(msg),
        msg.text orelse msg.caption,
        tg_types.fileId(msg),
        msg.message_id,
        relayed_msg_id,
        admin_chat_id,
    );

    // 4. Confirm to client
    const confirm_resp = try tg.sendMessage(msg.chat.id, msgs.message_forwarded, null);
    allocator.free(confirm_resp);
}

/// Handle admin reply -> send back to original client
pub fn handleAdminReply(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    msg: *const tg_types.Message,
    reply_to: *const tg_types.Message,
) !void {
    // Find the original sender by the relayed message ID
    const original = try db_users.findByRelayedMsgId(db, reply_to.message_id) orelse {
        const err_resp = try tg.sendMessage(msg.chat.id, "Cannot find original conversation for this reply.", null);
        allocator.free(err_resp);
        return;
    };

    // Copy admin's reply to the client
    const copy_resp = try tg.copyMessage(original.sender_telegram_id, msg.chat.id, msg.message_id);
    defer allocator.free(copy_resp);

    var relayed_msg_id: i64 = 0;
    if (std.json.parseFromSlice(struct {
        ok: bool = false,
        result: ?struct { message_id: i64 = 0 } = null,
    }, allocator, copy_resp, .{ .ignore_unknown_fields = true })) |parsed| {
        defer parsed.deinit();
        if (parsed.value.result) |r| {
            relayed_msg_id = r.message_id;
        }
    } else |_| {}

    // Store admin->client message
    _ = try db_messages.storeMessage(
        db,
        original.project_id,
        0, // admin
        "admin_to_client",
        tg_types.messageType(msg),
        msg.text orelse msg.caption,
        tg_types.fileId(msg),
        msg.message_id,
        relayed_msg_id,
        original.sender_telegram_id,
    );
}
