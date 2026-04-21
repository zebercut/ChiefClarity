import { getDb } from "../index";
import type { SqlValue } from "../types";
import type { CalendarEvent, CalendarFile } from "../../types";
import { loadFileSummary, saveFileSummary } from "./summaries";

export async function loadCalendar(): Promise<CalendarFile> {
  const db = getDb();
  const rows = await db.execute(
    "SELECT * FROM calendar_events ORDER BY datetime ASC"
  );
  const summary = await loadFileSummary("calendar");
  return {
    _summary: summary,
    events: rows.rows.map(rowToEvent),
  };
}

export async function insertEvent(event: CalendarEvent): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const createdAt = (event as unknown as { createdAt?: string }).createdAt || now;
  await db.execute({
    sql: `INSERT OR REPLACE INTO calendar_events
          (id, title, datetime, duration_minutes, status, type, priority,
           notes, related_inbox, archived, is_recurring_inst, created_at, updated_at,
           source_integration, source_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      event.id || "", event.title || "", event.datetime || "",
      event.durationMinutes != null ? event.durationMinutes : 60,
      event.status || "scheduled",
      event.type || "", event.priority || "", event.notes || "",
      JSON.stringify(event.relatedInbox || []),
      event.archived ? 1 : 0, event.isRecurringInstance ? 1 : 0,
      createdAt, now,
      event.sourceIntegration || null, event.sourceId || null,
    ],
  });
}

export async function updateEvent(
  id: string,
  fields: Partial<CalendarEvent>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: SqlValue[] = [];
  const sv = (v: unknown): SqlValue => (v ?? null) as SqlValue;
  const map: Record<string, (v: unknown) => SqlValue> = {
    title: sv,
    datetime: sv,
    durationMinutes: (v) => (v ?? 60) as SqlValue,
    status: (v) => (v || "scheduled") as SqlValue,
    type: (v) => (v || "") as SqlValue,
    priority: (v) => (v || "") as SqlValue,
    notes: (v) => (v || "") as SqlValue,
    relatedInbox: (v) => JSON.stringify(v || []),
    archived: (v) => v ? 1 : 0,
    isRecurringInstance: (v) => v ? 1 : 0,
    sourceIntegration: (v) => (v || null) as SqlValue,
    sourceId: (v) => (v || null) as SqlValue,
  };
  const colMap: Record<string, string> = {
    durationMinutes: "duration_minutes",
    relatedInbox: "related_inbox",
    isRecurringInstance: "is_recurring_inst",
    sourceIntegration: "source_integration",
    sourceId: "source_id",
  };
  for (const [key, transform] of Object.entries(map)) {
    if (key in fields) {
      const col = colMap[key] || key;
      sets.push(`${col} = ?`);
      args.push(transform((fields as Record<string, unknown>)[key]));
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  args.push(new Date().toISOString());
  args.push(id);
  await db.execute({
    sql: `UPDATE calendar_events SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });
}

export async function deleteEvent(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM calendar_events WHERE id = ?",
    args: [id],
  });
}

export async function saveCalendarSummary(summary: string): Promise<void> {
  await saveFileSummary("calendar", summary);
}

function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    title: row.title as string,
    datetime: (row.datetime as string) ?? "",
    durationMinutes: Number(row.duration_minutes) || 60,
    status: (row.status as CalendarEvent["status"]) || "scheduled",
    type: (row.type as string) ?? "",
    priority: (row.priority as string) ?? "",
    notes: (row.notes as string) ?? "",
    relatedInbox: safeJsonArray(row.related_inbox),
    archived: row.archived === 1,
    isRecurringInstance: row.is_recurring_inst === 1,
    sourceIntegration: (row.source_integration as string) || undefined,
    sourceId: (row.source_id as string) || undefined,
  };
}

/** FEAT018: Upsert by source_id — insert if new, update if exists. Returns true if updated (vs inserted). */
export async function upsertBySourceId(event: CalendarEvent): Promise<boolean> {
  if (!event.sourceIntegration || !event.sourceId) {
    await insertEvent(event);
    return false;
  }
  const db = getDb();
  const existing = await db.execute({
    sql: "SELECT id FROM calendar_events WHERE source_integration = ? AND source_id = ?",
    args: [event.sourceIntegration, event.sourceId],
  });
  if (existing.rows.length > 0) {
    const existingId = existing.rows[0].id as string;
    await updateEvent(existingId, event);
    return true;
  }
  await insertEvent(event);
  return false;
}

/** FEAT018: Delete all events from a specific integration. */
export async function deleteBySourceIntegration(source: string): Promise<number> {
  const db = getDb();
  const count = await db.execute({
    sql: "SELECT COUNT(*) as c FROM calendar_events WHERE source_integration = ?",
    args: [source],
  });
  await db.execute({
    sql: "DELETE FROM calendar_events WHERE source_integration = ?",
    args: [source],
  });
  return Number(count.rows[0].c);
}

/** FEAT018: Get all source_ids for a given integration (for diff detection). */
export async function getSourceIds(source: string): Promise<Set<string>> {
  const db = getDb();
  const rows = await db.execute({
    sql: "SELECT source_id FROM calendar_events WHERE source_integration = ? AND status != 'cancelled'",
    args: [source],
  });
  return new Set(rows.rows.map((r) => r.source_id as string));
}

function safeJsonArray(val: unknown): string[] {
  if (!val || val === "[]") return [];
  try { return JSON.parse(val as string); } catch { return []; }
}
