const std = @import("std");
const sqlite = @import("../db/sqlite.zig");
const httpz = @import("httpz");

pub const AuditAction = enum {
    create,
    update,
    delete,
    approve,
    reject,
    login,
    logout,
    upload,
    download,
    export,
    invite,
    remove_member,
    sync,
    commit,
    merge,

    pub fn toString(self: AuditAction) []const u8 {
        return switch (self) {
            .create => "create",
            .update => "update",
            .delete => "delete",
            .approve => "approve",
            .reject => "reject",
            .login => "login",
            .logout => "logout",
            .upload => "upload",
            .download => "download",
            .export => "export",
            .invite => "invite",
            .remove_member => "remove_member",
            .sync => "sync",
            .commit => "commit",
            .merge => "merge",
        };
    }
};

pub const ResourceType = enum {
    project,
    glossary_term,
    file,
    message,
    team_member,
    invite,
    glossary_version,
    comment,

    pub fn toString(self: ResourceType) []const u8 {
        return switch (self) {
            .project => "project",
            .glossary_term => "glossary_term",
            .file => "file",
            .message => "message",
            .team_member => "team_member",
            .invite => "invite",
            .glossary_version => "glossary_version",
            .comment => "comment",
        };
    }
};

/// Log an audit event
pub fn logAction(
    db: *sqlite.Db,
    user_id: i64,
    action: AuditAction,
    resource_type: ResourceType,
    project_id: ?i64,
    resource_id: ?i64,
    old_value: ?[]const u8,
    new_value: ?[]const u8,
    req: ?*httpz.Request,
) !void {
    var stmt = try db.prepare(
        \\INSERT INTO audit_log (user_id, project_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent, created_at)
        \\VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch('now'))
    );
    defer stmt.deinit();

    try stmt.bindInt(1, user_id);
    if (project_id) |pid| {
        try stmt.bindInt(2, pid);
    } else {
        try stmt.bindNull(2);
    }
    try stmt.bindText(3, action.toString());
    try stmt.bindText(4, resource_type.toString());
    if (resource_id) |rid| {
        try stmt.bindInt(5, rid);
    } else {
        try stmt.bindNull(5);
    }
    if (old_value) |ov| {
        try stmt.bindText(6, ov);
    } else {
        try stmt.bindNull(6);
    }
    if (new_value) |nv| {
        try stmt.bindText(7, nv);
    } else {
        try stmt.bindNull(7);
    }

    // Extract IP and User-Agent from request
    if (req) |r| {
        const ip = r.header("X-Forwarded-For") orelse r.header("X-Real-IP") orelse "unknown";
        try stmt.bindText(8, ip);

        const ua = r.header("User-Agent") orelse "unknown";
        try stmt.bindText(9, ua);
    } else {
        try stmt.bindText(8, "system");
        try stmt.bindText(9, "system");
    }

    try stmt.exec();

    std.log.debug(
        "AUDIT: user={d} action={s} resource={s}:{?d} project={?d}",
        .{ user_id, action.toString(), resource_type.toString(), resource_id, project_id },
    );
}

/// Get audit log for a project
pub fn getProjectAuditLog(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    project_id: i64,
    limit: u32,
) ![]const u8 {
    var stmt = try db.prepare(
        \\SELECT a.id, a.user_id, u.first_name, a.action, a.resource_type, a.resource_id, a.created_at
        \\FROM audit_log a
        \\LEFT JOIN users u ON a.user_id = u.id
        \\WHERE a.project_id = ?
        \\ORDER BY a.created_at DESC
        \\LIMIT ?
    );
    defer stmt.deinit();

    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, @intCast(limit));

    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();

    try result.appendSlice("[");

    var first = true;
    while (try stmt.step()) {
        if (!first) try result.appendSlice(",");
        first = false;

        const id = stmt.columnInt(0);
        const user_id = stmt.columnInt(1);
        const user_name = try allocator.dupe(u8, stmt.columnText(2));
        defer allocator.free(user_name);
        const action = try allocator.dupe(u8, stmt.columnText(3));
        defer allocator.free(action);
        const res_type = try allocator.dupe(u8, stmt.columnText(4));
        defer allocator.free(res_type);
        const res_id = if (stmt.columnType(5) != sqlite.SQLITE_NULL) stmt.columnInt(5) else null;
        const created_at = stmt.columnInt(6);

        const entry = try std.fmt.allocPrint(
            allocator,
            "{{\"id\":{d},\"user_id\":{d},\"user_name\":\"{s}\",\"action\":\"{s}\",\"resource_type\":\"{s}\",\"resource_id\":{?d},\"created_at\":{d}}}",
            .{ id, user_id, user_name, action, res_type, res_id, created_at },
        );
        defer allocator.free(entry);

        try result.appendSlice(entry);
    }

    try result.appendSlice("]");

    return result.toOwnedSlice();
}
