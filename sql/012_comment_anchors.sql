-- Text-anchoring for comments on files
ALTER TABLE comments ADD COLUMN start_offset INTEGER;
ALTER TABLE comments ADD COLUMN end_offset INTEGER;
ALTER TABLE comments ADD COLUMN quoted_text TEXT;

-- Suggestion-specific fields
ALTER TABLE comments ADD COLUMN comment_type TEXT DEFAULT 'comment';
ALTER TABLE comments ADD COLUMN suggested_text TEXT;
ALTER TABLE comments ADD COLUMN suggestion_status TEXT DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_comments_file_offsets
    ON comments(project_id, resource_type, resource_id, start_offset)
    WHERE start_offset IS NOT NULL
