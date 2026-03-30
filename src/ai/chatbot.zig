const std = @import("std");
const openai = @import("openai_client.zig");
const sqlite = @import("../db/sqlite.zig");
const msgs = @import("../bot/messages_ua.zig");

/// Handle a client question using GPT-4.1 Nano.
/// Responses are cached by question hash.
/// Returns answer text (caller must free).
pub fn answerQuestion(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    ai: *openai.OpenAIClient,
    question: []const u8,
) ![]const u8 {
    // 1. Check cache
    var hash_buf: [64]u8 = undefined;
    const q_hash = hashQuestion(&hash_buf, question);

    var cache_stmt = try db.prepare(
        "SELECT answer FROM chatbot_cache WHERE question_hash = ?",
    );
    defer cache_stmt.deinit();
    try cache_stmt.bindText(1, q_hash);

    if (try cache_stmt.step()) {
        if (cache_stmt.columnText(0)) |cached| {
            // Update hit count
            var update = try db.prepare(
                "UPDATE chatbot_cache SET hit_count = hit_count + 1 WHERE question_hash = ?",
            );
            defer update.deinit();
            try update.bindText(1, q_hash);
            update.exec() catch {};

            return try allocator.dupe(u8, cached);
        }
    }

    // 2. Call OpenAI
    const resp = try ai.chatCompletion(msgs.chatbot_system_prompt, question);
    defer allocator.free(resp);

    // 3. Parse response
    const parsed = std.json.parseFromSlice(struct {
        choices: ?[]const struct {
            message: ?struct {
                content: ?[]const u8 = null,
            } = null,
        } = null,
    }, allocator, resp, .{ .ignore_unknown_fields = true }) catch {
        return try allocator.dupe(u8, "Виникла помилка. Спробуйте ще раз.");
    };
    defer parsed.deinit();

    const answer = blk: {
        const choices = parsed.value.choices orelse break :blk "Не вдалося отримати відповідь.";
        if (choices.len == 0) break :blk "Не вдалося отримати відповідь.";
        const msg = choices[0].message orelse break :blk "Не вдалося отримати відповідь.";
        break :blk msg.content orelse "Не вдалося отримати відповідь.";
    };

    const result = try allocator.dupe(u8, answer);

    // 4. Cache the answer
    var insert = try db.prepare(
        "INSERT OR IGNORE INTO chatbot_cache (question_hash, answer, created_at) VALUES (?, ?, ?)",
    );
    defer insert.deinit();
    try insert.bindText(1, q_hash);
    try insert.bindText(2, result);
    try insert.bindInt(3, std.time.timestamp());
    insert.exec() catch {};

    return result;
}

fn hashQuestion(buf: *[64]u8, question: []const u8) []const u8 {
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(question);
    var digest: [32]u8 = undefined;
    hasher.final(&digest);

    return std.fmt.bufPrint(buf, "{}", .{std.fmt.fmtSliceHexLower(&digest)}) catch "";
}
