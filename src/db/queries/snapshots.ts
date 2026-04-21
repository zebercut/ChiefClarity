import { getDb } from "../index";

/**
 * Load a whole-object snapshot. Returns the parsed object or null if not found.
 */
export async function loadSnapshot<T>(key: string): Promise<T | null> {
  const db = getDb();
  const res = await db.execute({
    sql: "SELECT value FROM snapshots WHERE key = ?",
    args: [key],
  });
  if (res.rows.length === 0) return null;
  try {
    return JSON.parse(res.rows[0].value as string) as T;
  } catch {
    return null;
  }
}

/**
 * Save a whole-object snapshot. Overwrites any existing value.
 */
export async function saveSnapshot(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO snapshots (key, value, updated_at)
          VALUES (?, ?, ?)`,
    args: [key, JSON.stringify(value), new Date().toISOString()],
  });
}
