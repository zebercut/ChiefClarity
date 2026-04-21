-- ═══════════════════════════════════════════════════════════════════════════
-- FEAT018 — Google Calendar integration: source tracking fields
-- Adds source_integration and source_id to calendar_events for dedup sync.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE calendar_events ADD COLUMN source_integration TEXT;
ALTER TABLE calendar_events ADD COLUMN source_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cal_source ON calendar_events(source_integration, source_id);
