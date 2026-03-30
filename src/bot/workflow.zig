/// Admin 5-step workflow state machine.
/// Steps: UPLOAD_SUMMARY → GLOSSARY_CREATION → CLIENT_CONFIRMATION → TRANSLATION_REVIEW → DELIVERY
const std = @import("std");
const tg_client = @import("../telegram/client.zig");
const sqlite = @import("../db/sqlite.zig");
const msgs = @import("messages_ua.zig");
const pricing = @import("../processing/pricing.zig");
const db_files = @import("../db/files_db.zig");

pub const StepType = enum {
    upload_summary,
    glossary_creation,
    client_confirmation,
    translation_review,
    delivery,
};

pub const StepStatus = enum {
    pending,
    in_progress,
    completed,
    rejected,
};

fn stepTypeStr(s: StepType) []const u8 {
    return switch (s) {
        .upload_summary => "upload_summary",
        .glossary_creation => "glossary_creation",
        .client_confirmation => "client_confirmation",
        .translation_review => "translation_review",
        .delivery => "delivery",
    };
}

fn stepStatusStr(s: StepStatus) []const u8 {
    return switch (s) {
        .pending => "pending",
        .in_progress => "in_progress",
        .completed => "completed",
        .rejected => "rejected",
    };
}

/// Initialize workflow after payment is received.
/// Creates step 1 (UPLOAD_SUMMARY) and notifies admin.
pub fn initWorkflow(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    project_id: i64,
    admin_chat_id: i64,
) !void {
    const now = std.time.timestamp();

    // Create step 1
    var stmt = try db.prepare(
        "INSERT INTO workflow_steps (project_id, step_number, step_type, status, created_at) VALUES (?, 1, 'upload_summary', 'in_progress', ?)",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    try stmt.bindInt(2, now);
    try stmt.exec();

    const step_id = db.lastInsertRowId();

    // Get project info for summary
    var proj_stmt = try db.prepare(
        "SELECT name FROM projects WHERE id = ?",
    );
    defer proj_stmt.deinit();
    try proj_stmt.bindInt(1, project_id);

    var project_name: []const u8 = "---";
    if (try proj_stmt.step()) {
        if (proj_stmt.columnText(0)) |name| {
            project_name = try allocator.dupe(u8, name);
        }
    }

    // Get file stats
    const source_stats = try db_files.countByProjectCategory(db, project_id, "source");
    const ref_stats = try db_files.countByProjectCategory(db, project_id, "reference");

    // Get payment amount
    var inv_stmt = try db.prepare(
        "SELECT SUM(amount_cents) FROM invoices WHERE project_id = ? AND status = 'paid'",
    );
    defer inv_stmt.deinit();
    try inv_stmt.bindInt(1, project_id);
    var paid_cents: i64 = 0;
    if (try inv_stmt.step()) {
        paid_cents = inv_stmt.columnInt(0);
    }

    var price_buf: [16]u8 = undefined;
    const paid_str = pricing.formatEuro(&price_buf, paid_cents);

    // Send admin notification with inline buttons
    var buf: [1024]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\📦 <b>Крок 1/5: Підсумок завантаження</b>
        \\
        \\Проєкт: <b>{s}</b>
        \\
        \\📤 Вихідних файлів: <b>{d}</b>
        \\📥 Референсних файлів: <b>{d}</b>
        \\💰 Сплачено: <b>€{s}</b>
        \\
        \\Підтвердити і перейти до створення глосарію?
    , .{
        project_name,
        source_stats.count,
        ref_stats.count,
        paid_str,
    }) catch "Workflow step 1";

    var kb_buf: [256]u8 = undefined;
    const kb = std.fmt.bufPrint(&kb_buf,
        \\{{"inline_keyboard":[[{{"text":"✅ Підтвердити","callback_data":"wf:approve:1:{d}"}},{{"text":"❌ Відхилити","callback_data":"wf:reject:1:{d}"}}]]}}
    , .{ project_id, project_id }) catch return;

    const resp = try tg.sendMessage(admin_chat_id, text, kb);

    // Store admin message ID for editing later
    if (std.json.parseFromSlice(struct {
        result: ?struct { message_id: ?i64 = null } = null,
    }, allocator, resp, .{ .ignore_unknown_fields = true })) |parsed| {
        defer parsed.deinit();
        if (parsed.value.result) |r| {
            if (r.message_id) |mid| {
                var upd = try db.prepare(
                    "UPDATE workflow_steps SET admin_msg_id = ? WHERE id = ?",
                );
                defer upd.deinit();
                try upd.bindInt(1, mid);
                try upd.bindInt(2, step_id);
                try upd.exec();
            }
        }
    } else |_| {}
    allocator.free(resp);
}

/// Handle admin workflow callback (approve/reject/edit).
pub fn handleAdminAction(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    admin_chat_id: i64,
    action: []const u8,
    step_num_str: []const u8,
    project_id_str: []const u8,
) !void {
    const step_num = std.fmt.parseInt(i32, step_num_str, 10) catch return;
    const project_id = std.fmt.parseInt(i64, project_id_str, 10) catch return;
    const now = std.time.timestamp();

    if (std.mem.eql(u8, action, "approve")) {
        // Complete current step
        var upd = try db.prepare(
            "UPDATE workflow_steps SET status = 'completed', completed_at = ? WHERE project_id = ? AND step_number = ? AND status = 'in_progress'",
        );
        defer upd.deinit();
        try upd.bindInt(1, now);
        try upd.bindInt(2, project_id);
        try upd.bindInt(3, step_num);
        try upd.exec();

        // Advance to next step
        const next_step = step_num + 1;
        if (next_step <= 5) {
            const step_type = switch (next_step) {
                2 => "glossary_creation",
                3 => "client_confirmation",
                4 => "translation_review",
                5 => "delivery",
                else => return,
            };

            var ins = try db.prepare(
                "INSERT INTO workflow_steps (project_id, step_number, step_type, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)",
            );
            defer ins.deinit();
            try ins.bindInt(1, project_id);
            try ins.bindInt(2, next_step);
            try ins.bindText(3, step_type);
            try ins.bindInt(4, now);
            try ins.exec();

            try sendStepNotification(allocator, db, tg, admin_chat_id, project_id, next_step);
        } else {
            // Workflow complete
            var buf: [256]u8 = undefined;
            const text = std.fmt.bufPrint(&buf,
                "✅ <b>Робочий процес завершено для проєкту #{d}!</b>\n\nВсі 5 кроків виконано успішно.",
                .{project_id},
            ) catch "Workflow complete";
            const resp = try tg.sendMessage(admin_chat_id, text, null);
            allocator.free(resp);
        }
    } else if (std.mem.eql(u8, action, "reject")) {
        var upd = try db.prepare(
            "UPDATE workflow_steps SET status = 'rejected', completed_at = ? WHERE project_id = ? AND step_number = ? AND status = 'in_progress'",
        );
        defer upd.deinit();
        try upd.bindInt(1, now);
        try upd.bindInt(2, project_id);
        try upd.bindInt(3, step_num);
        try upd.exec();

        var buf: [256]u8 = undefined;
        const text = std.fmt.bufPrint(&buf,
            "❌ Крок {d}/5 відхилено для проєкту #{d}.",
            .{ step_num, project_id },
        ) catch "Step rejected";
        const resp = try tg.sendMessage(admin_chat_id, text, null);
        allocator.free(resp);
    }
}

fn sendStepNotification(
    allocator: std.mem.Allocator,
    db: *sqlite.Db,
    tg: *tg_client.TelegramClient,
    admin_chat_id: i64,
    project_id: i64,
    step_num: i32,
) !void {
    const step_label = switch (step_num) {
        2 => "Створення глосарію",
        3 => "Підтвердження клієнта",
        4 => "Перегляд перекладу",
        5 => "Доставка клієнту",
        else => "---",
    };

    const step_desc = switch (step_num) {
        2 => "Система створює глосарій на основі вихідних файлів та інструкцій. Перевірте та затвердіть.",
        3 => "Надішліть клієнту підхід та вартість для підтвердження.",
        4 => "Документи перекладено. Перевірте якість перекладу та затвердіть.",
        5 => "Підтвердіть відправку перекладених файлів клієнту.",
        else => "",
    };

    var buf: [512]u8 = undefined;
    const text = std.fmt.bufPrint(&buf,
        \\📋 <b>Крок {d}/5: {s}</b>
        \\Проєкт #{d}
        \\
        \\{s}
    , .{ step_num, step_label, project_id, step_desc }) catch "Next step";

    var kb_buf: [256]u8 = undefined;
    const kb = std.fmt.bufPrint(&kb_buf,
        \\{{"inline_keyboard":[[{{"text":"✅ Підтвердити","callback_data":"wf:approve:{d}:{d}"}},{{"text":"❌ Відхилити","callback_data":"wf:reject:{d}:{d}"}}]]}}
    , .{ step_num, project_id, step_num, project_id }) catch return;

    const resp = try tg.sendMessage(admin_chat_id, text, kb);
    allocator.free(resp);
}

/// Get current workflow step for a project.
pub fn getCurrentStep(db: *sqlite.Db, project_id: i64) !?struct { step_number: i32, step_type: []const u8, status: []const u8 } {
    var stmt = try db.prepare(
        "SELECT step_number, step_type, status FROM workflow_steps WHERE project_id = ? ORDER BY step_number DESC LIMIT 1",
    );
    defer stmt.deinit();
    try stmt.bindInt(1, project_id);
    if (try stmt.step()) {
        return .{
            .step_number = @intCast(stmt.columnInt(0)),
            .step_type = if (stmt.columnText(1)) |t| t else "unknown",
            .status = if (stmt.columnText(2)) |s| s else "unknown",
        };
    }
    return null;
}
