# FEAT062 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT062_Fix_executor_applyAdd_arrayloop_to_include_notes.md`
**Refs:** FEAT058 (first notes-writing skill), FEAT060 (multi-file
write template touching `notes`), FEAT061 (dispatcher fix that
activated the chat-write path and made this bug observable),
`src/modules/executor.ts:591` (bug site),
`src/types/index.ts:234-237` (`NotesFile`).

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions. One-line
production change in `executor.ts:591`, plus tightening of the two
FEAT061 Story-2 tests that already document this gap as a known
defect. Total diff: ~1 line of production code, ~6 lines of test
churn (assertion swap + comment removal in two test files), 1 new
regression test.

---

## 2. Architecture

`applyAdd` in `executor.ts` is a chain of explicit per-file branches
(`recurringTasks`, `focusBrief`, `planOkrDashboard`, `userObservations`,
`userLifestyle`, `topicManifest`, `contextMemory`, `userProfile`),
followed at line 591 by an array-key fall-through loop that handles
the regular collection-shaped files by pushing onto the matching
inner array. Files that fall through both layers land in the
`Object.assign(target, d)` catch-all at line 601, which is correct
for object-shaped slices (`userProfile`, `userLifestyle`) but
silently corrupts collection-shaped slices whose inner-array key
isn't listed in the loop. `NotesFile.notes` is exactly that case.

---

## 3. Alternatives considered

### 3.1 Surgical fix vs registry refactor

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) Add `"notes"` to the loop list (CHOSEN)** | One-line production diff. Risk near zero. Matches the existing pattern. Behavior identical to `tasks`/`calendar`/`learningLog`/`suggestionsLog` — including the `MAX_ARRAY_ITEMS` cap. | The brittle pattern stays — any future collection-shaped file with a non-listed inner-array key has the same latent bug. | **CHOSEN** — bug-fix scope. Refactor is its own design. |
| (b) Refactor to a per-file `{fileKey → arrayKey}` registry | Pattern dies. Future file adds become a one-line registry entry. | Wider blast radius for a bug fix. Touches every existing branch shape. Needs its own design review. | Reject — out of scope. File a separate FEAT if the pattern recurs. |
| (c) Fix `notes` AND audit + fix all latent siblings now | Closes the class. | The audit (§4) found no other live gaps. Adding entries for theoretically-latent files (`planAgenda`, `planRisks`) without exercising tests would be speculative — and those files have no LLM write path today. | Reject — speculative. Document the audit; act if a sibling becomes live. |

### 3.2 Audit scope: strictly `notes` vs broader sweep

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Strictly `notes` (CHOSEN)** | Smallest correct change. Audit results documented for the next architect. | Latent-but-not-live siblings stay latent. | **CHOSEN** — see §4 audit table. No live siblings exist. |
| Broaden to `agenda`/`risks` | Closes two latent siblings. | No code path writes to `planAgenda` or `planRisks` via the LLM today (they are computed/derived, not LLM-emitted). Fix is unobservable, untestable, and would itself be dead code. | Reject. |

### 3.3 Test home: new `executor.test.ts` vs fold under `notes_capture.test.ts`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| New `src/modules/executor.test.ts` (PM proposal) | Separation of concerns — assertion is at the executor layer. Future executor-only tests have a natural home. | Heavy for one assertion. No other executor-only tests exist or are planned in v2.02. | Reject. |
| **Fold under "Executor compatibility" section in `notes_capture.test.ts` (CHOSEN)** | Proximity to the v4 chat-write path this unblocks. Reuses the existing fixture state and assertion style. The Story-3 tightening already lives there. One section, one story arc. | Slight category mix — executor assertion in a skill test file. | **CHOSEN** — the test invokes `applyWrites` (executor's public surface) without LLM stub or dispatcher, so it's still pure executor-level even though it lives in the skill test file. If a real second executor-only test arrives later, hoist this assertion at that point. |

---

## 4. Cross-feature concerns

- **FEAT058 (notes_capture):** shipped the first chat-driven note write
  path. Bug was inert because v4 was inert (FEAT061 unfixed at that
  point). After FEAT061+FEAT062, the path is live and persists.
- **FEAT060 (inbox_triage):** multi-file writes (tasks + events +
  notes). Tasks and events persist today; the notes line silently
  drops. This FEAT closes the gap for the chat-driven inbox path.
  The timer-driven `processBundle` path is unaffected — it builds
  `WriteOperation[]` and calls `applyWrites` directly, hitting the
  same `applyAdd` and benefiting from the same fix.
- **FEAT061 (dispatcher state forwarding):** activated the v4
  chat-write path and made this bug observable end-to-end. The
  FEAT061 Story-2 tests for `notes_capture` and `inbox_triage`
  carry inline comments and `_loadedCounts` workarounds that exist
  *only* because of this latent bug; both go away in Story 3.
- **FEAT044 (Capacitor):** unblocked. Once Capacitor flips off the
  legacy fallback, every chat-driven note would be silently dropped
  without this fix.
- **FEAT063+ (future skills writing to existing array-shaped files):**
  no action needed — the loop now covers all live collection slices.
  Skills writing to a *new* file shape still need their own branch
  or loop entry, same as today.

**Audit (Open Question 2):** enumerated every `AppState` slice and
classified its handling in `applyAdd`:

| Slice | Inner-array key | Handler | Risk? |
|---|---|---|---|
| `tasks` | `tasks` | loop | ok |
| `calendar` | `events` | loop | ok |
| `notes` | `notes` | **fall-through → bug** | **fix this FEAT** |
| `suggestionsLog` | `suggestions` | loop | ok |
| `learningLog` | `items` | loop | ok |
| `recurringTasks` | `recurring` | explicit branch | ok |
| `topicManifest` | n/a (action-routed) | explicit branch | ok |
| `contextMemory` | `facts`/`patterns`/`recentEvents` | explicit branch | ok |
| `planOkrDashboard` | `objectives` (nested) | explicit branch | ok |
| `userObservations` | `_arrayKey`-routed | explicit branch | ok |
| `userProfile` | n/a (object-merge) | explicit branch | ok |
| `userLifestyle` | n/a (object-merge) | explicit branch | ok |
| `focusBrief` | n/a (whole-file replace) | explicit branch | ok |
| `planAgenda` | `agenda` | fall-through (latent) | **no LLM write path; not live** |
| `planRisks` | `risks` | fall-through (latent) | **no LLM write path; not live** |
| `planNarrative` | n/a (string-only) | fall-through (object-merge correct) | ok |
| `hotContext`, `summaries`, `contentIndex`, `contradictionIndex`, `feedbackMemory` | various | not LLM-written | ok |

**Conclusion:** `notes` is the only live gap. `planAgenda` and
`planRisks` are theoretically the same class but have no LLM-driven
write path today (they are computed/derived). **Strict-fix-`notes`
recommendation stands;** the architect's audit is captured here so
the next architect doesn't redo the work. If a future FEAT introduces
an LLM write path to `planAgenda` or `planRisks`, that FEAT must
include the loop entry — flag it in the migration template.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The `MAX_ARRAY_ITEMS` cap silently blocks legitimate notes once the user accumulates many | Low | Low | Same cap applies to `tasks`/`calendar`/`learningLog` already; behavior is uniform and the warn-log is already in place at line 594. Notes are short-lived (processed → archived); the cap is unlikely to bite in practice. |
| Tightening the FEAT061 tests from `_loadedCounts` signal to direct length assertion masks a regression in `flush()` (e.g. `_loadedCounts.notes` stops getting set) | Low | Low | The direct assertion is *strictly stronger* than the post-flush signal — it requires both `flush()` ran AND the array got populated. If `flush()` regressed independently, the existing length assertions in `inbox_triage.test.ts:610-611` for tasks/events would catch it. |
| A skill writing notes via a path other than `applyAdd` (e.g. direct push) is uncovered | Very Low | Low | Confirmed via grep: `notes_capture/handlers.ts` and `inbox_triage/handlers.ts` both go through `applyWrites` → `applyAdd`. No direct-push path exists for `notes`. |

---

## 6. Conditions

1. **One-line production change.** `src/modules/executor.ts:591`
   loop list becomes
   `["tasks", "events", "items", "suggestions", "notes"] as const`.
   No other change in `executor.ts`.
2. **`MAX_ARRAY_ITEMS` cap behavior is uniform.** No special-case
   branch for `notes` — it shares the same cap-reached warn-log and
   skip behavior as the existing four entries.
3. **One Story-2 regression test under `notes_capture.test.ts`.**
   New section "Executor compatibility — applyAdd notes path".
   Builds a fixture state with `state.notes = { _summary: "", notes: [] }`,
   calls `applyWrites([{ file: "notes", action: "add", data: { text: "Test note A", status: "pending" } }], state)`,
   asserts `state.notes.notes.length === 1` and the appended record's
   `text` matches. No LLM stub, no dispatcher, no handler — pure
   executor-level assertion via the public `applyWrites` surface.
4. **Story-3 tightening — `notes_capture.test.ts:315`.** Replace
   `assert.ok("notes" in state._loadedCounts, ...)` with
   `assert.strictEqual(state.notes.notes.length, 1, ...)` plus a
   content check on the appended note's `text` field. Remove the
   inline comment block at lines 285-292 referencing the executor's
   missing-`notes` array-loop and the `_loadedCounts` workaround.
5. **Story-3 tightening — `inbox_triage.test.ts:612`.** Same
   assertion swap. Remove the inline comment block at lines 579-584.
   The neighboring `state.tasks.tasks.length === 1` and
   `state.calendar.events.length === 1` assertions stay.
6. **`tsc --noEmit` clean** (only the pre-existing `executor.ts:229`
   warning remains).
7. **No changes** to any handler file, dispatcher, type definitions,
   `assembler.ts`, `router.ts`, or any non-executor / non-test
   module. The diff is local to one production line and three test
   sites.

---

## 7. UX

**Zero changes.** The bug is silent data-loss on the chat-write
path; the fix makes notes persist. No prompt change, no chat
surface change, no copy change. The user experience flips from
"I saved that for you" + ghost-note to "I saved that for you" +
real persisted note.

---

## 8. Test strategy

**Story 2 — direct executor regression.** One new test in
`notes_capture.test.ts` "Executor compatibility" section, calling
`applyWrites` with `{ file: "notes", action: "add", ... }` and
asserting `state.notes.notes.length === 1` plus the `text` content.
This is the assertion that, run against today's executor, fails;
run against the patched executor, passes. It is the regression
guard for any future edit to the array-loop.

**Story 3 — dispatcher-level tightening.** Both FEAT061 Story-2
tests already exercise the chat-write path end-to-end with state
forwarded; the only reason they assert `_loadedCounts` instead of
array length is *this bug*. After the fix, the direct array-length
assertion is correct and matches the test name's claim
("fixture state mutated"). The tightening is mechanical — no new
test fixture, no new dispatcher invocation, just an assertion swap
and comment cleanup.

**Out of scope:** real-LLM smoke (this is a 1-line wiring fix);
performance; cross-skill integration (already covered by FEAT060
and FEAT061).

---

## 9. Pattern Learning

This is the **second** "v4 chat-write was dead → after fixing it,
we found another silent drop" follow-on after FEAT061. The
pattern: a write path gates on N stages (router → dispatcher →
handler ctx state → applyWrites → applyAdd → array-loop), and
each stage's bug masks the next stage's bug because nothing flows.
FEAT061 unblocked stages 1-4; FEAT062 closes stage 5. Both bugs
shipped because the test pyramid hadn't covered the
`dispatchSkill → handler → executor → state` end-to-end loop for
collection-shaped writes.

**Migration template suggestion (low-priority — roll into the
FEAT057-060 docs cleanup PR rather than this FEAT):** add a
"v4 chat-path end-to-end smoke" requirement to the stage-7 test
fixture for any new skill that emits collection-shaped writes:
the test must call `dispatchSkill` with state, run the LLM stub
to completion, and assert the target collection's `length` grew
by the expected amount — not a proxy signal like `_loadedCounts`.
A `length`-level assertion catches both stage-4 (state forwarding)
and stage-5 (array-loop) regressions in the same test. The
FEAT061 §9 entry already starts this thread; this FEAT is the
empirical evidence that the assertion choice (`length`, not
`_loadedCounts`) matters.

Don't be heavy-handed: this isn't a new template, just a one-line
clarification on what the existing template's "fixture state
mutated" assertion should look like for collection writes.

---

## 10. Sign-off

Architect approves. Conditions §6 binding (7 items). Coder may
proceed without further review — both open questions are decided
in §3 (test home: fold under `notes_capture.test.ts`; audit scope:
strict `notes`-only, with the audit table in §4 documenting the
two latent-but-not-live siblings for the next architect).

**Pay special attention to:**
- Condition 3 (the Story-2 regression test). It must call
  `applyWrites` (the public surface), not `applyAdd` directly —
  same code path the v4 handlers use. Calling `applyAdd`
  privately would not catch the array-loop bug because tests
  could be written against any version of that loop.
- Conditions 4 and 5 (the comment-block removals). The inline
  comments in `notes_capture.test.ts:285-292` and
  `inbox_triage.test.ts:579-584` describe a defect that no
  longer exists post-FEAT062. Leaving them in is misleading.
- The loop entry order doesn't matter for correctness, but
  appending `"notes"` at the end keeps the diff minimal and the
  pattern-match obvious.
- `planAgenda` and `planRisks` are NOT in scope (see §4 audit).
  Do not "helpfully" add them — they have no LLM write path,
  the entries would be dead code, and any future write path for
  them belongs in the FEAT that introduces it.
