/// Client for the Python processor microservice.
/// Uses curl subprocess (same pattern as Stripe) because Zig TLS fails in Docker.
const std = @import("std");
const config_mod = @import("../config.zig");

pub const CountResult = struct {
    pages: i64,
    chars: i64,
    pricing_cents: i64,
    file_type: []const u8,
    method: []const u8,
};

pub const ExtractionResult = struct {
    text: []const u8,
    content_type: []const u8, // "html" or "text"
};

/// Count document pages/chars via Python processor service.
/// Falls back to local estimate on failure.
pub fn countDocument(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    file_path: []const u8,
    original_name: []const u8,
) !CountResult {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/count", .{processor_url});

    std.log.info("Processor: POST {s} file={s}", .{ url, original_name });

    // Use curl to upload file to processor (-f = fail on HTTP 4xx/5xx)
    const auth_header = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(auth_header);
    const file_arg = try std.fmt.allocPrint(allocator, "file=@{s};filename={s}", .{ file_path, original_name });
    defer allocator.free(file_arg);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "120",
            "-X",
            "POST",
            "-H",
            auth_header,
            "-F",
            file_arg,
            url,
        },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    const exited_ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!exited_ok) {
        std.log.err("Processor /count failed, stderr: {s}", .{result.stderr});
        return error.ProcessorCallFailed;
    }

    if (result.stdout.len == 0) {
        std.log.err("Processor /count: empty response", .{});
        return error.InvalidProcessorResponse;
    }

    // Parse JSON response
    const parsed = std.json.parseFromSlice(struct {
        pages: ?i64 = null,
        chars: ?i64 = null,
        pricing_cents: ?i64 = null,
        file_type: ?[]const u8 = null,
        method: ?[]const u8 = null,
    }, allocator, result.stdout, .{ .ignore_unknown_fields = true }) catch {
        std.log.err("Processor /count: invalid JSON response: {s}", .{result.stdout});
        return error.InvalidProcessorResponse;
    };
    defer parsed.deinit();

    return CountResult{
        .pages = parsed.value.pages orelse 0,
        .chars = parsed.value.chars orelse 0,
        .pricing_cents = parsed.value.pricing_cents orelse 0,
        .file_type = try allocator.dupe(u8, parsed.value.file_type orelse "unknown"),
        .method = try allocator.dupe(u8, parsed.value.method orelse "unknown"),
    };
}

/// Translate text via Python processor → DeepL SDK.
pub fn translateText(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    text: []const u8,
    source_lang: []const u8,
    target_lang: []const u8,
    formality: []const u8,
    glossary_id: []const u8,
) ![]const u8 {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/deepl/translate-text", .{processor_url});

    // Build JSON body
    const body = try std.json.stringifyAlloc(allocator, .{
        .text = text,
        .source_lang = source_lang,
        .target_lang = target_lang,
        .formality = formality,
        .glossary_id = glossary_id,
    }, .{});
    defer allocator.free(body);

    const auth_header = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(auth_header);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "120",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            auth_header,
            "-d",
            body,
            url,
        },
    });
    defer allocator.free(result.stderr);

    const exited_ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!exited_ok) {
        allocator.free(result.stdout);
        std.log.err("Processor /deepl/translate-text failed, stderr: {s}", .{result.stderr});
        return error.ProcessorCallFailed;
    }

    const parsed = std.json.parseFromSlice(struct {
        translated_text: ?[]const u8 = null,
    }, allocator, result.stdout, .{ .ignore_unknown_fields = true }) catch {
        allocator.free(result.stdout);
        return error.InvalidProcessorResponse;
    };
    defer parsed.deinit();
    allocator.free(result.stdout);

    if (parsed.value.translated_text) |t| {
        return allocator.dupe(u8, t);
    }
    return error.NoTranslationResult;
}

/// Validate glossary TSV via Python processor.
pub fn validateGlossary(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    tsv_content: []const u8,
    source_lang: []const u8,
    target_lang: []const u8,
) !struct { valid: bool, errors: []const u8 } {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/deepl/glossary/validate", .{processor_url});

    const body = try std.json.stringifyAlloc(allocator, .{
        .tsv_content = tsv_content,
        .source_lang = source_lang,
        .target_lang = target_lang,
    }, .{});
    defer allocator.free(body);

    const auth_hdr = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(auth_hdr);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "30",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            auth_hdr,
            "-d",
            body,
            url,
        },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    const ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok) return error.ProcessorCallFailed;

    const parsed = std.json.parseFromSlice(struct {
        valid: ?bool = null,
        errors: ?[]const []const u8 = null,
    }, allocator, result.stdout, .{ .ignore_unknown_fields = true }) catch {
        return error.InvalidProcessorResponse;
    };
    defer parsed.deinit();

    var error_str: []const u8 = "";
    if (parsed.value.errors) |errs| {
        if (errs.len > 0) {
            error_str = try allocator.dupe(u8, errs[0]);
        }
    }

    return .{
        .valid = parsed.value.valid orelse false,
        .errors = error_str,
    };
}

/// Extract glossary terms via Python processor → GPT-5.4-nano.
pub fn extractTerms(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    source_text: []const u8,
    reference_text: []const u8,
    source_lang: []const u8,
    target_lang: []const u8,
    instructions: []const u8,
) ![]const u8 {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/ai/extract-terms", .{processor_url});

    const body = try std.json.stringifyAlloc(allocator, .{
        .source_text = source_text,
        .reference_text = reference_text,
        .source_lang = source_lang,
        .target_lang = target_lang,
        .instructions = instructions,
    }, .{});
    defer allocator.free(body);

    const auth_h = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(auth_h);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "180",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            auth_h,
            "-d",
            body,
            url,
        },
    });
    defer allocator.free(result.stderr);

    const ok2 = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok2) {
        allocator.free(result.stdout);
        return error.ProcessorCallFailed;
    }

    // Return raw JSON response for caller to parse
    return result.stdout;
}

/// Submit batch term extraction via Python processor.
pub fn submitBatchExtraction(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    chunks_json: []const u8,
) ![]const u8 {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/ai/extract-terms-batch", .{processor_url});

    const batch_auth = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(batch_auth);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "60",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            batch_auth,
            "-d",
            chunks_json,
            url,
        },
    });
    defer allocator.free(result.stderr);

    const ok3 = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok3) {
        allocator.free(result.stdout);
        return error.ProcessorCallFailed;
    }

    return result.stdout;
}

/// Check batch extraction status.
pub fn checkBatch(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    batch_id: []const u8,
) ![]const u8 {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/ai/batch/{s}", .{ processor_url, batch_id });

    const check_auth = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(check_auth);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "30",
            "-H",
            check_auth,
            url,
        },
    });
    defer allocator.free(result.stderr);

    const ok4 = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok4) {
        allocator.free(result.stdout);
        return error.ProcessorCallFailed;
    }

    return result.stdout;
}

/// Extract text locally using system tools (no Python processor needed).
/// PDF → pdftotext, DOCX → unzip + strip XML tags.
pub fn extractTextLocal(
    allocator: std.mem.Allocator,
    file_path: []const u8,
    original_name: []const u8,
) ![]const u8 {
    // Detect file type by extension
    const lower_name = blk: {
        var buf = try allocator.alloc(u8, original_name.len);
        for (original_name, 0..) |c, i| {
            buf[i] = if (c >= 'A' and c <= 'Z') c + 32 else c;
        }
        break :blk buf;
    };
    defer allocator.free(lower_name);

    const is_pdf = std.mem.endsWith(u8, lower_name, ".pdf");
    const is_docx = std.mem.endsWith(u8, lower_name, ".docx");
    const is_doc = std.mem.endsWith(u8, lower_name, ".doc");
    const is_rtf = std.mem.endsWith(u8, lower_name, ".rtf");
    const is_odt = std.mem.endsWith(u8, lower_name, ".odt");

    if (is_pdf) {
        return extractPdfText(allocator, file_path);
    } else if (is_docx or is_odt) {
        return extractDocxText(allocator, file_path, is_odt);
    } else if (is_doc or is_rtf) {
        // Legacy .doc/.rtf: no reliable local tool, return error for processor fallback
        return error.UnsupportedFormat;
    }
    return error.UnsupportedFormat;
}

/// Extract text from PDF using pdftotext (poppler-utils).
fn extractPdfText(allocator: std.mem.Allocator, file_path: []const u8) ![]const u8 {
    std.log.info("extractPdfText: pdftotext {s}", .{file_path});

    const result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "pdftotext",
            "-layout",
            "-enc",
            "UTF-8",
            file_path,
            "-", // output to stdout
        },
        .max_output_bytes = 10 * 1024 * 1024, // 10MB max
    }) catch |err| {
        std.log.warn("pdftotext failed to run: {any}", .{err});
        return error.ExtractionFailed;
    };
    defer allocator.free(result.stderr);

    const ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok) {
        allocator.free(result.stdout);
        std.log.warn("pdftotext exited with error, stderr: {s}", .{result.stderr});
        return error.ExtractionFailed;
    }

    if (result.stdout.len == 0) {
        allocator.free(result.stdout);
        return error.NoTextExtracted;
    }

    // result.stdout is already allocated by the allocator, return it directly
    return result.stdout;
}

/// Extract text from DOCX/ODT by unzipping and stripping XML tags.
fn extractDocxText(allocator: std.mem.Allocator, file_path: []const u8, is_odt: bool) ![]const u8 {
    const xml_path = if (is_odt) "content.xml" else "word/document.xml";
    std.log.info("extractDocxText: unzip -p {s} {s}", .{ file_path, xml_path });

    const result = std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "unzip",
            "-p",
            file_path,
            xml_path,
        },
        .max_output_bytes = 10 * 1024 * 1024,
    }) catch |err| {
        std.log.warn("unzip failed to run: {any}", .{err});
        return error.ExtractionFailed;
    };
    defer allocator.free(result.stderr);

    const ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!ok) {
        allocator.free(result.stdout);
        std.log.warn("unzip exited with error, stderr: {s}", .{result.stderr});
        return error.ExtractionFailed;
    }

    if (result.stdout.len == 0) {
        allocator.free(result.stdout);
        return error.NoTextExtracted;
    }

    // Strip XML tags and normalize whitespace
    const stripped = try stripXmlTags(allocator, result.stdout);
    allocator.free(result.stdout);
    return stripped;
}

/// Strip XML tags from text, keeping content. Normalizes whitespace.
fn stripXmlTags(allocator: std.mem.Allocator, xml: []const u8) ![]const u8 {
    var result = try std.ArrayList(u8).initCapacity(allocator, xml.len / 2);
    errdefer result.deinit();

    var in_tag = false;
    var prev_was_space = true;
    var i: usize = 0;

    while (i < xml.len) {
        const b = xml[i];
        if (b == '<') {
            // Check for paragraph/break tags → add newline
            if (i + 4 < xml.len) {
                const ahead = xml[i..@min(i + 20, xml.len)];
                if (std.mem.startsWith(u8, ahead, "<w:p ") or
                    std.mem.startsWith(u8, ahead, "<w:p>") or
                    std.mem.startsWith(u8, ahead, "<w:p/>") or
                    std.mem.startsWith(u8, ahead, "<text:p ") or
                    std.mem.startsWith(u8, ahead, "<text:p>"))
                {
                    if (result.items.len > 0 and !prev_was_space) {
                        try result.append('\n');
                        prev_was_space = true;
                    }
                } else if (std.mem.startsWith(u8, ahead, "<w:br") or
                    std.mem.startsWith(u8, ahead, "<text:line-break"))
                {
                    try result.append('\n');
                    prev_was_space = true;
                } else if (std.mem.startsWith(u8, ahead, "<w:tab") or
                    std.mem.startsWith(u8, ahead, "<text:tab"))
                {
                    try result.append('\t');
                    prev_was_space = false;
                }
            }
            in_tag = true;
            i += 1;
            continue;
        }
        if (b == '>') {
            in_tag = false;
            i += 1;
            continue;
        }
        if (!in_tag) {
            // Decode common XML entities
            if (b == '&' and i + 1 < xml.len) {
                const remaining = xml[i..@min(i + 10, xml.len)];
                if (std.mem.startsWith(u8, remaining, "&amp;")) {
                    try result.append('&');
                    i += 5;
                    prev_was_space = false;
                    continue;
                } else if (std.mem.startsWith(u8, remaining, "&lt;")) {
                    try result.append('<');
                    i += 4;
                    prev_was_space = false;
                    continue;
                } else if (std.mem.startsWith(u8, remaining, "&gt;")) {
                    try result.append('>');
                    i += 4;
                    prev_was_space = false;
                    continue;
                } else if (std.mem.startsWith(u8, remaining, "&quot;")) {
                    try result.append('"');
                    i += 6;
                    prev_was_space = false;
                    continue;
                } else if (std.mem.startsWith(u8, remaining, "&apos;")) {
                    try result.append('\'');
                    i += 6;
                    prev_was_space = false;
                    continue;
                } else if (std.mem.startsWith(u8, remaining, "&#")) {
                    // Skip numeric entity — find ;
                    var j = i + 2;
                    while (j < xml.len and xml[j] != ';') : (j += 1) {}
                    if (j < xml.len) {
                        i = j + 1;
                    } else {
                        i += 1;
                    }
                    continue;
                }
            }
            // Normal character
            if (b == ' ' or b == '\t' or b == '\n' or b == '\r') {
                if (!prev_was_space and result.items.len > 0) {
                    try result.append(' ');
                    prev_was_space = true;
                }
            } else {
                try result.append(b);
                prev_was_space = false;
            }
        }
        i += 1;
    }

    // Trim trailing whitespace
    while (result.items.len > 0 and (result.items[result.items.len - 1] == ' ' or
        result.items[result.items.len - 1] == '\n' or
        result.items[result.items.len - 1] == '\r'))
    {
        _ = result.pop();
    }

    if (result.items.len == 0) {
        result.deinit();
        return error.NoTextExtracted;
    }

    return try result.toOwnedSlice();
}

/// Extract text with retry (3 attempts, exponential backoff).
pub fn extractTextWithRetry(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    file_path: []const u8,
    original_name: []const u8,
) !ExtractionResult {
    var attempt: u8 = 0;
    while (attempt < 3) : (attempt += 1) {
        if (extractText(allocator, config, file_path, original_name)) |result| {
            return result;
        } else |err| {
            if (attempt < 2) {
                std.log.warn("extractText attempt {d} failed: {any}, retrying...", .{ attempt + 1, err });
                std.time.sleep(200_000_000 * (@as(u64, 1) << @intCast(attempt)));
            } else {
                std.log.err("extractText failed after 3 attempts: {any}", .{err});
                return err;
            }
        }
    }
    return error.ProcessorCallFailed;
}

/// Extract text content from document for display.
/// Returns text + content_type ("html" or "text").
pub fn extractText(
    allocator: std.mem.Allocator,
    config: *const config_mod.Config,
    file_path: []const u8,
    original_name: []const u8,
) !ExtractionResult {
    const processor_url = config.processor_url;
    if (processor_url.len == 0) return error.ProcessorNotConfigured;

    var url_buf: [512]u8 = undefined;
    const url = try std.fmt.bufPrint(&url_buf, "{s}/extract-text", .{processor_url});

    std.log.info("Processor: POST {s} file={s}", .{ url, original_name });

    const auth_header = try std.fmt.allocPrint(allocator, "Authorization: Bearer {s}", .{config.internal_api_key});
    defer allocator.free(auth_header);
    const file_arg = try std.fmt.allocPrint(allocator, "file=@{s};filename={s}", .{ file_path, original_name });
    defer allocator.free(file_arg);

    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "curl",
            "-s",
            "-f",
            "--connect-timeout",
            "10",
            "--max-time",
            "300",
            "-X",
            "POST",
            "-H",
            auth_header,
            "-F",
            file_arg,
            url,
        },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    const exited_ok = switch (result.term) {
        .Exited => |code| code == 0,
        else => false,
    };
    if (!exited_ok) {
        std.log.err("Processor /extract-text failed, stderr: {s}", .{result.stderr});
        return error.ProcessorCallFailed;
    }

    if (result.stdout.len == 0) {
        std.log.err("Processor /extract-text: empty response", .{});
        return error.InvalidProcessorResponse;
    }

    // Parse JSON response
    const parsed = std.json.parseFromSlice(struct {
        text: ?[]const u8 = null,
        length: ?i64 = null,
        content_type: ?[]const u8 = null,
    }, allocator, result.stdout, .{ .ignore_unknown_fields = true }) catch {
        std.log.err("Processor /extract-text: invalid JSON response: {s}", .{result.stdout});
        return error.InvalidProcessorResponse;
    };
    defer parsed.deinit();

    if (parsed.value.text) |text| {
        return ExtractionResult{
            .text = try allocator.dupe(u8, text),
            .content_type = try allocator.dupe(u8, parsed.value.content_type orelse "text"),
        };
    }

    return error.NoTextExtracted;
}
