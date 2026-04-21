# Code Review: Task Deferred + Parked Statuses

**Created:** 2026-04-14
**Reviewer:** Code Reviewer Agent
**Status:** CHANGES REQUIRED → Fixed

## Scope

Adding `deferred` and `parked` statuses to the Task type, with UI actions (Park, Defer, Resume) in the TaskDetailSlideOver, and filter updates across the codebase.

## Overall Status: CHANGES REQUIRED → All Fixed

Found **10 files** with `status !== "done"` or `status === "done"` checks that were NOT updated for the new statuses. All fixed in this review.

## Bugs Found and Fixed

### Critical: 10 files had stale status checks

The coder correctly updated `types/index.ts`, `smartActions.ts`, `TaskDetailSlideOver.tsx`, `taskPrioritizer.ts`, `taskFilters.ts`, `summarizer.ts` (2 spots), and `focus.tsx`. But **10 additional locations** still used the old `status !== "done"` pattern, which would cause deferred and parked tasks to appear as active:

| File | Line | Issue | Fix |
|------|------|-------|-----|
| `TaskList.tsx` | 25-27 | Overdue/dueToday/noDate filters include parked+deferred | → `isTaskActive(t.status)` |
| `briefRefresher.ts` | 36 | Open task count includes parked | → `isTaskActive(t.status)` |
| `triage.ts` | 67 | Open task count includes parked+deferred | → exclude both |
| `triageLoader.ts` | 57,61 | Task index includes parked+deferred | → exclude both |
| `proactiveEngine.ts` | 166 | Overdue nudges fire for deferred tasks | → exclude both |
| `proactiveEngine.ts` | 283 | Stalled check includes parked | → exclude all terminal+parked |
| `smartActions.ts` | 261 | Task matching includes deferred | → exclude deferred |
| `companion.ts` | 88 | Overdue items include deferred+parked | → exclude both |
| `summarizer.ts` | 194 | Contradiction index includes deferred | → exclude deferred |
| `TaskListItem.tsx` | 30 | Row visual only handles "done", not "deferred" | → include deferred |

## Pattern Observed

The `isTaskActive()` and `isTaskTerminal()` helpers were created but only used in 4 files. The remaining 10 files used inline `status !== "done"` checks. Some files couldn't use the helpers because they're `.js` (triage, triageLoader) or because importing from `types` would create circular dependencies.

**For files that can import from types:** Use `isTaskActive()` or `isTaskTerminal()`.
**For files that can't:** Use the explicit triple check: `t.status !== "done" && t.status !== "deferred" && t.status !== "parked"`.

## Correctness After Fixes

- [x] Deferred tasks don't appear in active task lists
- [x] Parked tasks don't appear in active task lists
- [x] Parked tasks don't trigger overdue nudges
- [x] Deferred tasks don't trigger overdue nudges
- [x] Open task counts exclude both deferred and parked
- [x] Task matching for smart actions skips deferred tasks
- [x] TaskListItem shows deferred tasks as done (strikethrough)
- [x] Park/Defer/Resume buttons work in TaskDetailSlideOver
- [x] Type-check passes clean
