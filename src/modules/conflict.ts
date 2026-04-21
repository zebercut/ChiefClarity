import type { AppState, WriteOperation } from "../types";

export function checkConflicts(
  _keysToCheck: string[],
  writes: WriteOperation[],
  state: AppState
): string[] {
  const conflicts: string[] = [];

  for (const write of writes) {
    if (write.action !== "add") continue;
    const title = (write.data.title ?? "") as string;

    // Only check TIME overlaps for items with actual datetimes (not date-only due fields)
    // A datetime has 'T' in it (e.g. "2026-04-03T09:30:00"), a due date doesn't
    const datetime = (write.data.datetime as string) || "";
    if (datetime && datetime.includes("T") && !datetime.endsWith("T00:00:00")) {
      conflicts.push(...checkTimeOverlap(datetime, title, write, state));
    }

    // Duplicate title check works for any item with a title
    if (title) {
      conflicts.push(...checkDuplicateTitle(title, write.file, state));
    }
  }

  // Deduplicate conflict messages
  return [...new Set(conflicts)];
}

function checkTimeOverlap(
  datetimeStr: string,
  title: string,
  write: WriteOperation,
  state: AppState
): string[] {
  const newDt = safeParseDate(datetimeStr);
  if (!newDt) return [];

  const dateKey = datetimeStr.slice(0, 10);
  const candidates = state.contradictionIndex.byDate[dateKey] ?? [];
  const conflicts: string[] = [];

  for (const candidateId of candidates) {
    const existing = findRecord(candidateId, state);
    if (!existing) continue;

    // Only check against items that have actual datetimes (not date-only)
    const existingDtStr = (existing.datetime as string) || "";
    if (!existingDtStr || !existingDtStr.includes("T") || existingDtStr.endsWith("T00:00:00")) continue;

    const existingDt = safeParseDate(existingDtStr);
    if (!existingDt) continue;

    // Real interval overlap: startA < endB && startB < endA
    const newDuration = (write.data.durationMinutes as number) || (write.data.duration as number) || 30;
    const existingDuration = (existing.durationMinutes as number) || (existing.duration as number) || 30;
    const newEnd = newDt.getTime() + newDuration * 60000;
    const existingEnd = existingDt.getTime() + existingDuration * 60000;

    if (newDt.getTime() < existingEnd && existingDt.getTime() < newEnd) {
      conflicts.push(
        `"${title}" conflicts with "${existing.title}" at ${existingDt.toTimeString().slice(0, 5)}`
      );
    }
  }

  return conflicts;
}

function checkDuplicateTitle(
  title: string,
  fileKey: string,
  state: AppState
): string[] {
  if (!title || !fileKey) return [];
  const lower = title.toLowerCase().trim();
  const file = (state as any)[fileKey];
  if (!file) return [];

  for (const listKey of ["tasks", "events", "items"] as const) {
    const list = file[listKey];
    if (!Array.isArray(list)) continue;
    if (
      list.some(
        (r: any) =>
          r.title?.toLowerCase().trim() === lower && r.status !== "done"
      )
    ) {
      return [`"${title}" already exists as an open item.`];
    }
  }

  return [];
}

function findRecord(
  id: string,
  state: AppState
): Record<string, unknown> | null {
  // Only search known data file keys, not internal state (_dirty, _pendingContext)
  const dataKeys = ["tasks", "calendar", "suggestionsLog", "learningLog"] as const;
  for (const key of dataKeys) {
    const file = (state as any)[key];
    if (!file || typeof file !== "object") continue;
    for (const listKey of ["tasks", "events", "items", "suggestions"]) {
      const list = file[listKey];
      if (!Array.isArray(list)) continue;
      const found = list.find((r: any) => r.id === id);
      if (found) return found as Record<string, unknown>;
    }
  }
  return null;
}

function safeParseDate(str: string): Date | null {
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
