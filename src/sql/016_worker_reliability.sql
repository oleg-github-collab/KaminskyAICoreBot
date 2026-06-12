-- Worker reliability + fault-tolerance columns and tables.
-- Additive only. SQLite ALTER TABLE ADD COLUMN, no table rebuilds on live data.
ALTER TABLE projects ADD COLUMN translation_worker_running INTEGER NOT NULL DEFAULT 0;
ALTER TABLE translation_jobs ADD COLUMN next_retry_at INTEGER DEFAULT 0;
ALTER TABLE translation_jobs ADD COLUMN external_task_id TEXT;
ALTER TABLE translation_jobs ADD COLUMN last_state_change INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS webhook_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, received_at INTEGER, raw_body TEXT, parse_error TEXT);
