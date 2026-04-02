-- Migration 13: Workflow engine — stages, translation tiers, review statuses

-- Project workflow stage tracking
ALTER TABLE projects ADD COLUMN workflow_stage TEXT DEFAULT 'files_uploaded';

-- Translation tier preference in settings
ALTER TABLE translation_settings ADD COLUMN translation_tier TEXT DEFAULT 'optimum';

-- Translation tier on jobs
ALTER TABLE translation_jobs ADD COLUMN translation_tier TEXT DEFAULT 'optimum';

-- Invoice type and tier tracking
ALTER TABLE invoices ADD COLUMN invoice_type TEXT DEFAULT 'glossary';

ALTER TABLE invoices ADD COLUMN translation_tier TEXT;

-- File revision tracking (admin re-uploads edited translations)
ALTER TABLE files ADD COLUMN replaces_file_id INTEGER REFERENCES files(id);

ALTER TABLE files ADD COLUMN review_status TEXT DEFAULT 'pending';

-- Indexes for workflow queries
CREATE INDEX IF NOT EXISTS idx_projects_workflow ON projects(workflow_stage);

CREATE INDEX IF NOT EXISTS idx_files_review ON files(project_id, review_status);

CREATE INDEX IF NOT EXISTS idx_files_replaces ON files(replaces_file_id);

CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(project_id, invoice_type);
