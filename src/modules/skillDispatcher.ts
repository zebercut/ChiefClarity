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
import { fnv1a64Hex } from "../utils/fnv1a";
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
import type { RetrievalHook, RetrievalResult } from "../types/rag";

const DEFAULT_RETRIEVAL_TIMEOUT_MS = 800;
let _retrievalTimeoutWarnEmitted = false;

/** Test-only: clear the retrieval-timeout warn-once cache. */
export function _resetRetrievalWarnsForTests(): void {
  _retrievalTimeoutWarnEmitted = false;
}

/**
 * FEAT068 — Validate the manifest's retrievalHook field. Bad shapes
 * are NOT fatal: WARN once per skill id and treat as absent so the
 * dispatcher proceeds without retrieval.
 */
const _retrievalHookWarnedSkills = new Set<string>();
function validateRetrievalHook(skill: LoadedSkill): RetrievalHook | null {
  const raw = (skill.manifest as { retrievalHook?: unknown }).retrievalHook;
  if (raw === undefined || raw === null) return null;
  const rh = raw as Partial<RetrievalHook>;
  const ok =
    rh &&
    typeof rh === "object" &&
    Array.isArray(rh.sources) &&
    rh.sources.every((s) => typeof s === "string") &&
    typeof rh.k === "number" &&
    rh.k > 0 &&
    typeof rh.minScore === "number" &&
    typeof rh.minScoreInclude === "number";
  if (!ok) {
    if (!_retrievalHookWarnedSkills.has(skill.manifest.id)) {
      _retrievalHookWarnedSkills.add(skill.manifest.id);
      console.warn(
        `[skillDispatcher] skill "${skill.manifest.id}" declares an invalid retrievalHook — treating as absent`
      );
    }
    return null;
  }
  return {
    sources: rh.sources!,
    k: rh.k!,
    minScore: rh.minScore!,
    minScoreInclude: rh.minScoreInclude!,
    softTimeoutMs:
      typeof rh.softTimeoutMs === "number" && rh.softTimeoutMs > 0
        ? rh.softTimeoutMs
        : DEFAULT_RETRIEVAL_TIMEOUT_MS,
  };
}

/**
 * FEAT068 — Run pre-LLM retrieval against the configured VectorStore
 * with a soft timeout. On timeout / failure, returns an empty envelope
 * so the dispatcher continues — the prompt's "no info" branch handles
 * the empty case.
 */
async function runRetrieval(
  phrase: string,
  hook: RetrievalHook
): Promise<{ items: RetrievalResult[]; topScore: number; timedOut: boolean }> {
  const timeoutMs = hook.softTimeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
  const work = (async () => {
    const { retrieveTopK } = await import("./rag/retriever");
    const items = await retrieveTopK(phrase, {
      k: hook.k,
      sources: hook.sources,
      minScore: hook.minScore,
    });
    return { items, topScore: items[0]?.score ?? 0, timedOut: false };
  })();
  const timeout = new Promise<{ items: RetrievalResult[]; topScore: number; timedOut: boolean }>(
    (resolve) => {
      setTimeout(
        () => resolve({ items: [], topScore: 0, timedOut: true }),
        timeoutMs
      );
    }
  );
  try {
    const result = await Promise.race([work, timeout]);
    if (result.timedOut && !_retrievalTimeoutWarnEmitted) {
      _retrievalTimeoutWarnEmitted = true;
      console.warn(
        `[skillDispatcher] retrieval soft-timeout (${timeoutMs}ms) — proceeding with empty retrievedKnowledge`
      );
    }
    return result;
  } catch (err: any) {
    console.warn(`[skillDispatcher] retrieval threw: ${err?.message ?? err}`);
    return { items: [], topScore: 0, timedOut: false };
  }
}

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

  // 3b. FEAT068 — Pre-LLM retrieval hook. When the manifest declares
  // `retrievalHook`, embed the phrase, fetch top-K from the configured
  // VectorStore, and inject results under `retrievedKnowledge` so the
  // skill prompt can cite the user's own knowledge. Soft 800ms timeout
  // on the retrieval call: on miss, we proceed with empty results and
  // the prompt's "no info" branch fires. Bad-shape hooks are treated
  // as absent (validateRetrievalHook WARNs and returns null).
  let retrievedItems: RetrievalResult[] = [];
  const retrievalHook = validateRetrievalHook(skill);
  if (retrievalHook) {
    const r = await runRetrieval(phrase, retrievalHook);
    retrievedItems = r.items;
    // FEAT068 — partial flag: when the backfill is still running we decorate
    // retrievalMeta so the prompt / handler can warn the user the answer
    // may be incomplete. Read non-fatally — a missing module / error here
    // must NOT block dispatch.
    let partial = false;
    try {
      const { getRagBackfillStatus } = await import("./rag/backfill");
      partial = getRagBackfillStatus().state === "running";
    } catch {
      // Backfill module unavailable (e.g., bundling edge case) — treat as not partial.
    }
    (context as Record<string, unknown>).retrievedKnowledge = retrievedItems;
    (context as Record<string, unknown>).retrievalMeta = {
      topScore: Number(r.topScore.toFixed(4)),
      count: retrievedItems.length,
      timedOut: r.timedOut,
      partial,
    };
    console.log(
      `[skillDispatcher] retrieved=${retrievedItems.length} topScore=${r.topScore.toFixed(2)} skill=${skill.manifest.id}${partial ? " partial=true" : ""}`
    );
  }

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

// FEAT065 — phrase hashing reuses the FNV-1a helper used by router.ts so
// dispatcher logs correlate with router logs on every platform (no
// browser-unhash fallback). Non-cryptographic, used only as an opaque
// log correlator.
function sha256First16(s: string): string {
  return fnv1a64Hex(s);
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
  // FEAT063 — emotional_checkin
  "recentEmotionalState",
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
    // FEAT063 — emotional_checkin. 7-day window, capped at 5 most-recent
    // entries. Empty-state safe (returns [] when userObservations or its
    // emotionalState sub-array is missing).
    case "recentEmotionalState": {
      const today = (state.hotContext as { today?: string } | undefined)?.today;
      const obs = (state as { userObservations?: { emotionalState?: unknown } })
        .userObservations?.emotionalState;
      if (!Array.isArray(obs) || !today) return [];
      const cutoff = new Date(today + "T00:00:00Z");
      cutoff.setUTCDate(cutoff.getUTCDate() - 6);
      const cutoffISO = cutoff.toISOString().slice(0, 10);
      const filtered = (obs as Array<{ date?: unknown; observation?: unknown }>)
        .filter(
          (e) =>
            typeof e?.date === "string" &&
            (e.date as string) >= cutoffISO &&
            (e.date as string) <= today
        )
        .sort((a, b) => ((a.date as string) < (b.date as string) ? 1 : -1));
      return filtered.slice(0, 5);
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
  return skill.manifest.tools.map((toolName) => {
    const schema = skill.toolSchemas?.[toolName];
    if (schema) return schema;
    // TODO(FEAT-future): downgrade this WARN to a hard error once all skills
    // declare toolSchemas in production for one release cycle. Tracking in
    // v2.03 backlog (per FEAT065 design review §10 / condition 8).
    console.warn(
      `[skillDispatcher] skill "${skill.manifest.id}" missing toolSchemas[${toolName}] — ` +
      `falling back to permissive empty schema. LLM may emit empty args.`
    );
    return {
      name: toolName,
      description: `Tool exported by ${skill.manifest.id} skill.`,
      input_schema: {
        type: "object" as const,
        properties: {},
        additionalProperties: true,
      },
    };
  });
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
