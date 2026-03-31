-- Migration 009: Project CRUD enhancements

ALTER TABLE projects ADD COLUMN updated_by INTEGER REFERENCES users(id)
