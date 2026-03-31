-- Migration 010: Web Sessions for Telegram OAuth
-- Support browser-based authentication with session tokens

CREATE TABLE web_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    session_token   TEXT NOT NULL UNIQUE,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    last_used_at    INTEGER NOT NULL
);

CREATE INDEX idx_web_sessions_token ON web_sessions(session_token);
CREATE INDEX idx_web_sessions_user ON web_sessions(user_id, expires_at DESC);
CREATE INDEX idx_web_sessions_expires ON web_sessions(expires_at);

-- Auto-cleanup: Delete expired sessions (run via cron)
-- DELETE FROM web_sessions WHERE expires_at < unixepoch('now');

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (10, unixepoch('now'));
