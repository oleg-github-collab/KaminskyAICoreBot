-- Migration 006: Full-Text Search with SQLite FTS5
-- Note: Triggers removed — semicolons inside BEGIN...END break the migration
-- runner's statement splitter. FTS index is populated on initial load and
-- can be rebuilt via: INSERT INTO glossary_fts(glossary_fts) VALUES('rebuild')

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

CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    file_id UNINDEXED,
    project_id UNINDEXED,
    filename,
    content_text,
    content='files'
)
