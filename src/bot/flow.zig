const std = @import("std");
const sqlite = @import("../db/sqlite.zig");

/// User FSM states
pub const State = enum {
    idle,
    creating_project,
    selecting_project,
    project_menu,
    uploading_source,
    uploading_reference,
    chatting,
    awaiting_payment,

    pub fn fromString(s: []const u8) State {
        const map = .{
            .{ "idle", .idle },
            .{ "creating_project", .creating_project },
            .{ "selecting_project", .selecting_project },
            .{ "project_menu", .project_menu },
            .{ "uploading_source", .uploading_source },
            .{ "uploading_reference", .uploading_reference },
            .{ "chatting", .chatting },
            .{ "awaiting_payment", .awaiting_payment },
        };
        inline for (map) |entry| {
            if (std.mem.eql(u8, s, entry[0])) return entry[1];
        }
        return .idle;
    }

    pub fn toString(self: State) []const u8 {
        return switch (self) {
            .idle => "idle",
            .creating_project => "creating_project",
            .selecting_project => "selecting_project",
            .project_menu => "project_menu",
            .uploading_source => "uploading_source",
            .uploading_reference => "uploading_reference",
            .chatting => "chatting",
            .awaiting_payment => "awaiting_payment",
        };
    }
};

pub const UserState = struct {
    state: State,
    project_id: ?i64,
    context_data: []const u8,
};

/// Get current user state from DB
pub fn getUserState(db: *sqlite.Db, user_id: i64) !UserState {
    var stmt = try db.prepare(
        "SELECT current_state, current_project_id, context_data FROM user_states WHERE user_id = ?",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, user_id);

    if (try stmt.step()) {
        const state_str = stmt.columnText(0) orelse "idle";
        const proj_id = if (stmt.columnIsNull(1)) null else @as(?i64, stmt.columnInt(1));
        const ctx = stmt.columnText(2) orelse "{}";
        return UserState{
            .state = State.fromString(state_str),
            .project_id = proj_id,
            .context_data = ctx,
        };
    }
    return UserState{ .state = .idle, .project_id = null, .context_data = "{}" };
}

/// Update user state in DB
pub fn setUserState(db: *sqlite.Db, user_id: i64, state: State, project_id: ?i64) !void {
    const now = std.time.timestamp();

    // Try update first
    var update = try db.prepare(
        "UPDATE user_states SET current_state = ?, current_project_id = ?, updated_at = ? WHERE user_id = ?",
    );
    defer update.deinit();
    try update.bindText(1, state.toString());
    if (project_id) |pid| {
        try update.bindInt(2, pid);
    } else {
        try update.bindNull(2);
    }
    try update.bindInt(3, now);
    try update.bindInt(4, user_id);
    try update.exec();

    if (db.changes() == 0) {
        // Insert new state
        var insert = try db.prepare(
            "INSERT INTO user_states (user_id, current_state, current_project_id, updated_at) VALUES (?, ?, ?, ?)",
        );
        defer insert.deinit();
        try insert.bindInt(1, user_id);
        try insert.bindText(2, state.toString());
        if (project_id) |pid| {
            try insert.bindInt(3, pid);
        } else {
            try insert.bindNull(3);
        }
        try insert.bindInt(4, now);
        try insert.exec();
    }
}
