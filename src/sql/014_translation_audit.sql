-- Migration 14: store actual translation service usage for margin audit

ALTER TABLE translation_jobs ADD COLUMN actual_token_count INTEGER DEFAULT 0;

ALTER TABLE translation_jobs ADD COLUMN actual_price_credits REAL DEFAULT 0;

ALTER TABLE translation_jobs ADD COLUMN actual_used_credits REAL DEFAULT 0;

ALTER TABLE translation_jobs ADD COLUMN balance_retry_count INTEGER DEFAULT 0;

ALTER TABLE translation_jobs ADD COLUMN last_balance_retry_at INTEGER DEFAULT 0;
