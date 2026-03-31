const std = @import("std");
const sqlite = @import("../db/sqlite.zig");
const redis = @import("../redis/client.zig");

/// Redis caching layer for glossary terms
/// Cache keys: "glossary:project:{project_id}"
/// TTL: 60 seconds (hot data, frequently updated)

pub fn getGlossaryTerms(
    allocator: std.mem.Allocator,
    redis_client: ?*redis.RedisClient,
    db: *sqlite.Db,
    project_id: i64,
) ![]const u8 {
    // Try cache first if Redis is available
    if (redis_client) |r| {
        const cache_key = try std.fmt.allocPrint(allocator, "glossary:project:{d}", .{project_id});
        defer allocator.free(cache_key);

        if (try r.get(cache_key)) |cached_json| {
            std.log.debug("Cache HIT: glossary project {d}", .{project_id});
            return cached_json; // Caller must free
        }

        std.log.debug("Cache MISS: glossary project {d}", .{project_id});
    }

    // Cache miss or no Redis → fetch from DB
    const json = try fetchFromDatabase(allocator, db, project_id);

    // Store in cache with 60s TTL
    if (redis_client) |r| {
        const cache_key = try std.fmt.allocPrint(allocator, "glossary:project:{d}", .{project_id});
        defer allocator.free(cache_key);

        r.set(cache_key, json, 60) catch |err| {
            std.log.warn("Failed to cache glossary: {}", .{err});
        };
    }

    return json;
}

fn fetchFromDatabase(allocator: std.mem.Allocator, db: *sqlite.Db, project_id: i64) ![]const u8 {
    var stmt = try db.prepare(
        \\SELECT id, source_term, target_term, domain, confidence, is_approved, created_at
        \\FROM glossary_terms
        \\WHERE project_id = ? AND deleted_at IS NULL
        \\ORDER BY id ASC
    );
    defer stmt.deinit();

    try stmt.bindInt(1, project_id);

    var terms = std.ArrayList(u8).init(allocator);
    errdefer terms.deinit();

    try terms.appendSlice("[");

    var first = true;
    while (try stmt.step()) {
        if (!first) try terms.appendSlice(",");
        first = false;

        const id = stmt.columnInt(0);
        const source = try allocator.dupe(u8, stmt.columnText(1));
        defer allocator.free(source);
        const target = try allocator.dupe(u8, stmt.columnText(2));
        defer allocator.free(target);
        const domain = if (stmt.columnType(3) != sqlite.SQLITE_NULL)
            try allocator.dupe(u8, stmt.columnText(3))
        else
            null;
        defer if (domain) |d| allocator.free(d);
        const confidence = stmt.columnDouble(4);
        const is_approved = stmt.columnInt(5) == 1;
        const created_at = stmt.columnInt(6);

        const term_json = try std.fmt.allocPrint(
            allocator,
            \\{{"id":{d},"source_term":"{s}","target_term":"{s}","domain":{s},"confidence":{d:.2},"is_approved":{s},"created_at":{d}}}
            ,
            .{
                id,
                source,
                target,
                if (domain) |d| try std.fmt.allocPrint(allocator, "\"{s}\"", .{d}) else "null",
                confidence,
                if (is_approved) "true" else "false",
                created_at,
            },
        );
        defer allocator.free(term_json);

        try terms.appendSlice(term_json);
    }

    try terms.appendSlice("]");

    return terms.toOwnedSlice();
}

/// Invalidate cache when glossary is updated
pub fn invalidateGlossaryCache(redis_client: ?*redis.RedisClient, allocator: std.mem.Allocator, project_id: i64) !void {
    if (redis_client) |r| {
        const key = try std.fmt.allocPrint(allocator, "glossary:project:{d}", .{project_id});
        defer allocator.free(key);

        try r.del(key);
        std.log.debug("Cache INVALIDATE: glossary project {d}", .{project_id});
    }
}

/// Cache project data
pub fn getProjectData(
    allocator: std.mem.Allocator,
    redis_client: ?*redis.RedisClient,
    db: *sqlite.Db,
    project_id: i64,
) !?[]const u8 {
    // Try cache first
    if (redis_client) |r| {
        const cache_key = try std.fmt.allocPrint(allocator, "project:{d}", .{project_id});
        defer allocator.free(cache_key);

        if (try r.get(cache_key)) |cached| {
            std.log.debug("Cache HIT: project {d}", .{project_id});
            return cached;
        }
    }

    // Fetch from DB
    var stmt = try db.prepare(
        "SELECT id, name, description, source_lang, target_lang, created_at FROM projects WHERE id = ? AND deleted_at IS NULL"
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    if (!(try stmt.step())) return null;

    const name = try allocator.dupe(u8, stmt.columnText(1));
    defer allocator.free(name);
    const desc = try allocator.dupe(u8, stmt.columnText(2));
    defer allocator.free(desc);
    const src_lang = try allocator.dupe(u8, stmt.columnText(3));
    defer allocator.free(src_lang);
    const tgt_lang = try allocator.dupe(u8, stmt.columnText(4));
    defer allocator.free(tgt_lang);
    const created_at = stmt.columnInt(5);

    const json = try std.fmt.allocPrint(
        allocator,
        "{{\"id\":{d},\"name\":\"{s}\",\"description\":\"{s}\",\"source_lang\":\"{s}\",\"target_lang\":\"{s}\",\"created_at\":{d}}}",
        .{ project_id, name, desc, src_lang, tgt_lang, created_at },
    );

    // Cache with 5 min TTL
    if (redis_client) |r| {
        const cache_key = try std.fmt.allocPrint(allocator, "project:{d}", .{project_id});
        defer allocator.free(cache_key);
        r.set(cache_key, json, 300) catch {};
    }

    return json;
}

pub fn invalidateProjectCache(redis_client: ?*redis.RedisClient, allocator: std.mem.Allocator, project_id: i64) !void {
    if (redis_client) |r| {
        const key = try std.fmt.allocPrint(allocator, "project:{d}", .{project_id});
        defer allocator.free(key);
        try r.del(key);
        std.log.debug("Cache INVALIDATE: project {d}", .{project_id});
    }
}
