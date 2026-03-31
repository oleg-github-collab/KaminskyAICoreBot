/// Pricing module: €0.58 per 1800 characters, €0.89 per page
const std = @import("std");

/// Calculate price in euro cents for a text file
pub fn priceForChars(char_count: u64) i64 {
    if (char_count == 0) return 0;
    // Round up to nearest 1800-char unit
    const units = (char_count + 1799) / 1800;
    // €0.58 per unit = 58 cents
    return @intCast(units * 58);
}

/// Calculate price in euro cents for a PDF or document
pub fn priceForPages(page_count: u64) i64 {
    if (page_count == 0) return 0;
    // €0.89 per page = 89 cents
    return @intCast(page_count * 89);
}

/// Format euro cents as string (e.g. 1234 -> "12.34")
pub fn formatEuro(buf: []u8, cents: i64) []const u8 {
    const c: u64 = @intCast(if (cents < 0) -cents else cents);
    const euros = c / 100;
    const remaining = c % 100;
    const len = std.fmt.bufPrint(buf, "{d}.{d:0>2}", .{ euros, remaining }) catch return "0.00";
    return len;
}

/// Accurate character counting for translation pricing.
/// - Strips UTF-8 BOM
/// - Normalizes whitespace (runs of spaces/tabs/newlines → single space)
/// - Skips control characters (0x00–0x08, 0x0E–0x1F)
/// - Counts visible Unicode codepoints + single interword spaces
/// - Trims leading/trailing whitespace
pub fn countChars(text: []const u8) u64 {
    if (text.len == 0) return 0;

    // Skip UTF-8 BOM (EF BB BF)
    var start: usize = 0;
    if (text.len >= 3 and text[0] == 0xEF and text[1] == 0xBB and text[2] == 0xBF) {
        start = 3;
    }

    var count: u64 = 0;
    var prev_was_space: bool = true; // true initially to skip leading whitespace
    var i: usize = start;

    while (i < text.len) {
        const byte = text[i];

        // Whitespace: space, tab, newline, carriage return, vertical tab, form feed
        if (byte == ' ' or byte == '\t' or byte == '\n' or byte == '\r' or byte == 0x0B or byte == 0x0C) {
            if (!prev_was_space) {
                count += 1; // Count run of whitespace as single space
                prev_was_space = true;
            }
            i += 1;
            continue;
        }

        // Skip control characters (0x00–0x08, 0x0E–0x1F) — not printable
        if (byte < 0x20 and byte != '\t' and byte != '\n' and byte != '\r' and byte != 0x0B and byte != 0x0C) {
            i += 1;
            continue;
        }

        prev_was_space = false;

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

    // Remove trailing space (if last char group ended with whitespace we counted)
    if (prev_was_space and count > 0) count -= 1;

    return count;
}

/// Detect whether file data is actual readable text (not binary/archive).
/// Returns false for ZIP-based docs (.docx, .xlsx, .pptx, .odt), OLE docs (.doc, .xls),
/// and any file with a high ratio of null/control bytes.
pub fn isTextContent(data: []const u8) bool {
    if (data.len == 0) return true;

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
