/**
 * FEAT045 — Tier 3: Delta builder for delta-aware replanning.
 *
 * When the user says "plan my day" and a same-day brief exists,
 * builds a delta of what changed since the morning brief. The LLM
 * adjusts the afternoon instead of regenerating from scratch.
 */
import type { AppState, FocusBrief, BriefChange } from "../types";
import { getUserToday } from "../utils/dates";

export interface BriefDelta {
  /** Tasks completed since brief was generated */
  completedSince: Array<{ id: string; title: string; completedAt: string }>;
  /** New tasks created since brief */
  newTasks: Array<{ id: string; title: string; due: string; priority: string }>;
  /** New calendar events not in the brief */
  newEvents: Array<{ id: string; title: string; datetime: string }>;
  /** Events in the brief that have been cancelled */
  cancelledEvents: Array<{ id: string; title: string }>;
  /** Tasks that became overdue since brief */
  newOverdue: Array<{ id: string; title: string; due: string }>;
  /** Raw changelog from Tier 1 patches */
  changelog: BriefChange[];
  /** Summary sentence for LLM */
  summary: string;
}

/**
 * FEAT045 WP-5.2 — Check if the fixed agenda changed enough to warrant a
 * full Sonnet replan. Only returns true for calendar structural changes —
 * NOT task completions, new tasks, or OKR updates (those are Tier 1/2).
 *
 * Uses the _changelog (populated by Tier 1 patches) as the source of truth.
 * Threshold: 2+ calendar event additions or cancellations.
 */
export function needsFullReplan(state: AppState): boolean {
  const brief = state.focusBrief;
  if (!brief?.generatedAt || !brief?.days?.length) return false;

  const today = getUserToday(state);
  if (brief.dateRange?.start !== today) return false;

  const changelog = brief._changelog || [];
  const newEvents = changelog.filter((c) => c.type === "event_added").length;
  const cancelledEvents = changelog.filter((c) => c.type === "event_cancelled").length;

  return newEvents >= 2 || cancelledEvents >= 2;
}

/**
 * Check if a same-day brief exists that we can delta against.
 */
export function hasSameDayBrief(state: AppState): boolean {
  const brief = state.focusBrief;
  if (!brief?.generatedAt || !brief?.dateRange?.start) return false;
  const today = getUserToday(state);
  return brief.dateRange.start === today;
}

/**
 * Build the delta between the existing brief and current state.
 */
export function buildDelta(state: AppState): BriefDelta | null {
  const brief = state.focusBrief;
  if (!brief?.generatedAt) return null;

  const generatedAt = brief.generatedAt;
  const today = getUserToday(state);
  const changelog = brief._changelog || [];

  // Tasks completed since brief was generated
  const completedSince = state.tasks.tasks
    .filter((t) => t.status === "done" && t.completedAt && t.completedAt > generatedAt)
    .map((t) => ({ id: t.id, title: t.title, completedAt: t.completedAt! }));

  // New tasks created since brief
  const newTasks = state.tasks.tasks
    .filter((t) => t.createdAt > generatedAt && t.status !== "done")
    .map((t) => ({ id: t.id, title: t.title, due: t.due || "", priority: t.priority }));

  // Events not in the brief's additions
  const briefEventIds = new Set(
    brief.days.flatMap((d) => (d.additions || []).map((a) => a.id))
  );
  const newEvents = state.calendar.events
    .filter((e) =>
      !e.archived && e.status !== "cancelled" &&
      !briefEventIds.has(e.id) &&
      e.datetime?.slice(0, 10) === today
    )
    .map((e) => ({ id: e.id, title: e.title, datetime: e.datetime }));

  // Events in the brief's additions that have since been cancelled
  const cancelledEvents = brief.days
    .flatMap((d) => (d.additions || []))
    .filter((a) => (a as any)._cancelled)
    .map((a) => ({ id: a.id, title: a.title }));

  // Tasks that became overdue since generation
  const newOverdue = state.tasks.tasks
    .filter((t) =>
      t.status !== "done" && t.due &&
      t.due < today && t.due >= brief.dateRange.start
    )
    .map((t) => ({ id: t.id, title: t.title, due: t.due }));

  // Build summary sentence
  const parts: string[] = [];
  if (completedSince.length > 0) parts.push(`${completedSince.length} task(s) completed`);
  if (newTasks.length > 0) parts.push(`${newTasks.length} new task(s)`);
  if (newEvents.length > 0) parts.push(`${newEvents.length} new event(s)`);
  if (cancelledEvents.length > 0) parts.push(`${cancelledEvents.length} event(s) cancelled`);
  if (newOverdue.length > 0) parts.push(`${newOverdue.length} task(s) became overdue`);
  const summary = parts.length > 0
    ? `Since the morning plan: ${parts.join(", ")}.`
    : "No significant changes since the morning plan.";

  return { completedSince, newTasks, newEvents, cancelledEvents, newOverdue, changelog, summary };
}

/**
 * Build the replan context to inject into the assembler for full_planning.
 */
export function buildReplanContext(state: AppState): Record<string, unknown> | null {
  if (!hasSameDayBrief(state)) return null;
  const delta = buildDelta(state);
  if (!delta) return null;

  const brief = state.focusBrief;
  return {
    replanMode: true,
    existingBrief: {
      generatedAt: brief.generatedAt,
      executiveSummary: brief.executiveSummary,
      days: brief.days,
      priorities: brief.priorities,
      topicDigest: brief.topicDigest,
    },
    delta: {
      summary: delta.summary,
      completedSince: delta.completedSince,
      newTasks: delta.newTasks,
      newEvents: delta.newEvents,
      cancelledEvents: delta.cancelledEvents,
      newOverdue: delta.newOverdue,
      changeCount: delta.changelog.length,
    },
  };
}
