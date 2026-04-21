/**
 * FEAT041 — State bridge.
 *
 * Loads all tables from libSQL and reconstructs the exact AppState shape
 * the rest of the app expects. Drop-in replacement for the JSON-based loadState().
 */
import type {
  AppState,
  FileKey,
  HotContext,
  Summaries,
  ContextMemory,
  FeedbackMemory,
  ContentIndex,
  ContradictionIndex,
  PlanNarrative,
  PlanAgenda,
  PlanRisks,
  FocusBrief,
} from "../../types";

import { loadTasks } from "./tasks";
import { loadCalendar } from "./calendar";
import { loadNotes } from "./notes";
import { loadRecurring } from "./recurring";
import { loadOkrDashboard } from "./okr";
import { loadContextMemory } from "./context-memory";
import { loadObservations } from "./observations";
import { loadTopics } from "./topics";
import { loadSuggestions } from "./suggestions";
import { loadLearning } from "./learning";
import { loadProfile, loadLifestyle } from "./kv";
import { loadSnapshot } from "./snapshots";

// ── Default shapes (same as the JSON-era defaults in loader.ts) ────

const DEFAULT_HOT_CONTEXT: HotContext = {
  generatedAt: "",
  today: "",
  weekday: "",
  userName: "",
  timezone: "",
  top3ActiveTasks: [],
  nextCalendarEvent: null,
  okrSnapshot: "",
  openTaskCount: 0,
  overdueCount: 0,
  lastSuggestionShown: "",
};

const DEFAULT_SUMMARIES: Summaries = {
  tasks: "",
  calendar: "",
  okr: "",
  contextMemory: "",
  feedbackMemory: "",
  suggestionsLog: "",
  learningLog: "",
  topics: "",
};

const DEFAULT_CONTENT_INDEX: ContentIndex = {
  schemaVersion: "1",
  updatedAt: "",
  entities: {},
};

const DEFAULT_CONTRADICTION_INDEX: ContradictionIndex = {
  byDate: {},
  byTopic: {},
  byOkr: {},
};

const DEFAULT_FEEDBACK_MEMORY: FeedbackMemory = {
  preferences: {
    reminderFormat: "task",
    responseLength: "short",
    deepWorkDays: [],
    ignoredTopics: [],
    preferredTimeForReminders: "morning",
  },
  behavioralSignals: [],
  corrections: [],
  rules: [],
};

/**
 * Load the full AppState from libSQL.
 * Parallel loads for independent tables, exact same shape as JSON-era loadState().
 */
export async function loadStateFromDb(): Promise<AppState> {
  const [
    tasks,
    calendar,
    notes,
    recurringTasks,
    planOkrDashboard,
    contextMemory,
    userObservations,
    topicManifest,
    suggestionsLog,
    learningLog,
    userProfile,
    userLifestyle,
    hotContext,
    summaries,
    planNarrative,
    planAgenda,
    planRisks,
    focusBrief,
    contentIndex,
    contradictionIndex,
    feedbackMemory,
  ] = await Promise.all([
    loadTasks(),
    loadCalendar(),
    loadNotes(),
    loadRecurring(),
    loadOkrDashboard(),
    loadContextMemory(),
    loadObservations(),
    loadTopics(),
    loadSuggestions(),
    loadLearning(),
    loadProfile(),
    loadLifestyle(),
    loadSnapshot<HotContext>("hotContext"),
    loadSnapshot<Summaries>("summaries"),
    loadSnapshot<PlanNarrative>("planNarrative"),
    loadSnapshot<PlanAgenda>("planAgenda"),
    loadSnapshot<PlanRisks>("planRisks"),
    loadSnapshot<FocusBrief>("focusBrief"),
    loadSnapshot<ContentIndex>("contentIndex"),
    loadSnapshot<ContradictionIndex>("contradictionIndex"),
    loadSnapshot<FeedbackMemory>("feedbackMemory"),
  ]);

  return {
    hotContext: hotContext ?? DEFAULT_HOT_CONTEXT,
    summaries: summaries ?? DEFAULT_SUMMARIES,
    tasks,
    calendar,
    contextMemory,
    feedbackMemory: feedbackMemory ?? DEFAULT_FEEDBACK_MEMORY,
    contentIndex: contentIndex ?? DEFAULT_CONTENT_INDEX,
    contradictionIndex: contradictionIndex ?? DEFAULT_CONTRADICTION_INDEX,
    suggestionsLog,
    learningLog,
    userProfile,
    userLifestyle,
    userObservations,
    planNarrative: planNarrative ?? { summary: "" },
    planAgenda: planAgenda ?? { agenda: [] },
    planRisks: planRisks ?? { risks: [] },
    planOkrDashboard,
    focusBrief: focusBrief ?? ({
      id: "",
      generatedAt: "",
      variant: "day",
      dateRange: { start: "", end: "" },
      executiveSummary: "",
      routineTemplate: [],
      days: [],
      priorities: [],
      risks: [],
      okrSnapshot: [],
      companion: {
        energyRead: "medium",
        mood: "",
        motivationNote: "",
        patternsToWatch: [],
        copingSuggestion: "",
        wins: [],
        focusMantra: "",
      },
      annotations: [],
    } as FocusBrief),
    recurringTasks,
    topicManifest,
    notes,
    _dirty: new Set(),
    _pendingContext: null,
    _loadedCounts: {
      tasks: tasks.tasks.length,
      calendar: calendar.events.length,
      notes: notes.notes.length,
      learningLog: learningLog.items.length,
      recurringTasks: recurringTasks.recurring.length,
      suggestionsLog: suggestionsLog.suggestions.length,
      contextMemory: contextMemory.facts.length,
      planOkrDashboard: planOkrDashboard.objectives.length,
    } as Partial<Record<FileKey, number>>,
  };
}
