/**
 * FEAT042 — Vector embedding DB queries.
 *
 * Uses libSQL's vector() function for storage and vector_distance_cos()
 * for brute-force cosine similarity search. No native vector index needed
 * at personal-app scale (< 10K embeddings).
 */
import { getDb } from "../index";

/** Convert a Float32Array to the string format libSQL's vector() expects. */
function vecToString(vec: Float32Array): string {
  return "[" + Array.from(vec).join(",") + "]";
}

/** Upsert an embedding. Replaces if source_type+source_id already exists. */
export async function upsertEmbedding(
  sourceType: string,
  sourceId: string,
  vector: Float32Array,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO embeddings (source_type, source_id, vector, metadata, created_at)
          VALUES (?, ?, vector(?), ?, datetime('now'))`,
    args: [
      sourceType,
      sourceId,
      vecToString(vector),
      metadata ? JSON.stringify(metadata) : null,
    ],
  });
}

/** Delete an embedding by source. */
export async function deleteEmbedding(
  sourceType: string,
  sourceId: string
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM embeddings WHERE source_type = ? AND source_id = ?",
    args: [sourceType, sourceId],
  });
}

export interface VectorMatch {
  sourceType: string;
  sourceId: string;
  distance: number;
  metadata: string | null;
}

/** Find top-k similar items by cosine distance across given source types. */
export async function searchSimilar(
  queryVector: Float32Array,
  sourceTypes: string[],
  limit: number = 10,
  maxDistance: number = 0.5
): Promise<VectorMatch[]> {
  if (sourceTypes.length === 0) return [];
  const db = getDb();
  const vecStr = vecToString(queryVector);
  const placeholders = sourceTypes.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT source_type, source_id, metadata,
                 vector_distance_cos(vector, vector(?)) as distance
          FROM embeddings
          WHERE source_type IN (${placeholders})
          ORDER BY distance ASC
          LIMIT ?`,
    args: [vecStr, ...sourceTypes, limit],
  });
  return result.rows
    .filter((r) => Number(r.distance) <= maxDistance)
    .map((r) => ({
      sourceType: r.source_type as string,
      sourceId: r.source_id as string,
      distance: Number(r.distance),
      metadata: (r.metadata as string) || null,
    }));
}

/** Count embeddings, optionally filtered by source type. */
export async function countEmbeddings(sourceType?: string): Promise<number> {
  const db = getDb();
  const result = sourceType
    ? await db.execute({
        sql: "SELECT COUNT(*) as c FROM embeddings WHERE source_type = ?",
        args: [sourceType],
      })
    : await db.execute("SELECT COUNT(*) as c FROM embeddings");
  return Number(result.rows[0].c);
}

/** Get source IDs from a table that don't have embeddings yet. */
export async function findUnindexed(
  sourceType: string,
  sourceTable: string,
  idColumn: string = "id"
): Promise<string[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT t."${idColumn}" as id FROM "${sourceTable}" t
          LEFT JOIN embeddings e ON e.source_type = ? AND e.source_id = CAST(t."${idColumn}" AS TEXT)
          WHERE e.id IS NULL`,
    args: [sourceType],
  });
  return result.rows.map((r) => String(r.id));
}
