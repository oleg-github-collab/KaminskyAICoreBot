-- Migration 004: Rich Text Support
-- Add content_format columns to support HTML content from Quill editor

-- Messages table: add format column
ALTER TABLE messages ADD COLUMN content_format TEXT DEFAULT 'text';

-- Glossary terms: add notes field for admin comments/annotations
ALTER TABLE glossary_terms ADD COLUMN notes TEXT DEFAULT '';
ALTER TABLE glossary_terms ADD COLUMN notes_format TEXT DEFAULT 'text';

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (4, unixepoch('now'));
