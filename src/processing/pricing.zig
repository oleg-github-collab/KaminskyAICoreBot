/// Pricing module for translation orders.
/// Commercial unit: 1800 billable characters.
const std = @import("std");

pub const CHARS_PER_UNIT: u64 = 1800;
pub const RATE_TEXT_NO_GLOSSARY_CENTS: i64 = 68;
pub const RATE_TEXT_GLOSSARY_CENTS: i64 = 91;
pub const RATE_COMPLEX_GLOSSARY_CENTS: i64 = 135;

pub fn unitsForChars(char_count: u64) u64 {
    if (char_count == 0) return 0;
    return (char_count + CHARS_PER_UNIT - 1) / CHARS_PER_UNIT;
}

/// Calculate price in euro cents for a text file
pub fn priceForChars(char_count: u64) i64 {
    if (char_count == 0) return 0;
    return @intCast(unitsForChars(char_count) * RATE_TEXT_NO_GLOSSARY_CENTS);
}

/// Calculate price in euro cents for a PDF or document.
/// Legacy helper: page_count is treated as 1800-character equivalents.
pub fn priceForPages(page_count: u64) i64 {
    if (page_count == 0) return 0;
    return @intCast(page_count * RATE_COMPLEX_GLOSSARY_CENTS);
}

pub fn effectiveChars(char_count: i64, page_count: i64) u64 {
    const chars: u64 = if (char_count > 0) @intCast(char_count) else 0;
    const pages: u64 = if (page_count > 0) @intCast(page_count) else 0;
    const page_chars = pages * CHARS_PER_UNIT;
    return @max(chars, page_chars);
}

pub fn isComplexOtranslatorFormat(file_name: []const u8) bool {
    const dot_idx = std.mem.lastIndexOfScalar(u8, file_name, '.') orelse return true;
    const ext_raw = file_name[dot_idx..];
    var ext_buf: [16]u8 = undefined;
    const ext_len = @min(ext_raw.len, ext_buf.len);
    for (ext_raw[0..ext_len], 0..) |ch, i| {
        ext_buf[i] = if (ch >= 'A' and ch <= 'Z') ch + 32 else ch;
    }
    const ext = ext_buf[0..ext_len];

    if (std.mem.eql(u8, ext, ".txt") or
        std.mem.eql(u8, ext, ".docx") or
        std.mem.eql(u8, ext, ".md") or
        std.mem.eql(u8, ext, ".rtf"))
    {
        return false;
    }

    return true;
}

pub fn rateForFile(file_name: []const u8, has_glossary: bool) i64 {
    if (isComplexOtranslatorFormat(file_name)) {
        return RATE_COMPLEX_GLOSSARY_CENTS;
    }
    return if (has_glossary) RATE_TEXT_GLOSSARY_CENTS else RATE_TEXT_NO_GLOSSARY_CENTS;
}

pub fn priceForFile(file_name: []const u8, char_count: u64, has_glossary: bool) i64 {
    const units = unitsForChars(char_count);
    if (units == 0) return 0;
    const rate: u64 = @intCast(rateForFile(file_name, has_glossary));
    return @intCast(units * rate);
}

/// Format euro cents as string (e.g. 1234 -> "12.34")
pub fn formatEuro(buf: []u8, cents: i64) []const u8 {
    const c: u64 = @intCast(if (cents < 0) -cents else cents);
    const euros = c / 100;
    const remaining = c % 100;
    const len = std.fmt.bufPrint(buf, "{d}.{d:0>2}", .{ euros, remaining }) catch return "0.00";
    return len;
}

/// Conservative character counting for translation pricing.
/// - Strips UTF-8 BOM
/// - Counts whitespace characters instead of collapsing them
/// - Skips control characters (0x00–0x08, 0x0E–0x1F)
/// - Counts visible Unicode codepoints
/// - Trims leading/trailing whitespace
pub fn countChars(text: []const u8) u64 {
    if (text.len == 0) return 0;

    // Skip UTF-8 BOM (EF BB BF)
    var start: usize = 0;
    if (text.len >= 3 and text[0] == 0xEF and text[1] == 0xBB and text[2] == 0xBF) {
        start = 3;
    }

    var count: u64 = 0;
    var end: usize = text.len;
    while (end > start and isBillableWhitespace(text[end - 1])) : (end -= 1) {}
    while (start < end and isBillableWhitespace(text[start])) : (start += 1) {}

    var i: usize = start;

    while (i < end) {
        const byte = text[i];

        if (byte == '\r' and i + 1 < end and text[i + 1] == '\n') {
            count += 1;
            i += 2;
            continue;
        }

        // Whitespace: space, tab, newline, carriage return, vertical tab, form feed
        if (isBillableWhitespace(byte)) {
            count += 1;
            i += 1;
            continue;
        }

        // Skip control characters (0x00–0x08, 0x0E–0x1F) — not printable
        if (byte < 0x20 and byte != '\t' and byte != '\n' and byte != '\r' and byte != 0x0B and byte != 0x0C) {
            i += 1;
            continue;
        }

        // Count one Unicode codepoint and advance past its UTF-8 bytes
        if (byte < 0x80) {
            // ASCII (single byte)
            count += 1;
            i += 1;
        } else if (byte & 0xE0 == 0xC0) {
            // 2-byte UTF-8
            count += 1;
            i += @min(2, text.len - i);
        } else if (byte & 0xF0 == 0xE0) {
            // 3-byte UTF-8
            count += 1;
            i += @min(3, text.len - i);
        } else if (byte & 0xF8 == 0xF0) {
            // 4-byte UTF-8
            count += 1;
            i += @min(4, text.len - i);
        } else {
            // Invalid / continuation byte — skip
            i += 1;
        }
    }

    return count;
}

fn isBillableWhitespace(byte: u8) bool {
    return byte == ' ' or byte == '\t' or byte == '\n' or byte == '\r' or byte == 0x0B or byte == 0x0C;
}

/// Detect whether file data is actual readable text (not binary/archive/PDF).
/// Returns false for ZIP-based docs (.docx, .xlsx, .pptx, .odt), OLE docs (.doc, .xls),
/// PDFs, and any file with a high ratio of null/control bytes.
pub fn isTextContent(data: []const u8) bool {
    if (data.len == 0) return true;

    // PDF signature: %PDF-
    if (data.len >= 5 and data[0] == '%' and data[1] == 'P' and data[2] == 'D' and data[3] == 'F' and data[4] == '-')
        return false;

    // ZIP signature: PK\x03\x04  → .docx, .xlsx, .pptx, .odt, .zip
    if (data.len >= 4 and data[0] == 0x50 and data[1] == 0x4B and data[2] == 0x03 and data[3] == 0x04)
        return false;

    // OLE2 Compound: D0 CF 11 E0 → .doc, .xls, .ppt (legacy Office)
    if (data.len >= 4 and data[0] == 0xD0 and data[1] == 0xCF and data[2] == 0x11 and data[3] == 0xE0)
        return false;

    // RAR signature
    if (data.len >= 4 and data[0] == 0x52 and data[1] == 0x61 and data[2] == 0x72 and data[3] == 0x21)
        return false;

    // 7z signature
    if (data.len >= 2 and data[0] == 0x37 and data[1] == 0x7A)
        return false;

    // Sample first 1024 bytes: if >10% are null or non-text control chars → binary
    const sample_len = @min(data.len, 1024);
    var binary_count: usize = 0;
    for (data[0..sample_len]) |b| {
        if (b == 0) {
            binary_count += 1;
        } else if (b < 0x09) {
            binary_count += 1;
        } else if (b > 0x0D and b < 0x20 and b != 0x1B) {
            binary_count += 1;
        }
    }
    return (binary_count * 100 / sample_len) < 10;
}

/// Check if file is a PDF by header magic or extension.
pub fn isPdfContent(data: []const u8) bool {
    if (data.len >= 5 and data[0] == '%' and data[1] == 'P' and data[2] == 'D' and data[3] == 'F' and data[4] == '-')
        return true;
    return false;
}

/// Estimate page count for binary document files (.docx, .doc, etc.)
/// Uses format-specific heuristics based on typical text-to-binary ratios.
pub fn estimateDocPages(file_size: u64, filename: []const u8) u64 {
    if (file_size == 0) return 0;

    // Extract and lowercase extension
    var ext_lower: [16]u8 = undefined;
    var ext_len: usize = 0;
    if (std.mem.lastIndexOfScalar(u8, filename, '.')) |dot_idx| {
        const raw_ext = filename[dot_idx..];
        ext_len = @min(raw_ext.len, 16);
        for (0..ext_len) |i| {
            ext_lower[i] = if (raw_ext[i] >= 'A' and raw_ext[i] <= 'Z') raw_ext[i] + 32 else raw_ext[i];
        }
    }
    const ext = ext_lower[0..ext_len];

    // .docx: XML in ZIP, ~40% text content → file_size * 0.4 / 1800 ≈ file_size / 4500
    if (std.mem.eql(u8, ext, ".docx") or std.mem.eql(u8, ext, ".doc")) {
        const pages = file_size / 4500;
        return if (pages > 0) pages else 1;
    }
    // .xlsx: mostly XML overhead, less text per byte
    if (std.mem.eql(u8, ext, ".xlsx") or std.mem.eql(u8, ext, ".xls")) {
        const pages = file_size / 8000;
        return if (pages > 0) pages else 1;
    }
    // .pptx: heavy layout/media, count by typical slide size
    if (std.mem.eql(u8, ext, ".pptx") or std.mem.eql(u8, ext, ".ppt")) {
        const pages = file_size / 15000;
        return if (pages > 0) pages else 1;
    }
    // Generic binary document
    const pages = file_size / 5000;
    return if (pages > 0) pages else 1;
}

/// Simple PDF page count heuristic: count "/Page" objects (not "/Pages")
pub fn countPdfPages(data: []const u8) u64 {
    var count: u64 = 0;
    var i: usize = 0;
    while (i + 8 < data.len) : (i += 1) {
        if (std.mem.startsWith(u8, data[i..], "/Type")) {
            var j = i + 5;
            while (j < data.len and (data[j] == ' ' or data[j] == '\r' or data[j] == '\n')) : (j += 1) {}
            if (j + 5 <= data.len and std.mem.startsWith(u8, data[j..], "/Page")) {
                if (j + 6 >= data.len or data[j + 5] != 's') {
                    count += 1;
                }
            }
        }
    }
    return if (count > 0) count else 1;
}

/// ─── Translation Tier Pricing ─────────────────────────────────────
/// (Glossary creation prices are priceForChars / priceForPages above)

/// Calculate price in euro cents for Оптимум translation tier.
/// €0.91 per 1800 chars = 91 cents per page-equivalent.
pub fn priceTranslationOptimum(char_count: u64) i64 {
    if (char_count == 0) return 0;
    return @intCast(unitsForChars(char_count) * RATE_TEXT_GLOSSARY_CENTS);
}

/// Calculate price in euro cents for Ультра translation tier.
/// €1.35 per 1800 chars = 135 cents per page-equivalent.
pub fn priceTranslationUltra(char_count: u64) i64 {
    if (char_count == 0) return 0;
    return @intCast(unitsForChars(char_count) * RATE_COMPLEX_GLOSSARY_CENTS);
}

/// Determine file category based on mime type and extension
pub fn categorizeFile(mime_type: ?[]const u8, file_name: ?[]const u8) []const u8 {
    if (mime_type) |mt| {
        if (std.mem.startsWith(u8, mt, "image/")) return "media";
        if (std.mem.startsWith(u8, mt, "video/")) return "media";
        if (std.mem.startsWith(u8, mt, "audio/")) return "media";
    }
    if (file_name) |name| {
        if (std.mem.endsWith(u8, name, ".tmx") or
            std.mem.endsWith(u8, name, ".tbx") or
            std.mem.endsWith(u8, name, ".xliff"))
            return "glossary";
    }
    return "document";
}
