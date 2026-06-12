const std = @import("std");
const httpz = @import("httpz");
const tg_types = @import("../telegram/types.zig");
const tg_client = @import("../telegram/client.zig");
const db_users = @import("../db/users.zig");
const db_projects = @import("../db/projects_db.zig");
const sqlite = @import("../db/sqlite.zig");
const flow = @import("../bot/flow.zig");
const commands = @import("../bot/commands.zig");
const relay = @import("../bot/relay.zig");
const files_mod = @import("../bot/files.zig");
const workflow = @import("../bot/workflow.zig");
const msgs = @import("../bot/messages_ua.zig");
const config_mod = @import("../config.zig");
const redis_client = @import("../redis/client.zig");
const storage = @import("../storage/filesystem.zig");
const db_files = @import("../db/files_db.zig");
const processor_client = @import("../processing/processor_client.zig");
const pricing = @import("../processing/pricing.zig");

pub const App = struct {
    config: config_mod.Config,
    db: sqlite.Db,
    tg: tg_client.TelegramClient,
    allocator: std.mem.Allocator,
    redis: ?*redis_client.RedisClient,
};

const BALANCE_RETRY_INTERVAL_SECONDS: i64 = 5 * 60;
const MAX_BALANCE_RETRY_COUNT: i64 = 7 * 24 * 12; // 7 days at 5-minute intervals
const DAILY_BALANCE_RETRY_COUNT: i64 = 24 * 12;

/// Global application context, set by main.zig before server starts
pub var app_global: App = undefined;

pub fn app() *App {
    return &app_global;
}

/// Fast best-effort admin notification. Never throws, because callers often use it
/// while already handling another production issue.
pub fn notifyAdmin(text: []const u8) void {
    const a = app();
    const resp = a.tg.sendMessage(a.config.admin_chat_id, text, null) catch |err| {
        std.log.warn("Admin notification failed: {}", .{err});
        return;
    };
    a.allocator.free(resp);
}

fn htmlEscapeAlloc(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var out = std.ArrayList(u8).init(allocator);
    for (input) |ch| {
        switch (ch) {
            '&' => try out.appendSlice("&amp;"),
            '<' => try out.appendSlice("&lt;"),
            '>' => try out.appendSlice("&gt;"),
            '"' => try out.appendSlice("&quot;"),
            '\'' => try out.appendSlice("&#39;"),
            else => try out.append(ch),
        }
    }
    return out.toOwnedSlice();
}

/// POST /webhook handler
pub fn handleWebhook(req: *httpz.Request, res: *httpz.Response) !void {
    handleWebhookImpl(req) catch |err| {
        // Telegram retries on non-200, which would loop on a poisoned update; we deliberately
        // return 200 for processed updates. But we never silently swallow: log full context.
        const body = req.body() orelse "";
        const snippet = body[0..@min(body.len, 500)];
        std.log.err("Webhook error: {} (body_len={d}, snippet={s})", .{ err, body.len, snippet });
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

    if (!a.config.isTelegramUserAllowed(from.id)) {
        const resp = try a.tg.sendMessage(
            msg.chat.id,
            "Доступ до цього бота обмежено. Зверніться до адміністратора, щоб отримати доступ.",
            null,
        );
        a.allocator.free(resp);
        return;
    }

    const user = try db_users.findOrCreate(a.allocator, &a.db, from.id, from.first_name, from.last_name, from.username);

    if (from.id == a.config.admin_chat_id) {
        db_users.setAdmin(&a.db, from.id) catch |e| {
            std.log.err("Failed to set admin flag for user {d}: {}", .{ from.id, e });
        };
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
    const is_admin = msg.chat.id == a.config.admin_chat_id;

    // Non-admin users: simplified routing — chat relay or redirect to app
    if (!is_admin) {
        if (user_state.state == .chatting) {
            try relay.handleClientMessage(
                a.allocator, &a.db, &a.tg,
                a.config.admin_chat_id, msg, &user, user_state.project_id,
            );
        } else if (tg_types.fileId(msg) != null) {
            const kb = try commands.userAppKeyboard(a.allocator, a.config.mini_app_url);
            defer a.allocator.free(kb);
            const resp = try a.tg.sendMessage(msg.chat.id, msgs.use_app_for_files, kb);
            a.allocator.free(resp);
        } else if (msg.text != null) {
            try relay.handleClientMessage(
                a.allocator, &a.db, &a.tg,
                a.config.admin_chat_id, msg, &user, null,
            );
        }
        return;
    }

    // === Admin-only state routing below ===
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
                    try flow.setUserState(&a.db, user.id, .uploading_source, pid);
                    try files_mod.handleFileMessage(
                        a.allocator, &a.db, &a.tg, msg, &user,
                        pid, "source", a.config.data_dir, a.config.admin_chat_id,
                    );
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
    @import("../storage/filesystem.zig").createProjectDirs(a.config.data_dir, project.id) catch |e| {
        std.log.err("Failed to create project dirs for project {d}: {}", .{ project.id, e });
    };

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
    if (!a.config.isTelegramUserAllowed(cbq.from.id)) {
        a.tg.answerCallbackQuery(cbq.id, "Доступ обмежено.") catch |e| {
            std.log.warn("Failed to answer callback query (access denied): {}", .{e});
        };
        return;
    }

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

    // Signature verification is mandatory in production. Startup validation should
    // catch this too, but keep the webhook fail-closed if config drifts at runtime.
    if (a.config.is_production and a.config.stripe_webhook_secret.len == 0) {
        std.log.err("Stripe: webhook secret missing in production; refusing webhook", .{});
        notifyAdmin("Критична помилка: STRIPE_WEBHOOK_SECRET не налаштовано. Stripe webhook відхилено, платні дії не запускатимуться.");
        res.status = 500;
        res.body = "{\"error\":\"stripe webhook secret missing\"}";
        return;
    }

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

    std.log.info("Stripe webhook body received (len={d}): {s}", .{ body.len, body[0..@min(body.len, 2000)] });

    const parsed = std.json.parseFromSlice(struct {
        type: ?[]const u8 = null,
        data: ?struct {
            object: ?struct {
                id: ?[]const u8 = null,
                payment_status: ?[]const u8 = null,
                metadata: ?struct {
                    project_id: ?[]const u8 = null,
                    user_telegram_id: ?[]const u8 = null,
                    invoice_type: ?[]const u8 = null,
                    tier: ?[]const u8 = null,
                } = null,
            } = null,
        } = null,
    }, a.allocator, body, .{ .ignore_unknown_fields = true }) catch |err| {
        std.log.err("Stripe JSON parse error: {} (snippet={s})", .{ err, body[0..@min(body.len, 2000)] });
        logWebhook("stripe", body, "json_parse_error");
        return err;
    };
    defer parsed.deinit();

    const event_type = parsed.value.type orelse {
        std.log.warn("Stripe webhook missing event type", .{});
        logWebhook("stripe", body, "missing_event_type");
        return;
    };
    std.log.info("Stripe event received: {s}", .{event_type});

    if (std.mem.eql(u8, event_type, "checkout.session.completed")) {
        const obj = (parsed.value.data orelse return).object orelse return;
        const session_id = obj.id orelse return;
        const status = obj.payment_status orelse return;

        if (std.mem.eql(u8, status, "paid")) {
            // Mark invoice as paid
            var stmt = try a.db.prepare(
                "UPDATE invoices SET status = 'paid', paid_at = ? WHERE stripe_session_id = ? AND status != 'paid'",
            );
            defer stmt.deinit();
            try stmt.bindInt(1, std.time.timestamp());
            try stmt.bindText(2, session_id);
            try stmt.exec();
            if (a.db.changes() == 0) {
                std.log.info("Stripe session {s} was already processed", .{session_id});
                return;
            }

            const metadata = obj.metadata orelse return;
            const invoice_type = metadata.invoice_type orelse "glossary";

            // Advance workflow based on invoice type
            if (metadata.project_id) |pid_str| {
                const pid = std.fmt.parseInt(i64, pid_str, 10) catch return;

                if (std.mem.eql(u8, invoice_type, "translation")) {
                    // Validate target languages BEFORE charging the worker / spawning anything.
                    if (!validateProjectTargetLanguages(pid)) {
                        markProjectStage(pid, "translation_validation_failed") catch |e| {
                            std.log.err("Failed to mark project {d} translation_validation_failed: {}", .{ pid, e });
                        };
                        std.log.err("Translation target languages invalid for project {d}", .{pid});
                        var vbuf: [320]u8 = undefined;
                        const vmsg = std.fmt.bufPrint(&vbuf,
                            "\u{26A0} Переклад не запущено: невірні цільові мови. Project ID {s}. Перевірте налаштування мов перекладу.",
                            .{pid_str},
                        ) catch "Translation target languages invalid";
                        if (a.tg.sendMessage(a.config.admin_chat_id, vmsg, null)) |resp| {
                            a.allocator.free(resp);
                        } else |e| {
                            std.log.warn("Failed to send validation-failed admin notification: {}", .{e});
                        }
                        return;
                    }

                    const coverage = translationPaymentCoverage(pid) catch |err| {
                        std.log.err("Failed to verify translation payment coverage for project {d}: {}", .{ pid, err });
                        notifyAdmin("Критична помилка: не вдалося перевірити покриття оплати перед стартом перекладу. Worker не запущено.");
                        return;
                    };
                    if (coverage.required_cents <= 0 or coverage.paid_cents < coverage.required_cents) {
                        markProjectStage(pid, "payment_required") catch |e| {
                            std.log.err("Failed to mark project {d} payment_required: {}", .{ pid, e });
                        };
                        var cbuf: [512]u8 = undefined;
                        const cmsg = std.fmt.bufPrint(&cbuf,
                            "Оплату отримано, але вона не покриває поточний обсяг перекладу.\nProject ID: {d}\nОплачено: €{d}.{d:0>2}\nПотрібно: €{d}.{d:0>2}\nПереклад не запущено.",
                            .{
                                pid,
                                @divTrunc(coverage.paid_cents, 100),
                                @mod(coverage.paid_cents, 100),
                                @divTrunc(coverage.required_cents, 100),
                                @mod(coverage.required_cents, 100),
                            },
                        ) catch "Оплата не покриває поточний обсяг перекладу. Переклад не запущено.";
                        notifyAdmin(cmsg);
                        return;
                    }

                    // Translation paid — start background translation processing
                    var ws = try a.db.prepare(
                        "UPDATE projects SET workflow_stage = 'translation_processing', updated_at = ? WHERE id = ?",
                    );
                    defer ws.deinit();
                    try ws.bindInt(1, std.time.timestamp());
                    try ws.bindInt(2, pid);
                    try ws.exec();

                    // Notify admin
                    var buf: [512]u8 = undefined;
                    const notify = std.fmt.bufPrint(&buf,
                        "\u{2705} Оплата за переклад отримана. Запускаю обробку.\nProject ID: {s}\nSession: {s}",
                        .{ pid_str, session_id },
                    ) catch "\u{2705} Translation payment received";
                    const resp = try a.tg.sendMessage(a.config.admin_chat_id, notify, null);
                    a.allocator.free(resp);

                    const user_tg = if (metadata.user_telegram_id) |uid_str|
                        std.fmt.parseInt(i64, uid_str, 10) catch 0
                    else
                        0;
                    // Idempotency + concurrent-worker guard: only spawn if we win the atomic claim.
                    if (claimTranslationWorker(pid)) {
                        startTranslationWorker(pid, user_tg);
                    } else {
                        std.log.info("Translation worker already running for project {d}; skipping spawn", .{pid});
                    }
                } else {
                    // Glossary paid — advance to glossary_paid
                    var ws = try a.db.prepare(
                        "UPDATE projects SET workflow_stage = 'glossary_paid', updated_at = ? WHERE id = ?",
                    );
                    defer ws.deinit();
                    try ws.bindInt(1, std.time.timestamp());
                    try ws.bindInt(2, pid);
                    try ws.exec();

                    // Notify admin
                    var buf: [320]u8 = undefined;
                    const notify = std.fmt.bufPrint(&buf,
                        "\u{2705} Оплата за глосарій отримана!\nProject ID: {s}\nSession: {s}",
                        .{ pid_str, session_id },
                    ) catch "\u{2705} Glossary payment received";
                    const resp = try a.tg.sendMessage(a.config.admin_chat_id, notify, null);
                    a.allocator.free(resp);

                    // Initialize admin workflow (glossary preparation)
                    workflow.initWorkflow(a.allocator, &a.db, &a.tg, pid, a.config.admin_chat_id) catch |err| {
                        std.log.err("Failed to init workflow for project {d}: {}", .{ pid, err });
                    };
                }
            }

            // Notify client
            if (metadata.user_telegram_id) |uid_str| {
                const uid = std.fmt.parseInt(i64, uid_str, 10) catch return;
                const kb = try commands.userAppKeyboard(a.allocator, a.config.mini_app_url);
                defer a.allocator.free(kb);
                const cr = try a.tg.sendMessage(
                    uid,
                    "\u{2705} Оплату успішно отримано. Переклад розпочато.\n\nКоли файли будуть готові, ви отримаєте повідомлення тут і зможете відкрити їх у застосунку.",
                    kb,
                );
                a.allocator.free(cr);
            }
        }
    } else if (std.mem.eql(u8, event_type, "payment_intent.payment_failed") or
        std.mem.eql(u8, event_type, "checkout.session.async_payment_failed") or
        std.mem.eql(u8, event_type, "checkout.session.expired"))
    {
        const obj = (parsed.value.data orelse return).object orelse return;
        var buf: [512]u8 = undefined;
        const metadata = obj.metadata;
        const project_text = if (metadata) |m| m.project_id orelse "unknown" else "unknown";
        const notify = std.fmt.bufPrint(&buf,
            "Stripe повідомив про невдалу/прострочену оплату.\nEvent: {s}\nObject: {s}\nProject ID: {s}",
            .{ event_type, obj.id orelse "unknown", project_text },
        ) catch "Stripe payment failure event";
        notifyAdmin(notify);
    } else {
        // Stripe sends many event types; we only act on checkout.session.completed.
        std.log.info("Stripe event '{s}' ignored (no handler)", .{event_type});
    }
}

/// Persist a webhook for forensic/debugging purposes. Best-effort: never throws.
fn logWebhook(kind: []const u8, body: []const u8, parse_error: []const u8) void {
    const a = app();
    var stmt = a.db.prepare(
        "INSERT INTO webhook_logs (type, received_at, raw_body, parse_error) VALUES (?, ?, ?, ?)",
    ) catch |e| {
        std.log.err("logWebhook prepare failed: {}", .{e});
        return;
    };
    defer stmt.deinit();
    stmt.bindText(1, kind) catch {};
    stmt.bindInt(2, std.time.timestamp()) catch {};
    stmt.bindText(3, body[0..@min(body.len, 8000)]) catch {};
    stmt.bindText(4, parse_error) catch {};
    stmt.exec() catch |e| {
        std.log.err("logWebhook insert failed: {}", .{e});
    };
}

// ─── Translation Background Processing ───────────────────────────────────────

const SourceFile = struct {
    id: i64,
    original_name: []const u8,
    storage_path: []const u8,
    char_count: i64,
    page_count: i64,
};

const TranslationJobRef = struct {
    id: i64,
    status: []const u8,
    result_file_id: i64,
};

/// Atomically claim the per-project worker slot. Returns true only if THIS caller flipped
/// translation_worker_running 0 -> 1 (i.e. no other worker is already running for the project).
fn claimTranslationWorker(project_id: i64) bool {
    const a = app();
    var stmt = a.db.prepare(
        "UPDATE projects SET translation_worker_running = 1 WHERE id = ? AND translation_worker_running = 0",
    ) catch |e| {
        std.log.err("claimTranslationWorker prepare failed for project {d}: {}", .{ project_id, e });
        return false;
    };
    defer stmt.deinit();
    stmt.bindInt(1, project_id) catch |e| {
        std.log.err("claimTranslationWorker bind failed for project {d}: {}", .{ project_id, e });
        return false;
    };
    stmt.exec() catch |e| {
        std.log.err("claimTranslationWorker exec failed for project {d}: {}", .{ project_id, e });
        return false;
    };
    return a.db.changes() == 1;
}

/// Release the per-project worker slot. Must run on EVERY worker exit (success or error).
fn releaseTranslationWorker(project_id: i64) void {
    const a = app();
    var stmt = a.db.prepare(
        "UPDATE projects SET translation_worker_running = 0 WHERE id = ?",
    ) catch |e| {
        std.log.err("releaseTranslationWorker prepare failed for project {d}: {}", .{ project_id, e });
        return;
    };
    defer stmt.deinit();
    stmt.bindInt(1, project_id) catch |e| {
        std.log.err("releaseTranslationWorker bind failed for project {d}: {}", .{ project_id, e });
        return;
    };
    stmt.exec() catch |e| {
        std.log.err("releaseTranslationWorker exec failed for project {d}: {}", .{ project_id, e });
    };
}

/// Validate a project's target languages before charging/spawning. Keeps it simple+safe:
/// requires at least one non-empty target and each must be a known language name (LANG_MAP set).
fn validateProjectTargetLanguages(project_id: i64) bool {
    const a = app();
    var arena_state = std.heap.ArenaAllocator.init(a.allocator);
    defer arena_state.deinit();
    const allocator = arena_state.allocator();

    const project = db_projects.getById(allocator, &a.db, project_id) catch |e| {
        std.log.err("validateProjectTargetLanguages: getById failed for project {d}: {}", .{ project_id, e });
        return false;
    } orelse return false;

    const targets = splitTargetLanguages(allocator, project.target_lang) catch return false;
    if (targets.len == 0) return false;
    for (targets) |t| {
        if (t.len == 0) return false;
        if (!isKnownLanguage(t)) {
            std.log.warn("Unknown target language '{s}' for project {d}", .{ t, project_id });
            return false;
        }
    }
    return true;
}

/// Known languages accepted by the translation provider. Mirrors the Python LANG_MAP: accept
/// both full names (what the Mini App stores) and the short ISO codes (table default / bot flow).
fn isKnownLanguage(name: []const u8) bool {
    const known = [_][]const u8{
        // Full names
        "Ukrainian",  "German",     "English",    "Russian",     "Polish",
        "French",     "Spanish",    "Italian",    "Portuguese",  "Dutch",
        "Czech",      "Swedish",    "Danish",     "Finnish",     "Hungarian",
        "Romanian",   "Bulgarian",  "Slovak",     "Slovenian",   "Croatian",
        "Estonian",   "Latvian",    "Lithuanian", "Greek",       "Japanese",
        "Simplified Chinese", "Traditional Chinese", "Traditional Chinese (Hong Kong)",
        "Korean",     "Arabic",     "Turkish",
        // Short codes
        "uk", "de", "en", "ru", "pl", "fr", "es", "it", "pt", "nl",
        "cs", "sv", "da", "fi", "hu", "ro", "bg", "sk", "sl", "hr",
        "et", "lv", "lt", "el", "ja", "zh", "zh-cn", "zh-tw", "zh-hk",
        "ko", "ar", "tr",
    };
    for (known) |k| {
        if (std.ascii.eqlIgnoreCase(name, k)) return true;
    }
    return false;
}

/// Spawn the background worker. Caller MUST have already claimed the worker slot via
/// claimTranslationWorker(). On spawn failure the slot is released here.
fn startTranslationWorker(project_id: i64, user_telegram_id: i64) void {
    const thread = std.Thread.spawn(.{}, translationWorker, .{ project_id, user_telegram_id }) catch |err| {
        const a = app();
        std.log.err("Failed to spawn translation worker for project {d}: {}", .{ project_id, err });
        releaseTranslationWorker(project_id);
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "Не вдалося запустити фоновий переклад для Project ID {d}: {}", .{ project_id, err }) catch "Failed to spawn translation worker";
        if (a.tg.sendMessage(a.config.admin_chat_id, msg, null)) |resp| {
            a.allocator.free(resp);
        } else |e| {
            std.log.warn("Failed to send worker-spawn-failure admin notification: {}", .{e});
        }
        return;
    };
    thread.detach();
}

fn translationWorker(project_id: i64, user_telegram_id: i64) void {
    // Always release the worker slot on exit (success OR error) so the project is never
    // permanently stuck as "running".
    defer releaseTranslationWorker(project_id);

    processProjectTranslations(project_id, user_telegram_id) catch |err| {
        const a = app();
        if (err == error.PaymentRequired) {
            std.log.warn("Translation worker refused unpaid/underpaid project {d}", .{project_id});
            return;
        }
        if (err == error.WaitingForCredits) {
            std.log.info("Translation worker paused for credits, project {d}", .{project_id});
            markProjectStage(project_id, "translation_processing") catch |e| {
                std.log.err("Failed to mark project {d} translation_processing (waiting credits): {}", .{ project_id, e });
            };
            return;
        }
        if (err == error.OTranslatorInvalidModel) {
            std.log.err("Translation model validation failed for project {d}", .{project_id});
            markProjectStage(project_id, "translation_processing") catch |e| {
                std.log.err("Failed to mark project {d} translation_processing (invalid model): {}", .{ project_id, e });
            };
            const msg = "Налаштована модель перекладу недоступна. Оновіть OTRANSLATOR_MODEL на точне значення зі списку моделей і перезапустіть переклад.";
            if (a.tg.sendMessage(a.config.admin_chat_id, msg, null)) |resp| {
                a.allocator.free(resp);
            } else |e| {
                std.log.warn("Failed to send invalid-model admin notification: {}", .{e});
            }
            return;
        }
        std.log.err("Translation worker failed for project {d}: {}", .{ project_id, err });
        markProjectStage(project_id, "translation_processing") catch |e| {
            std.log.err("Failed to mark project {d} translation_processing (worker failed): {}", .{ project_id, e });
        };
        var buf: [512]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "Помилка перекладу Project ID {d}: {}", .{ project_id, err }) catch "Translation worker failed";
        if (a.tg.sendMessage(a.config.admin_chat_id, msg, null)) |resp| {
            a.allocator.free(resp);
        } else |e| {
            std.log.warn("Failed to send worker-failure admin notification: {}", .{e});
        }
    };
}

pub fn recoverPendingTranslations() !void {
    const a = app();
    var arena_state = std.heap.ArenaAllocator.init(a.allocator);
    defer arena_state.deinit();
    const allocator = arena_state.allocator();

    // After a (re)start no worker threads exist, so any leftover "running" flag is stale.
    // Clear them so the atomic claim below can succeed.
    a.db.exec("UPDATE projects SET translation_worker_running = 0") catch |e| {
        std.log.err("Failed to reset stale translation_worker_running flags: {}", .{e});
    };

    const RecoveryProject = struct {
        id: i64,
        telegram_id: i64,
    };

    const now = std.time.timestamp();
    const stale_before = now - 1500;

    var stmt = try a.db.prepare(
        \\SELECT p.id, COALESCE(u.telegram_id, 0)
        \\FROM projects p
        \\JOIN users u ON u.id = p.owner_id
        \\WHERE p.is_active = 1
        \\  AND p.workflow_stage IN ('translation_paid', 'translation_processing', 'translation_review')
        \\  AND (
        \\      NOT EXISTS (
        \\          SELECT 1 FROM translation_jobs j0 WHERE j0.project_id = p.id
        \\      )
        \\      OR EXISTS (
        \\          SELECT 1 FROM translation_jobs j1
        \\          WHERE j1.project_id = p.id
        \\            AND j1.status IN ('pending', 'processing', 'waiting_credits')
        \\      )
        \\      OR EXISTS (
        \\          SELECT 1 FROM translation_jobs j2
        \\          WHERE j2.project_id = p.id
        \\            AND j2.status IN ('processing', 'waiting_credits', 'external_timeout_pending')
        \\            AND COALESCE(j2.last_state_change, 0) < ?
        \\            AND (
        \\                j2.status != 'waiting_credits'
        \\                OR COALESCE(j2.balance_retry_count, 0) <= ?
        \\            )
        \\      )
        \\  )
        \\ORDER BY p.updated_at ASC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, stale_before);
    try stmt.bindInt(2, MAX_BALANCE_RETRY_COUNT);

    var projects = std.ArrayList(RecoveryProject).init(allocator);
    while (try stmt.step()) {
        try projects.append(.{
            .id = stmt.columnInt(0),
            .telegram_id = stmt.columnInt(1),
        });
    }

    if (projects.items.len == 0) {
        return;
    }

    std.log.warn("Recovering {d} pending translation project(s)", .{projects.items.len});
    const admin_msg = try std.fmt.allocPrint(
        allocator,
        "Після старту сервера відновлюю незавершені переклади: {d} проєкт(ів).",
        .{projects.items.len},
    );
    if (a.tg.sendMessage(a.config.admin_chat_id, admin_msg, null)) |resp| {
        a.allocator.free(resp);
    } else |err| {
        std.log.warn("Failed to send translation recovery admin notification: {}", .{err});
    }

    for (projects.items) |project| {
        // Same atomic claim as the Stripe path so we never start two workers per project.
        if (claimTranslationWorker(project.id)) {
            startTranslationWorker(project.id, project.telegram_id);
        } else {
            std.log.info("Recovery: worker already running for project {d}; skipping", .{project.id});
        }
    }
}

fn processProjectTranslations(project_id: i64, user_telegram_id: i64) !void {
    const a = app();
    var arena_state = std.heap.ArenaAllocator.init(a.allocator);
    defer arena_state.deinit();
    const allocator = arena_state.allocator();

    const coverage = try translationPaymentCoverage(project_id);
    if (coverage.required_cents <= 0 or coverage.paid_cents < coverage.required_cents) {
        try markProjectStage(project_id, "payment_required");
        var buf: [512]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf,
            "Переклад заблоковано без достатньої оплати.\nProject ID: {d}\nОплачено: €{d}.{d:0>2}\nПотрібно: €{d}.{d:0>2}",
            .{
                project_id,
                @divTrunc(coverage.paid_cents, 100),
                @mod(coverage.paid_cents, 100),
                @divTrunc(coverage.required_cents, 100),
                @mod(coverage.required_cents, 100),
            },
        ) catch "Переклад заблоковано без достатньої оплати.";
        notifyAdmin(msg);
        return error.PaymentRequired;
    }

    const project = try db_projects.getById(allocator, &a.db, project_id) orelse return error.ProjectNotFound;
    const targets = try splitTargetLanguages(allocator, project.target_lang);
    const files = try loadSourceFiles(allocator, project_id);
    if (files.len == 0) {
        return error.NoSourceFiles;
    }
    const glossary_name: []const u8 = if (project.use_glossary) a.config.otranslator_glossary_name else "";
    try ensureTranslationJobs(allocator, project, files, targets, glossary_name);

    for (targets) |target_lang| {
        for (files) |source_file| {
            {
                var job_arena_state = std.heap.ArenaAllocator.init(a.allocator);
                defer job_arena_state.deinit();
                processOneTranslation(job_arena_state.allocator(), project, source_file, target_lang, user_telegram_id) catch |err| {
                    // Credits/model errors must propagate so the worker pauses/retries the
                    // whole project. Any other per-file failure is recorded on the job (errdefer
                    // marked it 'failed') and we continue so remaining files still get translated.
                    if (err == error.WaitingForCredits or err == error.OTranslatorInvalidModel) {
                        return err;
                    }
                    std.log.err("Translation job failed for project {d}, file '{s}', lang {s}: {}", .{ project_id, source_file.original_name, target_lang, err });
                };
            }
        }
    }

    // If any job is still pending on the provider (external_timeout_pending), don't finalize:
    // leave the project in translation_processing so the recovery/poll loop reconciles it.
    const pending_count = countPendingJobs(project_id) catch |e| blk: {
        std.log.err("Failed to count pending jobs for project {d}: {}", .{ project_id, e });
        break :blk 0;
    };
    if (pending_count > 0) {
        try markProjectStage(project_id, "translation_processing");
        std.log.warn("Project {d} has {d} job(s) pending on provider; deferring completion", .{ project_id, pending_count });
        return;
    }

    // Partial-failure: if any job is 'failed', mark the project completed_with_errors and
    // notify the admin with the per-file error messages instead of silently "completed".
    const failed_count = countFailedJobs(project_id) catch |e| blk: {
        std.log.err("Failed to count failed jobs for project {d}: {}", .{ project_id, e });
        break :blk 0;
    };
    if (failed_count > 0) {
        try markProjectStage(project_id, "completed_with_errors");
        const report = buildFailedJobsReport(allocator, project_id, project.name) catch |e| rblk: {
            std.log.err("Failed to build failed-jobs report for project {d}: {}", .{ project_id, e });
            break :rblk "";
        };
        if (report.len > 0) {
            if (a.tg.sendMessage(a.config.admin_chat_id, report, null)) |resp| {
                a.allocator.free(resp);
            } else |e| {
                std.log.warn("Failed to send completed_with_errors admin notification: {}", .{e});
            }
        }
    } else {
        try markProjectStage(project_id, "completed");
    }

    if (user_telegram_id != 0) {
        const kb = try commands.userAppKeyboard(allocator, a.config.mini_app_url);
        defer allocator.free(kb);
        const done = try std.fmt.allocPrint(
            allocator,
            "Готово. Переклад замовлення <b>{s}</b> завершено.\n\nФайли доступні в застосунку у вкладці «Файли», а також у повідомленнях вище.",
            .{project.name},
        );
        defer allocator.free(done);
        const resp = try a.tg.sendMessage(user_telegram_id, done, kb);
        a.allocator.free(resp);
    }

    const audit = try loadTranslationAudit(project_id);
    const admin_msg = try std.fmt.allocPrint(
        allocator,
        "Переклад завершено: <b>{s}</b> (Project ID {d})\nФактичне списання: {d:.2} кредитів, токенів: {d}",
        .{ project.name, project_id, audit.used_credits, audit.token_count },
    );
    const admin_resp = try a.tg.sendMessage(a.config.admin_chat_id, admin_msg, null);
    a.allocator.free(admin_resp);
}

fn processOneTranslation(
    allocator: std.mem.Allocator,
    project: db_projects.ProjectRecord,
    source_file: SourceFile,
    target_lang: []const u8,
    user_telegram_id: i64,
) !void {
    const a = app();
    const glossary_name: []const u8 = if (project.use_glossary) a.config.otranslator_glossary_name else "";
    const job = try getOrCreateTranslationJob(allocator, project.id, source_file.id, project.source_lang, target_lang, glossary_name);
    if (std.mem.eql(u8, job.status, "completed") and job.result_file_id > 0) {
        return;
    }

    const job_id = job.id;
    var leave_waiting_for_credits = false;
    var leave_external_pending = false;
    var job_error_recorded = false;
    errdefer if (!leave_waiting_for_credits and !leave_external_pending and !job_error_recorded) {
        updateTranslationJobError(job_id, "Не вдалося завершити переклад.") catch |e| {
            std.log.err("errdefer: failed to mark job {d} failed: {}", .{ job_id, e });
        };
    };

    const description = try std.fmt.allocPrint(
        allocator,
        "Project: {s}. Translate professionally, preserve meaning, terminology, numbers, formatting, and legal/technical consistency.",
        .{project.name},
    );

    updateTranslationJobStatus(job_id, "processing") catch |e| {
        std.log.err("Failed to mark job {d} processing: {}", .{ job_id, e });
    };

    const raw_json = processor_client.translateDocumentUltra(
        allocator,
        &a.config,
        source_file.storage_path,
        source_file.original_name,
        project.source_lang,
        target_lang,
        glossary_name,
        description,
        a.config.otranslator_model,
    ) catch |err| {
        if (err == error.OTranslatorInsufficientBalance) {
            const retry_count = updateTranslationJobWaitingCredits(job_id) catch 0;
            if (shouldSendBalanceRetryNotification(retry_count)) {
                sendInsufficientCreditsAdminNotification(
                    allocator,
                    project.id,
                    job_id,
                    source_file.original_name,
                    target_lang,
                    retry_count,
                ) catch |e| {
                    std.log.warn("Failed to prepare insufficient-credits admin notification: {}", .{e});
                    notifyAdmin("Недостатньо OTranslator credits. Поповніть баланс; система повторює переклад автоматично.");
                };
            }
            if (retry_count > 0 and retry_count <= MAX_BALANCE_RETRY_COUNT) {
                // Durable retry: job is persisted as 'waiting_credits' with next_retry_at set;
                // the background poll loop (main.zig) will reprocess it. No detached sleeper.
                leave_waiting_for_credits = true;
                return error.WaitingForCredits;
            }
            updateTranslationJobError(job_id, "Не вдалося дочекатися поповнення кредитів.") catch |e| {
                std.log.err("Failed to mark job {d} failed (credits exhausted): {}", .{ job_id, e });
            };
            notifyAdmin("Не вдалося дочекатися поповнення OTranslator credits після 7 днів автоповторів. Перевірте чергу перекладів вручну.");
            job_error_recorded = true;
            return err;
        }
        if (err == error.OTranslatorInvalidModel) {
            updateTranslationJobError(job_id, "Налаштована модель перекладу недоступна. Адміністратор має оновити конфігурацію.") catch |e| {
                std.log.err("Failed to mark job {d} failed (invalid model): {}", .{ job_id, e });
            };
            job_error_recorded = true;
            return err;
        }
        if (err == error.OTranslatorTimeout) {
            // Provider may still finish — keep the job recoverable instead of blind-failing it.
            markTranslationJobExternalTimeout(job_id) catch |e| {
                std.log.err("Failed to mark job {d} external_timeout_pending: {}", .{ job_id, e });
            };
            leave_external_pending = true;
            std.log.warn("Translation timed out for project {d} file '{s}' lang {s}; marked external_timeout_pending", .{ project.id, source_file.original_name, target_lang });
            return err;
        }
        updateTranslationJobError(job_id, "Сервіс перекладу не повернув готовий переклад.") catch |e| {
            std.log.err("Failed to mark job {d} failed (processor error): {}", .{ job_id, e });
        };
        job_error_recorded = true;
        return err;
    };

    const Parsed = struct {
        filename: []const u8,
        content_base64: []const u8,
        size: ?i64 = null,
        taskId: ?[]const u8 = null,
        tokenCount: ?i64 = null,
        price: ?f64 = null,
        usedCredits: ?f64 = null,
    };
    const parsed = std.json.parseFromSlice(Parsed, allocator, raw_json, .{ .ignore_unknown_fields = true }) catch |err| {
        updateTranslationJobError(job_id, "Невірна відповідь сервісу обробки.") catch |e| {
            std.log.err("Failed to mark job {d} failed (bad processor JSON): {}", .{ job_id, e });
        };
        job_error_recorded = true;
        return err;
    };
    defer parsed.deinit();

    const translated_bytes = try decodeBase64Alloc(allocator, parsed.value.content_base64);
    const result_file_id = try storeTranslatedFile(
        allocator,
        project.id,
        project.owner_id,
        source_file,
        target_lang,
        parsed.value.filename,
        translated_bytes,
    );

    try finishTranslationJob(
        job_id,
        result_file_id,
        parsed.value.taskId orelse "",
        parsed.value.tokenCount orelse 0,
        parsed.value.price orelse 0,
        parsed.value.usedCredits orelse 0,
    );

    if (user_telegram_id != 0) {
        sendTranslatedDocumentToUser(project.name, target_lang, user_telegram_id, result_file_id) catch |err| {
            std.log.warn("Failed to send translated document to user {d}: {}", .{ user_telegram_id, err });
        };
    }
}

fn splitTargetLanguages(allocator: std.mem.Allocator, raw: []const u8) ![]const []const u8 {
    var out = std.ArrayList([]const u8).init(allocator);
    var parts = std.mem.splitScalar(u8, raw, ',');
    while (parts.next()) |part| {
        const trimmed = std.mem.trim(u8, part, &std.ascii.whitespace);
        if (trimmed.len > 0) {
            try out.append(try allocator.dupe(u8, trimmed));
        }
    }
    if (out.items.len == 0) {
        try out.append(try allocator.dupe(u8, "Ukrainian"));
    }
    return out.toOwnedSlice();
}

const TranslationCoverage = struct {
    paid_cents: i64,
    required_cents: i64,
};

fn translationPaymentCoverage(project_id: i64) !TranslationCoverage {
    return .{
        .paid_cents = try paidTranslationAmountCents(project_id),
        .required_cents = try currentTranslationPriceCents(project_id),
    };
}

fn paidTranslationAmountCents(project_id: i64) !i64 {
    const a = app();
    var stmt = try a.db.prepare(
        \\SELECT COALESCE(SUM(amount_cents), 0)
        \\FROM invoices
        \\WHERE project_id = ?
        \\  AND status = 'paid'
        \\  AND COALESCE(invoice_type, 'translation') = 'translation'
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) return stmt.columnInt(0);
    return 0;
}

fn currentTranslationPriceCents(project_id: i64) !i64 {
    const a = app();
    var arena_state = std.heap.ArenaAllocator.init(a.allocator);
    defer arena_state.deinit();
    const allocator = arena_state.allocator();

    const project = try db_projects.getById(allocator, &a.db, project_id) orelse return error.ProjectNotFound;
    const target_count = countTargetLanguages(project.target_lang);
    const has_glossary = a.config.otranslator_glossary_name.len > 0 and project.use_glossary;

    var stmt = try a.db.prepare(
        "SELECT original_name, char_count, page_count FROM files WHERE project_id = ? AND category = 'source'",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    var one_target_total: i64 = 0;
    while (try stmt.step()) {
        const file_name = stmt.columnText(0) orelse "";
        const chars = stmt.columnInt(1);
        const pages = stmt.columnInt(2);
        one_target_total += pricing.priceForFile(file_name, pricing.effectiveChars(chars, pages), has_glossary);
    }

    return one_target_total * target_count;
}

fn countTargetLanguages(raw: []const u8) i64 {
    var count: i64 = 0;
    var parts = std.mem.splitScalar(u8, raw, ',');
    while (parts.next()) |part| {
        const trimmed = std.mem.trim(u8, part, &std.ascii.whitespace);
        if (trimmed.len > 0) count += 1;
    }
    return if (count > 0) count else 1;
}

fn countFailedJobs(project_id: i64) !i64 {
    const a = app();
    var stmt = try a.db.prepare(
        "SELECT COUNT(*) FROM translation_jobs WHERE project_id = ? AND status = 'failed'",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) return stmt.columnInt(0);
    return 0;
}

fn countPendingJobs(project_id: i64) !i64 {
    const a = app();
    var stmt = try a.db.prepare(
        "SELECT COUNT(*) FROM translation_jobs WHERE project_id = ? AND status IN ('pending', 'processing', 'waiting_credits', 'external_timeout_pending')",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) return stmt.columnInt(0);
    return 0;
}

fn countWaitingCreditJobs(project_id: i64) !i64 {
    const a = app();
    var stmt = try a.db.prepare(
        "SELECT COUNT(*) FROM translation_jobs WHERE project_id = ? AND status = 'waiting_credits'",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) return stmt.columnInt(0);
    return 0;
}

fn countAllWaitingCreditJobs() !i64 {
    const a = app();
    var stmt = try a.db.prepare("SELECT COUNT(*) FROM translation_jobs WHERE status = 'waiting_credits'");
    defer stmt.deinit();
    if (try stmt.step()) return stmt.columnInt(0);
    return 0;
}

fn shouldSendBalanceRetryNotification(retry_count: i64) bool {
    if (retry_count <= 0) return false;
    if (retry_count == 1 or retry_count == 6 or retry_count == 12) return true;
    if (@mod(retry_count, DAILY_BALANCE_RETRY_COUNT) == 0) return true;
    return retry_count == MAX_BALANCE_RETRY_COUNT;
}

fn fetchOTranslatorBalanceText(allocator: std.mem.Allocator) ![]const u8 {
    const a = app();
    const raw = processor_client.fetchJsonEndpoint(allocator, &a.config, "/ultra/balance") catch |err| {
        std.log.warn("Failed to fetch OTranslator balance for admin notification: {}", .{err});
        return try std.fmt.allocPrint(allocator, "невідомо ({s})", .{@errorName(err)});
    };
    defer allocator.free(raw);

    const parsed = std.json.parseFromSlice(struct {
        balance: ?f64 = null,
    }, allocator, raw, .{ .ignore_unknown_fields = true }) catch |err| {
        std.log.warn("Failed to parse OTranslator balance response: {}", .{err});
        return allocator.dupe(u8, "невідомо (некоректна відповідь OTranslator)");
    };
    defer parsed.deinit();

    if (parsed.value.balance) |balance| {
        return try std.fmt.allocPrint(allocator, "{d:.2} credits", .{balance});
    }
    return allocator.dupe(u8, "невідомо (поле balance відсутнє)");
}

fn sendInsufficientCreditsAdminNotification(
    allocator: std.mem.Allocator,
    project_id: i64,
    job_id: i64,
    source_file_name: []const u8,
    target_lang: []const u8,
    retry_count: i64,
) !void {
    const escaped_file = try htmlEscapeAlloc(allocator, source_file_name);
    const escaped_lang = try htmlEscapeAlloc(allocator, target_lang);
    const balance_text = try fetchOTranslatorBalanceText(allocator);
    const project_waiting = countWaitingCreditJobs(project_id) catch |err| blk: {
        std.log.warn("Failed to count waiting-credit jobs for project {d}: {}", .{ project_id, err });
        break :blk -1;
    };
    const all_waiting = countAllWaitingCreditJobs() catch |err| blk: {
        std.log.warn("Failed to count all waiting-credit jobs: {}", .{err});
        break :blk -1;
    };

    const queue_text = if (project_waiting >= 0 and all_waiting >= 0)
        try std.fmt.allocPrint(allocator, "{d} / {d}", .{ project_waiting, all_waiting })
    else
        try allocator.dupe(u8, "невідомо");

    const note = try std.fmt.allocPrint(
        allocator,
        "<b>Недостатньо OTranslator credits</b>\nProject ID: {d}\nJob ID: {d}\nФайл: <b>{s}</b>\nМова: <b>{s}</b>\nПоточний баланс: <b>{s}</b>\nЧерга waiting credits проєкт/усього: <b>{s}</b>\nСпроба: {d}/{d}\n\nДія: поповніть credits в OTranslator:\nhttps://otranslator.com/en/pricing\n\nПісля поповнення система автоматично повторює кожні 5 хвилин. Користувач повторно не платить; переклад буде доставлено після готовності.",
        .{
            project_id,
            job_id,
            escaped_file,
            escaped_lang,
            balance_text,
            queue_text,
            retry_count,
            MAX_BALANCE_RETRY_COUNT,
        },
    );
    notifyAdmin(note);
}

/// Build an admin-facing report listing failed files and their error messages.
/// Returned slice is owned by `allocator` (caller passes the worker arena, freed on return).
fn buildFailedJobsReport(allocator: std.mem.Allocator, project_id: i64, project_name: []const u8) ![]const u8 {
    const a = app();
    var stmt = try a.db.prepare(
        \\SELECT COALESCE(f.original_name, ''), j.target_lang, COALESCE(j.error_message, '')
        \\FROM translation_jobs j
        \\LEFT JOIN files f ON f.id = j.source_file_id
        \\WHERE j.project_id = ? AND j.status = 'failed'
        \\ORDER BY j.id ASC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    var buf = std.ArrayList(u8).init(allocator);
    try buf.writer().print(
        "\u{26A0} Переклад завершено з помилками: <b>{s}</b> (Project ID {d}).\nНе вдалося перекласти файли:",
        .{ project_name, project_id },
    );
    while (try stmt.step()) {
        const fname = stmt.columnText(0) orelse "";
        const tlang = stmt.columnText(1) orelse "";
        const emsg = stmt.columnText(2) orelse "";
        try buf.writer().print("\n• <b>{s}</b> [{s}]: {s}", .{ fname, tlang, emsg });
    }
    return buf.toOwnedSlice();
}

fn loadSourceFiles(allocator: std.mem.Allocator, project_id: i64) ![]SourceFile {
    const a = app();
    var stmt = try a.db.prepare(
        "SELECT id, original_name, storage_path, char_count, page_count FROM files WHERE project_id = ? AND category = 'source' ORDER BY created_at ASC",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);

    var files = std.ArrayList(SourceFile).init(allocator);
    while (try stmt.step()) {
        try files.append(.{
            .id = stmt.columnInt(0),
            .original_name = try allocator.dupe(u8, stmt.columnText(1) orelse ""),
            .storage_path = try allocator.dupe(u8, stmt.columnText(2) orelse ""),
            .char_count = stmt.columnInt(3),
            .page_count = stmt.columnInt(4),
        });
    }
    return files.toOwnedSlice();
}

fn ensureTranslationJobs(
    allocator: std.mem.Allocator,
    project: db_projects.ProjectRecord,
    files: []SourceFile,
    targets: []const []const u8,
    glossary_name: []const u8,
) !void {
    for (targets) |target_lang| {
        for (files) |source_file| {
            _ = try getOrCreateTranslationJob(
                allocator,
                project.id,
                source_file.id,
                project.source_lang,
                target_lang,
                glossary_name,
            );
        }
    }
}

fn getOrCreateTranslationJob(allocator: std.mem.Allocator, project_id: i64, source_file_id: i64, source_lang: []const u8, target_lang: []const u8, glossary_name: []const u8) !TranslationJobRef {
    const a = app();
    var existing = try a.db.prepare(
        \\SELECT id, status, COALESCE(result_file_id, 0)
        \\FROM translation_jobs
        \\WHERE project_id = ? AND source_file_id = ? AND target_lang = ?
        \\ORDER BY id DESC
        \\LIMIT 1
    );
    defer existing.deinit();
    try existing.bindInt(1, project_id);
    try existing.bindInt(2, source_file_id);
    try existing.bindText(3, target_lang);
    if (try existing.step()) {
        return .{
            .id = existing.columnInt(0),
            .status = try allocator.dupe(u8, existing.columnText(1) orelse "processing"),
            .result_file_id = existing.columnInt(2),
        };
    }

    var stmt = try a.db.prepare(
        \\INSERT INTO translation_jobs
        \\  (project_id, source_file_id, status, source_lang, target_lang, glossary_id, formality, created_at, translation_tier)
        \\VALUES (?, ?, 'pending', ?, ?, ?, 'default', ?, 'otranslator')
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, source_file_id);
    try stmt.bindText(3, source_lang);
    try stmt.bindText(4, target_lang);
    try stmt.bindText(5, glossary_name);
    try stmt.bindInt(6, std.time.timestamp());
    try stmt.exec();
    return .{
        .id = a.db.lastInsertRowId(),
        .status = try allocator.dupe(u8, "pending"),
        .result_file_id = 0,
    };
}

fn updateTranslationJobStatus(job_id: i64, status: []const u8) !void {
    const a = app();
    var stmt = try a.db.prepare("UPDATE translation_jobs SET status = ?, last_state_change = ? WHERE id = ?");
    defer stmt.deinit();
    try stmt.bindText(1, status);
    try stmt.bindInt(2, std.time.timestamp());
    try stmt.bindInt(3, job_id);
    try stmt.exec();
}

/// Persist the external (provider) task id as soon as it is known so a timed-out / interrupted
/// job can be reconciled later.
fn setTranslationJobExternalTaskId(job_id: i64, task_id: []const u8) !void {
    if (task_id.len == 0) return;
    const a = app();
    var stmt = try a.db.prepare("UPDATE translation_jobs SET external_task_id = ?, last_state_change = ? WHERE id = ?");
    defer stmt.deinit();
    try stmt.bindText(1, task_id);
    try stmt.bindInt(2, std.time.timestamp());
    try stmt.bindInt(3, job_id);
    try stmt.exec();
}

/// Mark a job as timed out on the provider side without losing it: it may still complete
/// remotely, so we keep it recoverable rather than blindly failing it.
fn markTranslationJobExternalTimeout(job_id: i64) !void {
    const a = app();
    const now = std.time.timestamp();
    var stmt = try a.db.prepare(
        \\UPDATE translation_jobs
        \\SET status = 'external_timeout_pending',
        \\    next_retry_at = ?,
        \\    last_state_change = ?
        \\WHERE id = ?
    );
    defer stmt.deinit();
    try stmt.bindInt(1, now + BALANCE_RETRY_INTERVAL_SECONDS);
    try stmt.bindInt(2, now);
    try stmt.bindInt(3, job_id);
    try stmt.exec();
}

fn updateTranslationJobWaitingCredits(job_id: i64) !i64 {
    const a = app();
    const now = std.time.timestamp();
    var upd = try a.db.prepare(
        \\UPDATE translation_jobs
        \\SET status = 'waiting_credits',
        \\    balance_retry_count = COALESCE(balance_retry_count, 0) + 1,
        \\    last_balance_retry_at = ?,
        \\    next_retry_at = ?,
        \\    last_state_change = ?
        \\WHERE id = ?
    );
    defer upd.deinit();
    try upd.bindInt(1, now);
    try upd.bindInt(2, now + BALANCE_RETRY_INTERVAL_SECONDS);
    try upd.bindInt(3, now);
    try upd.bindInt(4, job_id);
    try upd.exec();

    var sel = try a.db.prepare("SELECT COALESCE(balance_retry_count, 0) FROM translation_jobs WHERE id = ?");
    defer sel.deinit();
    try sel.bindInt(1, job_id);
    if (try sel.step()) return sel.columnInt(0);
    return 0;
}

fn updateTranslationJobError(job_id: i64, message: []const u8) !void {
    const a = app();
    var stmt = try a.db.prepare("UPDATE translation_jobs SET status = 'failed', error_message = ?, next_retry_at = 0, last_state_change = ? WHERE id = ?");
    defer stmt.deinit();
    try stmt.bindText(1, message);
    try stmt.bindInt(2, std.time.timestamp());
    try stmt.bindInt(3, job_id);
    try stmt.exec();
}

fn finishTranslationJob(job_id: i64, result_file_id: i64, task_id: []const u8, actual_token_count: i64, actual_price_credits: f64, actual_used_credits: f64) !void {
    // Wrap the completion write in a transaction with a few retries: under WAL + busy_timeout
    // SQLITE_BUSY is rare, but a transient lock here would otherwise leave a finished
    // translation marked 'processing' forever. The wrapper surfaces busy as a generic error,
    // so we retry on any error and only give up (returning it) after 3 attempts.
    var attempt: u8 = 0;
    while (true) : (attempt += 1) {
        finishTranslationJobOnce(job_id, result_file_id, task_id, actual_token_count, actual_price_credits, actual_used_credits) catch |err| {
            if (attempt + 1 < 3) {
                std.log.warn("finishTranslationJob attempt {d} failed for job {d}: {}; retrying", .{ attempt + 1, job_id, err });
                std.time.sleep(100_000_000 * (@as(u64, 1) << @intCast(attempt))); // 100ms,200ms
                continue;
            }
            std.log.err("finishTranslationJob failed for job {d} after {d} attempts: {}", .{ job_id, attempt + 1, err });
            return err;
        };
        return;
    }
}

fn finishTranslationJobOnce(job_id: i64, result_file_id: i64, task_id: []const u8, actual_token_count: i64, actual_price_credits: f64, actual_used_credits: f64) !void {
    const a = app();
    try a.db.exec("BEGIN IMMEDIATE");
    errdefer a.db.exec("ROLLBACK") catch |e| {
        std.log.err("finishTranslationJob ROLLBACK failed for job {d}: {}", .{ job_id, e });
    };

    var stmt = try a.db.prepare(
        "UPDATE translation_jobs SET status = 'completed', result_file_id = ?, deepl_document_id = ?, external_task_id = ?, actual_token_count = ?, actual_price_credits = ?, actual_used_credits = ?, completed_at = ?, next_retry_at = 0, last_state_change = ? WHERE id = ?",
    );
    defer stmt.deinit();
    const now = std.time.timestamp();
    try stmt.bindInt(1, result_file_id);
    try stmt.bindText(2, task_id);
    try stmt.bindText(3, task_id);
    try stmt.bindInt(4, actual_token_count);
    try stmt.bindReal(5, actual_price_credits);
    try stmt.bindReal(6, actual_used_credits);
    try stmt.bindInt(7, now);
    try stmt.bindInt(8, now);
    try stmt.bindInt(9, job_id);
    try stmt.exec();

    try a.db.exec("COMMIT");
}

fn loadTranslationAudit(project_id: i64) !struct { token_count: i64, price_credits: f64, used_credits: f64 } {
    const a = app();
    var stmt = try a.db.prepare(
        \\SELECT COALESCE(SUM(actual_token_count), 0),
        \\       COALESCE(SUM(actual_price_credits), 0),
        \\       COALESCE(SUM(actual_used_credits), 0)
        \\FROM translation_jobs
        \\WHERE project_id = ? AND status = 'completed'
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) {
        return .{
            .token_count = stmt.columnInt(0),
            .price_credits = stmt.columnReal(1),
            .used_credits = stmt.columnReal(2),
        };
    }
    return .{ .token_count = 0, .price_credits = 0, .used_credits = 0 };
}

// ─── Durable Retry Poll Loop ─────────────────────────────────────────────────
//
// Replaces the old detached per-job sleeper. main.zig spawns exactly ONE of these after
// startup. Every 60s it scans for jobs that are due for retry (status='waiting_credits' OR
// 'external_timeout_pending', next_retry_at in (0, now]) and re-runs the owning project's
// worker via the same atomic claim used everywhere else. waiting_credits jobs remain durable
// for 7 days so a later OTranslator top-up can resume and deliver already-paid orders.

const RETRY_POLL_INTERVAL_NS: u64 = 60 * 1_000_000_000;

/// Spawn the single background retry poll thread. Safe to call once from main.zig.
pub fn startRetryPollLoop() void {
    const thread = std.Thread.spawn(.{}, retryPollLoop, .{}) catch |err| {
        std.log.err("Failed to spawn retry poll loop: {}", .{err});
        return;
    };
    thread.detach();
}

fn retryPollLoop() void {
    while (true) {
        std.Thread.sleep(RETRY_POLL_INTERVAL_NS);
        pollAndReprocessRetries() catch |err| {
            std.log.err("Retry poll loop iteration failed: {}", .{err});
        };
    }
}

fn pollAndReprocessRetries() !void {
    const a = app();
    var arena_state = std.heap.ArenaAllocator.init(a.allocator);
    defer arena_state.deinit();
    const allocator = arena_state.allocator();

    const now = std.time.timestamp();

    // Cap balance waits after 7 days. Provider timeouts are kept recoverable because the
    // upstream task may still complete and can be reconciled by a later retry.
    {
        var exhaust = try a.db.prepare(
            \\UPDATE translation_jobs
            \\SET status = 'failed',
            \\    error_message = 'Не вдалося дочекатися поповнення OTranslator credits протягом 7 днів.',
            \\    next_retry_at = 0,
            \\    last_state_change = ?
            \\WHERE status = 'waiting_credits'
            \\  AND COALESCE(balance_retry_count, 0) > ?
        );
        defer exhaust.deinit();
        try exhaust.bindInt(1, now);
        try exhaust.bindInt(2, MAX_BALANCE_RETRY_COUNT);
        try exhaust.exec();
        const exhausted = a.db.changes();
        if (exhausted > 0) {
            var buf: [256]u8 = undefined;
            const msg = std.fmt.bufPrint(&buf,
                "OTranslator credits не поповнено протягом 7 днів: {d} job(s) переведено в failed. Потрібна перевірка адміністратором.",
                .{exhausted},
            ) catch "Автоматичні повторні спроби перекладу вичерпано.";
            notifyAdmin(msg);
        }
    }

    const RetryProject = struct { id: i64, telegram_id: i64 };

    var stmt = try a.db.prepare(
        \\SELECT DISTINCT p.id, COALESCE(u.telegram_id, 0)
        \\FROM translation_jobs j
        \\JOIN projects p ON p.id = j.project_id
        \\JOIN users u ON u.id = p.owner_id
        \\WHERE j.status IN ('waiting_credits', 'external_timeout_pending')
        \\  AND COALESCE(j.next_retry_at, 0) > 0
        \\  AND COALESCE(j.next_retry_at, 0) <= ?
        \\  AND (
        \\      j.status != 'waiting_credits'
        \\      OR COALESCE(j.balance_retry_count, 0) <= ?
        \\  )
        \\ORDER BY p.id ASC
    );
    defer stmt.deinit();
    try stmt.bindInt(1, now);
    try stmt.bindInt(2, MAX_BALANCE_RETRY_COUNT);

    var projects = std.ArrayList(RetryProject).init(allocator);
    while (try stmt.step()) {
        try projects.append(.{ .id = stmt.columnInt(0), .telegram_id = stmt.columnInt(1) });
    }

    for (projects.items) |p| {
        if (claimTranslationWorker(p.id)) {
            std.log.info("Retry poll: reprocessing project {d}", .{p.id});
            startTranslationWorker(p.id, p.telegram_id);
        }
    }
}

fn markProjectStage(project_id: i64, stage: []const u8) !void {
    const a = app();
    var stmt = try a.db.prepare("UPDATE projects SET workflow_stage = ?, updated_at = ? WHERE id = ?");
    defer stmt.deinit();
    try stmt.bindText(1, stage);
    try stmt.bindInt(2, std.time.timestamp());
    try stmt.bindInt(3, project_id);
    try stmt.exec();
}

fn storeTranslatedFile(
    allocator: std.mem.Allocator,
    project_id: i64,
    owner_id: i64,
    source_file: SourceFile,
    target_lang: []const u8,
    api_filename: []const u8,
    translated_bytes: []const u8,
) !i64 {
    const a = app();
    try storage.createProjectDirs(a.config.data_dir, project_id);

    const result_name = if (api_filename.len > 0)
        api_filename
    else
        try std.fmt.allocPrint(allocator, "{s}_{s}", .{ target_lang, source_file.original_name });
    const safe_name = try sanitizeTelegramFilename(allocator, result_name);

    var random_bytes: [4]u8 = undefined;
    std.crypto.random.bytes(&random_bytes);
    var random_buf: [8]u8 = undefined;
    const random_hex = try std.fmt.bufPrint(&random_buf, "{}", .{std.fmt.fmtSliceHexLower(&random_bytes)});
    const stored_name = try std.fmt.allocPrint(allocator, "{d}_{s}_{s}", .{
        std.time.timestamp(),
        random_hex,
        safe_name,
    });

    var path_buf: [1024]u8 = undefined;
    const store_path = try storage.filePath(&path_buf, a.config.data_dir, project_id, "translated", stored_name);
    try storage.atomicWrite(store_path, translated_bytes);

    if (translated_bytes.len > std.math.maxInt(i64)) return error.FileTooLarge;
    const stored_size: i64 = @intCast(translated_bytes.len);

    return db_files.store(
        &a.db,
        project_id,
        owner_id,
        stored_name,
        safe_name,
        null,
        stored_size,
        "translated",
        store_path,
        null,
        source_file.char_count,
        source_file.page_count,
        0,
    );
}

fn sendTranslatedDocumentToUser(project_name: []const u8, target_lang: []const u8, user_telegram_id: i64, file_id: i64) !void {
    const a = app();
    var stmt = try a.db.prepare("SELECT original_name, storage_path FROM files WHERE id = ? LIMIT 1");
    defer stmt.deinit();
    try stmt.bindInt(1, file_id);
    if (!(try stmt.step())) return;

    const original_name = stmt.columnText(0) orelse "translated";
    const storage_path = stmt.columnText(1) orelse return;
    const caption = try std.fmt.allocPrint(
        a.allocator,
        "Готовий переклад: <b>{s}</b>\nМова: {s}",
        .{ project_name, target_lang },
    );
    defer a.allocator.free(caption);

    const resp = try a.tg.sendDocument(user_telegram_id, storage_path, original_name, caption);
    a.allocator.free(resp);
}

fn sanitizeTelegramFilename(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var out = std.ArrayList(u8).init(allocator);
    const max_len: usize = 160;
    for (input) |ch| {
        if (out.items.len >= max_len) break;
        switch (ch) {
            '/', '\\', ':', '*', '?', '"', '<', '>', '|' => try out.append('_'),
            0...31 => try out.append('_'),
            else => try out.append(ch),
        }
    }
    if (out.items.len == 0) try out.appendSlice("translated.bin");
    return out.toOwnedSlice();
}

fn decodeBase64Alloc(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    var out = std.ArrayList(u8).init(allocator);
    var quartet: [4]u8 = undefined;
    var q_len: usize = 0;

    for (input) |ch| {
        if (ch == '\n' or ch == '\r' or ch == ' ' or ch == '\t') continue;

        const value: u8 = if (ch >= 'A' and ch <= 'Z')
            ch - 'A'
        else if (ch >= 'a' and ch <= 'z')
            ch - 'a' + 26
        else if (ch >= '0' and ch <= '9')
            ch - '0' + 52
        else if (ch == '+')
            62
        else if (ch == '/')
            63
        else if (ch == '=')
            64
        else
            return error.InvalidBase64;

        quartet[q_len] = value;
        q_len += 1;

        if (q_len == 4) {
            try out.append((quartet[0] << 2) | (quartet[1] >> 4));
            if (quartet[2] != 64) {
                try out.append(((quartet[1] & 0x0F) << 4) | (quartet[2] >> 2));
            }
            if (quartet[3] != 64) {
                try out.append(((quartet[2] & 0x03) << 6) | quartet[3]);
            }
            q_len = 0;
        }
    }

    if (q_len != 0) return error.InvalidBase64;
    return out.toOwnedSlice();
}

// ─── Health Check ──────────────────────────────────────────────────────────────

/// GET /health handler
pub fn handleHealth(_: *httpz.Request, res: *httpz.Response) !void {
    res.status = 200;
    res.body = "{\"status\":\"ok\",\"service\":\"KaminskyAICoreBot\"}";
}
