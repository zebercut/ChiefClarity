import { getDb } from "../index";

export async function loadFileSummary(fileKey: string): Promise<string> {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT summary FROM file_summaries WHERE file_key = ?",
    args: [fileKey],
  });
  return (res.rows[0]?.summary as string) ?? "";
}

export async function saveFileSummary(
  fileKey: string,
  summary: string
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO file_summaries (file_key, summary) VALUES (?, ?)`,
    args: [fileKey, summary],
  });
}
