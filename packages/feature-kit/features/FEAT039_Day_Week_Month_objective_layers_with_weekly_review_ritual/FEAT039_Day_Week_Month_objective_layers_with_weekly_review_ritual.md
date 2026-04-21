# FEAT039 — Day / Week / Month objective layers with weekly review ritual

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Focus Planning
**Priority:** 1
**Release:** v2.3
**Tags:** objectives, planning, okr, weekly-review, focus
**Created:** 2026-04-07

**Independent of:** FEAT037, FEAT038 — they improve assembler accuracy; this feature reshapes the planning model.
**Dependency for:** FEAT040 — calendar admission control needs the day/week objective layers to compute impact.

---

## Summary

Today the focus brief mixes two very different things into one fluid LLM-generated artifact: **stable calendar commitments** and **volatile objectives** (tasks, goals, moving targets). Every time the brief is regenerated, the LLM "re-decides" things that were already decided, which causes drift, wrong-day placement, and a sense that the plan can't be trusted.

This feature introduces three explicit **objective layers** as first-class data:

- **Monthly objectives** — anchored to the existing OKR dashboard
- **Weekly objectives** — set during a Monday-morning review ritual, derived from monthly
- **Daily objectives** — derived each morning from weekly + today's free calendar blocks

The calendar stays untouched as the source of truth for committed time. Tasks stay in `tasks.json`. The new `objectives.json` is the hierarchical projection that keeps the user focused.

This unlocks FEAT040 (calendar admission control) which needs to know which weekly objectives depend on which time blocks.

---

## Problem Statement

The current focus brief has three structural issues:

1. **Drift** — every regeneration re-decides task placement, so what was on Tuesday yesterday is on Thursday today.
2. **No finite daily commitment** — the user sees a curated brief but it's not bounded by real free time; it's aspirational.
3. **No traceability** — there's no way to say "this daily objective exists because this weekly objective demands it, which exists because this monthly OKR demands it."

Without explicit objective layers, the system cannot answer "what really matters this week?" with anything more than a guess, and FEAT040's impact analysis has nothing to protect.

---

## User Stories

### Story 1 — Weekly review ritual
**As a** user, **I want** the system to walk me through setting 5–8 weekly objectives every Monday morning **so that** I start the week with a finite, intentional commitment.

**Acceptance Criteria:**
- [ ] Headless runner triggers a "weekly review" nudge every Monday at the user's wake time.
- [ ] The nudge opens a chat flow that proposes candidates from active OKRs and open high-priority tasks.
- [ ] The user can accept, edit, or remove each candidate.
- [ ] On confirmation, `objectives.json` `week.items` is populated.

### Story 2 — Daily projection
**As a** user, **I want** my daily objectives to be derived automatically from my weekly objectives plus today's calendar **so that** I never wake up to an empty or stale plan.

**Acceptance Criteria:**
- [ ] Headless morning job derives `day.items` from `week.items` + today's free blocks.
- [ ] Each daily item has an `estimatedMinutes` and an optional `scheduledBlock`.
- [ ] If today is calendar-saturated, fewer items are projected (no overflow).

### Story 3 — Time-estimate learning
**As a** user, **I want** the LLM to estimate how long each objective takes **so that** the system can do honest capacity math.

**Acceptance Criteria:**
- [ ] When a weekly objective is created, the LLM provides an `estimatedHours` value.
- [ ] The user can correct the estimate; corrections become observations.
- [ ] `userObservations` accumulates an estimation-bias signal per category.

### Story 4 — Stable monthly anchor
**As a** user, **I want** my monthly layer to be a thin reference to my existing OKRs **so that** I don't maintain two parallel goal systems.

**Acceptance Criteria:**
- [ ] `month.items` references existing OKR objective ids; no duplication of titles or KRs.

---

## Workflow

### Weekly review (Mondays)

```
Headless runner (Monday wake time)
    ↓
Emits nudge: "Time for weekly review"
    ↓
User opens chat → triggers `weekly_review` intent
    ↓
LLM proposes candidates:
    - Active OKR objectives (from planOkrDashboard)
    - High-priority tasks not yet weeklied
    - Carryover from last week's unfinished items
    ↓
User picks 5–8 → confirms estimates → set scheduledBlock hints
    ↓
Writes objectives.json week.items
```

### Daily projection (every morning)

```
Headless morning job
    ↓
Read objectives.json week.items
Read today's calendar (free blocks via agendaMerger)
    ↓
deriveDailyObjectives()
    ├── Filter weekly items needing focus blocks
    ├── Match against today's free blocks (greedy fit)
    ├── Cap at total available minutes
    └── Mark survival mode if calendar > 80% saturated
    ↓
Write objectives.json day.items
    ↓
Focus brief reads day.items as the "today" panel
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User skips weekly review | Carry last week's `week.items` forward; show stale badge after 7 days |
| User has no active OKRs | Allow weekly objectives without OKR link; flag in stats |
| Today is calendar-saturated (>80% booked) | Project 0–1 daily items; system enters "survival mode" |
| Weekly item has no time estimate | LLM provides one at creation; user can correct later |
| User completes a daily item early | Free its block; do NOT auto-promote next item (require user confirmation) |
| User adds a new task mid-week | Task lives in `tasks.json`; does NOT auto-enter weekly objectives |
| Holiday or PTO day | Lifestyle marker reduces available capacity; daily items shrink accordingly |

---

## Success Metrics

- 80%+ weekly review completion rate after 4 weeks of use.
- Daily objectives' estimated minutes ≤ available focus minutes (no overflow).
- User-reported "I know what matters this week" sentiment improves.
- Estimation bias per category narrows over time (observations data).

---

## Out of Scope

- Calendar admission control / impact analysis → FEAT040 (depends on this)
- Multi-user shared objectives → never (this is a personal app)
- Gantt-style cross-week visualization → defer
- Replacing the existing OKR dashboard UI → no, OKRs remain the monthly layer
- Automatic time tracking → defer (only user-confirmed completion)

---

## Architecture Notes

### New data file: `data/plan/objectives.json`

```typescript
export interface ObjectivesFile {
  month: {
    period: string;                    // "2026-04"
    items: { okrObjectiveId: string }[];   // references planOkrDashboard
  };
  week: {
    period: string;                    // "2026-W15"
    items: WeeklyObjective[];
  };
  day: {
    date: string;                      // "2026-04-07"
    items: DailyObjective[];
    survivalMode: boolean;
  };
}

export interface WeeklyObjective {
  id: string;
  title: string;
  linkedOkrId: string | null;          // optional KR id
  linkedTaskIds: string[];             // tasks that contribute
  estimatedHours: number;              // LLM-seeded, user-correctable
  needsFocusBlock: boolean;            // ambient vs. block-requiring
  status: "open" | "in_progress" | "done" | "deferred";
}

export interface DailyObjective {
  id: string;
  title: string;
  weeklyObjectiveId: string;
  linkedTaskId: string | null;
  estimatedMinutes: number;
  scheduledBlock: string | null;       // "09:00-10:30"
  status: "open" | "done" | "skipped";
}
```

### New module: `src/modules/objectives.ts`

- `loadObjectives(state)`
- `proposeWeeklyCandidates(state)` — pure TS, returns ranked candidates from OKRs + tasks + carryover
- `deriveDailyObjectives(weeklyItems, freeBlocks, lifestyle)` — pure TS, greedy fit
- `confirmWeeklyReview(picks)` — writes through executor

### New intent: `weekly_review`

- Router pattern for `weekly_review`, `weekly review`, `let's plan the week`, etc.
- Assembler context: OKR dashboard + open tasks + last week's `week.items` + carryover candidates.
- Token budget: ~3500 (similar to `full_planning`).
- Model: Sonnet (heavy — judgment-intensive).

### Headless runner additions

- Monday morning: emit `weekly_review_due` nudge if `objectives.week.period` ≠ current ISO week.
- Every morning: run `deriveDailyObjectives()` and write `day.items`.

### Sacred boundary check

- TypeScript owns: file shape, period math, free-block fitting, status transitions, carryover logic.
- LLM owns: candidate ranking judgment during weekly review, time estimates at creation, natural-language summaries.
- New file follows the same `_dirty`/flush pattern as existing data files.

---

## Implementation Notes

| File | Change |
|------|--------|
| `data/plan/objectives.json` | NEW — created by `loader.ts` initData with empty defaults |
| [src/types/index.ts](../../../../src/types/index.ts) | NEW types: `ObjectivesFile`, `WeeklyObjective`, `DailyObjective`; add `objectives` to `AppState` and `FileKey`. |
| `src/modules/objectives.ts` | NEW module — propose, derive, confirm. |
| [src/modules/loader.ts](../../../../src/modules/loader.ts) | Load `objectives.json`; default if missing. |
| [src/modules/router.ts](../../../../src/modules/router.ts) | New `weekly_review` intent pattern. |
| [src/modules/assembler.ts](../../../../src/modules/assembler.ts) | New context case for `weekly_review`. |
| [src/modules/executor.ts](../../../../src/modules/executor.ts) | Write handlers for `objectives` file (add/update day items, week items, decisions). |
| [src/constants/prompts.ts](../../../../src/constants/prompts.ts) | New prompt section for weekly review behavior + estimation rules. |
| `scripts/headless-runner.js` | Monday weekly-review nudge; daily `deriveDailyObjectives` job. |
| [src/modules/llm.ts](../../../../src/modules/llm.ts) | Add `weekly_review` to heavy-model intent list. |
| `docs/new_architecture_typescript.md` | Update Sections 3, 4, 5, 6, 8, 12 for the new file/module/intent. |
| `README.md` | Document the weekly review ritual and `objectives.json`. |

---

## Testing Notes

- [ ] Unit test: `proposeWeeklyCandidates` ranks OKR-linked tasks above unlinked.
- [ ] Unit test: `deriveDailyObjectives` respects free-block capacity.
- [ ] Unit test: survival mode triggers when calendar > 80% saturated.
- [ ] Integration test: `weekly_review` intent writes `week.items`.
- [ ] Integration test: morning job updates `day.items` without touching `week.items`.
- [ ] Manual test: skip weekly review for 8 days → stale badge appears.

---

## Open Questions

- Should weekly objectives carry a `priority` (must / should / could) to inform impact analysis severity? Recommendation: yes — `must` items trigger high-severity impact warnings in FEAT040, `could` items trigger soft warnings.
- Should daily objectives auto-create calendar holds for their `scheduledBlock`? Recommendation: no — keep calendar reserved for user-committed events only. Holds would blur the boundary.
- Where do recurring daily habits (journaling, exercise) live? Recommendation: keep in `recurring_tasks.json`; they surface as ambient daily items with `needsFocusBlock: false`.
