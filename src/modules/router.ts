import Anthropic from "@anthropic-ai/sdk";
import type { IntentResult, IntentType, AppState } from "../types";
import { MODEL_LIGHT, isCircuitOpen } from "./llm";

let client: Anthropic | null = null;

export function setRouterClient(c: Anthropic): void {
  client = c;
}

export const TOKEN_BUDGETS: Record<IntentType, number> = {
  task_create: 800,
  task_update: 800,
  task_query: 800,
  calendar_create: 800,
  calendar_update: 800,
  calendar_query: 800,
  okr_update: 1200,
  full_planning: 12000,
  info_lookup: 3000,
  learning: 1200,
  emotional_checkin: 800,
  feedback: 600,
  suggestion_request: 1500,
  general: 3000,
  bulk_input: 6000,
  topic_query: 3000,
  topic_note: 800,
};

// More specific patterns first — order matters
const PATTERNS: Array<[IntentType, RegExp[]]> = [
  [
    "task_update",
    [
      /\b(mark|set|change).*(done|complete|finished|priority|status)\b/i,
      /\b(cancel|remove|delete) (task|todo|to-do|reminder)\b/i,
      /\b(done with|finished|completed) .+\b/i,
    ],
  ],
  [
    "calendar_update",
    [
      /\b(cancel|reschedule|move|postpone|push back) .*(meeting|appointment|call|event)\b/i,
      /\b(meeting|appointment|call|event).*(cancel|reschedule|move)\b/i,
    ],
  ],
  [
    "task_create",
    [
      /\b(add|create|remind|remember|don't forget|make a note)\b/i,
      /\b(todo|to-do|task)\b/i,
    ],
  ],
  [
    "calendar_create",
    [
      /\b(schedule|book|set up|put on calendar|block)\b/i,
      /\b(meeting|appointment|call|event)\b.*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|\d+(am|pm))\b/i,
    ],
  ],
  [
    "calendar_query",
    [/\b(what('s| is) (on|happening)|do i have|am i free|my schedule)\b/i],
  ],
  [
    "task_query",
    [
      /\b(what (tasks|do i|should i)|show me|list my|pending|overdue)\b/i,
      /\b(show|list|find|search|get|display) .*(task|tasks|todo|to-do|item|items)\b/i,
      /\b(tasks?|items?) .*(about|related|for|with|called|named)\b/i,
      /\bwhat('s| is| are) .*(task|tasks|todo|item|items)\b/i,
      /\bhow many (tasks|items|todos)\b/i,
      /\b(where did you (log|put|save|create))\b/i,
      /\bshow me everything .*(task|todo|related|about)\b/i,
    ],
  ],
  [
    "full_planning",
    [
      /\bplan (my )?(week|day|month|tomorrow)\b/i,
      /\bweekly (plan|review|summary)\b/i,
      /\bprepare (for )?(today|tomorrow|the week)\b/i,
      /\btomorrow'?s? plan\b/i,
    ],
  ],
  [
    "okr_update",
    [/\bokr\b/i, /\bgoal\b.*\b(update|progress|status)\b/i],
  ],
  [
    "learning",
    [
      /\b(learn|study|review|practice)\b/i,
      /\b(learning item|flashcard)\b/i,
    ],
  ],
  [
    "info_lookup",
    [
      /\b(who is|what is|find|search|look up|where is)\b/i,
      /\b(what do (you|we) know about|any info on|tell me about|details on)\b/i,
      /\b(search for|look for|find me|check for)\b/i,
    ],
  ],
  [
    "emotional_checkin",
    [
      /^(what a day|tough day|great day|exhausted|tired|stressed|happy|good day)[.!]?$/i,
      /\b(feeling|venting|just wanted to say)\b/i,
    ],
  ],
  [
    "feedback",
    [
      /\b(i (prefer|like|want|hate|don't like|dislike))\b/i,
      /\b(stop|don't|never|always) .*(remind|suggest|show|ask)\b/i,
      /\b(change|update) (my )?(preference|setting|format)\b/i,
      /\b(too (long|short|verbose|brief))\b/i,
    ],
  ],
  [
    "topic_query",
    [
      /\b(tell|show|give)\b.*\b(about|on)\b.*\btopic\b/i,
      /\btopic\b.*\b(summary|overview|status)\b/i,
      /\beverything (about|on|regarding)\b/i,
    ],
  ],
  [
    "topic_note",
    [
      /\bnote (for|about|under|in) \b/i,
      /\b(add|save|store)\b.*\b(to|for|under|in) topic\b/i,
      /\bcreate (a )?topic\b/i,
    ],
  ],
  [
    "suggestion_request",
    [
      /\b(suggest|recommend|what should i|any ideas|next steps|what('s| is) next)\b/i,
    ],
  ],
];

export function classifyIntent(
  phrase: string,
  _state: AppState
): IntentResult {
  const lower = phrase.toLowerCase().trim();

  for (const [intentType, patterns] of PATTERNS) {
    if (patterns.some((p) => p.test(lower))) {
      return {
        type: intentType,
        tokenBudget: TOKEN_BUDGETS[intentType],
        phrase,
      };
    }
  }

  // Regex found no match — return general, LLM fallback runs async
  return { type: "general", tokenBudget: TOKEN_BUDGETS.general, phrase };
}

const HAIKU_MODEL = MODEL_LIGHT;
const VALID_INTENTS: IntentType[] = [
  "task_create", "task_update", "task_query",
  "calendar_create", "calendar_update", "calendar_query",
  "okr_update", "full_planning", "info_lookup", "learning",
  "emotional_checkin", "feedback", "suggestion_request", "general", "bulk_input",
  "topic_query", "topic_note",
];

export async function classifyIntentWithFallback(
  phrase: string,
  state: AppState
): Promise<IntentResult> {
  // Try regex first
  const regexResult = classifyIntent(phrase, state);
  if (regexResult.type !== "general") return regexResult;

  // Regex couldn't classify — use Haiku as a cheap fallback
  if (!client || isCircuitOpen()) return regexResult;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      system: "Classify the user's intent into exactly one of these categories. Reply with ONLY the category name, nothing else: task_create, task_update, task_query, calendar_create, calendar_update, calendar_query, okr_update, full_planning, info_lookup, learning, emotional_checkin, feedback, suggestion_request, general, topic_query, topic_note",
      messages: [{ role: "user", content: phrase }],
    });

    const text = (response.content[0] as any)?.text?.trim().toLowerCase() ?? "";
    const matched = VALID_INTENTS.find((i) => text === i);
    if (matched) {
      return {
        type: matched,
        tokenBudget: TOKEN_BUDGETS[matched],
        phrase,
      };
    }
  } catch (err) {
    console.warn("[router] Haiku fallback failed, using general:", err);
  }

  return regexResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// FEAT051 — v4 Skill Orchestrator
//
// Embedding-based routing that consumes the FEAT054 SkillRegistry. Coexists
// with the legacy classifyIntent above during the dual-path migration window.
// Per-skill rollout via setV4SkillsEnabled() — when a skill's id is in the
// enabled list, routeToSkill is invoked; otherwise consumers fall through to
// classifyIntent.
//
// Algorithm spec: docs/v4/01_request_flow.md §1
// Design review: packages/feature-kit/features/v2.01/FEAT051_*/FEAT051_design-review.md
// ─────────────────────────────────────────────────────────────────────────────

import type { RouteInput, RouteResult } from "../types/orchestrator";
import { loadSkillRegistry } from "./skillRegistry";
import { fnv1a64Hex } from "../utils/fnv1a";

/** Confidence above which top-1 wins outright (no tiebreaker). */
export const HIGH_THRESHOLD = 0.80;
/** Required gap between top-1 and top-2 for outright win. */
export const GAP_THRESHOLD = 0.15;
/** Below this, no tiebreaker — fall back to general_assistant directly. */
export const FALLBACK_THRESHOLD = 0.40;
/** Skill id used when no installed skill matches well enough. */
export const FALLBACK_SKILL_ID = "general_assistant";

/**
 * FEAT066 — Static map from triage's `legacyIntent` to a v4 skill id.
 * The router consults this BEFORE the structural matcher when the caller
 * passes `triageLegacyIntent`. Triage is the highest-quality pre-router
 * classification signal (regex fast-path + Haiku tiebreaker), so when it
 * has classified the phrase we route on that classification rather than
 * re-deriving intent from a single-token structural compare or an
 * embedding (which is unavailable on web per FEAT064).
 *
 * Entries with no migrated skill (`okr_update`, `topic_query`, `topic_note`)
 * are intentionally absent — they fall through to the existing ladder so
 * the missing-capability state stays visible.
 *
 * Forward-compat note: `task_query`, `calendar_query`, `info_lookup`,
 * `learning`, `feedback`, `suggestion_request` are kept here even though
 * triage doesn't currently emit them — wiring is ready when triage gains
 * a fast-path for these.
 */
export const TRIAGE_INTENT_TO_SKILL: Partial<Record<IntentType, string>> = {
  task_create: "task_management",
  task_update: "task_management",
  task_query: "task_management",         // forward-compat (triage doesn't emit today)
  calendar_create: "calendar_management",
  calendar_update: "calendar_management",
  calendar_query: "calendar_management", // forward-compat
  emotional_checkin: "emotional_checkin",
  // dead via chat surface today — kept for forward compat; emitted via inbox.ts processBundle, not chat-surface routing. See FEAT066 §4.
  bulk_input: "inbox_triage",
  full_planning: "priority_planning",
  general: "general_assistant",
  info_lookup: "info_lookup",              // FEAT068 — RAG-based info_lookup skill
  learning: "general_assistant",           // forward-compat
  feedback: "general_assistant",           // forward-compat
  suggestion_request: "general_assistant", // forward-compat
  // okr_update / topic_query / topic_note: intentionally absent (no migrated skill)
};

/**
 * FEAT066 — Module-level cache so we only emit a "mapped to unknown skill"
 * warn once per skill id. Reset by `_resetTriageHintWarnCacheForTests()`.
 */
const _triageHintMissingWarnCache = new Set<string>();

/** Test-only: clear the warn-once cache between cases. */
export function _resetTriageHintWarnCacheForTests(): void {
  _triageHintMissingWarnCache.clear();
}

/**
 * Skills enabled for the v4 routing path. Empty means v4 routing is disabled
 * for everyone (consumers should fall through to legacy classifyIntent).
 *
 * TODO(FEAT035): replace this module-level state with settings.get('v4SkillsEnabled')
 * once the settings panel ships. The setter pattern here is the interim
 * mechanism per AGENTS.md: no `process.env` reads outside src/config/settings.ts.
 */
let _v4SkillsEnabled: ReadonlySet<string> = new Set();

export function setV4SkillsEnabled(enabledIds: string[]): void {
  _v4SkillsEnabled = new Set(enabledIds);
}

export function getV4SkillsEnabled(): ReadonlySet<string> {
  return _v4SkillsEnabled;
}

/** Test-only: clear all orchestrator state between cases. */
export function _resetOrchestratorForTests(): void {
  _v4SkillsEnabled = new Set();
}

/**
 * Optional dependency overrides for testing. In production all three resolve
 * to the real singleton/lazy-import — tests inject fakes to isolate.
 */
export interface RouteOptions {
  registry?: SkillRegistry;
  embedder?: (phrase: string) => Promise<Float32Array | null>;
  llmClient?: Anthropic;
}

/**
 * Pick the skill that should handle this phrase.
 *
 * Sequential pipeline (each step short-circuits on hit):
 *   0.  directSkillId set → return directly
 *   1a. triage hint (FEAT066) → mapped+registered+enabled → return
 *   1.  phrase starts with "/" → exact match against structuralTriggers
 *   2.  embed phrase → top-3 skills by cosine similarity
 *   3.  confidence gate (top1 ≥ HIGH ∧ gap ≥ GAP) → return top-1
 *   4.  tiebreaker (Haiku ~80 tokens) → returns one of top-3
 *   5.  fallback → general_assistant (or top-1 with warning if missing)
 *
 * Never throws. Always returns a RouteResult (skillId may be empty only
 * in the pathological "registry empty AND no fallback skill" case, which
 * the dispatcher catches downstream).
 */
export async function routeToSkill(
  input: RouteInput,
  options: RouteOptions = {}
): Promise<RouteResult> {
  const result = await routeToSkillInternal(input, options);
  logRoutingDecision(input.phrase, result);
  return result;
}

async function routeToSkillInternal(
  input: RouteInput,
  options: RouteOptions
): Promise<RouteResult> {
  const registry = options.registry ?? (await loadSkillRegistry());

  // Step 0 — Direct skillId (validate it exists; degrade if not)
  if (input.directSkillId) {
    if (!registry.getSkill(input.directSkillId)) {
      console.warn(
        `[router] directSkillId "${input.directSkillId}" not in registry — ` +
        `falling through to NL routing`
      );
      // Don't return early — continue to embedding path below
    } else {
      return {
        skillId: input.directSkillId,
        confidence: 1.0,
        routingMethod: "direct",
        candidates: [],
      };
    }
  }

  const allSkills = registry.getAllSkills();

  // Step 1a — Triage hint (FEAT066). Use upstream classification when the
  // mapped skill is registered and enabled. Pre-empts both structural and
  // embedding when it fires.
  if (input.triageLegacyIntent) {
    const mappedSkillId = TRIAGE_INTENT_TO_SKILL[input.triageLegacyIntent];
    if (mappedSkillId) {
      const skill = registry.getSkill(mappedSkillId);
      if (!skill) {
        // Mapped to a skill the registry doesn't know about — warn once,
        // then fall through to the existing ladder.
        if (!_triageHintMissingWarnCache.has(mappedSkillId)) {
          _triageHintMissingWarnCache.add(mappedSkillId);
          console.warn(
            `[router] triage_hint map references unknown skill "${mappedSkillId}" ` +
            `for intent "${input.triageLegacyIntent}"; falling through`
          );
        }
      } else if (!getV4SkillsEnabled().has(mappedSkillId)) {
        // Disabled per the rollout knob — silent fall-through.
      } else {
        // Speculative structural match for the disagreement-warn.
        // Pure read; does not mutate the warn-once cache or any state.
        const firstTok = input.phrase.trim().split(/\s+/)[0] ?? "";
        if (firstTok.length > 0) {
          const isSlash = firstTok.startsWith("/");
          const tokenForMatch = isSlash
            ? firstTok
            : firstTok.toLowerCase().replace(/[^a-z0-9_-]+$/u, "");
          const structuralMatches = allSkills.filter((s) =>
            s.manifest.structuralTriggers.includes(tokenForMatch)
          );
          if (
            structuralMatches.length === 1 &&
            structuralMatches[0].manifest.id !== mappedSkillId
          ) {
            console.warn(
              `[router] triage_hint pre-empts structural: ` +
              `triage=${input.triageLegacyIntent}->${mappedSkillId}, ` +
              `structural=${structuralMatches[0].manifest.id}, ` +
              `phrase=${fnv1a64Hex(input.phrase)}`
            );
          }
        }
        return {
          skillId: mappedSkillId,
          confidence: 0.95,
          routingMethod: "triage_hint",
          candidates: [],
        };
      }
    }
  }

  // Step 1 — Structural match.
  // Slash command: exact-string compare on first whitespace-delimited token.
  // Non-slash: compare the lowercased first token against structuralTriggers
  // so soft phrases ("feeling stressed", "focus on what matters") still
  // route correctly when the embedder is unavailable on web.
  {
    const firstToken = input.phrase.trim().split(/\s+/)[0] ?? "";
    if (firstToken.length > 0) {
      const isSlash = firstToken.startsWith("/");
      const tokenForMatch = isSlash ? firstToken : firstToken.toLowerCase().replace(/[^a-z0-9_-]+$/u, "");
      const matches = allSkills.filter((s) =>
        s.manifest.structuralTriggers.includes(tokenForMatch)
      );
      if (matches.length === 1) {
        return {
          skillId: matches[0].manifest.id,
          confidence: 1.0,
          routingMethod: "structural",
          candidates: [],
        };
      }
      // Zero or many matches → fall through to embedding (loader rejects
      // duplicate triggers within a skill, but two skills can claim the
      // same single-token trigger).
    }
  }

  // Step 2 — Embedding similarity
  if (allSkills.length === 0) {
    return makeFallback(registry, [], "registry empty");
  }

  const embedder = options.embedder ?? embedPhrase;
  const phraseEmbedding = await embedder(input.phrase);
  if (!phraseEmbedding) {
    // Embedder unavailable (e.g., Capacitor without FEAT044 mobile support)
    return makeFallback(registry, [], "phrase embedder unavailable");
  }
  const candidates = registry.findSkillsByEmbedding(phraseEmbedding, 3);
  if (candidates.length === 0) {
    return makeFallback(registry, [], "no skills had embeddings");
  }

  // Step 3 — Confidence gate
  const top1 = candidates[0].score;
  const gap = top1 - (candidates[1]?.score ?? 0);

  if (top1 >= HIGH_THRESHOLD && gap >= GAP_THRESHOLD) {
    return {
      skillId: candidates[0].skillId,
      confidence: top1,
      routingMethod: "embedding",
      candidates,
    };
  }

  // Step 4 — Tiebreaker
  if (top1 < FALLBACK_THRESHOLD) {
    return makeFallback(
      registry,
      candidates,
      `no skill exceeded fallback threshold (top-1 = ${top1.toFixed(2)})`
    );
  }

  if (isCircuitOpen()) {
    return {
      skillId: candidates[0].skillId,
      confidence: top1,
      routingMethod: "embedding",
      candidates,
      reason: "haiku circuit open — degraded to top-1",
    };
  }

  const tiebreakerId = await haikuTiebreaker(
    input.phrase,
    candidates,
    registry,
    options.llmClient
  );
  return {
    skillId: tiebreakerId,
    // Confidence reported is top-1's score, not the tiebreaker's output (the
    // tiebreaker has no numeric confidence — it's a categorical pick).
    confidence: top1,
    routingMethod: "haiku",
    candidates,
  };
}

/** Build a fallback RouteResult, preferring general_assistant when present. */
function makeFallback(
  registry: SkillRegistry,
  candidates: Array<{ skillId: string; score: number }>,
  reason: string
): RouteResult {
  if (registry.getSkill(FALLBACK_SKILL_ID)) {
    return {
      skillId: FALLBACK_SKILL_ID,
      confidence: 0,
      routingMethod: "fallback",
      candidates,
      reason,
    };
  }
  // Degraded: general_assistant not yet installed.
  console.warn(
    `[router] fallback skill "${FALLBACK_SKILL_ID}" missing — ` +
    `using top-1 (${candidates[0]?.skillId ?? "<none>"}) instead. Reason: ${reason}`
  );
  return {
    skillId: candidates[0]?.skillId ?? "",
    confidence: candidates[0]?.score ?? 0,
    routingMethod: "embedding",
    candidates,
    reason: `fallback skill missing; using top-1. Original reason: ${reason}`,
  };
}

type SkillRegistry = Awaited<ReturnType<typeof loadSkillRegistry>>;

/**
 * Structured log for every routing decision (FEAT051 Story 5 AC 2).
 * Phrase is hashed (sha256, first 16 hex chars) so logs don't carry user text.
 * The audit_log table (FEAT056, Phase 3) will use the same hash format.
 */
function logRoutingDecision(phrase: string, result: RouteResult): void {
  const phraseHash = sha256First16(phrase);
  console.log(
    `[router] route phrase=${phraseHash} skill=${result.skillId} ` +
    `confidence=${result.confidence.toFixed(2)} method=${result.routingMethod} ` +
    `candidates=[${result.candidates.map((c) => `${c.skillId}:${c.score.toFixed(2)}`).join(",")}]` +
    (result.reason ? ` reason="${result.reason}"` : "")
  );
}

/**
 * Non-cryptographic FNV-1a hash for log correlation. NOT suitable for
 * integrity. For cryptographic SHA-256, use src/utils/sha256.ts.
 *
 * Synchronous and pure JS so logging stays off the async path. The output
 * shape (16 lowercase hex chars) matches the prior SHA-256-first-16 format —
 * audit log consumers treat it as an opaque correlator.
 */
function sha256First16(s: string): string {
  return fnv1a64Hex(s);
}

/**
 * Embed a phrase via the local bge-m3 provider. Lazy-imported so this module
 * stays loadable on platforms where the embedder isn't available.
 */
async function embedPhrase(phrase: string): Promise<Float32Array | null> {
  try {
    const { embed } = await import("./embeddings/provider");
    return await embed(phrase);
  } catch (err: any) {
    console.warn(`[router] phrase embedder unavailable: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Haiku tiebreaker. Per FEAT051 §Q2 ("accuracy first") the prompt includes
 * each candidate skill's full description AND triggerPhrases. Cost ~$0.0001.
 *
 * Returns one of the candidate skillIds. If the model returns an unknown id
 * or the call fails, returns top-1.
 */
async function haikuTiebreaker(
  phrase: string,
  candidates: Array<{ skillId: string; score: number }>,
  registry: SkillRegistry,
  llmClient?: Anthropic
): Promise<string> {
  // Reuses the module-level `client` set by setRouterClient() — the legacy
  // path and the v4 orchestrator share one Anthropic client instance. Tests
  // can pass `llmClient` via RouteOptions to inject a mock without touching
  // the shared client.
  const activeClient = llmClient ?? client;
  if (!activeClient) {
    console.warn("[router] tiebreaker called without LLM client; using top-1");
    return candidates[0].skillId;
  }

  // Build the candidate descriptions block
  const blocks = candidates.map((c) => {
    const skill = registry.getSkill(c.skillId);
    if (!skill) return `- ${c.skillId}: (skill missing from registry)`;
    const triggers = skill.manifest.triggerPhrases.map((t) => `      • "${t}"`).join("\n");
    return (
      `- id: ${c.skillId}\n` +
      `  description: ${skill.manifest.description}\n` +
      `  example phrases:\n${triggers}`
    );
  }).join("\n\n");

  const allowedIds = candidates.map((c) => c.skillId);

  try {
    const response = await activeClient.messages.create({
      model: MODEL_LIGHT,
      max_tokens: 64,
      system:
        "You pick the best skill to handle a user's phrase. Use only the " +
        "candidate list provided. Return the skill id via the pick_skill tool.",
      messages: [
        {
          role: "user",
          content:
            `User phrase:\n"${phrase}"\n\nCandidate skills:\n\n${blocks}\n\n` +
            `Pick the single best fit.`,
        },
      ],
      tools: [
        {
          name: "pick_skill",
          description: "Return the chosen skill id.",
          input_schema: {
            type: "object",
            properties: {
              skillId: { type: "string", enum: allowedIds },
            },
            required: ["skillId"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "pick_skill" },
    });

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "pick_skill") {
        const picked = (block.input as { skillId?: string })?.skillId;
        if (picked && allowedIds.includes(picked)) return picked;
      }
    }
    console.warn("[router] tiebreaker returned unknown skill id; using top-1");
    return candidates[0].skillId;
  } catch (err: any) {
    console.warn(`[router] tiebreaker failed (${err?.message ?? err}); using top-1`);
    return candidates[0].skillId;
  }
}

