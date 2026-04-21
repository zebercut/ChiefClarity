import { getDb } from "../index";

export interface AnnotationRow {
  id: string;
  targetId: string;
  targetType: string;
  targetTitle: string;
  comment: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export async function loadAnnotations(): Promise<AnnotationRow[]> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM annotations ORDER BY created_at DESC");
  return rows.rows.map((r) => ({
    id: r.id as string,
    targetId: r.target_id as string,
    targetType: (r.target_type as string) ?? "",
    targetTitle: (r.target_title as string) ?? "",
    comment: (r.comment as string) ?? "",
    createdAt: (r.created_at as string) ?? "",
    resolved: r.resolved === 1,
    resolvedAt: (r.resolved_at as string) || null,
    resolvedBy: (r.resolved_by as string) || null,
  }));
}

export async function insertAnnotation(a: AnnotationRow): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO annotations
          (id, target_id, target_type, target_title, comment,
           created_at, resolved, resolved_at, resolved_by)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      a.id, a.targetId, a.targetType, a.targetTitle, a.comment,
      a.createdAt, a.resolved ? 1 : 0, a.resolvedAt || null, a.resolvedBy || null,
    ],
  });
}

export async function saveAnnotations(annotations: AnnotationRow[]): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM annotations");
  for (const a of annotations) {
    await insertAnnotation(a);
  }
}
