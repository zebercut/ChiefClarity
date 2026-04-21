import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../constants/prompts";
import { validateActionPlan } from "../utils/validation";
import { isNode, isWeb, isCapacitor } from "../utils/platform";
import type { ActionPlan, IntentType } from "../types";

let client: Anthropic | null = null;
let _apiKey: string = "";

// ─── Circuit breaker — stops retrying after consecutive failures ─────────
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN = 30 * 60 * 1000; // 30 minutes

let _consecutiveFailures = 0;
let _circuitOpen = false;
let _circuitOpenedAt = 0;
let _lastError = "";

export function isCircuitOpen(): boolean {
  if (!_circuitOpen) return false;
  // Auto-reset after cooldown
  if (Date.now() - _circuitOpenedAt > CIRCUIT_BREAKER_COOLDOWN) {
    resetCircuitBreaker();
    return false;
  }
  return true;
}

export function getCircuitBreakerStatus(): { open: boolean; failures: number; lastError: string; cooldownMinutes: number } {
  const remaining = _circuitOpen
    ? Math.max(0, Math.ceil((CIRCUIT_BREAKER_COOLDOWN - (Date.now() - _circuitOpenedAt)) / 60000))
    : 0;
  return { open: _circuitOpen, failures: _consecutiveFailures, lastError: _lastError, cooldownMinutes: remaining };
}

export function resetCircuitBreaker(): void {
  _consecutiveFailures = 0;
  _circuitOpen = false;
  _circuitOpenedAt = 0;
  _lastError = "";
  console.log("[LLM] Circuit breaker reset");
}

function recordFailure(error: string): void {
  _consecutiveFailures++;
  _lastError = error;
  if (_consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    _circuitOpen = true;
    _circuitOpenedAt = Date.now();
    console.error(`[LLM] Circuit breaker OPEN after ${_consecutiveFailures} consecutive failures. Last error: ${error}. Will auto-reset in 30 minutes.`);
  }
}

function recordSuccess(): void {
  _consecutiveFailures = 0;
  _lastError = "";
}

const PROXY_URL = "http://localhost:3099";

export function initLlmClient(apiKey: string): void {
  _apiKey = apiKey;

  // Only create SDK client for Node/web — Capacitor uses CapacitorHttp directly
  if (!isCapacitor()) {
    client = new Anthropic({
      apiKey,
      ...(isNode() ? {} : { dangerouslyAllowBrowser: true }),
      ...(isWeb() ? { baseURL: PROXY_URL } : {}),
    });
  }
}

export function getClient(): Anthropic | null {
  return client;
}

// ─── Model routing — Sonnet for complex, Haiku for simple (FEAT022) ─────
// Configurable via env: LLM_MODEL_HEAVY (Sonnet) and LLM_MODEL_LIGHT (Haiku).
// Defaults are safe — update .env to switch models without a code change.
const _env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
const HAIKU = _env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
const SONNET = _env.LLM_MODEL_HEAVY || "claude-sonnet-4-6";

/** Light model ID — exported for router.ts intent classification */
export const MODEL_LIGHT = HAIKU;
/** Heavy model ID — exported for triage complexity routing (FEAT043) */
export const MODEL_HEAVY = SONNET;

const MODEL_BY_INTENT: Partial<Record<IntentType, string>> = {
  full_planning: SONNET,
  suggestion_request: SONNET,
  emotional_checkin: SONNET,
};
const DEFAULT_MODEL = HAIKU;

// FEAT045 WP-6: Only these complex intents get Haiku→Sonnet fallback when
// Haiku validation fails. Simple CRUD intents (task_create, bulk_input, etc.)
// fail gracefully instead of doubling cost with a Sonnet retry.
const SONNET_FALLBACK_INTENTS = new Set<IntentType>([
  "full_planning",
  "suggestion_request",
  "emotional_checkin",
  "topic_query",
]);

// Base minimum output tokens per intent
const BASE_TOKENS: Partial<Record<IntentType, number>> = {
  full_planning: 4000,
  suggestion_request: 2048,
  okr_update: 2048,
  bulk_input: 4096,
  topic_query: 2048,
  topic_note: 1024,
};
const DEFAULT_MAX_TOKENS = 1024;
const MODEL_OUTPUT_CAP = 64000; // Sonnet + Haiku max output

/**
 * Estimate how many output tokens the LLM needs based on the context size.
 * The output must contain:
 * - reply (small)
 * - writes (structured JSON — proportional to input data)
 * - suggestions (small)
 *
 * For full_planning specifically, the focusBrief JSON scales with:
 * - number of calendar days (7 for week × ~200 tokens per day with events)
 * - number of tasks (each priority item ~60 tokens)
 * - number of OKR objectives (~100 tokens each)
 * - routine items per day (~30 tokens each)
 */
function estimateMaxTokens(
  intentType: IntentType,
  context: Record<string, unknown>
): number {
  const base = BASE_TOKENS[intentType] ?? DEFAULT_MAX_TOKENS;

  if (intentType !== "full_planning") return base;

  // Count data items that drive output size
  const tasks = Array.isArray(context.tasksFull) ? context.tasksFull.length : 0;
  const events = Array.isArray(context.calendarEvents) ? context.calendarEvents.length : 0;
  const objectives = (context.okrDashboard as any)?.objectives?.length ?? 0;

  const variant = (context.planVariant as string) || "day";
  const days = variant === "week" ? 7 : 1;

  // Estimate routine items from lifestyle
  const routineItems = Array.isArray((context.userLifestyle as any)?.weekdaySchedule)
    ? (context.userLifestyle as any).weekdaySchedule.length
    : 0;

  // Compressed format: routine template sent ONCE (~40 tok each), per-day only additions (~50 tok each)
  const routineTemplateTokens = routineItems * 40; // sent once, not per day
  const perDay = (Math.ceil(events / days) * 50) + 80; // additions + removals + freeBlocks
  const calendarTokens = routineTemplateTokens + (days * perDay);

  // Priorities: ~80 tokens each (title + why + metadata)
  const priorityTokens = Math.min(tasks, variant === "week" ? 7 : 3) * 80;

  // Risks: ~60 tokens each, estimate 3-6
  const riskTokens = 400;

  // OKR: ~120 tokens per objective with KRs
  const okrTokens = objectives * 120;

  // Companion section: mood, motivationNote, patternsToWatch, copingSuggestion, wins, focusMantra
  const companionTokens = 800;

  // Summary + reply + planNarrative writes + day notes + annotations
  const overhead = 500;

  const estimated = calendarTokens + priorityTokens + riskTokens + okrTokens + companionTokens + overhead;

  // Add 30% buffer for JSON structure overhead, then clamp
  const withBuffer = Math.ceil(estimated * 1.3);
  const result = Math.max(base, Math.min(withBuffer, MODEL_OUTPUT_CAP));

  console.log(`[LLM] estimated output tokens: ${result} (days=${days}, tasks=${tasks}, events=${events}, routine=${routineItems}, okrs=${objectives})`);
  return result;
}

const ACTION_PLAN_TOOL: Anthropic.Tool = {
  name: "submit_action_plan",
  description:
    "Submit the structured action plan for the user's request.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: { type: "string" },
      writes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: {
              type: "string",
              enum: [
                "tasks", "calendar", "contextMemory", "feedbackMemory",
                "suggestionsLog", "learningLog", "userProfile", "userLifestyle",
                "userObservations", "planNarrative", "planAgenda",
                "planOkrDashboard", "planRisks", "focusBrief", "recurringTasks",
                "topicManifest",
              ],
            },
            action: {
              type: "string",
              enum: ["add", "update", "delete"],
            },
            id: { type: "string" },
            data: { type: "object" },
            sourceNoteId: {
              type: "string",
              description:
                "Only set when the input contains a `[note <id>]` marker (bulk notes processing). Copy the note id from the marker that introduced the item that produced this write so the app can build a per-note summary. Omit otherwise.",
            },
          },
          required: ["file", "action", "data"],
        },
      },
      conflictsToCheck: {
        type: "array",
        items: { type: "string" },
      },
      suggestions: { type: "array", items: { type: "string" } },
      memorySignals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            signal: { type: "string" },
            value: { type: "string" },
          },
        },
      },
      topicSignals: {
        type: "array",
        description: "Topic slugs detected in the user's input. Reuse from existingTopicHints when possible. New lowercase slugs for new subjects. Empty array if none.",
        items: { type: "string" },
      },
      needsClarification: { type: "boolean" },
      items: {
        type: "array",
        description: "Structured items to display interactively. Use when listing tasks, events, or OKRs. Each item references a real ID from the data.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Real ID from tasks.json, calendar.json, or OKR data" },
            type: { type: "string", enum: ["task", "event", "okr", "suggestion"] },
            group: { type: "string", description: "Group header for UI display (e.g. 'Overdue', 'This Week')" },
            commentary: { type: "string", description: "Your note about this item — context, advice, why it matters" },
            suggestedAction: {
              type: "string",
              enum: ["mark_done", "delete", "reschedule_tomorrow", "reschedule_next_week", "cancel"],
              description: "Your recommended action for this item. Will be highlighted in the UI.",
            },
          },
          required: ["id", "type"],
        },
      },
    },
    required: ["reply", "writes", "suggestions"],
  },
};

// ─── Capacitor native HTTP call — bypasses CORS entirely ─────────────────

async function callAnthropicNative(
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>,
  tools: unknown[],
  toolChoice: unknown,
  maxTokens: number
): Promise<{ content: any[]; stop_reason: string; usage: any }> {
  const { CapacitorHttp } = await import("@capacitor/core");

  const res = await CapacitorHttp.post({
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": _apiKey,
      "anthropic-version": "2023-06-01",
    },
    data: {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools,
      tool_choice: toolChoice,
    },
  });

  if (res.status < 200 || res.status >= 300) {
    const err: any = new Error(`Anthropic API error: ${res.status}`);
    err.status = res.status;
    err.message = res.data?.error?.message || `HTTP ${res.status}`;
    throw err;
  }

  return res.data;
}

/**
 * Send a single LLM request with truncation retry.
 * Returns the validated ActionPlan, or null on failure.
 * Does NOT handle Sonnet fallback — that's callLlm's job.
 */
async function sendLlmRequest(
  model: string,
  messages: Anthropic.MessageParam[],
  tokenBudget: number,
  intentType: IntentType,
  systemPromptOverride?: string,
  toolChoiceAuto?: boolean
): Promise<ActionPlan | null> {
  const MAX_RETRIES = 2;
  let budget = tokenBudget;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tag = model === HAIKU ? "haiku" : "sonnet";
      console.log(`[LLM] ${tag} attempt ${attempt + 1}, model=${model}, max_tokens=${budget}, intent=${intentType}`);

      let stopReason: string | null;
      let content: any[];

      const sysPrompt = systemPromptOverride || SYSTEM_PROMPT;
      const toolChoice = toolChoiceAuto
        ? { type: "auto" as const }
        : { type: "tool" as const, name: "submit_action_plan" };

      if (isCapacitor()) {
        // Native HTTP — no SDK, no CORS
        const response = await callAnthropicNative(
          model,
          sysPrompt,
          messages as Array<{ role: string; content: string }>,
          [ACTION_PLAN_TOOL],
          toolChoice,
          budget
        );
        stopReason = response.stop_reason;
        content = response.content;
        console.log("[LLM] stop_reason:", stopReason, "usage:", response.usage);
      } else {
        // SDK path — Node or web
        const response = await client!.messages.create({
          model,
          max_tokens: budget,
          system: sysPrompt,
          messages,
          tools: [ACTION_PLAN_TOOL],
          tool_choice: toolChoice,
        });
        stopReason = response.stop_reason;
        content = response.content;
        console.log("[LLM] stop_reason:", stopReason, "usage:", response.usage);
      }

      // If truncated, double the budget and retry — or give up
      if (stopReason === "max_tokens") {
        if (attempt < MAX_RETRIES) {
          const newBudget = Math.min(budget * 2, MODEL_OUTPUT_CAP);
          if (newBudget > budget) {
            console.warn(`[LLM] output truncated at ${budget} tokens — retrying with ${newBudget}`);
            budget = newBudget;
            continue;
          }
        }
        console.error("[LLM] output truncated — cannot recover");
        return null;
      }

      for (const block of content) {
        if (block.type === "tool_use") {
          return validateActionPlan(block.input);
        }
      }
      return null; // no tool_use block
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[LLM error]", msg);
      throw err; // propagate API errors — caller decides how to handle
    }
  }
  return null;
}

export async function callLlm(
  context: Record<string, unknown>,
  intentType: IntentType,
  options?: {
    modelOverride?: string;
    systemPromptOverride?: string;
    tokenBudgetOverride?: number;
    toolChoiceAuto?: boolean;
  }
): Promise<ActionPlan | null> {
  if (!client && !isCapacitor()) {
    console.error("[LLM] Client not initialized — call initLlmClient first");
    return null;
  }

  if (isCapacitor() && !_apiKey) {
    console.error("[LLM] API key not set — call initLlmClient first");
    return null;
  }

  if (isCircuitOpen()) {
    const status = getCircuitBreakerStatus();
    console.warn(`[LLM] Circuit breaker is OPEN — skipping call. ${status.failures} consecutive failures. Resets in ${status.cooldownMinutes}m. Last error: ${status.lastError}`);
    return null;
  }

  const { modelOverride, systemPromptOverride, tokenBudgetOverride, toolChoiceAuto } = options || {};
  const model = modelOverride || MODEL_BY_INTENT[intentType] || DEFAULT_MODEL;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: JSON.stringify(context, null, 2) },
  ];
  const tokenBudget = tokenBudgetOverride || estimateMaxTokens(intentType, context);

  try {
    const plan = await sendLlmRequest(model, messages, tokenBudget, intentType, systemPromptOverride, toolChoiceAuto);

    if (plan) {
      recordSuccess();
      return plan;
    }

    // Validation failed or no tool_use block — try Sonnet fallback only for
    // complex intents where the smarter model genuinely helps (FEAT045 WP-6).
    if (model === HAIKU && SONNET_FALLBACK_INTENTS.has(intentType)) {
      console.warn(`[LLM] Haiku output failed validation for ${intentType} — retrying with Sonnet`);
      try {
        const fallbackPlan = await sendLlmRequest(SONNET, messages, tokenBudget, intentType, systemPromptOverride, toolChoiceAuto);
        if (fallbackPlan) {
          recordSuccess();
          return fallbackPlan;
        }
      } catch (fallbackErr: any) {
        const msg = fallbackErr?.message || String(fallbackErr);
        console.error("[LLM] Sonnet fallback also failed:", msg);
        recordFailure(`sonnet fallback: ${msg}`);
        return null;
      }
    } else if (model === HAIKU) {
      console.warn(`[LLM] Haiku output failed validation for ${intentType} — no Sonnet fallback for simple intents`);
    }

    // Failed validation — record and return null
    recordFailure(`${model === HAIKU && SONNET_FALLBACK_INTENTS.has(intentType) ? "haiku+sonnet" : model === HAIKU ? "haiku" : "sonnet"} validation failed for ${intentType}`);
    return null;
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[LLM error]", msg);
    recordFailure(msg);
    return null;
  }
}
