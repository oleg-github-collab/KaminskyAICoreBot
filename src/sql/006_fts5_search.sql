-- Migration 006: Full-Text Search with SQLite FTS5

CREATE VIRTUAL TABLE IF NOT EXISTS glossary_fts USING fts5(
    term_id UNINDEXED,
    project_id UNINDEXED,
    source_term,
    target_term,
    domain,
    content='glossary_terms',
    content_rowid='id'
);

INSERT OR IGNORE INTO glossary_fts(term_id, project_id, source_term, target_term, domain)
SELECT id, project_id, source_term, target_term, COALESCE(domain, '')
FROM glossary_terms;

CREATE TRIGGER IF NOT EXISTS glossary_fts_insert AFTER INSERT ON glossary_terms BEGIN
    INSERT INTO glossary_fts(term_id, project_id, source_term, target_term, domain)
    VALUES (new.id, new.project_id, new.source_term, new.target_term, COALESCE(new.domain, ''));
END;

CREATE TRIGGER IF NOT EXISTS glossary_fts_delete AFTER DELETE ON glossary_terms BEGIN
    DELETE FROM glossary_fts WHERE term_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS glossary_fts_update AFTER UPDATE ON glossary_terms BEGIN
    UPDATE glossary_fts
    SET source_term = new.source_term,
        target_term = new.target_term,
        domain = COALESCE(new.domain, '')
    WHERE term_id = new.id;
END;

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    file_id UNINDEXED,
    project_id UNINDEXED,
    filename,
    content_text,
    content='files'
)
