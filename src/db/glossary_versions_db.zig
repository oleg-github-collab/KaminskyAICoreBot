/// Glossary version snapshots for diff visualization.
const std = @import("std");
const sqlite = @import("sqlite.zig");

pub const VersionRecord = struct {
    id: i64,
    project_id: i64,
    version_number: i64,
    created_by: i64,
    snapshot_tsv: []const u8,
    change_summary: []const u8,
    terms_added: i64,
    terms_removed: i64,
    terms_modified: i64,
    created_at: i64,
};

/// Create a new glossary version snapshot.
pub fn createVersion(
    db: *sqlite.Db,
    project_id: i64,
    user_id: i64,
    snapshot_tsv: []const u8,
    summary: []const u8,
    added: i64,
    removed: i64,
    modified: i64,
) !i64 {
    const now = std.time.timestamp();

    // Get next version number
    var cnt_stmt = try db.prepare(
        "SELECT COALESCE(MAX(version_number), 0) FROM glossary_versions WHERE project_id = ?",
    );
    defer cnt_stmt.deinit();
    try cnt_stmt.bindInt(1, project_id);
    var next_version: i64 = 1;
    if (try cnt_stmt.step()) {
        next_version = cnt_stmt.columnInt(0) + 1;
    }

    var stmt = try db.prepare(
        "INSERT INTO glossary_versions (project_id, version_number, created_by, snapshot_tsv, change_summary, terms_added, terms_removed, terms_modified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, next_version);
    try stmt.bindInt(3, user_id);
    try stmt.bindText(4, snapshot_tsv);
    try stmt.bindText(5, summary);
    try stmt.bindInt(6, added);
    try stmt.bindInt(7, removed);
    try stmt.bindInt(8, modified);
    try stmt.bindInt(9, now);
    try stmt.exec();

    return db.lastInsertRowId();
}

/// Get all versions for a project.
pub fn getVersions(allocator: std.mem.Allocator, db: *sqlite.Db, project_id: i64) ![]VersionRecord {
    var stmt = try db.prepare(
        "SELECT id, project_id, version_number, created_by, change_summary, terms_added, terms_removed, terms_modified, created_at FROM glossary_versions WHERE project_id = ? ORDER BY version_number DESC",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    var list = std.ArrayList(VersionRecord).init(allocator);
    while (try stmt.step()) {
        try list.append(VersionRecord{
            .id = stmt.columnInt(0),
            .project_id = stmt.columnInt(1),
            .version_number = stmt.columnInt(2),
            .created_by = stmt.columnInt(3),
            .snapshot_tsv = "",
            .change_summary = try dupCol(allocator, stmt.columnText(4)),
            .terms_added = stmt.columnInt(5),
            .terms_removed = stmt.columnInt(6),
            .terms_modified = stmt.columnInt(7),
            .created_at = stmt.columnInt(8),
        });
    }
    return list.toOwnedSlice();
}

/// Get a single version with full TSV snapshot.
pub fn getVersion(allocator: std.mem.Allocator, db: *sqlite.Db, version_id: i64) !?VersionRecord {
    var stmt = try db.prepare(
        "SELECT id, project_id, version_number, created_by, snapshot_tsv, change_summary, terms_added, terms_removed, terms_modified, created_at FROM glossary_versions WHERE id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, version_id);

    if (try stmt.step()) {
        return VersionRecord{
            .id = stmt.columnInt(0),
            .project_id = stmt.columnInt(1),
            .version_number = stmt.columnInt(2),
            .created_by = stmt.columnInt(3),
            .snapshot_tsv = try dupCol(allocator, stmt.columnText(4)),
            .change_summary = try dupCol(allocator, stmt.columnText(5)),
            .terms_added = stmt.columnInt(6),
            .terms_removed = stmt.columnInt(7),
            .terms_modified = stmt.columnInt(8),
            .created_at = stmt.columnInt(9),
        };
    }
    return null;
}

fn dupCol(allocator: std.mem.Allocator, text: ?[]const u8) ![]const u8 {
    if (text) |t| {
        if (t.len == 0) return "";
        return allocator.dupe(u8, t);
    }
    return "";
}
