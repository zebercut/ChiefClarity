/**
 * FEAT045 — Tier 1: TypeScript hot patches for the focus brief.
 *
 * Instant, free, no LLM. Updates the brief in-place when tasks/events
 * change, recalculates freeBlocks, and tracks changes in _changelog.
 */
import type {
  AppState,
  FocusBrief,
  DaySlot,
  AgendaEvent,
  BriefChange,
  WriteOperation,
} from "../types";
import { getUserToday, getUserNow } from "../utils/dates";

const MAX_CHANGELOG = 50;

/**
 * Patch the brief based on writes that just happened.
 * Call after applyWrites + flush. Modifies state.focusBrief in-place.
 */
export function patchBrief(
  state: AppState,
  writes: WriteOperation[]
): void {
  const brief = state.focusBrief;
  if (!brief?.days?.length) return;

  const today = getUserToday(state);
  const todaySlot = brief.days.find((d) => d.date === today);
  if (!todaySlot) return;

  if (!brief._changelog) brief._changelog = [];

  let changed = false;

  for (const w of writes) {
    if (w.file === "tasks") {
      changed = patchTask(w, todaySlot, brief, state) || changed;
    } else if (w.file === "calendar") {
      changed = patchEvent(w, todaySlot, brief, state) || changed;
    } else if (w.file === "planOkrDashboard") {
      changed = patchOkr(brief, state) || changed;
    }
  }

  if (changed) {
    recalcFreeBlocks(todaySlot, brief.routineTemplate, state.userLifestyle?.sleepWake);
    // Trim changelog
    if (brief._changelog.length > MAX_CHANGELOG) {
      brief._changelog = brief._changelog.slice(-MAX_CHANGELOG);
    }
    state._dirty.add("focusBrief");
  }
}

// ── Task patches ───────────────────────────────────────────────────────

function patchTask(
  w: WriteOperation,
  day: DaySlot,
  brief: FocusBrief,
  state: AppState
): boolean {
  const data = w.data as Record<string, unknown>;
  const id = w.id || (data.id as string) || "";
  const title = (data.title as string) || findTaskTitle(id, state) || id;
  const now = getUserNow(state);

  if (w.action === "update" && data.status === "done") {
    // Mark as completed in additions
    const item = day.additions?.find((a) => a.id === id);
    if (item) item._completed = true;
    // Also mark in priorities
    const prio = brief.priorities?.find((p) => (p as any).id === id);
    if (prio) (prio as any)._completed = true;
    addChange(brief, { type: "task_done", itemId: id, itemTitle: title, timestamp: now });
    return true;
  }

  if (w.action === "delete") {
    // Remove from additions
    if (day.additions) {
      day.additions = day.additions.filter((a) => a.id !== id);
    }
    addChange(brief, { type: "task_deleted", itemId: id, itemTitle: title, timestamp: now });
    return true;
  }

  if (w.action === "add") {
    const due = (data.due as string) || "";
    const today = day.date;
    // Only auto-slot tasks due today
    if (due && due.slice(0, 10) === today) {
      const duration = parseDuration(data.timeAllocated as string) || 30;
      const slot = findNextFreeSlot(day, brief.routineTemplate, duration, state.userLifestyle?.sleepWake);
      if (slot) {
        if (!day.additions) day.additions = [];
        day.additions.push({
          id,
          title,
          time: slot,
          duration,
          category: mapCategory(data.category as string),
          flexibility: "flexible",
          source: "task",
        });
      }
      addChange(brief, { type: "task_added", itemId: id, itemTitle: title, timestamp: now });
      return true;
    }
  }

  return false;
}

// ── Event patches ──────────────────────────────────────────────────────

function patchEvent(
  w: WriteOperation,
  day: DaySlot,
  brief: FocusBrief,
  state: AppState
): boolean {
  const data = w.data as Record<string, unknown>;
  const id = w.id || (data.id as string) || "";
  const title = (data.title as string) || id;
  const now = getUserNow(state);

  if (w.action === "update" && (data.status === "cancelled" || data.archived === true)) {
    const item = day.additions?.find((a) => a.id === id);
    if (item) item._cancelled = true;
    addChange(brief, { type: "event_cancelled", itemId: id, itemTitle: title, timestamp: now });
    return true;
  }

  if (w.action === "add") {
    const dt = (data.datetime as string) || "";
    if (dt && dt.slice(0, 10) === day.date) {
      const time = dt.slice(11, 16) || "09:00";
      const duration = (data.durationMinutes as number) || 60;
      if (!day.additions) day.additions = [];
      // Check if routine needs to be removed (overlap)
      checkRoutineOverlap(day, brief.routineTemplate, time, duration);
      day.additions.push({
        id,
        title,
        time,
        duration,
        category: mapCategory(data.type as string),
        flexibility: "fixed",
        source: "calendar",
      });
      addChange(brief, { type: "event_added", itemId: id, itemTitle: title, timestamp: now });
      return true;
    }
  }

  return false;
}

// ── OKR patches ────────────────────────────────────────────────────────

function patchOkr(brief: FocusBrief, state: AppState): boolean {
  if (!brief.okrSnapshot?.length || !state.planOkrDashboard?.objectives?.length) return false;
  let changed = false;
  for (const snap of brief.okrSnapshot) {
    const obj = state.planOkrDashboard.objectives.find((o) => o.id === (snap as any).id);
    if (obj) {
      if ((snap as any).activityProgress !== obj.activityProgress ||
          (snap as any).outcomeProgress !== obj.outcomeProgress) {
        (snap as any).activityProgress = obj.activityProgress;
        (snap as any).outcomeProgress = obj.outcomeProgress;
        changed = true;
      }
    }
  }
  if (changed) {
    addChange(brief, {
      type: "okr_updated",
      itemId: "okr",
      itemTitle: "OKR progress",
      timestamp: getUserNow(state),
    });
  }
  return changed;
}

// ── freeBlocks recalculation ───────────────────────────────────────────

function recalcFreeBlocks(
  day: DaySlot,
  routineTemplate: AgendaEvent[],
  sleepWake?: { wake: string; sleep: string }
): void {
  // Build sorted timeline of active items
  const items: Array<{ start: number; end: number }> = [];

  // Routine items (minus removals)
  const removals = new Set(day.removals || []);
  for (const rt of routineTemplate) {
    if (removals.has(rt.id)) continue;
    const start = timeToMinutes(rt.time);
    items.push({ start, end: start + (rt.duration || 30) });
  }

  // Additions (minus completed/cancelled)
  for (const a of day.additions || []) {
    if (a._completed || a._cancelled) continue;
    const start = timeToMinutes(a.time);
    items.push({ start, end: start + (a.duration || 30) });
  }

  // Sort by start time
  items.sort((a, b) => a.start - b.start);

  // Use user's wake/sleep times, fall back to 06:00-22:00
  const dayStart = sleepWake?.wake ? timeToMinutes(sleepWake.wake) : 6 * 60;
  const dayEnd = sleepWake?.sleep ? timeToMinutes(sleepWake.sleep) : 22 * 60;
  const blocks: Array<{ start: string; end: string }> = [];
  let cursor = dayStart;

  for (const item of items) {
    if (item.start < cursor) {
      // Overlap — advance cursor past this item
      cursor = Math.max(cursor, item.end);
      continue;
    }
    if (item.start > cursor && item.start - cursor >= 15) {
      // Gap of at least 15 minutes
      blocks.push({
        start: minutesToTime(cursor),
        end: minutesToTime(item.start),
      });
    }
    cursor = Math.max(cursor, item.end);
  }

  // Final gap to end of day
  if (dayEnd > cursor && dayEnd - cursor >= 15) {
    blocks.push({
      start: minutesToTime(cursor),
      end: minutesToTime(dayEnd),
    });
  }

  day.freeBlocks = blocks;
}

// ── Helpers ────────────────────────────────────────────────────────────

function addChange(brief: FocusBrief, change: BriefChange): void {
  if (!brief._changelog) brief._changelog = [];
  brief._changelog.push(change);
}

function findTaskTitle(id: string, state: AppState): string {
  return state.tasks?.tasks?.find((t) => t.id === id)?.title || "";
}

function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseDuration(timeAllocated: string | undefined): number | null {
  if (!timeAllocated) return null;
  const m = timeAllocated.match(/(\d+)\s*(min|m)/i);
  if (m) return parseInt(m[1], 10);
  const h = timeAllocated.match(/(\d+)\s*(hr|hour|h)/i);
  if (h) return parseInt(h[1], 10) * 60;
  return null;
}

function findNextFreeSlot(
  day: DaySlot,
  routine: AgendaEvent[],
  durationNeeded: number,
  sleepWake?: { wake: string; sleep: string }
): string | null {
  // Temporarily recalc to find current free blocks
  recalcFreeBlocks(day, routine, sleepWake);
  for (const block of day.freeBlocks || []) {
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    if (end - start >= durationNeeded) {
      return block.start;
    }
  }
  return null;
}

function checkRoutineOverlap(
  day: DaySlot,
  routine: AgendaEvent[],
  newTime: string,
  newDuration: number
): void {
  const newStart = timeToMinutes(newTime);
  const newEnd = newStart + newDuration;
  for (const rt of routine) {
    if ((day.removals || []).includes(rt.id)) continue;
    const rtStart = timeToMinutes(rt.time);
    const rtEnd = rtStart + (rt.duration || 30);
    if (newStart < rtEnd && newEnd > rtStart) {
      // Overlap — add to removals
      if (!day.removals) day.removals = [];
      if (!day.removals.includes(rt.id)) {
        day.removals.push(rt.id);
      }
    }
  }
}

function mapCategory(cat: string | undefined): AgendaEvent["category"] {
  if (!cat) return "other";
  const lower = cat.toLowerCase();
  if (lower.includes("work") || lower.includes("project")) return "work";
  if (lower.includes("family") || lower.includes("kid")) return "family";
  if (lower.includes("health") || lower.includes("exercise")) return "health";
  if (lower.includes("admin")) return "admin";
  if (lower.includes("social") || lower.includes("friend")) return "social";
  if (lower.includes("learn")) return "learning";
  return "other";
}

/** Get the count of unprocessed changes (for Tier 2 trigger check). */
export function getChangelogCount(state: AppState): number {
  return state.focusBrief?._changelog?.length || 0;
}
