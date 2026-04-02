const std = @import("std");
const sqlite = @import("sqlite.zig");

const migrations = [_]struct { version: i32, sql: []const u8 }{
    .{ .version = 1, .sql = @embedFile("../sql/001_initial.sql") },
    .{ .version = 2, .sql = @embedFile("../sql/002_indexes.sql") },
    .{ .version = 3, .sql = @embedFile("../sql/003_workflow.sql") },
    .{ .version = 4, .sql = @embedFile("../sql/004_rich_text.sql") },
    .{ .version = 5, .sql = @embedFile("../sql/005_audit_log.sql") },
    .{ .version = 6, .sql = @embedFile("../sql/006_fts5_search.sql") },
    .{ .version = 7, .sql = @embedFile("../sql/007_comments.sql") },
    .{ .version = 8, .sql = @embedFile("../sql/008_git_like_versioning.sql") },
    .{ .version = 9, .sql = @embedFile("../sql/009_project_updates.sql") },
    .{ .version = 10, .sql = @embedFile("../sql/010_web_sessions.sql") },
    .{ .version = 11, .sql = @embedFile("../sql/011_document_content.sql") },
    .{ .version = 12, .sql = @embedFile("../sql/012_comment_anchors.sql") },
    .{ .version = 13, .sql = @embedFile("../sql/013_workflow_engine.sql") },
};

pub fn run(db: *sqlite.Db) !void {
    // Ensure migrations table exists
    try db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );

    for (migrations) |m| {
        // Check if already applied
        var check = try db.prepare(
            "SELECT version FROM schema_migrations WHERE version = ?",
        );
        defer check.deinit();
        try check.bindInt(1, m.version);

        if (try check.step()) {
            continue; // Already applied
        }

        // Apply migration
        std.log.info("Applying migration v{d}...", .{m.version});

        // Split by semicolons and execute each statement
        var iter = std.mem.splitSequence(u8, m.sql, ";");
        while (iter.next()) |stmt_raw| {
            const stmt_trimmed = std.mem.trim(u8, stmt_raw, &std.ascii.whitespace);
            if (stmt_trimmed.len == 0) continue;

            // Skip comments-only lines
            if (std.mem.startsWith(u8, stmt_trimmed, "--")) {
                // Check if there's actual SQL after comments
                var has_sql = false;
                var line_iter = std.mem.splitScalar(u8, stmt_trimmed, '\n');
                while (line_iter.next()) |line| {
                    const trimmed_line = std.mem.trim(u8, line, &std.ascii.whitespace);
                    if (trimmed_line.len > 0 and !std.mem.startsWith(u8, trimmed_line, "--")) {
                        has_sql = true;
                        break;
                    }
                }
                if (!has_sql) continue;
            }

            // Build null-terminated string
            var buf: [8192]u8 = undefined;
            if (stmt_trimmed.len >= buf.len - 1) {
                std.log.err("Migration statement too long ({d} bytes)", .{stmt_trimmed.len});
                return error.MigrationTooLong;
            }
            @memcpy(buf[0..stmt_trimmed.len], stmt_trimmed);
            buf[stmt_trimmed.len] = 0;

            db.exec(buf[0..stmt_trimmed.len :0]) catch |err| {
                std.log.err("Migration v{d} failed: {}", .{ m.version, err });
                return err;
            };
        }

        // Record migration
        var record = try db.prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        );
        defer record.deinit();
        try record.bindInt(1, m.version);
        try record.bindInt(2, std.time.timestamp());
        try record.exec();

        std.log.info("Migration v{d} applied successfully", .{m.version});
    }
}
