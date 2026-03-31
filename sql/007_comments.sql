-- Migration 007: Comment Threads
-- Support nested comments on glossary terms, versions, and other resources

CREATE TABLE comments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id       INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    resource_type   TEXT NOT NULL,
    resource_id     INTEGER NOT NULL,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    content_format  TEXT DEFAULT 'text',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER,
    deleted_at      INTEGER,

    CHECK (resource_type IN ('glossary_term', 'glossary_version', 'file', 'project')),
    CHECK (content_format IN ('text', 'html'))
);

CREATE INDEX idx_comments_resource ON comments(project_id, resource_type, resource_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_id, created_at ASC);
CREATE INDEX idx_comments_user ON comments(user_id, created_at DESC);

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (7, unixepoch('now'));
