const std = @import("std");
const httpz = @import("httpz");
const tg_types = @import("../telegram/types.zig");
const tg_client = @import("../telegram/client.zig");
const db_users = @import("../db/users.zig");
const sqlite = @import("../db/sqlite.zig");
const flow = @import("../bot/flow.zig");
const commands = @import("../bot/commands.zig");
const relay = @import("../bot/relay.zig");
const files_mod = @import("../bot/files.zig");
const workflow = @import("../bot/workflow.zig");
const msgs = @import("../bot/messages_ua.zig");
const config_mod = @import("../config.zig");

pub const App = struct {
    config: config_mod.Config,
    db: sqlite.Db,
    tg: tg_client.TelegramClient,
    allocator: std.mem.Allocator,
};

/// Global application context, set by main.zig before server starts
pub var app_global: App = undefined;

fn app() *App {
    return &app_global;
}

/// POST /webhook handler
pub fn handleWebhook(req: *httpz.Request, res: *httpz.Response) !void {
    handleWebhookImpl(req) catch |err| {
        std.log.err("Webhook error: {}", .{err});
    };
    res.status = 200;
    res.body = "{\"ok\":true}";
}

fn handleWebhookImpl(req: *httpz.Request) !void {
    const a = app();

    // Validate secret token
    const secret_header = req.header("x-telegram-bot-api-secret-token");
    if (secret_header == null or !std.mem.eql(u8, secret_header.?, a.config.webhook_secret)) {
        std.log.warn("Invalid webhook secret", .{});
        return;
    }

    const body = req.body() orelse return;

    const parsed = std.json.parseFromSlice(
        tg_types.Update,
        a.allocator,
        body,
        .{ .ignore_unknown_fields = true },
    ) catch |err| {
        std.log.err("JSON parse error: {}", .{err});
        return;
    };
    defer parsed.deinit();

    const update = &parsed.value;

    if (update.message) |*msg| {
        try handleMessage(a, msg);
    } else if (update.callback_query) |*cbq| {
        try handleCallbackQuery(a, cbq);
    }
}

fn handleMessage(a: *App, msg: *const tg_types.Message) !void {
    const from = msg.from orelse return;

    const user = try db_users.findOrCreate(a.allocator, &a.db, from.id, from.first_name, from.last_name, from.username);

    if (from.id == a.config.admin_chat_id) {
        db_users.setAdmin(&a.db, from.id) catch {};
    }

    // Admin reply forwarding
    if (msg.chat.id == a.config.admin_chat_id) {
        if (msg.reply_to_message) |reply_to| {
            try relay.handleAdminReply(a.allocator, &a.db, &a.tg, msg, reply_to);
            return;
        }
    }

    // Bot commands
    if (msg.text) |text| {
        if (std.mem.startsWith(u8, text, "/start")) {
            try commands.handleStart(a.allocator, &a.db, &a.tg, msg, &user, a.config.admin_chat_id, a.config.mini_app_url);
            return;
        }
        if (std.mem.startsWith(u8, text, "/help")) {
            const resp = try a.tg.sendMessage(msg.chat.id, msgs.help, null);
            a.allocator.free(resp);
            return;
        }
    }

    // State-based routing
    const user_state = try flow.getUserState(&a.db, user.id);

    switch (user_state.state) {
        .creating_project => {
            if (msg.text) |text| {
                try handleCreateProject(a, msg, &user, text);
            }
        },
        .uploading_source, .uploading_reference, .uploading_instructions => {
            if (tg_types.fileId(msg) != null) {
                const category: []const u8 = switch (user_state.state) {
                    .uploading_source => "source",
                    .uploading_instructions => "instructions",
                    else => "reference",
                };
                try files_mod.handleFileMessage(
                    a.allocator, &a.db, &a.tg, msg, &user,
                    user_state.project_id orelse return,
                    category, a.config.data_dir, a.config.admin_chat_id,
                );
            } else {
                try relay.handleClientMessage(
                    a.allocator, &a.db, &a.tg,
                    a.config.admin_chat_id, msg, &user, user_state.project_id,
                );
            }
        },
        .chatting => {
            try relay.handleClientMessage(
                a.allocator, &a.db, &a.tg,
                a.config.admin_chat_id, msg, &user, user_state.project_id,
            );
        },
        .project_menu => {
            if (tg_types.fileId(msg) != null) {
                if (user_state.project_id) |pid| {
                    // Auto-start source file upload
                    try flow.setUserState(&a.db, user.id, .uploading_source, pid);
                    try files_mod.handleFileMessage(
                        a.allocator, &a.db, &a.tg, msg, &user,
                        pid, "source", a.config.data_dir, a.config.admin_chat_id,
                    );
                    // Show upload keyboard for continuing
                    const kb = try commands.uploadKeyboard(a.allocator);
                    defer a.allocator.free(kb);
                    const info_resp = try a.tg.sendMessage(
                        msg.chat.id,
                        "Файл додано як <b>вихідний</b>.\nНадсилайте ще файли або натисніть кнопку нижче.",
                        kb,
                    );
                    a.allocator.free(info_resp);
                } else {
                    const resp = try a.tg.sendMessage(msg.chat.id, msgs.error_no_project, null);
                    a.allocator.free(resp);
                }
            } else if (msg.text != null) {
                try relay.handleClientMessage(
                    a.allocator, &a.db, &a.tg,
                    a.config.admin_chat_id, msg, &user, user_state.project_id,
                );
            }
        },
        else => {
            if (tg_types.fileId(msg) != null) {
                const resp = try a.tg.sendMessage(msg.chat.id, msgs.error_no_project, null);
                a.allocator.free(resp);
            } else if (msg.text != null) {
                try relay.handleClientMessage(
                    a.allocator, &a.db, &a.tg,
                    a.config.admin_chat_id, msg, &user, null,
                );
            }
        },
    }
}

fn handleCreateProject(a: *App, msg: *const tg_types.Message, user: *const db_users.UserRecord, name: []const u8) !void {
    const trimmed = std.mem.trim(u8, name, &std.ascii.whitespace);
    if (trimmed.len == 0 or trimmed.len > 100) {
        const resp = try a.tg.sendMessage(msg.chat.id, "Назва проєкту має бути від 1 до 100 символів.", null);
        a.allocator.free(resp);
        return;
    }

    const project = try @import("../db/projects_db.zig").create(a.allocator, &a.db, user.id, trimmed, "");
    @import("../storage/filesystem.zig").createProjectDirs(a.config.data_dir, project.id) catch {};

    try flow.setUserState(&a.db, user.id, .project_menu, project.id);

    var buf: [512]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\Проєкт <b>{s}</b> створено!
        \\
        \\Наступний крок — завантажте вихідні файли для обробки.
        \\Натисніть «Вихідні файли» нижче.
    , .{trimmed}) catch "OK";

    const kb = try commands.projectMenuKeyboard(a.allocator, project.id);
    defer a.allocator.free(kb);
    const resp = try a.tg.sendMessage(msg.chat.id, text, kb);
    a.allocator.free(resp);
}

fn handleCallbackQuery(a: *App, cbq: *const tg_types.CallbackQuery) !void {
    const user = try db_users.findOrCreate(a.allocator, &a.db, cbq.from.id, cbq.from.first_name, cbq.from.last_name, cbq.from.username);

    try commands.handleCallback(
        a.allocator, &a.db, &a.tg, cbq, &user,
        a.config.admin_chat_id, a.config.mini_app_url, a.config.bot_username, a.config.data_dir,
    );
}

// ─── Stripe Webhook ────────────────────────────────────────────────────────────

/// POST /stripe-webhook — verifies Stripe-Signature HMAC-SHA256 before processing
pub fn handleStripeWebhook(req: *httpz.Request, res: *httpz.Response) !void {
    const a = app();
    const body = req.body() orelse {
        res.status = 400;
        res.body = "{\"error\":\"empty body\"}";
        return;
    };

    // Signature verification is mandatory in production
    if (a.config.stripe_webhook_secret.len > 0) {
        const sig_header = req.header("stripe-signature") orelse {
            std.log.warn("Stripe: missing Stripe-Signature header", .{});
            res.status = 400;
            res.body = "{\"error\":\"missing signature\"}";
            return;
        };
        const verified = verifyStripeSignature(
            a.allocator, sig_header, body, a.config.stripe_webhook_secret,
        ) catch false;
        if (!verified) {
            std.log.warn("Stripe: invalid signature — rejected", .{});
            res.status = 403;
            res.body = "{\"error\":\"invalid signature\"}";
            return;
        }
    }

    handleStripeImpl(body) catch |err| {
        std.log.err("Stripe webhook error: {}", .{err});
        res.status = 500;
        return;
    };
    res.status = 200;
    res.body = "{\"received\":true}";
}

/// Verify Stripe-Signature header using HMAC-SHA256
/// Header format: "t=<unix_timestamp>,v1=<hex_signature>"
/// Implements replay-attack protection (5-minute window)
fn verifyStripeSignature(
    allocator: std.mem.Allocator,
    sig_header: []const u8,
    payload: []const u8,
    secret: []const u8,
) !bool {
    const Hmac = std.crypto.auth.hmac.sha2.HmacSha256;

    var timestamp: ?[]const u8 = null;
    var v1_sig_hex: ?[]const u8 = null;

    var it = std.mem.splitScalar(u8, sig_header, ',');
    while (it.next()) |part| {
        const p = std.mem.trim(u8, part, " ");
        if (std.mem.startsWith(u8, p, "t=")) {
            timestamp = p[2..];
        } else if (std.mem.startsWith(u8, p, "v1=") and v1_sig_hex == null) {
            v1_sig_hex = p[3..];
        }
    }

    const ts = timestamp orelse return false;
    const expected_hex = v1_sig_hex orelse return false;

    // Replay protection: reject events older than 5 minutes
    const ts_int = std.fmt.parseInt(i64, ts, 10) catch return false;
    const now = std.time.timestamp();
    if (@abs(now - ts_int) > 300) {
        std.log.warn("Stripe: timestamp too old (replay protection blocked)", .{});
        return false;
    }

    // Stripe signed_payload = "<timestamp>.<raw_body>"
    const signed_payload = try std.fmt.allocPrint(allocator, "{s}.{s}", .{ ts, payload });
    defer allocator.free(signed_payload);

    // Compute expected HMAC-SHA256
    var mac: [Hmac.mac_length]u8 = undefined;
    Hmac.create(&mac, signed_payload, secret);

    // Encode computed MAC to hex
    var computed_hex_buf: [Hmac.mac_length * 2]u8 = undefined;
    const computed_hex = try std.fmt.bufPrint(&computed_hex_buf, "{}", .{std.fmt.fmtSliceHexLower(&mac)});

    // Constant-time comparison to prevent timing attacks
    if (expected_hex.len != computed_hex.len) return false;
    return std.crypto.utils.timingSafeEql(
        [Hmac.mac_length * 2]u8,
        computed_hex[0..Hmac.mac_length * 2].*,
        expected_hex[0..Hmac.mac_length * 2].*,
    );
}

fn handleStripeImpl(body: []const u8) !void {
    const a = app();

    const parsed = std.json.parseFromSlice(struct {
        type: ?[]const u8 = null,
        data: ?struct {
            object: ?struct {
                id: ?[]const u8 = null,
                payment_status: ?[]const u8 = null,
                metadata: ?struct {
                    project_id: ?[]const u8 = null,
                    user_telegram_id: ?[]const u8 = null,
                } = null,
            } = null,
        } = null,
    }, a.allocator, body, .{ .ignore_unknown_fields = true }) catch return;
    defer parsed.deinit();

    const event_type = parsed.value.type orelse return;
    std.log.info("Stripe event received: {s}", .{event_type});

    if (std.mem.eql(u8, event_type, "checkout.session.completed")) {
        const obj = (parsed.value.data orelse return).object orelse return;
        const session_id = obj.id orelse return;
        const status = obj.payment_status orelse return;

        if (std.mem.eql(u8, status, "paid")) {
            var stmt = try a.db.prepare(
                "UPDATE invoices SET status = 'paid', paid_at = ? WHERE stripe_session_id = ?",
            );
            defer stmt.deinit();
            try stmt.bindInt(1, std.time.timestamp());
            try stmt.bindText(2, session_id);
            try stmt.exec();

            // Notify admin
            var buf: [320]u8 = undefined;
            const notify = std.fmt.bufPrint(&buf,
                "✅ Оплата отримана!\nSession: {s}", .{session_id},
            ) catch "✅ Payment received";
            const resp = try a.tg.sendMessage(a.config.admin_chat_id, notify, null);
            a.allocator.free(resp);

            // Notify client
            const metadata = obj.metadata orelse return;
            if (metadata.user_telegram_id) |uid_str| {
                const uid = std.fmt.parseInt(i64, uid_str, 10) catch return;
                const cr = try a.tg.sendMessage(
                    uid,
                    "✅ Оплату успішно отримано! Дякуємо!\n\nОбробка вашого замовлення розпочинається.",
                    null,
                );
                a.allocator.free(cr);
            }

            // Initialize admin workflow (5-step process)
            if (metadata.project_id) |pid_str| {
                const pid = std.fmt.parseInt(i64, pid_str, 10) catch return;
                workflow.initWorkflow(a.allocator, &a.db, &a.tg, pid, a.config.admin_chat_id) catch |err| {
                    std.log.err("Failed to init workflow for project {d}: {}", .{ pid, err });
                };
            }
        }
    }
}

// ─── Health Check ──────────────────────────────────────────────────────────────

/// GET /health handler
pub fn handleHealth(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.body = "{\"status\":\"ok\",\"service\":\"KaminskyAICoreBot\"}";
}
