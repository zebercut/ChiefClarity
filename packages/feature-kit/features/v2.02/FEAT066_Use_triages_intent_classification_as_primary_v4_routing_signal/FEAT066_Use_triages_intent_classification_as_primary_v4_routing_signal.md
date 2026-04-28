# FEAT066 — Use triage's intent classification as primary v4 routing signal

**Type:** bug-fix
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up)
**MoSCoW:** MUST
**Category:** Architecture / Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** skill-routing, v4, triage, production-bug, real-llm-smoke
**Created:** 2026-04-27

**Depends on:** FEAT051 (Done — v4 router), FEAT054 (Done — skill registry), FEAT056 (Done — v4 gate), FEAT064 (Done — isomorphic skill loading), FEAT065 (Done — per-skill tool schemas)
**Unblocks:** Reliable verb-prefix phrasing on web ("add a task X", "schedule a meeting X", "I'm stressed") without requiring exact slash commands or structural-trigger keywords. Reduces the urgency of FEAT067 (web embeddings) by closing the highest-impact misroute path with a near-zero-cost change.

---

## Problem Statement

A user typed `"add a task as test task, due tomorrow"` in the running web app. Triage correctly classified the phrase as `task_create` via its regex fast-path. The v4 router IGNORED that classification: it ran its own ladder (structural-trigger match → embedding similarity → fallback), failed both — the first token "add" is not in any skill's `structuralTriggers`, and the embedder is intentionally degraded on web per FEAT064 — and dropped through to `general_assistant`. The skill politely refused with a "try saying 'add a task'" message that the user had, in fact, already typed almost verbatim. Console trace:

```
[triage] fast-path → task_create (create, low)
[router] phrase embedder unavailable: ...
[router] route phrase=... skill=general_assistant confidence=0.00 method=fallback
[skillDispatcher] dispatch ... skill=general_assistant
```

Root cause: `routeToSkill` accepts `RouteInput = { phrase, directSkillId? }` and has no awareness of triage's classification. Triage runs first in `chat.tsx:389` and produces `triage.legacyIntent`, but the value is only consumed by `shouldTryV4` (the gate); it is never threaded into `routeToSkill` at line 401. The router rebuilds intent inference from scratch using two signals — structural triggers (rigid first-token match) and embeddings (unavailable on web) — when a perfectly good signal already exists upstream. FEAT065's BINDING real-LLM smoke did not catch this because that smoke ran with `LIFEOS_SKILL_LIVE_RELOAD` unset and a working Node-side embedder; embedding-based routing succeeded for those 7 phrases. Web has no embedder, so the same router ladder collapses to fallback for any phrase whose first token isn't a registered structural trigger. The fix is to plumb `triage.legacyIntent` into `routeToSkill` and consult it BEFORE the structural matcher via a small static intent → skill map.

---

## User Stories

### Story 1 — `RouteInput` accepts a triage hint

**As a** caller of `routeToSkill`, **I want** to pass triage's already-computed intent classification, **so that** the router can use it as a primary routing signal instead of recomputing intent from scratch.

**Acceptance Criteria:**
- [ ] `RouteInput` in `src/types/orchestrator.ts` gains an optional field `triageLegacyIntent?: IntentType`.
- [ ] `RoutingMethod` union in `src/types/orchestrator.ts` gains a new value `"triage_hint"` (alongside existing `"structural" | "direct" | "embedding" | "haiku" | "fallback"`).
- [ ] All existing call sites that construct a `RouteInput` continue to compile without modification — the field is additive and optional.
- [ ] No behavior change for callers that do not pass the new field — the existing ladder runs unchanged.

### Story 2 — Static intent → skill map

**As a** v4 router, **I want** a single static map from `IntentType` to v4 skill id, **so that** triage's classification can be translated to a routing decision in one lookup with no probabilistic logic.

**Acceptance Criteria:**
- [ ] A new module-level constant in `src/modules/router.ts`, `TRIAGE_INTENT_TO_SKILL: Partial<Record<IntentType, string>>`, contains the following entries (PM proposal — architect confirms in stage 3):
  - `task_create`, `task_update`, `task_query` → `task_management`
  - `calendar_create`, `calendar_update`, `calendar_query` → `calendar_management`
  - `emotional_checkin` → `emotional_checkin`
  - `bulk_input` → `inbox_triage`
  - `full_planning` → `priority_planning`
  - `general`, `info_lookup`, `learning`, `feedback`, `suggestion_request` → `general_assistant`
- [ ] Intents with no migrated skill (`okr_update`, `topic_query`, `topic_note`) have NO entry in the map and therefore fall through to the existing ladder. This is intentional — adding entries before the corresponding skills exist would route to skills the registry cannot resolve.
- [ ] The map is exported (or test-accessible) so unit tests can assert its contents without duplicating the literal in test code.

### Story 3 — Router consults triage hint before the structural matcher

**As a** web user typing a verb-prefix phrase, **I want** the router to honor triage's classification when present, **so that** my phrase reaches the correct skill even when the embedder is unavailable and the first token is not a structural trigger.

**Acceptance Criteria:**
- [ ] `routeToSkill` in `src/modules/router.ts` adds a new step BEFORE Step 1 (structural match), positioned AFTER Step 0 (`directSkillId`). Call it Step 1a — triage hint.
- [ ] The step fires only when ALL of the following are true:
  - [ ] `input.triageLegacyIntent` is set (truthy);
  - [ ] `TRIAGE_INTENT_TO_SKILL[input.triageLegacyIntent]` returns a skill id;
  - [ ] That skill id is present in the registry (`registry.getSkill(skillId)` returns non-null);
  - [ ] That skill id is in `getV4SkillsEnabled()` — the per-skill rollout gate must NOT be bypassed.
- [ ] When all conditions hold, the step returns:
  ```
  { skillId, confidence: 0.95, routingMethod: "triage_hint", candidates: [] }
  ```
  (Confidence 0.95 is PM's proposal — see Open Question 1. Architect may pin to 1.0 or another value.)
- [ ] When any condition fails (no hint, no map entry, skill missing, skill not enabled), the router falls through to the existing Step 1 (structural match) UNCHANGED. No bypass of the enabled-set gate, no warn-and-continue special cases beyond a single `console.warn` when the map points at a non-registered skill (this would only happen mid-incremental-rollout and indicates a configuration mistake worth surfacing).
- [ ] When the triage-hint step succeeds, it pre-empts both structural and embedding matches. If structural would have matched a different skill, triage-hint wins. Justification: triage's classifier — regex fast-path plus Haiku tiebreaker — is the highest-quality signal the system has at this point in the pipeline. Conflict resolution between triage and structural is out of scope (see Out of Scope).

### Story 4 — `chat.tsx` threads the hint through

**As a** chat surface, **I want** to pass `triage.legacyIntent` into `routeToSkill`, **so that** the router can act on it.

**Acceptance Criteria:**
- [ ] `app/(tabs)/chat.tsx` line 401 (the `routeToSkill({ phrase })` call inside the `shouldTryV4` block) is updated to pass the hint:
  ```
  const routeResult = await routeToSkill({
    phrase,
    triageLegacyIntent: triage.legacyIntent ?? undefined,
  });
  ```
- [ ] No other chat-surface logic changes. Triage is already computed at line 389 and currently consumed at line 399 (`shouldTryV4`); we are only widening one additional usage.
- [ ] The headless runner and any other `routeToSkill` callers are out of scope for this story — they may pass the hint in a follow-up FEAT, but the bug being fixed is the in-app web path.

### Story 5 — Routing decision log includes `triage_hint`

**As an** operator reading console / audit logs, **I want** the routing method to include `triage_hint` as a distinct value, **so that** I can tell at a glance whether a routing decision came from the new hint path versus structural / embedding / fallback.

**Acceptance Criteria:**
- [ ] The `[router] route phrase=... skill=... confidence=... method=...` log line emits `method=triage_hint` for hint-routed decisions.
- [ ] Type-side: the `RoutingMethod` union (Story 1) already adds `"triage_hint"` as a literal; `logRoutingDecision` requires no change beyond passing the new union value through unchanged.
- [ ] FEAT069 audit-log consumers reading `routingMethod` from `RouteResult` are forward-compatible (the union is widened additively).

### Story 6 — Real-LLM smoke covering all migrated skills, per verb-form

**As a** tester, **I want** a BINDING real-LLM smoke that exercises the verb-prefix phrasings users actually type for every migrated skill, **so that** the next router regression on web is caught before users see it.

**Acceptance Criteria:**
- [ ] A real-LLM smoke (analogous in shape to FEAT065's `scripts/scratch/smoke-v4.ts`, gitignored under `scripts/scratch/`) runs at least 10 phrases — at least 2 per migrated skill except `general_assistant`, which gets 1. Concrete phrase set proposed below; tester / architect may add more.
- [ ] The smoke runs with the **embedder disabled or unavailable** (simulating the web environment) so the triage-hint path is what carries the routing — not the embedder. PM's preferred mechanism: pass an `embedder: async () => null` override via `RouteOptions` per phrase. Architect to confirm in stage 3.
- [ ] For each phrase, the smoke asserts:
  - [ ] `routeResult.routingMethod === "triage_hint"`,
  - [ ] `routeResult.skillId === <expected skill id>`,
  - [ ] The dispatcher then runs against the live Anthropic API and the returned `toolCall.name` is one declared by the routed skill.
- [ ] Pass criterion: 10/10 strict (no soft-pass). Failure on any phrase blocks deployment.
- [ ] Test results document (FEAT066_test-results.md) includes the per-phrase log lines and the count of `[router] phrase embedder unavailable` warnings (which is expected, not a regression).

**Proposed BINDING smoke phrase set (PM — architect / tester finalize):**

| # | Phrase | Triage `legacyIntent` (fast-path) | Expected skill |
|---|---|---|---|
| 1 | `add a task to test task creation, due tomorrow` | `task_create` | `task_management` |
| 2 | `create a task: review the placeholder doc by Friday` | `task_create` | `task_management` |
| 3 | `remind me to follow up on Project Alpha next week` | `task_create` | `task_management` |
| 4 | `mark the placeholder task as done` | `task_update` | `task_management` |
| 5 | `schedule a meeting with Contact A tomorrow at 3pm` | `calendar_create` | `calendar_management` |
| 6 | `book a 30-minute call about Project Alpha on Thursday` | `calendar_create` | `calendar_management` |
| 7 | `cancel the Thursday placeholder meeting` | `calendar_update` | `calendar_management` |
| 8 | `I'm feeling stressed about the upcoming deadline` | `emotional_checkin` | `emotional_checkin` |
| 9 | `feeling overwhelmed by everything on my plate` | `emotional_checkin` | `emotional_checkin` |
| 10 | `plan my day` | `full_planning` | `priority_planning` |
| 11 (optional) | `tell me about Project Alpha` | `general` (safe-default) | `general_assistant` |

All phrases use generic placeholders only — no real names, companies, or events (per the No Real User Data rule).

---

## Out of Scope

- **FEAT067 — embeddings on web.** The long-term right answer for any phrase that triage cannot classify (the user types something genuinely novel). Heavier work: Metro `blockList` unblock for the embedder bundle, WASM + tokenizer download flow, cold-start cost. The triage-hint fix covers the high-impact verb-prefix cases at near-zero cost; web embeddings remain on the backlog.
- **`okr_update`, `topic_query`, `topic_note` migrations.** These intents are deliberately absent from `TRIAGE_INTENT_TO_SKILL` because their target skills do not exist yet. Adding map entries now would route to a skill the registry cannot resolve. Each migration is its own future FEAT.
- **Triage classifier upgrades.** If triage misclassifies a phrase (e.g., regex fast-path misfires), that is a triage problem, not a routing problem. Out of scope here.
- **Multi-skill conflict resolution.** When triage hint and structural matcher would point at different skills, this FEAT prefers triage hint by design (Story 3). Anything more nuanced (per-intent priority, confidence comparison, user choice UI) is out of scope.
- **Headless runner / non-chat callers of `routeToSkill`.** They continue to work without the hint via the optional field. Threading the hint through scheduled flows is a future cleanup, not this FEAT.
- **AGENTS.md / `docs/new_architecture_typescript.md` updates** beyond what describes the new step in the routing ladder. The architect updates `docs/new_architecture_typescript.md` Section 6 (Module Responsibilities) and Section 9 (ADR) inline with the code change, per the project rule. Wider doc sweeps are out of scope.
- **Removing or shrinking the structural matcher.** The structural step still earns its keep for slash commands and for callers that do not pass the hint. Pruning or merging steps is not part of this fix.

---

## Open Questions (for the architect)

1. **Confidence value for the triage-hint route — 0.95, 1.0, or something else?** PM proposal is 0.95 to leave headroom relative to structural (1.0) — triage is probabilistic (regex + Haiku), so pinning to 1.0 overstates certainty. Architect may prefer 1.0 for log/UX simplicity (everything not-fallback shows the same confidence) or a lower value (e.g., 0.85) if the audit log surfaces a "show top-3 alternatives" affordance for sub-1.0 routes.
2. **Should triage hint pre-empt a conflicting structural match?** PM proposal: yes (Story 3). Triage runs the regex fast-path PLUS a Haiku tiebreaker for ambiguous cases; structural is a single-token literal compare. The chance of structural being right when triage classified is low. Architect may want to log a warn when they disagree to feed future tuning, even if triage wins.
3. **Behavior when the mapped skill is in the registry but NOT in `getV4SkillsEnabled()`** — fall through silently, fall through with warn, or short-circuit to legacy via `dispatchSkill`'s degraded path? PM proposal: fall through silently to the existing ladder (the enabled gate is the per-skill rollout knob, and silent fall-through preserves rollout discipline). Architect's call.
4. **Behavior when the mapped skill is NOT in the registry** (configuration mistake during incremental rollout) — fall through silently, warn-and-fall-through, or hard-error? PM proposal: warn once and fall through. This should never happen in production, but a mid-rollout misconfiguration deserves a visible signal without breaking user chat.
5. **Should `okr_update`, `topic_query`, `topic_note` be added to the map now with a fallback skill id (e.g., point them at `general_assistant`)?** PM proposal: NO. Pointing them at `general_assistant` masks the missing-skill state and makes the eventual real migration look like a routing change rather than a new capability. Better to let triage-hint fail and the structural / embedding / fallback ladder handle them as today. Architect may disagree if the user-facing answer "I'm not sure how to handle that" is worse than `general_assistant`'s polite refusal.
6. **Smoke embedder simulation — `embedder: async () => null` per call, or a runtime flag (e.g., `LIFEOS_DISABLE_EMBEDDER`) honored by `routeToSkill`?** PM proposal: per-call override via the existing `RouteOptions.embedder` injection point — keeps production code unchanged and matches the test-injection pattern already established. Architect may prefer a flag if the smoke also exercises the dispatcher / app shell.

---

## References

- **Bug discovery:** User-reported, 2026-04-27. Console trace quoted in Problem Statement.
- **Bug site:** `src/modules/router.ts` `routeToSkill` (no triage-hint step), `app/(tabs)/chat.tsx:401` (call site does not pass `triage.legacyIntent`).
- **Triage source-of-truth:** `src/modules/triage.ts:213-231` (fast-path classifier producing `legacyIntent`).
- **Type to update:** `src/types/orchestrator.ts` (`RouteInput`, `RoutingMethod`).
- **Static map (new):** `src/modules/router.ts` (`TRIAGE_INTENT_TO_SKILL`).
- **`IntentType` definition:** `src/types/index.ts:62-79`.
- **Migrated skills (current rollout):** `src/skills/{task_management, calendar_management, emotional_checkin, inbox_triage, priority_planning, notes_capture, general_assistant}/manifest.json`.
- **Smoke pattern to mirror:** `packages/feature-kit/features/v2.02/FEAT065_*/FEAT065_test-results.md` "Real-LLM smoke (BINDING per condition 14)" section.
- **Related FEATs:** FEAT051 (router algorithm), FEAT054 (skill registry), FEAT056 (v4 gate, `shouldTryV4`), FEAT061 (dispatcher state forwarding — same pattern of "fix the contract by plumbing existing data through one extra hop"), FEAT064 (isomorphic skill loading on web — context for why the embedder is unavailable), FEAT065 (per-skill tool schemas + first BINDING real-LLM smoke).
- **Long-term related work (not blocked by this FEAT):** FEAT067 (web embeddings — full coverage for novel phrases triage can't classify).

---

## Architecture Notes (added stage 3 — see `FEAT066_design-review.md` for full review)

**Verdict:** APPROVED for implementation. Decisions on the 6 PM open questions and the triage-emit audit summarized here; the design-review doc carries the full ladder diagram, alternatives matrix, conditions, and pattern-learning entry.

**Decisions on the 6 open questions:**

1. **Confidence value:** **0.95** (PM proposal accepted). Triage is probabilistic (regex + Haiku tiebreaker on the Haiku triage path); 1.0 overstates certainty. 0.95 is clearly above embedding `HIGH_THRESHOLD` (0.80) so the routing decision is unambiguous, and distinguishable from structural/direct (1.0) so audit-log consumers can tell the routes apart.
2. **Pre-empt conflicting structural match:** **YES, AND log a `console.warn` when they disagree.** The warn is telemetry only — behavior is identical to silent pre-empt. It surfaces triage-vs-manifest-trigger drift as a learnable signal without changing routing semantics.
3. **Mapped skill in registry but NOT in `getV4SkillsEnabled()`:** **silent fall-through.** The enabled-set IS the per-skill rollout knob. WARN here would spam every time a skill is disabled via `setV4SkillsEnabled([...])`.
4. **Mapped skill NOT in registry:** **warn-once + fall-through.** Use a module-level `Set<string>` cache (reset via `_resetTriageHintWarnCacheForTests()`, mirroring `_resetOrchestratorForTests()`). First miss per skill_id emits warn; subsequent misses stay silent.
5. **Add `okr_update` / `topic_query` / `topic_note` to map → `general_assistant`?** **NO.** Pointing at the fallback skill masks the missing-skill state. When those skills migrate, that FEAT adds the map entry as part of its own scope. Today they fall through to embedding → fallback → `general_assistant` with a clearly-logged `routingMethod: "fallback"` reason — exactly the visible signal we want.
6. **Smoke embedder simulation:** **per-call `embedder: async () => null` injection** (PM proposal accepted). Matches the existing test pattern in `router.test.ts:316,549`. Smoke script lives in `scripts/scratch/` (gitignored per repo policy).

**Triage emit audit (full table in design-review §4):**

- **Live in map (6 of 14):** `task_create`, `task_update`, `calendar_create`, `calendar_update`, `emotional_checkin`, `full_planning` (all from `FAST_PATH_MAP`), plus `general` from `safeDefault`.
- **Dead in map but kept for forward-compat (7):** `task_query`, `calendar_query`, `info_lookup`, `learning`, `feedback`, `suggestion_request` — no fast-path regex, and the Haiku triage branch doesn't set `legacyIntent`. Plus `bulk_input` — confirmed not in `FAST_PATH_MAP` AND `bulk_input` doesn't go through chat-surface routing (`inbox.ts::processBundle` calls `dispatchSkill` directly). Map entries cost nothing at runtime and document intent for future triage authors. The coder adds a one-line comment next to `bulk_input` per design-review condition 4.
- **Outside the map by design (3):** `okr_update` (live triage emit, but no migrated v4 skill), `topic_query`, `topic_note`. Per Open Q5.

**Files touched:**

- `src/types/orchestrator.ts` — `RouteInput` gains `triageLegacyIntent?: IntentType`; `RoutingMethod` gains `"triage_hint"`.
- `src/modules/router.ts` — `TRIAGE_INTENT_TO_SKILL` const + Step 1a in `routeToSkillInternal` + warn-once cache + `_resetTriageHintWarnCacheForTests()` helper.
- `app/(tabs)/chat.tsx:401` — call-site widens to pass `triageLegacyIntent: triage.legacyIntent ?? undefined`.
- `src/modules/router.test.ts` — six new test cases (see design-review §9.1).
- `scripts/scratch/smoke-feat066.ts` — new gitignored smoke script (10/11 binding).
- `docs/new_architecture_typescript.md` — Section 5 (types), Section 6 (Step 1a in the ladder), Section 9 (ADR).

**Zero changes to:** triage, registry, dispatcher, v4 gate, executor, assembler, any skill manifest / handler / prompt. Strictly local.

**Dependencies:** FEAT051 (Done), FEAT054 (Done), FEAT056 (Done), FEAT064 (Done — context for embedder-null on web), FEAT065 (Done — binding-smoke pattern).

**Pattern codified:** "Use upstream classification before redoing the work" — when a downstream module has access to a classification an upstream module already produced, plumb the signal through and consult it first; independent re-derivation is the fallback. Same template as FEAT061 (state forwarding). See design-review §10 for the full pattern entry and the proposed AGENTS.md addendum.

**Coder pay-extra-attention:**

- Condition 10 binding smoke must run with `embedder: async () => null` injected per call — that's what proves the bug cannot recur on web.
- Step 1a position is BETWEEN Step 0 and Step 1 — `directSkillId` still wins when present.
- The warn-once cache must be tested AND must have a `_resetTriageHintWarnCacheForTests()` helper to prevent state leaking between tests.
