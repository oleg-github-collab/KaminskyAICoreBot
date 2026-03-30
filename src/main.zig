const std = @import("std");
const httpz = @import("httpz");
const Config = @import("config.zig").Config;
const sqlite = @import("db/sqlite.zig");
const migrations = @import("db/migrations.zig");
const storage = @import("storage/filesystem.zig");
const tg_client = @import("telegram/client.zig");
const handler = @import("webhook/handler.zig");
const miniapp_api = @import("api/miniapp.zig");

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    std.log.info("KaminskyAICoreBot starting...", .{});

    // 1. Load and validate configuration
    const config = Config.load() catch |err| {
        std.log.err("Failed to load config: {}", .{err});
        return err;
    };
    try config.validate();

    // 2. Ensure data directories exist
    storage.ensureDirectories(config.data_dir) catch |err| {
        std.log.err("Failed to create data directories: {}", .{err});
        return err;
    };

    // 3. Initialize SQLite database
    var db_path_buf: [512]u8 = undefined;
    const db_path_len = config.db_path.len;
    @memcpy(db_path_buf[0..db_path_len], config.db_path);
    db_path_buf[db_path_len] = 0;
    const db_path_z: [*:0]const u8 = db_path_buf[0..db_path_len :0];

    var db = sqlite.Db.open(db_path_z) catch |err| {
        std.log.err("Failed to open database: {}", .{err});
        return err;
    };
    defer db.close();

    // Configure SQLite for performance
    db.exec("PRAGMA journal_mode=WAL") catch {};
    db.exec("PRAGMA foreign_keys=ON") catch {};
    db.exec("PRAGMA busy_timeout=5000") catch {};
    db.exec("PRAGMA synchronous=NORMAL") catch {};

    // 4. Run database migrations
    migrations.run(&db) catch |err| {
        std.log.err("Failed to run migrations: {}", .{err});
        return err;
    };
    std.log.info("Database ready", .{});

    // 5. Initialize Telegram client and set webhook
    var tg = tg_client.TelegramClient.init(allocator, config.bot_token);
    tg.setWebhook(config.webhook_url, config.webhook_secret) catch |err| {
        std.log.err("Failed to set webhook: {}", .{err});
        return err;
    };

    // 6. Set admin user
    @import("db/users.zig").setAdmin(&db, config.admin_chat_id) catch {};

    // 7. Store global app context
    handler.app_global = .{
        .config = config,
        .db = db,
        .tg = tg,
        .allocator = allocator,
    };

    // 8. Configure and start HTTP server
    var server = try httpz.Server(void).init(allocator, .{
        .port = config.port,
        .address = "0.0.0.0",
        .request = .{
            .max_body_size = 50 * 1024 * 1024,
            .max_multiform_count = 8,
            .max_form_count = 8,
        },
    }, {});
    defer server.deinit();
    defer server.stop();

    var router = try server.router(.{});

    // Telegram webhook
    router.post("/webhook", handler.handleWebhook, .{});

    // Stripe webhook
    router.post("/stripe-webhook", handler.handleStripeWebhook, .{});

    // Health check
    router.get("/health", handler.handleHealth, .{});

    // Mini App static files (compiled into binary via @embedFile)
    router.get("/app", serveIndex, .{});
    router.get("/app/app.css", serveCSS, .{});
    router.get("/app/app.js", serveAppJS, .{});
    router.get("/app/lib/api-client.js", serveApiClientJS, .{});
    router.get("/app/components/projects.js", serveProjectsJS, .{});
    router.get("/app/components/files.js", serveFilesJS, .{});
    router.get("/app/components/team.js", serveTeamJS, .{});
    router.get("/app/components/glossary.js", serveGlossaryJS, .{});
    router.get("/app/components/pricing.js", servePricingJS, .{});
    router.get("/app/components/messages.js", serveMessagesJS, .{});
    router.get("/app/components/glossary-versions.js", serveGlossaryVersionsJS, .{});
    router.get("/app/components/settings.js", serveSettingsJS, .{});
    router.get("/app/lib/auth.js", serveAuthJS, .{});

    // REST API for Mini App
    router.get("/api/health", handler.handleHealth, .{});
    router.get("/api/projects", miniapp_api.handleProjects, .{});
    router.post("/api/projects", miniapp_api.handleCreateProject, .{});
    router.get("/api/projects/:project_id", miniapp_api.handleGetProject, .{});
    router.get("/api/projects/:project_id/files", miniapp_api.handleListFiles, .{});
    router.post("/api/projects/:project_id/files", miniapp_api.handleUploadFile, .{});
    router.delete("/api/projects/:project_id/files/:file_id", miniapp_api.handleDeleteFile, .{});
    router.get("/api/projects/:project_id/team", miniapp_api.handleListTeam, .{});
    router.post("/api/projects/:project_id/team/invite", miniapp_api.handleCreateInvite, .{});
    router.delete("/api/projects/:project_id/team/:member_id", miniapp_api.handleRemoveMember, .{});
    router.get("/api/projects/:project_id/glossary", miniapp_api.handleListGlossary, .{});
    router.post("/api/projects/:project_id/glossary/approve", miniapp_api.handleApproveGlossary, .{});
    router.post("/api/projects/:project_id/glossary/reject", miniapp_api.handleRejectGlossary, .{});
    router.get("/api/projects/:project_id/glossary/export", miniapp_api.handleExportGlossary, .{});
    router.post("/api/projects/:project_id/glossary/sync", miniapp_api.handleSyncDeepL, .{});
    router.get("/api/projects/:project_id/messages", miniapp_api.handleMessages, .{});
    router.post("/api/projects/:project_id/messages", miniapp_api.handleSendMessage, .{});
    router.get("/api/projects/:project_id/messages/stream", miniapp_api.handleMessageStream, .{});
    router.get("/api/projects/:project_id/pricing", miniapp_api.handlePricing, .{});
    router.get("/api/projects/:project_id/invoices", miniapp_api.handleListInvoices, .{});
    router.post("/api/projects/:project_id/invoices", miniapp_api.handleCreateInvoice, .{});
    router.delete("/api/projects/:project_id", miniapp_api.handleDeleteProject, .{});
    router.get("/api/projects/:project_id/glossary/versions", miniapp_api.handleListGlossaryVersions, .{});
    router.get("/api/projects/:project_id/glossary/versions/:version_id", miniapp_api.handleGetGlossaryVersion, .{});
    router.get("/api/projects/:project_id/glossary/diff", miniapp_api.handleGlossaryDiff, .{});
    router.get("/api/projects/:project_id/settings", miniapp_api.handleGetSettings, .{});
    router.post("/api/projects/:project_id/settings", miniapp_api.handleUpdateSettings, .{});
    router.get("/api/projects/:project_id/workflow", miniapp_api.handleWorkflowStatus, .{});
    router.post("/api/auth/session", miniapp_api.handleCreateSession, .{});

    std.log.info("Server starting on 0.0.0.0:{d}...", .{config.port});
    try server.listen();
}

// Static file handlers — embedded at compile time for zero-cost serving
fn serveIndex(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "text/html; charset=utf-8");
    res.body = @embedFile("web/index.html");
}
fn serveCSS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "text/css; charset=utf-8");
    res.body = @embedFile("web/app.css");
}
fn serveAppJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/app.js");
}
fn serveApiClientJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/lib/api-client.js");
}
fn serveProjectsJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/projects.js");
}
fn serveFilesJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/files.js");
}
fn serveTeamJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/team.js");
}
fn serveGlossaryJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/glossary.js");
}
fn servePricingJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/pricing.js");
}
fn serveMessagesJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/messages.js");
}
fn serveGlossaryVersionsJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/glossary-versions.js");
}
fn serveSettingsJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/components/settings.js");
}
fn serveAuthJS(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.header("Content-Type", "application/javascript; charset=utf-8");
    res.body = @embedFile("web/lib/auth.js");
}
