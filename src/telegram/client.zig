const std = @import("std");

/// HTTP client for Telegram Bot API
pub const TelegramClient = struct {
    allocator: std.mem.Allocator,
    bot_token: []const u8,

    const base_url = "https://api.telegram.org";

    pub fn init(allocator: std.mem.Allocator, token: []const u8) TelegramClient {
        return .{ .allocator = allocator, .bot_token = token };
    }

    /// Call any Telegram Bot API method with a JSON body string.
    /// Returns the raw response body (caller must free).
    pub fn callRaw(self: *TelegramClient, method: []const u8, json_body: []const u8) ![]const u8 {
        var url_buf: [512]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}/bot{s}/{s}", .{ base_url, self.bot_token, method });

        const uri = try std.Uri.parse(url_str);

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(.POST, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "application/json" },
            },
        });
        defer req.deinit();

        req.transfer_encoding = .{ .content_length = json_body.len };
        try req.send();
        try req.writer().writeAll(json_body);
        try req.finish();
        try req.wait();

        const body = try req.reader().readAllAlloc(self.allocator, 1024 * 1024);
        return body;
    }

    /// Send a text message. Returns raw response JSON.
    pub fn sendMessage(self: *TelegramClient, chat_id: i64, text: []const u8, reply_markup: ?[]const u8) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();

        var writer = body.writer();
        try writer.writeAll("{\"chat_id\":");
        try std.fmt.formatInt(chat_id, 10, .lower, .{}, writer);
        try writer.writeAll(",\"text\":");
        try std.json.stringify(text, .{}, writer);
        try writer.writeAll(",\"parse_mode\":\"HTML\"");
        if (reply_markup) |rm| {
            try writer.writeAll(",\"reply_markup\":");
            try writer.writeAll(rm);
        }
        try writer.writeAll("}");

        return self.callRaw("sendMessage", body.items);
    }

    /// Copy a message from one chat to another
    pub fn copyMessage(self: *TelegramClient, to_chat_id: i64, from_chat_id: i64, message_id: i64) ![]const u8 {
        var buf: [256]u8 = undefined;
        const json = try std.fmt.bufPrint(&buf, "{{\"chat_id\":{d},\"from_chat_id\":{d},\"message_id\":{d}}}", .{ to_chat_id, from_chat_id, message_id });
        return self.callRaw("copyMessage", json);
    }

    /// Answer a callback query
    pub fn answerCallbackQuery(self: *TelegramClient, callback_query_id: []const u8, text: ?[]const u8) !void {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();

        var writer = body.writer();
        try writer.writeAll("{\"callback_query_id\":");
        try std.json.stringify(callback_query_id, .{}, writer);
        if (text) |t| {
            try writer.writeAll(",\"text\":");
            try std.json.stringify(t, .{}, writer);
        }
        try writer.writeAll("}");

        const resp = try self.callRaw("answerCallbackQuery", body.items);
        self.allocator.free(resp);
    }

    /// Set webhook URL
    pub fn setWebhook(self: *TelegramClient, url: []const u8, secret: []const u8) !void {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();

        var writer = body.writer();
        try writer.writeAll("{\"url\":");
        try std.json.stringify(url, .{}, writer);
        try writer.writeAll(",\"secret_token\":");
        try std.json.stringify(secret, .{}, writer);
        try writer.writeAll(",\"allowed_updates\":[\"message\",\"callback_query\"]}");

        const resp = try self.callRaw("setWebhook", body.items);
        defer self.allocator.free(resp);

        std.log.info("Webhook set to {s}", .{url});
    }

    /// Get file info (returns file_path for download)
    pub fn getFile(self: *TelegramClient, file_id_str: []const u8) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();

        var writer = body.writer();
        try writer.writeAll("{\"file_id\":");
        try std.json.stringify(file_id_str, .{}, writer);
        try writer.writeAll("}");

        return self.callRaw("getFile", body.items);
    }

    /// Download a file from Telegram servers to a local path
    pub fn downloadFile(self: *TelegramClient, tg_file_path: []const u8, dest_path: []const u8) !void {
        var url_buf: [1024]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}/file/bot{s}/{s}", .{ base_url, self.bot_token, tg_file_path });

        const uri = try std.Uri.parse(url_str);

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(.GET, uri, .{
            .server_header_buffer = &header_buf,
        });
        defer req.deinit();

        try req.send();
        try req.finish();
        try req.wait();

        const file = try std.fs.createFileAbsolute(dest_path, .{});
        defer file.close();

        var buf: [8192]u8 = undefined;
        while (true) {
            const n = try req.reader().read(&buf);
            if (n == 0) break;
            try file.writeAll(buf[0..n]);
        }
    }

    /// Build inline keyboard JSON
    pub fn inlineKeyboard(buttons: []const InlineButton) ![]const u8 {
        // This is a simple helper that builds keyboard JSON
        // For complex keyboards, build the JSON manually
        _ = buttons;
        return "{}";
    }
};

pub const InlineButton = struct {
    text: []const u8,
    callback_data: ?[]const u8 = null,
    url: ?[]const u8 = null,
    web_app_url: ?[]const u8 = null,
};

/// Build a JSON string for an inline keyboard with rows of buttons
pub fn buildKeyboard(allocator: std.mem.Allocator, rows: []const []const InlineButton) ![]const u8 {
    var json = std.ArrayList(u8).init(allocator);
    var writer = json.writer();

    try writer.writeAll("{\"inline_keyboard\":[");
    for (rows, 0..) |row, ri| {
        if (ri > 0) try writer.writeAll(",");
        try writer.writeAll("[");
        for (row, 0..) |btn, bi| {
            if (bi > 0) try writer.writeAll(",");
            try writer.writeAll("{\"text\":");
            try std.json.stringify(btn.text, .{}, writer);
            if (btn.callback_data) |cd| {
                try writer.writeAll(",\"callback_data\":");
                try std.json.stringify(cd, .{}, writer);
            }
            if (btn.url) |u| {
                try writer.writeAll(",\"url\":");
                try std.json.stringify(u, .{}, writer);
            }
            if (btn.web_app_url) |wau| {
                try writer.writeAll(",\"web_app\":{\"url\":");
                try std.json.stringify(wau, .{}, writer);
                try writer.writeAll("}");
            }
            try writer.writeAll("}");
        }
        try writer.writeAll("]");
    }
    try writer.writeAll("]}");

    return json.toOwnedSlice();
}
