/**
 * FEAT068 — VectorStore interface.
 *
 * Persistent vector index abstraction with two backends:
 *   - LibsqlVectorStore (Node) — wraps the existing FEAT042 `embeddings`
 *     table via `db/queries/embeddings.ts`, plus a sibling `rag_chunks`
 *     table for the chunk-level identity (chunkId, source, text, modelId)
 *     the new pattern needs.
 *   - IndexedDbVectorStore (web/Capacitor) — `idb`-backed; loads all
 *     records into memory once on first search and brute-forces cosine.
 *
 * The legacy FEAT042 callers (`_semanticDedupFn`, `linkTask`, `linkEvent`,
 * assembler `retrieveContext`, `runBackgroundIndex`, `db/flush.ts:indexAndLink`)
 * keep using `db/queries/embeddings.ts` directly — they are unchanged. Parity
 * with the new path is by construction: the libSQL backend's `search` reuses
 * the same `searchSimilar` SQL underneath. See FEAT068 cond. 14 + 15.
 */

import type {
  ChunkSource,
  VectorRecord,
  SearchFilter,
  RetrievalResult,
} from "../../types/rag";

export interface VectorStore {
  upsert(record: VectorRecord): Promise<void>;
  upsertBatch(records: VectorRecord[]): Promise<void>;
  delete(chunkId: string): Promise<void>;
  /** Delete every chunk for a (source, sourceId) pair. */
  deleteBySource(source: ChunkSource, sourceId: string): Promise<void>;
  /**
   * Top-k cosine search. `queryEmbedding` must be normalized (the provider
   * returns normalized vectors; the brute-force scan assumes that).
   */
  search(
    queryEmbedding: number[] | Float32Array,
    k: number,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]>;
  /** Drop everything. Used on MODEL_ID change. */
  deleteAll(): Promise<void>;
  count(filter?: SearchFilter): Promise<number>;
  /** Number of chunks whose modelId differs from `currentModelId`. */
  countMismatched(currentModelId: string): Promise<number>;
  getAllIds(): Promise<string[]>;
}

/** Cosine similarity for two normalized vectors. */
export function cosineSimilarity(
  a: number[] | Float32Array,
  b: number[] | Float32Array
): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Compose a stable chunk id when one is not externally supplied. */
export function makeChunkId(
  source: ChunkSource,
  sourceId: string,
  paragraphIndex?: number
): string {
  if (typeof paragraphIndex === "number") {
    return `${source}:${sourceId}:${paragraphIndex}`;
  }
  return `${source}:${sourceId}`;
}
