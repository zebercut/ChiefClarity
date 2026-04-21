import type { AppState, Fact } from "../types";
import { computeKrOutcome, computeKrActivity, buildTaskStats, isTaskActive } from "../types";
import { getUserToday, isOverdue as isOverdueCheck } from "../utils/dates";

export function updateSummaries(state: AppState): void {
  const s = state.summaries;
  const today = getUserToday(state);
  const open = state.tasks.tasks.filter((t) => isTaskActive(t.status));
  const overdue = open.filter((t) => isOverdueCheck(t.due, today));
  s.tasks = `${open.length} open tasks. ${overdue.length} overdue.`;

  const upcoming = state.calendar.events
    .filter((e) => !e.archived && e.status !== "cancelled" && (e.datetime?.slice(0, 10) || "") >= today)
    .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
  s.calendar = `${upcoming.length} upcoming events.`;
  if (upcoming[0])
    s.calendar += ` Next: ${upcoming[0].title} at ${upcoming[0].datetime.slice(0, 16)}.`;

  const ignored = state.suggestionsLog.suggestions.filter(
    (sg) => sg.actionTaken === "ignored"
  );
  s.suggestionsLog = `${state.suggestionsLog.suggestions.length} total. ${ignored.length} ignored.`;

  const activeLearning = state.learningLog.items.filter(
    (i) => i.status === "active"
  );
  s.learningLog = `${activeLearning.length} active learning items.`;

  // ─── OKR: migrate old format + compute dual progress ────────────────────
  const objectives = state.planOkrDashboard.objectives;
  let okrChanged = false;

  // One-time migration: old progress/target/current → new targetType/targetValue/currentValue
  for (const obj of objectives) {
    if ("progress" in obj && !("outcomeProgress" in obj)) {
      (obj as any).outcomeProgress = (obj as any).progress;
      (obj as any).activityProgress = 0;
      delete (obj as any).progress;
      okrChanged = true;
    }
    for (const kr of obj.keyResults) {
      if ("progress" in kr && !("targetType" in kr)) {
        const old = kr as any;
        const targetStr = (old.target || "").toLowerCase();
        if (targetStr.includes("%")) {
          old.targetType = "percentage";
          old.targetValue = Math.max(parseFloat(targetStr) || 100, 1);
          old.targetUnit = "%";
        } else if (/\d/.test(targetStr) && !targetStr.includes("tbd")) {
          old.targetType = "numeric";
          old.targetValue = Math.max(parseFloat(targetStr.replace(/[^0-9.]/g, "")) || 100, 1);
          old.targetUnit = targetStr.replace(/[0-9.,$/]+/g, "").trim() || "units";
        } else {
          old.targetType = "milestone";
          old.targetValue = 100;
          old.targetUnit = old.target || "milestone";
        }
        if (typeof old.current === "number") {
          old.currentValue = old.current;
          old.currentNote = null;
        } else if (typeof old.current === "string") {
          old.currentValue = parseFloat(old.current) || null;
          old.currentNote = old.current;
        } else {
          old.currentValue = null;
          old.currentNote = null;
        }
        old.lastUpdated = null;
        delete old.progress;
        delete old.target;
        delete old.current;
        okrChanged = true;
      }
    }
  }

  // Build task completion map by okrLink
  const taskStats = buildTaskStats(state.tasks.tasks);

  // Compute dual progress for each objective
  for (const obj of objectives) {
    if (obj.keyResults.length === 0) continue;

    let actSum = 0;
    let outSum = 0;
    for (const kr of obj.keyResults) {
      actSum += computeKrActivity(kr.id, taskStats);
      outSum += computeKrOutcome(kr);
    }

    const newAct = Math.round(actSum / obj.keyResults.length);
    const newOut = Math.round(outSum / obj.keyResults.length);
    if (newAct !== obj.activityProgress || newOut !== obj.outcomeProgress) {
      obj.activityProgress = newAct;
      obj.outcomeProgress = newOut;
      okrChanged = true;
    }
  }

  if (okrChanged) {
    state._dirty.add("planOkrDashboard");
  }
  if (objectives.length > 0) {
    const active = objectives.filter((o) => o.status === "active");
    if (active.length > 0) {
      const avgAct = Math.round(active.reduce((sum, o) => sum + o.activityProgress, 0) / active.length);
      const avgOut = Math.round(active.reduce((sum, o) => sum + o.outcomeProgress, 0) / active.length);
      s.okr = `${active.length} active objectives. Activity: ${avgAct}%, Outcome: ${avgOut}%.`;
    } else {
      s.okr = `${objectives.length} objectives (none active).`;
    }
  } else {
    s.okr = "No OKRs set.";
  }

  // Context memory summary
  const patterns = state.contextMemory.patterns;
  const facts = state.contextMemory.facts;
  const hintedCount = facts.filter((f): f is Fact => typeof f !== "string" && !!f.topic).length;
  s.contextMemory = `${patterns.length} patterns, ${facts.length} facts (${hintedCount} topic-tagged).`;

  // Feedback memory summary
  const signals = state.feedbackMemory.behavioralSignals;
  const corrections = state.feedbackMemory.corrections;
  s.feedbackMemory = `${signals.length} signals, ${corrections.length} corrections.`;

  // Topic summary
  const topicCount = state.topicManifest.topics.length;
  const pendingTopicCount = state.topicManifest.pendingSuggestions.filter(sg => sg.status === "pending").length;
  s.topics = topicCount > 0
    ? `${topicCount} topics.${pendingTopicCount > 0 ? ` ${pendingTopicCount} pending suggestions.` : ""}`
    : "No topics yet.";

  state._dirty.add("summaries");
}

export function rebuildHotContext(state: AppState): void {
  const priorityOrder: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const open = [...state.tasks.tasks]
    .filter((t) => isTaskActive(t.status))
    .sort(
      (a, b) =>
        (priorityOrder[a.priority] ?? 2) -
          (priorityOrder[b.priority] ?? 2) ||
        (a.due || "\uffff").localeCompare(b.due || "\uffff")
    );

  const h = state.hotContext;
  const tz = state.userProfile?.timezone || undefined;
  const nowLocal = new Date();
  h.generatedAt = nowLocal.toISOString();
  h.today = nowLocal.toLocaleDateString("en-CA", { timeZone: tz });
  h.weekday = nowLocal.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });

  const upcoming = state.calendar.events
    .filter((e) => !e.archived && e.status !== "cancelled" && (e.datetime?.slice(0, 10) || "") >= h.today)
    .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
  h.openTaskCount = open.length;
  h.overdueCount = open.filter((t) => isOverdueCheck(t.due, h.today)).length;
  h.top3ActiveTasks = open.slice(0, 3).map(({ id, title, due, priority }) => ({
    id,
    title,
    due,
    status: "pending",
    priority,
  }));
  h.nextCalendarEvent = upcoming[0]
    ? { title: upcoming[0].title, datetime: upcoming[0].datetime }
    : null;

  // OKR snapshot for hotContext
  const activeObjs = state.planOkrDashboard.objectives.filter(
    (o) => o.status === "active"
  );
  h.okrSnapshot = activeObjs.length > 0
    ? activeObjs.map((o) => `${o.title}: activity ${o.activityProgress}%, outcome ${o.outcomeProgress}%`).join("; ")
    : "";
  h.userName = state.userProfile.name;
  h.timezone = state.userProfile.timezone;

  state._dirty.add("hotContext");
}

export function rebuildContradictionIndex(state: AppState): void {
  const byDate: Record<string, string[]> = {};
  const byTopic: Record<string, string[]> = {};
  const byOkr: Record<string, string[]> = {};

  for (const t of state.tasks.tasks) {
    if (t.status === "done" || t.status === "deferred") continue;
    if (t.due) (byDate[t.due.slice(0, 10)] ??= []).push(t.id);
    // Use category for topic indexing (not word-splitting titles)
    if (t.category) (byTopic[t.category] ??= []).push(t.id);
    if (t.okrLink) (byOkr[t.okrLink] ??= []).push(t.id);
  }

  for (const e of state.calendar.events) {
    if (e.archived || e.status === "cancelled") continue;
    if (e.datetime) (byDate[e.datetime.slice(0, 10)] ??= []).push(e.id);
    if (e.type) (byTopic[e.type] ??= []).push(e.id);
  }

  state.contradictionIndex = { byDate, byTopic, byOkr };
  state._dirty.add("contradictionIndex");
}

// isOverdue is now imported from src/utils/dates.ts
