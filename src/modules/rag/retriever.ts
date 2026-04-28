/**
 * FEAT068 — RAG retriever.
 *
 * Embeds a phrase, fetches top-K from the configured `VectorStore`
 * filtered by `sources` and `minScore`. Used by the dispatcher's
 * pre-LLM retrieval hook.
 *
 * Distinct from the legacy FEAT042 assembler-side retriever
 * (`src/modules/embeddings/retriever.ts`) which joins matches back to
 * source tables for the assembler's context. The assembler path is
 * unchanged.
 */

import { embed } from "../embeddings/provider";
import { getDefaultVectorStore } from "./store-factory";
import type { VectorStore } from "./store";
import type {
  ChunkSource,
  RetrievalResult,
} from "../../types/rag";

let _embedderWarnEmitted = false;

export interface RetrieveOptions {
  k?: number;
  sources?: ChunkSource[];
  minScore?: number;
  store?: VectorStore;
}

/**
 * Retrieve top-K semantically similar chunks for a phrase.
 * Returns `[]` on embedder unavailable + emits a single WARN per session.
 */
export async function retrieveTopK(
  phrase: string,
  opts: RetrieveOptions = {}
): Promise<RetrievalResult[]> {
  const k = opts.k ?? 5;
  let queryVec: Float32Array | null;
  try {
    queryVec = await embed(phrase);
  } catch {
    queryVec = null;
  }
  if (!queryVec) {
    if (!_embedderWarnEmitted) {
      _embedderWarnEmitted = true;
      console.warn("[rag-retriever] embedder unavailable — returning [] for retrieval calls this session");
    }
    return [];
  }
  const store = opts.store ?? (await getDefaultVectorStore());
  return store.search(queryVec, k, {
    sources: opts.sources,
    minScore: opts.minScore,
  });
}

/** Test-only: clear the warn-once cache between cases. */
export function _resetRetrieverWarnsForTests(): void {
  _embedderWarnEmitted = false;
}
