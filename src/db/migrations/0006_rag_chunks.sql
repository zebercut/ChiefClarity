-- ═══════════════════════════════════════════════════════════════════════════
-- FEAT068 — RAG chunk identity table.
-- Sibling to the FEAT042 `embeddings` table. The chunk-level identity
-- (chunkId, source, text, modelId) lives here; the vector itself stays in
-- `embeddings` so the existing FEAT042 callers (_semanticDedupFn,
-- linkTask/linkEvent, runBackgroundIndex, retriever.ts) keep working
-- byte-equal. The new info_lookup skill joins these two tables on
-- (source, sourceId) via the LibsqlVectorStore backend.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rag_chunks (
  chunk_id    TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  text        TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  indexed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source, source_id);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_modelid ON rag_chunks(model_id);
