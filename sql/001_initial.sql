CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id     INTEGER NOT NULL UNIQUE,
    username        TEXT,
    first_name      TEXT NOT NULL DEFAULT '',
    last_name       TEXT,
    language_code   TEXT DEFAULT 'uk',
    is_admin        INTEGER NOT NULL DEFAULT 0,
    is_blocked      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_states (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id),
    current_state   TEXT NOT NULL DEFAULT 'idle',
    current_project_id INTEGER REFERENCES projects(id),
    context_data    TEXT DEFAULT '{}',
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id        INTEGER NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    source_lang     TEXT DEFAULT 'EN',
    target_lang     TEXT DEFAULT 'UK',
    domain          TEXT DEFAULT 'general',
    invite_code     TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    role            TEXT NOT NULL DEFAULT 'member',
    joined_at       INTEGER NOT NULL,
    UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER REFERENCES projects(id),
    sender_id       INTEGER NOT NULL REFERENCES users(id),
    direction       TEXT NOT NULL,
    message_type    TEXT NOT NULL DEFAULT 'text',
    content         TEXT,
    telegram_file_id TEXT,
    original_msg_id INTEGER,
    relayed_msg_id  INTEGER,
    target_chat_id  INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    uploader_id     INTEGER NOT NULL REFERENCES users(id),
    file_name       TEXT NOT NULL,
    original_name   TEXT NOT NULL,
    mime_type       TEXT,
    file_size       INTEGER DEFAULT 0,
    category        TEXT NOT NULL DEFAULT 'general',
    storage_path    TEXT NOT NULL,
    telegram_file_id TEXT,
    char_count      INTEGER DEFAULT 0,
    page_count      INTEGER DEFAULT 0,
    estimated_price_cents INTEGER DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'EUR',
    description     TEXT,
    stripe_session_id TEXT UNIQUE,
    stripe_payment_url TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    paid_at         INTEGER,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id),
    invoice_id      INTEGER REFERENCES invoices(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    source_file_ids TEXT NOT NULL DEFAULT '[]',
    reference_file_ids TEXT NOT NULL DEFAULT '[]',
    batch_id        TEXT,
    result_file_id  TEXT,
    terms_count     INTEGER DEFAULT 0,
    error_message   TEXT,
    created_at      INTEGER NOT NULL,
    completed_at    INTEGER
);

CREATE TABLE IF NOT EXISTS glossary_terms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    job_id          INTEGER REFERENCES glossary_jobs(id),
    source_term     TEXT NOT NULL,
    target_term     TEXT NOT NULL,
    domain          TEXT DEFAULT 'general',
    confidence      REAL DEFAULT 0.0,
    is_approved     INTEGER NOT NULL DEFAULT 0,
    approved_by     INTEGER REFERENCES users(id),
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_hashes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256_hash     TEXT NOT NULL UNIQUE,
    project_id      INTEGER NOT NULL REFERENCES projects(id),
    result_terms    TEXT NOT NULL DEFAULT '[]',
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deepl_glossaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id),
    deepl_glossary_id TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    source_lang     TEXT NOT NULL,
    target_lang     TEXT NOT NULL,
    entry_count     INTEGER DEFAULT 0,
    synced_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chatbot_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    question_hash   TEXT NOT NULL UNIQUE,
    answer          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    hit_count       INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version         INTEGER PRIMARY KEY,
    applied_at      INTEGER NOT NULL
);
