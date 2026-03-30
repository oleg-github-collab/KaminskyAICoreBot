const std = @import("std");

/// Simple OpenAI API client for batch operations and chat completions
pub const OpenAIClient = struct {
    allocator: std.mem.Allocator,
    api_key: []const u8,

    const base_url = "https://api.openai.com/v1";

    pub fn init(allocator: std.mem.Allocator, api_key: []const u8) OpenAIClient {
        return .{ .allocator = allocator, .api_key = api_key };
    }

    /// Make a POST request to OpenAI API
    pub fn post(self: *OpenAIClient, path: []const u8, body: []const u8, content_type: []const u8) ![]const u8 {
        var url_buf: [256]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}{s}", .{ base_url, path });
        const uri = try std.Uri.parse(url_str);

        var auth_buf: [128]u8 = undefined;
        const auth = try std.fmt.bufPrint(&auth_buf, "Bearer {s}", .{self.api_key});

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(.POST, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &.{
                .{ .name = "Authorization", .value = auth },
                .{ .name = "Content-Type", .value = content_type },
            },
        });
        defer req.deinit();

        req.transfer_encoding = .{ .content_length = body.len };
        try req.send();
        try req.writer().writeAll(body);
        try req.finish();
        try req.wait();

        return try req.reader().readAllAlloc(self.allocator, 4 * 1024 * 1024);
    }

    /// Chat completion (for chatbot)
    pub fn chatCompletion(self: *OpenAIClient, system_prompt: []const u8, user_message: []const u8) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("{\"model\":\"gpt-5.4-nano\",\"temperature\":0.3,\"max_tokens\":500,\"messages\":[");
        try w.writeAll("{\"role\":\"system\",\"content\":");
        try std.json.stringify(system_prompt, .{}, w);
        try w.writeAll("},{\"role\":\"user\",\"content\":");
        try std.json.stringify(user_message, .{}, w);
        try w.writeAll("}]}");

        return self.post("/chat/completions", body.items, "application/json");
    }

    /// Upload a JSONL file for batch processing
    pub fn uploadBatchFile(self: *OpenAIClient, jsonl_content: []const u8) ![]const u8 {
        // Build multipart form data
        const boundary = "----ZigBatchBoundary7MA4YWxkTrZu0gW";

        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("--");
        try w.writeAll(boundary);
        try w.writeAll("\r\nContent-Disposition: form-data; name=\"purpose\"\r\n\r\nbatch\r\n--");
        try w.writeAll(boundary);
        try w.writeAll("\r\nContent-Disposition: form-data; name=\"file\"; filename=\"batch.jsonl\"\r\nContent-Type: application/jsonl\r\n\r\n");
        try w.writeAll(jsonl_content);
        try w.writeAll("\r\n--");
        try w.writeAll(boundary);
        try w.writeAll("--\r\n");

        var ct_buf: [128]u8 = undefined;
        const ct = try std.fmt.bufPrint(&ct_buf, "multipart/form-data; boundary={s}", .{boundary});

        return self.post("/files", body.items, ct);
    }

    /// Create a batch job
    pub fn createBatch(self: *OpenAIClient, input_file_id: []const u8) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("{\"input_file_id\":");
        try std.json.stringify(input_file_id, .{}, w);
        try w.writeAll(",\"endpoint\":\"/v1/chat/completions\",\"completion_window\":\"24h\"}");

        return self.post("/batches", body.items, "application/json");
    }

    /// Check batch status
    pub fn getBatch(self: *OpenAIClient, batch_id: []const u8) ![]const u8 {
        var url_buf: [256]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}/batches/{s}", .{ base_url, batch_id });
        const uri = try std.Uri.parse(url_str);

        var auth_buf: [128]u8 = undefined;
        const auth = try std.fmt.bufPrint(&auth_buf, "Bearer {s}", .{self.api_key});

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(.GET, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &.{
                .{ .name = "Authorization", .value = auth },
            },
        });
        defer req.deinit();

        try req.send();
        try req.finish();
        try req.wait();

        return try req.reader().readAllAlloc(self.allocator, 1024 * 1024);
    }

    /// Download file content
    pub fn getFileContent(self: *OpenAIClient, file_id: []const u8) ![]const u8 {
        var url_buf: [256]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}/files/{s}/content", .{ base_url, file_id });
        const uri = try std.Uri.parse(url_str);

        var auth_buf: [128]u8 = undefined;
        const auth = try std.fmt.bufPrint(&auth_buf, "Bearer {s}", .{self.api_key});

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(.GET, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &.{
                .{ .name = "Authorization", .value = auth },
            },
        });
        defer req.deinit();

        try req.send();
        try req.finish();
        try req.wait();

        return try req.reader().readAllAlloc(self.allocator, 50 * 1024 * 1024);
    }
};
