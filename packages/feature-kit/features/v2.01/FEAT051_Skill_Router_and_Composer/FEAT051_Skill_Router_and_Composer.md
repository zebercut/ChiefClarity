# FEAT051 — Skill Router (Orchestrator, composer dropped)

**Type:** feature
**Status:** Approved by user 2026-04-27 — stages 3–7 ran. **Stage 2 review notes:** Q1 confirmed (top-1 > 0.80 + gap > 0.15 → route; top-1 < 0.40 → fallback; otherwise → tiebreaker); Q2 "accuracy first" (full descriptions in tiebreaker prompt); Q3 confirmed (structural before embedding); Q4 architect call — keep `src/modules/router.ts`, new exports use v4 vocabulary; Q5 architect call — `setV4SkillsEnabled()` setter on router.ts called from app boot, migrates to `settings.get()` once FEAT035 ships; Q6/Q7 acknowledged.
**MoSCoW:** MUST
**Category:** LLM Pipeline
**Priority:** 1
**Release:** v2.01 (Phase 1)
**Tags:** router, orchestrator, embedding, skill-routing
**Created:** 2026-04-23 — rewritten 2026-04-27

**Depends on:** FEAT054 (Skill folder loader). Cannot ship before FEAT054 — it consumes the FEAT054 `SkillRegistryAPI`.
**Soft dependency:** an installed `general_assistant` skill (delivered by FEAT080 skill migration). Without it, the fallback path warns and degrades.
**Supersedes / rescopes:** FEAT050 subsumed into FEAT054; on-the-fly skill composition rejected per architect verdict (preserved below for context).

---

> **Architect verdict (2026-04-26 portfolio review — `docs/v4/11_v2_design_review.md §1`):**
> The "compose a new skill on the fly" feature is **REJECTED**. It would require a
> second LLM reasoning call within one phrase, violating ADR-001
> (`docs/v4/07_operations.md`). Confirmed by user 2026-04-26.
>
> **Replacement:** when no skill matches above the confidence threshold, route to a
> `general_assistant` skill that handles freeform. If the user wants the new
> capability permanent, they author it explicitly via FEAT053 (Phase 9) — never
> silently composed.
>
> The PM rewrite below honors this verdict: composer-related stories and ACs
> have been removed. Only routing logic remains.

---

## Problem Statement

FEAT054 makes skills first-class folders. Something has to **pick** which skill
handles a user phrase. Today, `src/modules/router.ts` uses a regex pattern table
per intent type (`task_create`, `calendar_query`, `full_planning`, etc.). This
is fragile (regex on free-form natural language misroutes ambiguous phrases),
doesn't generalize (every new domain requires a new regex), and is closed at
the edge (a developer must edit shared code for every new capability).

The legacy router also carries a global rule — *"if data > 30 items and the
request is analysis, ask the user for scope"* — that fires across all intents.
This belongs to specific bulk-operation skills, not the router. Moving it
requires the router to be skill-aware.

Three concrete failure modes today:
1. Strategic/advisory phrases ("where should I spend my time?") get misrouted
   to CRUD intents because both mention "tasks".
2. Truly novel phrases fall through to a vague "general" intent that does
   nothing useful with them.
3. The scope-clarification rule fires on advisory questions where it makes no
   sense, forcing the user to narrow scope they didn't want narrowed.

This feature replaces the regex router with an embedding-based skill
**Orchestrator**: it scores the phrase against installed skills, gates on
confidence, optionally calls a cheap Haiku tiebreaker for ambiguous cases, and
falls back to a `general_assistant` skill when nothing matches well. All
clarification logic moves into skills themselves.

---

## Goals

1. Replace the regex `PATTERNS` table and `classifyIntent`/`classifyIntentWithFallback`
   with an embedding-based router that consumes the FEAT054 registry.
2. Honor ADR-001: at most one optional cheap classifier call (Haiku ~80 tokens)
   for ambiguous phrases. Never a second reasoning call within one user phrase.
3. Adding a new skill (dropping a folder under `src/skills/`) makes it
   routable on the next boot with zero router code change.
4. Move all scope-clarification logic out of the router. Skills handle their
   own clarification.
5. Latency stays comparable to today for clear matches; only ambiguous phrases
   incur the Haiku tiebreaker cost.

---

## Success Metrics

- 50-phrase regression set (CRUD, planning, emotional, topic queries, advisory)
  routes correctly **≥ 95 % top-1**.
- 20-phrase ambiguous set (intentionally engineered to land in the Haiku
  tiebreaker) classified correctly **≥ 90 %**.
- p95 routing latency:
  - Clear match (no tiebreaker): **< 50 ms** (TS only, no LLM)
  - Ambiguous (with tiebreaker): **< 300 ms** end-to-end
- Legacy `PATTERNS` regex array and `classifyIntent` / `classifyIntentWithFallback`
  functions deleted from `router.ts`. New router file under 200 lines.
- Zero regressions on the legacy 50-phrase corpus (existing CRUD, planning,
  emotional, topic queries continue to route to their previous intent's
  successor skill).

---

## User Stories

### Story 1 — Embedding-based skill match

**As a** user, **I want** my request answered by the skill with the right
expertise, **so that** advisory questions get judgment and CRUD questions get
actions.

**Acceptance Criteria:**
- [ ] Given the registry contains a skill whose `triggerPhrases` include
      *"what should I focus on"*, when the user sends *"what should I focus on
      today?"*, the orchestrator returns that skill's id (verifiable via
      routing log entry).
- [ ] Given two skills with overlapping descriptions, when the user's phrase
      strongly matches one (top-1 score above the high-confidence threshold
      AND gap to top-2 above the gap threshold), then no Haiku tiebreaker is
      invoked (`routingMethod: "embedding"`).
- [ ] Given two skills with overlapping descriptions, when the user's phrase
      is ambiguous (top-1 below the high-confidence threshold OR gap below the
      gap threshold), then the Haiku tiebreaker is invoked exactly once
      (`routingMethod: "haiku"`) with the top-3 candidates and returns one of
      them.
- [ ] Given a brand-new skill folder is added under `src/skills/`, when the
      app restarts, then the new skill becomes routable without any change to
      router code.
- [ ] Given the registry is empty (zero skills loaded), when any phrase
      arrives, the orchestrator returns the configured fallback skill id
      (`general_assistant`) with `routingMethod: "fallback"`.

### Story 2 — Structural triggers bypass embedding

**As a** user, **when** I type a slash command or tap a button, **I want** it
to go straight to the named skill without any LLM call or guesswork.

**Acceptance Criteria:**
- [ ] Given a skill declares `structuralTriggers: ["/plan"]`, when the user
      sends `/plan`, then the orchestrator routes to that skill with
      `routingMethod: "structural"` and no embedding score is computed and no
      LLM call is made.
- [ ] Given a UI button event passes a `skillId` directly to the orchestrator,
      then the orchestrator routes to that id without any matching logic
      (`routingMethod: "direct"`).
- [ ] Given two skills declare the same structural trigger, then the loader
      (FEAT054) rejects the second skill — the orchestrator never sees a
      collision.

### Story 3 — Fallback to `general_assistant` on weak match

**As a** user with a phrase that doesn't fit any installed skill well,
**I want** a safe fallback rather than a confidently wrong route.

**Acceptance Criteria:**
- [ ] Given a `general_assistant` skill exists in the registry and no other
      skill scores above the configured fallback threshold, when the user
      sends any phrase, the orchestrator routes to `general_assistant` with
      `routingMethod: "fallback"`.
- [ ] Given `general_assistant` is missing from the registry (mis-installed
      or never added), when no skill scores above the fallback threshold, the
      orchestrator returns the highest-scoring skill it has and logs a
      warning that `general_assistant` is missing — the system degrades but
      doesn't fail.
- [ ] The fallback threshold is configurable (default value to be set by
      Architect; PM proposes ~0.4 cosine similarity).

### Story 4 — Scope clarification is per-skill, not router-global

**As an** architect, **I want** the router to stay generic — any clarification
rule belongs to a specific skill, not a global router rule.

**Acceptance Criteria:**
- [ ] The legacy *"if data > 30 items and intent is analysis, ask for scope"*
      rule is removed from the router code path entirely.
- [ ] A skill that needs clarification (e.g., a bulk task delete skill)
      handles it inside its own prompt or returns a clarifying tool call from
      its handlers — never via router-side intervention.
- [ ] The router output schema contains no clarification-related fields. The
      router's only job is picking a skill id.

### Story 5 — Transparent routing

**As a** user, **I want** to see which skill answered my message. **As a**
developer, **I want** to debug routing decisions.

**Acceptance Criteria:**
- [ ] Every assistant reply carries the selected `skillId` in its metadata
      and the chat surface renders a small badge with the skill name under
      the message.
- [ ] Every routing decision logs a structured entry containing at minimum:
      hashed phrase, selected `skillId`, confidence score, `routingMethod`,
      and the top-3 candidates considered (with their scores).
- [ ] Tapping the skill badge shows the user: which skill answered, the
      confidence score, and a *"this didn't help"* action. For v2.01 the
      action only writes a log entry; full feedback wiring ships with
      FEAT066 in Phase 6.

### Story 6 — Graceful degradation

**As a** user, **I want** the system to keep working even when subsystems
fail.

**Acceptance Criteria:**
- [ ] Given the Haiku circuit breaker is open (per existing `llm.ts`), when
      an ambiguous phrase arrives, the orchestrator picks the top-1 skill
      without invoking a tiebreaker and logs that the breaker was open.
- [ ] Given the orchestrator returns a `skillId` that is not in the registry
      (race condition between boot and call), the dispatcher (downstream)
      catches it and routes to `general_assistant` — the orchestrator itself
      does not need to defend against this.
- [ ] Disabling FEAT051 via a settings flag (`V4_SKILLS_ENABLED=` empty) routes
      everything through the legacy intent system, used for emergency
      rollback during the dual-path migration window described in
      `docs/v4/09_dev_plan.md §5 Phase 1`.

---

## Out of Scope

- **On-the-fly skill composition** — REJECTED per architect verdict (banner
  above). The user authors new skills explicitly via FEAT053 (Phase 9).
- **Multi-skill orchestration** — running two skills sequentially per phrase
  violates ADR-001.
- **Conversation-history-aware routing** — for v2.01 the orchestrator sees
  the current phrase only. Adding history-aware disambiguation can be a
  Phase 6 follow-up if the Pattern Learner reveals a need.
- **Routing confidence calibration across skill packs** — relies on cosine
  similarity from the existing FEAT042 embedder; no learned scaler in v2.01.
- **A new embedding model** — reuses bge-m3 from `src/modules/embeddings/`.
- **Multi-language phrase normalization** — embedder is multilingual; no
  language-specific routing logic in v2.01.
- **A debug "force route to skill X" UI** — settings flag exists but no UI
  surface for it.

---

## Assumptions & Open Questions

**Assumptions:**
- FEAT054 ships first and exposes the `SkillRegistryAPI` documented in
  `src/types/skills.ts` (specifically `findSkillsByEmbedding`,
  `getSkill`, `getAllSkills`).
- A `general_assistant` skill folder exists by the time FEAT051 ships. It
  is part of the FEAT080 skill migration batch (also Phase 1/2). Without it,
  the fallback path warns and degrades — acceptable for the
  bring-up window.
- The existing Haiku circuit breaker (`isCircuitOpen` in `llm.ts`) is
  reusable. The orchestrator queries it before the tiebreaker call.
- The user phrase is embedded with the same bge-m3 model that produced the
  cached skill description embeddings — same dimensionality, same model
  version. If the cache is from a different version, FEAT054's
  dimension-mismatch warning fires.
- The legacy `router.ts` and `triage.ts` files have callers in `chat.tsx`
  and the headless runner. Both must be updated when FEAT051 lands. The
  Architect specifies the replacement API surface.

**Open Questions for the Architect:**
1. What exact confidence values for the gates? PM proposes: top-1 > 0.80
   AND gap > 0.15 → no tiebreaker; top-1 < 0.40 → fallback to general_assistant;
   otherwise → Haiku tiebreaker. Architect to confirm or adjust.
2. Should the Haiku tiebreaker prompt include each candidate's full description,
   or `id` + `description` + 2 example trigger phrases? Token-cost vs. accuracy
   tradeoff.
3. Structural triggers checked before embedding (zero-cost short-circuit) or
   after (uniform path)? PM proposes before — exact-match is cheap.
4. Should the orchestrator be in `src/modules/router.ts` (extend existing
   file) or a new file `src/modules/orchestrator.ts` (matches v4 vocabulary)?
   Architect call. Existing file has callers that would all need import updates.
5. What is the disable-flag mechanism per Story 6 AC 3? Env var, config
   field, settings panel? FEAT035 in Phase 3 ships the settings panel — this
   one needs an interim mechanism.
6. The legacy `triage.ts` clarification logic must move into specific skills
   per Story 4. Which legacy intents relied on it, and what are the resulting
   skill-side rules? This becomes a Coder/Architect concern for the FEAT080
   skill migration batch — flag here so it isn't lost.
7. The 50-phrase regression set and 20-phrase ambiguous set need to exist as
   test fixtures. Architect to specify location and format (recommend
   alongside `src/modules/skillRegistry.test.ts` style — co-located test
   data).

---

## Architecture Notes

*Filled by Architect agent 2026-04-27 (workflow stage 3). Full design review
in `FEAT051_design-review.md` (workflow stage 4).*

### Data Models

```ts
// src/types/orchestrator.ts (NEW file — exported alongside types/skills.ts)

export type RoutingMethod =
  | "structural"   // slash command or direct skillId
  | "direct"       // button event passed skillId
  | "embedding"    // top-1 score + gap above thresholds
  | "haiku"        // tiebreaker resolved
  | "fallback";    // no skill above fallback threshold → general_assistant

export interface RouteResult {
  skillId: string;
  confidence: number;          // 0..1, the score of the chosen skill
  routingMethod: RoutingMethod;
  /** Top-3 considered candidates, for transparency log + user-facing
   *  "use a different skill" affordance. Empty for structural / direct. */
  candidates: Array<{ skillId: string; score: number }>;
  /** Optional reason string, populated for fallback and haiku paths.
   *  e.g. "no skill exceeded fallback threshold (top-1 = 0.32)". */
  reason?: string;
}

export interface RouteInput {
  phrase: string;
  /** Set when a button or programmatic caller bypasses NL routing. */
  directSkillId?: string;
  /** When the phrase starts with `/`, the orchestrator extracts the command
   *  and matches against any skill's structuralTriggers. The full phrase
   *  including args is still passed to the skill downstream. */
}
```

### API Contracts

```ts
// src/modules/router.ts (FILE EXTENDED — keeps name to avoid mass caller updates;
// exports use v4 vocabulary)

/** Pick the skill that should handle this phrase. Always returns a skill id —
 *  the only guaranteed-empty cases are programmer errors and are caught by
 *  the dispatcher. */
export async function routeToSkill(input: RouteInput): Promise<RouteResult>;

/** Boot-time setter wired from app shell after config loads.
 *  Empty array means "v4 routing disabled — fall through to legacy path".
 *  This is the interim Story 6 AC 3 mechanism until FEAT035 settings panel
 *  lands; PR review must catch any new `process.env.V4_*` reads. */
export function setV4SkillsEnabled(enabledIds: string[]): void;

/** Test-only: reset the v4-enabled flag and any internal caches. */
export function _resetOrchestratorForTests(): void;
```

### Routing algorithm (per `docs/v4/01_request_flow.md §1`)

```
routeToSkill(input):

  Step 0 — Direct skillId (button events)
    if input.directSkillId is set:
      return { skillId, confidence: 1.0, routingMethod: "direct", candidates: [] }

  Step 1 — Structural match (zero LLM, exact string compare)
    if input.phrase starts with "/":
      cmd = input.phrase.split(/\s+/)[0]    // "/plan args" → "/plan"
      for each loaded skill, scan manifest.structuralTriggers
      if exactly one skill matches:
        return { skillId, confidence: 1.0, routingMethod: "structural", candidates: [] }
      // duplicates already rejected by FEAT054 loader; zero-match falls through

  Step 2 — Embedding similarity (TS, ~10-30ms)
    embed input.phrase via embeddings/provider.embed()
    candidates = registry.findSkillsByEmbedding(phraseEmb, topK=3)

    if registry empty OR all candidates have null embedding:
      return fallback (Step 5)

  Step 3 — Confidence gate
    let top1 = candidates[0].score
    let gap  = top1 - (candidates[1]?.score ?? 0)

    if top1 >= HIGH_THRESHOLD (0.80) AND gap >= GAP_THRESHOLD (0.15):
      return { skillId: candidates[0].skillId, confidence: top1,
               routingMethod: "embedding", candidates }

  Step 4 — Haiku tiebreaker (only if gate fails)
    if isCircuitOpen():
      // Degrade gracefully — pick top-1 without LLM
      return { skillId: candidates[0].skillId, confidence: top1,
               routingMethod: "embedding", candidates,
               reason: "haiku circuit open — degraded to top-1" }

    if top1 < FALLBACK_THRESHOLD (0.40):
      // Don't burn a tiebreaker call when nothing matched well
      return fallback (Step 5)

    chosenId = haikuTiebreaker(input.phrase, candidates)
    return { skillId: chosenId, confidence: top1, routingMethod: "haiku", candidates }

  Step 5 — Fallback
    if "general_assistant" in registry:
      return { skillId: "general_assistant", confidence: 0,
               routingMethod: "fallback", candidates,
               reason: `no skill exceeded fallback threshold (top-1 = ${top1})` }
    else:
      // general_assistant not yet installed — degrade with warning
      console.warn("[router] fallback skill 'general_assistant' missing")
      return { skillId: candidates[0]?.skillId ?? "", confidence: top1 ?? 0,
               routingMethod: "embedding", candidates,
               reason: "fallback skill missing; using top-1" }
```

### Constants

```ts
const HIGH_THRESHOLD = 0.80;       // top-1 must exceed this
const GAP_THRESHOLD = 0.15;        // top-1 - top-2 must exceed this
const FALLBACK_THRESHOLD = 0.40;   // below this → no tiebreaker, go to fallback
const FALLBACK_SKILL_ID = "general_assistant";
```

All thresholds are module-level constants for v2.01. If tuning shows they need
to vary, the Pattern Learner (FEAT064, Phase 7) can propose adjustments via
Pending Improvements.

### Haiku tiebreaker contract

```ts
async function haikuTiebreaker(
  phrase: string,
  candidates: Array<{ skillId: string; score: number }>
): Promise<string>;
```

**Prompt content (per Q2 "accuracy first"):** the prompt includes each candidate
skill's full `description`, full `triggerPhrases` array, and `id`. Token budget
~400 input + ~30 output. Cost ~$0.0001 per tiebreaker call. Tool use is
required (single tool: `pick_skill` with `skillId` enum of the candidates).

If the LLM returns an unknown id (model error), pick top-1 from candidates.

### Service Dependencies

| Internal | Used for |
|---|---|
| `src/modules/skillRegistry.ts` (FEAT054) | `findSkillsByEmbedding`, `getSkill`, `getAllSkills` for structural-trigger scan |
| `src/modules/embeddings/provider.ts` (FEAT042) | Embed the phrase for similarity scoring |
| `src/modules/llm.ts` (existing) | Haiku client + `isCircuitOpen()` |

No third-party dependencies added. No new npm packages.

### Design Patterns

- **Sequential decision pipeline** (Steps 0–5). Each step returns early on a hit. Easy to read, easy to instrument, easy to unit-test per step.
- **Threshold constants pinned at module level** rather than per-call config. Pattern Learner can propose updates later via prompt patches.
- **Graceful degradation** at every external dependency: registry empty → fallback; circuit open → top-1 without tiebreaker; fallback skill missing → top-1 with warning. Router never throws.
- **No regex on free-form NL** per ADR-003 — exact-match for structural triggers only.
- **Disable mechanism** via setter (not env var). Boot-time `setV4SkillsEnabled()` from `app/_layout.tsx` after config loads. The legacy router fallthrough lives in the consumer (chat.tsx) — when v4-enabled list is empty, consumer skips `routeToSkill` and uses `classifyIntent`.

### New vs. Reusable Components

**New:**
- `src/types/orchestrator.ts` — interfaces (RouteResult, RouteInput, RoutingMethod)
- `routeToSkill`, `haikuTiebreaker`, `setV4SkillsEnabled`, `_resetOrchestratorForTests` exports added to `src/modules/router.ts`
- Module-level constants block at top of `router.ts`
- `src/modules/router.test.ts` test fixture data — 50-phrase regression set + 20-phrase ambiguous set as inline arrays (per Q7)

**Reusable (no changes):**
- `src/modules/embeddings/provider.ts` for phrase embedding
- `src/modules/skillRegistry.ts` for skill lookup
- `src/modules/llm.ts` Haiku client

**Touched (small additions):**
- `src/modules/router.ts` — adds new exports alongside existing `classifyIntent`. Existing exports stay untouched during dual-path window. Legacy code is deleted in FEAT080/081 once each migrated skill proves parity.

### Risks & Concerns

- **Ambiguous-phrase classification accuracy depends on Haiku quality.** If the tiebreaker drops below 90% on the 20-phrase ambiguous set, the user feels misrouting. Mitigation: log every tiebreaker decision; if accuracy slips, the prompt can be tuned (it's a normal prompt patch, not a code change).
- **Threshold drift:** the 0.80/0.40/0.15 numbers are PM-proposed and unvalidated against real usage. If they're wrong, the system either over-fires the tiebreaker (cost) or misroutes (quality). Mitigation: log routing methods; review the distribution after a week of dogfood.
- **`general_assistant` not yet installed.** FEAT051 ships in v2.01; FEAT080 (which delivers `general_assistant`) is v2.02. There is a window where the fallback path triggers the "fallback skill missing" warning. Mitigation: ship a minimal `general_assistant` skill folder as part of FEAT054's _examples to cover the gap, OR document the warning as expected during the v2.01-only window. Architect chooses the latter — it's only ~2 weeks.
- **Embedding cost on the hot path:** every phrase that doesn't hit a structural trigger gets embedded. The bge-m3 embedder is local and ~10-30ms per call on Node, but on Capacitor mobile (FEAT044) it's 30-50ms. Mitigation: the call is unavoidable for the routing decision; can be made async-parallel with other prep work in a future optimization.
- **Setter vs. env var disable mechanism is unusual.** Most projects use env vars. Reason for the setter: AGENTS.md rule "no `process.env` reads outside `src/config/settings.ts` (after FEAT035 ships)". For v2.01 we don't have settings.ts yet, so a setter is the cleanest interim. Coder must add a `// TODO(FEAT035): replace with settings.get('v4SkillsEnabled')` comment.

### UX Review Notes

UX scope is small: one badge under each assistant reply showing the resolved `skillId`. The chat surface (`app/(tabs)/chat.tsx`) already renders message metadata; adding the badge is a one-line addition to the metadata renderer. Tap action opens a native `Alert.alert` with the skill name + confidence + a placeholder *"this didn't help"* button that logs a feedback event (full feedback wiring ships in FEAT066, Phase 6).

No new screens. No new routes. No layout changes.

### Testing Notes

#### Unit Tests Required

- **Threshold gate logic:** for each (top-1, gap) corner case, assert the right routing method is chosen.
  - top1 = 0.85, gap = 0.20 → "embedding" (clear match)
  - top1 = 0.85, gap = 0.10 → "haiku" (gap too narrow)
  - top1 = 0.65, gap = 0.20 → "haiku" (top-1 below high threshold but above fallback)
  - top1 = 0.30, gap = 0.05 → "fallback" (below fallback threshold)
  - top1 = 0.50, gap = 0.20, circuit-open → "embedding" with `reason` set (degraded)
- **Structural trigger:** "/plan" with one matching skill → "structural", no embedding call.
- **Direct skillId:** `directSkillId: "x"` → "direct", no embedding call.
- **Empty registry:** any phrase → "fallback" (with warning if general_assistant missing).
- **Threshold constants exposed for test inspection** so the Tester doesn't hard-code values.

#### Component Tests Required

- `routeToSkill` with a real `SkillRegistry` built from fixture skills (in-memory):
  - 5 skills, clear-match phrase → routes to one with no Haiku call
  - 5 skills, ambiguous phrase → routes via Haiku (mocked to return one of the candidates)
  - 5 skills, no good match → fallback
  - General assistant in registry → fallback skill picked correctly
  - General assistant NOT in registry → top-1 returned with warning

#### Integration Tests Required

- **50-phrase regression set:** correct top-1 routing for all (target ≥ 95%). Each phrase tagged with its expected `skillId`. Co-located in `src/modules/router.test.ts` as a top-of-file constant.
- **20-phrase ambiguous set:** designed to land in the Haiku path. Real Haiku tiebreaker invoked (or mocked depending on CI cost). Target ≥ 90% top-1.
- **Circuit-breaker degradation:** force `isCircuitOpen` to true → ambiguous phrase resolves via "embedding" (top-1) with `reason` populated.

#### Scope Isolation Tests Required

**No** — FEAT051 doesn't touch user data; it only routes phrases. Privacy filter (FEAT055) is downstream.

#### Agent Fixtures Required

The Haiku tiebreaker output should be **mocked** for deterministic tests. A real-LLM smoke test runs once per release, not per CI run. Architect to confirm this aligns with the test infrastructure's cost model.

---

## UX Notes

[**To be filled after architect review.** UX scope is small:
- One new visual: a skill name badge under each assistant reply
- One new affordance: tap badge → popover with confidence + *"this didn't help"*
- No new screens or routes
- Existing chat layout unchanged]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.** Reference:
`docs/v4/11_v2_design_review.md §5 Phase 1`. Required test types:
- 50-phrase routing accuracy regression set (target ≥ 95 % top-1) — fixtures
  needed
- 20-phrase ambiguous set for tiebreaker accuracy (target ≥ 90 %)
- Structural-trigger short-circuit tests (no embedding/LLM calls happen)
- Fallback-to-`general_assistant` tests when no skill exceeds threshold
- Circuit-breaker degradation tests (Haiku open → top-1 without tiebreaker)
- Empty-registry test (returns fallback)
- Logging/transparency tests (every decision produces a structured log)]
