/**
 * FEAT042 — Cross-domain linker.
 *
 * Auto-populates task_calendar_links and task_note_links by finding
 * semantically similar items via vector search. Runs after a task
 * or event is indexed.
 */
import { searchSimilar } from "../../db/queries/embeddings";
import { getDb } from "../../db/index";
import { embed } from "./provider";
import { nowLocalIso } from "../../utils/dates";

const SIMILARITY_THRESHOLD = 0.3; // cosine distance (lower = more similar)
const MAX_LINKS = 5;

/**
 * After a task is indexed, find and link related events and notes.
 */
export async function linkTask(
  taskId: string,
  taskText: string,
  precomputedVec?: Float32Array | null
): Promise<void> {
  let queryVec: Float32Array | null;
  try {
    queryVec = precomputedVec ?? await embed(taskText);
  } catch {
    return; // model not ready yet
  }
  if (!queryVec) return;
  const db = getDb();
  const now = nowLocalIso();

  // Find similar calendar events
  const events = await searchSimilar(
    queryVec,
    ["event"],
    MAX_LINKS,
    SIMILARITY_THRESHOLD
  );
  for (const match of events) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_calendar_links (task_id, event_id, similarity, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [taskId, match.sourceId, 1 - match.distance, now],
    });
  }

  // Find similar notes
  const notes = await searchSimilar(
    queryVec,
    ["note"],
    MAX_LINKS,
    SIMILARITY_THRESHOLD
  );
  for (const match of notes) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_note_links (task_id, note_id, similarity, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [taskId, match.sourceId, 1 - match.distance, now],
    });
  }
}

/**
 * After an event is indexed, find and link related tasks.
 */
export async function linkEvent(
  eventId: string,
  eventText: string,
  precomputedVec?: Float32Array | null
): Promise<void> {
  let queryVec: Float32Array | null;
  try {
    queryVec = precomputedVec ?? await embed(eventText);
  } catch {
    return;
  }
  if (!queryVec) return;
  const db = getDb();
  const now = nowLocalIso();

  const tasks = await searchSimilar(
    queryVec,
    ["task"],
    MAX_LINKS,
    SIMILARITY_THRESHOLD
  );
  for (const match of tasks) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_calendar_links (task_id, event_id, similarity, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [match.sourceId, eventId, 1 - match.distance, now],
    });
  }
}

/**
 * Get linked items for a task (for assembler/UI context).
 */
export async function getTaskLinks(taskId: string): Promise<{
  events: Array<{ eventId: string; similarity: number }>;
  notes: Array<{ noteId: string; similarity: number }>;
}> {
  const db = getDb();
  const eventRows = await db.execute({
    sql: "SELECT event_id, similarity FROM task_calendar_links WHERE task_id = ? ORDER BY similarity DESC",
    args: [taskId],
  });
  const noteRows = await db.execute({
    sql: "SELECT note_id, similarity FROM task_note_links WHERE task_id = ? ORDER BY similarity DESC",
    args: [taskId],
  });
  return {
    events: eventRows.rows.map((r) => ({
      eventId: r.event_id as string,
      similarity: Number(r.similarity),
    })),
    notes: noteRows.rows.map((r) => ({
      noteId: r.note_id as string,
      similarity: Number(r.similarity),
    })),
  };
}
