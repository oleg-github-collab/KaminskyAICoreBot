const std = @import("std");
const httpz = @import("httpz");
const handler = @import("../webhook/handler.zig");
const miniapp_api = @import("../api/miniapp.zig");

/// Rate limiting middleware using Redis INCR with TTL
/// Limits: 100 requests per minute per user

pub fn rateLimitMiddleware(req: *httpz.Request, res: *httpz.Response) bool {
    const a = handler.app();

    // Skip rate limiting if Redis not available
    if (a.redis == null) {
        return true; // Allow request
    }

    // Extract user ID from auth
    const auth_header = req.header("Authorization");
    if (auth_header == null) {
        // Public endpoints - rate limit by IP
        return rateLimitByIP(req, res, a);
    }

    const user = miniapp_api.authenticateToken(a.allocator, &a.db, auth_header.?) catch {
        return rateLimitByIP(req, res, a);
    };
    defer a.allocator.free(user.first_name);
    defer if (user.last_name) |ln| a.allocator.free(ln);
    defer if (user.username) |un| a.allocator.free(un);

    return rateLimitByUser(user.id, res, a);
}

fn rateLimitByUser(user_id: i64, res: *httpz.Response, a: *handler.App) bool {
    if (a.redis == null) return true;

    const key = std.fmt.allocPrint(
        a.allocator,
        "ratelimit:user:{d}:minute",
        .{user_id},
    ) catch return true;
    defer a.allocator.free(key);

    const allowed = a.redis.?.rateLimit(key, 100, 60) catch {
        std.log.warn("Rate limit check failed, allowing request", .{});
        return true;
    };

    if (!allowed) {
        res.status = 429;
        res.header("Retry-After", "60");
        res.header("Content-Type", "application/json");
        res.body = "{\"error\":\"Занадто багато запитів. Спробуйте через хвилину.\"}";
        std.log.warn("Rate limit exceeded: user {d}", .{user_id});
        return false;
    }

    return true;
}

fn rateLimitByIP(req: *httpz.Request, res: *httpz.Response, a: *handler.App) bool {
    if (a.redis == null) return true;

    // Try to get real IP from X-Forwarded-For header (Railway/Cloudflare)
    const ip = req.header("X-Forwarded-For") orelse
        req.header("X-Real-IP") orelse
        "unknown";

    const key = std.fmt.allocPrint(
        a.allocator,
        "ratelimit:ip:{s}:minute",
        .{ip},
    ) catch return true;
    defer a.allocator.free(key);

    // More restrictive for unauthenticated: 30 req/min
    const allowed = a.redis.?.rateLimit(key, 30, 60) catch return true;

    if (!allowed) {
        res.status = 429;
        res.header("Retry-After", "60");
        res.header("Content-Type", "application/json");
        res.body = "{\"error\":\"Занадто багато запитів. Спробуйте через хвилину.\"}";
        std.log.warn("Rate limit exceeded: IP {s}", .{ip});
        return false;
    }

    return true;
}
