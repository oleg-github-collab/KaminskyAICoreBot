-- Migration 008: Git-like Version Control for Glossaries
-- Branches, commits, merges with conflict resolution

CREATE TABLE glossary_branches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch_name     TEXT NOT NULL,
    parent_branch_id INTEGER REFERENCES glossary_branches(id),
    created_by      INTEGER REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    deleted_at      INTEGER,

    UNIQUE(project_id, branch_name)
);

CREATE INDEX idx_glossary_branches_project ON glossary_branches(project_id, deleted_at);

CREATE TABLE glossary_commits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id       INTEGER NOT NULL REFERENCES glossary_branches(id) ON DELETE CASCADE,
    parent_commit_id INTEGER REFERENCES glossary_commits(id),
    commit_message  TEXT NOT NULL,
    snapshot_json   TEXT NOT NULL,
    terms_added     INTEGER DEFAULT 0,
    terms_removed   INTEGER DEFAULT 0,
    terms_modified  INTEGER DEFAULT 0,
    committed_by    INTEGER REFERENCES users(id),
    committed_at    INTEGER NOT NULL
);

CREATE INDEX idx_glossary_commits_branch ON glossary_commits(branch_id, committed_at DESC);

-- Create "main" branch for all existing projects
INSERT INTO glossary_branches (project_id, branch_name, created_at)
SELECT id, 'main', unixepoch('now')
FROM projects
WHERE deleted_at IS NULL;

-- Add current_branch_id to projects table
ALTER TABLE projects ADD COLUMN current_branch_id INTEGER REFERENCES glossary_branches(id);

-- Set current_branch_id to main branch
UPDATE projects
SET current_branch_id = (
    SELECT id FROM glossary_branches
    WHERE glossary_branches.project_id = projects.id
    AND branch_name = 'main'
    LIMIT 1
);

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (8, unixepoch('now'));
