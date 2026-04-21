import { getDb } from "../index";
import type { TopicManifest, TopicEntry, TopicSuggestion, TopicSignal } from "../../types";

export async function loadTopics(): Promise<TopicManifest> {
  const db = getDb();
  const topicRows = await db.execute("SELECT * FROM topics ORDER BY created_at");
  const suggRows = await db.execute("SELECT * FROM topic_suggestions ORDER BY id");
  const rejRows = await db.execute("SELECT * FROM rejected_topics ORDER BY name");
  const sigRows = await db.execute("SELECT * FROM topic_signals ORDER BY id");

  return {
    topics: topicRows.rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      aliases: safeJsonArray(r.aliases),
      createdAt: (r.created_at as string) ?? "",
      archivedAt: (r.archived_at as string) || null,
      excludedIds: safeJsonArray(r.excluded_ids),
    })),
    pendingSuggestions: suggRows.rows.map((r) => ({
      topic: r.topic as string,
      count: Number(r.count) || 0,
      threshold: Number(r.threshold) || 3,
      status: (r.status as TopicSuggestion["status"]) || "accumulating",
      suggestedAt: (r.suggested_at as string) || undefined,
    })),
    rejectedTopics: rejRows.rows.map((r) => r.name as string),
    signals: sigRows.rows.map((r) => ({
      topic: r.topic as string,
      sourceType: r.source_type as TopicSignal["sourceType"],
      sourceId: r.source_id as string,
      date: r.date as string,
    })),
  };
}

export async function saveTopics(manifest: TopicManifest): Promise<void> {
  const db = getDb();
  // Wrap DELETE+re-INSERT in a transaction. Without this, a mid-loop INSERT
  // failure (e.g., unknown column from a not-yet-applied migration) would
  // leave the topics table empty after the initial DELETE.
  await db.execute("BEGIN");
  try {
    await db.execute("DELETE FROM topic_signals");
    await db.execute("DELETE FROM topic_suggestions");
    await db.execute("DELETE FROM rejected_topics");
    await db.execute("DELETE FROM topics");

    for (const t of manifest.topics) {
      await db.execute({
        sql: "INSERT INTO topics (id, name, aliases, created_at, archived_at, excluded_ids) VALUES (?,?,?,?,?,?)",
        args: [
          t.id,
          t.name,
          JSON.stringify(t.aliases || []),
          t.createdAt || "",
          t.archivedAt || null,
          JSON.stringify(t.excludedIds || []),
        ],
      });
    }
    for (const s of manifest.pendingSuggestions) {
      await db.execute({
        sql: `INSERT INTO topic_suggestions (topic, count, threshold, status, suggested_at)
              VALUES (?,?,?,?,?)`,
        args: [s.topic, s.count, s.threshold, s.status, s.suggestedAt || null],
      });
    }
    for (const name of manifest.rejectedTopics) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO rejected_topics (name) VALUES (?)",
        args: [name],
      });
    }
    for (const sig of manifest.signals || []) {
      await db.execute({
        sql: `INSERT INTO topic_signals (topic, source_type, source_id, date)
              VALUES (?,?,?,?)`,
        args: [sig.topic, sig.sourceType, sig.sourceId, sig.date],
      });
    }
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}

function safeJsonArray(val: unknown): string[] {
  if (!val) return [];
  try { return JSON.parse(val as string); } catch { return []; }
}
