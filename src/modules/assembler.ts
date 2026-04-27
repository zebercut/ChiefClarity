import type { AppState, IntentResult, ConversationTurn, PlanVariant, Fact, TopicManifest } from "../types";
import { computeKrOutcome, computeKrActivity, buildTaskStats } from "../types";
import { buildCompanionContext } from "./companion";
import { buildTopicList, getExistingHints, readTopicFile, buildTopicCrossRef } from "./topicManager";
import { buildRecurringByDate } from "./recurringProcessor";
import { computeTaskPriority } from "./taskPrioritizer";
import { getUserToday } from "../utils/dates";

// FEAT042: Injected at proxy/headless startup. Null on web (proxy handles retrieval).
let _retrieveContextFn: ((phrase: string, intentType: string, limit?: number) => Promise<unknown[]>) | null = null;

/** Inject the vector retriever function (Node-only). */
export function injectRetriever(fn: (phrase: string, intentType: string, limit?: number) => Promise<unknown[]>): void {
  _retrieveContextFn = fn;
}

export async function assembleContext(
  intent: IntentResult,
  phrase: string,
  state: AppState,
  conversation: ConversationTurn[]
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = {
    phrase,
    intent: intent.type,
    today: state.hotContext.today,
    weekday: state.hotContext.weekday,
    userName: state.hotContext.userName,
    okrSnapshot: state.hotContext.okrSnapshot,
    summaries: state.summaries,
    userPreferences: state.feedbackMemory.preferences,
    userRules: state.feedbackMemory.rules || [],
    userProfile: state.userProfile,
    // Conversation as a summary string — avoids tool_use message format issues
    conversationSummary: conversation
      .slice(-10)
      .map(
        (t) =>
          `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`
      )
      .join("\n"),
  };

  switch (intent.type) {
    case "task_create":
    case "task_update":
    case "task_query":
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.contradictionIndexDates = state.contradictionIndex.byDate;
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;

    case "calendar_create":
    case "calendar_update":
    case "calendar_query":
      ctx.calendarEvents = getActiveEvents(state);
      ctx.contradictionIndexDates = state.contradictionIndex.byDate;
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;

    case "full_planning":
      ctx.planVariant = detectPlanVariant(phrase);
      // Only send active tasks — done/deferred/parked waste tokens and confuse the planner
      ctx.tasksFull = state.tasks.tasks.filter((t) =>
        t.status !== "done" && t.status !== "deferred" && t.status !== "parked"
      );
      ctx.calendarEvents = getActiveEvents(state);
      ctx.okrDashboard = state.planOkrDashboard;
      ctx.tasksLinkedOkr = buildTasksByOkr(state);
      ctx.okrProgress = buildOkrProgress(state);
      ctx.contextMemory = state.contextMemory;
      ctx.userObservations = state.userObservations;
      // Full lifestyle data — the LLM needs this to build the time-blocked agenda
      ctx.userLifestyle = state.userLifestyle;
      // Recurring commitments — pre-computed per-date map so the LLM doesn't
      // have to parse schedule types or compute weekday-to-date mappings.
      // Only recurringByDate is sent; raw recurringCommitments are NOT included
      // to avoid LLM confusion from seeing the same data in two formats.
      const variant = ctx.planVariant as import("../types").PlanVariant;
      ctx.recurringByDate = buildRecurringByDate(
        state.recurringTasks.recurring,
        variant,
        state.hotContext.today,
      );
      // Filter out recurring calendar instances from calendarEvents to prevent
      // the LLM from seeing the same item in both recurringByDate AND calendarEvents.
      // New instances have isRecurringInstance=true; legacy instances (created before
      // the flag was added) are caught by their ID prefix "rcev_".
      if (Array.isArray(ctx.calendarEvents)) {
        ctx.calendarEvents = (ctx.calendarEvents as any[]).filter(
          (e) => !e.isRecurringInstance && !String(e.id || "").startsWith("rcev_")
        );
      }
      ctx.lastPlanNarrative = state.planNarrative.summary;
      // Companion context — emotional state, patterns, wins, overdue pressure
      ctx.companionContext = buildCompanionContext(state);
      // Topic context for topic-aware planning
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.topicCrossRef = buildTopicCrossRef(
        state.topicManifest,
        ctx.tasksFull as any[],
        ctx.calendarEvents as any[],
      );
      // Include unresolved annotations if pre-loaded into state
      if ((state as any)._annotations?.length > 0) {
        ctx.unresolvedAnnotations = (state as any)._annotations.map((a: any) => ({
          target: a.targetTitle,
          type: a.targetType,
          comment: a.comment,
        }));
      }
      if (state.focusBrief.id) {
        // FEAT045: delta-aware replanning — if same-day brief exists,
        // send a delta so the LLM adjusts instead of regenerating.
        const { buildReplanContext } = require("./briefDelta");
        const replanCtx = buildReplanContext(state);
        if (replanCtx) {
          Object.assign(ctx, replanCtx);
          // Clear changelog — the LLM received the delta, fresh start after replan
          if (state.focusBrief._changelog) state.focusBrief._changelog = [];
        } else {
          ctx.previousBrief = {
            variant: state.focusBrief.variant,
            generatedAt: state.focusBrief.generatedAt,
            executiveSummary: state.focusBrief.executiveSummary,
          };
        }
      }
      break;

    case "okr_update":
      ctx.okrDashboard = state.planOkrDashboard;
      ctx.tasksLinkedOkr = buildTasksByOkr(state);
      ctx.okrProgress = buildOkrProgress(state);
      ctx.goalsContext = state.userObservations.goalsContext;
      break;

    case "learning":
      ctx.learningLog = state.learningLog;
      break;

    case "suggestion_request":
      ctx.suggestionsLog = state.suggestionsLog;
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.okrDashboard = state.planOkrDashboard;
      ctx.workStyle = state.userObservations.workStyle;
      ctx.taskCompletionPatterns = state.userObservations.taskCompletionPatterns;
      break;

    case "emotional_checkin":
      ctx.contextMemoryRecent = state.contextMemory.recentEvents;
      ctx.feedbackMemorySignals = state.feedbackMemory.behavioralSignals;
      ctx.emotionalState = state.userObservations.emotionalState;
      ctx.communicationStyle = state.userObservations.communicationStyle;
      break;

    case "info_lookup":
      ctx.contentIndex = state.contentIndex;
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.calendarEvents = getActiveEvents(state);
      ctx.contextMemory = state.contextMemory;
      break;

    case "feedback":
      ctx.feedbackMemory = state.feedbackMemory;
      break;

    case "general":
      // General intent gets task + calendar data so the LLM can answer
      // questions about the user's data even when intent classification is imperfect
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.calendarEvents = getActiveEvents(state);
      ctx.goalsContext = state.userObservations?.goalsContext ?? {};
      ctx.communicationStyle = state.userObservations?.communicationStyle ?? [];
      ctx.contextMemory = state.contextMemory;
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;

    case "bulk_input":
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.calendarEvents = getActiveEvents(state);
      ctx.okrDashboard = state.planOkrDashboard;
      ctx.goalsContext = state.userObservations?.goalsContext ?? {};
      ctx.contradictionIndexDates = state.contradictionIndex.byDate;
      ctx.userLifestyle = {
        sleepWake: state.userLifestyle?.sleepWake,
        preferences: state.userLifestyle?.preferences,
      };
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;

    case "topic_query": {
      const topicId = extractTopicFromPhrase(phrase, state.topicManifest);
      if (topicId) {
        const raw = await readTopicFile(topicId);
        // Keep most recent content if file exceeds ~2600 tokens
        ctx.topicContent = raw.length > 8000 ? raw.slice(-8000) : raw;
        ctx.topicName = state.topicManifest.topics.find(t => t.id === topicId)?.name || topicId;
      }
      ctx.topicFacts = state.contextMemory.facts
        .filter((f): f is Fact => typeof f !== "string" && f.topic === topicId)
        .map(f => f.text);
      ctx.tasksIndex = buildTaskIndex(state);
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;
    }

    case "topic_note": {
      ctx.topicManifest = state.topicManifest;
      ctx.pendingSuggestions = state.topicManifest.pendingSuggestions
        .filter(s => s.status === "pending");
      ctx.topicList = buildTopicList(state.topicManifest);
      ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
      break;
    }
  }

  // FEAT042: augment context with vector-retrieved items for supported intents
  const vectorIntents = new Set(["info_lookup", "general", "topic_query", "task_query", "calendar_query"]);
  if (_retrieveContextFn && vectorIntents.has(intent.type)) {
    try {
      const retrieved = await _retrieveContextFn(phrase, intent.type, 15);
      if (retrieved.length > 0) {
        ctx.vectorRetrieved = retrieved;
      }
    } catch (err: any) {
      // Non-fatal: fall back to standard context
      console.warn("[assembler] vector retrieval failed:", err?.message);
    }
  }

  return enforceBudget(ctx, intent.tokenBudget);
}

function enforceBudget(
  ctx: Record<string, unknown>,
  budget: number
): Record<string, unknown> {
  // Only truncate large arrays — never truncate lifestyle, profile, OKR data
  const truncatableKeys = [
    "tasksFull",
    "tasksIndex",
    "calendarEvents",
    "suggestionsLog",
    "topicFacts",
    "vectorRetrieved",
    "topicCrossRef",
  ];

  // Estimate once, then calculate how much to trim
  let total = estimateTokens(ctx);
  if (total <= budget) return ctx;

  for (const key of truncatableKeys) {
    const val = ctx[key];
    if (!Array.isArray(val) || val.length <= 3) continue;

    const perItem = estimateTokens(val) / val.length;
    const excess = total - budget;
    const toDrop = Math.min(
      Math.ceil(excess / Math.max(perItem, 1)),
      val.length - 3
    );

    if (toDrop > 0) {
      ctx[key] = val.slice(0, val.length - toDrop);
      total -= toDrop * perItem;
    }

    if (total <= budget) break;
  }

  return ctx;
}

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 3);
}

/**
 * Compact task index for LLM context — title, due, status, priority by id.
 * Exported so v4 skill dispatchers can reuse the same shape (FEAT057+).
 */
export function buildTaskIndex(state: AppState) {
  const today = getUserToday(state);
  return computeTaskPriority(state.tasks.tasks, today).map(
    ({ id, title, due, status, priority }) => ({
      id,
      title,
      due,
      status,
      priority,
    })
  );
}

function buildTasksByOkr(state: AppState): Record<string, unknown[]> {
  const byOkr: Record<string, unknown[]> = {};
  for (const t of state.tasks.tasks) {
    if (t.okrLink) {
      (byOkr[t.okrLink] ??= []).push(t);
    }
  }
  return byOkr;
}

function buildOkrProgress(state: AppState): Record<string, { activity: number; outcome: number; tasksDone: number; tasksTotal: number }> {
  const result: Record<string, { activity: number; outcome: number; tasksDone: number; tasksTotal: number }> = {};
  const taskStats = buildTaskStats(state.tasks.tasks);
  for (const obj of state.planOkrDashboard.objectives) {
    for (const kr of obj.keyResults) {
      const stats = taskStats[kr.id] || { total: 0, done: 0 };
      result[kr.id] = {
        activity: computeKrActivity(kr.id, taskStats),
        outcome: computeKrOutcome(kr),
        tasksDone: stats.done,
        tasksTotal: stats.total,
      };
    }
  }
  return result;
}

/**
 * Active events from today onward — filters out cancelled, archived,
 * undated, and past events. Exported (FEAT059) so the v4 skill
 * dispatcher resolver can reuse it for the `calendarEvents`,
 * `calendarToday`, and `calendarNextSevenDays` context keys.
 */
export function getActiveEvents(state: AppState) {
  const today = getUserToday(state); // "YYYY-MM-DD"
  // Only include events from today onward with a valid datetime.
  // Events without a datetime are excluded — they have no place in a
  // time-blocked plan and confuse the LLM into scheduling them for today.
  return state.calendar.events
    .filter((e) => {
      if (e.archived || e.status === "cancelled") return false;
      if (!e.datetime) return false; // skip undated events
      const eventDate = e.datetime.slice(0, 10);
      if (eventDate < today) return false;
      return true;
    })
    .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
}

function detectPlanVariant(phrase: string): PlanVariant {
  const lower = phrase.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return "tomorrow";
  if (/\bweek\b/.test(lower)) return "week";
  return "day";
}

function extractTopicFromPhrase(phrase: string, manifest: TopicManifest): string | null {
  const lower = phrase.toLowerCase();
  for (const topic of manifest.topics) {
    // Use word boundaries to avoid substring false positives (e.g., "art" matching "article")
    const idRe = new RegExp(`\\b${topic.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const nameRe = new RegExp(`\\b${topic.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (idRe.test(lower) || nameRe.test(lower)) return topic.id;
    for (const alias of topic.aliases) {
      const aliasRe = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (aliasRe.test(lower)) return topic.id;
    }
  }
  return null;
}
