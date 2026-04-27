# FEAT062 — Fix executor applyAdd array-loop to include notes

**Type:** bug-fix
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up)
**MoSCoW:** MUST
**Category:** Architecture / Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** executor, bug-fix, notes, v4-chat-path
**Created:** 2026-04-27

**Depends on:** FEAT061 (Done — dispatcher now forwards state to handler ctx)
**Unblocks:** FEAT044 (Capacitor) end-to-end chat-write smoke for `notes_capture` and the notes-bearing chunks of `inbox_triage`.

---

## Problem Statement

`src/modules/executor.ts:591` (inside `applyAdd`) iterates a fixed array-key list to find which sub-array of a file slice to push the new record onto:

```ts
const target = (state as any)[fileKey];
for (const listKey of ["tasks", "events", "items", "suggestions"] as const) {
  if (Array.isArray(target?.[listKey])) {
    if (target[listKey].length >= MAX_ARRAY_ITEMS) { ... }
    target[listKey].push(d);
    return;
  }
}
Object.assign(target, d);
```

`NotesFile` (`src/types/index.ts:234-237`) is shaped `{ _summary: string; notes: Note[] }`. The array key is `"notes"`, which is **not in the loop list**. When the executor processes a `{ file: "notes", action: "add" }` write, the loop falls through and `Object.assign(target, d)` runs at line 601, which overwrites top-level fields on the `NotesFile` slice instead of appending a `Note` to `state.notes.notes`.

---

## Impact

Silent data loss for chat-driven notes. With FEAT061 landed, the v4 dispatcher → handler → `applyWrites` path is fully wired for `notes_capture` and `inbox_triage` — the handler returns `success=true` and the user sees a confirmation reply ("I saved that for you"), but the executor drops the note at the array-loop. The note never appears in the notes UI. The same gap affects `inbox_triage` chunks that include `notes` writes alongside tasks / events (the task and event persist; the note silently disappears). The bug has not yet surfaced to the user because v4 is gated to Node-only via `shouldTryV4` and FEAT044 (Capacitor) has not shipped — once mobile chat-write lands, this becomes a user-visible "I saved that for you but it isn't there" failure for every chat-driven note. Discovered during FEAT061 testing — see FEAT061_test-results.md, "Executor latent bug for `notes` (confirmed; recommend FEAT062)".

---

## User Stories

### Story 1 — Add `"notes"` to the executor `applyAdd` array-loop

**As a** v4 chat-write user, **I want** the executor's `applyAdd` to recognize `"notes"` as the inner-array key on the `notes` file slice, **so that** chat-driven note creates actually persist to `state.notes.notes` instead of overwriting the file shape.

**Acceptance Criteria:**
- [ ] `src/modules/executor.ts:591` array-key list changes from `["tasks", "events", "items", "suggestions"]` to `["tasks", "events", "items", "suggestions", "notes"]`. Single-line edit.
- [ ] No other change in `executor.ts`. The fall-through `Object.assign(target, d)` at line 601 stays as the catch-all for non-array file slices (e.g. `userProfile`, `userLifestyle`).
- [ ] `MAX_ARRAY_ITEMS` cap behavior applies uniformly to the new `"notes"` entry — no special-case branch.

### Story 2 — Regression test for `applyAdd` with `file: "notes"`

**As a** developer, **I want** a direct unit test that a `{ file: "notes", action: "add", ... }` write appends to `state.notes.notes`, **so that** a future regression of the array-key loop fails loudly at the executor level (not at the handler-level smoke tests).

**Acceptance Criteria:**
- [ ] One new test asserts: starting with `state.notes = { _summary: "", notes: [] }`, calling the executor's add path with `{ file: "notes", action: "add", data: { text: "Test note A", ... } }` results in `state.notes.notes.length === 1` and the appended record's `text` field matches the input.
- [ ] Test location: PM proposes a new `src/modules/executor.test.ts` for separation of concerns (no executor-level test file exists today — verified via `Glob src/modules/executor*.test.ts`). Architect may instead place the test under an "Executor compatibility" section of `src/modules/notes_capture.test.ts`. See Open Question 1.
- [ ] Test invokes `applyWrites` (the public surface) rather than `applyAdd` directly, so the assertion exercises the same code path that the v4 handlers use.
- [ ] Test does not depend on any LLM stub, dispatcher, or handler — it is a pure executor-level assertion.

### Story 3 — Tighten the two FEAT061 Story-2 dispatcher tests from post-flush signal to direct array-length assertion

**As a** developer reading the test suite, **I want** the FEAT061 Story-2 tests for `notes_capture` and `inbox_triage` to assert `state.notes.notes.length === 1` directly, **so that** the test name ("dispatchSkill forwards state to handler ctx → fixture state mutated") matches the assertion and the post-flush `_loadedCounts` workaround (introduced because of this exact bug) goes away.

**Acceptance Criteria:**
- [ ] `src/modules/notes_capture.test.ts:315` — replace `assert.ok("notes" in state._loadedCounts, ...)` with `assert.strictEqual(state.notes.notes.length, 1, ...)` plus a content check on the appended note's `text` field.
- [ ] `src/modules/inbox_triage.test.ts:612` — same replacement. The neighboring `state.tasks.tasks.length === 1` and `state.calendar.events.length === 1` assertions are unchanged.
- [ ] Remove the inline comments in both test files that reference the executor's missing-`notes` array-loop and the `_loadedCounts` post-flush workaround (e.g. `notes_capture.test.ts:285-292` and `inbox_triage.test.ts:579-584`). Those notes describe a bug that no longer exists post-FEAT062.
- [ ] No other change to either test file — the existing dispatcher fixture, stub LLM, and route construction are unchanged.

### Story 4 — No regression elsewhere

**Acceptance Criteria:**
- [ ] All existing tests pass (377/377 baseline from FEAT061, plus the +1 from Story 2 = 378/378).
- [ ] `npm run build:web` exports cleanly.
- [ ] `tsc --noEmit` is clean (only the pre-existing `executor.ts:229` warning).
- [ ] No change to any handler file, dispatcher, type definitions, or non-executor module.

---

## Out of Scope

- **Refactor of executor's per-file branches into a registry.** The array-loop pattern itself is brittle (any future file slice with a non-listed inner-array key has the same bug). PM's position: do not refactor in this FEAT — fix only the symptom for `notes`. A registry-shaped refactor is its own design discussion. See Open Question 2.
- **FEAT044 Capacitor work.** This bug is a pre-condition for Capacitor mobile smoke of chat-driven notes; the Capacitor plumbing itself is unrelated.
- **AGENTS.md / `docs/new_architecture_typescript.md` updates** carried from the FEAT057-060 docs cleanup backlog. Not this FEAT.
- **FEAT063 (emotional_checkin migration).** Independent of FEAT062.
- **The legacy `bulk_input` cleanup PR.** Same pattern, post-bake-in. Not this FEAT.
- **Adding new file types or new resolver keys.** No new context keys, no new file slices.

---

## Open Questions

1. **Where does the new Story-2 regression test live: a new `src/modules/executor.test.ts` file, or under an "Executor compatibility" section of `src/modules/notes_capture.test.ts`?** PM proposes a new `executor.test.ts` for separation of concerns — the assertion is at the executor layer, not the skill layer, and a future executor-only test (e.g. for `applyUpdate` on a new file shape) has a natural home. Architect may overrule if creating a new test file feels heavy for one assertion.
2. **Should the architect briefly audit the other `AppState` file shapes for similar missing-array-key gaps while we're here?** PM proposes NO — fix only `notes` in this FEAT to keep the diff one-line and the risk near zero. Other slices with array sub-keys today (`tasks.tasks`, `calendar.events`, `inbox.items`, `suggestions.suggestions` if it exists, `recurringTasks.recurring` — covered by its own branch above the array-loop) appear handled either by the loop or by an earlier targeted branch. If the architect wants the audit in scope, the spec gains a Story-1.5 with a checklist; if not, the audit is deferred or skipped.

---

## References

- **Discovery:** `packages/feature-kit/features/v2.02/FEAT061_Fix_v4_dispatcher_state_forwarding_to_handlers/FEAT061_test-results.md` — section "Executor latent bug for `notes` (confirmed; recommend FEAT062)".
- **Bug site:** `src/modules/executor.ts:591` (array-key loop in `applyAdd`).
- **Type confirming the missing key:** `src/types/index.ts:234-237` (`NotesFile`).
- **Tests to tighten:** `src/modules/notes_capture.test.ts:315` and `src/modules/inbox_triage.test.ts:612`.
- **Test file home (proposed):** new `src/modules/executor.test.ts` (none exists today — verified via `Glob src/modules/executor*.test.ts`).
- **Related FEATs:** FEAT058 (first notes-writing skill — surfaced the gap on the chat path), FEAT060 (multi-file write template that exposed the executor contract on `inbox_triage`), FEAT061 (dispatcher fix that activated the chat-write path and made this bug observable end-to-end).

---

## Architecture Notes

**Reviewer:** Architect agent — 2026-04-27. Full design review at `FEAT062_design-review.md`.

**Decisions on open questions:**

1. **Test home (Q1):** Fold under a new "Executor compatibility" section in `src/modules/notes_capture.test.ts`, not a new `executor.test.ts`. One assertion does not justify a new file; proximity to the v4 chat-write path it unblocks is more valuable than layer-purity. The test still calls the public `applyWrites` surface (no LLM stub, no dispatcher), so it is pure executor-level even though it lives in a skill test file. If a second executor-only test arrives later, hoist this assertion at that point.
2. **Audit scope (Q2):** Strictly fix `notes` per PM lean. Audit captured in §4 of the design review. The only other slices whose inner-array key is unlisted in the loop are `planAgenda.agenda` and `planRisks.risks` — both are computed/derived files with no LLM write path today, so the gap is latent-but-not-live. Adding loop entries for them would be dead code; flag them in the migration template instead so the FEAT that introduces an LLM write path for either includes the loop entry.

**Files touched (final list):**
- `src/modules/executor.ts:591` — append `"notes"` to the loop list (1-line production change).
- `src/modules/notes_capture.test.ts` — add "Executor compatibility" section with the Story-2 regression test; tighten Story-3 assertion at line 315 from `_loadedCounts` signal to direct length+content; remove obsolete comment block at 285-292.
- `src/modules/inbox_triage.test.ts` — tighten Story-3 assertion at line 612 the same way; remove obsolete comment block at 579-584.

**Risks:** see design review §5. Three rows; all Low-likelihood.

**No new patterns introduced.** This is the smallest correct fix. A registry-shaped refactor of `applyAdd`'s per-file branches is its own design discussion if the array-loop pattern recurs.
