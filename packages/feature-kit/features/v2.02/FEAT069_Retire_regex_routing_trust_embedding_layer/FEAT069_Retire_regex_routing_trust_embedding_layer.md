# FEAT069 — Retire regex/structural routing, trust embedding layer (calibrated thresholds)

**Type:** architecture
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02
**Tags:** skill-routing, v4, regex-retirement, calibration, embeddings, real-llm-smoke
**Created:** 2026-04-27

**Depends on:** FEAT051 (Done — v4 router + embedding ladder), FEAT054 (Done — skill registry + skill embeddings), FEAT064 (Done — bundle-time skill embeddings + isomorphic loading), FEAT066 (Done — triage-hint primary signal), FEAT067 (Done — embeddings on web), FEAT068 (Done — RAG `info_lookup`)
**Unblocks:** A coherent v4 routing story documented in `docs/v4/01_request_flow.md`; FEAT070 (legacy v3 chain retirement) which depends on a single-source-of-truth routing decision; future routing-quality telemetry (the calibration corpus is the seed artifact).

---

## Status

Planned — PM has authored the spec. Awaiting human review before the architect picks it up for stages 3–4 (design notes + design review + option pick + threshold calibration data).

---

## Problem Statement

The user typed two ordinary phrases today and both misrouted to `general_assistant` with polite refusals:

1. **"what is my plan today?"** → `general_assistant` ("try asking 'what should I focus on today?' or 'what's on my calendar?'"). This phrase clearly belongs to `priority_planning`.
2. **"what is chiefcalrity?"** (typo of *chiefclarity*) → `general_assistant` ("I'm not sure what 'chiefcalrity' refers to..."). This phrase clearly belongs to `info_lookup` (FEAT068's RAG path).

Tracing through the routing ladder explains exactly why both fell through:
- Triage's `FAST_PATH_MAP` (`src/modules/triage.ts:182-225`) matched neither phrase. The `full_planning` regex requires `plan my|plan the|plan for`; the `info_lookup` regex requires "what do you know about X" or "tell me about X" but NOT "what is X".
- The v4 router's structural-trigger first-token matcher (FEAT064 design, `router.ts:421-446`) matched neither phrase — the first token is "what", which is not a registered structural trigger on any skill.
- Embedding similarity for both phrases fell below `FALLBACK_THRESHOLD = 0.40` (a value that was guessed at FEAT051 design time, not measured against any real corpus).
- The router's fallback path then picked `general_assistant`, which produced a polite, useless refusal.

The user's correct architectural observation: **"didn't we say we remove regex completely? It is confusing and making wrong decision. We introduced vector persistent database that can search and match the relevant result."** FEAT067 unblocked the embedder on web; FEAT068 wired retrieval-augmented generation through the same embedder. The whole point of those two FEATs was to retire the regex/structural pre-filter layers. We never actually retired them. Today's request flow has *three* parallel intent-classification mechanisms (triage regex, structural first-token compare, embedding similarity) plus a Haiku tiebreaker, and the first two are still wired in front of the third. The two pre-embedding layers cover only the rigid verb-prefix grammars they were written against; they silently exclude any phrasing the author of those regexes did not anticipate (interrogative "what is X?", typos, soft openers like "could you", etc.). The embedding layer — which is the architectural answer to "phrasings the rule-author did not anticipate" — never gets a chance to run on those phrases because the regex layer says "general" and the structural layer has no opinion.

This FEAT completes the architectural arc that FEAT067/068 started. It deletes the regex fast-path inside triage (`FAST_PATH_MAP` + `tryFastPath`), deletes the structural-trigger first-token match step in the v4 router (Step 1 of `routeToSkillInternal`), and replaces the load-bearing magic number `FALLBACK_THRESHOLD = 0.40` with an empirically-measured value derived from a representative phrase corpus. As supporting work, the eight skill-manifest descriptions are enriched with the natural-language phrasings users actually type (so the embedded surface includes "what is my plan today" against `priority_planning`, "what is X" against `info_lookup`, etc.), and the `info_lookup` prompt gains a graceful general-knowledge fallback so that "what is the capital of France" and similar no-personal-data lookups produce a clean answer with an explicit "I don't have personal notes about X, but in general..." disclaimer instead of a refusal.

Triage's *other* responsibilities — emotional-signal detection, source/attachment hinting, complexity classification, scope-clarification prompts — are unchanged. This FEAT is narrowly about retiring the intent-classification regex and the structural first-token matcher, then proving with a binding real-LLM smoke set that the embedding layer alone (with calibrated thresholds and enriched descriptions) handles the cases the regex/structural layers used to handle PLUS the cases they used to fail silently on (the two user-reported failures included).

---

## Goals

1. The `FAST_PATH_MAP` array and `tryFastPath` function in `src/modules/triage.ts` are deleted. `runTriage` no longer attempts regex-based intent classification before its Haiku call.
2. The v4 router's structural-trigger first-token matcher (`router.ts` Step 1, lines ~421-446) is deleted. The new routing ladder is `directSkillId → triage_hint (FEAT066) → embedding → fallback`.
3. The two user-reported failure phrases — "what is my plan today" and "what is chiefclarity" — route via `routingMethod: "embedding"` or `"haiku"` to `priority_planning` and `info_lookup` respectively, without any code path matching either phrase to a regex pattern.
4. `FALLBACK_THRESHOLD` (and `HIGH_THRESHOLD` if calibration shows it needs adjustment) is set based on measured top-1 cosine-similarity scores across a representative phrase corpus (~50-80 phrases, see Story 3). The chosen value, the calibration data, and the cliff in the score distribution that justifies it are all documented in the test-results doc.
5. Each skill-manifest `description` field is enriched to include common natural-language phrasings users actually type for that skill (Story 4). The bundle is regenerated; new embedding vectors ship in `src/skills/_generated/skillBundle.ts`.
6. The `info_lookup` skill prompt is updated so that when retrieval returns nothing above `minScoreInclude`, the LLM may answer from general knowledge with an explicit disclaimer ("I don't have personal notes about X, but in general...") instead of producing a refusal.
7. A binding real-LLM smoke (Story 6) of 8-10 phrases — including the two user-reported failures and regression checks for every skill that previously had a regex fast-path — passes ≥ 8/10 strict.
8. No regression in any pre-existing `router.test.ts`, `triage.test.ts`, or `skillBundle.test.ts` test. FEAT066's triage-hint pre-emption continues to function for the small set of phrases that triage's Haiku call still classifies (or for the static-classifier replacement, if the architect chooses one — see Open Q1).

---

## Success Metrics

- The two user-reported failure phrases route to the correct skill via `routingMethod=embedding` or `=haiku` in a fresh smoke run. `routingMethod=fallback` never appears for either phrase.
- The calibration corpus produces a clean cliff between in-distribution phrases (top-1 score ≥ chosen threshold) and out-of-distribution noise (top-1 score < chosen threshold). The cliff is visible in the published score table; the chosen threshold sits in the middle of the gap.
- Every skill that previously had a regex fast-path (`task_create`, `task_update`, `calendar_create`, `calendar_update`, `full_planning` → `priority_planning`, `emotional_checkin`, `info_lookup`) still routes correctly for its canonical phrasing post-deletion. The smoke covers each.
- The Haiku tiebreaker call rate (a proxy for "how often does the embedding step disagree with itself") does not exceed the FEAT066-baseline rate by more than 20%. If it does, the `HIGH_THRESHOLD` / `GAP_THRESHOLD` calibration is wrong; revisit before merge.
- Zero new code in `src/modules/router.ts` Step 0 (directSkillId) or Step 1a (triage_hint, FEAT066). This FEAT only deletes routing layers; it does not add any.
- All baseline tests pass.
- BINDING real-LLM smoke (Story 6) passes ≥ 8/10 strict.

---

## User Stories

### Story 1 — Retire `FAST_PATH_MAP` regex in triage

**As a** developer reading `src/modules/triage.ts`, **I want** triage to stop attempting regex-based intent classification, **so that** there is exactly one place in the codebase that decides which skill handles a phrase (the v4 router's embedding step).

**Acceptance Criteria:**
- [ ] `FAST_PATH_MAP` (lines 182-225) and `tryFastPath` (lines 227-245) are deleted from `triage.ts`.
- [ ] The `fastPath?: boolean` flag on `TriageResult` is deleted (or kept only if the architect surfaces a downstream consumer that still reads it — see Open Q4).
- [ ] `runTriage`'s entry path no longer calls `tryFastPath`. The new flow is: circuit-breaker check → Haiku call (or safe default if the client is missing or the breaker is open).
- [ ] `safeDefault` is unchanged in behavior: it still emits `legacyIntent: "general"` with a chat actionType, so the existing `v4Gate` test (`v4Gate.test.ts:94-119`) continues to assert "triage's legacyIntent is IGNORED — gate trusts the orchestrator instead". The architect may delete `legacyIntent` from `safeDefault` as a follow-up cleanup but it is not required by this story.
- [ ] `runTriage` continues to emit `legacyIntent` from the Haiku call's tool output, IF the architect picks Open Q1 option (a) — keep the Haiku call as the only intent classifier. If the architect picks (b) — null out `legacyIntent` entirely — the field is left undefined and FEAT066's triage_hint step (`router.ts:371-419`) becomes a near-no-op. Either choice is acceptable; the choice is recorded in the design review.
- [ ] `triage.test.ts` (if it exists) is updated so that any test asserting "phrase X routes via fast-path" is replaced with the equivalent Haiku-or-null assertion.
- [ ] PM proposal: keep the Haiku call as a tertiary signal (option a) so the legacy v3 chain (which `legacyIntent` still feeds via `MODEL_BY_INTENT`) does not regress while FEAT070 retires it. Architect confirms.

### Story 2 — Retire the v4 router's structural-trigger first-token matcher

**As a** developer reading `src/modules/router.ts`, **I want** the structural-trigger first-token compare step deleted, **so that** the routing ladder reduces to `directSkillId → triage_hint → embedding → fallback` with no regex/structural layers in front of embedding.

**Acceptance Criteria:**
- [ ] The block in `routeToSkillInternal` labelled "Step 1 — Structural match" (lines ~421-446) is deleted entirely. The `firstToken` extraction, the `tokenForMatch` lowercase+trim, the `allSkills.filter(...)` against `structuralTriggers`, and the `if (matches.length === 1) return ...` shortcut are all removed.
- [ ] The speculative structural-match-for-disagreement-warn block inside Step 1a (FEAT066, lines ~390-410) is also reviewed: if the architect deletes the structural matcher entirely, the disagreement warn becomes meaningless and SHOULD also be removed. Architect picks; design review records the decision.
- [ ] The `routingMethod` enum value `"structural"` may be left in the `RouteResult` type (`src/types/orchestrator.ts`) for backward compat with logs, OR removed; architect picks. PM proposal: leave it as a deprecated value; remove in a future cleanup. Removing now risks breaking the audit-log (FEAT056) consumer.
- [ ] The skills' `structuralTriggers` field on each manifest (e.g., `task_management.manifest.json` line `"structuralTriggers": ["/task", "/todo", "task", "todo", "remind"]`) is left in place as harmless metadata. The router no longer reads it; the loader and bundle codegen continue to accept it. **Removing the field from manifests is explicitly out of scope** (see "Out of Scope") to keep this FEAT's diff small.
- [ ] Step 0 (`directSkillId`) is unchanged. That is an explicit override, not regex inference, and remains the highest-priority routing signal.
- [ ] Step 1a (FEAT066 triage_hint) is unchanged. Whether it fires often or rarely depends on Story 1's pick; either way, when it fires, it pre-empts the embedding step exactly as today.
- [ ] All `router.test.ts` cases that asserted structural matching (e.g., a test that fed `phrase: "/task add foo"` and asserted `routingMethod === "structural"`) are updated to assert the new behavior — slash-prefixed commands now route via `directSkillId` if the dispatcher converts them upstream, OR via embedding/haiku otherwise. Architect picks the migration path. **Slash command UX must not regress.** PM proposal: the chat surface keeps any `/skillId` parsing it currently does in `chat.tsx` (which sets `directSkillId` directly); router-side structural matching is dead.

### Story 3 — Calibrate `FALLBACK_THRESHOLD` (and `HIGH_THRESHOLD`) against a real phrase corpus

**As an** architect, **I want** the routing thresholds set based on measured score distributions, **so that** "the embedding layer doesn't fire" stops being a known-magic-number bug and becomes a documented, reproducible calibration decision.

**Acceptance Criteria:**
- [ ] A calibration corpus of ~50-80 phrases is assembled. Shape proposal (architect refines):
  - 5-8 phrases per migrated skill (`priority_planning`, `task_management`, `calendar_management`, `notes_capture`, `inbox_triage`, `emotional_checkin`, `info_lookup`, `general_assistant`) covering each skill's canonical phrasings. ~40-64 phrases.
  - 8-12 generic conversational phrases that should land on `general_assistant` (chitchat, jokes, opinion questions).
  - 8-12 knowledge-question phrases for `info_lookup`: half with personal-data hooks ("what is ChiefClarity", "tell me about Project Alpha"), half general-knowledge ("what is the capital of France", "what is React").
  - 4-6 out-of-distribution noise phrases ("asdfghjkl", "uhh", "...", a single emoji, a number) that SHOULD route via fallback.
  - 2-4 typo variants of in-distribution phrases ("what is chiefcalrity", "addd a tassk") to verify embedding robustness vs the brittle regex behavior.
- [ ] A calibration script lives at `scripts/scratch/calibrate-routing.ts` (gitignored per the One-Time Scripts Policy). The script:
  - Loads the skill bundle (`src/skills/_generated/skillBundle.ts`).
  - For each corpus phrase, calls `embed(phrase)` via the FEAT067 isomorphic provider.
  - Computes cosine similarity against every skill's `descriptionEmbedding`.
  - Outputs a Markdown table: `phrase | top-1 skill | top-1 score | top-2 skill | top-2 score | gap | expected skill | match?` — sorted by top-1 score descending so the cliff is visible.
- [ ] The architect (or coder, depending on pipeline stage) eyeballs the score distribution. The "cliff" — the gap between the lowest correctly-classified phrase's score and the highest noise phrase's score — is the empirical answer.
- [ ] `FALLBACK_THRESHOLD` is set to the midpoint of the cliff. The chosen value, the cliff visualization, and the corpus phrases that bracket the cliff are all documented in `FEAT069_test-results.md`.
- [ ] `HIGH_THRESHOLD` (currently `0.80` per `router.ts:228`) is reviewed against the same corpus. If the data shows that confident classifications routinely score below 0.80 (forcing an unnecessary Haiku tiebreaker), `HIGH_THRESHOLD` is lowered to a measured value. Otherwise it is left at 0.80 with a one-line note in the test-results doc justifying the no-change decision.
- [ ] `GAP_THRESHOLD` (currently `0.15`) is reviewed similarly but defaults to no-change. PM does not expect this to need recalibration; mention only if the data surprises.
- [ ] **No magic numbers in this spec.** The architect / coder publishes the calibration data; the threshold values are whatever the data says. The spec calls out the *process*, not the *outcome*.
- [ ] Re-calibration is not automated. Future drift handling is a future task — see Out of Scope.

### Story 4 — Enrich skill manifest descriptions for embedding match surface

**As a** v4 router, **I want** each skill's `description` field to include the common natural-language phrasings users actually type, **so that** the cosine similarity between a user phrase and the matching skill's description is high enough to clear `HIGH_THRESHOLD` (or at minimum `FALLBACK_THRESHOLD`) without requiring a regex hint.

**Acceptance Criteria:**
- [ ] Each of the eight skill manifests in `src/skills/*/manifest.json` is reviewed. For each, the `description` field is rewritten (or extended) to include 6-12 canonical phrasings the user might naturally say. Quality bar: each description is one paragraph, reads as natural prose (not a regex dump), and its phrase coverage is verified against the calibration corpus from Story 3 — every Story-3 corpus phrase tagged for skill X must score top-1 against skill X's enriched description.
- [ ] PM proposed enrichment seeds (architect / coder finalize wording):
  - `priority_planning`: include "plan my day", "what is my plan today", "what should I focus on", "agenda for today", "what's on my plate", "weekly plan", "help me prioritize", "where should I start"
  - `info_lookup`: include "what is X", "who is Y", "tell me about", "what do you know about", "explain X", "summarize what I know", "any info on", "what was that thing about"
  - `task_management`: include "add a task", "create a todo", "remind me to", "mark X done", "delete the task", "show my tasks", "set priority"
  - `calendar_management`: include "schedule a meeting", "book a call", "what's on my calendar", "am I free", "reschedule", "cancel the meeting", "block off time"
  - `notes_capture`: include "save this idea", "add a note", "remember this", "jot down", "write this down", "capture this"
  - `emotional_checkin`: include "I'm feeling stressed", "feeling overwhelmed", "tough day", "rough day", "venting", "I'm exhausted"
  - `inbox_triage`: include "process my inbox", "here's a brain dump", "log all of these", "process this list" (less critical — bulk_input is mostly programmatic, not chat-typed)
  - `general_assistant`: keep narrow ("freeform conversational, chitchat, opinion questions, simple explanations") — broadening this would attract phrases that should reach a specialized skill. The current description is approximately right; review for clarity only.
- [ ] After description edits, run `npm run bundle:skills` (or whatever the FEAT064 codegen command is). Verify the bundle regenerates and embeddings change for the edited skills. The FEAT064 byte-equality determinism test must pass on a second run with no source change.
- [ ] `triggerPhrases` arrays on each manifest are left in place. They are still consumed by the Haiku tiebreaker prompt (`router.ts:608-617`). PM does NOT propose merging them into the description; keep separate.
- [ ] No skill that previously routed correctly via embedding regresses. This is asserted by re-running the calibration corpus after the description edits.

### Story 5 — `info_lookup` graceful general-knowledge fallback

**As a** user asking "what is the capital of France" (or any other general-knowledge question for which the user has no personal notes), **I want** the assistant to answer cleanly with an explicit "I don't have personal notes about X, but in general..." disclaimer, **so that** the assistant feels useful rather than refusing every lookup that retrieval misses.

**Acceptance Criteria:**
- [ ] The `info_lookup` skill's prompt (under `src/skills/info_lookup/`) is updated. Today's behavior: when retrieval returns no chunks above `minScoreInclude` (currently 0.40 per `manifest.json` `retrievalHook`), the prompt instructs the model to say "I don't have anything specific." New behavior: when retrieval is empty, the model MAY answer from general world knowledge **if and only if** it leads with an explicit disclaimer that it is NOT drawing from the user's notes (e.g., "I don't have personal notes about X, but in general, ..."). For questions clearly tied to the user's life ("what was that meeting about", "who is Contact A"), the disclaimer-then-empty-answer remains.
- [ ] The fabrication-catcher discipline stays for cases where retrieval HAS data — when chunks are present, the LLM still cites from chunks ("from your notes", "you mentioned in topic Y") and never mixes general-knowledge content into a personal-notes answer. This is the existing FEAT068 contract; this story does not relax it.
- [ ] The prompt explicitly distinguishes the two modes: "If the retrieval section below is empty, you may answer from general knowledge with the disclaimer above. If the retrieval section is non-empty, answer ONLY from those chunks; do not blend in general knowledge."
- [ ] The skill's `submit_info_lookup` tool schema (or whatever the existing tool is) is unchanged. Only the prompt narrative is updated.
- [ ] Smoke phrase #4 ("what is the capital of France") asserts: chat reply contains an answer (e.g., "Paris") AND the disclaimer phrase pattern. Smoke phrase #2 ("what is chiefclarity") asserts: if retrieval finds something about ChiefClarity in the user's notes, the answer cites notes; if retrieval finds nothing, the answer falls back to general-knowledge with disclaimer.

### Story 6 — BINDING real-LLM smoke (8-10 phrases, ≥ 8/10 strict pass)

**As a** tester, **I want** a real-LLM smoke that exercises the full retired-regex routing ladder against the two user-reported failures and against regression checks for every skill that previously had a regex fast-path, **so that** the next routing regression is caught before users see it.

**Acceptance Criteria:**
- [ ] A binding real-LLM smoke (analogous to FEAT065/066/067/068's smokes, gitignored under `scripts/scratch/`) runs the ten phrases below. The harness loads the FEAT067 isomorphic embedder, the regenerated FEAT069 skill bundle, and a real Anthropic client (Haiku for tiebreaker, Haiku-or-Sonnet for skill execution).
- [ ] Each phrase's pass criteria (all must hold for that phrase to count as a pass):
  1. `triage.fastPath` is undefined or false (regex fast-path is deleted).
  2. `routeResult.routingMethod` is `"embedding"` or `"haiku"` or `"triage_hint"` — never `"fallback"` or `"structural"`.
  3. `routeResult.skillId === expected` for the phrase (per the table below).
  4. `dispatchResult.userMessage` is a non-empty string.
  5. For `info_lookup` phrases, either retrieval found chunks (cited in the reply) or the reply leads with the general-knowledge disclaimer per Story 5.
- [ ] Pass threshold: ≥ 8/10 strict on all five criteria for the phrase. Two phrase-level failures are tolerated for LLM nondeterminism (same precedent as FEAT065 / FEAT066 / FEAT067 / FEAT068). The two user-reported failures (#1 and #2) are NOT in the tolerated-failure pool — both must pass.
- [ ] Test results document (`FEAT069_test-results.md`) includes the per-phrase routing log lines, the chosen `FALLBACK_THRESHOLD` (and `HIGH_THRESHOLD` if changed), the calibration cliff visualization, and the smoke pass count.

**Proposed BINDING smoke phrase set (PM — architect / tester finalize wording):**

| # | Phrase | Expected skill | Notes |
|---|---|---|---|
| 1 | `what is my plan today?` | `priority_planning` | User-reported failure #1 — MUST pass |
| 2 | `what is chiefclarity?` | `info_lookup` | User-reported failure #2 (no typo this time so it stresses the embedder, not spell-correction) — MUST pass |
| 3 | `who is Contact A?` | `info_lookup` | Generic placeholder; passes whether or not the user has Contact A data, because Story 5 fallback covers the empty-retrieval case |
| 4 | `what is the capital of France?` | `info_lookup` | General-knowledge fallback per Story 5 — assertion 5 above |
| 5 | `what should I focus on today?` | `priority_planning` | FEAT066 canary — was the only thing routing correctly today; must still pass |
| 6 | `I'm feeling stressed` | `emotional_checkin` | Regression check after triage regex removal |
| 7 | `add a task to call the dentist` | `task_management` | Regression check after triage regex removal |
| 8 | `tell me a joke` | `general_assistant` | Regression check; phrase should fall under fallback threshold OR top-1 against general_assistant's description |
| 9 | `schedule a meeting tomorrow at 3pm` | `calendar_management` | Regression check after triage regex removal |
| 10 | `save this idea: review the architecture` | `notes_capture` | Regression check (optional — architect may swap for `inbox_triage` if calibration shows notes_capture is stable) |

All phrases use generic placeholders only — no real names, companies, or events (per the No Real User Data rule). The user-reported failure phrases are the actual failures the user typed today; "ChiefClarity" is the project name and is allowed by the OSS-attribution exception.

### Story 7 — Cost / latency comparison documented

**As an** architect, **I want** the BEFORE/AFTER routing-cost profile documented, **so that** the tradeoff of "regex fast-path was free, embedding costs ~50ms but reaches more cases" is explicit and reviewable.

**Acceptance Criteria:**
- [ ] `FEAT069_test-results.md` includes a table comparing per-phrase routing cost BEFORE this FEAT vs AFTER:
  - BEFORE: regex fast-path hits ~0ms / 0 tokens; regex misses fall through to embedding (~50ms) or to triage Haiku (~200ms + ~$0.0005); structural matcher ~0ms / 0 tokens.
  - AFTER: every phrase pays the embedder ~50ms (free per call after model load); Haiku tiebreaker ~200ms + ~$0.0005 only when top-1 is between `FALLBACK_THRESHOLD` and `HIGH_THRESHOLD` (which calibration should make rare).
- [ ] The harness can measure both numbers; it is not a guesswork comparison.
- [ ] If the AFTER median latency exceeds the BEFORE median by more than 100ms on a fixed test phrase set, this is flagged in the design review and the architect explicitly accepts or rejects the tradeoff before merge.

### Story 8 — Regression check for FEAT066 triage_hint behavior

**As a** developer who shipped FEAT066, **I want** to know whether triage_hint routing still functions after this FEAT, **so that** the legacy v3 chain (which still consumes `legacyIntent`) does not silently regress.

**Acceptance Criteria:**
- [ ] The behavior of triage_hint routing depends on Story 1's pick:
  - **If Open Q1 option (a) is picked** (Haiku call stays as the only intent classifier): triage emits `legacyIntent` from the Haiku tool output. FEAT066's triage_hint step (`router.ts:371-419`) fires for any phrase the Haiku call classified into a known `IntentType`. Frequency drops vs today (no regex fast-path means many more phrases hit the Haiku call, but Haiku may classify them as `general` more often). The existing FEAT066 tests in `router.test.ts` continue to pass.
  - **If Open Q1 option (b) is picked** (no static intent classifier in triage at all): `legacyIntent` is undefined for almost every phrase. The triage_hint step becomes a near-no-op. The existing FEAT066 tests are updated to assert the new "near-no-op" behavior, OR the triage_hint code path is removed entirely (architect picks). PM proposal: keep the code path even if it rarely fires — its presence has zero cost when `triageLegacyIntent` is undefined, and removing it is a separate cleanup.
- [ ] Whichever path is picked, the existing `v4Gate.test.ts:94-119` test ("triage's legacyIntent is IGNORED — gate trusts the orchestrator instead") continues to pass — the v4 gate has never trusted `legacyIntent` for v4-vs-v3 decisions and will not start now.
- [ ] If the architect deletes the triage_hint code path entirely, the dispatcher's `applyResolveContext` (or wherever `routingMethod === "triage_hint"` is special-cased) is checked; remove dead branches.

---

## Out of Scope

- **Triage's emotional/friction signal detection.** The Haiku call's `actionType: "chat"` for "I'm overwhelmed" phrases stays. This FEAT only deletes the *intent-classification* regex inside triage; the rest of triage's responsibilities (source/attachment hints, complexity, scope clarification) is unchanged.
- **Legacy v3 chain retirement.** `MODEL_BY_INTENT`, `classifyIntent`, `classifyIntentWithFallback`, the entire pre-FEAT051 router code in `router.ts` lines 11-208 — this all stays. Deleting it is FEAT070, which depends on this FEAT plus a separate audit of every consumer of `legacyIntent` and `IntentResult.type`.
- **`okr_update` migration to a v4 skill.** Separate FEAT (likely FEAT071). Today triage's regex emits `legacyIntent: "okr_update"` for "okr|goal|objective|key result"; after this FEAT it emits whatever the Haiku call returns or undefined. Either way, `okr_update` continues to fall through the v4 ladder to the legacy chain via `TRIAGE_INTENT_TO_SKILL`'s intentional absence (`router.ts:270`). No regression; no progress.
- **Removing `structuralTriggers` from skill manifests.** Harmless metadata. Leave for a future cleanup FEAT. The router no longer reads them; the loader and bundle codegen continue to accept them. **If the architect picks "delete the structural matcher" hard-line, also consider deleting `structuralTriggers` from the `SkillManifest` type — but PM proposes deferring even that, to keep the diff minimal.**
- **Removing the `routingMethod === "structural"` enum value from `RouteResult`.** Same rationale — leaving as deprecated. Audit-log consumers (FEAT056) treat it as opaque.
- **Routing telemetry / persistent analytics.** Out of scope. The calibration corpus IS the v1 telemetry artifact for thresholds. A future FEAT may add persistent routing-decision logging to `audit_log` (FEAT056 Phase 3), but not here.
- **Embedder model swap or dimension change.** The current `Xenova/all-MiniLM-L6-v2` 384-dim embedder stays per FEAT067's design review §3.1. Recalibrating thresholds for a future model swap is a future task.
- **Spell-correction at the routing layer.** "what is chiefcalrity" should match "what is chiefclarity" via embedding similarity (the embedder is robust to single-character typos). If calibration shows it does not, the answer is *better description enrichment*, not *spell-correction code*. Out of scope to add a typo-correction step.
- **Retiring the `app/(tabs)/chat.tsx` legacyIntent plumbing.** The chat surface still receives `triage.legacyIntent` and forwards it to the v4 router. This stays; what changes is just how often the field is populated.
- **Web-bundle determinism re-verification.** FEAT064's byte-equality determinism guarantee is preserved by re-running `npm run bundle:skills` twice. This is asserted by the existing `skillBundle.test.ts` regression; this FEAT does not extend that test.

---

## Open Questions (for the architect)

1. **Triage's intent classifier replacement: keep Haiku, drop entirely, or replace with a static null?** Three options:
   (a) **Keep the Haiku call as the only intent classifier in triage.** Triage continues to emit `legacyIntent` for the cases Haiku confidently classifies. FEAT066 triage_hint continues to function. PM proposal: yes, this option. Cost is unchanged (Haiku call already runs); benefit is the v3 legacy chain doesn't lose its intent feed.
   (b) **Drop the legacyIntent emission entirely.** Triage's Haiku call still runs for emotional / source / complexity / scope-clarification, but ignores its own intent guess. `legacyIntent` is always undefined; FEAT066 triage_hint becomes near-dead code. Forces FEAT070 (legacy v3 chain retirement) to come faster. PM concern: the legacy v3 chain breaks until FEAT070 ships.
   (c) **Replace Haiku intent guess with embedding-only classification inside triage.** Triage runs `embed(phrase)` against skill descriptions, picks a `legacyIntent` mapped from the top-1 skill. Duplicates the v4 router's embedding step — strictly worse than (a) or (b). PM proposal: REJECT.
   Architect picks one and records the rationale in the design review.

2. **Should the FEAT066 triage_hint code path (`router.ts:371-419`) be kept, simplified, or deleted?** Three sub-options:
   (a) **Keep as-is.** Even if Open Q1 picks (b) and `legacyIntent` is rarely set, the code path is harmless and re-activates if FEAT070 changes the design.
   (b) **Simplify by removing the speculative structural-disagreement-warn.** That warn (`router.ts:390-410`) only made sense when the structural matcher was about to run; with structural deleted, the warn is dead branch.
   (c) **Delete the entire triage_hint step.** Embedding is now the single source of truth. PM proposal: (b) for this FEAT — keep triage_hint, delete the structural-disagreement-warn block. Architect confirms.

3. **Calibration corpus: where does it live and who owns it?** PM proposal: gitignored `scripts/scratch/calibrate-routing.ts` for v1; the corpus phrases are inlined in the script. The published cliff visualization and chosen threshold values live in `FEAT069_test-results.md` (committed). Re-calibration is a future task (Story 3 AC last bullet). Architect confirms or proposes a different location (e.g., a committed but-stripped `tests/fixtures/routing-corpus.json` if shareable).

4. **Should `TriageResult.fastPath` and `TriageResult.legacyIntent` fields be deleted from the type?** `fastPath` is unambiguously dead after Story 1; PM proposes delete. `legacyIntent` depends on Open Q1: if (a), keep; if (b), keep but always undefined (deprecated); if delete, audit `MODEL_BY_INTENT`, `chat.tsx`, and `v4Gate.ts` for consumers. Architect picks a coordinated answer.

5. **`HIGH_THRESHOLD` tuning scope.** Calibration may show 0.80 is too high (correct routes scoring 0.65-0.75 hit the Haiku tiebreaker unnecessarily) or fine. PM proposal: in scope to lower if data demands; not in scope to raise. Architect decides what counts as "data demands" — e.g., a histogram showing > 30% of correct routes between 0.65 and 0.80 would justify lowering.

6. **Skill description enrichment quality bar.** PM proposed 6-12 phrasings per skill in Story 4. Architect / coder may want a sharper bar: "every Story-3 corpus phrase tagged for skill X scores top-1 against skill X" (PM's stated AC) is the testable bar. If a corpus phrase fails, the description is iterated until it passes. This can drift into prompt-engineering — set a time budget (architect picks; PM suggests 2 hours per skill, 16 hours total).

7. **Backward compat for `structuralTriggers` field.** Already in "Out of Scope" — PM proposes leave as-is. Architect confirms; if architect decides to delete the field from manifests now to keep the diff coherent, update `SkillManifest` type, the loader, the bundle codegen, and all eight manifest JSON files. Larger diff, same architectural outcome.

8. **`info_lookup` graceful fallback prompt — is the disclaimer phrasing fixed or LLM-discretionary?** PM proposal: fix the disclaimer template ("I don't have personal notes about X, but in general, …") so it is greppable in tests. LLM-discretionary disclaimers risk hallucinated answers without the disclaimer. Architect picks; if discretionary, Story 6 assertion 5 needs a softer test (e.g., regex match against several plausible disclaimer patterns).

---

## References

- **User-reported failures:** today's chat session — phrase 1: "what is my plan today?" routed to `general_assistant`; phrase 2: "what is chiefcalrity?" routed to `general_assistant`.
- **Triage regex fast-path (deletion target):** `src/modules/triage.ts` `FAST_PATH_MAP` (lines 182-225), `tryFastPath` (lines 227-245), call site at `runTriage` (lines 256-260).
- **v4 router structural matcher (deletion target):** `src/modules/router.ts` `routeToSkillInternal` Step 1 (lines ~421-446); speculative structural-match-for-disagreement-warn block within Step 1a (lines ~390-410).
- **Threshold magic numbers (calibration target):** `src/modules/router.ts` `HIGH_THRESHOLD = 0.80` (line 228), `GAP_THRESHOLD = 0.15` (line 230), `FALLBACK_THRESHOLD = 0.40` (line 232).
- **Skill manifests (description enrichment target):** `src/skills/calendar_management/manifest.json`, `src/skills/emotional_checkin/manifest.json`, `src/skills/general_assistant/manifest.json`, `src/skills/inbox_triage/manifest.json`, `src/skills/info_lookup/manifest.json`, `src/skills/notes_capture/manifest.json`, `src/skills/priority_planning/manifest.json`, `src/skills/task_management/manifest.json`.
- **Skill bundle codegen (must regenerate after Story 4):** `scripts/bundle-skills.ts` (FEAT064), output at `src/skills/_generated/skillBundle.ts`. Determinism test: `src/modules/skillBundle.test.ts:197-260`.
- **Embedder (calibration script consumer, FEAT067 isomorphic):** `src/modules/embeddings/provider.ts` — `embed`, `embedBatch`, `MODEL_ID = "Xenova/all-MiniLM-L6-v2"`, 384-dim.
- **Embedding consumer in router:** `src/modules/router.ts` `routeToSkillInternal` Step 2 (lines ~448-462), `findSkillsByEmbedding` in `src/modules/skillRegistry.ts`.
- **`info_lookup` skill (Story 5 prompt edit target):** `src/skills/info_lookup/` (manifest at `manifest.json`, `retrievalHook` `minScoreInclude: 0.40`).
- **FEAT066 triage_hint primary signal:** `src/modules/router.ts` `TRIAGE_INTENT_TO_SKILL` (lines 254-271), Step 1a `routeToSkillInternal` (lines 371-419), `_resetTriageHintWarnCacheForTests` (line 280). Spec at `packages/feature-kit/features/v2.02/FEAT066_*/`.
- **FEAT067 embeddings on web (this FEAT's substrate):** `packages/feature-kit/features/v2.02/FEAT067_Enable_embeddings_on_web_bundle/`. Locked API: `embed`, `embedBatch`, `isModelLoaded`, `MODEL_ID`.
- **FEAT068 RAG-based info_lookup:** `packages/feature-kit/features/v2.02/FEAT068_RAGbased_infolookup_skill/`. Provides the retrieval pipeline this FEAT's Story 5 sits on top of.
- **FEAT051 router algorithm (origin of HIGH/GAP/FALLBACK thresholds):** `packages/feature-kit/features/v2.01/FEAT051_*/` — design review documents the original guessed values.
- **FEAT054 skill registry (`descriptionEmbedding` field):** `src/types/skills.ts` lines 150-164.
- **FEAT064 web bundle / determinism:** `src/skills/_generated/skillBundle.ts`, `src/modules/skillBundle.test.ts`.
- **v4 gate:** `src/modules/v4Gate.ts`, `src/modules/v4Gate.test.ts:94-119` (asserts `legacyIntent` is ignored — must still hold post-FEAT).
- **Chat surface plumbing of `triage.legacyIntent`:** `app/(tabs)/chat.tsx`.
- **Request flow doc (architect updates Section TBD):** `docs/v4/01_request_flow.md`.
- **Architecture doc (mandatory update per CLAUDE.md):** `docs/new_architecture_typescript.md` — Section 6 (Module Responsibilities — triage no longer classifies intent; router has 3-step ladder), Section 9 (ADR — regex/structural retirement, calibrated thresholds), Section 12 (Feature Catalog — FEAT069 entry).
- **README (mandatory update per CLAUDE.md):** `README.md` — if any user-visible behavior change is described, update accordingly. Likely no README update needed since this is internal architecture.

---

## Architecture Notes (added stage 3 — see `FEAT069_design-review.md` for full review)

**Decisions on the 8 open questions:**

1. **Triage's intent classifier — KEEP HAIKU (PM proposal accepted).** Triage retains its Haiku call for the v3 legacy chain's `legacyIntent` feed and for emotional/source/complexity/clarification responsibilities. Triage no longer decides skill routing — FEAT066 already moved that to the v4 router's Step 1a. No embedding-in-triage; that would duplicate router Step 2 work for zero benefit.
2. **FEAT066 triage_hint code path — SIMPLIFY (PM proposal accepted).** Keep Step 1a (intent → skill mapping). Delete the speculative structural-disagreement-warn block (`router.ts:388-410`) — with Step 1 (structural matcher) gone, there is nothing to disagree with.
3. **Calibration corpus location — GITIGNORED `scripts/scratch/calibrate-routing.ts`** (PM proposal accepted). Phrases inlined in the script. The chosen threshold + score-distribution table + cliff visualization live in committed `FEAT069_test-results.md`. Re-calibration is manual; automated drift handling is a future FEAT.
4. **`TriageResult.fastPath` — DELETE.** It is only set inside the regex path being deleted; no live consumer survives Story 1. **`TriageResult.legacyIntent` — KEEP** (still produced by the Haiku call, still consumed by the legacy v3 chain via `MODEL_BY_INTENT` and by FEAT066's Step 1a). Deleting it is FEAT070's scope.
5. **`HIGH_THRESHOLD` tuning — IN SCOPE TO LOWER IF DATA DEMANDS** (PM proposal accepted). Calibration may show that 0.80 forces the Haiku tiebreaker on phrases that score 0.65–0.75. Lowering is allowed; raising is out of scope. The chosen value is documented with the cliff visualization.
6. **Skill description enrichment quality bar — REFINED.** "Every Story-3 corpus phrase tagged for skill X scores top-1 against skill X **OR within 0.05 of the top-1 winner with the correct skill in the top-2**." This admits natural ambiguity that the Haiku tiebreaker can resolve. Iteration budget is bounded — if 3+ rewrite rounds cannot crack a phrase, that phrase is a triage_hint candidate or a real cross-skill ambiguity, not a description bug.
7. **`structuralTriggers` field on manifests — KEEP** (PM proposal accepted). Removing them is mechanical cleanup with no logic change; defer to a follow-up cleanup FEAT to keep this PR's diff small. The router no longer reads them; the loader continues to accept them.
8. **`info_lookup` graceful fallback disclaimer — FIXED TEMPLATE** (PM proposal accepted). Locked phrasing: `"I don't have personal notes about <topic>, but in general:\n\n<general-knowledge answer>"`. Greppable in smoke tests; consistent UX. The colon + double newline is a load-bearing visual separator the smoke phrase 4 assertion checks for.

**Audit verification of PM's 6 technical claims (all CORRECT):**

- `tryFastPath` is called ONLY at `runTriage:256` — verified by Grep (only the function definition at `triage.ts:227` and the call site at `triage.ts:256` exist).
- `legacyIntent` is consumed by ~20 files including `MODEL_BY_INTENT`, `chat.tsx`, `v4Gate.test.ts`, `router.test.ts`, `rag.test.ts`, multiple feature-kit docs — deletion is unsafe in this FEAT (matches PM claim).
- `v4Gate.test.ts:94-119` asserts the gate IGNORES legacyIntent — verified verbatim ("triage's legacyIntent is IGNORED — gate trusts the orchestrator instead", `result === true` even with `triageLegacyIntent: "task_create"`).
- FEAT066 disagreement-warn at `router.ts:388-410` becomes dead code after Step 1 deletion — verified by reading the block; the structural lookup it performs is identical to the deletion target. The warn cannot fire if Step 1 cannot fire.
- `descriptionEmbedding` is the only embedded surface — verified via Grep on `skillBundle.ts`. No `triggerPhrasesEmbedding` exists. (Implication: enriching `description` is the only lever for shifting top-1 cosine scores. `triggerPhrases` is consumed only by the Haiku tiebreaker prompt at `router.ts:608-617`.)
- `info_lookup` already has `retrievalHook.minScoreInclude: 0.40` — verified at `src/skills/info_lookup/manifest.json:33`.

**Calibration corpus design (architect locks):**

- **Per-skill canonical phrases** — 6 per migrated skill × 8 skills = 48 phrases. Per-skill examples below; coder finalizes verbatim wording during stage 5:
  - `priority_planning`: "what should I focus on today", "what is my plan today", "plan my day", "what's on my agenda", "help me prioritize", "where should I start"
  - `task_management`: "add a task to call the dentist", "remind me to follow up", "show my open tasks", "mark Task A done", "set priority on the followup task", "delete the cancelled task"
  - `calendar_management`: "schedule a meeting tomorrow at 3pm", "what's on my calendar this week", "am I free Friday morning", "reschedule the standup", "cancel Tuesday's meeting", "block off time for deep work"
  - `notes_capture`: "save this idea: [Topic X] needs a kickoff doc", "add a note about Project Alpha", "remember this", "jot down: review architecture", "write this down", "capture this thought"
  - `inbox_triage`: "process my inbox", "here's a brain dump", "log all of these at once", "process this batch"
  - `emotional_checkin`: "I'm feeling stressed", "feeling overwhelmed", "tough day", "rough day", "I'm exhausted", "venting"
  - `info_lookup`: "what is Project Alpha", "tell me about Topic X", "what do you know about the kickoff doc", "any info on Contact A", "summarize what I know about Project Alpha", "what was that thing about Topic X"
  - `general_assistant`: "tell me a joke", "how are you", "what can you do", "thanks", "haha", "explain how the assistant works"
- **Generic conversational** (8 phrases) — should land on `general_assistant`: "tell me a joke", "what's up", "how are you doing today", "thanks", "haha that's funny", "what can you do for me", "explain", "help me understand"
- **Knowledge questions for info_lookup** (10 phrases) — split:
  - Personal-data hooks (5): "what is Project Alpha", "tell me about Topic X", "who is Contact A", "any info on the kickoff doc", "what was that thing about Project Alpha"
  - General-knowledge (5): "what is the capital of France", "what is React", "how does photosynthesis work", "explain quantum entanglement briefly", "what is a closure in JavaScript"
- **Out-of-distribution noise** (5) — expected fallback: "asdfghjkl", "...", "🤔" (single emoji), "ok", "yes"
- **Typo variants** (3) — embedder robustness: "what is chiefcalrity" (the user-reported typo), "addd a tassk", "schedule a meting"
- **Total: 48 + 8 + 10 + 5 + 3 = 74 phrases.** Inside PM's 50–80 envelope. Each phrase carries an `expected_skill` label; out-of-distribution phrases carry `expected_skill: "<fallback>"`.

**Files touched (architect's prediction — coder confirms):**

- DELETE-ish: `src/modules/triage.ts` (FAST_PATH_MAP, tryFastPath, fastPath field on TriageResult, fast-path call in runTriage).
- DELETE: `src/modules/router.ts` Step 1 structural matcher block (`router.ts:421-446`); FEAT066 speculative structural-match-for-disagreement-warn block (`router.ts:388-410`).
- EDIT: 8 manifests' `description` fields. Re-run `npm run bundle:skills`; commit regenerated `src/skills/_generated/skillBundle.ts`.
- EDIT: `src/skills/info_lookup/prompt.md` — add general-knowledge fallback section per Story 5 with the locked disclaimer template.
- EDIT: `src/modules/router.ts` — set new `HIGH_THRESHOLD` and `FALLBACK_THRESHOLD` constants per calibration data.
- EDIT: `src/modules/router.test.ts` — remove/replace the structural-trigger Story 2 tests (`AC 2.1: '/plan' phrase → 'structural'`, FEAT066 disagreement test); keep `directSkillId` tests (Step 0 unchanged).
- ADD: `scripts/scratch/calibrate-routing.ts` (gitignored).
- ADD: `scripts/scratch/smoke-feat069.ts` (gitignored — binding 10-phrase smoke).
- DOCS: `docs/new_architecture_typescript.md` Section 6 (router ladder), Section 9 (ADR), Section 12 (FEAT069 entry); `FEAT069_test-results.md` (cliff + thresholds + smoke output).

---

**Coder pay-extra-attention (architect refines from PM placeholder):**

- **Decision 6's 0.05 admission band IS DELIBERATE.** Do not iterate descriptions until every phrase scores top-1 outright if a tight 2-skill cluster appears (e.g., "what is my plan today" close between `priority_planning` and `general_assistant`). The Haiku tiebreaker is the design-intended resolver for tight clusters.
- **Calibration corpus is ~74 phrases — not 50, not 80.** Run all 74. Publish all 74 in the score table. Pick the threshold from data, not folklore.
- **The two user-reported failures (smoke phrase 1: "what is my plan today" → priority_planning; smoke phrase 2: "what is chiefclarity" → info_lookup) MUST PASS the smoke.** They are not in the tolerated 2-of-10 nondeterminism pool.
- **The fixed-template disclaimer is GREPPABLE.** Story 5's prompt edit must produce the exact phrase `"I don't have personal notes about"` for any general-knowledge answer. Smoke phrase 4 ("what is the capital of France") asserts a regex match on that literal substring + the answer ("Paris" or equivalent).
- **Re-run `npm run bundle:skills` after every description edit.** The FEAT064 byte-equality determinism test (`skillBundle.test.ts:197-260`) must pass on a no-source-change second run. If you commit a manifest edit without re-bundling, the determinism test fails and code review bounces.
- **Slash command UX must not regress.** Verify before deleting: chat surface parses `/skillId` slugs and sets `directSkillId` directly on `routeToSkill` input (Step 0). Removing the structural matcher does NOT remove `/skillId` parsing — that's a chat.tsx concern, not a router concern.
- **`legacyIntent` consumers are scattered.** Search before deleting: `MODEL_BY_INTENT`, `v4Gate.ts`, `chat.tsx`, every `*.test.ts`. Decision 4 is "keep `legacyIntent`, delete only `fastPath`" — if you find yourself deleting `legacyIntent` references, STOP and confer.
- **Re-run `router.test.ts` after deleting Step 1.** Story 2 of the existing tests (`AC 2.1`, `AC 2.2`) and the FEAT066 "disagreement-warn fires" test will fail; rewrite them to assert the new ladder. Specifically: `AC 2.1: '/plan today' phrase → 'structural'` becomes either deleted (if `/plan` is now caller-side `directSkillId` parsing) or rewritten as a `directSkillId: "priority_planning"` test. The FEAT066 "triage hint disagrees with structural → triage wins, disagreement-warn fires" test is deleted entirely.
- **No real user data in the calibration corpus or smoke phrases.** "Project Alpha", "Topic X", "Contact A", "Task A" are the allowed placeholders. The user-reported failure phrases ("what is my plan today", "what is chiefclarity") are explicitly allowed because they contain no personal data and "ChiefClarity" is the project name.

---

**Coder pay-extra-attention (PM placeholder, architect to refine):**

- **Story 3 calibration is the load-bearing piece.** Do not pick a threshold by guessing or by copy-pasting from a prior FEAT. Run the corpus, read the cliff, set the value where the cliff is. Document the cliff visualization in `FEAT069_test-results.md`.
- **Story 4 description enrichment must be re-verified against the calibration corpus.** Iterate descriptions until every Story-3 phrase tagged for skill X scores top-1 against skill X. If you cannot get a phrase to score top-1 with reasonable description prose, surface it — the answer may be that two skills genuinely overlap on that phrasing and the Haiku tiebreaker should resolve it.
- **The two user-reported failure phrases (#1 and #2 in the smoke set) are MUST-PASS.** They are not in the tolerated-2-of-10 LLM nondeterminism pool. If either fails on a smoke run, do not merge.
- **Re-run `npm run bundle:skills` after every description edit.** The FEAT064 byte-equality determinism test must still pass on a no-source-change second run.
- **`legacyIntent` consumers are not all in this FEAT's diff.** Search before deleting: `MODEL_BY_INTENT` (assembler), `v4Gate.ts`, `chat.tsx`, every `*.test.ts` that mentions `legacyIntent`. Open Q1 dictates whether you delete or keep; either way, audit consumers first.
- **Slash command UX must not regress.** If `chat.tsx` parses `/skillId` slugs and sets `directSkillId` directly on the route input, the structural matcher deletion is invisible to users. Verify before deleting.
- **No real user data in the calibration corpus.** Use generic placeholders: "Project Alpha", "Contact A", "Topic X". The two user-reported failure phrases ("what is my plan today", "what is chiefclarity") are explicitly allowed because (a) the first contains no personal data, and (b) "ChiefClarity" is the project name, allowed by the OSS-attribution exception.
