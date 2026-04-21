-- ═══════════════════════════════════════════════════════════════════════════
-- FEAT041 — Embeddings table (separate migration)
-- Requires libSQL vector extension. If the build does not support F32_BLOB,
-- this migration will fail independently without blocking the core schema.
-- FEAT042 populates this table.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  vector      F32_BLOB(384),
  metadata    TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_embed_source ON embeddings(source_type, source_id);
