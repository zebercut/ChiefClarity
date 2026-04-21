# FEAT037 — Core context floor and pre-computed assembler views for cross-domain accuracy

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** LLM Pipeline
**Priority:** 1
**Release:** v2.2
**Tags:** assembler, accuracy, context, calendar, tasks
**Created:** 2026-04-07

**Independent of:** FEAT038, FEAT039, FEAT040 — can ship standalone.

---

## Summary

Every LLM call today receives a narrowly-sliced context based on a single classified intent. As a result, `task_*` intents see no calendar, `calendar_*` intents see no tasks, and `topic_query` sees no calendar. The LLM is then asked to make placement and judgment decisions across domains it cannot see, which produces "wrong day" / "missing information" errors.

This feature introduces a small **core context floor** that every intent receives in addition to its intent-specific slice, plus two **pre-computed views** that stop asking the LLM to do date math:

- `calendarByDay` — next 7 days bucketed by `YYYY-MM-DD (Day)` with free-block summaries
- `taskIndex.dueBucket` — every task carries an explicit `overdue | today | tomorrow | this_week | later` label

Estimated added cost: ~400–500 tokens per call.

---

## Problem Statement

Three concrete failure modes observed today:

1. **"Can I fit task X this week?"** — routed to `task_*`, assembler ships task index only, LLM has no calendar to reason about. Answer is guessed.
2. **"Do I have time tomorrow for the report?"** — routed to `calendar_*`, assembler ships calendar only, LLM cannot weigh competing tasks. Answer ignores workload.
3. **"When is the next meeting about [topic]?"** — routed to `topic_query`, assembler ships topic file only, LLM cannot find related calendar events. Answer is "I don't know" or hallucinated.

Shared root cause: context slices are too narrow per the assembler matrix in `docs/new_architecture_typescript.md` Section 6, and the LLM must mentally compute date arithmetic from raw ISO timestamps.

---

## User Stories

### Story 1 — Cross-domain task questions
**As a** user, **I want** to ask "can I fit a 2-hour deep work block tomorrow?" **so that** the system answers using both my calendar and my task workload, not one or the other.

**Acceptance Criteria:**
- [ ] Given a `task_query` intent, when context is assembled, then it includes `core.calendarByDay` for the next 7 days.
- [ ] Given the LLM's response, when it suggests a time, then the time falls within a listed `freeBlocks` entry.

### Story 2 — Topic-aware scheduling answers
**As a** user, **I want** to ask "when is the next meeting about [topic]?" **so that** the LLM can match the topic name against calendar events without me invoking a topic intent.

**Acceptance Criteria:**
- [ ] Every intent receives `core.topicList` with topic names and last-touched dates.

### Story 3 — Reliable day placement
**As a** user, **I want** the system to never put a task on a day where I have no free time, **so that** my plan is honest about what I can actually do.

**Acceptance Criteria:**
- [ ] Prompt instructs the LLM to use only `freeBlocks` slots and to set `needsClarification: true` when none fit.

---

## Workflow

```
User phrase
    ↓
router.classifyIntent()              [unchanged]
    ↓
assembler.assembleContext(intent)
    ├── buildCoreContextFloor()      [NEW — runs for every intent]
    │     ├── computeCalendarByDay(7 days)
    │     ├── topTasks with dueBucket
    │     ├── topicList (names + dates)
    │     ├── activeOkrTitles
    │     ├── todaySchedule (one line)
    │     └── deepWorkWindow
    ├── intentSpecificSlice          [unchanged, minus duplicated fields]
    └── merge under { core, ...rest }
    ↓
llm.callLlm()                        [unchanged]
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| `full_planning` already has calendar + tasks | Skip floor fields it already has, keep `topicList` + `activeOkrTitles` |
| User has no events for next 7 days | `calendarByDay` keys still exist; `events: []`, `freeBlocks` reflects full day per lifestyle |
| User has no active OKRs | `activeOkrTitles: []` |
| Token budget exceeded after adding floor | Truncate `topTasks` first, then `topicList` |
| Same turn calls assembler twice | Memoize floor for the duration of one turn |

---

## Success Metrics

- Reduction in "wrong day" / "missed information" complaints in manual testing.
- 0 hallucinated time slots (LLM only schedules into listed `freeBlocks`).
- No measurable latency regression (<50ms added per turn).

---

## Out of Scope

- Multi-intent routing → FEAT038
- New objective layers → FEAT039
- Calendar admission control / impact warnings → FEAT040
- Changing per-intent token budgets beyond +500
- Modifying the LLM tool schema

---

## Architecture Notes

### Data shapes

```typescript
interface CoreContextFloor {
  calendarByDay: Record<string, {       // key: "2026-04-07 (Tue)"
    events: { id: string; title: string; time: string; durationMin: number }[];
    freeBlocks: string[];               // ["09:00-11:30", "14:00-17:00"]
  }>;
  topTasks: {
    id: string;
    title: string;
    dueBucket: "overdue" | "today" | "tomorrow" | "this_week" | "later";
    priority: string;
  }[];
  topicList: { name: string; lastTouched: string }[];
  activeOkrTitles: string[];
  todaySchedule: string;
  deepWorkWindow: string | null;
}
```

### Reuse opportunities

- `agendaMerger.computeFreeBlocks()` already exists — reuse for `calendarByDay`.
- `taskFilters.dueBucketOf()` already exists — pipe into the assembler's task index builder.
- `taskPrioritizer.ts` already exists — reuse for `topTasks` ranking.

### Sacred boundary check

- TypeScript computes the floor (deterministic data shaping).
- LLM only consumes it.
- No new LLM calls.

---

## Implementation Notes

| File | Change |
|------|--------|
| [src/modules/assembler.ts](../../../../src/modules/assembler.ts) | New `buildCoreContextFloor(state, intent)`; merge into every intent context; skip duplicated fields for `full_planning` and `bulk_input`. |
| [src/modules/agendaMerger.ts](../../../../src/modules/agendaMerger.ts) | Export `computeFreeBlocks` if not already exported. |
| [src/modules/taskFilters.ts](../../../../src/modules/taskFilters.ts) | Ensure `dueBucketOf` is exported and used by the assembler. |
| [src/constants/prompts.ts](../../../../src/constants/prompts.ts) | Add scheduling rule referencing `core.calendarByDay[date].freeBlocks`. |
| `docs/new_architecture_typescript.md` | Update Section 6 (Assembler Context by Intent) and Section 8 (Token Budgets) to reflect the floor. |

---

## Testing Notes

- [ ] Unit test: `buildCoreContextFloor` returns 7 days, correct free blocks for a known fixture.
- [ ] Unit test: `topTasks` items all carry a valid `dueBucket`.
- [ ] Integration test: `task_query` context contains `core` block.
- [ ] Integration test: `calendar_query` context contains `core` block (not duplicated calendar).
- [ ] Integration test: `topic_query` context contains `core.topicList`.
- [ ] Manual test: ask "fit a 2-hour focus block tomorrow?" and verify the LLM cites a real free block.

---

## Open Questions

- Should the floor be added to `bulk_input`? It already has 4500 tokens and includes most of the floor's data — likely skip.
- Should `topicList` be capped (e.g., 20 most recent topics)? Probably yes if the user has hundreds.
