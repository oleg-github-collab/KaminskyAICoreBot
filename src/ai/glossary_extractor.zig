const std = @import("std");
const sqlite = @import("../db/sqlite.zig");
const openai = @import("openai_client.zig");

const system_prompt =
    \\You are a professional terminology extraction engine for translation glossaries.
    \\Given parallel source and target texts, extract domain-specific term pairs.
    \\
    \\Rules:
    \\- Extract ONLY professional/domain terminology, NOT common everyday words
    \\- Include multi-word expressions and collocations
    \\- Preserve exact forms from texts
    \\- Rate confidence 0.0-1.0 based on how clearly the term pair is supported
    \\- Return JSON: {"terms": [{"s": "source term", "t": "target term", "d": "domain", "c": 0.95}]}
    \\- Domains: legal, medical, technical, financial, marketing, IT, general
    \\- Maximum 50 terms per chunk
;

/// Chunk text into segments of approximately max_chars characters,
/// splitting on paragraph boundaries when possible.
pub fn chunkText(allocator: std.mem.Allocator, text: []const u8, max_chars: usize) ![]const []const u8 {
    var chunks = std.ArrayList([]const u8).init(allocator);

    if (text.len <= max_chars) {
        try chunks.append(text);
        return chunks.toOwnedSlice();
    }

    var start: usize = 0;
    while (start < text.len) {
        var end = @min(start + max_chars, text.len);

        // Try to find a paragraph break near the end
        if (end < text.len) {
            var best_break = end;
            // Search backwards for double newline
            var i = end;
            while (i > start + max_chars / 2) : (i -= 1) {
                if (i + 1 < text.len and text[i] == '\n' and text[i + 1] == '\n') {
                    best_break = i + 2;
                    break;
                }
            }
            // If no paragraph break, try single newline
            if (best_break == end) {
                i = end;
                while (i > start + max_chars / 2) : (i -= 1) {
                    if (text[i] == '\n') {
                        best_break = i + 1;
                        break;
                    }
                }
            }
            // If no newline, try period+space
            if (best_break == end) {
                i = end;
                while (i > start + max_chars / 2) : (i -= 1) {
                    if (text[i] == '.' and i + 1 < text.len and text[i + 1] == ' ') {
                        best_break = i + 2;
                        break;
                    }
                }
            }
            end = best_break;
        }

        try chunks.append(text[start..end]);
        start = end;
    }

    return chunks.toOwnedSlice();
}

/// Build a JSONL batch file for glossary extraction
pub fn buildBatchJsonl(
    allocator: std.mem.Allocator,
    project_id: i64,
    source_chunks: []const []const u8,
    reference_chunks: []const []const u8,
    source_lang: []const u8,
    target_lang: []const u8,
) ![]const u8 {
    var jsonl = std.ArrayList(u8).init(allocator);
    var w = jsonl.writer();

    const pair_count = @min(source_chunks.len, reference_chunks.len);

    for (0..pair_count) |i| {
        // Build the request line
        try w.writeAll("{\"custom_id\":\"proj_");
        try std.fmt.formatInt(project_id, 10, .lower, .{}, w);
        try w.writeAll("_chunk_");
        try std.fmt.formatInt(@as(i64, @intCast(i)), 10, .lower, .{}, w);
        try w.writeAll("\",\"method\":\"POST\",\"url\":\"/v1/chat/completions\",\"body\":{\"model\":\"gpt-5.4-nano\",\"temperature\":0.1,\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"system\",\"content\":");
        try std.json.stringify(system_prompt, .{}, w);
        try w.writeAll("},{\"role\":\"user\",\"content\":");

        // Build user message
        var msg_buf = std.ArrayList(u8).init(allocator);
        defer msg_buf.deinit();
        var mw = msg_buf.writer();
        try mw.print("Source language: {s}\nTarget language: {s}\n\n=== SOURCE TEXT ===\n{s}\n\n=== TRANSLATED TEXT ===\n{s}\n\nExtract all professional terminology pairs.", .{
            source_lang, target_lang, source_chunks[i], reference_chunks[i],
        });

        try std.json.stringify(msg_buf.items, .{}, w);
        try w.writeAll("}]}}\n");
    }

    return jsonl.toOwnedSlice();
}

/// Parse glossary terms from a batch result line
pub fn parseTermsFromResult(allocator: std.mem.Allocator, result_json: []const u8) ![]Term {
    var terms = std.ArrayList(Term).init(allocator);

    // Parse the outer response
    const parsed = std.json.parseFromSlice(struct {
        response: ?struct {
            body: ?struct {
                choices: ?[]const struct {
                    message: ?struct {
                        content: ?[]const u8 = null,
                    } = null,
                } = null,
            } = null,
        } = null,
    }, allocator, result_json, .{ .ignore_unknown_fields = true }) catch return terms.toOwnedSlice();
    defer parsed.deinit();

    const choices = (parsed.value.response orelse return terms.toOwnedSlice()).body orelse return terms.toOwnedSlice();
    const choice_list = choices.choices orelse return terms.toOwnedSlice();
    if (choice_list.len == 0) return terms.toOwnedSlice();

    const content = (choice_list[0].message orelse return terms.toOwnedSlice()).content orelse return terms.toOwnedSlice();

    // Parse the inner JSON with terms
    const inner = std.json.parseFromSlice(struct {
        terms: ?[]const struct {
            s: ?[]const u8 = null,
            t: ?[]const u8 = null,
            d: ?[]const u8 = null,
            c: ?f64 = null,
        } = null,
    }, allocator, content, .{ .ignore_unknown_fields = true }) catch return terms.toOwnedSlice();
    defer inner.deinit();

    if (inner.value.terms) |term_list| {
        for (term_list) |term| {
            const source = term.s orelse continue;
            const target = term.t orelse continue;
            if (source.len == 0 or target.len == 0) continue;

            try terms.append(Term{
                .source_term = try allocator.dupe(u8, source),
                .target_term = try allocator.dupe(u8, target),
                .domain = try allocator.dupe(u8, term.d orelse "general"),
                .confidence = term.c orelse 0.5,
            });
        }
    }

    return terms.toOwnedSlice();
}

pub const Term = struct {
    source_term: []const u8,
    target_term: []const u8,
    domain: []const u8,
    confidence: f64,
};

/// Store extracted terms in the database
pub fn storeTerms(db: *sqlite.Db, project_id: i64, job_id: i64, terms: []const Term) !u32 {
    var count: u32 = 0;

    for (terms) |term| {
        // Check for duplicate
        var check = try db.prepare(
            "SELECT 1 FROM glossary_terms WHERE project_id = ? AND source_term = ? AND target_term = ?",
        );
        defer check.deinit();
        try check.bindInt(1, project_id);
        try check.bindText(2, term.source_term);
        try check.bindText(3, term.target_term);

        if (try check.step()) continue; // Skip duplicate

        var stmt = try db.prepare(
            \\INSERT INTO glossary_terms (project_id, job_id, source_term, target_term, domain, confidence, created_at)
            \\VALUES (?, ?, ?, ?, ?, ?, ?)
        );
        defer stmt.deinit();
        try stmt.bindInt(1, project_id);
        try stmt.bindInt(2, job_id);
        try stmt.bindText(3, term.source_term);
        try stmt.bindText(4, term.target_term);
        try stmt.bindText(5, term.domain);
        try stmt.bindReal(6, term.confidence);
        try stmt.bindInt(7, std.time.timestamp());
        try stmt.exec();
        count += 1;
    }

    return count;
}
