/**
 * FEAT068 — RAG types.
 *
 * Logical types for the persistent vector index that backs the
 * `info_lookup` skill. Two physical backends (libSQL on Node,
 * IndexedDB on web/Capacitor) share these shapes via the
 * `VectorStore` interface in `src/modules/rag/store.ts`.
 *
 * `contentIndex` (the legacy v3 keyword-lookup file in the AppState
 * model) is intentionally orthogonal to this module — both coexist.
 */

/**
 * Sources the RAG index covers. The new `info_lookup` skill scopes
 * to `["note", "topic", "contextMemory"]`; the legacy FEAT042
 * assembler-side retriever uses the broader set
 * `["task", "event", "fact", "note", "observation"]` and is unchanged.
 */
export type ChunkSource =
  | "note"
  | "topic"
  | "contextMemory"
  | "task"
  | "event"
  | "observation"
  | "fact";

export interface VectorRecord {
  chunkId: string;
  source: ChunkSource;
  sourceId: string;
  text: string;
  /** 384-dim normalized vector from all-MiniLM-L6-v2. */
  embedding: number[];
  /** MODEL_ID from provider.ts at write time (cache invalidation). */
  modelId: string;
  indexedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SearchFilter {
  sources?: ChunkSource[];
  /** Cosine similarity floor. 0..1, higher = more similar. */
  minScore?: number;
}

export interface RetrievalResult {
  chunkId: string;
  source: ChunkSource;
  sourceId: string;
  text: string;
  /** Normalized cosine similarity, 0..1. 1.0 = identical. */
  score: number;
  metadata?: Record<string, unknown>;
}

/** Status surface read by the dispatcher to mark partial-result envelopes. */
export interface RagBackfillStatus {
  state: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

/**
 * Declarative pre-LLM retrieval policy declared by a skill manifest.
 * The dispatcher reads this between `resolveContext` and the LLM call;
 * if absent, dispatch behaves as before.
 */
export interface RetrievalHook {
  sources: ChunkSource[];
  k: number;
  /** Floor for inclusion in `retrievedKnowledge`. */
  minScore: number;
  /** Floor for "confident answer" — top score below this means "no info". */
  minScoreInclude: number;
  /** Default 800ms when omitted. */
  softTimeoutMs?: number;
}
