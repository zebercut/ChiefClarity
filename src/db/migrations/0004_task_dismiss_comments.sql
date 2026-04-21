-- Add dismissed_at and comments columns to tasks table
ALTER TABLE tasks ADD COLUMN dismissed_at TEXT;
ALTER TABLE tasks ADD COLUMN comments TEXT DEFAULT '[]';
