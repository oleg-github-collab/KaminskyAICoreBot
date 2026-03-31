-- Document Quoting Feature
-- Stores extracted text from documents for quoting in messages

-- Store extracted text from documents
CREATE TABLE IF NOT EXISTS document_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER UNIQUE NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    content_text TEXT NOT NULL,
    content_chunks TEXT,  -- JSON array of {start, end, text} for pagination
    extracted_at INTEGER NOT NULL,
    extraction_method TEXT DEFAULT 'python_processor'
);

-- Store quote references in messages
CREATE TABLE IF NOT EXISTS message_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_id INTEGER NOT NULL REFERENCES files(id),
    file_name TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    quoted_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_content_file ON document_content(file_id);
CREATE INDEX IF NOT EXISTS idx_message_quotes_message ON message_quotes(message_id);
CREATE INDEX IF NOT EXISTS idx_message_quotes_file ON message_quotes(file_id);

-- Populate files_fts table with existing content (if needed later)
-- Will be populated after text extraction

INSERT INTO schema_migrations (version, applied_at) VALUES (10, unixepoch('now'));
