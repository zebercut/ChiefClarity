---
feature: FEAT062
stage: Code Reviewed
reviewer: Code Reviewer (inline — agent retry after auth error)
date: 2026-04-27
verdict: APPROVED
---

# FEAT062 — Code Review

## Verdict

**APPROVED.** Minimal, contract-fixing change. No fixes required.

## Files reviewed

- `src/modules/executor.ts` — one-line append in `applyAdd` array-key loop
- `src/modules/notes_capture.test.ts` — Story 3 tightening (post-flush
  signal → direct array assertion) + Story 2 new "Executor compatibility"
  test + obsolete comment removal
- `src/modules/inbox_triage.test.ts` — Story 3 tightening + comment removal

## §6 conditions audit

| # | Condition | Status |
|---|---|---|
| 1 | One-line production change in `applyAdd` array-key loop | ✓ — diff is exactly the array literal append: `["tasks", "events", "items", "suggestions"]` → `[..., "notes"]` |
| 2 | `MAX_ARRAY_ITEMS` cap uniform | ✓ — no notes special-case; cap-and-warn at line 593-595 applies to all `listKey`s |
| 3 | Story-2 regression test in `notes_capture.test.ts` calling `applyWrites` (NOT `applyAdd`) | ✓ — `await applyWrites(plan, state)` confirmed; tests the public surface |
| 4 | Story-3 tightening in `notes_capture.test.ts` | ✓ — `_loadedCounts` post-flush signal replaced with `state.notes.notes.length === 1` + text check; obsolete comment block removed |
| 5 | Story-3 tightening in `inbox_triage.test.ts` | ✓ — same swap; tasks + calendar + notes all asserted directly; comment block removed |
| 6 | `tsc --noEmit` clean (pre-existing `executor.ts:229` only) | ✓ |
| 7 | No changes to handlers/dispatcher/types/etc. | ✓ — diff confined to `executor.ts` (1 line), 2 test files, auto-regenerated `_manifest.json` |

## Hardening exercise

The new "Executor compatibility" test must FAIL against the buggy
(pre-FEAT062) executor — otherwise it doesn't actually catch the
regression class. Verified by temporarily reverting `executor.ts:591`
to `["tasks", "events", "items", "suggestions"]` and running
`notes_capture.test.ts` standalone:

```
[notes_capture] applyWrites failed: Cannot convert undefined or null to object
  ✗ dispatchSkill forwards state to handler ctx → applyWrites reached for notes
  ✗ applyWrites add → notes appends to state.notes.notes
15 passed, 2 failed
```

**Both** the tightened FEAT061 dispatcher test AND the new FEAT062
executor test fail. The Story 3 tightening (FEAT061 test) now also
serves as a regression for the executor bug, which is correct — the
tighter assertion exposes more of the chain. After restoring the
fix: 17/17 in notes_capture, 378/378 full suite.

## Code observations

**1. Loop entry order.** Architect prescribed appending `"notes"` at
the end. Coder followed. Diff is exactly one element added to one
array literal. ✓

**2. Test calls `applyWrites`, not `applyAdd`.** Critical — testing
the private function would let any version of the loop pass. Coder
correctly imports `applyWrites` from `./executor` and constructs an
`ActionPlan` with one write. The test exercises the full executor
entry point. ✓

**3. The new test asserts injected `id` and `createdAt`.** Beyond
length and text, the test verifies the executor injects `id: string`
(non-empty) and `createdAt: string` (non-empty). This catches a class
of bugs where the loop runs but the default-branch (which injects
those fields) is bypassed. ✓

**4. Comment removals are content-correct.** Both removed comment
blocks described the now-fixed bug (FEAT061's `_loadedCounts`
workaround). Nothing semantically valuable was lost. The post-fix
tests are self-explanatory via assertion content. ✓

**5. `setDataRoot(os.tmpdir())` already at top of both test files**
from FEAT061. Mitigation in place. Full suite ran with no fixture
leakage to repo root.

## Latent bug findings (for follow-up)

**Same array-loop omission exists in `applyUpdate` and `applyDelete`.**
The coder flagged this. Verified:

```bash
grep -n '"tasks", "events", "items", "suggestions"' src/modules/executor.ts
# 591  (applyAdd — fixed in FEAT062)
# 665  (applyUpdate — still buggy for notes)
# 699  (applyDelete — still buggy for notes)
```

Currently latent-but-not-live (matches the `planAgenda`/`planRisks`
philosophy from FEAT062's design-review §4): `notes_capture` is
append-only — there's no `notes_update` or `notes_delete` LLM intent.
If a future skill (e.g., a notes_curate / archive skill) emits update
or delete writes for `file: "notes"`, the same silent-drop class
of bug will surface.

**Recommendation:** carry as a future FEAT (one-line × 2 + tests).
Or fold into the next skill that emits notes-mutation writes — that
PR would have a natural test fixture for it.

## Things NOT in scope (correctly deferred)

- `applyUpdate` / `applyDelete` array-loop fix — out of scope per
  condition 7
- `planAgenda` / `planRisks` array-loop additions — already audited and
  excluded in design-review §4 (no LLM write path)
- AGENTS.md / `docs/new_architecture_typescript.md` updates — accepted
  carry-forward from FEAT057-061
- FEAT044 Capacitor smoke — separate FEAT
- Refactor of executor's per-file branches into a registry — out of
  scope; `applyAdd`'s shape is fine for current needs

## Sign-off

Code review approved. Tester may proceed to Stage 6.

## For the tester

The change is genuinely tiny — one production line + one new test +
two assertion tightenings. The hardening exercise above already
demonstrated the new test catches the bug class. Tester focus:

1. Re-run the full suite 2-3 times to confirm no flakes (`setDataRoot`
   redirect should keep cwd clean each time).
2. Confirm no fixture leakage in repo root via `git status --short`
   after each run.
3. Spot-check that the tightened FEAT061 tests still cover the
   dispatcher-handoff contract (the original FEAT061 thing they were
   testing) — they should, because tighter assertions strictly imply
   the looser ones.
4. Document the `applyUpdate` / `applyDelete` latent finding for the
   "Outstanding for separate action" section. Recommend a follow-up
   FEAT or fold into the first future notes-mutation skill.
5. Mark FEAT062 Done after all gates pass.
