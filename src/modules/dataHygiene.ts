/**
 * FEAT047 — Data Hygiene.
 *
 * Tier 1: Deterministic cleanup (free, runs daily before plan generation).
 * Tier 2: Haiku-assisted audit (weekly, ~$0.0001 per run).
 *
 * Tier 0 (semantic dedup at entry time) lives in executor.ts.
 */
import type { AppState, Task, CalendarEvent } from "../types";
import { isTaskTerminal } from "../types";
import { getUserToday, nowLocalIso, WEEKDAY_MAP } from "../utils/dates";

export interface HygieneResult {
  undatedArchived: number;
  recurringCalendarDeduped: number;
  taskExactDeduped: number;
  staleParkedDeferred: number;
  pastDueRecurringArchived: number;
  recurringMigrated: number;
  /** Tier 2 only */
  llmSuggestions: string[];
  /** Human-readable summary */
  summary: string;
}

// ── Tier 1: Deterministic Cleanup ─────────────────────────────────────────

/**
 * Run all deterministic cleanup checks. Mutates state in-place.
 * Call state._dirty.add() for each modified collection.
 */
export function runDeterministicHygiene(state: AppState): HygieneResult {
  const today = getUserToday(state);
  const result: HygieneResult = {
    undatedArchived: 0,
    recurringCalendarDeduped: 0,
    taskExactDeduped: 0,
    staleParkedDeferred: 0,
    pastDueRecurringArchived: 0,
    recurringMigrated: 0,
    llmSuggestions: [],
    summary: "",
  };

  result.undatedArchived = archiveUndatedEvents(state, today);
  result.recurringCalendarDeduped = dedupRecurringVsCalendar(state, today);
  result.taskExactDeduped = dedupExactTasks(state);
  result.staleParkedDeferred = deferStaleParked(state, today);
  result.pastDueRecurringArchived = archivePastDueRecurring(state, today);
  result.recurringMigrated = migrateOrphanedRecurringEvents(state);

  const total = result.undatedArchived + result.recurringCalendarDeduped +
    result.taskExactDeduped + result.staleParkedDeferred + result.pastDueRecurringArchived +
    result.recurringMigrated;

  if (total > 0) {
    const parts: string[] = [];
    if (result.undatedArchived > 0) parts.push(`archived ${result.undatedArchived} undated event(s)`);
    if (result.recurringCalendarDeduped > 0) parts.push(`deduped ${result.recurringCalendarDeduped} recurring/calendar overlap(s)`);
    if (result.taskExactDeduped > 0) parts.push(`deduped ${result.taskExactDeduped} duplicate task(s)`);
    if (result.staleParkedDeferred > 0) parts.push(`auto-deferred ${result.staleParkedDeferred} stale parked task(s)`);
    if (result.pastDueRecurringArchived > 0) parts.push(`archived ${result.pastDueRecurringArchived} past-due recurring instance(s)`);
    if (result.recurringMigrated > 0) parts.push(`migrated ${result.recurringMigrated} orphaned recurring event(s) to recurring tasks`);
    result.summary = `Data hygiene: ${parts.join(", ")}.`;
  } else {
    result.summary = "Data hygiene: all clean.";
  }

  return result;
}

// ── Individual checks ─────────────────────────────────────────────────────

/**
 * Archive events with no datetime that are older than 7 days.
 * These are ghost entries that leak into the planner.
 */
function archiveUndatedEvents(state: AppState, today: string): number {
  const cutoff = addDays(today, -7);
  let count = 0;
  for (const e of state.calendar.events) {
    if (e.archived || e.status === "cancelled") continue;
    if (e.datetime) continue; // has a date — skip
    // No datetime — check if it's old enough to archive
    // Use createdAt if available, otherwise archive immediately (truly orphaned)
    const created = (e as any).createdAt || (e as any).created_at || "";
    if (!created || created.slice(0, 10) <= cutoff) {
      e.archived = true;
      count++;
    }
  }
  if (count > 0) state._dirty.add("calendar");
  return count;
}

/**
 * If a recurring task fires today AND a calendar event with the same title
 * exists for today, archive the calendar event (the recurring task is the
 * source of truth).
 */
function dedupRecurringVsCalendar(state: AppState, today: string): number {
  const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dow = DAY_NAMES[new Date(today + "T00:00:00Z").getUTCDay()];
  const isWeekend = dow === "saturday" || dow === "sunday";

  // Collect recurring task titles that fire today
  const recurringTitlesToday = new Set<string>();
  for (const r of state.recurringTasks?.recurring || []) {
    if (!r.active) continue;
    const s = r.schedule;
    const fires =
      s.type === "daily" ||
      (s.type === "weekdays" && !isWeekend) ||
      ((s.type === "weekly" || s.type === "custom") && s.days?.includes(dow));
    if (fires && !(s.excludeDates || []).includes(today)) {
      recurringTitlesToday.add(r.title.toLowerCase().trim());
    }
  }

  let count = 0;
  for (const e of state.calendar.events) {
    if (e.archived || e.status === "cancelled") continue;
    if (!e.datetime || !e.datetime.startsWith(today)) continue;
    const titleLower = e.title.toLowerCase().trim();
    if (recurringTitlesToday.has(titleLower)) {
      console.log(`[hygiene] archiving calendar event "${e.title}" — duplicates recurring task`);
      e.archived = true;
      count++;
    }
  }
  if (count > 0) state._dirty.add("calendar");
  return count;
}

/**
 * Find open tasks with identical titles (case-insensitive).
 * Keep the one with more activity (comments, notes). Defer the other.
 */
function dedupExactTasks(state: AppState): number {
  const seen = new Map<string, Task>();
  let count = 0;

  for (const t of state.tasks.tasks) {
    if (isTaskTerminal(t.status) || t.status === "parked") continue;
    const key = t.title.toLowerCase().trim();
    if (!key) continue;

    const existing = seen.get(key);
    if (existing) {
      // Pick the one with more activity
      const scoreA = (existing.comments?.length || 0) + (existing.notes?.length || 0);
      const scoreB = (t.comments?.length || 0) + (t.notes?.length || 0);
      const toDefer = scoreB > scoreA ? existing : t;
      toDefer.status = "deferred";
      toDefer.dismissedAt = nowLocalIso();
      toDefer.notes = (toDefer.notes || "") + ` [auto-deferred: duplicate of "${scoreB > scoreA ? t.title : existing.title}"]`;
      console.log(`[hygiene] deferred duplicate task: "${toDefer.title}" (${toDefer.id})`);
      // Update the "seen" entry to keep the winner
      if (scoreB > scoreA) seen.set(key, t);
      count++;
    } else {
      seen.set(key, t);
    }
  }
  if (count > 0) state._dirty.add("tasks");
  return count;
}

/**
 * Tasks parked for > 30 days → auto-defer.
 */
function deferStaleParked(state: AppState, today: string): number {
  const cutoff = addDays(today, -30);
  let count = 0;

  for (const t of state.tasks.tasks) {
    if (t.status !== "parked") continue;
    // Use the most recent timestamp as "parked since"
    const parkedSince = t.dismissedAt || t.createdAt || "";
    if (parkedSince && parkedSince.slice(0, 10) <= cutoff) {
      t.status = "deferred";
      t.dismissedAt = nowLocalIso();
      t.notes = (t.notes || "") + " [auto-deferred: parked > 30 days]";
      console.log(`[hygiene] auto-deferred stale parked task: "${t.title}"`);
      count++;
    }
  }
  if (count > 0) state._dirty.add("tasks");
  return count;
}

/**
 * Archive recurring task instances from yesterday that were never started.
 * These clutter the overdue list without adding value.
 */
function archivePastDueRecurring(state: AppState, today: string): number {
  const yesterday = addDays(today, -1);
  let count = 0;

  for (const t of state.tasks.tasks) {
    if (isTaskTerminal(t.status)) continue;
    // Recurring instances have "[Recurring]" in notes (set by recurringProcessor)
    if (!t.notes || !t.notes.includes("[Recurring]")) continue;
    if (t.due && t.due.slice(0, 10) < today && t.status === "pending") {
      t.status = "deferred";
      t.dismissedAt = nowLocalIso();
      t.notes = (t.notes || "") + " [auto-deferred: recurring instance not started]";
      count++;
    }
  }
  if (count > 0) state._dirty.add("tasks");
  return count;
}

/**
 * Migrate calendar events with orphaned `recurring` metadata into RecurringTask entries.
 * Strips the metadata from the source event afterward to prevent re-migration.
 */
function migrateOrphanedRecurringEvents(state: AppState): number {
  const existingTitles = new Set(
    state.recurringTasks.recurring.map((r) => r.title.toLowerCase())
  );

  let count = 0;
  for (const event of state.calendar.events) {
    if (!event.recurring) continue;

    // Skip if a RecurringTask with the same title already exists
    if (existingTitles.has(event.title.toLowerCase())) {
      delete event.recurring;
      delete event.recurrence;
      delete event.recurrenceDay;
      state._dirty.add("calendar");
      continue;
    }

    const recurrence = String(event.recurrence || "weekly").toLowerCase();
    const recDay = WEEKDAY_MAP[(String(event.recurrenceDay || "")).toLowerCase()];
    const schedType = recurrence === "daily" ? "daily" as const
      : recurrence === "weekdays" ? "weekdays" as const
      : "weekly" as const;
    const days = recDay ? [recDay] : [];
    const timeMatch = (event.datetime || "").match(/T(\d{2}:\d{2})/);
    const time = timeMatch ? timeMatch[1] : undefined;

    const recTask = {
      id: `rec_mig_${event.id}`,
      title: event.title,
      schedule: { type: schedType, days, time },
      category: event.type || "",
      priority: (event.priority || "medium") as "high" | "medium" | "low",
      okrLink: null,
      duration: event.durationMinutes || 30,
      notes: event.notes || "",
      active: true,
      createdAt: nowLocalIso(),
    };

    state.recurringTasks.recurring.push(recTask);
    existingTitles.add(event.title.toLowerCase());

    delete event.recurring;
    delete event.recurrence;
    delete event.recurrenceDay;

    console.log(`[hygiene] migrated recurring calendar event "${event.title}" → RecurringTask ${recTask.id}`);
    count++;
  }

  if (count > 0) {
    state._dirty.add("recurringTasks");
    state._dirty.add("calendar");
  }
  return count;
}

// ── Tier 2: Haiku LLM Audit ──────────────────────────────────────────────

type HaikuAuditFn = (input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
let _auditLlmFn: HaikuAuditFn | null = null;

export function injectHygieneAudit(fn: HaikuAuditFn): void {
  _auditLlmFn = fn;
}

/**
 * Build the Haiku audit function. Called from proxy/headless startup.
 */
export function createHygieneAuditFn(client: any, model: string): HaikuAuditFn {
  const PROMPT = `You are a data quality auditor for a personal task/calendar app.
Review the items below and identify:
1. Fuzzy duplicates (same intent, different wording)
2. Stale items that are likely completed but not marked
3. Items that should be archived or consolidated

Use the submit_hygiene_actions tool to respond.`;

  const TOOL = {
    name: "submit_hygiene_actions",
    description: "Suggest data cleanup actions.",
    input_schema: {
      type: "object" as const,
      properties: {
        archiveEvents: { type: "array", items: { type: "string" }, description: "Event IDs to archive" },
        deferTasks: { type: "array", items: { type: "string" }, description: "Task IDs to defer" },
        mergeTasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              keep: { type: "string" },
              remove: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
        suggestions: { type: "array", items: { type: "string" }, description: "Suggestions for the user" },
      },
      required: ["archiveEvents", "deferTasks", "mergeTasks", "suggestions"],
    },
  };

  return async (input: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const response = await client.messages.create({
      model,
      max_tokens: 500,
      system: PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }],
      tools: [TOOL],
      tool_choice: { type: "tool" as const, name: "submit_hygiene_actions" },
    });

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_hygiene_actions") {
        return block.input as Record<string, unknown>;
      }
    }
    return null;
  };
}

/**
 * Run the weekly Haiku audit. Builds input from current state,
 * calls Haiku, applies suggestions.
 */
export async function runLlmAudit(state: AppState): Promise<HygieneResult> {
  const base = runDeterministicHygiene(state); // Tier 1 first

  // Injected LLM functions bypass the circuit breaker — check explicitly
  const { isCircuitOpen } = require("./llm");
  if (!_auditLlmFn || isCircuitOpen()) return base;

  const today = getUserToday(state);

  // Build audit input — only items that need review
  const undatedEvents = state.calendar.events
    .filter((e) => !e.archived && e.status !== "cancelled" && !e.datetime)
    .map((e) => ({ id: e.id, title: e.title, status: e.status }));

  // Find candidate fuzzy duplicates among open tasks
  const openTasks = state.tasks.tasks.filter((t) => !isTaskTerminal(t.status) && t.status !== "parked");
  const possibleDuplicateTasks: Array<{ a: { id: string; title: string }; b: { id: string; title: string } }> = [];
  for (let i = 0; i < openTasks.length; i++) {
    for (let j = i + 1; j < openTasks.length; j++) {
      const sim = stringSimilarity(openTasks[i].title, openTasks[j].title);
      if (sim > 0.5) {
        possibleDuplicateTasks.push({
          a: { id: openTasks[i].id, title: openTasks[i].title },
          b: { id: openTasks[j].id, title: openTasks[j].title },
        });
      }
    }
  }

  // Stale tasks (open, no due date or very old)
  const cutoff = addDays(today, -30);
  const staleTasks = openTasks
    .filter((t) => t.createdAt && t.createdAt.slice(0, 10) < cutoff)
    .map((t) => ({ id: t.id, title: t.title, daysSinceCreated: daysDiff(t.createdAt.slice(0, 10), today), status: t.status }));

  if (undatedEvents.length === 0 && possibleDuplicateTasks.length === 0 && staleTasks.length === 0) {
    return base; // nothing to audit
  }

  try {
    const result = await _auditLlmFn({
      undatedEvents: undatedEvents.slice(0, 20),
      possibleDuplicateTasks: possibleDuplicateTasks.slice(0, 10),
      staleTasks: staleTasks.slice(0, 15),
    });

    if (!result) return base;

    // Apply archive suggestions
    const archiveIds = new Set((result.archiveEvents as string[]) || []);
    for (const e of state.calendar.events) {
      if (archiveIds.has(e.id) && !e.archived) {
        e.archived = true;
        base.undatedArchived++;
      }
    }
    if (archiveIds.size > 0) state._dirty.add("calendar");

    // Apply defer suggestions
    const deferIds = new Set((result.deferTasks as string[]) || []);
    for (const t of state.tasks.tasks) {
      if (deferIds.has(t.id) && !isTaskTerminal(t.status)) {
        t.status = "deferred";
        t.dismissedAt = nowLocalIso();
        t.notes = (t.notes || "") + " [auto-deferred by weekly audit]";
        base.taskExactDeduped++;
      }
    }
    if (deferIds.size > 0) state._dirty.add("tasks");

    // Apply merge suggestions
    for (const merge of (result.mergeTasks as any[]) || []) {
      const toRemove = state.tasks.tasks.find((t) => t.id === merge.remove);
      if (toRemove && !isTaskTerminal(toRemove.status)) {
        toRemove.status = "deferred";
        toRemove.dismissedAt = nowLocalIso();
        toRemove.notes = (toRemove.notes || "") + ` [merged into ${merge.keep}: ${merge.reason}]`;
        base.taskExactDeduped++;
        state._dirty.add("tasks");
      }
    }

    base.llmSuggestions = (result.suggestions as string[]) || [];

    // Rebuild summary
    const parts: string[] = [];
    if (base.undatedArchived > 0) parts.push(`archived ${base.undatedArchived} event(s)`);
    if (base.taskExactDeduped > 0) parts.push(`cleaned up ${base.taskExactDeduped} task(s)`);
    if (base.llmSuggestions.length > 0) parts.push(`${base.llmSuggestions.length} suggestion(s)`);
    base.summary = parts.length > 0 ? `Weekly data audit: ${parts.join(", ")}.` : "Weekly audit: all clean.";

    console.log("[hygiene] Tier 2 audit complete:", base.summary);
  } catch (err: any) {
    console.warn("[hygiene] Tier 2 audit failed:", err?.message);
  }

  return base;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysDiff(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/** Simple Jaccard-like string similarity (word overlap). */
function stringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection++;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}
