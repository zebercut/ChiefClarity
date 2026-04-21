import { getDb } from "../index";
import type { SqlValue } from "../types";
import type { RecurringTask, RecurringTasksFile } from "../../types";

export async function loadRecurring(): Promise<RecurringTasksFile> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM recurring_tasks ORDER BY created_at");
  return {
    recurring: rows.rows.map(rowToRecurring),
  };
}

export async function insertRecurring(task: RecurringTask): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO recurring_tasks
          (id, title, schedule, category, priority, okr_link,
           duration, notes, active, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      task.id, task.title, JSON.stringify(task.schedule),
      task.category || "", task.priority || "medium",
      task.okrLink || null, task.duration ?? null,
      task.notes ?? null, task.active ? 1 : 0, task.createdAt,
    ],
  });
}

export async function updateRecurring(
  id: string,
  fields: Partial<RecurringTask>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: SqlValue[] = [];
  const simple: Record<string, string> = {
    title: "title",
    category: "category",
    priority: "priority",
    okrLink: "okr_link",
    duration: "duration",
    notes: "notes",
  };
  for (const [ts, col] of Object.entries(simple)) {
    if (ts in fields) {
      sets.push(`${col} = ?`);
      args.push(((fields as Record<string, unknown>)[ts] ?? null) as SqlValue);
    }
  }
  if ("schedule" in fields) {
    sets.push("schedule = ?");
    args.push(JSON.stringify(fields.schedule));
  }
  if ("active" in fields) {
    sets.push("active = ?");
    args.push(fields.active ? 1 : 0);
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({
    sql: `UPDATE recurring_tasks SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deleteRecurring(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "DELETE FROM recurring_tasks WHERE id = ?", args: [id] });
}

function rowToRecurring(row: Record<string, unknown>): RecurringTask {
  let schedule;
  try { schedule = JSON.parse(row.schedule as string); } catch { schedule = { type: "daily" }; }
  return {
    id: row.id as string,
    title: row.title as string,
    schedule,
    category: (row.category as string) ?? "",
    priority: (row.priority as RecurringTask["priority"]) || "medium",
    okrLink: (row.okr_link as string) || null,
    duration: row.duration != null ? Number(row.duration) : undefined,
    notes: (row.notes as string) || undefined,
    active: row.active === 1,
    createdAt: (row.created_at as string) ?? "",
  };
}
