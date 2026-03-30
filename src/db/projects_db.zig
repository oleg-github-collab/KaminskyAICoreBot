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
};

pub fn create(allocator: std.mem.Allocator, db: *sqlite.Db, owner_id: i64, name: []const u8, description: []const u8) !ProjectRecord {
    const now = std.time.timestamp();

    // Generate invite code
    var code_bytes: [12]u8 = undefined;
    std.crypto.random.bytes(&code_bytes);
    var invite_code: [16]u8 = undefined;
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (&invite_code, 0..) |*ch, i| {
        ch.* = chars[code_bytes[i % 12] % chars.len];
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

pub fn getById(db: *sqlite.Db, project_id: i64) !?ProjectRecord {
    var stmt = try db.prepare(
        "SELECT id, owner_id, name, description, source_lang, target_lang, invite_code, is_active FROM projects WHERE id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    if (try stmt.step()) {
        return ProjectRecord{
            .id = stmt.columnInt(0),
            .owner_id = stmt.columnInt(1),
            .name = stmt.columnText(2) orelse "",
            .description = stmt.columnText(3) orelse "",
            .source_lang = stmt.columnText(4) orelse "EN",
            .target_lang = stmt.columnText(5) orelse "UK",
            .invite_code = stmt.columnText(6) orelse "",
            .is_active = stmt.columnInt(7) == 1,
        };
    }
    return null;
}

pub fn getByInviteCode(db: *sqlite.Db, code: []const u8) !?ProjectRecord {
    var stmt = try db.prepare(
        "SELECT id, owner_id, name, description, source_lang, target_lang, invite_code, is_active FROM projects WHERE invite_code = ?",
    );
    defer stmt.deinit();
    try stmt.bindText(1, code);

    if (try stmt.step()) {
        return ProjectRecord{
            .id = stmt.columnInt(0),
            .owner_id = stmt.columnInt(1),
            .name = stmt.columnText(2) orelse "",
            .description = stmt.columnText(3) orelse "",
            .source_lang = stmt.columnText(4) orelse "EN",
            .target_lang = stmt.columnText(5) orelse "UK",
            .invite_code = stmt.columnText(6) orelse "",
            .is_active = stmt.columnInt(7) == 1,
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
