/// Telegram Bot API type definitions
/// Only fields we actually use are declared; unknown fields are ignored via parse options.

pub const Update = struct {
    update_id: i64,
    message: ?Message = null,
    callback_query: ?CallbackQuery = null,
};

pub const Message = struct {
    message_id: i64,
    from: ?User = null,
    chat: Chat,
    date: i64,
    text: ?[]const u8 = null,
    caption: ?[]const u8 = null,
    photo: ?[]const PhotoSize = null,
    document: ?Document = null,
    video: ?Video = null,
    voice: ?Voice = null,
    sticker: ?Sticker = null,
    reply_to_message: ?*const Message = null,
};

pub const User = struct {
    id: i64,
    is_bot: bool = false,
    first_name: []const u8,
    last_name: ?[]const u8 = null,
    username: ?[]const u8 = null,
    language_code: ?[]const u8 = null,
};

pub const Chat = struct {
    id: i64,
    type: []const u8 = "private",
    first_name: ?[]const u8 = null,
    last_name: ?[]const u8 = null,
    username: ?[]const u8 = null,
};

pub const PhotoSize = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    width: i32 = 0,
    height: i32 = 0,
    file_size: ?i64 = null,
};

pub const Document = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    file_name: ?[]const u8 = null,
    mime_type: ?[]const u8 = null,
    file_size: ?i64 = null,
};

pub const Video = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    width: i32 = 0,
    height: i32 = 0,
    duration: i32 = 0,
    file_name: ?[]const u8 = null,
    mime_type: ?[]const u8 = null,
    file_size: ?i64 = null,
};

pub const Voice = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    duration: i32 = 0,
    mime_type: ?[]const u8 = null,
    file_size: ?i64 = null,
};

pub const Sticker = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    width: i32 = 0,
    height: i32 = 0,
};

pub const CallbackQuery = struct {
    id: []const u8,
    from: User,
    message: ?Message = null,
    data: ?[]const u8 = null,
};

pub const TgFile = struct {
    file_id: []const u8,
    file_unique_id: []const u8,
    file_size: ?i64 = null,
    file_path: ?[]const u8 = null,
};

/// Helper to detect message type
pub fn messageType(msg: *const Message) []const u8 {
    if (msg.photo != null) return "photo";
    if (msg.document != null) return "document";
    if (msg.video != null) return "video";
    if (msg.voice != null) return "voice";
    if (msg.sticker != null) return "sticker";
    return "text";
}

/// Extract file_id from any media message
pub fn fileId(msg: *const Message) ?[]const u8 {
    if (msg.document) |d| return d.file_id;
    if (msg.photo) |photos| {
        if (photos.len > 0) return photos[photos.len - 1].file_id;
    }
    if (msg.video) |v| return v.file_id;
    if (msg.voice) |v| return v.file_id;
    if (msg.sticker) |s| return s.file_id;
    return null;
}

/// Extract file_name from media message
pub fn fileName(msg: *const Message) ?[]const u8 {
    if (msg.document) |d| return d.file_name;
    if (msg.video) |v| return v.file_name;
    return null;
}

/// Extract mime_type from media message
pub fn mimeType(msg: *const Message) ?[]const u8 {
    if (msg.document) |d| return d.mime_type;
    if (msg.video) |v| return v.mime_type;
    if (msg.voice) |v| return v.mime_type;
    if (msg.photo != null) return "image/jpeg";
    return null;
}

/// Extract file_size from media message
pub fn mediaFileSize(msg: *const Message) ?i64 {
    if (msg.document) |d| return d.file_size;
    if (msg.video) |v| return v.file_size;
    if (msg.voice) |v| return v.file_size;
    if (msg.photo) |photos| {
        if (photos.len > 0) return photos[photos.len - 1].file_size;
    }
    return null;
}
