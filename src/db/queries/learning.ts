import { getDb } from "../index";
import type { LearningLog, LearningItem } from "../../types";
import { loadFileSummary, saveFileSummary } from "./summaries";

export async function loadLearning(): Promise<LearningLog> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM learning_items ORDER BY created_at DESC");
  const summary = await loadFileSummary("learningLog");
  return {
    _summary: summary,
    items: rows.rows.map((r) => ({
      id: r.id as string,
      topic: (r.topic as string) ?? "",
      source: (r.source as string) ?? "",
      status: (r.status as LearningItem["status"]) || "active",
      createdAt: (r.created_at as string) ?? "",
      nextReview: (r.next_review as string) ?? "",
      reviewCount: Number(r.review_count) || 0,
      masteryLevel: Number(r.mastery_level) || 0,
      notes: (r.notes as string) ?? "",
    })),
  };
}

export async function insertLearningItem(item: LearningItem): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO learning_items
          (id, topic, source, status, created_at, next_review,
           review_count, mastery_level, notes)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      item.id, item.topic || "", item.source || "", item.status || "active",
      item.createdAt, item.nextReview || "", item.reviewCount ?? 0,
      item.masteryLevel ?? 0, item.notes || "",
    ],
  });
}

export async function saveLearning(log: LearningLog): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM learning_items");
  for (const item of log.items) {
    await insertLearningItem(item);
  }
  await saveFileSummary("learningLog", log._summary || "");
}
