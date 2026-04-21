import type { FocusBrief, DaySlot, AgendaEvent, CalendarSlot } from "../types";

/**
 * Merges routineTemplate + day exceptions into a full CalendarSlot[] for rendering.
 * This is the core of the compressed brief format:
 *   routine (sent once) + additions/removals/overrides (per day) -> full agenda
 *
 * Free blocks are RECALCULATED after merging — the LLM's pre-merge free blocks
 * don't account for routine items and are unreliable.
 */
export function mergeBriefToCalendar(brief: FocusBrief): CalendarSlot[] {
  // Legacy format — already has full calendar
  if (brief.calendar && brief.calendar.length > 0 && !brief.days) {
    return brief.calendar;
  }

  if (!brief.days || brief.days.length === 0) return [];

  const weekdayRoutine = brief.routineTemplate || [];
  const weekendRoutine = brief.weekendRoutineTemplate || [];

  return brief.days.map((day) => mergeDay(day, weekdayRoutine, weekendRoutine));
}

/**
 * Always returns 7 days starting from today.
 * Days that exist in the brief get their full merged data.
 * Days that DON'T exist get routine-only placeholders.
 * The weekly calendar is ALWAYS visible regardless of plan variant.
 */
export function mergeWeekCalendar(brief: FocusBrief, today: string): CalendarSlot[] {
  const weekdayRoutine = brief.routineTemplate || [];
  const weekendRoutine = brief.weekendRoutineTemplate || [];

  // Get any existing merged days from the brief
  const briefDays = mergeBriefToCalendar(brief);
  const briefDayMap = new Map<string, CalendarSlot>();
  for (const slot of briefDays) {
    briefDayMap.set(slot.date, slot);
  }

  // Also check _weekSnapshot for days not in the current brief
  const snapshot = (brief as any)._weekSnapshot;
  if (snapshot?.days) {
    for (const day of snapshot.days) {
      const date = day.date;
      if (!briefDayMap.has(date)) {
        // Merge this snapshot day using the routine
        const merged = mergeDay(day, weekdayRoutine, weekendRoutine);
        briefDayMap.set(date, merged);
      }
    }
  }

  // Build 7 days starting from today
  const result: CalendarSlot[] = [];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today + "T12:00:00");
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const existing = briefDayMap.get(dateStr);
    if (existing) {
      result.push(existing);
    } else {
      // No plan data for this day — show routine only
      const routine = isWeekend ? weekendRoutine : weekdayRoutine;
      const events = routine.map((ev) => ({ ...ev }));
      events.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[dayOfWeek];
      result.push({
        date: dateStr,
        dayLabel: label,
        events,
        freeBlocks: calculateFreeBlocks(events),
      });
    }
  }

  return result;
}

function mergeDay(
  day: DaySlot,
  weekdayRoutine: AgendaEvent[],
  weekendRoutine: AgendaEvent[]
): CalendarSlot {
  const baseRoutine = day.isWeekend ? weekendRoutine : weekdayRoutine;
  const additions = day.additions || [];

  // Start with routine, minus explicit removals
  const removals = new Set(day.removals || []);
  let routineEvents: AgendaEvent[] = baseRoutine
    .filter((ev) => !removals.has(ev.id))
    .map((ev) => ({ ...ev }));

  // Apply overrides
  for (const override of day.overrides || []) {
    const target = routineEvents.find((ev) => ev.id === (override as any).id);
    if (target) {
      Object.assign(target, override);
    }
  }

  // Auto-remove routine items that overlap with additions
  // This catches cases where the LLM forgot to add them to removals
  routineEvents = routineEvents.filter((routine) => {
    if (!routine.time || !routine.duration || routine.duration <= 0) return true;
    const rStart = timeToMinutes(routine.time);
    if (rStart < 0) return true;
    const rEnd = rStart + routine.duration;

    // Check if any addition overlaps this routine item's time window
    for (const add of additions) {
      if (!add.time || !add.duration || add.duration <= 0) continue;
      const aStart = timeToMinutes(add.time);
      if (aStart < 0) continue;
      const aEnd = aStart + add.duration;

      // Real interval overlap: startA < endB && startB < endA
      if (rStart < aEnd && aStart < rEnd) {
        // Only auto-remove "flexible" or "preferred" routine items
        // "fixed" routine items (school pickup, sleep) should never be auto-removed
        if (routine.flexibility !== "fixed") {
          return false; // remove this routine item
        }
      }
    }
    return true; // keep
  });

  // Combine remaining routine + additions
  let events = [...routineEvents, ...additions];

  // Sort by time
  events.sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Recalculate free blocks from the MERGED events
  const freeBlocks = calculateFreeBlocks(events);

  return {
    date: day.date,
    dayLabel: day.dayLabel,
    events,
    freeBlocks,
  };
}

/**
 * Calculate free blocks by finding gaps between events.
 * Only considers gaps >= 30 minutes as "free".
 */
/**
 * Detect remaining overlaps in a merged calendar.
 * Returns conflict descriptions for display as warnings.
 */
export function detectAgendaConflicts(calendar: CalendarSlot[]): string[] {
  const conflicts: string[] = [];

  for (const slot of calendar) {
    const events = slot.events;
    for (let i = 0; i < events.length; i++) {
      const a = events[i];
      if (!a.time || !a.duration || a.duration <= 0) continue;
      const aStart = timeToMinutes(a.time);
      if (aStart < 0) continue;
      const aEnd = aStart + a.duration;

      for (let j = i + 1; j < events.length; j++) {
        const b = events[j];
        if (!b.time || !b.duration || b.duration <= 0) continue;
        const bStart = timeToMinutes(b.time);
        if (bStart < 0) continue;
        const bEnd = bStart + b.duration;

        if (aStart < bEnd && bStart < aEnd) {
          conflicts.push(`${slot.dayLabel}: "${a.title}" (${a.time}, ${a.duration}m) overlaps with "${b.title}" (${b.time}, ${b.duration}m)`);
        }
      }
    }
  }

  return conflicts;
}

function calculateFreeBlocks(
  events: AgendaEvent[]
): { start: string; end: string }[] {
  if (events.length === 0) return [];

  const blocks: { start: string; end: string }[] = [];

  // Build occupied intervals from events
  const occupied: { start: number; end: number }[] = [];
  for (const ev of events) {
    if (!ev.time || !ev.duration || typeof ev.duration !== "number" || ev.duration <= 0) continue;
    const startMin = timeToMinutes(ev.time);
    if (startMin < 0) continue;
    occupied.push({ start: startMin, end: startMin + ev.duration });
  }

  if (occupied.length === 0) return [];

  // Sort by start time
  occupied.sort((a, b) => a.start - b.start);

  // Merge overlapping intervals
  const merged: { start: number; end: number }[] = [occupied[0]];
  for (let i = 1; i < occupied.length; i++) {
    const last = merged[merged.length - 1];
    if (occupied[i].start <= last.end) {
      last.end = Math.max(last.end, occupied[i].end);
    } else {
      merged.push({ ...occupied[i] });
    }
  }

  // Find gaps >= 30 minutes between merged intervals
  for (let i = 0; i < merged.length - 1; i++) {
    const gapStart = merged[i].end;
    const gapEnd = merged[i + 1].start;
    if (gapEnd - gapStart >= 30) {
      blocks.push({
        start: minutesToTime(gapStart),
        end: minutesToTime(gapEnd),
      });
    }
  }

  return blocks;
}

function timeToMinutes(time: string): number {
  const parts = time.split(":");
  if (parts.length < 2) return -1;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
