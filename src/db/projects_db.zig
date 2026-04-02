const std = @import("std");
const sqlite = @import("sqlite.zig");

pub const ProjectRecord = struct {
    id: i64,
    owner_id: i64,
    name: []const u8,
    description: []const u8,
    source_lang: []const u8,
    target_lang: []const u8,
    invite_code: []const u8,
    is_active: bool,
    workflow_stage: []const u8 = "files_uploaded",
};

pub fn create(allocator: std.mem.Allocator, db: *sqlite.Db, owner_id: i64, name: []const u8, description: []const u8) !ProjectRecord {
    const now = std.time.timestamp();

    // Generate invite code
    var code_bytes: [16]u8 = undefined;
    std.crypto.random.bytes(&code_bytes);
    var invite_code: [16]u8 = undefined;
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (&invite_code, 0..) |*ch, i| {
        ch.* = chars[code_bytes[i] % chars.len];
    }

    var stmt = try db.prepare(
        "INSERT INTO projects (owner_id, name, description, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, owner_id);
    try stmt.bindText(2, name);
    try stmt.bindText(3, description);
    try stmt.bindText(4, &invite_code);
    try stmt.bindInt(5, now);
    try stmt.bindInt(6, now);
    try stmt.exec();

    const project_id = db.lastInsertRowId();

    // Add owner as member
    var member_stmt = try db.prepare(
        "INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    );
    defer member_stmt.deinit();
    try member_stmt.bindInt(1, project_id);
    try member_stmt.bindInt(2, owner_id);
    try member_stmt.bindInt(3, now);
    try member_stmt.exec();

    return ProjectRecord{
        .id = project_id,
        .owner_id = owner_id,
        .name = try allocator.dupe(u8, name),
        .description = try allocator.dupe(u8, description),
        .source_lang = try allocator.dupe(u8, "EN"),
        .target_lang = try allocator.dupe(u8, "UK"),
        .invite_code = try allocator.dupe(u8, &invite_code),
        .is_active = true,
    };
}

/// Get project by ID. Strings are duped into allocator and survive after statement finalization.
pub fn getById(allocator: std.mem.Allocator, db: *sqlite.Db, project_id: i64) !?ProjectRecord {
    var stmt = try db.prepare(
        "SELECT id, owner_id, name, description, source_lang, target_lang, invite_code, is_active, workflow_stage FROM projects WHERE id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    if (try stmt.step()) {
        // Dupe all text columns — sqlite3_column_text returns pointers into statement buffer,
        // which becomes invalid after stmt.deinit(). Without duping, callers get use-after-free.
        const ws = try dupCol(allocator, stmt.columnText(8));
        return ProjectRecord{
            .id = stmt.columnInt(0),
            .owner_id = stmt.columnInt(1),
            .name = try dupCol(allocator, stmt.columnText(2)),
            .description = try dupCol(allocator, stmt.columnText(3)),
            .source_lang = try dupCol(allocator, stmt.columnText(4)),
            .target_lang = try dupCol(allocator, stmt.columnText(5)),
            .invite_code = try dupCol(allocator, stmt.columnText(6)),
            .is_active = stmt.columnInt(7) == 1,
            .workflow_stage = if (ws.len > 0) ws else "files_uploaded",
        };
    }
    return null;
}

/// Get project by invite code. Strings are duped into allocator.
pub fn getByInviteCode(allocator: std.mem.Allocator, db: *sqlite.Db, code: []const u8) !?ProjectRecord {
    var stmt = try db.prepare(
        "SELECT id, owner_id, name, description, source_lang, target_lang, invite_code, is_active, workflow_stage FROM projects WHERE invite_code = ?",
    );
    defer stmt.deinit();
    try stmt.bindText(1, code);

    if (try stmt.step()) {
        const ws = try dupCol(allocator, stmt.columnText(8));
        return ProjectRecord{
            .id = stmt.columnInt(0),
            .owner_id = stmt.columnInt(1),
            .name = try dupCol(allocator, stmt.columnText(2)),
            .description = try dupCol(allocator, stmt.columnText(3)),
            .source_lang = try dupCol(allocator, stmt.columnText(4)),
            .target_lang = try dupCol(allocator, stmt.columnText(5)),
            .invite_code = try dupCol(allocator, stmt.columnText(6)),
            .is_active = stmt.columnInt(7) == 1,
            .workflow_stage = if (ws.len > 0) ws else "files_uploaded",
        };
    }
    return null;
}

pub fn isMember(db: *sqlite.Db, project_id: i64, user_id: i64) !bool {
    var stmt = try db.prepare(
        "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, user_id);
    return try stmt.step();
}

pub fn isOwner(db: *sqlite.Db, project_id: i64, user_id: i64) !bool {
    var stmt = try db.prepare(
        "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND role = 'owner'",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, user_id);
    return try stmt.step();
}

pub fn addMember(db: *sqlite.Db, project_id: i64, user_id: i64) !void {
    var stmt = try db.prepare(
        "INSERT OR IGNORE INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, user_id);
    try stmt.bindInt(3, std.time.timestamp());
    try stmt.exec();
}

/// Dupe a nullable column text into allocator. Returns "" for null.
fn dupCol(allocator: std.mem.Allocator, text: ?[]const u8) ![]const u8 {
    if (text) |t| {
        if (t.len == 0) return "";
        return allocator.dupe(u8, t);
    }
    return "";
}
