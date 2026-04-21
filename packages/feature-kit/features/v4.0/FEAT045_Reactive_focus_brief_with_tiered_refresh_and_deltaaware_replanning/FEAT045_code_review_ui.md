# Code Review: FEAT045 UI Changes — Task dates, comments, dismiss, week preview, agenda date

**Created:** 2026-04-13
**Reviewer:** Code Reviewer Agent
**Status:** CHANGES REQUIRED
**Scope:** Task type extensions (dismissedAt, comments), UI changes (TaskList, AgendaTimeline, WeekPreview), briefRenderer

## Files Reviewed

| File | Change |
|------|--------|
| `src/types/index.ts` | Added `TaskComment`, `dismissedAt`, `comments` to Task |
| `src/modules/smartActions.ts` | Delete/cancel → soft dismiss, add_comment action |
| `src/modules/executor.ts` | Default fields for new tasks |
| `src/components/focus/TaskList.tsx` | Collapsed default, dates, comment UI, dismiss display |
| `src/components/focus/AgendaTimeline.tsx` | Today's date in header |
| `src/components/focus/WeekPreview.tsx` | Rewritten: fixed events + recurring tasks only |
| `src/modules/briefRenderer.ts` | Today label in calendar heading |
| `app/(tabs)/focus.tsx` | Updated props for AgendaTimeline + WeekPreview |

---

## Overall Status

**CHANGES REQUIRED** (3 bugs, 2 missing updates)

---

## Correctness

- [x] TaskList defaults to collapsed — correct
- [x] AgendaTimeline shows today's date — correct
- [x] WeekPreview shows only fixed events + recurring tasks — correct
- [x] `TaskComment` type well-structured — correct
- [x] `dismissedAt` added to Task — correct
- [x] Comment input + save works via `add_comment:` action prefix — correct
- [x] HTML renderer shows "Today" label — correct

---

## Bugs

### Bug #1 (MUST FIX): Dismissed tasks invisible in completed section

**TaskList.tsx:26** — the completed filter is:
```typescript
const completed = tasks.filter((t) => t.status === "done" && t.completedAt?.startsWith(today));
```

Dismissed tasks have `status: "done"` but `completedAt` remains `null` (only `dismissedAt` is set). So `null?.startsWith(today)` → `undefined` → filtered out. Dismissed tasks won't appear in the completed section even though the rendering code at line 158-170 correctly handles them.

**Fix:**
```typescript
const completed = tasks.filter((t) =>
  t.status === "done" && (t.completedAt?.startsWith(today) || t.dismissedAt?.startsWith(today))
);
```

### Bug #2 (MUST FIX): focus.tsx sends `writeAction: "delete"` but task is no longer deleted

**focus.tsx:92-94** — the brief patcher receives `{ action: "delete" }` for the "delete" case:
```typescript
case "delete":
  writeAction = "delete";
  break;
```

But `smartActions.ts` now soft-dismisses instead of splicing. The brief patcher's `patchTask` function handles `action: "delete"` by removing the item from `day.additions`, which is correct for display purposes. However, the mismatch is confusing — the "cancel" case at line 95-97 sends `{ status: "cancelled" }` but `smartActions.ts` now sets `status: "done"` + `dismissedAt`.

**Fix:** Align the write operations in `focus.tsx` with the new soft-delete behavior:
```typescript
case "delete":
  writeData = { status: "done", dismissedAt: new Date().toISOString() };
  break;
case "cancel":
  writeData = { status: "done", dismissedAt: new Date().toISOString() };
  break;
```

### Bug #3 (MUST FIX): `recurringProcessor.ts` creates tasks missing new required fields

**recurringProcessor.ts:42** — creates tasks with `completedAt: null` but omits `dismissedAt` and `comments`. Since these are new required fields on the `Task` interface, TypeScript won't catch this because the recurring processor likely uses `as Task` or an object literal without full type checking.

At runtime, tasks created by the recurring processor will have `undefined` for `dismissedAt` and `comments`, which will cause:
- `task.comments || []` in TaskList → works (defensive)
- `!!task.dismissedAt` in TaskList → works (`undefined` is falsy)
- But any strict equality check or serialization may behave unexpectedly

**Fix:** Add the missing fields:
```typescript
completedAt: null,
dismissedAt: null,
comments: [],
```

---

## Security

### Issue: Comment text injected into action type string

**smartActions.ts:121-122** — the comment text is passed via the action type string:
```typescript
if (actionType.startsWith("add_comment:")) {
  const commentText = actionType.slice("add_comment:".length);
```

This means the comment text passes through the same code path as action types. If comment text contains a colon, the slice works correctly (takes everything after `add_comment:`). However, the pattern of encoding data in the action type string is fragile.

**Severity:** Low — single-user app, no injection risk. But if the action type is ever logged or matched elsewhere, colons in comment text could cause surprises.

**No fix required** for now, but worth noting as tech debt.

---

## Performance

- Issues found: None
- WeekPreview `buildPreview` iterates 7 days × recurringTasks.length — negligible
- Comment submission triggers flush (disk write) — acceptable, same as all other actions

---

## Architecture Compliance

- [x] Type changes in correct location (`types/index.ts`)
- [x] Action handling in `smartActions.ts` — correct module
- [x] Executor defaults in `applyAdd` — correct location
- [x] UI components follow existing patterns (props, theme, StyleSheet)
- [x] WeekPreview correctly decoupled from brief's `days[]` — now reads live data

### Issue: `DaySlot` import removed from WeekPreview but unused import `AppState` removed from TaskList

Both are clean — no issues.

---

## Code Quality

- [x] Consistent styling with existing components
- [x] Comment UI uses the existing `ActionBtn` helper — good reuse
- [x] `formatShortDate` is a simple, readable helper
- [x] `buildPreview` in WeekPreview is a pure function — good testability

### Minor issues:

1. **`cmt_${Date.now()}` as comment ID** (smartActions.ts:127) — `Date.now()` can collide if two comments are added in the same millisecond (unlikely but possible in tests). Consider using the `genId` utility used elsewhere in the project.

2. **Comment input has no max length.** A very long comment could break the layout. Not a blocker — the app is single-user.

---

## Testability

- [x] `buildPreview` in WeekPreview is a pure function — testable with no mocks
- [x] `formatShortDate` is a pure function — trivially testable
- [x] `add_comment:` action in smartActions is testable via mock state
- [x] No hidden side effects at import time

---

## Required Changes

1. **[MUST] Fix dismissed tasks filter in TaskList.tsx:26**
   ```typescript
   const completed = tasks.filter((t) =>
     t.status === "done" && (t.completedAt?.startsWith(today) || t.dismissedAt?.startsWith(today))
   );
   ```

2. **[MUST] Fix focus.tsx:92-97 — align write operations with soft-delete behavior**
   ```typescript
   case "delete":
     writeData = { status: "done", dismissedAt: new Date().toISOString() };
     break;
   case "cancel":
     writeData = { status: "done", dismissedAt: new Date().toISOString() };
     break;
   ```

3. **[MUST] Add missing fields in recurringProcessor.ts:42**
   ```typescript
   completedAt: null,
   dismissedAt: null,
   comments: [],
   ```

---

## Optional Suggestions

1. Use `genId("cmt")` instead of `cmt_${Date.now()}` for comment IDs.
2. Add a `maxLength` prop to the comment TextInput (e.g., 500 chars).
3. Consider making `dismissedAt` and `comments` optional on the Task interface (`dismissedAt?: string | null; comments?: TaskComment[];`) since existing data files won't have these fields until tasks are re-saved. This matches the defensive `task.comments || []` pattern already used in the UI.

---

## Patterns to Capture

### For AGENTS.md
- **Soft delete consistency (CR-UI):** When changing a hard delete to a soft delete, audit ALL callers that reference the deleted items — including brief patchers, filters, and UI display logic. A soft-deleted item is still in the array, so filters must be updated to include it where appropriate (e.g., "completed today" section).

### For coding rules
- **New required fields need defaults everywhere tasks are created.** When adding a required field to the Task interface, search for every location that creates a Task object (executor, recurringProcessor, annotations, LLM output normalization) and add the default. Use grep for `completedAt: null` as a proxy to find all task creation sites.
