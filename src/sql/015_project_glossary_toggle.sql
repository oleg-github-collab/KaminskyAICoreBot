-- Migration 15: per-project glossary toggle for translation orders

ALTER TABLE projects ADD COLUMN use_glossary INTEGER NOT NULL DEFAULT 1;
