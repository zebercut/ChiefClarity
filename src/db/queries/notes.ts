import { getDb } from "../index";
import type { SqlValue } from "../types";
import type { Note, NotesFile } from "../../types";
import { loadFileSummary, saveFileSummary } from "./summaries";

export async function loadNotes(): Promise<NotesFile> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM notes ORDER BY created_at DESC");
  const summary = await loadFileSummary("notes");
  return {
    _summary: summary,
    notes: rows.rows.map(rowToNote),
  };
}

export async function insertNote(note: Note): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO notes
          (id, text, status, created_at, processed_at, write_count,
           processed_summary, attempt_count, last_error)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      note.id, note.text, note.status || "pending", note.createdAt,
      note.processedAt || null, note.writeCount ?? 0,
      note.processedSummary || null, note.attemptCount ?? 0,
      note.lastError || null,
    ],
  });
}

export async function updateNote(
  id: string,
  fields: Partial<Note>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: SqlValue[] = [];
  const simple: Record<string, string> = {
    text: "text",
    status: "status",
    processedAt: "processed_at",
    writeCount: "write_count",
    processedSummary: "processed_summary",
    attemptCount: "attempt_count",
    lastError: "last_error",
  };
  for (const [ts, col] of Object.entries(simple)) {
    if (ts in fields) {
      sets.push(`${col} = ?`);
      args.push(((fields as Record<string, unknown>)[ts] ?? null) as SqlValue);
    }
  }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({
    sql: `UPDATE notes SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deleteNote(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "DELETE FROM notes WHERE id = ?", args: [id] });
}

export async function saveNotesSummary(summary: string): Promise<void> {
  await saveFileSummary("notes", summary);
}

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    text: (row.text as string) ?? "",
    status: (row.status as Note["status"]) || "pending",
    createdAt: (row.created_at as string) ?? "",
    processedAt: (row.processed_at as string) || null,
    writeCount: Number(row.write_count) || 0,
    processedSummary: (row.processed_summary as string) || null,
    attemptCount: Number(row.attempt_count) || 0,
    lastError: (row.last_error as string) || null,
  };
}
