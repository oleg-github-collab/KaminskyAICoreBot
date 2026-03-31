const std = @import("std");

pub const Config = struct {
    bot_token: []const u8,
    bot_username: []const u8,
    webhook_secret: []const u8,
    webhook_url: []const u8,
    admin_chat_id: i64,
    mini_app_url: []const u8,
    openai_api_key: []const u8,
    deepl_api_key: []const u8,
    stripe_secret_key: []const u8,
    stripe_webhook_secret: []const u8,
    processor_url: []const u8,
    internal_api_key: []const u8,
    redis_url: []const u8,
    port: u16,
    data_dir: []const u8,
    db_path: []const u8,
    is_production: bool,

    pub fn load() !Config {
        const bot_token = std.posix.getenv("BOT_TOKEN") orelse {
            std.log.err("Missing BOT_TOKEN environment variable", .{});
            return error.MissingConfig;
        };
        const admin_str = std.posix.getenv("ADMIN_CHAT_ID") orelse {
            std.log.err("Missing ADMIN_CHAT_ID environment variable", .{});
            return error.MissingConfig;
        };
        const admin_chat_id = std.fmt.parseInt(i64, admin_str, 10) catch {
            std.log.err("ADMIN_CHAT_ID must be a number, got: {s}", .{admin_str});
            return error.InvalidConfig;
        };
        const port_str = std.posix.getenv("PORT") orelse "8080";
        const port = std.fmt.parseInt(u16, port_str, 10) catch 8080;

        return Config{
            .bot_token = bot_token,
            .bot_username = std.posix.getenv("BOT_USERNAME") orelse "KaminskyAICoreBot",
            .webhook_secret = std.posix.getenv("WEBHOOK_SECRET") orelse "dev-secret-change-me",
            .webhook_url = std.posix.getenv("WEBHOOK_URL") orelse "http://localhost:8080/webhook",
            .admin_chat_id = admin_chat_id,
            .mini_app_url = std.posix.getenv("MINI_APP_URL") orelse "http://localhost:8080/app",
            .openai_api_key = std.posix.getenv("OPENAI_API_KEY") orelse "",
            .deepl_api_key = std.posix.getenv("DEEPL_API_KEY") orelse "",
            .stripe_secret_key = std.posix.getenv("STRIPE_SECRET_KEY") orelse "",
            .stripe_webhook_secret = std.posix.getenv("STRIPE_WEBHOOK_SECRET") orelse "",
            .processor_url = std.posix.getenv("PROCESSOR_URL") orelse "http://processor.railway.internal:5000",
            .internal_api_key = std.posix.getenv("INTERNAL_API_KEY") orelse "",
            .redis_url = std.posix.getenv("REDIS_URL") orelse "",
            .port = port,
            .data_dir = std.posix.getenv("DATA_DIR") orelse "/data",
            .db_path = std.posix.getenv("DB_PATH") orelse "/data/db/bot.db",
            .is_production = blk: {
                const env = std.posix.getenv("ENVIRONMENT") orelse "production";
                break :blk !std.mem.eql(u8, env, "development");
            },
        };
    }

    pub fn validate(self: *const Config) !void {
        if (self.bot_token.len == 0) return error.MissingBotToken;
        if (self.admin_chat_id == 0) return error.MissingAdminChatId;
        std.log.info("Config loaded: port={d}, admin_id={d}, production={}", .{
            self.port,
            self.admin_chat_id,
            self.is_production,
        });
    }
};
