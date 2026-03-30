const std = @import("std");

/// Ensure all top-level data directories exist
pub fn ensureDirectories(data_dir: []const u8) !void {
    const subdirs = [_][]const u8{ "db", "files", "batch", "backups" };
    for (subdirs) |sub| {
        var buf: [512]u8 = undefined;
        const path = std.fmt.bufPrint(&buf, "{s}/{s}", .{ data_dir, sub }) catch continue;
        std.fs.makeDirAbsolute(path) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => {
                std.log.err("Failed to create directory {s}: {}", .{ path, err });
                return err;
            },
        };
    }
    std.log.info("Data directories ready at {s}", .{data_dir});
}

/// Create project-specific subdirectories
pub fn createProjectDirs(data_dir: []const u8, project_id: i64) !void {
    const categories = [_][]const u8{ "source", "reference", "glossary", "translated", "document", "media", "instructions" };

    // Create project root
    var proj_buf: [512]u8 = undefined;
    const proj_path = try std.fmt.bufPrint(&proj_buf, "{s}/files/{d}", .{ data_dir, project_id });
    std.fs.makeDirAbsolute(proj_path) catch |err| switch (err) {
        error.PathAlreadyExists => {},
        else => return err,
    };

    // Create category subdirs
    for (categories) |cat| {
        var buf: [512]u8 = undefined;
        const path = std.fmt.bufPrint(&buf, "{s}/files/{d}/{s}", .{ data_dir, project_id, cat }) catch continue;
        std.fs.makeDirAbsolute(path) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            else => return err,
        };
    }
}

/// Build a file storage path
pub fn filePath(buf: []u8, data_dir: []const u8, project_id: i64, category: []const u8, filename: []const u8) ![]const u8 {
    return std.fmt.bufPrint(buf, "{s}/files/{d}/{s}/{s}", .{ data_dir, project_id, category, filename });
}

/// Atomically write data to a file (write to .tmp then rename)
pub fn atomicWrite(path: []const u8, data: []const u8) !void {
    var tmp_buf: [520]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_buf, "{s}.tmp", .{path});

    // Write to temp file
    const file = try std.fs.createFileAbsolute(tmp_path, .{});
    defer file.close();
    try file.writeAll(data);

    // Rename to final path
    std.fs.renameAbsolute(tmp_path, path) catch |err| {
        std.fs.deleteFileAbsolute(tmp_path) catch {};
        return err;
    };
}

/// Delete a file safely
pub fn deleteFile(path: []const u8) !void {
    std.fs.deleteFileAbsolute(path) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };
}

/// Get file size
pub fn fileSize(path: []const u8) !u64 {
    const file = try std.fs.openFileAbsolute(path, .{});
    defer file.close();
    const stat = try file.stat();
    return stat.size;
}
