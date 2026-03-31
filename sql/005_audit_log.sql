-- Migration 005: Audit Log for Compliance
-- Track all user actions for compliance, security, and debugging

CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    project_id      INTEGER REFERENCES projects(id),
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     INTEGER,
    old_value       TEXT,
    new_value       TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      INTEGER NOT NULL,

    -- Indexes for common queries
    CHECK (action IN (
        'create', 'update', 'delete', 'approve', 'reject',
        'login', 'logout', 'upload', 'download', 'export',
        'invite', 'remove_member', 'sync', 'commit', 'merge'
    )),
    CHECK (resource_type IN (
        'project', 'glossary_term', 'file', 'message',
        'team_member', 'invite', 'glossary_version', 'comment'
    ))
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_project ON audit_log(project_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at DESC);

-- Auto-cleanup: Delete audit logs older than 90 days
-- (Run via cron or scheduled job)
-- DELETE FROM audit_log WHERE created_at < unixepoch('now') - (90 * 24 * 60 * 60);

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (5, unixepoch('now'));
