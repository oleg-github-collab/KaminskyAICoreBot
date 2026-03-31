-- Migration 006: Full-Text Search with SQLite FTS5
-- Enables fast search across glossary terms and documents

-- Virtual FTS5 table for glossary terms
CREATE VIRTUAL TABLE glossary_fts USING fts5(
    term_id UNINDEXED,
    project_id UNINDEXED,
    source_term,
    target_term,
    domain,
    content='glossary_terms',
    content_rowid='id'
);

-- Populate FTS table with existing data
INSERT INTO glossary_fts(term_id, project_id, source_term, target_term, domain)
SELECT id, project_id, source_term, target_term, COALESCE(domain, '')
FROM glossary_terms
WHERE deleted_at IS NULL;

-- Triggers to keep FTS in sync with glossary_terms
CREATE TRIGGER glossary_fts_insert AFTER INSERT ON glossary_terms BEGIN
    INSERT INTO glossary_fts(term_id, project_id, source_term, target_term, domain)
    VALUES (new.id, new.project_id, new.source_term, new.target_term, COALESCE(new.domain, ''));
END;

CREATE TRIGGER glossary_fts_delete AFTER DELETE ON glossary_terms BEGIN
    DELETE FROM glossary_fts WHERE term_id = old.id;
END;

CREATE TRIGGER glossary_fts_update AFTER UPDATE ON glossary_terms BEGIN
    UPDATE glossary_fts
    SET source_term = new.source_term,
        target_term = new.target_term,
        domain = COALESCE(new.domain, '')
    WHERE term_id = new.id;
END;

-- FTS5 table for file content search (future)
CREATE VIRTUAL TABLE files_fts USING fts5(
    file_id UNINDEXED,
    project_id UNINDEXED,
    filename,
    content_text,
    content='files'
);

-- Update schema_migrations
INSERT INTO schema_migrations (version, applied_at)
VALUES (6, unixepoch('now'));
