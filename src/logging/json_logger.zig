const std = @import("std");

/// Structured JSON logging for Railway/production
/// Outputs logs in JSON format for easy parsing and analysis

pub const LogLevel = enum {
    debug,
    info,
    warn,
    @"error",
    fatal,

    pub fn toString(self: LogLevel) []const u8 {
        return switch (self) {
            .debug => "DEBUG",
            .info => "INFO",
            .warn => "WARN",
            .@"error" => "ERROR",
            .fatal => "FATAL",
        };
    }
};

pub fn logRequest(
    allocator: std.mem.Allocator,
    level: LogLevel,
    user_id: ?i64,
    action: []const u8,
    project_id: ?i64,
    duration_ms: u64,
    status_code: u16,
    err: ?[]const u8,
) void {
    const timestamp = std.time.timestamp();

    const log_entry = std.fmt.allocPrint(
        allocator,
        "{{\"timestamp\":{d},\"level\":\"{s}\",\"user_id\":{?d},\"action\":\"{s}\",\"project_id\":{?d},\"duration_ms\":{d},\"status\":{d},\"error\":{s}}}",
        .{
            timestamp,
            level.toString(),
            user_id,
            action,
            project_id,
            duration_ms,
            status_code,
            if (err) |e| try std.fmt.allocPrint(allocator, "\"{s}\"", .{e}) else "null",
        },
    ) catch return;
    defer allocator.free(log_entry);

    std.debug.print("{s}\n", .{log_entry});
}

pub fn logInfo(allocator: std.mem.Allocator, message: []const u8) void {
    const timestamp = std.time.timestamp();
    const log = std.fmt.allocPrint(
        allocator,
        "{{\"timestamp\":{d},\"level\":\"INFO\",\"message\":\"{s}\"}}",
        .{ timestamp, message },
    ) catch return;
    defer allocator.free(log);
    std.debug.print("{s}\n", .{log});
}

pub fn logError(allocator: std.mem.Allocator, message: []const u8, err: anyerror) void {
    const timestamp = std.time.timestamp();
    const log = std.fmt.allocPrint(
        allocator,
        "{{\"timestamp\":{d},\"level\":\"ERROR\",\"message\":\"{s}\",\"error\":\"{s}\"}}",
        .{ timestamp, message, @errorName(err) },
    ) catch return;
    defer allocator.free(log);
    std.debug.print("{s}\n", .{log});
}

pub fn logMetric(allocator: std.mem.Allocator, metric: []const u8, value: f64, tags: ?[]const u8) void {
    const timestamp = std.time.timestamp();
    const log = std.fmt.allocPrint(
        allocator,
        "{{\"timestamp\":{d},\"level\":\"INFO\",\"metric\":\"{s}\",\"value\":{d:.2},\"tags\":{s}}}",
        .{ timestamp, metric, value, tags orelse "null" },
    ) catch return;
    defer allocator.free(log);
    std.debug.print("{s}\n", .{log});
}
