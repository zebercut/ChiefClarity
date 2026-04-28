# FEAT066 — Code Review

**Reviewer:** Code Reviewer agent
**Date:** 2026-04-27
**Spec:** `FEAT066_Use_triages_intent_classification_as_primary_v4_routing_signal.md`
**Design review:** `FEAT066_design-review.md` (14 binding conditions)
**Precedent:** `FEAT065_*/FEAT065_code-review.md`

---

## 1. Verdict

**APPROVED — auto-advances to tester.**

Pure plumbing fix in the canonical FEAT061 shape. One additive `RouteInput`
field, one new `RoutingMethod` literal, one static map, one short-circuit
step in `routeToSkill`, one chat-surface call-site widening. All 14
design-review conditions are satisfied (condition 13 docs and AGENTS.md
addendum deferred per project carry-forward pattern). Stub-LLM unit suite
passes 32/32 in `router.test.ts` (10 new FEAT066 cases), 449/449 overall.
The **load-bearing** artifact — the embedder-disabled real-LLM smoke
(condition 10) — is BINDING and runs in stage 6 (tester).

---

## 2. Files reviewed (line-by-line `git diff`)

| File | Lines | Notes |
|---|---|---|
| `src/types/orchestrator.ts` | +12 / -6 | Added `triageLegacyIntent?: IntentType`, added `"triage_hint"` literal between `"haiku"` and `"fallback"`. Type-only import of `IntentType` from `./index`. Clean additive change. |
| `src/types/index.ts` | +1 / -1 | `ChatMessage.v4Meta.routingMethod` duplicate union widened to include `"triage_hint"`. **Out-of-scope per architect callout 4 — adjudicated below in §4.** |
| `src/modules/router.ts` | +101 / 0 | `TRIAGE_INTENT_TO_SKILL` map, `_triageHintMissingWarnCache`, `_resetTriageHintWarnCacheForTests`, Step 1a (40 lines including disagreement-warn). Header doc-comment updated to list Step 1a in the ladder summary. |
| `app/(tabs)/chat.tsx` | +4 / -1 | One-line widening of the `routeToSkill` call: now passes `triageLegacyIntent: triage.legacyIntent ?? undefined`. |
| `src/modules/router.test.ts` | +326 / 0 | 10 new tests under `FEAT066 — Triage hint as primary routing signal` section. |
| `scripts/scratch/smoke-feat066.ts` | new (untracked, gitignored) | 11-phrase live-LLM smoke; embedder forced null per call. **Not committed**, per repo policy. |

Untracked feature folder (FEAT066 spec/DR/this review) is expected.

---

## 3. §14 conditions audit

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | `RouteInput` widens additively | **Y** | `orchestrator.ts:47-53` adds `triageLegacyIntent?: IntentType` after `directSkillId?`. Field is optional; existing call sites compile unchanged. |
| 2 | `RoutingMethod` adds `"triage_hint"` second-to-last | **Y** | `orchestrator.ts:12-19` — literal placed between `"haiku"` and `"fallback"` exactly as required. |
| 3 | `TRIAGE_INTENT_TO_SKILL` const | **Y** | `router.ts:254-271`. All required entries present; `okr_update`/`topic_query`/`topic_note` absent. `bulk_input` carries the one-line forward-compat comment per architect callout 4. Exported and consumed by tests. |
| 4 | Step 1a between Step 0 and Step 1 | **Y** | `router.ts:367-418`. Sits after the `directSkillId` block (line 348-363) and before Step 1 structural (line 420). Verified by the dedicated test "directSkillId beats triage hint (Step 0 still wins)". |
| 5 | Disagreement-warn telemetry | **Y** | `router.ts:387-409`. Speculative structural match uses **identical** token rules to Step 1 (`firstToken.toLowerCase().replace(/[^a-z0-9_-]+$/u, "")`). Warn fires when exactly one structural match exists AND its skill differs from triage's pick. Pure read — no state mutation (verified by inspection: only `console.warn`, no Set/Map writes). |
| 6 | Silent fall-through when mapped skill is in registry but disabled | **Y** | `router.ts:384-385` — empty `else if` branch with comment-only body. No `console.*` output. Verified by `disabled skill silently falls through (no warn)` test. |
| 7 | Warn-once when mapped skill NOT in registry | **Y** | `router.ts:374-383` — `_triageHintMissingWarnCache` Set, first-miss-only warn, `_resetTriageHintWarnCacheForTests` exported helper. Verified by 3 tests covering first-warn, second-call-no-warn, and reset-restores-warn paths. |
| 8 | `chat.tsx` passes the hint | **Y** | `app/(tabs)/chat.tsx:401-404` — exact form from spec. No other chat-surface logic changed. |
| 9 | Unit tests (a)–(f) | **Y** | All six required cases plus four bonus tests (per-intent loop covering 6 live intents, warn-cache reset behavior, omitted-intent assertions, `directSkillId` precedence). 10 new tests total, all green. |
| 10 | BINDING real-LLM smoke | **DEFERRED to tester** | `scripts/scratch/smoke-feat066.ts` exists, gitignored, exits 2 gracefully when `ANTHROPIC_API_KEY` or `DATA_FOLDER_PATH` missing (lines 183-190). Forces `embedder: async () => null` per call (line 129). Hits all 7 enabled v4 skills, asserts `routingMethod === "triage_hint"` and `skillId === expected` and `dispatchResult.userMessage` non-empty. Tester runs in stage 6. |
| 11 | Existing tests pass unchanged | **Y** | `node scripts/run-tests.js` → 449/449 across 20 suites. |
| 12 | `tsc --noEmit` clean other than pre-existing | **Y** | Only `executor.ts:229` (pre-existing). `npm run build:web` exits 0 — exports 9 files cleanly. |
| 13 | `docs/new_architecture_typescript.md` updated | **N — deferred** | Per project carry-forward pattern. Not blocking. |
| 14 | Zero changes to triage/registry/dispatcher/v4Gate/executor/assembler/skill manifests | **Y** | `git diff --stat` confirms only `chat.tsx`, `router.ts`, `orchestrator.ts`, `index.ts`, `router.test.ts` and the gitignored smoke. No skill folders, no `triage.ts`, no `skillRegistry.ts`, no `skillDispatcher.ts`, no `v4Gate.ts`, no `executor.ts`, no `assembler.ts`. |

**13/14 satisfied. Condition 13 (docs) deferred per project carry-forward
pattern; condition 10 advances to tester as designed.**

---

## 4. Adjudication of `src/types/index.ts` widening

**Decision: ACCEPT (Option A).**

The `ChatMessage.v4Meta.routingMethod` field at `src/types/index.ts:583`
is a **structurally-duplicated copy** of the `RoutingMethod` union — same
literals, narrower position. Without widening it, `chat.tsx` cannot assign
`routeResult.routingMethod` (now of type `RoutingMethod` widened to include
`"triage_hint"`) to `v4Meta.routingMethod` (frozen at the old 5-literal
union). The compile error is real, not hypothetical.

The architect's "STRICTLY LOCAL changes" callout 4 was written to prevent
unrelated edits to triage/registry/dispatcher/etc. The duplicate-union
widening is **the same conceptual field** — a one-character extension to
keep two copies of an enumeration in sync. Forcing a type cast in
`chat.tsx` to preserve the file boundary would push a latent inconsistency
into production code instead of types.

**Forward action (carry-forward, not blocking):** the right long-term fix
is to replace the duplicate inline union at `index.ts:583` with
`RoutingMethod` imported from `./orchestrator`. That cleanup belongs to a
future docs/types-hygiene FEAT, not FEAT066.

---

## 5. Hardening exercise

**Strip `task_create: "task_management"` from `TRIAGE_INTENT_TO_SKILL` and
re-run the suite.**

Result: `router` suite reports `25 passed, 7 failed` (7 tests catch the
missing entry, including "task_create → task_management", the
per-intent-loop test, the disagreement-warn test, the directSkillId
precedence test, and others). Aggregate: `442/449 passed`.

**Restored** the entry; full suite returns to **449/449 passed**. The map
is genuinely load-bearing — coverage is real, not stubbed.

---

## 6. Code observations

- **Speculative structural match is read-only.** Lines 387-409 of
  `router.ts`: only operations are `String.prototype.split/trim/toLowerCase
  /replace`, `Array.prototype.filter/includes`, and `console.warn`. No
  writes to `_triageHintMissingWarnCache` or any other module-level state.
  The warn-once cache is touched **only** in the `!skill` branch above.
- **Token rules match exactly.** The speculative match's regex
  (`/[^a-z0-9_-]+$/u`) is byte-identical to Step 1's at line 429.
  Disagreement-warn cannot drift from real structural behavior.
- **Cache reset hygiene in tests.** All three tests that touch the
  unregistered-skill path call `_resetTriageHintWarnCacheForTests()` at
  setup (either directly or via `buildTriageHintFixture`). The
  reset-helper test itself asserts the reset clears state for
  re-firing the warn.
- **Smoke script crash-safety.** `scripts/scratch/smoke-feat066.ts` exits
  with code 2 (DEFERRED) when `ANTHROPIC_API_KEY` or `DATA_FOLDER_PATH` is
  missing; doesn't throw. Seeds the embedding cache file if absent so the
  registry loader doesn't try to download bge-m3.
- **No real user data anywhere** — verified by grep across `router.test.ts`,
  `smoke-feat066.ts`, and the FEAT066 markdown. Phrase fixtures use
  generic placeholders (`"Project Alpha"`, `"Contact A"`, `"placeholder
  doc"`) per repo policy.
- **No new top-level Node imports** in `router.ts`. The existing imports
  (`@anthropic-ai/sdk`, `../types`, `./llm`, `../types/orchestrator`,
  `./skillRegistry`, `../utils/fnv1a`) are unchanged. Web bundle remains
  green.
- **Bundle-skills is byte-equal across two consecutive runs.** SHA256:
  `68342f660cddc900a5a4397a6498fb3107d0034c008d11f7bc8a2b7c95935fb9`.
- **One small nit fixed in-review:** the `routeToSkill` doc comment at
  `router.ts:320-326` listed steps 0..5 without Step 1a. Updated the
  comment to include Step 1a so future readers see the new ladder.

---

## 7. Things NOT in scope (carry-forward)

- **`docs/new_architecture_typescript.md` updates** (condition 13) —
  deferred per project pattern.
- **AGENTS.md "Use upstream classification before redoing the work"
  pattern entry** (design-review §10) — deferred to next docs-cleanup PR.
- **`src/types/index.ts` duplicate-union cleanup** — replace
  `ChatMessage.v4Meta.routingMethod` inline union with
  `import { RoutingMethod }` from `./orchestrator`. Future types-hygiene
  FEAT.
- **Headless runner triage-hint plumbing** — out-of-scope per spec, future
  FEAT.
- **`okr_update` / `topic_query` / `topic_note` migrations** — each adds
  its own `TRIAGE_INTENT_TO_SKILL` entry as part of its own scope.
- **Real-LLM smoke run** (condition 10) — tester executes in stage 6.
  BINDING; if any of phrases 1–10 fails, do NOT mark Done.

---

## 8. Sign-off

Code reviewer approves. 13/14 conditions satisfied; condition 13 (docs)
deferred per carry-forward; condition 10 (real-LLM smoke) advances to
tester as the parity-defining artifact. Auto-advances to tester.

**For the tester:** see `scripts/scratch/smoke-feat066.ts`. Run with
`ANTHROPIC_API_KEY` and `DATA_FOLDER_PATH` set. Pass threshold is
**10/10 strict** on the required phrases (1–10); phrase 11 is optional.
Each phrase MUST exit `routeToSkill` with `routingMethod === "triage_hint"`
and `skillId === expected`, AND the dispatcher MUST return a non-empty
`userMessage` with no `degraded` flag and a `toolCall.name` declared by
the routed skill's manifest.
