const std = @import("std");

// C bindings for hiredis
const c = @cImport({
    @cInclude("hiredis/hiredis.h");
});

pub const RedisError = error{
    ConnectionFailed,
    CommandFailed,
    NullReply,
    InvalidReply,
    NotConnected,
};

pub const RedisClient = struct {
    allocator: std.mem.Allocator,
    context: ?*c.redisContext,
    url: []const u8,

    pub fn connect(allocator: std.mem.Allocator, url: []const u8) !*RedisClient {
        var client = try allocator.create(RedisClient);
        client.* = .{
            .allocator = allocator,
            .context = null,
            .url = url,
        };

        if (url.len == 0) {
            std.log.warn("Redis URL not configured, client will not connect", .{});
            return client;
        }

        // Parse redis://host:port format
        var host: []const u8 = "127.0.0.1";
        var port: u16 = 6379;

        if (std.mem.startsWith(u8, url, "redis://")) {
            const rest = url[8..];
            if (std.mem.indexOf(u8, rest, ":")) |colon_idx| {
                host = rest[0..colon_idx];
                const port_str = rest[colon_idx + 1 ..];
                // Find end of port (might have /db or query params)
                const port_end = std.mem.indexOfAny(u8, port_str, "/?") orelse port_str.len;
                port = std.fmt.parseInt(u16, port_str[0..port_end], 10) catch 6379;
            } else {
                host = rest;
            }
        }

        // Create zero-terminated strings for C API
        const host_z = try allocator.dupeZ(u8, host);
        defer allocator.free(host_z);

        const ctx = c.redisConnect(host_z.ptr, @intCast(port));
        if (ctx == null or ctx.*.err != 0) {
            if (ctx != null) {
                const err_str = if (ctx.*.errstr[0] != 0) @as([*:0]u8, @ptrCast(&ctx.*.errstr)) else "Unknown error";
                std.log.err("Redis connection failed: {s}", .{err_str});
                c.redisFree(ctx);
            }
            return RedisError.ConnectionFailed;
        }

        client.context = ctx;
        std.log.info("Redis connected: {s}:{d}", .{ host, port });
        return client;
    }

    pub fn disconnect(self: *RedisClient) void {
        if (self.context) |ctx| {
            c.redisFree(ctx);
            self.context = null;
        }
        self.allocator.destroy(self);
    }

    fn ensureConnected(self: *const RedisClient) !*c.redisContext {
        return self.context orelse return RedisError.NotConnected;
    }

    // Basic string operations
    pub fn set(self: *RedisClient, key: []const u8, value: []const u8, ttl_seconds: ?u32) !void {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        if (ttl_seconds) |ttl| {
            const reply = c.redisCommand(ctx, "SET %s %b EX %d", key_z.ptr, value.ptr, value.len, ttl);
            defer if (reply != null) c.freeReplyObject(reply);

            if (reply == null or ctx.*.err != 0) {
                return RedisError.CommandFailed;
            }
        } else {
            const reply = c.redisCommand(ctx, "SET %s %b", key_z.ptr, value.ptr, value.len);
            defer if (reply != null) c.freeReplyObject(reply);

            if (reply == null or ctx.*.err != 0) {
                return RedisError.CommandFailed;
            }
        }
    }

    pub fn get(self: *RedisClient, key: []const u8) !?[]const u8 {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const reply = c.redisCommand(ctx, "GET %s", key_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const r = @as(*c.redisReply, @ptrCast(@alignCast(reply)));
        if (r.type == c.REDIS_REPLY_NIL) {
            return null;
        }

        if (r.type != c.REDIS_REPLY_STRING) {
            return RedisError.InvalidReply;
        }

        const data = r.str[0..@intCast(r.len)];
        return try self.allocator.dupe(u8, data);
    }

    pub fn del(self: *RedisClient, key: []const u8) !void {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const reply = c.redisCommand(ctx, "DEL %s", key_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }
    }

    pub fn exists(self: *RedisClient, key: []const u8) !bool {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const reply = c.redisCommand(ctx, "EXISTS %s", key_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const r = @as(*c.redisReply, @ptrCast(@alignCast(reply)));
        return r.type == c.REDIS_REPLY_INTEGER and r.integer > 0;
    }

    pub fn expire(self: *RedisClient, key: []const u8, ttl_seconds: u32) !void {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const reply = c.redisCommand(ctx, "EXPIRE %s %d", key_z.ptr, ttl_seconds);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }
    }

    // PubSub for WebSocket broadcasting
    pub fn publish(self: *RedisClient, channel: []const u8, message: []const u8) !void {
        const ctx = try self.ensureConnected();

        const channel_z = try self.allocator.dupeZ(u8, channel);
        defer self.allocator.free(channel_z);

        const reply = c.redisCommand(ctx, "PUBLISH %s %b", channel_z.ptr, message.ptr, message.len);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }
    }

    // Rate limiting using INCR with TTL
    // Returns true if allowed, false if rate limit exceeded
    pub fn rateLimit(self: *RedisClient, key: []const u8, limit: u32, window_seconds: u32) !bool {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        // Get current count
        const get_reply = c.redisCommand(ctx, "GET %s", key_z.ptr);
        defer if (get_reply != null) c.freeReplyObject(get_reply);

        if (get_reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const get_r = @as(*c.redisReply, @ptrCast(@alignCast(get_reply)));
        var count: i64 = 0;

        if (get_r.type == c.REDIS_REPLY_STRING) {
            const count_str = get_r.str[0..@intCast(get_r.len)];
            count = std.fmt.parseInt(i64, count_str, 10) catch 0;
        }

        // Check if limit exceeded
        if (count >= limit) {
            return false;
        }

        // Increment counter
        const incr_reply = c.redisCommand(ctx, "INCR %s", key_z.ptr);
        defer if (incr_reply != null) c.freeReplyObject(incr_reply);

        if (incr_reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const incr_r = @as(*c.redisReply, @ptrCast(@alignCast(incr_reply)));

        // If this is the first increment, set TTL
        if (incr_r.type == c.REDIS_REPLY_INTEGER and incr_r.integer == 1) {
            const expire_reply = c.redisCommand(ctx, "EXPIRE %s %d", key_z.ptr, window_seconds);
            defer if (expire_reply != null) c.freeReplyObject(expire_reply);

            if (expire_reply == null or ctx.*.err != 0) {
                return RedisError.CommandFailed;
            }
        }

        return true;
    }

    // Distributed locking with TTL
    // Returns token if lock acquired, null if already locked
    pub fn acquireLock(self: *RedisClient, resource: []const u8, ttl_seconds: u32) !?[]const u8 {
        const ctx = try self.ensureConnected();

        // Generate unique token
        var buf: [32]u8 = undefined;
        std.crypto.random.bytes(&buf);
        var token_buf: [64]u8 = undefined;
        const token = std.fmt.bufPrint(&token_buf, "{}", .{std.fmt.fmtSliceHexLower(&buf)}) catch unreachable;

        const resource_z = try self.allocator.dupeZ(u8, resource);
        defer self.allocator.free(resource_z);

        const token_z = try self.allocator.dupeZ(u8, token);
        defer self.allocator.free(token_z);

        // SET resource token NX EX ttl
        const reply = c.redisCommand(ctx, "SET %s %s NX EX %d", resource_z.ptr, token_z.ptr, ttl_seconds);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const r = @as(*c.redisReply, @ptrCast(@alignCast(reply)));

        // Check if SET succeeded (returns "OK" if lock acquired, nil if already locked)
        if (r.type == c.REDIS_REPLY_STATUS and std.mem.eql(u8, r.str[0..2], "OK")) {
            return try self.allocator.dupe(u8, token);
        }

        return null; // Lock already held
    }

    // Release lock only if token matches (to prevent releasing someone else's lock)
    pub fn releaseLock(self: *RedisClient, resource: []const u8, token: []const u8) !void {
        const ctx = try self.ensureConnected();

        const resource_z = try self.allocator.dupeZ(u8, resource);
        defer self.allocator.free(resource_z);

        const token_z = try self.allocator.dupeZ(u8, token);
        defer self.allocator.free(token_z);

        // Lua script to atomically check token and delete if match
        const script =
            \\if redis.call("get",KEYS[1]) == ARGV[1] then
            \\    return redis.call("del",KEYS[1])
            \\else
            \\    return 0
            \\end
        ;

        const reply = c.redisCommand(ctx, "EVAL %s 1 %s %s", script.ptr, resource_z.ptr, token_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }
    }

    // Increment counter (for metrics, IDs, etc.)
    pub fn incr(self: *RedisClient, key: []const u8) !i64 {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const reply = c.redisCommand(ctx, "INCR %s", key_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const r = @as(*c.redisReply, @ptrCast(@alignCast(reply)));
        if (r.type != c.REDIS_REPLY_INTEGER) {
            return RedisError.InvalidReply;
        }

        return r.integer;
    }

    // Hash operations (for storing structured data)
    pub fn hset(self: *RedisClient, key: []const u8, field: []const u8, value: []const u8) !void {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const field_z = try self.allocator.dupeZ(u8, field);
        defer self.allocator.free(field_z);

        const reply = c.redisCommand(ctx, "HSET %s %s %b", key_z.ptr, field_z.ptr, value.ptr, value.len);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }
    }

    pub fn hget(self: *RedisClient, key: []const u8, field: []const u8) !?[]const u8 {
        const ctx = try self.ensureConnected();

        const key_z = try self.allocator.dupeZ(u8, key);
        defer self.allocator.free(key_z);

        const field_z = try self.allocator.dupeZ(u8, field);
        defer self.allocator.free(field_z);

        const reply = c.redisCommand(ctx, "HGET %s %s", key_z.ptr, field_z.ptr);
        defer if (reply != null) c.freeReplyObject(reply);

        if (reply == null or ctx.*.err != 0) {
            return RedisError.CommandFailed;
        }

        const r = @as(*c.redisReply, @ptrCast(@alignCast(reply)));
        if (r.type == c.REDIS_REPLY_NIL) {
            return null;
        }

        if (r.type != c.REDIS_REPLY_STRING) {
            return RedisError.InvalidReply;
        }

        const data = r.str[0..@intCast(r.len)];
        return try self.allocator.dupe(u8, data);
    }
};
