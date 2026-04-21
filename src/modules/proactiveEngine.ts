import { readJsonFile, writeJsonFile } from "../utils/filesystem";
import { isLibsqlMode } from "./loader";
import { nowLocalIso } from "../utils/dates";

// Dynamic require hidden from Metro's static resolver
// eslint-disable-next-line no-eval
const lazyRequire = (path: string) => eval("require")(path);
import type { AppState } from "../types";
import { computeKrOutcome } from "../types";

/**
 * Proactive Engine — pure TypeScript condition checks, no LLM calls.
 * Returns nudge objects based on the current state.
 * The headless runner calls this on a schedule.
 * The app displays the results from nudges.json.
 */

export interface Nudge {
  id: string;
  type: NudgeType;
  priority: "urgent" | "important" | "helpful";
  message: string;
  actions?: NudgeAction[];
  relatedId?: string;
  createdAt: string;
  shownAt: string | null;
  dismissedAt: string | null;
}

export interface NudgeAction {
  label: string;
  action: "mark_done" | "reschedule" | "delete" | "open_chat" | "snooze";
  taskId?: string;
  payload?: string;
}

export type NudgeType =
  | "overdue_followup"
  | "pre_event"
  | "stalled_task"
  | "okr_pace"
  | "learning_review"
  | "suggestion_followup"
  | "plan_stale"
  | "daily_checkin"
  | "weekly_reflection"
  | "inbox_ready"
  | "okr_value_update";

export interface ProactiveState {
  lastDailyCheckIn: string;
  lastWeeklyReflection: string;
  lastStalledCheck: string;
  taskNudges: Record<string, string>; // taskId -> last nudge date
  eventNudges: Record<string, string>; // eventId -> last nudge date
  krNudges: Record<string, string>; // krId -> last nudge date
  krValueNudges: Record<string, string>; // krId -> last value update nudge date
  frictionMentioned: Record<string, string>; // frictionType -> last mentioned date
}

const PROACTIVE_STATE_FILE = "proactive_state.json";

const DEFAULT_STATE: ProactiveState = {
  lastDailyCheckIn: "",
  lastWeeklyReflection: "",
  lastStalledCheck: "",
  taskNudges: {},
  eventNudges: {},
  krNudges: {},
  krValueNudges: {},
  frictionMentioned: {},
};

export async function loadProactiveState(): Promise<ProactiveState> {
  if (isLibsqlMode()) {
    const { loadKvGeneric } = lazyRequire("../db/queries/kv");
    const data = await loadKvGeneric("proactive_state");
    return { ...DEFAULT_STATE, ...data };
  }
  const data = await readJsonFile<ProactiveState>(PROACTIVE_STATE_FILE);
  return { ...DEFAULT_STATE, ...data };
}

export async function saveProactiveState(ps: ProactiveState): Promise<void> {
  if (isLibsqlMode()) {
    const { saveKvGeneric } = lazyRequire("../db/queries/kv");
    await saveKvGeneric("proactive_state", ps as unknown as Record<string, unknown>);
    return;
  }
  await writeJsonFile(PROACTIVE_STATE_FILE, ps);
}

const FRICTION_COOLDOWN_HOURS = 24;

/**
 * Check if a friction signal is on cooldown (mentioned within the last 24 hours).
 */
export async function isFrictionOnCooldown(frictionType: string, today?: string): Promise<boolean> {
  const ps = await loadProactiveState();
  const last = ps.frictionMentioned?.[frictionType];
  if (!last) return false;
  // Use today (user timezone) if provided, else fall back to system time
  if (today) {
    // Same-day check: if mentioned today, it's on cooldown
    return last.slice(0, 10) === today;
  }
  const hoursSince = (Date.now() - new Date(last).getTime()) / 3600000;
  return hoursSince < FRICTION_COOLDOWN_HOURS;
}

/**
 * Mark multiple friction signals as mentioned in a single load-save cycle.
 * Prevents race condition from concurrent individual saves.
 */
export async function markFrictionsMentioned(frictionTypes: string[], today?: string): Promise<void> {
  if (frictionTypes.length === 0) return;
  const ps = await loadProactiveState();
  if (!ps.frictionMentioned) ps.frictionMentioned = {};
  const now = today ? today + "T12:00:00" : nowLocalIso();
  for (const ft of frictionTypes) {
    ps.frictionMentioned[ft] = now;
  }
  await saveProactiveState(ps);
}

/**
 * Run all proactive checks and return prioritized nudges.
 * Pure logic — no LLM calls.
 */
export async function runProactiveChecks(
  state: AppState,
  today: string,
  nowHour: number
): Promise<Nudge[]> {
  const ps = await loadProactiveState();
  const nudges: Nudge[] = [];

  nudges.push(...checkOverdueTasks(state, today, ps));
  nudges.push(...checkUpcomingEvents(state, today, nowHour, ps));
  nudges.push(...checkCalendarConflicts(state, today));
  nudges.push(...checkStalledTasks(state, today, ps));
  nudges.push(...checkOkrPace(state, today, ps));
  nudges.push(...checkStaleKrValues(state, today, ps));
  nudges.push(...checkLearningReviews(state, today));
  nudges.push(...checkSuggestionFollowups(state, today));
  nudges.push(...checkPlanStaleness(state, today));

  // Daily check-in (once per day)
  if (ps.lastDailyCheckIn !== today) {
    nudges.push(buildDailyCheckIn(state, today, nowHour));
    ps.lastDailyCheckIn = today;
  }

  // Weekly reflection (once per week on weekStartsOn day)
  const weekday = new Date(today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const reflectionDay = (state.userLifestyle?.weekStartsOn || "sunday").toLowerCase();
  if (weekday === reflectionDay && ps.lastWeeklyReflection !== today) {
    nudges.push(buildWeeklyReflection(state, today));
    ps.lastWeeklyReflection = today;
  }

  // Prune cooldown entries for tasks/events/KRs that no longer exist
  const taskIds = new Set(state.tasks.tasks.map((t) => t.id));
  const eventIds = new Set(state.calendar.events.map((e) => e.id));
  for (const id of Object.keys(ps.taskNudges)) { if (!taskIds.has(id)) delete ps.taskNudges[id]; }
  for (const id of Object.keys(ps.eventNudges)) { if (!eventIds.has(id)) delete ps.eventNudges[id]; }

  await saveProactiveState(ps);

  // Sort by priority: urgent > important > helpful
  const order = { urgent: 0, important: 1, helpful: 2 };
  nudges.sort((a, b) => order[a.priority] - order[b.priority]);

  return nudges;
}

// ─── Individual Checks ────────────────────────────────────────────────────

function checkOverdueTasks(state: AppState, today: string, ps: ProactiveState): Nudge[] {
  const nudges: Nudge[] = [];
  const overdue = state.tasks.tasks.filter(
    (t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked" && t.due && t.due.slice(0, 10) < today
  );

  for (const task of overdue) {
    // Cooldown: 3 days per task
    const lastNudge = ps.taskNudges[task.id];
    if (lastNudge && daysDiff(lastNudge, today) < 3) continue;

    const daysOverdue = daysDiff(task.due.slice(0, 10), today);
    nudges.push({
      id: `nudge_overdue_${task.id}`,
      type: "overdue_followup",
      priority: task.priority === "high" ? "urgent" : "important",
      message: `"${task.title}" is ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue. Did you handle it?`,
      actions: [
        { label: "Done", action: "mark_done", taskId: task.id },
        { label: "Reschedule", action: "reschedule", taskId: task.id },
        { label: "Delete task", action: "delete", taskId: task.id },
        { label: "Dismiss", action: "snooze" },
      ],
      relatedId: task.id,
      createdAt: today + "T00:00:00Z",
      shownAt: null,
      dismissedAt: null,
    });
    ps.taskNudges[task.id] = today;
  }

  return nudges;
}

function checkUpcomingEvents(state: AppState, today: string, nowHour: number, ps: ProactiveState): Nudge[] {
  const nudges: Nudge[] = [];
  const todayEvents = state.calendar.events.filter(
    (e) => !e.archived && e.datetime?.slice(0, 10) === today && e.status === "scheduled"
  );

  for (const event of todayEvents) {
    // Already nudged this event?
    if (ps.eventNudges[event.id]) continue;

    const eventHour = parseInt(event.datetime.slice(11, 13), 10);
    const hoursUntil = eventHour - nowHour;

    // Nudge if event is in the next 4 hours
    if (hoursUntil > 0 && hoursUntil <= 4) {
      nudges.push({
        id: `nudge_event_${event.id}`,
        type: "pre_event",
        priority: "urgent",
        message: `"${event.title}" in ${hoursUntil} hour${hoursUntil > 1 ? "s" : ""}${event.notes ? `. Note: ${event.notes}` : ""}`,
        relatedId: event.id,
        createdAt: today + "T00:00:00Z",
        shownAt: null,
        dismissedAt: null,
      });
      ps.eventNudges[event.id] = today;
    }
  }

  return nudges;
}

function checkCalendarConflicts(state: AppState, today: string): Nudge[] {
  const nudges: Nudge[] = [];
  const activeEvents = state.calendar.events.filter(
    (e) => !e.archived && e.status === "scheduled" && e.datetime?.slice(0, 10) >= today
  );

  // Check all pairs of upcoming events for time overlap
  for (let i = 0; i < activeEvents.length; i++) {
    for (let j = i + 1; j < activeEvents.length; j++) {
      const a = activeEvents[i];
      const b = activeEvents[j];
      if (!a.datetime || !b.datetime) continue;
      if (a.datetime.slice(0, 10) !== b.datetime.slice(0, 10)) continue; // different days

      const aStart = new Date(a.datetime).getTime();
      const bStart = new Date(b.datetime).getTime();
      if (isNaN(aStart) || isNaN(bStart)) continue;

      const aEnd = aStart + (a.durationMinutes || 30) * 60000;
      const bEnd = bStart + (b.durationMinutes || 30) * 60000;

      // Overlap: A starts before B ends AND B starts before A ends
      if (aStart < bEnd && bStart < aEnd) {
        const nudgeId = `nudge_conflict_${[a.id, b.id].sort().join("_")}`;
        // Skip if we already have this nudge
        if (nudges.some((n) => n.id === nudgeId)) continue;

        nudges.push({
          id: nudgeId,
          type: "pre_event",
          priority: "urgent",
          message: `Calendar conflict on ${a.datetime.slice(0, 10)}: "${a.title}" (${a.datetime.slice(11, 16)}) overlaps with "${b.title}" (${b.datetime.slice(11, 16)}). Which takes priority?`,
          actions: [
            { label: `Keep "${a.title}"`, action: "open_chat", payload: `Cancel "${b.title}" on ${b.datetime.slice(0, 10)}` },
            { label: `Keep "${b.title}"`, action: "open_chat", payload: `Cancel "${a.title}" on ${a.datetime.slice(0, 10)}` },
            { label: "Keep both", action: "snooze" },
          ],
          createdAt: today + "T00:00:00Z",
          shownAt: null,
          dismissedAt: null,
        });
      }
    }
  }

  return nudges;
}

function checkStalledTasks(state: AppState, today: string, ps: ProactiveState): Nudge[] {
  // Cooldown: once per day for the stalled check
  if (ps.lastStalledCheck === today) return [];
  ps.lastStalledCheck = today;

  const stalled = state.tasks.tasks.filter((t) => {
    if (t.status === "done" || t.status === "deferred" || t.status === "parked") return false;
    if (!t.createdAt) return false;
    return daysDiff(t.createdAt.slice(0, 10), today) >= 7 && t.status === "pending";
  });

  if (stalled.length === 0) return [];

  if (stalled.length <= 2) {
    return stalled.map((t) => ({
      id: `nudge_stalled_${t.id}`,
      type: "stalled_task" as const,
      priority: "important" as const,
      message: `"${t.title}" has been pending for ${daysDiff(t.createdAt.slice(0, 10), today)} days. Still relevant?`,
      actions: [
        { label: "Start it", action: "open_chat" as const, payload: `Update ${t.title} to in progress` },
        { label: "Delete task", action: "delete" as const, taskId: t.id },
        { label: "Dismiss", action: "snooze" as const },
      ],
      relatedId: t.id,
      createdAt: today + "T00:00:00Z",
      shownAt: null,
      dismissedAt: null,
    }));
  }

  return [{
    id: `nudge_stalled_batch_${today}`,
    type: "stalled_task",
    priority: "important",
    message: `${stalled.length} tasks have been pending for 7+ days with no progress. Time for a cleanup?`,
    actions: [
      { label: "Review them", action: "open_chat", payload: "Show me stalled tasks" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  }];
}

function checkOkrPace(state: AppState, today: string, ps: ProactiveState): Nudge[] {
  const nudges: Nudge[] = [];
  const dashboard = state.planOkrDashboard;
  if (!dashboard?.objectives || !dashboard.focusPeriod?.start || !dashboard.focusPeriod?.end) return [];

  const periodStart = dashboard.focusPeriod.start;
  const periodEnd = dashboard.focusPeriod.end;
  const totalDays = Math.max(daysDiff(periodStart, periodEnd), 1);
  const elapsedDays = Math.max(daysDiff(periodStart, today), 0);
  const expectedProgress = Math.round((elapsedDays / totalDays) * 100);

  for (const obj of dashboard.objectives) {
    if (obj.status !== "active") continue;
    for (const kr of obj.keyResults) {
      // Cooldown: 7 days per KR
      if (ps.krNudges[kr.id] && daysDiff(ps.krNudges[kr.id], today) < 7) continue;

      const krOutcome = computeKrOutcome(kr);
      if (krOutcome < expectedProgress - 15) {
        nudges.push({
          id: `nudge_okr_${kr.id}`,
          type: "okr_pace",
          priority: "important",
          message: `KR "${kr.title}" is at ${krOutcome}% outcome but should be ~${expectedProgress}% by now. Need to accelerate?`,
          actions: [
            { label: "Update value", action: "open_chat", payload: `Update value for ${kr.title}` },
            { label: "Snooze", action: "snooze" },
          ],
          relatedId: kr.id,
          createdAt: today + "T00:00:00Z",
          shownAt: null,
          dismissedAt: null,
        });
        ps.krNudges[kr.id] = today;
      }
    }
  }

  return nudges;
}

function checkStaleKrValues(state: AppState, today: string, ps: ProactiveState): Nudge[] {
  const dashboard = state.planOkrDashboard;
  if (!dashboard?.objectives) return [];

  const staleKRs: string[] = [];
  for (const obj of dashboard.objectives) {
    if (obj.status !== "active") continue;
    for (const kr of obj.keyResults) {
      if (ps.krValueNudges?.[kr.id] && daysDiff(ps.krValueNudges[kr.id], today) < 7) continue;

      const isStale = !kr.lastUpdated || daysDiff(kr.lastUpdated, today) > 7;
      const isNull = kr.currentValue === null;

      if (isNull || isStale) {
        staleKRs.push(`\u2022 ${kr.title} (${isNull ? "never set" : "last updated " + kr.lastUpdated})`);
        if (!ps.krValueNudges) ps.krValueNudges = {};
        ps.krValueNudges[kr.id] = today;
      }
    }
  }

  if (staleKRs.length === 0) return [];

  return [{
    id: `nudge_kr_values_${today}`,
    type: "okr_value_update",
    priority: "important",
    message: `Some KR values need updating:\n${staleKRs.join("\n")}`,
    actions: [
      { label: "Update values", action: "open_chat", payload: "Update my KR values" },
      { label: "Snooze", action: "snooze" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  }];
}

function checkLearningReviews(state: AppState, today: string): Nudge[] {
  const due = state.learningLog.items.filter(
    (item) => item.status === "active" && item.nextReview && item.nextReview <= today
  );
  if (due.length === 0) return [];

  return [{
    id: `nudge_learning_${today}`,
    type: "learning_review",
    priority: "helpful",
    message: `${due.length} learning item${due.length > 1 ? "s" : ""} due for review.`,
    actions: [
      { label: "Review now", action: "open_chat", payload: "Show me learning items due for review" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  }];
}

function checkSuggestionFollowups(state: AppState, today: string): Nudge[] {
  const pending = state.suggestionsLog.suggestions.filter(
    (s) => s.actionTaken === "pending" && s.shownAt && daysDiff(s.shownAt.slice(0, 10), today) >= 3
  );
  if (pending.length === 0) return [];

  return pending.slice(0, 1).map((s) => ({
    id: `nudge_suggestion_${s.id}`,
    type: "suggestion_followup" as const,
    priority: "helpful" as const,
    message: `I suggested: "${s.text}". Want to revisit?`,
    actions: [
      { label: "Act on it", action: "open_chat" as const, payload: s.text },
      { label: "Dismiss", action: "snooze" as const },
    ],
    relatedId: s.id,
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  }));
}

function checkPlanStaleness(state: AppState, today: string): Nudge[] {
  if (!state.focusBrief?.generatedAt) return [];
  const genDate = state.focusBrief.generatedAt.slice(0, 10);
  const stale = state.focusBrief.variant === "week"
    ? daysDiff(genDate, today) >= 7
    : daysDiff(genDate, today) >= 1;

  if (!stale) return [];

  return [{
    id: `nudge_plan_stale_${today}`,
    type: "plan_stale",
    priority: "helpful",
    message: `Your ${state.focusBrief.variant === "tomorrow" ? "day" : state.focusBrief.variant} plan is ${daysDiff(genDate, today)} day${daysDiff(genDate, today) !== 1 ? "s" : ""} old. Refresh it?`,
    actions: [
      { label: "Plan my day", action: "open_chat", payload: "Plan my day" },
      { label: "Plan my week", action: "open_chat", payload: "Plan my week" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  }];
}

function buildDailyCheckIn(state: AppState, today: string, nowHour: number): Nudge {
  const overdue = state.hotContext.overdueCount;
  const open = state.hotContext.openTaskCount;
  const nextEvent = state.hotContext.nextCalendarEvent;
  const parts: string[] = [];

  if (overdue > 0) parts.push(`${overdue} overdue task${overdue > 1 ? "s" : ""}`);
  if (open > 0) parts.push(`${open} open task${open > 1 ? "s" : ""}`);
  if (nextEvent) parts.push(`next up: ${nextEvent.title}`);

  const summary = parts.length > 0 ? parts.join(", ") : "Clear slate today";

  return {
    id: `nudge_checkin_${today}`,
    type: "daily_checkin",
    priority: "helpful",
    message: `Good ${getGreeting(nowHour)}. ${summary}. How's your energy?`,
    actions: [
      { label: "Plan my day", action: "open_chat", payload: "Plan my day" },
      { label: "I'm good", action: "snooze" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  };
}

function buildWeeklyReflection(state: AppState, today: string): Nudge {
  const sevenDaysAgo = new Date(today + "T12:00:00");
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10);

  const completedThisWeek = state.tasks.tasks.filter(
    (t) => t.status === "done" && t.completedAt && t.completedAt.slice(0, 10) >= cutoff
  ).length;

  return {
    id: `nudge_reflection_${today}`,
    type: "weekly_reflection",
    priority: "important",
    message: `Weekly check-in: you completed ${completedThisWeek} task${completedThisWeek !== 1 ? "s" : ""} this week. Ready for a reflection + week plan?`,
    actions: [
      { label: "Plan my week", action: "open_chat", payload: "Plan my week" },
      { label: "Skip", action: "snooze" },
    ],
    createdAt: today + "T00:00:00Z",
    shownAt: null,
    dismissedAt: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysDiff(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00");
  const b = new Date(dateB + "T00:00:00");
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function getGreeting(hour: number): string {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
