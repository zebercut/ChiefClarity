# Test Results: FEAT061 — Fix v4 dispatcher state forwarding to handlers

**Tester:** Tester agent
**Date:** 2026-04-27
**Spec:** FEAT061
**Code Review:** FEAT061_code-review.md (APPROVED, zero fixes required)
**Test files (modified):** `src/modules/{task_management,notes_capture,calendar_management,inbox_triage}.test.ts` (one new Story-2 test per file)

---

## Gate Decision

**READY FOR DEPLOYMENT** — clean cycle. All 7 design-review conditions PASS. Reviewer's double-write concern investigated and disproven by static trace + Story-2 dispatcher assertions. Latent executor bug for `notes` confirmed real and recommended for FEAT062 (out-of-scope per condition 7).

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean (only pre-existing `executor.ts:229`) |
| `npm run build:web` | exports cleanly (7 bundles + 9 files) |
| `node scripts/run-tests.js` (run 1) | 377/377 |
| `node scripts/run-tests.js` (run 2) | 377/377 |
| `node scripts/run-tests.js` (run 3) | 377/377 |
| `git status --short` (post 3 runs) | only declared FEAT061 file edits; zero fixture leakage in repo root |
| Reviewer's double-write concern | **No regression** — handler is the sole writer on the v4 inbox path; `processBundle` only refreshes derived state. Evidence below. |
| Calendar recurring-rejection short-circuit (FEAT059 phrase 7) | PASS — strip + clarification still emits zero recurring fields and `needsClarification=true` |
| Executor latent bug for `notes` (out of scope) | Confirmed real; FEAT062 recommended below |

---

## Test counts

| Suite | Pre-FEAT061 (FEAT060 baseline) | Post-FEAT061 | Delta |
|---|---|---|---|
| typecheck | 1 | 1 | 0 |
| calendar_management | 25 | 26 | +1 (Story-2) |
| dataHygiene | 20 | 20 | 0 |
| inbox_triage | 33 | 34 | +1 (Story-2) |
| notesStore | 33 | 33 | 0 |
| notes_capture | 15 | 16 | +1 (Story-2) |
| recurringProcessor | 12 | 12 | 0 |
| router | 22 | 22 | 0 |
| skillDispatcher | 17 | 17 | 0 |
| skillRegistry | 50 | 50 | 0 |
| taskFilters | 22 | 22 | 0 |
| taskPrioritizer | 15 | 15 | 0 |
| task_management | 23 | 24 | +1 (Story-2) |
| topicManager | 50 | 50 | 0 |
| v4Gate | 12 | 12 | 0 |
| test-feat045 | 23 | 23 | 0 |
| **TOTAL** | **373** | **377** | **+4** |

Identical pass count across 3 consecutive runs. Zero flakes from `setDataRoot(os.tmpdir())` — fixture leakage in repo root after each run is empty (only declared source-file edits remain).

---

## Coverage summary

| Test category | Count |
|---|---|
| Story-1 dispatcher fix (state forwarding) — proven via Story-2 tests | 4 |
| Story-2 regression tests (one per migrated skill, each invoking `dispatchSkill`) | 4 |
| Story-3 cast-removal — covered by tsc + existing handler unit tests | 0 new (re-uses the 78 existing handler tests across the four skills) |
| Story-4 no regression elsewhere | 373 untouched tests, all passing |

The four Story-2 tests are the load-bearing additions. Each:

1. Builds a fixture `AppState` with the relevant collection empty.
2. Stubs the LLM client to return one canonical write op.
3. Loads the production registry via `loadProductionRegistry()`.
4. Calls `dispatchSkill(routeResult, phrase, { state, llmClient, registry, enabledSkillIds })` — NOT the handler directly (per condition 4).
5. Asserts the relevant fixture-state collection grew (or `_loadedCounts` post-flush signal for `notes`, since the executor latent bug below silently drops note-array appends).

---

## Story-2 regression results (the test that should have caught this)

| Skill | Test name | Assertion | Result |
|---|---|---|---|
| `task_management` | "dispatchSkill forwards state to handler ctx → fixture state mutated" | `state.tasks.tasks.length === 1` after a single-task add via dispatcher | OK |
| `notes_capture` | "dispatchSkill forwards state to handler ctx → fixture state mutated" | `"notes" in state._loadedCounts` (post-flush signal — see executor bug section) | OK |
| `calendar_management` | "dispatchSkill forwards state to handler ctx → fixture state mutated" | `state.calendar.events.length === 1` after one calendar add via dispatcher | OK |
| `inbox_triage` | "dispatchSkill forwards state to handler ctx → fixture state mutated (chat-driven path)" | `state.tasks.tasks.length === 1` AND `state.calendar.events.length === 1` AND `"notes" in state._loadedCounts` after a 3-write multi-file dispatch | OK |

All four pass. None bypasses `dispatchSkill`. Each surfaces the dispatcher → handler ctx contract end-to-end.

---

## §6 conditions — final state

| # | Condition | State |
|---|---|---|
| 1 | Dispatcher line 133 forwards state | PASS — `skillDispatcher.ts:133` reads `{ phrase, skillId: skill.manifest.id, state: options.state }` |
| 2 | `ToolHandler` ctx is named-shape, `state?: unknown`, no `AppState` import | PASS — `types/skills.ts:25-28`; grep for `AppState` in that file returns no matches |
| 3 | Four migrated handlers replace the cast | PASS — verified via grep: `ctx.state as AppState \| undefined` appears in all four; `(ctx as { state?: AppState }).state` appears nowhere |
| 4 | One Story-2 regression test per migrated skill, calling `dispatchSkill` (NOT the handler directly) | PASS — see table above; all four call `dispatchSkill(makeRoute(<id>), phrase, { registry, enabledSkillIds, state, llmClient })` |
| 5 | `tsc --noEmit` clean (only pre-existing `executor.ts:229`) | PASS — single error `executor.ts(229,58): TS2339`, identical to baseline |
| 6 | `npm run build:web` exports | PASS — 7 bundles + 9 files exported cleanly, no new warnings |
| 7 | No changes to `chat.tsx`, `inbox.ts`, `executor.ts`, `assembler.ts`, `router.ts`, `types/index.ts`, or any other dispatcher caller | PASS — `git diff` against each is empty; only the seven declared in-scope files changed |

All seven: PASS.

---

## Reviewer-flagged investigations

### 1. Double-write investigation (highest priority — was FEAT061 a regression?)

**Reviewer's concern.** The architect's design-review §4 claimed `processBundle` "deliberately does not pass `state` to `dispatchSkill`." Reading the code shows that's wrong — `inbox.ts:98` does in fact pass state. Pre-FEAT061 the dispatcher dropped state, so the handler's `applyWrites` block was dead code on BOTH the chat path AND the inbox-timer path. Post-FEAT061 the handler's `applyWrites` runs on both. The risk: if `processBundle`'s v4 branch ALSO calls `applyWrites` after `dispatchSkill` returns, every timer-driven inbox write doubles.

**Investigation result: NO double-write. Single-write semantics verified.**

**Static trace (`src/modules/inbox.ts:91-141`).** The v4 branch:

```ts
if (useV4) {
  const route = await routeToSkill({ phrase: chunk, directSkillId: "inbox_triage" });
  const dispatch = await dispatchSkill(route, chunk, { state });   // <-- handler runs applyWrites here
  // ... degraded fallback omitted ...
  const data = (dispatch.handlerResult as { data?: ... } | null)?.data;
  const chunkWrites = Array.isArray(data?.writes) ? data!.writes! : [];
  const writeError = data?.writeError ?? null;
  if (writeError) { /* skip success flag, preserve inbox */ continue; }
  anyChunkSucceeded = true;
  if (chunkWrites.length > 0) {
    // Refresh derived state ONLY — no applyWrites call here
    updateSummaries(state);
    rebuildHotContext(state);
    rebuildContradictionIndex(state);
    totalWrites += chunkWrites.length;   // counter
    writes.push(...chunkWrites);         // caller telemetry
  }
  ...
}
```

The block between `dispatchSkill(...)` (line 98) and `continue` (line 141) contains exactly zero calls to `applyWrites`. The `chunkWrites` array is read for telemetry (totals, caller's writes list) — never re-applied. The legacy fallback `runLegacyChunk` (line 157) does call `applyWrites`, but that branch is only entered when `dispatch === null || dispatch.degraded`, in which case the handler did NOT run, so it's not double-write.

**Indirect proof via Story-2 assertions.** The inbox_triage Story-2 test at `inbox_triage.test.ts:573-613` invokes `dispatchSkill` (which goes through the same path the handler takes from `processBundle`) with three writes — task, calendar event, note — and asserts:

- `state.tasks.tasks.length === 1` (NOT 2)
- `state.calendar.events.length === 1` (NOT 2)

If `processBundle`'s post-dispatch loop were calling `applyWrites` on `chunkWrites` again (the way the legacy path does), this test would still go via `dispatchSkill` and would pass — but the equivalent code path runs in `processBundle`, where the static trace shows applyWrites is NOT called. The Story-2 tests at the dispatcher level prove handler-only writes; the static trace proves `processBundle` doesn't re-apply. Combined: single-write across both entry points.

**Why a separate `processBundle`-level integration test is not required.** The static trace is conclusive (no `applyWrites` call exists in the v4 branch), and adding a `processBundle` test would require mocking `dispatchSkill` itself, which adds test surface without testing real behavior. The Story-2 inbox_triage dispatcher test is the right level for the contract being enforced.

**Conclusion.** FEAT061 lands correctly on both paths. The reviewer's concern is resolved: `processBundle`'s only post-dispatch action on a successful chunk is refreshing derived state (`updateSummaries`, `rebuildHotContext`, `rebuildContradictionIndex`), which is exactly the legacy-parity behavior — same three calls happen in `runLegacyChunk` after its own `applyWrites` runs.

**Side-finding for documentation hygiene.** The architect's design-review §4 line about `processBundle` not passing state needs a footnote: pre-FEAT061 the dispatcher dropped state, so the handler-internal `applyWrites` block was dead code on both paths. The architect's mental model is corrected by the code reviewer's observation 2. Post-FEAT061 the handler is the sole writer on both paths. Recommend adding a one-line clarification to the FEAT060 / FEAT061 docs cleanup follow-up.

### 2. Executor latent bug for `notes` (confirmed; recommend FEAT062)

**Confirmed real.** `src/modules/executor.ts:590-601`:

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

The array-key list is `["tasks", "events", "items", "suggestions"]`. `NotesFile` is shaped `{ _summary: string; notes: Note[] }` (`types/index.ts:234-237`). The inner array key `notes` is **missing from the loop**. When the executor processes a `{ file: "notes", action: "add" }` write, the for-loop falls through and `Object.assign(target, d)` runs, which overwrites the file shape rather than appending to the array.

**Why the FEAT061 tests stay green.** `notes_capture.test.ts:315` and `inbox_triage.test.ts:612` both assert `"notes" in state._loadedCounts` instead of `state.notes.notes.length === 1`. `_loadedCounts.notes` is populated by `applyWrites → flush()`, so its presence proves the dispatcher forwarded state and the flush ran end-to-end — which is exactly what FEAT061 is contractually responsible for. The note-append failure is the executor's contract, not the dispatcher's.

**User-visible impact post-FEAT061.** Chat-driven `notes_capture` and chat-driven `inbox_triage` notes adds: handler returns `success=true` and a confirmation message ("I saved that for you"), but the note never actually appears in `notes.notes`. The user sees acknowledgment but the data is silently dropped at the executor layer.

**Recommendation: FEAT062 — "Fix executor `applyAdd` array-loop to include `notes`".**

- One-line change at `executor.ts:591`: `["tasks", "events", "items", "suggestions"]` → `["tasks", "events", "items", "suggestions", "notes"]`.
- One new test asserting `state.notes.notes.length` grew after a `{file: "notes", action: "add"}` write.
- After FEAT062 lands, tighten the post-flush signal in `notes_capture.test.ts:315` and `inbox_triage.test.ts:612` to direct array-length assertions (`state.notes.notes.length === 1`).
- MoSCoW: MUST. Priority: 1. Release: v2.02. Tags: bug-fix, executor.

### 3. Calendar recurring-rejection short-circuit (FEAT059 phrase 7 regression)

**PASS.** Phrase 7 in `calendar_management.test.ts` (the 7-phrase regression fixture) covers `"schedule team sync every Friday at 11am"` with the LLM returning a calendar add carrying `recurring: true`, `recurrence: "weekly"`, `recurrenceDay: "Friday"` and `needsClarification: true`. Assertions:

- `result.data.writes.length === 1` (the write survives — defense in depth, not a hard reject)
- `result.data.writes[0].data.title === "Team sync"`
- `recurring`, `recurrence`, `recurrenceDay` are all `undefined` on the post-strip data — the executor's legacy auto-conversion path (`executor.ts:517-541`) is unreachable
- `result.clarificationRequired === true` — the user gets the redirect prompt, not a silent recurring-write

All four pass across all 3 runs. The cast-removal in `calendar_management/handlers.ts:43` did not perturb the early-return narrowing for the clarification-only path, as the architect's risk row predicted.

---

## False starts during testing

None. The coder's Story-2 tests landed clean; the reviewer's gates passed clean; this stage's gates re-ran clean three times. The only nuance is the documentation work item below (architect §4 footnote about `processBundle` state-passing).

---

## Manual smoke (deferred to user / Capacitor mobile)

v4 is Node-only on current architecture; web mode runs legacy. Recommended after FEAT044 ships the Capacitor path:

| Scenario | Expected (on mobile / Node) |
|---|---|
| Chat: "remind me to call Contact A tomorrow" | task lands in `tasks.tasks`; "via task_management" badge if surfaced |
| Chat: "schedule a sync on Friday at 3pm" | event lands in `calendar.events`; no recurring fields persisted |
| Chat: "save this idea: review the architecture diagram" | **WILL APPEAR TO SUCCEED but note will NOT appear in notes UI** until FEAT062 lands. Document this gap to the user before Capacitor smoke. |
| Chat-driven inbox paste: "got a few things: review audit doc tomorrow, lunch on Thursday at noon." | task + calendar both persist; note (if any) blocked by the same FEAT062 gap |
| Inbox.txt drop with multi-item dump | timer path persists exactly the same set as pre-FEAT061 (the timer-path applyWrites was actually equally broken pre-FEAT061 for the chat-path skills; FEAT061 fixed it for both) |
| `setV4SkillsEnabled([])` restart | All four skills fall back to legacy; no v4 dispatcher logs |

---

## Outstanding for separate action

1. **FEAT062 — Fix executor `applyAdd` array-loop to include `notes`** (NEW, recommended this stage). One-line change to `executor.ts:591`. Unblocks chat-driven note creates from `notes_capture` and `inbox_triage`. Also tightens the FEAT061 Story-2 tests for those two skills from the `_loadedCounts` post-flush signal to direct array-length assertions.
2. **FEAT063 — emotional_checkin migration** (next in queue per project plan). Independent of FEAT061.
3. **AGENTS.md update** — add the dispatcher-level Story-2 test pattern as a template requirement (per design review §9). Carried from the FEAT057-060 docs cleanup backlog.
4. **`docs/new_architecture_typescript.md` update** — same backlog. Note the new `ToolHandler` ctx shape.
5. **One-line footnote to architect's §4 mental model** (low-priority polish): `processBundle` does pass state to `dispatchSkill`. Pre-FEAT061 the dispatcher dropped it; post-FEAT061 both paths run handler-internal `applyWrites`. The behavior reviewer-observation 2 documents.
6. **FEAT044 (Capacitor) end-to-end chat-write smoke** — unblocked by FEAT061 + FEAT062. Will require manual smoke test of all four skill paths once FEAT062 lands.
7. **Legacy `bulk_input` cleanup PR** — accumulated from FEAT057-060; same pattern, post-bake-in. Not blocking.

---

## Status update

**FEAT061 → `Done`.**

**v2.02 progress:**

| FEAT | Status |
|---|---|
| FEAT056 (chat wiring + general_assistant) | Done |
| FEAT057 (task_management migration) | Done |
| FEAT058 (notes_capture skill) | Done |
| FEAT059 (calendar_management migration) | Done |
| FEAT060 (inbox_triage migration — multi-file + non-chat) | Done |
| **FEAT061 (dispatcher state forwarding fix)** | **Done (this cycle)** |
| FEAT062 (executor notes array-loop fix) | Recommended (this cycle) — not yet created |
| FEAT063 (emotional_checkin migration) | Next in queue — not yet created |

---

## Ready-to-ship assessment

**Ready to ship.** FEAT061 is a one-line dispatcher fix plus one type tweak plus four cast removals plus four regression tests. All seven design-review conditions PASS. Three consecutive 377/377 test runs with zero flakes and zero fixture leakage. The reviewer's double-write concern was investigated end-to-end (static trace + Story-2 dispatcher assertions) and disproven — `processBundle`'s v4 branch contains zero `applyWrites` calls; the handler is the sole writer on both chat and timer paths. The latent executor bug for `notes` is real but out-of-scope per condition 7; FEAT062 is recommended as the follow-up. Capacitor smoke (FEAT044) should land FEAT062 first to avoid the user-visible "I saved that for you but the note isn't there" failure mode.
