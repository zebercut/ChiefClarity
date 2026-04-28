# FEAT057 — Migrate `task_management` intents (task_create + task_update + task_query) to v4 skill

**Type:** feature
**Status:** Approved by user 2026-04-27 — stages 3–7 ran. **Stage 2 review notes:** all 7 open questions deferred to architect; PM proposals accepted. Q1 single-tool-with-array confirmed; Q2 direct `executor.applyWrites` import confirmed; Q3 triage fast-path no longer forces legacy (already true since FEAT056 B2); Q4 extend dispatcher's context resolver; Q5 copy task-relevant prompt fragment from `prompts.ts`; Q6 fixtures co-located in test file; Q7 two-PR cleanup strategy — FEAT057 ships skill only, legacy cleanup is a follow-on PR after parity bake-in.
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02 (Phase 2 — second deliverable; first **real** intent migration)
**Tags:** skill-migration, task-management, crud, first-real-migration
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done), FEAT051 (Done), FEAT055 (Done — dispatcher), FEAT056 (Done — chat wiring + general_assistant)
**Unblocks:** FEAT058 (notes migration) and the rest of the per-intent migration batch — this FEAT establishes the migration *pattern* that batch 1 will follow

---

## Status

Draft — awaiting human review before architect picks it up for stages 3–4.

---

## Problem Statement

`task_management` is the most frequent specialized intent in the app — every
"add a task to call the dentist", "mark X done", "show me my tasks for this
week" goes through three legacy intents (`task_create`, `task_update`,
`task_query`) handled by:

- A regex in `router.ts` PATTERNS table
- A `switch` case in `assembler.ts:45-52` that builds tasksIndex + topic context
- System-prompt rules in `constants/prompts.ts:16-17` directing the LLM how
  to format CRUD writes
- Dedup, conflict detection, topic-tagging, and write-application logic in
  `executor.ts:applyWrites`

This is the largest intent in the v4 migration backlog (3 legacy intents in
one skill) and the **first real test** of whether the v4 skill model can
absorb production-grade CRUD logic without losing functionality.

After FEAT056 wired the chat surface, "add a task" phrases currently route
through the v4 router, hit `general_assistant` via fallback (because
`task_management` skill doesn't exist yet), and `general_assistant`'s prompt
politely redirects the user back to legacy CRUD phrasing. That's a 1-Haiku
+ 1-retry-round-trip cost the user pays on every task action. FEAT057
removes that friction by giving task phrases a real specialized v4 skill.

This FEAT also **proves the migration pattern** that the rest of batch 1
(notes, calendar, inbox_triage, emotional_checkin) will follow. Whatever
shape FEAT057 settles on for "skill handler delegating to existing
executor.applyWrites" becomes the template.

---

## Goals

1. A `task_management` skill folder exists at `src/skills/task_management/`,
   loads via FEAT054, and routes via FEAT051 for typical CRUD phrases.
2. The skill's handlers produce the **same writes** as today's legacy intents
   for an equivalent phrase. Same dedup behavior, same conflict detection,
   same topic auto-tagging.
3. After FEAT057 ships, "add a task to call the dentist" no longer routes to
   `general_assistant`. It routes to `task_management`, executes the write,
   and replies with a sensible confirmation.
4. Setting `setV4SkillsEnabled([])` reverts to legacy `task_create` /
   `task_update` / `task_query` paths — same UX as before.
5. Once parity is proven on a 10-phrase regression set, the legacy
   `task_create` / `task_update` / `task_query` regex patterns,
   assembler.ts case branches, and prompts.ts CRUD instructions are deleted.
   (This last cleanup may ship as a follow-on PR if the migration window
   needs to stay dual-path longer.)
6. No regression in any existing test (currently 277 baseline) and the web
   bundle still exports.

---

## Success Metrics

- Skill loads at boot (`Loaded skill: task_management` in the registry log).
- 10-phrase regression set: `add a task X`, `add a todo Y`, `mark X done`,
  `delete the task Y`, `show me my tasks`, `what tasks do I have for
  Tuesday`, `priority on X is high`, `done with the proposal review`,
  `cancel the dentist task`, `tasks about the audit` → all 10 produce
  outputs matching today's legacy behavior on top-3 fields (write target,
  resulting task title, status/priority). Threshold: ≥9/10 matching.
- Setting `setV4SkillsEnabled([])` and rerunning the regression set
  produces identical legacy output.
- All 277 existing tests pass after FEAT057. New skill tests added.
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Add a task via v4

**As a** user, **when** I say *"add a task to call the dentist tomorrow"*,
**I want** the v4 path to create a real task with the right title, due date,
and priority, **so that** task creation works through the new architecture
without UX loss.

**Acceptance Criteria:**
- [ ] Given `task_management` is in `setV4SkillsEnabled`, when I send *"add a
      task to call the dentist tomorrow"*, then a task is created in
      `state.tasks` with title containing "dentist", due set to tomorrow's
      date in the user's timezone, priority "medium" (default).
- [ ] The chat reply confirms the action ("Added: Call the dentist
      (tomorrow)") and shows the *via task_management* badge.
- [ ] Same phrase with `setV4SkillsEnabled([])` produces an identical task
      via the legacy `task_create` flow (parity).

### Story 2 — Update / mark-done a task via v4

**As a** user, **when** I say *"mark the dentist task as done"* or
*"set X to high priority"*, **I want** v4 to update the right task with the
right field change.

**Acceptance Criteria:**
- [ ] Given a task "Call the dentist" exists, when I send *"mark the dentist
      task as done"*, then that task's status is updated to "done" via the
      v4 path. Reply confirms.
- [ ] Given multiple matching candidates, the skill returns a clarification
      question listing the candidates instead of guessing.
- [ ] Updates respect `state.tasks` referential integrity — same shape
      changes as today's legacy update.

### Story 3 — Query tasks via v4

**As a** user, **when** I say *"show me my tasks for this week"*, **I want**
v4 to return the relevant tasks rendered as the existing interactive task
list (the same `items` array today's legacy `task_query` produces).

**Acceptance Criteria:**
- [ ] Given an active set of tasks, when I send *"show me my overdue tasks"*,
      then the chat surface renders an `items` array of overdue tasks, same
      shape today's task_query produces.
- [ ] When I send *"tasks about the audit"*, semantic / substring matching
      surfaces tasks with "audit" in title or topic. Same behavior as today.
- [ ] Empty results produce a polite "no matching tasks" reply (not an empty
      bubble).

### Story 4 — Dedup, conflicts, and topic tagging preserved

**As a** developer, **I want** the v4 skill's writes to go through the same
executor pipeline as today, **so that** the dedup logic, conflict detection,
and topic auto-tagging that the existing tasks rely on are not silently
dropped.

**Acceptance Criteria:**
- [ ] When the v4 skill creates a task that semantically duplicates an
      existing task, the same dedup behavior fires (today's executor
      decides whether to merge or create — same outcome via v4).
- [ ] When the v4 skill creates a task with a time that conflicts with a
      fixed routine block (per `userLifestyle`), the same time-stripping
      behavior fires.
- [ ] When the v4 skill creates a task whose title matches an existing
      topic by embedding similarity, the topic auto-tag fires (same path
      `topicManager.recordSignal` runs from).

### Story 5 — Dual-path coexistence (per-skill rollback)

**As a** developer, **I want** to flip `task_management` off without
touching code, **so that** if v4 produces wrong writes I can revert
instantly.

**Acceptance Criteria:**
- [ ] Given `setV4SkillsEnabled(["priority_planning", "general_assistant"])`
      (no task_management), when I send *"add a task X"*, then the legacy
      `task_create` path runs (verifiable: no `[skillDispatcher] dispatch
      skill=task_management` log entry; instead the legacy intent
      classification log appears).
- [ ] Given the full enabled set including task_management, the v4 path
      runs. The legacy path is never reached for these phrases.

### Story 6 — Parity on the 10-phrase regression set

**As a** developer, **I want** measurable proof that v4 task_management
behaves equivalently to legacy on real phrasing, **so that** I can delete
the legacy code with confidence.

**Acceptance Criteria:**
- [ ] A regression test fixture file lists 10 phrases (mix of create,
      update, query) with expected outputs for legacy vs. v4 paths.
- [ ] Running the fixture with `setV4SkillsEnabled([])` produces legacy
      results.
- [ ] Running with the v4 enabled set produces v4 results that match the
      legacy results on title/status/priority/due-date fields for ≥ 9/10
      phrases.
- [ ] Diffs on remaining 1/10 phrase are documented and judged as
      acceptable migration drift (or fixed if they're real regressions).

### Story 7 — Legacy cleanup (may defer to follow-on PR)

**As a** developer, **I want** the legacy `task_create` / `task_update` /
`task_query` regex, assembler case, and prompt rules deleted once parity
is proven, **so that** the codebase reflects the actual routing.

**Acceptance Criteria:**
- [ ] After Story 6 passes, the regex entries for these intents in
      `router.ts:PATTERNS` are removed.
- [ ] The `case "task_create": case "task_update": case "task_query":` block
      in `assembler.ts:45-52` is removed.
- [ ] The corresponding entries in `MODEL_BY_INTENT`, `TOKEN_BUDGETS`, and
      the prompts.ts CRUD rules are removed.
- [ ] No dead code references remain. `IntentType` may still include the
      old names temporarily (other intents reference the union); deletion
      from the type union waits until all 3-intent migrations finish.
- [ ] If parity in Story 6 is < 9/10, this story is **deferred** to a
      follow-on PR. FEAT057 ships dual-path; cleanup ships separately
      after parity hits target.

### Story 8 — No regression for non-task intents

**As a** user, **I want** every non-task intent to behave exactly the same
as before FEAT057 ships.

**Acceptance Criteria:**
- [ ] All 277 pre-FEAT057 tests still pass.
- [ ] Manual smoke check on three non-task phrases:
      *"what should I focus on?"* (priority_planning), *"plan my week"*
      (full_planning), *"feeling stressed"* (emotional_checkin) — each
      produces the same response as before FEAT057.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **Migrating `notes_capture` / `bulk_input` intents** — that's the next
  per-intent FEAT (FEAT058). FEAT057 is task-only.
- **Multi-tool dispatch** — if the LLM emits two `tool_use` blocks in one
  response (e.g., user says "I finished both A and B"), the dispatcher
  today picks the first. Either we accept that limitation for now, or the
  skill defines a single tool with an array argument that handles batches.
  Architect call — see Open Question 2.
- **Task-tab UI changes** — the existing tasks tab is unaffected.
- **Recurring task creation** — handled separately by `recurringProcessor`.
  v4 skill writes through the same path; no new recurring logic.
- **Calendar integration** — if the user says "add a task and put it on my
  calendar", calendar handling stays in the calendar intent (which migrates
  in FEAT060+).
- **Audit log of writes** — FEAT056 ships in Phase 3.
- **Privacy filter on task data** — also Phase 3.

---

## Assumptions & Open Questions

**Assumptions:**
- `executor.applyWrites` can be called from a skill handler (not just from
  the legacy chat dispatch path). Architect to verify the function is
  side-effect-clean enough to call from a new entry point.
- The existing `tasksIndex` builder, dedup helper, and topic-tagger are
  already isolated as pure-ish functions OR can be made so via small
  refactor.
- Today's legacy `task_create` prompt rules (priority defaulting, title
  extraction, conflict checking) translate cleanly to a focused skill
  prompt — they're not entangled with non-task intent logic.
- The `setV4SkillsEnabled` array can grow to include task_management
  without breaking the FEAT056 fallback behavior. (general_assistant stays
  in the list as the freeform fallback for unmatched phrases.)

**Open Questions for the Architect:**
1. **Single tool with array args vs. multi-tool dispatch.** Today the LLM
   returns an action plan with a `writes` array. The dispatcher in FEAT055
   picks one `tool_use` block. Two design options:
   - (a) **Single tool `submit_task_action`** with an array argument: handler
     iterates and calls `applyWrites` per item. Matches today's pattern.
     Cleaner with current dispatcher.
   - (b) **Multi-tool dispatch:** dispatcher iterates over multiple
     `tool_use` blocks. More natural for the LLM but requires changes to
     `dispatchSkill` (FEAT055).
   PM proposes (a). Architect to decide.
2. **How does the handler call into existing executor logic?** Three options:
   - (a) Handler imports and calls `executor.applyWrites(state, [{...}])`
     directly. Tightly couples skills to executor.
   - (b) A new helper `executor.applyTaskWrite(state, action)` is exposed
     as the v4-handler-friendly API. Slightly cleaner separation.
   - (c) Handler doesn't call executor at all — the dispatcher returns the
     action plan and a separate post-dispatch step (in chat.tsx?) calls the
     executor. Most decoupled but adds complexity.
   PM proposes (a) — pragmatic. Architect to decide.
3. **Triage's task fast-path.** Today triage has a regex that matches "add
   a task X" and sets `legacyIntent: "task_create"`. After FEAT056 the
   gate ignores `triageLegacyIntent`, so the task fast-path no longer
   forces legacy. v4 will route via embedding. Is that acceptable? Yes,
   per FEAT056 design — but verify task_management's `triggerPhrases`
   are strong enough that "add a task X" matches it via embedding +
   confidence gate.
4. **Where do existing assembler-built fields (`tasksIndex`,
   `contradictionIndexDates`, `topicList`, `existingTopicHints`) live in
   the skill model?** They're all consumed by the prompt context. Two
   options:
   - (a) The minimal context resolver in `skillDispatcher.ts` adds support
     for these keys.
   - (b) `task_management/context.ts` declares simple keys and the
     dispatcher's resolver handles each via dedicated mapping logic.
   PM proposes (a) — extend the resolver. Architect call.
5. **The legacy path's prompt is in `prompts.ts:SYSTEM_PROMPT`** — a 200+
   line prompt for ALL intents. The v4 skill needs its own focused prompt.
   Should we copy the relevant ~30 lines into `task_management/prompt.md`
   and let the rest of `SYSTEM_PROMPT` keep covering legacy intents? Or
   refactor `prompts.ts` to extract per-intent fragments? PM proposes
   the simpler copy — refactor when more skills migrate. Architect call.
6. **Rolling parity-test fixtures.** The 10-phrase set needs to exist as
   a test fixture. Where? A new `src/modules/__fixtures__/task_phrases.ts`
   or co-located in the test file? PM proposes co-located (matches
   skillRegistry.test.ts pattern).
7. **Legacy cleanup PR strategy** (Story 7). Two options:
   - (a) FEAT057 ships everything: skill + legacy cleanup → one PR.
   - (b) FEAT057 ships skill only; **legacy cleanup is FEAT057-cleanup**
     (small follow-on PR after a 48-hour dual-path bake-in).
   PM proposes (b) — safer, gives a window to catch parity issues before
   removing the legacy fallback.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27 (workflow stage 3). Full design
review in `FEAT057_design-review.md` (workflow stage 4).*

### Open-question resolutions (PM proposals confirmed)

| Q | Decision |
|---|---|
| 1 — Single tool vs multi-tool | **Single tool** `submit_task_action` with `writes` array argument. Matches today's ActionPlan shape; no FEAT055 dispatcher refactor. |
| 2 — Handler ↔ executor coupling | **Direct `executor.applyWrites` import** in handler. Pragmatic; avoid premature wrapper. Architect note: when batch 1 finishes, decide whether to extract a v4-handler-friendly helper. |
| 3 — Triage fast-path | Already resolved by FEAT056 B2. Triage fast-path no longer forces legacy. v4 wins via embedding match on `triggerPhrases`. |
| 4 — Context resolver scope | **Extend `skillDispatcher.ts`'s minimal resolver** to support: `tasksIndex`, `contradictionIndexDates`, `topicList`, `existingTopicHints`, `userToday`. Other skills will reuse these keys. |
| 5 — Prompt sourcing | **Copy ~30 task-relevant lines** from `prompts.ts:SYSTEM_PROMPT` into `task_management/prompt.md`. The legacy `SYSTEM_PROMPT` keeps covering non-migrated intents. Refactor when ≥3 skills have migrated. |
| 6 — Test fixture location | **Co-located** in `task_management.test.ts` as a top-of-file constant (matches `skillRegistry.test.ts` pattern). |
| 7 — Legacy cleanup PR strategy | **Two-PR strategy.** FEAT057 ships skill only. Legacy cleanup (regex, assembler case, prompts.ts CRUD rules) is a separate PR after a 48-hour parity bake-in. |

### Data Models

```ts
// src/types/orchestrator.ts (extension — adds items field)

export interface SkillDispatchResult {
  // ...existing fields (skillId, toolCall, handlerResult, userMessage,
  //  clarificationRequired, degraded)...
  /**
   * FEAT057: when a skill produces a list of structured items
   * (task_query results, etc.), the dispatcher copies them through to
   * the consumer so chat.tsx can render the existing ItemListCard.
   */
  items?: import("./index").ActionItem[];
}
```

```ts
// src/skills/task_management/handlers.ts — args shape

interface TaskActionArgs {
  /** User-facing reply string. Required. */
  reply: string;
  /** Writes against the "tasks" file. Empty for pure queries. */
  writes?: Array<{
    action: "add" | "update" | "delete";
    id?: string;
    data: Record<string, unknown>;
  }>;
  /** Items to render (used by query). */
  items?: ActionItem[];
  /** Conflict pre-checks (titles to scan for). */
  conflictsToCheck?: string[];
  /** Optional follow-up suggestions. */
  suggestions?: string[];
  /** Set when LLM needs the user to clarify. */
  needsClarification?: boolean;
}
```

### API Contracts

```ts
// src/modules/skillDispatcher.ts (extension)

// 1. SUPPORTED_KEYS expanded
const SUPPORTED_KEYS = new Set([
  "userProfile", "objectives",
  "recentTasks", "calendarToday", "calendarNextSevenDays",
  // FEAT057 additions:
  "tasksIndex",
  "contradictionIndexDates",
  "topicList",
  "existingTopicHints",
  "userToday",
]);

// 2. resolveContext extended to compute these keys from state when declared
//    by the skill (the existing minimal resolver pattern).

// 3. dispatchSkill copies items off handlerResult to the SkillDispatchResult
//    when the handler returned them.
```

### `task_management` skill folder spec

```
src/skills/task_management/
├── manifest.json
├── prompt.md
├── context.ts
└── handlers.ts
```

**`manifest.json`:**

```jsonc
{
  "id": "task_management",
  "version": "1.0.0",
  "description": "Create, update, query, and delete tasks. Handles 'add a task', 'mark X done', 'show my tasks', 'set priority on Y'. Default priority medium unless urgency is signaled.",
  "triggerPhrases": [
    "add a task",
    "create a todo",
    "remind me to",
    "mark X done",
    "delete the task",
    "show me my tasks",
    "what tasks do I have",
    "set priority",
    "tasks about",
    "cancel the task"
  ],
  "structuralTriggers": ["/task", "/todo"],
  "model": "haiku",
  "dataSchemas": {
    "read": ["tasks", "calendar", "topics", "objectives"],
    "write": ["tasks"]
  },
  "supportsAttachments": false,
  "tools": ["submit_task_action"],
  "autoEvaluate": true,
  "tokenBudget": 3000,
  "promptLockedZones": [],
  "surface": null
}
```

**`prompt.md`** (~30 lines, copied + adapted from `SYSTEM_PROMPT`):
- Focused on task CRUD only
- Always uses `submit_task_action` tool
- Default priority = medium unless urgency signaled
- For updates/deletes: always include task id from `tasksIndex`
- For queries: populate `items` array, leave `writes` empty
- For ambiguous matches: set `needsClarification=true`, list candidates
  in the reply
- Conflict checking via `conflictsToCheck` against existing titles

**`context.ts`:**

```ts
import type { ContextRequirements } from "../../types/skills";

export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  tasksIndex: true,
  contradictionIndexDates: true,
  topicList: true,
  existingTopicHints: true,
};
```

**`handlers.ts`:**

```ts
import type { ToolHandler } from "../../types/skills";
import type { ActionPlan, AppState, ActionItem } from "../../types";
import { applyWrites } from "../../modules/executor";

export const submit_task_action: ToolHandler = async (args, ctx) => {
  const a = args as unknown as TaskActionArgs;
  const state = (ctx as { state?: AppState }).state;

  // Validate: all writes target the "tasks" file (defense in depth)
  const writes = (a.writes ?? []).filter(
    (w) => true // architect: tighten if needed (verify file=="tasks")
  ).map((w) => ({
    file: "tasks" as const,
    action: w.action,
    id: w.id,
    data: w.data,
  }));

  // Build a minimal ActionPlan — applyWrites uses fields beyond writes
  // (conflictsToCheck, items for downstream rendering); we pass-through
  // what the LLM gave us.
  const plan: ActionPlan = {
    reply: a.reply ?? "",
    writes,
    items: (a.items ?? []) as ActionItem[],
    conflictsToCheck: a.conflictsToCheck ?? [],
    suggestions: a.suggestions ?? [],
    memorySignals: [],
    topicSignals: [],
    needsClarification: Boolean(a.needsClarification),
  };

  // Execute writes through the existing executor (dedup, conflicts,
  // topic-tagging, lifestyle validation all preserved).
  if (state) {
    await applyWrites(plan, state);
  } else {
    // No state in test context — handler returns the plan as data so the
    // test can assert it without requiring a real executor.
  }

  return {
    success: true,
    userMessage: plan.reply,
    clarificationRequired: plan.needsClarification,
    items: plan.items,
    data: { writes: plan.writes, items: plan.items, suggestions: plan.suggestions },
  };
};
```

### Boot wiring

```ts
// app/_layout.tsx — extend the FEAT056 array
setV4SkillsEnabled(["priority_planning", "general_assistant", "task_management"]);
```

### chat.tsx integration (FEAT056 hook extension — minor)

The existing v4 hook already wires `dispatchResult.userMessage` and
`v4Meta`. To support task_query rendering, it must also pass
`dispatchResult.items` onto the message. Single-line change:

```tsx
setMessages((m: Message[]) => [...m, {
  role: "assistant" as const,
  content: dispatchResult.userMessage,
  timestamp: now,
  isQuestion: dispatchResult.clarificationRequired,
  items: dispatchResult.items,                   // ← NEW
  v4Meta: { skillId, confidence, routingMethod },
}]);
```

### Service Dependencies

| Internal | Used for |
|---|---|
| `src/modules/executor.ts` (`applyWrites`) | Persists writes; dedup, conflicts, topic-tagging |
| `src/modules/assembler.ts` (`buildTaskIndex`) | Context resolver imports this helper |
| `src/modules/skillRegistry.ts` (FEAT054) | Boot loading |
| `src/modules/router.ts` (FEAT051) | Routing |
| `src/modules/skillDispatcher.ts` (FEAT055/057-extended) | Dispatch |

No third-party deps added.

### Design Patterns

- **One tool, array writes** — matches today's ActionPlan structure;
  handler is essentially a pass-through to `applyWrites`.
- **Direct executor coupling** for v2.02 pragmatism. The handler imports
  `applyWrites` directly. If batch 1 reveals this coupling is awkward
  (e.g., circular imports, hard-to-test), refactor to a v4-handler API
  (`executor.applyTaskWrite`) in a follow-on. Don't pre-optimize.
- **Resolver extended once, consumed by all** — the 5 new context keys
  added to `skillDispatcher.ts` will be reusable by FEAT058 (notes),
  FEAT060 (calendar), etc. One change benefits the whole batch.
- **Items pass-through on `SkillDispatchResult`** — the dispatcher reads
  `handlerResult.items` and copies to its return value. Other skills
  (FEAT083 Topics digest) will use this same field for their list output.

### New vs. Reusable Components

**New:**
- `src/skills/task_management/` (4 files)
- `src/modules/skillDispatcher.ts` extensions (5 keys + items pass-through)
- `src/types/orchestrator.ts` extension (items? on SkillDispatchResult)
- `src/skills/task_management.test.ts` test file with 10-phrase regression
  fixture (Story 6)

**Touched:**
- `app/_layout.tsx` — append `"task_management"` to enabled set
- `app/(tabs)/chat.tsx` — pass `dispatchResult.items` onto rendered message

**Reusable as-is:**
- `executor.applyWrites` — no changes
- `assembler.buildTaskIndex` — exported and reused by the dispatcher's
  resolver for the `tasksIndex` key (small refactor: make it exported)

### Risks & Concerns

- **Context resolver expansion is the riskiest change.** Five new keys
  added to `SUPPORTED_KEYS` means the dispatcher must compute each from
  state. If any computation is wrong, the skill prompt gets stale or
  missing data. Mitigation: the dispatcher's existing minimal resolver
  pattern is "look up the key on state by name"; for `tasksIndex` etc. we
  need to call helper functions. Tests assert each key resolves to the
  expected shape.
- **Direct `executor.applyWrites` coupling** brings the executor's full
  side-effect surface (dedup, conflict checks, topic-tagging, lifestyle
  validation) into the v4 dispatch path. If executor logic has bugs that
  legacy chat.tsx happened to dodge, v4 will hit them. Mitigation: the
  10-phrase regression test runs both paths with the same input and
  compares; any divergence is a real regression.
- **Parity threshold (≥9/10)** is judgmental. Some divergence (different
  reply phrasing, slightly different conflict warnings) is acceptable as
  migration drift; some (wrong write target, lost task data) is a
  regression. The Tester (stage 7) has to make the call per-phrase.
- **`buildTaskIndex` is currently a private helper in assembler.ts.** It
  must be exported for the resolver to reuse. Small refactor; safe.
- **Prompt drift between legacy and v4.** The copied prompt text in
  `task_management/prompt.md` will diverge from `SYSTEM_PROMPT` over
  time as either is tuned. Mitigation: legacy cleanup PR (Story 7,
  follow-on) deletes the legacy CRUD lines from `SYSTEM_PROMPT`.

### UX Review Notes

UX scope is zero new screens. The existing `ItemListCard` renders v4
query results identically to legacy via the `items` field on
`ChatMessage`. The v4 badge ("via task_management") is the only new
visual.

### Testing Notes

#### Unit Tests Required
- Manifest validates and loads via FEAT054 (smoke check at boot).
- Handler with stubbed executor: assert `applyWrites` called with the
  right `WriteOperation[]` shape for create / update / delete cases.
- Handler with no state in ctx returns plan in `data` (test mode).
- Handler propagates `clarificationRequired` and `items` correctly.

#### Component Tests Required
- Dispatcher's extended resolver: each new key (`tasksIndex`,
  `contradictionIndexDates`, `topicList`, `existingTopicHints`,
  `userToday`) resolves to the expected shape from a fixture state.
- Dispatcher pass-through: `handlerResult.items` appears in the
  `SkillDispatchResult.items` field.

#### Integration Tests Required
- End-to-end with stub LLM: phrase → orchestrator → dispatcher → handler
  → executor.applyWrites → state mutated → reply rendered.
- 10-phrase regression test (Story 6): co-located fixture, runs both
  legacy and v4 paths against the same fixture state, diffs the
  resulting writes/items.

#### Regression Tests Required
- Full `npm test` passes (current 277 baseline → 277+ new).
- `npm run build:web` exports.

#### Scope Isolation Tests Required
**No** — privacy filter ships in Phase 3.

#### Agent Fixtures Required
**No** — handler tests use stub LLM. The 10-phrase regression test
uses canned LLM responses (one per phrase) so it's deterministic.

---

## UX Notes

[**To be filled after architect review.** UX scope: zero new screens. Replies
should match today's confirmation style. The "via task_management" badge
appears on assistant bubbles — same FEAT056 mechanism.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.** Required:
- Unit tests for the skill folder loader (already covered by FEAT054)
- Unit tests for handlers with stubbed executor (assert applyWrites called
  with right args)
- Integration tests with stubbed LLM emitting realistic tool_use blocks
- 10-phrase regression set (Story 6) — co-located in skill test file
- Bundle gate (`npm run build:web`)
- Manual smoke after merge: 5 task phrases via v4, 5 via legacy with
  `setV4SkillsEnabled([])`, compare outputs]
