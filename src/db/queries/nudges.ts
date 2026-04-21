import { getDb } from "../index";

export interface NudgeRow {
  id: string;
  type: string;
  priority: string;
  message: string;
  actions: unknown[];
  relatedId: string | null;
  createdAt: string;
  shownAt: string | null;
  dismissedAt: string | null;
}

export async function loadNudges(): Promise<NudgeRow[]> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM nudges ORDER BY created_at DESC");
  return rows.rows.map((r) => ({
    id: r.id as string,
    type: (r.type as string) ?? "",
    priority: (r.priority as string) ?? "",
    message: (r.message as string) ?? "",
    actions: (safeJsonParse(r.actions) as unknown[]) ?? [],
    relatedId: (r.related_id as string) || null,
    createdAt: (r.created_at as string) ?? "",
    shownAt: (r.shown_at as string) || null,
    dismissedAt: (r.dismissed_at as string) || null,
  }));
}

export async function saveNudges(nudges: NudgeRow[]): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM nudges");
  for (const n of nudges) {
    await db.execute({
      sql: `INSERT INTO nudges
            (id, type, priority, message, actions, related_id,
             created_at, shown_at, dismissed_at)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        n.id, n.type, n.priority, n.message,
        JSON.stringify(n.actions || []), n.relatedId || null,
        n.createdAt, n.shownAt || null, n.dismissedAt || null,
      ],
    });
  }
}

function safeJsonParse(val: unknown): unknown {
  if (!val) return undefined;
  try { return JSON.parse(val as string); } catch { return undefined; }
}
