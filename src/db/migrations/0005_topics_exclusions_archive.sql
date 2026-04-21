-- FEAT023 Stories 5-8 follow-up: topic archive + per-topic exclusions
ALTER TABLE topics ADD COLUMN archived_at TEXT;
ALTER TABLE topics ADD COLUMN excluded_ids TEXT DEFAULT '[]';
