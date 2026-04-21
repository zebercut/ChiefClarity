import { getDb } from "../index";
import type { SqlValue } from "../types";
import type { Task, TasksFile } from "../../types";
import { loadFileSummary, saveFileSummary } from "./summaries";

export async function loadTasks(): Promise<TasksFile> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM tasks ORDER BY created_at DESC");
  const summary = await loadFileSummary("tasks");
  return {
    _summary: summary,
    tasks: rows.rows.map(rowToTask),
  };
}

export async function insertTask(task: Task): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO tasks
          (id, title, due, priority, status, category, subcategory,
           okr_link, conflict_status, conflict_reason, conflict_with,
           notes, time_allocated, related_calendar, related_inbox,
           created_at, completed_at, dismissed_at, comments)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      task.id, task.title, task.due || null, task.priority, task.status,
      task.category || "", task.subcategory || "", task.okrLink || null,
      task.conflictStatus || "ok", task.conflictReason || "",
      JSON.stringify(task.conflictWith || []), task.notes || "",
      task.timeAllocated || "", JSON.stringify(task.relatedCalendar || []),
      JSON.stringify(task.relatedInbox || []), task.createdAt,
      task.completedAt || null, task.dismissedAt || null,
      JSON.stringify(task.comments || []),
    ],
  });
}

export async function updateTask(
  id: string,
  fields: Partial<Task>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: SqlValue[] = [];
  const sv = (v: unknown): SqlValue => (v ?? null) as SqlValue;
  const map: Record<string, (v: unknown) => SqlValue> = {
    title: sv,
    due: (v) => (v || null) as SqlValue,
    priority: sv,
    status: sv,
    category: (v) => (v || "") as SqlValue,
    subcategory: (v) => (v || "") as SqlValue,
    okrLink: (v) => (v || null) as SqlValue,
    conflictStatus: (v) => (v || "ok") as SqlValue,
    conflictReason: (v) => (v || "") as SqlValue,
    conflictWith: (v) => JSON.stringify(v || []),
    notes: (v) => (v || "") as SqlValue,
    timeAllocated: (v) => (v || "") as SqlValue,
    relatedCalendar: (v) => JSON.stringify(v || []),
    relatedInbox: (v) => JSON.stringify(v || []),
    completedAt: (v) => (v || null) as SqlValue,
    dismissedAt: (v) => (v || null) as SqlValue,
    comments: (v) => JSON.stringify(v || []),
  };
  const colMap: Record<string, string> = {
    okrLink: "okr_link",
    conflictStatus: "conflict_status",
    conflictReason: "conflict_reason",
    conflictWith: "conflict_with",
    timeAllocated: "time_allocated",
    relatedCalendar: "related_calendar",
    relatedInbox: "related_inbox",
    completedAt: "completed_at",
    dismissedAt: "dismissed_at",
  };
  for (const [key, transform] of Object.entries(map)) {
    if (key in fields) {
      const col = colMap[key] || key;
      sets.push(`${col} = ?`);
      args.push(transform((fields as Record<string, unknown>)[key]));
    }
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({
    sql: `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deleteTask(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "DELETE FROM tasks WHERE id = ?", args: [id] });
}

export async function saveTasksSummary(summary: string): Promise<void> {
  await saveFileSummary("tasks", summary);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    due: (row.due as string) ?? "",
    priority: (row.priority as Task["priority"]) || "medium",
    status: (row.status as Task["status"]) || "pending",
    category: (row.category as string) ?? "",
    subcategory: (row.subcategory as string) ?? "",
    okrLink: (row.okr_link as string) || null,
    conflictStatus: (row.conflict_status as Task["conflictStatus"]) || "ok",
    conflictReason: (row.conflict_reason as string) ?? "",
    conflictWith: safeJsonArray(row.conflict_with),
    notes: (row.notes as string) ?? "",
    createdAt: (row.created_at as string) ?? "",
    completedAt: (row.completed_at as string) || null,
    dismissedAt: (row.dismissed_at as string) || null,
    comments: safeJsonArray(row.comments) as any || [],
    timeAllocated: (row.time_allocated as string) ?? "",
    relatedCalendar: safeJsonArray(row.related_calendar),
    relatedInbox: safeJsonArray(row.related_inbox),
  };
}

function safeJsonArray(val: unknown): string[] {
  if (!val || val === "[]") return [];
  try {
    return JSON.parse(val as string);
  } catch {
    return [];
  }
}
