-- Migration 009: Project CRUD enhancements
-- Support updating project name, description, languages

-- Projects table already has name, description, source_lang, target_lang
-- Just add updated_at tracking

ALTER TABLE projects ADD COLUMN updated_at INTEGER;
ALTER TABLE projects ADD COLUMN updated_by INTEGER REFERENCES users(id);

-- Set updated_at to created_at for existing projects
UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL;

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (9, unixepoch('now'));
