CREATE TABLE IF NOT EXISTS workflow_steps (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    step_number     INTEGER NOT NULL,
    step_type       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    admin_msg_id    INTEGER,
    metadata        TEXT DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    completed_at    INTEGER
);

CREATE TABLE IF NOT EXISTS glossary_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    created_by      INTEGER REFERENCES users(id),
    snapshot_tsv    TEXT NOT NULL,
    change_summary  TEXT DEFAULT '',
    terms_added     INTEGER DEFAULT 0,
    terms_removed   INTEGER DEFAULT 0,
    terms_modified  INTEGER DEFAULT 0,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_file_id  INTEGER NOT NULL REFERENCES files(id),
    workflow_step_id INTEGER REFERENCES workflow_steps(id),
    deepl_document_id TEXT,
    deepl_document_key TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    source_lang     TEXT NOT NULL,
    target_lang     TEXT NOT NULL,
    glossary_id     TEXT,
    formality       TEXT DEFAULT 'default',
    result_file_id  INTEGER REFERENCES files(id),
    error_message   TEXT,
    created_at      INTEGER NOT NULL,
    completed_at    INTEGER
);

CREATE TABLE IF NOT EXISTS translation_settings (
    project_id      INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    formality       TEXT DEFAULT 'default',
    split_sentences TEXT DEFAULT '1',
    preserve_formatting INTEGER DEFAULT 1,
    context         TEXT DEFAULT '',
    tag_handling    TEXT DEFAULT '',
    updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS web_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    session_token   TEXT NOT NULL UNIQUE,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    last_used_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_options (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    language        TEXT NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    estimated_cost_cents INTEGER DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'proposed',
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sse_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL,
    event_type      TEXT NOT NULL,
    payload         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

ALTER TABLE messages ADD COLUMN sender_name TEXT DEFAULT '';

ALTER TABLE messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;

ALTER TABLE messages ADD COLUMN message_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_steps(project_id);

CREATE INDEX IF NOT EXISTS idx_workflow_status ON workflow_steps(project_id, status);

CREATE INDEX IF NOT EXISTS idx_glossary_versions_project ON glossary_versions(project_id);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_project ON translation_jobs(project_id);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_status ON translation_jobs(status);

CREATE INDEX IF NOT EXISTS idx_messages_uuid ON messages(message_uuid);

CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(project_id, is_read);

CREATE INDEX IF NOT EXISTS idx_web_sessions_token ON web_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_sse_events_project ON sse_events(project_id, created_at)
