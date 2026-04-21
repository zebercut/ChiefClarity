/**
 * FEAT043 — Triage-driven data loader.
 *
 * Reads the triage output and loads only the requested data sources
 * with optional query hints for filtering. Replaces the assembler's
 * per-intent switch/case for the new pipeline.
 */
import type { AppState, ConversationTurn } from "../types";
import type { TriageResult } from "./triage";
import { buildTopicList, getExistingHints } from "./topicManager";
import { computeTaskPriority } from "./taskPrioritizer";
import { getUserToday } from "../utils/dates";
import { buildSystemPrompt } from "../constants/prompts/index";

// Injected by proxy/headless — null on web
let _retrieveContextFn: ((phrase: string, intentType: string, limit?: number) => Promise<unknown[]>) | null = null;

export function injectTriageRetriever(fn: typeof _retrieveContextFn): void {
  _retrieveContextFn = fn;
}

/**
 * Load context based on triage result. Returns the context object
 * ready to send to Stage 2 LLM call.
 */
export async function loadTriageContext(
  triage: TriageResult,
  phrase: string,
  state: AppState,
  conversation: ConversationTurn[]
): Promise<{ context: Record<string, unknown>; systemPrompt: string }> {
  const ctx: Record<string, unknown> = {
    phrase,
    intent: triage.actionType,
    understanding: triage.understanding,
    today: state.hotContext?.today || getUserToday(state),
    conversationSummary: buildConversationSummary(conversation),
  };

  // Add rules and preferences (always — cheap, important)
  if (state.feedbackMemory?.rules?.length) {
    ctx.rules = state.feedbackMemory.rules;
  }
  if (state.feedbackMemory?.preferences) {
    ctx.preferences = state.feedbackMemory.preferences;
  }

  const today = getUserToday(state);

  // Load each requested data source
  for (const source of triage.dataSources) {
    switch (source) {
      case "tasks": {
        const hint = triage.queryHints?.tasks || "";
        const tasks = state.tasks.tasks;
        if (hint.includes("overdue")) {
          ctx.tasksIndex = tasks.filter((t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked" && t.due && t.due < today)
            .map(({ id, title, due, status, priority }) => ({ id, title, due, status, priority }));
        } else if (hint.includes("due this week")) {
          const weekEnd = addDays(today, 7);
          ctx.tasksIndex = tasks.filter((t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked" && t.due && t.due >= today && t.due <= weekEnd)
            .map(({ id, title, due, status, priority }) => ({ id, title, due, status, priority }));
        } else if (hint.includes("all") || triage.actionType === "analysis") {
          // Analysis needs all tasks for dedup/consolidation
          ctx.tasksFull = tasks;
        } else {
          // Default: prioritized index of open tasks
          ctx.tasksIndex = computeTaskPriority(tasks, today)
            .map(({ id, title, due, status, priority }) => ({ id, title, due, status, priority }));
        }
        break;
      }
      case "calendar": {
        const hint = triage.queryHints?.calendar || "";
        const events = state.calendar.events.filter((e) => !e.archived && e.status !== "cancelled");
        if (hint.includes("today")) {
          ctx.calendarEvents = events.filter((e) => e.datetime?.startsWith(today));
        } else if (hint.includes("next 3 days")) {
          const end = addDays(today, 3);
          ctx.calendarEvents = events.filter((e) => e.datetime && e.datetime.slice(0, 10) >= today && e.datetime.slice(0, 10) <= end);
        } else if (hint.includes("this week")) {
          const end = addDays(today, 7);
          ctx.calendarEvents = events.filter((e) => e.datetime && e.datetime.slice(0, 10) >= today && e.datetime.slice(0, 10) <= end);
        } else {
          // Default: all active events from today onward
          ctx.calendarEvents = events.filter((e) => !e.datetime || e.datetime.slice(0, 10) >= today)
            .sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
        }
        break;
      }
      case "okr":
        ctx.okrDashboard = state.planOkrDashboard;
        break;
      case "facts":
        ctx.contextMemory = state.contextMemory;
        break;
      case "observations":
        ctx.userObservations = state.userObservations;
        break;
      case "notes":
        ctx.notes = state.notes;
        break;
      case "recurring":
        ctx.recurringTasks = state.recurringTasks;
        break;
      case "profile":
        ctx.userProfile = state.userProfile;
        break;
      case "lifestyle":
        ctx.userLifestyle = state.userLifestyle;
        break;
      case "chat_history":
        ctx.hotContext = state.hotContext;
        break;
      case "topics":
        ctx.topicList = buildTopicList(state.topicManifest);
        ctx.existingTopicHints = getExistingHints(state.topicManifest, state.contextMemory.facts);
        break;
    }
  }

  // Planning needs summaries and hotContext for the full SYSTEM_PROMPT
  if (triage.actionType === "plan") {
    ctx.summaries = state.summaries;
    ctx.hotContext = state.hotContext;
    ctx.userName = state.userProfile?.name || "";
  }

  // Vector search if triage requested it
  if (triage.semanticQuery && _retrieveContextFn) {
    try {
      const intentForRetrieval = mapActionTypeToRetrievalIntent(triage.actionType);
      const results = await _retrieveContextFn(triage.semanticQuery, intentForRetrieval, 15);
      if (results.length > 0) {
        ctx.vectorRetrieved = results;
      }
    } catch (err: any) {
      console.warn("[triageLoader] vector search failed:", err?.message);
    }
  }

  // Build the tailored system prompt
  const systemPrompt = buildSystemPrompt(triage.actionType);

  return { context: ctx, systemPrompt };
}

// ── Helpers ────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildConversationSummary(conversation: ConversationTurn[]): string {
  if (conversation.length === 0) return "";
  // Take last 6 turns, compress to summary
  const recent = conversation.slice(-6);
  return recent
    .map((t) => `${t.role}: ${t.content.slice(0, 100)}`)
    .join("\n");
}

function mapActionTypeToRetrievalIntent(actionType: string): string {
  const map: Record<string, string> = {
    query: "info_lookup",
    analysis: "info_lookup",
    chat: "general",
    create: "general",
    update: "general",
    plan: "general",
  };
  return map[actionType] || "general";
}
