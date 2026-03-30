const std = @import("std");
const c = @cImport({
    @cInclude("sqlite3.h");
});

pub const SqliteError = error{
    OpenFailed,
    ExecFailed,
    PrepareFailed,
    BindFailed,
    StepFailed,
    Busy,
    Locked,
    NoRow,
};

pub const Db = struct {
    handle: *c.sqlite3,

    pub fn open(path: [*:0]const u8) !Db {
        var db: ?*c.sqlite3 = null;
        const rc = c.sqlite3_open_v2(
            path,
            &db,
            c.SQLITE_OPEN_READWRITE | c.SQLITE_OPEN_CREATE | c.SQLITE_OPEN_FULLMUTEX,
            null,
        );
        if (rc != c.SQLITE_OK or db == null) {
            if (db) |d| _ = c.sqlite3_close(d);
            std.log.err("SQLite open failed: {s}", .{c.sqlite3_errmsg(db)});
            return SqliteError.OpenFailed;
        }
        return Db{ .handle = db.? };
    }

    pub fn close(self: *Db) void {
        _ = c.sqlite3_close(self.handle);
    }

    pub fn exec(self: *Db, sql: [*:0]const u8) !void {
        var err_msg: [*c]u8 = null;
        const rc = c.sqlite3_exec(self.handle, sql, null, null, &err_msg);
        if (rc != c.SQLITE_OK) {
            if (err_msg) |msg| {
                std.log.err("SQLite exec error: {s}", .{msg});
                c.sqlite3_free(msg);
            }
            return SqliteError.ExecFailed;
        }
    }

    pub fn prepare(self: *Db, sql: [*:0]const u8) !Statement {
        var stmt: ?*c.sqlite3_stmt = null;
        const rc = c.sqlite3_prepare_v2(self.handle, sql, -1, &stmt, null);
        if (rc != c.SQLITE_OK or stmt == null) {
            std.log.err("SQLite prepare error: {s}", .{c.sqlite3_errmsg(self.handle)});
            return SqliteError.PrepareFailed;
        }
        return Statement{ .handle = stmt.?, .db = self.handle };
    }

    pub fn lastInsertRowId(self: *Db) i64 {
        return c.sqlite3_last_insert_rowid(self.handle);
    }

    pub fn changes(self: *Db) i32 {
        return c.sqlite3_changes(self.handle);
    }
};

pub const Statement = struct {
    handle: *c.sqlite3_stmt,
    db: *c.sqlite3,

    pub fn deinit(self: *Statement) void {
        _ = c.sqlite3_finalize(self.handle);
    }

    pub fn reset(self: *Statement) void {
        _ = c.sqlite3_reset(self.handle);
        _ = c.sqlite3_clear_bindings(self.handle);
    }

    // Bind functions (1-indexed)
    pub fn bindInt(self: *Statement, col: c_int, value: i64) !void {
        if (c.sqlite3_bind_int64(self.handle, col, value) != c.SQLITE_OK)
            return SqliteError.BindFailed;
    }

    pub fn bindText(self: *Statement, col: c_int, value: ?[]const u8) !void {
        if (value) |v| {
            if (c.sqlite3_bind_text(self.handle, col, v.ptr, @intCast(v.len), c.SQLITE_TRANSIENT) != c.SQLITE_OK)
                return SqliteError.BindFailed;
        } else {
            if (c.sqlite3_bind_null(self.handle, col) != c.SQLITE_OK)
                return SqliteError.BindFailed;
        }
    }

    pub fn bindReal(self: *Statement, col: c_int, value: f64) !void {
        if (c.sqlite3_bind_double(self.handle, col, value) != c.SQLITE_OK)
            return SqliteError.BindFailed;
    }

    pub fn bindNull(self: *Statement, col: c_int) !void {
        if (c.sqlite3_bind_null(self.handle, col) != c.SQLITE_OK)
            return SqliteError.BindFailed;
    }

    // Step: execute or fetch next row
    pub fn step(self: *Statement) !bool {
        const rc = c.sqlite3_step(self.handle);
        if (rc == c.SQLITE_ROW) return true;
        if (rc == c.SQLITE_DONE) return false;
        std.log.err("SQLite step error: {s}", .{c.sqlite3_errmsg(self.db)});
        return SqliteError.StepFailed;
    }

    // Column getters (0-indexed)
    pub fn columnInt(self: *Statement, col: c_int) i64 {
        return c.sqlite3_column_int64(self.handle, col);
    }

    pub fn columnText(self: *Statement, col: c_int) ?[]const u8 {
        const ptr = c.sqlite3_column_text(self.handle, col);
        if (ptr == null) return null;
        const len = c.sqlite3_column_bytes(self.handle, col);
        if (len <= 0) return "";
        return ptr[0..@intCast(len)];
    }

    pub fn columnReal(self: *Statement, col: c_int) f64 {
        return c.sqlite3_column_double(self.handle, col);
    }

    pub fn columnIsNull(self: *Statement, col: c_int) bool {
        return c.sqlite3_column_type(self.handle, col) == c.SQLITE_NULL;
    }

    // Convenience: execute statement with no result
    pub fn exec(self: *Statement) !void {
        _ = try self.step();
    }
};
