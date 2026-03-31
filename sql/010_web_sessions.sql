-- Migration 010: Web Sessions indexes (table created in 003_workflow)

CREATE INDEX IF NOT EXISTS idx_web_sessions_token ON web_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at)
