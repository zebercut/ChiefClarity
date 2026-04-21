/**
 * FEAT042 — Semantic retriever for the assembler.
 *
 * Embeds the user's phrase and fetches top-k relevant items from the
 * vector store, joined back to their source tables for full data.
 * Node-only — injected into the assembler at proxy/headless startup.
 */
import { embed } from "./provider";
import { searchSimilar, type VectorMatch } from "../../db/queries/embeddings";
import { getDb } from "../../db/index";

export interface RetrievedItem {
  sourceType: string;
  sourceId: string;
  distance: number;
  data: Record<string, unknown>;
}

/** Source types to query per intent. */
const INTENT_SOURCES: Record<string, string[]> = {
  info_lookup: ["task", "event", "fact", "note", "observation"],
  general: ["task", "event", "fact", "observation"],
  topic_query: ["fact", "note", "observation", "task"],
  task_query: ["task", "fact"],
  calendar_query: ["event", "task"],
};

const SOURCE_TABLE_MAP: Record<string, string> = {
  task: "tasks",
  event: "calendar_events",
  note: "notes",
  fact: "facts",
  observation: "user_observations",
};

/**
 * Retrieve top-k semantically relevant items for a user phrase + intent.
 * Returns full relational data joined from the source tables.
 */
export async function retrieveContext(
  phrase: string,
  intentType: string,
  limit: number = 15
): Promise<RetrievedItem[]> {
  const sourceTypes = INTENT_SOURCES[intentType];
  if (!sourceTypes) return [];

  let queryVec: Float32Array | null;
  try {
    queryVec = await embed(phrase);
  } catch {
    return []; // model not ready
  }
  if (!queryVec) return [];

  const matches = await searchSimilar(queryVec, sourceTypes, limit, 0.5);
  if (matches.length === 0) return [];

  // Join matches back to source tables for full data
  const db = getDb();
  const results: RetrievedItem[] = [];

  for (const match of matches) {
    const table = SOURCE_TABLE_MAP[match.sourceType];
    if (!table) continue;
    try {
      const rows = await db.execute({
        sql: `SELECT * FROM "${table}" WHERE id = ?`,
        args: [match.sourceId],
      });
      if (rows.rows.length > 0) {
        results.push({
          sourceType: match.sourceType,
          sourceId: match.sourceId,
          distance: match.distance,
          data: rows.rows[0] as Record<string, unknown>,
        });
      }
    } catch {
      // Row may have been deleted between embedding and query — skip
    }
  }

  return results;
}
