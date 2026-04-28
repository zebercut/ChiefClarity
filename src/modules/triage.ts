/**
 * FEAT043 — Stage 1: Triage module.
 *
 * Calls Haiku with a lean prompt to classify the request, decide what data
 * to load, and ask for scope clarification when the request is ambiguous
 * over a large dataset. Learns user scope preferences via feedbackMemory.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { IntentType, HotContext, AppState } from "../types";
import { TOKEN_BUDGETS } from "./router";
import { MODEL_LIGHT, isCircuitOpen } from "./llm";
import { getTodayFromTz, nowLocalIso } from "../utils/dates";

let _client: Anthropic | null = null;

export function setTriageClient(c: Anthropic): void {
  _client = c;
}

// ── Types ──────────────────────────────────────────────────────────────

export type ActionType = "create" | "update" | "query" | "analysis" | "plan" | "chat";
export type Complexity = "low" | "high";

export interface ClarificationOption {
  label: string;
  hint: string; // e.g. "tasks:open", "calendar:this_week"
}

export interface TriageResult {
  understanding: string;
  dataSources: string[];
  queryHints: Record<string, string>;
  semanticQuery: string | null;
  canHandle: boolean;
  cannotHandleReason?: string;
  complexity: Complexity;
  actionType: ActionType;
  /** If true, the pipeline should pause and show clarificationQuestion. */
  needsClarification?: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: ClarificationOption[];
  /** If set, the triage was resolved by regex fast-path (no LLM call). */
  fastPath?: boolean;
  /** Legacy intentType for backward compat with MODEL_BY_INTENT. */
  legacyIntent?: IntentType;
}

// ── Data volumes helper ────────────────────────────────────────────────

export interface DataVolumes {
  openTasks: number;
  completedTasks: number;
  totalTasks: number;
  calendarEventsThisWeek: number;
  calendarEventsTotal: number;
  notesCount: number;
  factsCount: number;
}

export function buildDataVolumes(state: AppState): DataVolumes {
  const today = state.hotContext?.today || getTodayFromTz(state.userProfile?.timezone);
  const weekEnd = addDays(today, 7);
  const tasks = state.tasks?.tasks || [];
  const events = (state.calendar?.events || []).filter(
    (e) => !e.archived && e.status !== "cancelled"
  );
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "deferred" && t.status !== "parked").length;
  return {
    openTasks,
    completedTasks: tasks.length - openTasks,
    totalTasks: tasks.length,
    calendarEventsThisWeek: events.filter(
      (e) => e.datetime && e.datetime.slice(0, 10) >= today && e.datetime.slice(0, 10) <= weekEnd
    ).length,
    calendarEventsTotal: events.length,
    notesCount: (state.notes?.notes || []).length,
    factsCount: (state.contextMemory?.facts || []).length,
  };
}

/** Extract scope preference rules from feedbackMemory. */
export function extractScopePreferences(state: AppState): string[] {
  const rules = state.feedbackMemory?.rules || [];
  return rules
    .filter((r) => r.rule.toLowerCase().includes("default to") || r.rule.toLowerCase().includes("scope"))
    .map((r) => r.rule);
}

// ── Triage tool schema ─────────────────────────────────────────────────

const TRIAGE_TOOL: Anthropic.Tool = {
  name: "submit_triage",
  description: "Classify the user's request and specify what data is needed.",
  input_schema: {
    type: "object" as const,
    properties: {
      understanding: { type: "string", description: "One sentence: what the user wants" },
      dataSources: {
        type: "array",
        items: {
          type: "string",
          enum: ["tasks", "calendar", "okr", "facts", "observations", "notes", "recurring", "profile", "lifestyle", "chat_history", "topics"],
        },
        description: "Which data sources to load for Stage 2",
      },
      queryHints: {
        type: "object",
        description: "Per-source filter hints, e.g. { tasks: 'overdue', calendar: 'next 3 days' }",
      },
      semanticQuery: { type: "string", description: "Phrase for semantic vector search, or null" },
      canHandle: { type: "boolean", description: "false if outside app capabilities (weather, web, email)" },
      cannotHandleReason: { type: "string", description: "Explanation if canHandle is false" },
      complexity: { type: "string", enum: ["low", "high"] },
      actionType: { type: "string", enum: ["create", "update", "query", "analysis", "plan", "chat"] },
      needsClarification: {
        type: "boolean",
        description: "true if the request scope is ambiguous and the data source has > 30 items. Do NOT set for CRUD or when user said 'all'/'everything', or when scopePreferences already resolve the scope.",
      },
      clarificationQuestion: {
        type: "string",
        description: "Short question with item counts, e.g. 'Check open tasks (55) or all tasks including completed (118)?'",
      },
      clarificationOptions: {
        type: "array",
        description: "2-3 quick-tap options for the user",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Button text, e.g. 'Open tasks only'" },
            hint: { type: "string", description: "Scope hint passed back on re-triage, e.g. 'tasks:open'" },
          },
          required: ["label", "hint"],
        },
      },
    },
    required: ["understanding", "dataSources", "canHandle", "complexity", "actionType"],
  },
};

// ── Triage prompt ──────────────────────────────────────────────────────

const TRIAGE_PROMPT = `You are a request classifier for a personal assistant app.
The user sent a message. Determine what they need and what data is required.

The input includes dataVolumes (item counts per source) and scopePreferences (learned user defaults).

Available data sources:
- tasks: user's tasks (filter hints: "all", "overdue", "due this week", "open", "done")
- calendar: events (filter hints: "today", "next 3 days", "this week", "all")
- okr: objectives and key results with progress
- facts: stored knowledge/observations about the user
- observations: behavioral patterns (work style, emotional state)
- notes: user's voice/text notes
- recurring: repeating task schedules
- profile: user identity, timezone, family
- lifestyle: daily schedule, work windows, preferences
- chat_history: recent conversation context
- topics: topic repository

Rules:
- For simple task/event creation, only request the minimum sources needed
- Set complexity to "high" for: analysis, deduplication, consolidation, cross-referencing, finding patterns
- Set complexity to "low" for: creating/updating/deleting single items, simple queries
- Set canHandle to false for: weather, web search, sending emails, making calls, anything outside the app
- Use semanticQuery when the user's question involves finding items by meaning/concept

## Scope Clarification
If the request involves analysis or search over a large data source (check dataVolumes — if total > 30 items) and the user did not specify a clear scope, set needsClarification = true.
DO NOT clarify if:
- The total items for the relevant source is <= 30 (just load everything)
- The user said "all", "everything", "entire", or "complete"
- scopePreferences already contains a matching preference for this type of analysis
- The request is simple CRUD (create/update/delete)
When clarifying, include item counts in the question so the user can make an informed choice.
Offer 2-3 options with clear labels and hints.

Use the submit_triage tool to respond.`;

// ── Regex fast-path ────────────────────────────────────────────────────

const FAST_PATH_MAP: Array<[RegExp[], Partial<TriageResult> & { legacyIntent: IntentType }]> = [
  [
    [/\b(add|create|new)\b.*(task|todo|reminder)/i, /\b(remind me|remember to|don't forget)\b/i],
    { dataSources: ["tasks", "calendar"], complexity: "low", actionType: "create", legacyIntent: "task_create" },
  ],
  [
    [/\b(mark|done|complete|finished|cancel)\b.*(task|todo)/i, /\b(done with|finished)\b/i],
    { dataSources: ["tasks"], complexity: "low", actionType: "update", legacyIntent: "task_update" },
  ],
  [
    [/\b(schedule|book|set up)\b.*(meeting|appointment|call|event)/i],
    { dataSources: ["calendar", "tasks"], complexity: "low", actionType: "create", legacyIntent: "calendar_create" },
  ],
  [
    [/\b(cancel|reschedule|move|postpone)\b.*(meeting|event|appointment|call)/i],
    { dataSources: ["calendar"], complexity: "low", actionType: "update", legacyIntent: "calendar_update" },
  ],
  [
    [/\b(plan my|plan the|plan for)\b.*(day|week|tomorrow|morning|afternoon)/i, /\b(weekly review|daily plan|prepare.*plan)\b/i],
    { dataSources: ["tasks", "calendar", "okr", "recurring", "lifestyle", "observations", "facts"], complexity: "high", actionType: "plan", legacyIntent: "full_planning" },
  ],
  [
    [/\b(okr|goal|objective|key result)\b/i],
    { dataSources: ["okr", "tasks"], complexity: "low", actionType: "update", legacyIntent: "okr_update" },
  ],
  [
    [/\b(feeling|stressed|frustrated|anxious|overwhelmed|venting|what a day)\b/i],
    { dataSources: ["facts", "observations", "tasks"], complexity: "high", actionType: "chat", legacyIntent: "emotional_checkin" },
  ],
  // FEAT068 — info_lookup fast-path. Matches "what do you know about X",
  // "tell me about Y", "what was that thing about Z", "any info on W",
  // "summarize what I know about Q". The dispatcher's pre-LLM retrieval
  // hook then fetches top-K chunks from the on-device vector index.
  [
    [
      /^(what (do you know|can you tell me)|tell me) about\b/i,
      /^what was that (thing|idea) (about|on)\b/i,
      /^what (about|did i say about)\b/i,
      /^(any info on|do you know anything about|give me the rundown on)\b/i,
      /^summarize what i (know|have) (about|on)\b/i,
    ],
    { dataSources: ["notes", "topics", "facts"], complexity: "low", actionType: "query", legacyIntent: "info_lookup" },
  ],
];

function tryFastPath(phrase: string): TriageResult | null {
  const lower = phrase.toLowerCase().trim();
  for (const [patterns, partial] of FAST_PATH_MAP) {
    if (patterns.some((p) => p.test(lower))) {
      return {
        understanding: phrase,
        dataSources: partial.dataSources || [],
        queryHints: {},
        semanticQuery: null,
        canHandle: true,
        complexity: partial.complexity || "low",
        actionType: partial.actionType || "chat",
        fastPath: true,
        legacyIntent: partial.legacyIntent,
      };
    }
  }
  return null;
}

// ── Main triage function ───────────────────────────────────────────────

export async function runTriage(
  phrase: string,
  conversationSummary: string,
  hotContext: HotContext | null,
  state?: AppState | null
): Promise<TriageResult> {
  // 1. Try regex fast-path
  const fast = tryFastPath(phrase);
  if (fast) {
    console.log(`[triage] fast-path → ${fast.legacyIntent} (${fast.actionType}, ${fast.complexity})`);
    return fast;
  }

  // 2. If no LLM client or circuit breaker open, return safe default
  if (!_client || isCircuitOpen()) {
    return safeDefault(phrase);
  }

  // 3. Call Haiku for triage
  try {
    const dataVolumes = state ? buildDataVolumes(state) : null;
    const scopePreferences = state ? extractScopePreferences(state) : [];

    const input: Record<string, unknown> = {
      phrase,
      conversationSummary: conversationSummary || "",
      today: hotContext?.today || "",
      userName: hotContext?.userName || "",
      openTaskCount: hotContext?.openTaskCount ?? 0,
      overdueCount: hotContext?.overdueCount ?? 0,
    };
    if (dataVolumes) input.dataVolumes = dataVolumes;
    if (scopePreferences.length > 0) input.scopePreferences = scopePreferences;

    const response = await _client.messages.create({
      model: MODEL_LIGHT,
      max_tokens: 350,
      system: TRIAGE_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }],
      tools: [TRIAGE_TOOL],
      tool_choice: { type: "tool" as const, name: "submit_triage" },
    });

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_triage") {
        const t = block.input as Record<string, unknown>;
        const result: TriageResult = {
          understanding: (t.understanding as string) || phrase,
          dataSources: (t.dataSources as string[]) || [],
          queryHints: (t.queryHints as Record<string, string>) || {},
          semanticQuery: (t.semanticQuery as string) || null,
          canHandle: t.canHandle !== false,
          cannotHandleReason: (t.cannotHandleReason as string) || undefined,
          complexity: (t.complexity as Complexity) || "low",
          actionType: (t.actionType as ActionType) || "chat",
          needsClarification: (t.needsClarification as boolean) || false,
          clarificationQuestion: (t.clarificationQuestion as string) || undefined,
          clarificationOptions: (t.clarificationOptions as ClarificationOption[]) || undefined,
        };
        const clarifTag = result.needsClarification ? " [NEEDS CLARIFICATION]" : "";
        console.log(`[triage] haiku → ${result.actionType} (${result.complexity}), sources=[${result.dataSources.join(",")}]${result.semanticQuery ? `, semantic="${result.semanticQuery}"` : ""}${clarifTag}`);
        return result;
      }
    }
  } catch (err: any) {
    console.warn("[triage] Haiku call failed, using safe default:", err?.message);
  }

  return safeDefault(phrase);
}

// ── Learning: save user scope preference ───────────────────────────────

/**
 * After the user picks a clarification option, persist the preference
 * so triage auto-resolves next time. Writes to feedbackMemory.rules.
 */
export function learnScopePreference(
  actionType: ActionType,
  chosenHint: string,
  state: AppState
): void {
  const rule = `For ${actionType}, default scope to "${chosenHint}"`;
  const rules = state.feedbackMemory?.rules || [];
  const dataSource = chosenHint.split(":")[0]; // e.g. "tasks" from "tasks:open"
  const exists = rules.some(
    (r) => r.rule.includes(actionType) && r.rule.includes("default scope") && r.rule.includes(dataSource)
  );
  if (exists) return; // already learned
  if (!state.feedbackMemory) return;
  if (!state.feedbackMemory.rules) state.feedbackMemory.rules = [];
  state.feedbackMemory.rules.push({
    rule,
    source: "system" as const,
    date: nowLocalIso().slice(0, 10),
  });
  state._dirty.add("feedbackMemory");
}

// ── Helpers ────────────────────────────────────────────────────────────

function safeDefault(phrase: string): TriageResult {
  console.log("[triage] fallback → general (low)");
  return {
    understanding: phrase,
    dataSources: ["tasks", "calendar", "facts", "observations"],
    queryHints: {},
    semanticQuery: phrase,
    canHandle: true,
    complexity: "low",
    actionType: "chat",
    legacyIntent: "general",
  };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
