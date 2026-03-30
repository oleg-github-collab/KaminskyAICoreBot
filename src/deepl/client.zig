const std = @import("std");

/// DeepL API v3 client for glossary management and translation
pub const DeepLClient = struct {
    allocator: std.mem.Allocator,
    api_key: []const u8,

    const base_url = "https://api.deepl.com";

    pub fn init(allocator: std.mem.Allocator, api_key: []const u8) DeepLClient {
        return .{ .allocator = allocator, .api_key = api_key };
    }

    fn request(self: *DeepLClient, method: std.http.Method, path: []const u8, body: ?[]const u8) ![]const u8 {
        var url_buf: [512]u8 = undefined;
        const url_str = try std.fmt.bufPrint(&url_buf, "{s}{s}", .{ base_url, path });
        const uri = try std.Uri.parse(url_str);

        var auth_buf: [128]u8 = undefined;
        const auth = try std.fmt.bufPrint(&auth_buf, "DeepL-Auth-Key {s}", .{self.api_key});

        var client = std.http.Client{ .allocator = self.allocator };
        defer client.deinit();

        var header_buf: [4096]u8 = undefined;
        var req = try client.open(method, uri, .{
            .server_header_buffer = &header_buf,
            .extra_headers = &.{
                .{ .name = "Authorization", .value = auth },
                .{ .name = "Content-Type", .value = "application/json" },
            },
        });
        defer req.deinit();

        if (body) |b| {
            req.transfer_encoding = .{ .content_length = b.len };
            try req.send();
            try req.writer().writeAll(b);
        } else {
            try req.send();
        }
        try req.finish();
        try req.wait();

        return try req.reader().readAllAlloc(self.allocator, 4 * 1024 * 1024);
    }

    /// Create a new glossary with term pairs in TSV format
    pub fn createGlossary(
        self: *DeepLClient,
        name: []const u8,
        source_lang: []const u8,
        target_lang: []const u8,
        entries_tsv: []const u8,
    ) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("{\"name\":");
        try std.json.stringify(name, .{}, w);
        try w.writeAll(",\"dictionaries\":[{\"source_lang\":");
        try std.json.stringify(source_lang, .{}, w);
        try w.writeAll(",\"target_lang\":");
        try std.json.stringify(target_lang, .{}, w);
        try w.writeAll(",\"entries\":");
        try std.json.stringify(entries_tsv, .{}, w);
        try w.writeAll(",\"entries_format\":\"tsv\"}]}");

        return self.request(.POST, "/v3/glossaries", body.items);
    }

    /// Merge new entries into an existing glossary (PATCH)
    pub fn mergeGlossary(
        self: *DeepLClient,
        glossary_id: []const u8,
        source_lang: []const u8,
        target_lang: []const u8,
        entries_tsv: []const u8,
    ) ![]const u8 {
        var path_buf: [256]u8 = undefined;
        const path = try std.fmt.bufPrint(&path_buf, "/v3/glossaries/{s}", .{glossary_id});

        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("{\"dictionaries\":[{\"source_lang\":");
        try std.json.stringify(source_lang, .{}, w);
        try w.writeAll(",\"target_lang\":");
        try std.json.stringify(target_lang, .{}, w);
        try w.writeAll(",\"entries\":");
        try std.json.stringify(entries_tsv, .{}, w);
        try w.writeAll(",\"entries_format\":\"tsv\"}]}");

        return self.request(.PATCH, path, body.items);
    }

    /// List all glossaries
    pub fn listGlossaries(self: *DeepLClient) ![]const u8 {
        return self.request(.GET, "/v3/glossaries", null);
    }

    /// Delete a glossary
    pub fn deleteGlossary(self: *DeepLClient, glossary_id: []const u8) ![]const u8 {
        var path_buf: [256]u8 = undefined;
        const path = try std.fmt.bufPrint(&path_buf, "/v3/glossaries/{s}", .{glossary_id});
        return self.request(.DELETE, path, null);
    }

    /// Translate text with optional glossary
    pub fn translate(
        self: *DeepLClient,
        text: []const u8,
        source_lang: []const u8,
        target_lang: []const u8,
        glossary_id: ?[]const u8,
    ) ![]const u8 {
        var body = std.ArrayList(u8).init(self.allocator);
        defer body.deinit();
        var w = body.writer();

        try w.writeAll("{\"text\":[");
        try std.json.stringify(text, .{}, w);
        try w.writeAll("],\"source_lang\":");
        try std.json.stringify(source_lang, .{}, w);
        try w.writeAll(",\"target_lang\":");
        try std.json.stringify(target_lang, .{}, w);
        if (glossary_id) |gid| {
            try w.writeAll(",\"glossary_id\":");
            try std.json.stringify(gid, .{}, w);
        }
        try w.writeAll("}");

        return self.request(.POST, "/v2/translate", body.items);
    }

    /// Build TSV entries from term pairs
    pub fn buildTSV(allocator: std.mem.Allocator, terms: []const struct { source: []const u8, target: []const u8 }) ![]const u8 {
        var tsv = std.ArrayList(u8).init(allocator);
        var w = tsv.writer();
        for (terms, 0..) |term, i| {
            if (i > 0) try w.writeAll("\n");
            try w.writeAll(term.source);
            try w.writeAll("\t");
            try w.writeAll(term.target);
        }
        return tsv.toOwnedSlice();
    }
};
