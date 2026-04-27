# FEAT055 — POC `priority_planning` skill (proves FEAT054 + FEAT051 end-to-end)

> **Note on numbering:** The dev plan (`docs/v4/09_dev_plan.md §3`) referred to
> this work as FEAT079. The feature-kit CLI uses sequential next-free IDs, so
> the actual ID assigned at creation time is **FEAT055**. The dev plan's
> FEAT054–FEAT084 numbering was aspirational. Future references should track
> by title, not number.

**Type:** feature
**Status:** Approved by user 2026-04-27 — stages 3–7 ran. **Stage 2 review notes:** Q4 → stub LLM only (no live-LLM opt-in flag); Q7 → yes, ship a minimal `skillDispatcher.ts` so future migrations reuse it; Story 4 parity threshold 4/5 confirmed; no `general_assistant` during the FEAT055 window confirmed.
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.01 (Phase 1 — POC, the third and final v2.01 deliverable)
**Tags:** skill-migration, poc, priority, end-to-end
**Created:** 2026-04-27

**Depends on:** FEAT054 (Skill folder loader, Done) + FEAT051 (Skill Router, Done)
**Soft dependency:** none — explicitly proves the stack works without other skills

---

## Status

Draft — awaiting human review before architect picks it up for stages 3–4.

---

## Problem Statement

Phase 1 has built two of three pieces of the v4 skill system:

1. **FEAT054** — the skill folder loader + registry (Done)
2. **FEAT051** — the embedding-based orchestrator (Done)
3. **FEAT055 (this)** — the first real skill that exercises both, end-to-end

Without FEAT055, the loader and orchestrator are infrastructure that has never
processed a real user phrase. The dual-path migration window (per
`docs/v4/09_dev_plan.md §5 Phase 1`) only proves itself once at least one
intent has been migrated and is running side-by-side with the legacy code.

The current `priority_ranking` intent in `src/llm.ts` and `src/modules/router.ts`
is the cleanest target for the POC: it has a focused job ("rank tasks by what
matters now"), it already returns structured output (a tool call), it uses
Sonnet (matching the v4 model declaration), and it has no complex side effects
beyond a write to the priority log. It is the lowest-risk, highest-clarity
choice for proving the v4 stack.

This feature delivers:
- A real `priority_planning` skill folder under `src/skills/`
- The wiring in the chat dispatch path that calls `routeToSkill` and dispatches
  to skill handlers when the routed skill is in the v4-enabled list
- The `setV4SkillsEnabled(["priority_planning"])` boot call
- A parity test that proves the new path produces equivalent output to the
  legacy intent for the same phrase

---

## Goals

1. Drop a `src/skills/priority_planning/` folder; the registry loads it on
   next boot. (Proves FEAT054 works end-to-end.)
2. A user phrase like *"what should I focus on today?"* routes through the v4
   orchestrator to the `priority_planning` skill. (Proves FEAT051 works
   end-to-end.)
3. The skill's prompt + handler produces equivalent output to today's
   `priority_ranking` intent for the same phrase, on a small parity test set.
4. Disabling v4 (empty `setV4SkillsEnabled([])`) makes the same phrase route
   through the legacy `priority_ranking` intent — both paths coexist.
5. No other intent's behavior changes. The remaining v3 intents continue to
   work via legacy `classifyIntent`.

---

## Success Metrics

- The skill folder validates and loads at boot (`Loaded skill: priority_planning` in the log).
- A test phrase routed via `routeToSkill` returns `skillId: "priority_planning"`.
- Parity test: 5 hand-curated phrases produce the same top-3 ranked task ids on both paths (legacy and v4) ≥ 4/5 times.
- Setting `setV4SkillsEnabled([])` reverts to the legacy path with identical output (regression check).
- No regression in any existing test suite (currently 248 tests).

---

## User Stories

### Story 1 — Real skill folder loads and routes

**As a** developer, **I want** a real skill (not a fixture) to load from
`src/skills/priority_planning/` and be routable via `routeToSkill`, **so that**
I can prove the FEAT054 + FEAT051 stack works on real content.

**Acceptance Criteria:**
- [ ] Given the folder `src/skills/priority_planning/` exists with a valid
      `manifest.json`, `prompt.md`, `context.ts`, and `handlers.ts`, when the
      app boots, then the registry log line `Loaded skill: priority_planning`
      appears.
- [ ] Given the registry has loaded `priority_planning`, when a phrase like
      *"what should I focus on today?"* is sent through `routeToSkill`, then
      the orchestrator returns `skillId: "priority_planning"` (exact
      `routingMethod` may be `embedding` or `haiku` depending on the
      manifest's `triggerPhrases` quality — both are acceptable).
- [ ] The skill's `manifest.json` declares `model: "sonnet"`, `tokenBudget`
      in the 4000–6000 range, `dataSchemas.read` covering at least
      `["tasks", "calendar", "objectives"]`, and 5–10 natural-language
      `triggerPhrases`.

### Story 2 — End-to-end execution path

**As a** user, **I want** my "what should I focus on" phrase to go through
the v4 path: orchestrator → skill prompt → LLM → skill handler → response,
**so that** the v4 architecture has actually run a real reasoning call once.

**Acceptance Criteria:**
- [ ] Given `setV4SkillsEnabled(["priority_planning"])` is in effect at boot
      AND the user sends a phrase that routes to `priority_planning`, then
      the dispatch path calls the skill's prompt + the skill's tool, not the
      legacy `priority_ranking` branch in `llm.ts`.
- [ ] The skill produces a structured tool call (exact tool name TBD by
      architect — likely `submit_priority_ranking`) that the executor
      consumes.
- [ ] The user sees a chat reply with the ranking. The reply renders
      identically in the chat UI to today's behavior — this is a
      behind-the-scenes migration, not a UX change.

### Story 3 — Dual-path coexistence (rollback safety)

**As a** developer, **I want** to flip the v4 path off and revert to the
legacy `priority_ranking` intent without code changes, **so that** if the v4
path produces a bad ranking I can disable it instantly.

**Acceptance Criteria:**
- [ ] Given `setV4SkillsEnabled([])` (empty) is the boot configuration, when
      a "what should I focus on" phrase arrives, then it routes through the
      legacy `classifyIntent` → `priority_ranking` intent path. The v4
      `routeToSkill` is never called for this phrase.
- [ ] Given `setV4SkillsEnabled(["priority_planning"])` is the boot
      configuration, when a "what should I focus on" phrase arrives, then it
      routes through `routeToSkill` and dispatches via the skill handler.
- [ ] Given `setV4SkillsEnabled(["priority_planning"])`, when a phrase that
      DOES NOT match `priority_planning` arrives (e.g., "add a task"), then
      it falls through to the legacy `classifyIntent` path. (V4 is opt-in
      per skill; non-enabled skills use legacy.)

### Story 4 — Parity check on a small phrase set

**As a** developer, **I want** assurance that the v4 path produces output
equivalent to the legacy path for a curated set of phrases, **so that**
migrating the next batch of skills (FEAT080) is justified.

**Acceptance Criteria:**
- [ ] A test fixture set of 5 phrases — chosen to exercise the
      priority_ranking logic — exists in the test file as a top-of-file
      constant.
- [ ] For each phrase, both paths run against the same fixture state. The
      top-3 ranked task ids must match on at least 4 of 5 phrases.
- [ ] Where output differs, the difference is documented (and a judgment
      call on whether it's acceptable migration drift or a bug to fix).

### Story 5 — No regression in other intents

**As a** developer, **I want** to know that wiring the v4 dispatch path does
not break any of the other v3 intents, **so that** I can ship FEAT055 without
fear.

**Acceptance Criteria:**
- [ ] All 248 existing tests still pass after FEAT055 lands.
- [ ] Manual smoke check (or scripted check) that 3 non-priority intents
      (`task_create`, `calendar_query`, `emotional_checkin`) still route via
      their legacy paths and produce expected output.

---

## Out of Scope

- **Migrating any other intent** — that's the next FEATs (skill batches 1
  and 2 per dev plan §3).
- **Building `general_assistant`** — also part of the skill batches. During
  FEAT055 the fallback path (when v4 routing finds no good match) warns and
  degrades, per FEAT051 design review §5. Acceptable for a ~2-week window.
- **Surface declaration** — `priority_planning` does not need a UI tab; its
  output renders in chat.
- **Locked prompt zones** — `priority_planning` is not safety-bearing.
- **Pattern Learner integration** — per-skill model tuning ships in Phase 7.
- **Privacy filter** — no enforcement until Phase 3 (Schema Registry); for
  this POC the manifest's `dataSchemas` is declarative-only.

---

## Assumptions & Open Questions

**Assumptions:**
- The existing `priority_ranking` intent in `src/llm.ts` is well-defined
  enough to mirror in a skill (architect to verify in stage 3).
- The chat dispatch path (likely in `app/(tabs)/chat.tsx`) is the single
  consumer that needs wiring. Headless runner does not need v4 routing for
  v2.01 — it runs background jobs, not user phrases.
- The skill's prompt can be a near-direct port of today's priority_ranking
  prompt fragment from `src/llm.ts` or `src/constants/prompts.ts`.
- Today's priority_ranking writes to a `priority_log`; the skill handler
  does the same write through `filesystem.ts`.

**Open Questions for the Architect:**
1. Where exactly does today's `priority_ranking` dispatch happen — `chat.tsx`,
   `llm.ts`, or `executor.ts`? The wiring point determines what changes.
2. What are the existing prompt + tool schema for `priority_ranking`?
   Architect audit needed.
3. Where do `setV4SkillsEnabled([...])` calls go in app boot —
   `app/_layout.tsx`, a new `bootstrap.ts`, or another existing init point?
4. Should the parity test (Story 4) run against a stub LLM with hand-crafted
   responses, or hit live Sonnet (slow, costs money, flaky)? PM proposes
   stub-by-default, with an opt-in `--live` flag for occasional real-LLM
   smoke.
5. The current `priority_ranking` is in `SONNET_FALLBACK_INTENTS` — is the
   skill manifest's `model: "sonnet"` enough, or do we need a fallback chain
   in the skill too?
6. What's the right name for the skill's tool — `submit_priority_ranking`,
   `submit_focus_recommendation`, something else? Should match what the
   executor expects.
7. The new dispatch path (skill route → skill prompt → LLM call → skill
   handler) is conceptually the v4 LLM Dispatcher
   (`docs/v4/01_request_flow.md §3`). Is FEAT055 also delivering a minimal
   Dispatcher, or is the wiring in chat.tsx the dispatcher for now? Architect
   call. PM proposes minimal Dispatcher in `src/modules/skillDispatcher.ts`
   so future skill migrations reuse it.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27 (workflow stage 3). Full design review
in `FEAT055_design-review.md` (workflow stage 4).*

### Two findings that shape this implementation

1. **There is no `priority_ranking` intent in the current codebase.** The
   `09_dev_plan.md §1.1` inventory was wrong. The closest existing behavior
   is `full_planning` (which builds a Focus Brief that includes ranked
   tasks). For v2.01 there is no legacy intent to mirror — so the spec's
   Story 4 "parity test" pivots to **fixture-based correctness** (the skill
   produces sensible output on a curated set of fixture states, judged
   against expected outputs). No legacy comparison.
2. **`chat.tsx` wiring is deferred to the next FEAT (skill batch 1).** The
   chat dispatch path at `app/(tabs)/chat.tsx:424` is complex (pending
   contexts, triage fast paths, multi-turn). Wiring it for a single skill
   is high-risk for low marginal proof — the FEAT054/051 stack is already
   exercised by tests. Bundling the chat wiring with batch 1 (where 5+
   skills get wired at once) is safer. **End-to-end proof for FEAT055 lives
   in `skillDispatcher.test.ts`,** not in the running chat surface.

These two findings reshape Stories 2, 3, 4 — see "Revised AC mapping" below.

### Data Models

```ts
// src/types/orchestrator.ts (extension — adds the dispatcher result)

export interface SkillDispatchResult {
  /** The skill that handled the phrase. */
  skillId: string;
  /** Tool call the LLM produced. */
  toolCall: { name: string; args: Record<string, unknown> };
  /** Handler return value (typed loosely; each skill defines its own). */
  handlerResult: unknown;
  /** User-facing message to surface in chat. */
  userMessage: string;
}
```

### API Contracts

```ts
// src/modules/skillDispatcher.ts (NEW)

export interface DispatchOptions {
  /** Override the LLM client. Tests use this to inject a stub. */
  llmClient?: import("@anthropic-ai/sdk").default;
  /** Override the registry. Tests use this to inject a fixture registry. */
  registry?: import("../types/skills").SkillRegistryAPI;
  /** Override the state passed to context resolvers. Tests inject fixtures. */
  state?: unknown;
}

/**
 * Execute a routed skill end-to-end:
 *   1. Look up the skill in the registry
 *   2. Resolve its context.ts requirements against the current state
 *   3. Call the LLM with the skill's prompt + tools
 *   4. Dispatch the returned tool call to the skill's handler
 *   5. Return a structured result with the user-facing message
 *
 * Returns null when the routed skill is not in the v4-enabled list (caller
 * must fall back to legacy). Throws only on programmer errors (e.g. tool
 * call doesn't match any handler) — runtime failures (LLM call fails)
 * resolve to a degraded result with an error message.
 */
export async function dispatchSkill(
  routeResult: import("../types/orchestrator").RouteResult,
  phrase: string,
  options?: DispatchOptions
): Promise<SkillDispatchResult | null>;
```

### `priority_planning` skill folder spec

```
src/skills/priority_planning/
├── manifest.json
├── prompt.md
├── context.ts
└── handlers.ts
```

**`manifest.json`:**

```jsonc
{
  "id": "priority_planning",
  "version": "1.0.0",
  "description": "Help the user decide what to focus on right now. Reads tasks, calendar, and stated objectives, then returns a short ranked list with one-line reasons.",
  "triggerPhrases": [
    "what should I focus on",
    "what's most important right now",
    "help me prioritize",
    "which task matters most",
    "what should I do today",
    "I have too much on my plate",
    "where should I start",
    "rank my tasks"
  ],
  "structuralTriggers": ["/focus", "/prioritize"],
  "model": "sonnet",
  "dataSchemas": {
    "read": ["tasks", "calendar", "objectives"],
    "write": ["priority_log"]
  },
  "supportsAttachments": false,
  "tools": ["submit_priority_ranking", "request_clarification"],
  "autoEvaluate": true,
  "tokenBudget": 5000,
  "promptLockedZones": [],
  "surface": null
}
```

**`prompt.md`:** ~250 words, adapted from existing planning prompt fragments
in `src/constants/prompts.ts`. Job: anchor recommendations to objectives;
family/health > work unless explicitly overridden; surface trade-offs; output
ranked list with one-line reasons; call `request_clarification` if data is
insufficient. Strict instruction to use the `submit_priority_ranking` tool.

**`context.ts`:**

```ts
import type { ContextRequirements } from "../../types/skills";

export const contextRequirements: ContextRequirements = {
  userProfile: true,
  objectives: true,
  recentTasks: { limit: 20, includeCompleted: false },
  calendarToday: true,
  calendarNextSevenDays: true,
};
```

**`handlers.ts`:**

```ts
import type { ToolHandler } from "../../types/skills";

export const submit_priority_ranking: ToolHandler = async (args, ctx) => {
  // args: { ranked: Array<{ taskId, reason }>, topPick: { taskId, reason },
  //         summary: string }
  // Writes a priority_log entry via filesystem.ts (out of scope for v2.01 POC
  // — for this POC, log to console; persistence ships with FEAT080 batch 1
  // when the executor is also wired).
  return {
    success: true,
    userMessage: buildUserMessage(args),
    data: { ranked: args.ranked, topPick: args.topPick },
  };
};

export const request_clarification: ToolHandler = async (args) => {
  return {
    success: true,
    clarificationRequired: true,
    userMessage: args.question,
  };
};
```

### Boot wiring point

```ts
// app/_layout.tsx — inside the existing useEffect, after loadConfig resolves
// and applyConfig(c) runs:

import { setV4SkillsEnabled } from "../src/modules/router";
// ...
setV4SkillsEnabled(["priority_planning"]);
```

The headless runner doesn't need v4 routing for v2.01 (it runs background
jobs, not user phrases), so it gets no setV4SkillsEnabled call.

### Revised AC mapping (per the two findings above)

| Spec AC | How it's satisfied |
|---|---|
| Story 1 (skill loads + routes) | Skill folder + boot log + routing test |
| Story 2 (end-to-end execution) | `dispatchSkill` test that drives orchestrator → skill prompt → stub LLM → handler → result. **chat.tsx not modified in this FEAT.** |
| Story 3 (dual-path coexistence) | Tests assert: `dispatchSkill` returns null when skill not in v4-enabled list (caller falls back); returns full result when skill is enabled |
| Story 4 (parity check) | **Pivoted to fixture correctness** — 5 fixture states + 5 expected ranking outputs (top-3 task ids). Stub LLM returns canned tool calls; tests assert handler builds the right user message |
| Story 5 (no regression) | Full `npm test` runs; 248-test baseline must hold |

### Service Dependencies

| Internal | Used for |
|---|---|
| `src/modules/skillRegistry.ts` (FEAT054) | `getSkill` to fetch the LoadedSkill |
| `src/modules/router.ts` (FEAT051) | `routeToSkill` (called by the consumer, not by dispatcher itself), `getV4SkillsEnabled` (dispatcher checks this) |
| `src/modules/llm.ts` (existing) | Sonnet client; `MODEL_HEAVY` constant |
| `src/types/skills.ts` (FEAT054) | `LoadedSkill`, `SkillRegistryAPI`, `ContextRequirements`, `ToolHandler` |
| `src/types/orchestrator.ts` (FEAT051) | `RouteResult` |

No third-party deps added. No new npm packages.

### Design Patterns

- **Dispatcher as a thin coordinator:** the dispatcher's job is glue between
  the registry, the LLM, and the handler. No business logic. Per ADR-001 it
  is a single LLM call per phrase.
- **Context resolver is minimal in v2.01.** The `context.ts` declarations
  map to a small set of supported keys (`userProfile`, `objectives`,
  `recentTasks`, `calendarToday`, `calendarNextSevenDays`). Unknown keys log
  a warning and are skipped. The full Assembler spec (FEAT055/data-schema-
  registry) lands in Phase 3.
- **Stub-LLM-by-default for tests** per Q4. The dispatcher takes
  `options.llmClient` so tests inject a stub that returns canned tool calls.
- **Per-skill v4-enable gate:** `dispatchSkill` returns `null` when the
  routed skill is not in `getV4SkillsEnabled()`. Caller falls back to legacy.
  Cleaner than a separate "should I dispatch?" function.

### New vs. Reusable Components

**New:**
- `src/skills/priority_planning/manifest.json`
- `src/skills/priority_planning/prompt.md`
- `src/skills/priority_planning/context.ts`
- `src/skills/priority_planning/handlers.ts`
- `src/modules/skillDispatcher.ts` — the new module
- Boot wiring in `app/_layout.tsx` (one-line addition)
- `src/modules/skillDispatcher.test.ts`

**Reusable:**
- `src/modules/skillRegistry.ts`, `src/modules/router.ts`, `src/modules/llm.ts`
  all unchanged.

### Risks & Concerns

- **No `general_assistant` during the FEAT055 window.** When `routeToSkill`
  finds no match above the fallback threshold, it warns and degrades. For
  this POC's narrow trigger phrases, this only fires if a tester runs a
  totally unrelated phrase. Acceptable per design.
- **Context resolver is minimal.** If `priority_planning`'s `context.ts`
  declares anything beyond the supported keys, the dispatcher silently skips
  it. Mitigation: the keys above match what `priority_planning` actually
  needs.
- **Handler writes to `priority_log` deferred.** The skill returns the
  ranking but does not persist it for v2.01 — the executor wiring ships
  with FEAT080 batch 1 alongside chat.tsx wiring. Verified: nothing in
  v2.01 reads from priority_log, so no consumer is broken.
- **Stub LLM tests prove the wiring, not the prompt quality.** Real prompt
  quality on real phrases isn't verified until chat.tsx is wired and
  someone tries it. This is acceptable as a v2.01 POC milestone.
- **`MODEL_HEAVY` constant** — verify the Sonnet model id matches what FEAT051
  uses for its tiebreaker (they should differ — Haiku for tiebreaker, Sonnet
  for skill reasoning).

### UX Review Notes

UX scope is zero. No code in `app/` changes (boot wiring is in `_layout.tsx`,
not visible). The skill badge from FEAT051 won't appear because chat.tsx
isn't wired to render it yet — that's the FEAT080 batch concern.

### Testing Notes

#### Unit Tests Required
- Dispatcher: returns null when routed skill not in v4-enabled set
- Dispatcher: returns null when routed skill not found in registry (race condition)
- Dispatcher: builds context per `context.ts` declarations (minimal resolver)
- Dispatcher: passes skill prompt + tools to LLM stub
- Dispatcher: dispatches returned tool call to matching handler
- Dispatcher: handles unknown tool name (LLM hallucination) → degraded result
- Dispatcher: handles LLM throw (network down) → degraded result with error message

#### Component Tests Required
- `priority_planning` manifest validates against the FEAT054 loader (smoke check at boot)
- `priority_planning` handlers' `submit_priority_ranking` produces the expected user message structure given canned LLM output
- `priority_planning` handlers' `request_clarification` produces the expected clarification response

#### Integration Tests Required
- End-to-end through `routeToSkill` → `dispatchSkill`: phrase → skill route → context build → stub LLM tool call → handler → user message
- 5-fixture correctness check (Story 4 revised): given 5 fixture states + 5 canned LLM tool calls, dispatcher produces 5 expected user messages with correct top-3 task ids

#### Regression Tests Required
- Full `npm test` passes after FEAT055 lands (248 baseline)

#### Scope Isolation Tests Required
**No** — privacy filter ships in Phase 3.

#### Agent Fixtures Required
**No** — all dispatcher tests use a stub LLM. Real-LLM smoke deferred to chat.tsx wiring (FEAT080 batch 1).

---

## UX Notes

[**To be filled after architect review.** UX scope: zero — the chat reply
should render identically. This is a behind-the-scenes migration. The skill
badge from FEAT051 Story 5 will appear, showing `priority_planning` instead
of `priority_ranking` — that's the only user-visible change.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.** Required:
- Boot test: skill loads, no warnings
- Routing test: trigger phrase routes to `priority_planning`
- End-to-end test with stub LLM: phrase → orchestrator → skill prompt → tool
  call → handler → response
- Parity test: 5 phrases on legacy + v4 paths, top-3 task ids match ≥4/5
- Regression: full `npm test` passes (currently 248 tests)
- Disable test: `setV4SkillsEnabled([])` reverts to legacy completely]
