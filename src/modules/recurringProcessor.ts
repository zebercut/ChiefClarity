import { writeJsonFile } from "../utils/filesystem";
import { nowLocalIso } from "../utils/dates";
import type { AppState, RecurringTask, PlanVariant } from "../types";

/**
 * Process recurring tasks for a given date.
 * Creates actual task/calendar entries in state for items that match today.
 * Skips if an entry was already created for this date (dedup by title + date).
 *
 * Pure TypeScript — no LLM calls.
 */
export function processRecurringTasks(state: AppState, today: string): number {
  const recurring = state.recurringTasks?.recurring ?? [];
  if (recurring.length === 0) return 0;

  const todayWeekday = new Date(today + "T12:00:00")
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();

  let created = 0;

  for (const rec of recurring) {
    if (!rec.active) continue;
    if (!shouldRunToday(rec, today, todayWeekday)) continue;
    if (alreadyCreatedToday(rec, state, today)) continue;

    // Create a task entry
    const taskId = `rec_${rec.id}_${today.replace(/-/g, "")}`;
    const task = {
      id: taskId,
      title: rec.title,
      due: today,
      priority: rec.priority || "medium",
      status: "pending" as const,
      category: rec.category || "",
      subcategory: "",
      okrLink: rec.okrLink || null,
      conflictStatus: "ok" as const,
      conflictReason: "",
      conflictWith: [] as string[],
      notes: rec.notes ? `[Recurring] ${rec.notes}` : "[Recurring]",
      createdAt: nowLocalIso(),
      completedAt: null,
      dismissedAt: null,
      comments: [],
      timeAllocated: rec.duration ? `${rec.duration}m` : "",
      relatedCalendar: [] as string[],
      relatedInbox: [] as string[],
    };

    state.tasks.tasks.push(task);
    state._dirty.add("tasks");
    created++;

    // If the recurring task has a time, also create a calendar event
    if (rec.schedule.time) {
      const eventId = `rcev_${rec.id}_${today.replace(/-/g, "")}`;
      const event = {
        id: eventId,
        title: rec.title,
        datetime: `${today}T${rec.schedule.time}:00`,
        durationMinutes: rec.duration || 30,
        status: "scheduled" as const,
        type: rec.category || "other",
        priority: rec.priority || "medium",
        notes: rec.notes ? `[Recurring] ${rec.notes}` : "[Recurring]",
        relatedInbox: [] as string[],
        isRecurringInstance: true,
      };

      state.calendar.events.push(event);
      state._dirty.add("calendar");
      task.relatedCalendar.push(eventId);
    }
  }

  return created;
}

function shouldRunToday(rec: RecurringTask, today: string, todayWeekday: string): boolean {
  const sched = rec.schedule;

  // Check exclude dates
  if (sched.excludeDates?.includes(today)) return false;

  switch (sched.type) {
    case "daily":
      return true;

    case "weekdays":
      return !["saturday", "sunday"].includes(todayWeekday);

    case "weekly":
      return (sched.days || []).some((d) => d.toLowerCase() === todayWeekday);

    case "custom":
      return (sched.days || []).some((d) => d.toLowerCase() === todayWeekday);

    default:
      return false;
  }
}

function alreadyCreatedToday(rec: RecurringTask, state: AppState, today: string): boolean {
  // Check if a task with the recurring prefix + today's date already exists
  const expectedId = `rec_${rec.id}_${today.replace(/-/g, "")}`;
  return state.tasks.tasks.some((t) => t.id === expectedId);
}

// ── Pre-computed recurring map for the assembler ─────────────────────────────

export interface RecurringDayItem {
  title: string;
  time: string;       // "HH:MM"
  duration: number;    // minutes
  category: string;
  priority: string;
  notes?: string;
}

/**
 * Pre-compute which recurring commitments apply to which dates in the plan range.
 * Returns a date-keyed map so the LLM doesn't have to parse schedule types.
 * This respects the sacred boundary: TypeScript handles schedule→date computation.
 */
export function buildRecurringByDate(
  recurring: RecurringTask[],
  variant: PlanVariant,
  today: string,
): Record<string, RecurringDayItem[]> {
  const active = recurring.filter((r) => r.active);
  if (active.length === 0) return {};

  // Compute the date range based on plan variant
  const dates = computeDateRange(variant, today);
  const result: Record<string, RecurringDayItem[]> = {};

  for (const date of dates) {
    const weekday = new Date(date + "T12:00:00")
      .toLocaleDateString("en-US", { weekday: "long" })
      .toLowerCase();

    const items: RecurringDayItem[] = [];
    for (const rec of active) {
      if (!shouldRunToday(rec, date, weekday)) continue;
      items.push({
        title: rec.title,
        time: rec.schedule.time || "09:00",
        duration: rec.duration || 30,
        category: rec.category || "other",
        priority: rec.priority || "medium",
        notes: rec.notes,
      });
    }

    if (items.length > 0) {
      result[date] = items;
    }
  }

  return result;
}

/** Generate an array of YYYY-MM-DD strings for the plan's date range. */
function computeDateRange(variant: PlanVariant, today: string): string[] {
  const start = new Date(today + "T12:00:00");
  const dates: string[] = [];

  if (variant === "day") {
    dates.push(today);
  } else if (variant === "tomorrow") {
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dates.push(fmtDate(tomorrow));
  } else {
    // week: 7 days starting from today
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(fmtDate(d));
    }
  }

  return dates;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
