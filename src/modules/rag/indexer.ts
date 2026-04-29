/**
 * FEAT068 — RAG indexer.
 *
 * Embeds + writes chunks into the configured `VectorStore`. Distinct
 * from the legacy FEAT042 indexer (`src/modules/embeddings/indexer.ts`)
 * which still serves the existing assembler / linker / dedup paths.
 *
 * Sources covered here:
 *   - "note"          → 1 chunk per note (whole text)
 *   - "contextMemory" → 1 chunk per fact
 *   - "topic"         → N chunks per topic page (paragraph split)
 *
 * Failure path is non-throwing: relational write integrity is
 * preserved (matches FEAT042 cond. 12).
 *
 * Platform-agnostic: takes a `VectorStore` argument. Node code passes
 * the libSQL backend; web passes IndexedDB. Defaults to the factory.
 */

import { embed, MODEL_ID } from "../embeddings/provider";
import { chunkTopicPage } from "./chunker";
import { getDefaultVectorStore } from "./store-factory";
import { makeChunkId, type VectorStore } from "./store";
import type { ChunkSource, VectorRecord } from "../../types/rag";

const MIN_TEXT_CHARS = 5;

export interface IndexEntityInput {
  source: ChunkSource;
  sourceId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Index a single entity (notes, facts, observations). For multi-paragraph
 * sources (topic pages), use `indexTopicPage`. Returns the number of
 * chunks written.
 */
export async function indexEntity(
  input: IndexEntityInput,
  store?: VectorStore
): Promise<number> {
  const text = (input.text ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) return 0;
  const s = store ?? (await getDefaultVectorStore());
  try {
    const vec = await embed(text);
    if (!vec) return 0;
    if (Array.from(vec).some((v) => !Number.isFinite(v))) {
      console.warn(
        `[rag-indexer] bad vector for ${input.source}/${input.sourceId}, skipping`
      );
      return 0;
    }
    const record: VectorRecord = {
      chunkId: makeChunkId(input.source, input.sourceId),
      source: input.source,
      sourceId: input.sourceId,
      text,
      embedding: Array.from(vec),
      modelId: MODEL_ID,
      indexedAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await s.upsert(record);
    return 1;
  } catch (err: any) {
    console.warn(
      `[rag-indexer] embed failed for ${input.source}/${input.sourceId}: ${err?.message ?? err}`
    );
    return 0;
  }
}

/**
 * Index a topic page as N paragraph chunks. Deletes prior chunks for
 * the same `sourceId` first so a rewritten page doesn't keep stale
 * paragraphs around.
 */
export async function indexTopicPage(
  topicId: string,
  pageText: string,
  store?: VectorStore,
  metadata?: Record<string, unknown>
): Promise<number> {
  const s = store ?? (await getDefaultVectorStore());
  try {
    await s.deleteBySource("topic", topicId);
    const paragraphs = chunkTopicPage(pageText);
    if (paragraphs.length === 0) return 0;
    let written = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i];
      if (text.length < MIN_TEXT_CHARS) continue;
      const vec = await embed(text);
      if (!vec) continue;
      if (Array.from(vec).some((v) => !Number.isFinite(v))) continue;
      const record: VectorRecord = {
        chunkId: makeChunkId("topic", topicId, i),
        source: "topic",
        sourceId: topicId,
        text,
        embedding: Array.from(vec),
        modelId: MODEL_ID,
        indexedAt: new Date().toISOString(),
        metadata,
      };
      await s.upsert(record);
      written++;
    }
    return written;
  } catch (err: any) {
    console.warn(
      `[rag-indexer] topic index failed for ${topicId}: ${err?.message ?? err}`
    );
    return 0;
  }
}

/** Remove every chunk for a (source, sourceId) pair. */
export async function deindexEntity(
  source: ChunkSource,
  sourceId: string,
  store?: VectorStore
): Promise<void> {
  const s = store ?? (await getDefaultVectorStore());
  try {
    await s.deleteBySource(source, sourceId);
  } catch (err: any) {
    console.warn(
      `[rag-indexer] deindex failed for ${source}/${sourceId}: ${err?.message ?? err}`
    );
  }
}
