-- Migration 007: Comment Threads

CREATE TABLE IF NOT EXISTS comments (
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
    deleted_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_comments_resource ON comments(project_id, resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at DESC)
