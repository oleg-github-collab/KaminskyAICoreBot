/// Pricing module: €0.58 per 1800 characters, €0.69 per page

/// Calculate price in euro cents for a text file
pub fn priceForChars(char_count: u64) i64 {
    if (char_count == 0) return 0;
    // Round up to nearest 1800-char unit
    const units = (char_count + 1799) / 1800;
    // €0.58 per unit = 58 cents
    return @intCast(units * 58);
}

/// Calculate price in euro cents for a PDF
pub fn priceForPages(page_count: u64) i64 {
    if (page_count == 0) return 0;
    // €0.69 per page = 69 cents
    return @intCast(page_count * 69);
}

/// Format euro cents as string (e.g. 1234 -> "12.34")
pub fn formatEuro(buf: []u8, cents: i64) []const u8 {
    const c: u64 = @intCast(if (cents < 0) -cents else cents);
    const euros = c / 100;
    const remaining = c % 100;
    const len = @import("std").fmt.bufPrint(buf, "{d}.{d:0>2}", .{ euros, remaining }) catch return "0.00";
    return len;
}

/// Count characters in a UTF-8 text (excluding whitespace-only)
pub fn countChars(text: []const u8) u64 {
    var count: u64 = 0;
    for (text) |byte| {
        // Count non-continuation bytes (UTF-8 start bytes)
        if (byte & 0xC0 != 0x80) {
            count += 1;
        }
    }
    return count;
}

/// Simple PDF page count heuristic: count "/Page" objects (not "/Pages")
/// This is a basic approach; works for most standard PDFs.
pub fn countPdfPages(data: []const u8) u64 {
    var count: u64 = 0;
    var i: usize = 0;
    while (i + 8 < data.len) : (i += 1) {
        // Look for "/Type /Page" or "/Type/Page" (not "/Type /Pages")
        if (@import("std").mem.startsWith(u8, data[i..], "/Type")) {
            var j = i + 5;
            // Skip whitespace
            while (j < data.len and (data[j] == ' ' or data[j] == '\r' or data[j] == '\n')) : (j += 1) {}
            if (j + 5 <= data.len and @import("std").mem.startsWith(u8, data[j..], "/Page")) {
                // Make sure it's not /Pages
                if (j + 6 >= data.len or data[j + 5] != 's') {
                    count += 1;
                }
            }
        }
    }
    return if (count > 0) count else 1; // At least 1 page
}

/// Determine file category based on mime type and extension
pub fn categorizeFile(mime_type: ?[]const u8, file_name: ?[]const u8) []const u8 {
    const std = @import("std");
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
