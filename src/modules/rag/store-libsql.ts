/**
 * FEAT068 — libSQL VectorStore backend (Node).
 *
 * Wraps the existing FEAT042 `embeddings` table for vector storage +
 * cosine search, plus a sibling `rag_chunks` table for chunk-level
 * identity (chunkId, source, text, modelId). The two tables join on
 * (source_type, source_id) which is the existing FEAT042 unique key.
 *
 * Parity contract: every search result this backend returns is sourced
 * from the same `vector_distance_cos` SQL as FEAT042's `searchSimilar`,
 * so existing FEAT042 callers (which call `searchSimilar` directly) and
 * new info_lookup callers (which call this store) see the same vector
 * matches. See FEAT068 cond. 14 + 15.
 *
 * Node-only — blocked from the web bundle by metro.config.js.
 */

import { getDb } from "../../db/index";
import type {
  ChunkSource,
  RetrievalResult,
  SearchFilter,
  VectorRecord,
} from "../../types/rag";
import type { VectorStore } from "./store";

function vecToString(vec: number[] | Float32Array): string {
  return "[" + Array.from(vec).join(",") + "]";
}

export class LibsqlVectorStore implements VectorStore {
  async upsert(r: VectorRecord): Promise<void> {
    await this.upsertBatch([r]);
  }

  async upsertBatch(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = getDb();
    for (const r of records) {
      // Reuse FEAT042's INSERT OR REPLACE on (source_type, source_id).
      await db.execute({
        sql: `INSERT OR REPLACE INTO embeddings (source_type, source_id, vector, metadata, created_at)
              VALUES (?, ?, vector(?), ?, datetime('now'))`,
        args: [
          r.source,
          r.sourceId,
          vecToString(r.embedding),
          r.metadata ? JSON.stringify(r.metadata) : null,
        ],
      });
      await db.execute({
        sql: `INSERT OR REPLACE INTO rag_chunks
              (chunk_id, source, source_id, text, model_id, indexed_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          r.chunkId,
          r.source,
          r.sourceId,
          r.text,
          r.modelId,
          r.indexedAt,
        ],
      });
    }
  }

  async delete(chunkId: string): Promise<void> {
    const db = getDb();
    const row = await db.execute({
      sql: "SELECT source, source_id FROM rag_chunks WHERE chunk_id = ?",
      args: [chunkId],
    });
    if (row.rows.length === 0) return;
    const source = row.rows[0].source as string;
    const sourceId = row.rows[0].source_id as string;
    await db.execute({ sql: "DELETE FROM rag_chunks WHERE chunk_id = ?", args: [chunkId] });
    // Only delete the underlying embedding when no other chunk uses the
    // same (source, sourceId) — protects the FEAT042 caller's row.
    const remaining = await db.execute({
      sql: "SELECT COUNT(*) as c FROM rag_chunks WHERE source = ? AND source_id = ?",
      args: [source, sourceId],
    });
    if (Number(remaining.rows[0].c) === 0) {
      await db.execute({
        sql: "DELETE FROM embeddings WHERE source_type = ? AND source_id = ?",
        args: [source, sourceId],
      });
    }
  }

  async deleteBySource(source: ChunkSource, sourceId: string): Promise<void> {
    const db = getDb();
    await db.execute({
      sql: "DELETE FROM rag_chunks WHERE source = ? AND source_id = ?",
      args: [source, sourceId],
    });
    await db.execute({
      sql: "DELETE FROM embeddings WHERE source_type = ? AND source_id = ?",
      args: [source, sourceId],
    });
  }

  async search(
    queryEmbedding: number[] | Float32Array,
    k: number,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]> {
    const db = getDb();
    const sources = filter?.sources ?? null;
    const minScore = filter?.minScore ?? 0;
    const vecStr = vecToString(queryEmbedding);

    let sql: string;
    let args: unknown[];
    if (sources && sources.length > 0) {
      const placeholders = sources.map(() => "?").join(",");
      sql = `SELECT e.source_type, e.source_id, e.metadata,
                    vector_distance_cos(e.vector, vector(?)) AS distance,
                    c.chunk_id, c.text
             FROM embeddings e
             LEFT JOIN rag_chunks c
               ON c.source = e.source_type AND c.source_id = e.source_id
             WHERE e.source_type IN (${placeholders})
             ORDER BY distance ASC
             LIMIT ?`;
      args = [vecStr, ...sources, k * 2];
    } else {
      sql = `SELECT e.source_type, e.source_id, e.metadata,
                    vector_distance_cos(e.vector, vector(?)) AS distance,
                    c.chunk_id, c.text
             FROM embeddings e
             LEFT JOIN rag_chunks c
               ON c.source = e.source_type AND c.source_id = e.source_id
             ORDER BY distance ASC
             LIMIT ?`;
      args = [vecStr, k * 2];
    }
    const result = await db.execute({ sql, args });

    const out: RetrievalResult[] = [];
    for (const row of result.rows) {
      const distance = Number(row.distance);
      // libSQL vector_distance_cos returns 1 - cosine_similarity for
      // normalized vectors (range [0..2]; lower = closer). Convert back.
      const score = 1 - distance;
      if (score < minScore) continue;
      const sourceType = row.source_type as string;
      const sourceId = row.source_id as string;
      out.push({
        chunkId: (row.chunk_id as string) || `${sourceType}:${sourceId}`,
        source: sourceType as ChunkSource,
        sourceId,
        text: (row.text as string) || "",
        score,
        metadata: row.metadata
          ? safeJson((row.metadata as string) || null)
          : undefined,
      });
      if (out.length >= k) break;
    }
    return out;
  }

  async deleteAll(): Promise<void> {
    const db = getDb();
    await db.execute("DELETE FROM rag_chunks");
    // Do NOT touch embeddings table — it serves the FEAT042 callers and
    // gets cleared via FEAT042's own paths if needed. The new RAG path
    // re-populates as it indexes; matching rows are INSERT OR REPLACE.
  }

  async count(filter?: SearchFilter): Promise<number> {
    const db = getDb();
    const sources = filter?.sources ?? null;
    if (sources && sources.length > 0) {
      const placeholders = sources.map(() => "?").join(",");
      const r = await db.execute({
        sql: `SELECT COUNT(*) AS c FROM rag_chunks WHERE source IN (${placeholders})`,
        args: sources,
      });
      return Number(r.rows[0].c);
    }
    const r = await db.execute("SELECT COUNT(*) AS c FROM rag_chunks");
    return Number(r.rows[0].c);
  }

  async countMismatched(currentModelId: string): Promise<number> {
    const db = getDb();
    const r = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM rag_chunks WHERE model_id != ?",
      args: [currentModelId],
    });
    return Number(r.rows[0].c);
  }

  async getAllIds(): Promise<string[]> {
    const db = getDb();
    const r = await db.execute("SELECT chunk_id FROM rag_chunks");
    return r.rows.map((row) => row.chunk_id as string);
  }
}

function safeJson(s: string | null): Record<string, unknown> | undefined {
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
