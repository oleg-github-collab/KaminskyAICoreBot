const std = @import("std");
const tg_client = @import("../telegram/client.zig");
const tg_types = @import("../telegram/types.zig");
const keyboard = @import("../telegram/client.zig");
const db_users = @import("../db/users.zig");
const db_projects = @import("../db/projects_db.zig");
const flow = @import("flow.zig");
const msgs = @import("messages_ua.zig");
const sqlite = @import("../db/sqlite.zig");
const storage = @import("../storage/filesystem.zig");

/// Build the main menu keyboard JSON
fn mainMenuKeyboard(allocator: std.mem.Allocator, mini_app_url: []const u8) ![]const u8 {
    return tg_client.buildKeyboard(allocator, &.{
        &.{
            .{ .text = "📁 Мої проєкти", .callback_data = "menu:projects" },
            .{ .text = "➕ Новий проєкт", .callback_data = "menu:new_project" },
        },
        &.{
            .{ .text = "💬 Написати нам", .callback_data = "menu:chat" },
            .{ .text = "📱 Панель", .web_app_url = mini_app_url },
        },
        &.{
            .{ .text = "❓ Допомога", .callback_data = "menu:help" },
        },
    });
}

/// Build the project menu keyboard JSON
fn projectMenuKeyboard(allocator: std.mem.Allocator, project_id: i64) ![]const u8 {
    _ = project_id;
    return tg_client.buildKeyboard(allocator, &.{
        &.{
            .{ .text = "📤 Вихідні файли", .callback_data = "proj:upload_source" },
            .{ .text = "📥 Референси", .callback_data = "proj:upload_ref" },
        },
        &.{
            .{ .text = "🔍 Створити глосарій", .callback_data = "proj:glossary" },
            .{ .text = "📋 Файли", .callback_data = "proj:files" },
        },
        &.{
            .{ .text = "👥 Команда", .callback_data = "proj:team" },
            .{ .text = "💰 Вартість", .callback_data = "proj:pricing" },
        },
        &.{
            .{ .text = "🔙 Назад", .callback_data = "menu:back" },
        },
    });
}

/// Upload mode keyboard
fn uploadKeyboard(allocator: std.mem.Allocator) ![]const u8 {
    return tg_client.buildKeyboard(allocator, &.{
        &.{
            .{ .text = "✅ Завершити завантаження", .callback_data = "upload:done" },
            .{ .text = "❌ Скасувати", .callback_data = "upload:cancel" },
        },
    });
}

/// Chat mode keyboard
fn chatKeyboard(allocator: std.mem.Allocator) ![]const u8 {
    return tg_client.buildKeyboard(allocator, &.{
        &.{
            .{ .text = "🔙 Повернутись до меню", .callback_data = "menu:back" },
        },
    });
}

/// Handle /start command
pub fn handleStart(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    msg: *const tg_types.Message,
    user: *const db_users.UserRecord,
    admin_chat_id: i64,
    mini_app_url: []const u8,
) !void {
    // Check for deep link: /start invite_CODE
    if (msg.text) |text| {
        if (std.mem.indexOf(u8, text, " ")) |space_idx| {
            const payload = text[space_idx + 1 ..];
            if (std.mem.startsWith(u8, payload, "invite_")) {
                const code = payload[7..];
                try handleJoinInvite(allocator, db, tg, msg.chat.id, user, code);
                return;
            }
        }
    }

    // Set state to idle
    try flow.setUserState(db, user.id, .idle, null);

    // Send welcome
    const kb = try mainMenuKeyboard(allocator, mini_app_url);
    defer allocator.free(kb);
    const resp = try tg.sendMessage(msg.chat.id, msgs.welcome, kb);
    allocator.free(resp);

    // Notify admin about new user (if not admin themselves)
    if (msg.chat.id != admin_chat_id) {
        var notify_buf: [512]u8 = undefined;
        const notify = std.fmt.bufPrint(&notify_buf, "Новий користувач: <b>{s} {s}</b> (@{s})", .{
            user.first_name,
            user.last_name orelse "",
            user.username orelse "---",
        }) catch "New user";
        const n_resp = try tg.sendMessage(admin_chat_id, notify, null);
        allocator.free(n_resp);
    }
}

fn handleJoinInvite(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
    code: []const u8,
) !void {
    const project = try db_projects.getByInviteCode(db, code) orelse {
        const resp = try tg.sendMessage(chat_id, "Посилання недійсне або проєкт не знайдено.", null);
        allocator.free(resp);
        return;
    };

    if (try db_projects.isMember(db, project.id, user.id)) {
        const resp = try tg.sendMessage(chat_id, "Ви вже є учасником цього проєкту.", null);
        allocator.free(resp);
        return;
    }

    try db_projects.addMember(db, project.id, user.id);
    try flow.setUserState(db, user.id, .project_menu, project.id);

    var buf: [256]u8 = undefined;
    const text = std.fmt.bufPrint(&buf, "Ви успішно приєднались до проєкту <b>{s}</b>!", .{project.name}) catch "Joined!";
    const resp = try tg.sendMessage(chat_id, text, null);
    allocator.free(resp);
}

/// Handle callback queries from inline buttons
pub fn handleCallback(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    cbq: *const tg_types.CallbackQuery,
    user: *const db_users.UserRecord,
    admin_chat_id: i64,
    mini_app_url: []const u8,
    bot_username: []const u8,
    data_dir: []const u8,
) !void {
    const data = cbq.data orelse return;

    // Answer callback immediately
    tg.answerCallbackQuery(cbq.id, null) catch {};

    const chat_id = if (cbq.message) |m| m.chat.id else cbq.from.id;

    if (std.mem.eql(u8, data, "menu:projects")) {
        try showProjectsList(allocator, db, tg, chat_id, user);
    } else if (std.mem.eql(u8, data, "menu:new_project")) {
        try flow.setUserState(db, user.id, .creating_project, null);
        const resp = try tg.sendMessage(chat_id, msgs.project_name_prompt, null);
        allocator.free(resp);
    } else if (std.mem.eql(u8, data, "menu:chat")) {
        try flow.setUserState(db, user.id, .chatting, null);
        const kb = try chatKeyboard(allocator);
        defer allocator.free(kb);
        const resp = try tg.sendMessage(chat_id, msgs.chat_mode_started, kb);
        allocator.free(resp);
    } else if (std.mem.eql(u8, data, "menu:help")) {
        const kb = try mainMenuKeyboard(allocator, mini_app_url);
        defer allocator.free(kb);
        const resp = try tg.sendMessage(chat_id, msgs.help, kb);
        allocator.free(resp);
    } else if (std.mem.eql(u8, data, "menu:back")) {
        try flow.setUserState(db, user.id, .idle, null);
        const kb = try mainMenuKeyboard(allocator, mini_app_url);
        defer allocator.free(kb);
        const resp = try tg.sendMessage(chat_id, msgs.choose_action, kb);
        allocator.free(resp);
    } else if (std.mem.startsWith(u8, data, "proj:select:")) {
        const id_str = data[12..];
        const project_id = std.fmt.parseInt(i64, id_str, 10) catch return;
        try selectProject(allocator, db, tg, chat_id, user, project_id);
    } else if (std.mem.eql(u8, data, "proj:upload_source")) {
        const us = try flow.getUserState(db, user.id);
        if (us.project_id) |_| {
            try flow.setUserState(db, user.id, .uploading_source, us.project_id);
            const kb = try uploadKeyboard(allocator);
            defer allocator.free(kb);
            const resp = try tg.sendMessage(chat_id, msgs.upload_source_prompt, kb);
            allocator.free(resp);
        }
    } else if (std.mem.eql(u8, data, "proj:upload_ref")) {
        const us = try flow.getUserState(db, user.id);
        if (us.project_id) |_| {
            try flow.setUserState(db, user.id, .uploading_reference, us.project_id);
            const kb = try uploadKeyboard(allocator);
            defer allocator.free(kb);
            const resp = try tg.sendMessage(chat_id, msgs.upload_reference_prompt, kb);
            allocator.free(resp);
        }
    } else if (std.mem.eql(u8, data, "upload:done")) {
        try handleUploadDone(allocator, db, tg, chat_id, user, mini_app_url);
    } else if (std.mem.eql(u8, data, "upload:cancel")) {
        const us = try flow.getUserState(db, user.id);
        if (us.project_id) |pid| {
            try flow.setUserState(db, user.id, .project_menu, pid);
            try selectProject(allocator, db, tg, chat_id, user, pid);
        } else {
            try flow.setUserState(db, user.id, .idle, null);
            const kb = try mainMenuKeyboard(allocator, mini_app_url);
            defer allocator.free(kb);
            const resp = try tg.sendMessage(chat_id, msgs.choose_action, kb);
            allocator.free(resp);
        }
    } else if (std.mem.eql(u8, data, "proj:team")) {
        try handleTeamInfo(allocator, db, tg, chat_id, user, bot_username);
    } else if (std.mem.eql(u8, data, "proj:pricing")) {
        try handlePricing(allocator, db, tg, chat_id, user);
    } else if (std.mem.eql(u8, data, "proj:glossary")) {
        try handleGlossaryRequest(allocator, db, tg, chat_id, user, admin_chat_id);
    }

    _ = data_dir;
}

fn showProjectsList(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
) !void {
    // Get user's projects
    var stmt = try db.prepare(
        \\SELECT p.id, p.name FROM projects p
        \\JOIN project_members pm ON pm.project_id = p.id
        \\WHERE pm.user_id = ? AND p.is_active = 1
        \\ORDER BY p.created_at DESC LIMIT 10
    );
    defer stmt.deinit();
    try stmt.bindInt(1, user.id);

    var buttons_json = std.ArrayList(u8).init(allocator);
    defer buttons_json.deinit();
    var writer = buttons_json.writer();
    try writer.writeAll("{\"inline_keyboard\":[");

    var count: u32 = 0;
    while (try stmt.step()) {
        const pid = stmt.columnInt(0);
        const pname = stmt.columnText(1) orelse "---";
        if (count > 0) try writer.writeAll(",");
        try writer.writeAll("[{\"text\":");
        try std.json.stringify(pname, .{}, writer);
        try writer.writeAll(",\"callback_data\":\"proj:select:");
        try std.fmt.formatInt(pid, 10, .lower, .{}, writer);
        try writer.writeAll("\"}]");
        count += 1;
    }

    try writer.writeAll(",[{\"text\":\"\\u{1F519} \\u041D\\u0430\\u0437\\u0430\\u0434\",\"callback_data\":\"menu:back\"}]]}");

    if (count == 0) {
        const resp = try tg.sendMessage(chat_id, msgs.no_projects, null);
        allocator.free(resp);
        return;
    }

    const resp = try tg.sendMessage(chat_id, msgs.select_project, buttons_json.items);
    allocator.free(resp);
}

fn selectProject(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
    project_id: i64,
) !void {
    const project = try db_projects.getById(db, project_id) orelse return;

    if (!try db_projects.isMember(db, project_id, user.id)) {
        const resp = try tg.sendMessage(chat_id, msgs.error_not_member, null);
        allocator.free(resp);
        return;
    }

    try flow.setUserState(db, user.id, .project_menu, project_id);

    var buf: [256]u8 = undefined;
    const text = std.fmt.bufPrint(&buf, "<b>Проєкт: {s}</b>\n\nОберіть дію:", .{project.name}) catch "Project selected";

    const kb = try projectMenuKeyboard(allocator, project_id);
    defer allocator.free(kb);
    const resp = try tg.sendMessage(chat_id, text, kb);
    allocator.free(resp);
}

fn handleUploadDone(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
    mini_app_url: []const u8,
) !void {
    const us = try flow.getUserState(db, user.id);
    const pid = us.project_id orelse return;

    const category: []const u8 = if (us.state == .uploading_source) "source" else "reference";

    const stats = try @import("../db/files_db.zig").countByProjectCategory(db, pid, category);

    var price_buf: [16]u8 = undefined;
    const price_str = @import("../processing/pricing.zig").formatEuro(&price_buf, stats.total_price_cents);

    var info_buf: [256]u8 = undefined;
    const info = if (stats.total_chars > 0)
        std.fmt.bufPrint(&info_buf, "Символів: {d}", .{stats.total_chars}) catch ""
    else if (stats.total_pages > 0)
        std.fmt.bufPrint(&info_buf, "Сторінок: {d}", .{stats.total_pages}) catch ""
    else
        "";

    var msg_buf: [512]u8 = undefined;
    const msg = std.fmt.bufPrint(&msg_buf,
        \\Завантаження завершено!
        \\
        \\Отримано файлів: <b>{d}</b>
        \\{s}
        \\
        \\Орієнтовна вартість: <b>€{s}</b>
    , .{ stats.count, info, price_str }) catch "Upload complete!";

    try flow.setUserState(db, user.id, .project_menu, pid);

    const kb = try projectMenuKeyboard(allocator, pid);
    defer allocator.free(kb);
    const resp = try tg.sendMessage(chat_id, msg, kb);
    allocator.free(resp);

    _ = mini_app_url;
}

fn handleTeamInfo(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
    bot_username: []const u8,
) !void {
    const us = try flow.getUserState(db, user.id);
    const pid = us.project_id orelse return;
    const project = try db_projects.getById(db, pid) orelse return;

    var buf: [512]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\<b>Команда проєкту: {s}</b>
        \\
        \\Посилання для запрошення:
        \\https://t.me/{s}?start=invite_{s}
        \\
        \\Надішліть це посилання вашим колегам.
    , .{ project.name, bot_username, project.invite_code }) catch "Team info";

    const resp = try tg.sendMessage(chat_id, text, null);
    allocator.free(resp);
}

fn handlePricing(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
) !void {
    const us = try flow.getUserState(db, user.id);
    const pid = us.project_id orelse return;

    const total_cents = try @import("../db/files_db.zig").totalPriceForProject(db, pid);
    var price_buf: [16]u8 = undefined;
    const price_str = @import("../processing/pricing.zig").formatEuro(&price_buf, total_cents);

    var buf: [256]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\<b>Розрахунок вартості</b>
        \\
        \\Текстові файли: €0.58 за 1800 символів
        \\PDF файли: €0.69 за сторінку
        \\
        \\<b>Загальна вартість: €{s}</b>
    , .{price_str}) catch "Pricing info";

    const resp = try tg.sendMessage(chat_id, text, null);
    allocator.free(resp);
}

fn handleGlossaryRequest(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    chat_id: i64,
    user: *const db_users.UserRecord,
    admin_chat_id: i64,
) !void {
    const us = try flow.getUserState(db, user.id);
    const pid = us.project_id orelse return;
    const project = try db_projects.getById(db, pid) orelse return;

    // Check if there are source and reference files
    const source_stats = try @import("../db/files_db.zig").countByProjectCategory(db, pid, "source");
    const ref_stats = try @import("../db/files_db.zig").countByProjectCategory(db, pid, "reference");

    if (source_stats.count == 0 or ref_stats.count == 0) {
        const resp = try tg.sendMessage(chat_id,
            \\Для створення глосарію потрібні як вихідні файли, так і референсні переклади.
            \\
            \\Будь ласка, завантажте обидва типи файлів.
        , null);
        allocator.free(resp);
        return;
    }

    // Notify admin about glossary request
    var notify_buf: [256]u8 = undefined;
    const notify = std.fmt.bufPrint(&notify_buf, "Запит на глосарій від <b>{s}</b> для проєкту <b>{s}</b>", .{
        user.first_name, project.name,
    }) catch "Glossary request";
    const n_resp = try tg.sendMessage(admin_chat_id, notify, null);
    allocator.free(n_resp);

    var buf: [256]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\Запит на створення глосарію для проєкту <b>{s}</b> отримано!
        \\
        \\Після розрахунку вартості ви отримаєте рахунок на оплату.
        \\Обробка розпочнеться після підтвердження оплати.
    , .{project.name}) catch "Glossary requested";
    const resp = try tg.sendMessage(chat_id, text, null);
    allocator.free(resp);
}
