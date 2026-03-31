const std = @import("std");
const httpz = @import("httpz");
const handler = @import("../webhook/handler.zig");
const db_users = @import("../db/users.zig");
const db_projects = @import("../db/projects_db.zig");
const miniapp_api = @import("../api/miniapp.zig");

pub const EventType = enum {
    message,
    typing,
    glossary_update,
    file_upload,
    member_join,
    member_leave,
    project_update,

    pub fn toString(self: EventType) []const u8 {
        return switch (self) {
            .message => "message",
            .typing => "typing",
            .glossary_update => "glossary_update",
            .file_upload => "file_upload",
            .member_join => "member_join",
            .member_leave => "member_leave",
            .project_update => "project_update",
        };
    }
};

pub const Event = struct {
    type: []const u8,
    project_id: i64,
    user_id: ?i64 = null,
    data: std.json.Value,
};

/// WebSocket upgrade handler: GET /api/projects/:project_id/ws
pub fn handleUpgrade(req: *httpz.Request, res: *httpz.Response) !void {
    const a = handler.app();

    // Extract project_id from URL params
    const project_id_str = req.param("project_id") orelse {
        res.status = 400;
        res.body = "{\"error\":\"Missing project_id\"}";
        return;
    };
    const project_id = std.fmt.parseInt(i64, project_id_str, 10) catch {
        res.status = 400;
        res.body = "{\"error\":\"Invalid project_id\"}";
        return;
    };

    // Authenticate user from query param or header
    const query = try req.query();
    const auth_query = query.get("auth");
    const auth_header = req.header("Authorization");
    const auth = auth_query orelse auth_header orelse {
        res.status = 401;
        res.body = "{\"error\":\"Unauthorized\"}";
        return;
    };

    // Validate auth and get user
    const user = miniapp_api.authenticateToken(a.allocator, &a.db, auth) catch {
        res.status = 401;
        res.body = "{\"error\":\"Invalid token\"}";
        return;
    };
    defer a.allocator.free(user.first_name);
    defer if (user.last_name) |ln| a.allocator.free(ln);
    defer if (user.username) |un| a.allocator.free(un);

    // Check user has access to project
    const is_member = db_projects.isMember(&a.db, project_id, user.id) catch false;

    if (!is_member) {
        res.status = 403;
        res.body = "{\"error\":\"Not a project member\"}";
        return;
    }

    // Upgrade to WebSocket
    const upgraded = try httpz.upgradeWebsocket(
        Handler,
        req,
        res,
        WebSocketContext{ .project_id = project_id, .user_id = user.id },
    );

    if (upgraded) {
        // Successfully upgraded
        std.log.info("WebSocket connected: user={d}, project={d}", .{ user.id, project_id });
    } else {
        res.status = 400;
        res.body = "{\"error\":\"WebSocket upgrade failed\"}";
    }
}

const WebSocketContext = struct {
    project_id: i64,
    user_id: i64,
};

// Handler wrapper required by httpz
const Handler = struct {
    pub const WebsocketHandler = WebSocketHandler;

    pub fn init(ws: *httpz.websocket.Conn, context: WebSocketContext) !WebSocketHandler {
        return WebSocketHandler.init(ws, context);
    }
};

const WebSocketHandler = struct {
    context: WebSocketContext,
    ws: *httpz.websocket.Conn,

    pub fn init(ws: *httpz.websocket.Conn, context: WebSocketContext) !WebSocketHandler {
        return .{
            .context = context,
            .ws = ws,
        };
    }

    pub fn handle(self: *WebSocketHandler, message: httpz.websocket.Message) !void {
        const a = handler.app();

        switch (message) {
            .text => |text| {
                // Parse incoming message
                const parsed = std.json.parseFromSlice(
                    std.json.Value,
                    a.allocator,
                    text,
                    .{},
                ) catch {
                    const err_msg = "{\"error\":\"Invalid JSON\"}";
                    try self.ws.write(err_msg);
                    return;
                };
                defer parsed.deinit();

                const obj = parsed.value.object;
                const msg_type = obj.get("type");

                if (msg_type) |t| {
                    if (std.mem.eql(u8, t.string, "ping")) {
                        try self.ws.write("{\"type\":\"pong\"}");
                    } else if (std.mem.eql(u8, t.string, "typing")) {
                        // Broadcast typing indicator to other users in project
                        try self.broadcastTyping();
                    }
                }
            },
            .binary => |data| {
                std.log.debug("Received binary data: {d} bytes", .{data.len});
            },
            .close => {
                std.log.info("WebSocket closed: user={d}, project={d}", .{
                    self.context.user_id,
                    self.context.project_id,
                });
            },
        }
    }

    pub fn close(self: *WebSocketHandler) void {
        std.log.info("WebSocket handler cleanup: user={d}, project={d}", .{
            self.context.user_id,
            self.context.project_id,
        });
    }

    fn broadcastTyping(self: *WebSocketHandler) !void {
        const a = handler.app();

        if (a.redis == null) {
            // No Redis, can't broadcast
            return;
        }

        const channel = try std.fmt.allocPrint(
            a.allocator,
            "project:{d}:events",
            .{self.context.project_id},
        );
        defer a.allocator.free(channel);

        const payload = try std.fmt.allocPrint(
            a.allocator,
            "{{\"type\":\"typing\",\"user_id\":{d}}}",
            .{self.context.user_id},
        );
        defer a.allocator.free(payload);

        if (a.redis) |redis| {
            try redis.publish(channel, payload);
        }
    }
};

/// Broadcast an event to all WebSocket connections for a project via Redis PubSub
pub fn broadcastEvent(allocator: std.mem.Allocator, redis: ?*@import("../redis/client.zig").RedisClient, event: Event) !void {
    if (redis == null) {
        return; // No Redis, can't broadcast
    }

    const channel = try std.fmt.allocPrint(
        allocator,
        "project:{d}:events",
        .{event.project_id},
    );
    defer allocator.free(channel);

    // Serialize event to JSON
    const json_str = try std.json.stringifyAlloc(allocator, event, .{});
    defer allocator.free(json_str);

    if (redis) |r| {
        try r.publish(channel, json_str);
    }
}

/// Helper to broadcast a simple message event
pub fn broadcastMessage(allocator: std.mem.Allocator, redis: ?*@import("../redis/client.zig").RedisClient, project_id: i64, user_id: i64, content: []const u8) !void {
    const data_str = try std.fmt.allocPrint(allocator, "{{\"content\":\"{s}\"}}", .{content});
    defer allocator.free(data_str);

    const data_obj = try std.json.parseFromSlice(
        std.json.Value,
        allocator,
        data_str,
        .{},
    );
    defer data_obj.deinit();

    try broadcastEvent(allocator, redis, .{
        .type = "message",
        .project_id = project_id,
        .user_id = user_id,
        .data = data_obj.value,
    });
}

/// Helper to broadcast glossary update
pub fn broadcastGlossaryUpdate(allocator: std.mem.Allocator, redis: ?*@import("../redis/client.zig").RedisClient, project_id: i64, action: []const u8) !void {
    const data_str = try std.fmt.allocPrint(allocator, "{{\"action\":\"{s}\"}}", .{action});
    defer allocator.free(data_str);

    const data_obj = try std.json.parseFromSlice(
        std.json.Value,
        allocator,
        data_str,
        .{},
    );
    defer data_obj.deinit();

    try broadcastEvent(allocator, redis, .{
        .type = "glossary_update",
        .project_id = project_id,
        .data = data_obj.value,
    });
}
