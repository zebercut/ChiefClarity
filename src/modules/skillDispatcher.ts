/**
 * FEAT055 — Skill Dispatcher.
 *
 * Glue between the v4 Orchestrator (FEAT051), the Skill Registry (FEAT054),
 * and the per-skill handlers. Takes a `RouteResult` and runs the routed
 * skill end-to-end:
 *   1. Gate on getV4SkillsEnabled() — return null if not enabled
 *   2. Look up skill in registry — return null if missing (race)
 *   3. Build context per skill.contextRequirements (minimal resolver)
 *   4. Call LLM with skill prompt + tools
 *   5. Dispatch returned tool call to skill.handlers[toolName]
 *   6. Return SkillDispatchResult { skillId, toolCall, handlerResult, userMessage }
 *
 * Never throws on runtime failures. Returns null when v4 can't / shouldn't
 * handle the phrase. Returns degraded result (with `degraded.reason`) when
 * the LLM call fails.
 *
 * Per ADR-001: exactly one LLM reasoning call per phrase. The Haiku
 * tiebreaker in FEAT051 is the only other LLM call allowed in the chain.
 *
 * v2.01 POC scope:
 *   - Minimal context resolver (5 supported keys)
 *   - Console-log persistence only — handler writes ship with FEAT080
 *   - chat.tsx wiring deferred to FEAT080 batch 1; FEAT055 proves the
 *     contract via skillDispatcher.test.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODEL_HEAVY, MODEL_LIGHT, isCircuitOpen, getClient } from "./llm";
import { loadSkillRegistry } from "./skillRegistry";
import { getV4SkillsEnabled } from "./router";
import type {
  RouteResult,
  SkillDispatchResult,
} from "../types/orchestrator";
import type {
  ContextRequirements,
  LoadedSkill,
  SkillRegistryAPI,
  ToolHandler,
} from "../types/skills";

// ─── Public API ────────────────────────────────────────────────────────────

export interface DispatchOptions {
  /** Tests inject a stub LLM client to avoid live API calls. */
  llmClient?: Anthropic;
  /** Tests inject a fixture registry to bypass the global singleton. */
  registry?: SkillRegistryAPI;
  /** Tests pass a fixture state for the context resolver to read from. */
  state?: unknown;
  /**
   * Tests can pre-set the v4-enabled set. If not provided, dispatcher reads
   * the live set via getV4SkillsEnabled().
   */
  enabledSkillIds?: ReadonlySet<string>;
}

/**
 * Execute a routed skill end-to-end. Returns null when the v4 path can't or
 * shouldn't run for this skill — caller falls back to legacy.
 */
export async function dispatchSkill(
  routeResult: RouteResult,
  phrase: string,
  options: DispatchOptions = {}
): Promise<SkillDispatchResult | null> {
  // 1. Gate — only handle skills that are v4-enabled
  const enabled = options.enabledSkillIds ?? getV4SkillsEnabled();
  if (!enabled.has(routeResult.skillId)) {
    return null;
  }

  // 2. Look up skill
  const registry = options.registry ?? (await loadSkillRegistry());
  const skill = registry.getSkill(routeResult.skillId);
  if (!skill) {
    console.warn(
      `[skillDispatcher] route picked "${routeResult.skillId}" but registry has no such skill — caller falls back`
    );
    return null;
  }

  // 3. Build context
  const context = resolveContext(skill.contextRequirements, options.state);

  // 4. LLM call
  const llm = options.llmClient ?? getClient();
  if (!llm) {
    return degradedAndLog(skill, phrase, "no LLM client initialized");
  }
  if (isCircuitOpen()) {
    return degradedAndLog(skill, phrase, "llm circuit breaker open");
  }

  const model = pickModel(skill);

  let llmResponse;
  try {
    llmResponse = await llm.messages.create({
      model,
      max_tokens: skill.manifest.tokenBudget,
      system: skill.prompt,
      messages: [
        {
          role: "user",
          content: buildUserMessage(phrase, context),
        },
      ],
      tools: buildToolSchemas(skill),
      tool_choice: { type: "any" },
    });
  } catch (err: any) {
    return degradedAndLog(skill, phrase, `llm call failed: ${err?.message ?? err}`);
  }

  // 5. Find tool call
  const toolBlock = llmResponse.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return degradedAndLog(skill, phrase, "llm returned no tool call");
  }
  const toolName = toolBlock.name;
  const toolArgs = (toolBlock.input as Record<string, unknown>) ?? {};

  // 6. Dispatch to handler
  const handler: ToolHandler | undefined = skill.handlers[toolName];
  if (!handler) {
    return degradedAndLog(skill, phrase, `llm picked tool "${toolName}" but skill has no matching handler`);
  }

  let handlerResult: any;
  try {
    handlerResult = await handler(toolArgs, { phrase, skillId: skill.manifest.id, state: options.state });
  } catch (err: any) {
    return degradedAndLog(skill, phrase, `handler "${toolName}" threw: ${err?.message ?? err}`);
  }

  const result: SkillDispatchResult = {
    skillId: skill.manifest.id,
    toolCall: { name: toolName, args: toolArgs },
    handlerResult,
    userMessage: typeof handlerResult?.userMessage === "string"
      ? handlerResult.userMessage
      : "(no message)",
    clarificationRequired: Boolean(handlerResult?.clarificationRequired),
    // FEAT057: pass through structured items from handler (task_query results,
    // future topic digests, etc.). Chat surface renders via ItemListCard.
    items: Array.isArray(handlerResult?.items) ? handlerResult.items : undefined,
  };
  logDispatchDecision(phrase, result);
  return result;
}

/**
 * Structured log per dispatch outcome (per AGENTS.md rule CR-FEAT051).
 * Phrase hashed (sha256, first 16 hex chars). Same format the router uses
 * so log entries can be correlated. Cross-references the audit_log
 * convention that ships with FEAT056 in Phase 3.
 */
function logDispatchDecision(phrase: string, result: SkillDispatchResult): void {
  const phraseHash = sha256First16(phrase);
  console.log(
    `[skillDispatcher] dispatch phrase=${phraseHash} skill=${result.skillId} ` +
    `tool=${result.toolCall.name}` +
    (result.clarificationRequired ? " clarification=yes" : "") +
    (result.degraded ? ` degraded="${result.degraded.reason}"` : "")
  );
}

function sha256First16(s: string): string {
  // Same pattern as router.ts — graceful fallback when running in browser
  // bundle where Node crypto isn't available. See router.ts for rationale.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = (eval("require") as NodeRequire)("crypto") as typeof import("crypto");
    if (typeof crypto?.createHash === "function") {
      return crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
    }
  } catch {
    // fall through
  }
  return "browser-unhash";
}

// ─── Context resolver (minimal v2.01 version) ──────────────────────────────
//
// Maps a skill.contextRequirements declaration to actual context data. The
// full Assembler with policy filter ships in Phase 3 (FEAT055/Schema Registry).
// Until then, this resolver supports a small fixed set of keys; unknown keys
// are skipped with a warning.

const SUPPORTED_KEYS = new Set([
  "userProfile",
  "objectives",
  "recentTasks",
  "calendarToday",          // FEAT055 declared, FEAT059 actually computes
  "calendarNextSevenDays",  // FEAT055 declared, FEAT059 actually computes
  // FEAT057 — task_management context keys (also reusable by FEAT058+)
  "tasksIndex",
  "contradictionIndexDates",
  "topicList",
  "existingTopicHints",
  "userToday",
  // FEAT059 — calendar_management
  "calendarEvents",
]);

function resolveContext(
  requirements: ContextRequirements,
  state: unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!state || typeof state !== "object") {
    // No state passed → return empty context. Skill prompt should handle
    // this gracefully (request_clarification).
    return result;
  }
  const s = state as Record<string, unknown>;

  for (const [key, declared] of Object.entries(requirements)) {
    if (!SUPPORTED_KEYS.has(key)) {
      console.warn(
        `[skillDispatcher] context requirement "${key}" not supported by minimal resolver — ` +
        `skipping. Full Assembler ships in Phase 3.`
      );
      continue;
    }
    if (declared === false || declared == null) continue;

    // FEAT057 — compute keys that need helper functions; pure flat lookup
    // for the rest. Each branch is defensive: if the helper or state is
    // missing the expected sub-shape, return undefined and let the prompt
    // handle missing context.
    try {
      const value = computeContextValue(key, s);
      if (value !== undefined) result[key] = value;
    } catch (err: any) {
      console.warn(`[skillDispatcher] resolver failed for "${key}": ${err?.message ?? err}`);
    }
  }
  return result;
}

/**
 * Per-key computation for the v2.01/v2.02 minimal resolver. The full
 * Assembler in Phase 3 replaces this with a policy-aware version.
 */
function computeContextValue(key: string, state: Record<string, unknown>): unknown {
  switch (key) {
    case "tasksIndex": {
      // Lazy import to keep dispatcher → assembler edge minimal.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { buildTaskIndex } = require("./assembler") as typeof import("./assembler");
      return buildTaskIndex(state as any);
    }
    case "contradictionIndexDates": {
      const ci = state.contradictionIndex as { byDate?: unknown } | undefined;
      return ci?.byDate;
    }
    case "topicList": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { buildTopicList } = require("./topicManager") as typeof import("./topicManager");
      const tm = state.topicManifest as Parameters<typeof buildTopicList>[0] | undefined;
      return tm ? buildTopicList(tm) : undefined;
    }
    case "existingTopicHints": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getExistingHints } = require("./topicManager") as typeof import("./topicManager");
      const tm = state.topicManifest as Parameters<typeof getExistingHints>[0] | undefined;
      const cm = state.contextMemory as { facts?: Parameters<typeof getExistingHints>[1] } | undefined;
      return tm ? getExistingHints(tm, cm?.facts ?? []) : undefined;
    }
    case "userToday": {
      const hc = state.hotContext as { today?: string } | undefined;
      return hc?.today;
    }
    // FEAT059 — calendar branches. Use exported getActiveEvents for
    // consistent filter semantics (skip cancelled/archived/undated/past).
    case "calendarEvents": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
      return getActiveEvents(state as any);
    }
    case "calendarToday": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
      const today = (state.hotContext as { today?: string } | undefined)?.today;
      if (!today) return [];
      return getActiveEvents(state as any).filter((e: any) =>
        typeof e.datetime === "string" && e.datetime.slice(0, 10) === today
      );
    }
    case "calendarNextSevenDays": {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
      const today = (state.hotContext as { today?: string } | undefined)?.today;
      if (!today) return [];
      // ISO date arithmetic: today through today+6 inclusive (7-day window).
      const startD = new Date(today + "T00:00:00Z");
      const endD = new Date(startD);
      endD.setUTCDate(endD.getUTCDate() + 6);
      const endISO = endD.toISOString().slice(0, 10);
      return getActiveEvents(state as any).filter((e: any) => {
        const d = typeof e.datetime === "string" ? e.datetime.slice(0, 10) : "";
        return d >= today && d <= endISO;
      });
    }
    // Flat lookup for the rest
    default:
      return key in state ? state[key] : undefined;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function pickModel(skill: LoadedSkill): string {
  const m = skill.manifest.model;
  if (typeof m === "string") {
    return m === "sonnet" ? MODEL_HEAVY : MODEL_LIGHT;
  }
  // Object form — for v2.01 we always pick `default`. The `deep` variant
  // selection via tool-arg is FEAT072 (Companion) territory.
  return m.default === "sonnet" ? MODEL_HEAVY : MODEL_LIGHT;
}

function buildUserMessage(phrase: string, context: Record<string, unknown>): string {
  const ctxStr = Object.keys(context).length
    ? `\n\nContext:\n${JSON.stringify(context, null, 2)}`
    : "";
  return `User said: "${phrase}"${ctxStr}`;
}

function buildToolSchemas(skill: LoadedSkill) {
  // Minimal tool schemas — for v2.01 the dispatcher exposes each declared
  // tool with a permissive input_schema (object with no required props).
  // Each skill's prompt names the args it expects; the LLM follows the
  // prompt rather than relying on the schema. The full schema-per-tool
  // model lands when we have a tool registry (FEAT080).
  return skill.manifest.tools.map((toolName) => ({
    name: toolName,
    description: `Tool exported by ${skill.manifest.id} skill.`,
    input_schema: {
      type: "object" as const,
      properties: {},
      additionalProperties: true,
    },
  }));
}

function degradedAndLog(skill: LoadedSkill, phrase: string, reason: string): SkillDispatchResult {
  console.warn(`[skillDispatcher] ${skill.manifest.id} degraded: ${reason}`);
  const result: SkillDispatchResult = {
    skillId: skill.manifest.id,
    toolCall: { name: "<degraded>", args: {} },
    handlerResult: null,
    userMessage:
      "I couldn't complete that with the v4 path right now — falling back. " +
      `(reason: ${reason})`,
    degraded: { reason },
  };
  logDispatchDecision(phrase, result);
  return result;
}
