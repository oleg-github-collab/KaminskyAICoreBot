-- Migration 011: Document Content, Quotes, Instructions

CREATE TABLE IF NOT EXISTS document_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER UNIQUE NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    content_text TEXT NOT NULL,
    content_chunks TEXT,
    extracted_at INTEGER NOT NULL,
    extraction_method TEXT DEFAULT 'python_processor'
);

CREATE INDEX IF NOT EXISTS idx_document_content_file ON document_content(file_id);

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

CREATE INDEX IF NOT EXISTS idx_message_quotes_message ON message_quotes(message_id);
CREATE INDEX IF NOT EXISTS idx_message_quotes_file ON message_quotes(file_id);

CREATE TABLE IF NOT EXISTS project_instructions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    instructions_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    updated_by INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_instructions_project ON project_instructions(project_id)
