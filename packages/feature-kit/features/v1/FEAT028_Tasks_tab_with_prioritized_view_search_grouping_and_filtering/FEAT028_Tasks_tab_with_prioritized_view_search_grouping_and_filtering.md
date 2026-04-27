# FEAT028 — Tasks tab with prioritized view, search, grouping, and filtering

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Tasks
**Priority:** 1
**Release:** v2.1
**Tags:** tasks, ui, search, filtering, tasks-tab
**Created:** 2026-04-06
**Design reviewed:** 2026-04-06

**Parent:** — (this is the parent of the `tasks-tab` feature family)
**Follow-up features:**
- [FEAT030](../FEAT030_Tasks_tab_RICE_scoring_and_Whythisrank_sheet/FEAT030_Tasks_tab_RICE_scoring_and_Whythisrank_sheet.md) — RICE scoring + Why-this-rank sheet (v2.2)
- [FEAT031](../FEAT031_Tasks_tab_HITL_corrections_with_bump_pin_and_snooze/FEAT031_Tasks_tab_HITL_corrections_with_bump_pin_and_snooze.md) — HITL corrections (v2.3)
- [FEAT032](../FEAT032_Tasks_tab_learning_loop_for_adaptive_priority_weights/FEAT032_Tasks_tab_learning_loop_for_adaptive_priority_weights.md) — Learning loop for adaptive weights (v2.4)
- [FEAT029](../FEAT029_Shared_RICE_scoring_module_for_prioritization_across_domains/FEAT029_Shared_RICE_scoring_module_for_prioritization_across_domains.md) — Shared RICE module generalization (POST-MVP, deferred until a second RICE consumer exists)

---

## Summary

A dedicated Tasks tab that surfaces every task from `tasks.json` in a unified, browsable view with simple priority ordering, full-text search, flexible grouping, and multi-dimensional filtering. Today, tasks are scattered across chat replies and the Focus Dashboard's curated daily brief — this tab gives the user a single place to see, search, and manage everything.

This is the **MVP scope (Phase 1)** of the Tasks tab family. Priority ordering uses the same deterministic logic that currently drives the Focus Brief sort, extracted into a reusable module. Smart RICE scoring, human-in-the-loop corrections, and a learning loop are tracked as follow-up features (FEAT030–032) and are **not part of this release**.

---

## Problem Statement

The user currently has no way to see all their tasks at once. The Focus Dashboard only shows today's curated subset, and chat interactions only reveal tasks incidentally. When the user wants to answer questions like "what do I have due this week?", "what's blocked on me?", or "find that task about the budget report", they have no affordance to do so. Tasks become invisible beyond the daily horizon, leading to missed deadlines and forgotten commitments.

---

## User Stories

### Story 1 — See everything at a glance
**As a** user, **I want** to open a Tasks tab and see all my tasks in one place, **so that** I never lose track of commitments that aren't in today's plan.

**Acceptance Criteria:**
- [ ] Given the app is open, when the user taps the Tasks tab, then every task from `tasks.json` is visible
- [ ] Given many tasks exist, when the list renders, then it's scrollable and performant (no lag up to 500 tasks)
- [ ] Given the list loads, when the user looks at it, then tasks are sorted by overdue-first → priority enum → due date ascending

### Story 2 — Search
**As a** user, **I want** to type into a search box and filter tasks by keyword, **so that** I can find a specific task quickly.

**Acceptance Criteria:**
- [ ] Given the user types in the search box, when 2+ characters are entered, then the list filters to tasks whose `title`, `notes`, `category`, or `subcategory` match (case-insensitive substring)
- [ ] Given search results are shown, when the user clears the input, then the full list returns
- [ ] Search matches substrings, not just prefixes

### Story 3 — Grouping
**As a** user, **I want** to group tasks by different dimensions, **so that** I can see the list from different angles.

**Acceptance Criteria:**
- [ ] Given the user opens the group-by selector, when they choose "Status", then tasks cluster under headings (Pending, In Progress, Overdue, Done)
- [ ] Given they choose "Due Date", then tasks cluster under Today / Tomorrow / This Week / Later / No Due Date
- [ ] Given they choose "Category", then tasks cluster under their `category` field
- [ ] Given they choose "None", then the flat prioritized list returns
- [ ] Group choice persists across sessions via AsyncStorage

### Story 4 — Filtering
**As a** user, **I want** to filter tasks by status, due date range, priority, and category, **so that** I can narrow the view to what's relevant right now.

**Acceptance Criteria:**
- [ ] Given a filter bar is visible, when the user picks "Status: Pending", then only pending tasks show
- [ ] Given multiple filters are active, when they combine, then the list shows tasks matching ALL filters (AND logic)
- [ ] Given an active filter, when the user taps its chip with an X, then that filter is removed
- [ ] Given all filters are cleared, when the list updates, then it returns to the full sorted list

---

## Workflow

```
User taps Tasks tab
  → loadState() via existing loader (mirror focus.tsx:94-112)
  → computeTaskPriority() from taskPrioritizer module
  → Apply current group + filter state from AsyncStorage
  → Render SectionList with filter chip bar on top
  → User types in search / taps filter chip / changes grouping
    → Re-filter + re-sort in memory (no re-read)
  → User taps a task
    → Opens detail sheet (reuse existing task detail or simple readonly view)
```

---

## Priority Algorithm (Phase 1)

Lives in `src/modules/taskPrioritizer.ts`. **Matches current behavior at [src/modules/assembler.ts:220-240](src/modules/assembler.ts#L220-L240) exactly**, then the assembler is refactored to call the new module so Focus Brief and Tasks tab always agree.

```typescript
// src/modules/taskPrioritizer.ts
const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function computeTaskPriority(tasks: Task[], now: Date): Task[] {
  const todayIso = isoDate(now);
  return [...tasks]
    .filter(t => t.status !== "done")
    .sort((a, b) => {
      // 1. Overdue bubbles to top
      const aOverdue = a.status === "overdue" || (a.due && a.due < todayIso);
      const bOverdue = b.status === "overdue" || (b.due && b.due < todayIso);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      // 2. Priority enum
      const pDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      // 3. Due date ascending (null as "\uffff")
      return (a.due || "\uffff").localeCompare(b.due || "\uffff");
    });
}
```

This is the **regression parity baseline**: P1 tests assert `computeTaskPriority` produces the same ordering as the current assembler sort for all test fixtures. FEAT030 later replaces the body with RICE logic while keeping the signature stable.

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| No tasks exist | Empty state with "Capture your first task in chat" message |
| Task has no `due` | Included in "No Due Date" group; priority still computed |
| Task has no title (malformed) | Fall back to `task.id` with `(untitled)` badge |
| Search returns zero results | "No tasks match" + quick-clear button |
| Filter combination returns zero | "No tasks match these filters" + "Clear filters" |
| Task status changes while viewing | Re-render on state refresh (existing 5-min polling) |
| Very large task list (>500) | Virtualized `SectionList` / `FlatList` |
| Task marked done from chat | Disappears from default view on next refresh |

---

## Success Metrics

- Time to find a specific task: < 5 seconds with search
- Zero tasks "lost" — every task accessible from at least one group/filter combo
- Regression parity: `taskPrioritizer` produces identical ordering to current assembler for all existing test fixtures
- Focus Brief and Tasks tab always show the same order for the same input

---

## Out of Scope (for P1)

Everything below belongs to follow-up features. Do not pull any of it into this PR:

- **RICE scoring** → FEAT030
- **"Why this rank?" sheet** → FEAT030
- **Long-press HITL menu** (bump/pin/snooze) → FEAT031
- **Correction logging** to `FeedbackMemory.corrections` → FEAT031
- **Learning loop / learned weights** → FEAT032
- **Shared RICE module** across domains → FEAT029 (deferred)
- Drag-and-drop reordering — priority is computed, not manual
- Gantt / timeline view
- Bulk edit (multi-select + batch status change)
- Task creation UI from the tab — creation still happens via chat
- AI-generated task suggestions inside the tab
- Saved filter "views"

---

## Architecture Notes

### Refactor-first approach

**Phase 1 starts with a refactor, not a new feature.** The existing sort at [src/modules/assembler.ts:220-240](src/modules/assembler.ts#L220-L240) is extracted into `src/modules/taskPrioritizer.ts` as a pure function with identical behavior. `assembler.ts` is then updated to call the new module. This guarantees the Focus Brief and the Tasks tab always agree on ordering, and gives us a regression-parity test baseline before any future scoring changes.

### No type changes required

P1 does not modify `src/types/index.ts`. All required fields already exist on `Task` ([src/types/index.ts:144-162](src/types/index.ts#L144-L162)): `id`, `title`, `due`, `priority`, `status`, `category`, `subcategory`, `notes`, `createdAt`. Type extensions (`TaskHITL`, `TaskPriorityCorrection`, etc.) are scoped to FEAT031 and FEAT032.

### Search corpus

Substring match across `title + notes + category + subcategory`. No `tags` field exists on `Task`. Case-insensitive. No fuzzy matching (keep it predictable).

### Filter persistence

Local React state in the tab; persisted to `AsyncStorage` under key `lifeos:tasks_tab:filters_v1` (versioned for future schema migration). **Not** written to the data folder — these are UI preferences, not user data.

### State loading

Mirror [app/(tabs)/focus.tsx:94-112](app/(tabs)/focus.tsx#L94-L112):

```typescript
const loadTasks = useCallback(async () => {
  setLoading(true);
  const state = await loadState();
  setTasks(state.tasks.tasks);
  setLoading(false);
}, []);

useFocusEffect(useCallback(() => { loadTasks(); }, [loadTasks]));
```

The existing 5-minute polling interval from `_layout.tsx` keeps the list fresh while the tab is open, per the "App Runs Continuously" rule in [CLAUDE.md](CLAUDE.md).

### Grouping

Reducer pattern — `groupTasks(tasks, groupBy): { title: string; data: Task[] }[]`. Rendered as `SectionList`. `groupBy` modes: `status`, `dueBucket`, `category`, `none`.

### Sacred boundary compliance

The LLM is **NOT** involved in prioritization, search, grouping, or filtering. All deterministic logic lives in TypeScript. LLM only touches tasks when the user says "create a task to…" via chat, unchanged.

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/modules/taskPrioritizer.ts` | **NEW** — extract current assembler.ts sort as pure function; matches behavior exactly |
| `src/modules/taskPrioritizer.test.ts` | **NEW** — regression parity tests against current assembler output |
| `src/modules/taskFilters.ts` | **NEW** — pure helpers: `filterTasks`, `groupTasks`, `searchTasks` |
| `src/modules/taskFilters.test.ts` | **NEW** — unit tests for group/filter/search logic |
| `src/modules/assembler.ts` | Refactor lines 220-240 to call `computeTaskPriority` |
| `app/(tabs)/tasks.tsx` | **NEW** — Tasks tab screen (list + search + filters + group selector) |
| `app/(tabs)/_layout.tsx` | Register 3rd `Tabs.Screen` for `tasks` with ✅ icon |
| `src/components/TaskListItem.tsx` | **NEW** — row component with priority dot, title, due, status |
| `src/components/TaskFilterBar.tsx` | **NEW** — active filter chips with X-to-remove |
| `docs/new_architecture_typescript.md` | Update Sections 3 (structure), 6 (modules), 12 (feature catalog) |
| `README.md` | Add Tasks tab to feature list |

---

## Testing Notes

- [ ] Unit: `taskPrioritizer.computeTaskPriority` matches current assembler sort output exactly for 10+ fixture scenarios (regression parity)
- [ ] Unit: `filterTasks` applies AND logic correctly across status/date/priority/category
- [ ] Unit: `groupTasks` produces correct sections for each grouping mode
- [ ] Unit: `searchTasks` case-insensitive substring across title/notes/category/subcategory
- [ ] Unit: `searchTasks` returns full list when query is empty or < 2 chars
- [ ] Integration: loading `tasks.json` renders sorted SectionList
- [ ] Integration: filter chip add/remove updates list correctly
- [ ] Integration: group-by change persists across app restarts via AsyncStorage
- [ ] Integration: task marked complete (from chat) reflects in Tasks tab after state refresh
- [ ] E2E: open tab → search "budget" → tap task → close sheet → clear search → full list restored
- [ ] Manual: Focus Brief and Tasks tab show the same ordering for the same input (sanity check the refactor)

---

## Open Questions

- **Row priority indicator:** colored priority dot (high/medium/low) or full text badge? **Recommended: colored dot + text on the right.**
- **Done tasks visibility:** hidden by default with an "Include done" filter toggle. **Confirmed.**
- **Empty search behavior:** clearing the search box restores previous filters (search is orthogonal to filters). **Confirmed.**
- **Tab icon:** ✅ (checkmark). **Confirmed.**
