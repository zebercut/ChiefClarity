import type { AppState, CalendarEvent } from "../types";

/**
 * Calendar Hygiene — keeps calendar.json lean and accurate.
 *
 * Daily hygiene: archive past events, clean recurring instances.
 * Weekly hygiene: deeper cleanup of cancelled/old events.
 *
 * Uses `archived` flag on events (same file, no separate archive).
 * Assembler filters out archived events from LLM context.
 *
 * All date comparisons use user timezone from state.userProfile.timezone.
 */

export interface HygieneResult {
  archived: number;
  orphansFound: number;
  duplicatesRemoved: number;
}

/**
 * Daily hygiene — run every morning before plan generation.
 *
 * 1. Archive past events (datetime < today) that are still "scheduled"
 *    — don't mark as "completed", just archive. User didn't confirm completion.
 * 2. Archive recurring instances from yesterday or earlier (aggressive cleanup)
 * 3. Flag orphaned events (linked to tasks that no longer exist)
 */
export function runDailyHygiene(state: AppState): HygieneResult {
  const today = getToday(state);
  const events = state.calendar.events;
  let archived = 0;
  let orphansFound = 0;

  for (const event of events) {
    if (event.archived) continue;

    const eventDate = event.datetime?.slice(0, 10);
    if (!eventDate || eventDate >= today) continue; // skip future/undated events

    // Past event — decide how to handle based on type

    // Recurring instances: always archive if past (recreated daily)
    if (event.isRecurringInstance) {
      event.archived = true;
      archived++;
      continue;
    }

    // Regular scheduled events: archive (we don't assume completed)
    if (event.status === "scheduled") {
      event.archived = true;
      archived++;
      continue;
    }

    // Completed regular events older than 7 days: archive
    if (event.status === "completed" && dateOffset(eventDate, 7) < today) {
      event.archived = true;
      archived++;
      continue;
    }
  }

  if (archived > 0) {
    state._dirty.add("calendar");
    console.log(`[hygiene] daily: archived ${archived} past event(s)`);
  }

  return { archived, orphansFound, duplicatesRemoved: 0 };
}

/**
 * Weekly hygiene — deeper cleanup once per week.
 *
 * 1. Everything from daily hygiene
 * 2. Remove cancelled events older than 7 days (not just archive — delete)
 * 3. Remove archived events older than 30 days (keep file under control)
 * 4. Remove duplicate events (same title + datetime within 5 minutes)
 */
export function runWeeklyHygiene(state: AppState): HygieneResult {
  const today = getToday(state);
  const dailyResult = runDailyHygiene(state);

  const sevenDaysAgo = dateOffset(today, -7);
  const thirtyDaysAgo = dateOffset(today, -30);

  let removed = 0;
  const before = state.calendar.events.length;

  // Remove events with no datetime (orphaned/malformed — can never be scheduled)
  state.calendar.events = state.calendar.events.filter((e) => {
    if (!e.datetime) { removed++; return false; }
    return true;
  });

  // Remove cancelled events older than 7 days
  state.calendar.events = state.calendar.events.filter((e) => {
    if (e.status === "cancelled" && e.datetime?.slice(0, 10) < sevenDaysAgo) {
      removed++;
      return false;
    }
    return true;
  });

  // Remove archived events older than 30 days
  state.calendar.events = state.calendar.events.filter((e) => {
    if (e.archived && e.datetime?.slice(0, 10) < thirtyDaysAgo) {
      removed++;
      return false;
    }
    return true;
  });

  // Remove duplicates (same title + datetime within 5 minutes)
  const dupsRemoved = removeDuplicateEvents(state);

  if (removed > 0 || dupsRemoved > 0) {
    state._dirty.add("calendar");
  }

  const totalArchived = dailyResult.archived;
  const totalRemoved = removed + dupsRemoved;
  if (totalArchived > 0 || totalRemoved > 0) {
    console.log(`[hygiene] weekly: archived ${totalArchived}, removed ${totalRemoved} (${dupsRemoved} duplicates)`);
  }

  return {
    archived: totalArchived,
    orphansFound: dailyResult.orphansFound,
    duplicatesRemoved: dupsRemoved,
  };
}

/**
 * Check if a new event is a duplicate of an existing one.
 * Used by the executor before adding a new calendar event.
 *
 * Returns the existing event if duplicate found, null otherwise.
 */
export function findDuplicateEvent(
  events: CalendarEvent[],
  title: string,
  datetime: string
): CalendarEvent | null {
  if (!title || !datetime) return null;
  const normalizedTitle = title.toLowerCase().trim();
  const newTime = new Date(datetime).getTime();
  if (isNaN(newTime)) return null;

  for (const event of events) {
    if (event.archived || event.status === "cancelled") continue;

    // Title similarity: exact match, or substring only if the shorter is >= 60% of the longer
    const existingTitle = event.title.toLowerCase().trim();
    const titleMatch = titlesMatch(normalizedTitle, existingTitle);

    if (!titleMatch) continue;

    // Time proximity: within 30 minutes
    const existingTime = new Date(event.datetime).getTime();
    if (isNaN(existingTime)) continue;
    const diffMinutes = Math.abs(newTime - existingTime) / 60000;

    if (diffMinutes <= 30) {
      return event;
    }
  }

  return null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function removeDuplicateEvents(state: AppState): number {
  const events = state.calendar.events;
  const active = events.filter((e) => !e.archived && e.status !== "cancelled" && e.title && e.datetime);
  const toRemoveIds = new Set<string>();

  // Pairwise comparison — no bucket boundaries to miss
  for (let i = 0; i < active.length; i++) {
    if (toRemoveIds.has(active[i].id)) continue;
    for (let j = i + 1; j < active.length; j++) {
      if (toRemoveIds.has(active[j].id)) continue;

      const a = active[i];
      const b = active[j];

      // Title match
      if (!titlesMatch(a.title.toLowerCase().trim(), b.title.toLowerCase().trim())) continue;

      // Time proximity: within 30 minutes
      const aTime = new Date(a.datetime).getTime();
      const bTime = new Date(b.datetime).getTime();
      if (isNaN(aTime) || isNaN(bTime)) continue;
      if (Math.abs(aTime - bTime) / 60000 > 30) continue;

      // Duplicate found — keep the one with more data
      const keepA = (a.notes?.length || 0) >= (b.notes?.length || 0);
      toRemoveIds.add(keepA ? b.id : a.id);
    }
  }

  if (toRemoveIds.size > 0) {
    state.calendar.events = events.filter((e) => !toRemoveIds.has(e.id));
  }

  return toRemoveIds.size;
}

/**
 * Title matching: exact match, or substring only if shorter is >= 60% of longer.
 * Prevents "Call" matching "Conference Call with Legal Team".
 */
function titlesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  // Substring must be at least 60% of the longer title
  if (shorter.length < longer.length * 0.6) return false;
  return longer.includes(shorter);
}

function getToday(state: AppState): string {
  if (state.hotContext?.today) return state.hotContext.today;
  // Fallback: use user timezone if available
  const tz = state.userProfile?.timezone || undefined;
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

function dateOffset(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
