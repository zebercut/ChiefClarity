# FEAT032 — Tasks tab learning loop for adaptive priority weights

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** COULD
**Category:** Tasks
**Priority:** 4
**Release:** v2.4
**Tags:** tasks, ui, learning, hitl, tasks-tab
**Created:** 2026-04-06

**Parent:** [FEAT028 — Tasks tab MVP](../FEAT028_Tasks_tab_with_prioritized_view_search_grouping_and_filtering/FEAT028_Tasks_tab_with_prioritized_view_search_grouping_and_filtering.md)
**Depends on:** FEAT031 (learning loop analyzes the `TaskPriorityCorrection` log that FEAT031 produces) and FEAT030 (needs RICE factor weights to adjust)

---

## Summary

Close the HITL loop: analyze the `FeedbackMemory.corrections` log produced by FEAT031, detect patterns in the user's corrections, and proactively propose adjustments to the RICE factor weights. When the user accepts a proposed adjustment, the new weights land in `UserLifestyle.taskPriorityPreferences` and are applied as factor-level multipliers in future scoring — reducing the number of repeat corrections the user has to make.

This is the most speculative phase of the Tasks tab family and is tagged **COULD**. It only makes sense once FEAT031 is shipped and the corrections log has accumulated enough data to analyze.

---

## Problem Statement

With FEAT031, users can correct the ranking but have to repeat the same correction every time the pattern recurs. For example: if the user consistently demotes OKR-linked tasks during morning focus hours (because they'd rather do deep work on actual deliverables), they shouldn't have to re-demote those tasks every morning — the system should notice and offer to lower the OKR weight during focus hours.

---

## User Stories

### Story 1 — Pattern detection
**As a** system, **I need** to detect repeating patterns in the user's HITL corrections, **so that** I can offer to adjust defaults instead of making the user correct repeatedly.

**Acceptance Criteria:**
- [ ] Given `FeedbackMemory.corrections` contains 5+ `TaskPriorityCorrection` entries matching a pattern, when `hitlLearner` runs, then the pattern is detected
- [ ] Given a pattern is detected, when `hitlLearner` computes a proposed weight adjustment, then the adjustment is deterministic and explainable
- [ ] Given no pattern reaches the 5-entry threshold, when `hitlLearner` runs, then no proposal is generated (silent)
- [ ] Pattern detection runs on a schedule (e.g. once per day) or after every N corrections — to be decided in implementation

### Story 2 — One-tap acceptance
**As a** user, **I want** to see a proposed adjustment as a one-tap card with a plain-language explanation, **so that** I can accept or dismiss without reading a configuration screen.

**Acceptance Criteria:**
- [ ] Given a proposal is ready, when the user opens the Tasks tab, then a "Priority feedback" card appears at the top
- [ ] Given the card is visible, when the user reads it, then it shows plain-language text ("You often demote OKR-linked tasks. Lower OKR weight by 20%?")
- [ ] Given the user taps "Apply", when the write completes, then `UserLifestyle.taskPriorityPreferences` is updated and the list re-sorts
- [ ] Given the user taps "Dismiss", when the card closes, then the proposal is marked as dismissed and doesn't re-appear for 30 days
- [ ] Given multiple proposals exist, when the card renders, then only one shows at a time (queue the rest)

### Story 3 — Transparency and reversibility
**As a** user, **I want** to see which learned weights are currently active and revert them if they feel wrong, **so that** the system can't silently drift away from what I want.

**Acceptance Criteria:**
- [ ] Given learned weights are applied, when the user opens the Why-this-rank sheet (from FEAT030), then applied weights are listed with their source ("Learned: OKR weight x0.8")
- [ ] Given a settings screen exists (or is added), when the user views "Priority preferences", then they can toggle off / reset any learned weight
- [ ] Given the user resets a weight, when the list re-renders, then the default weight is restored

---

## Type Extensions

### Modification to `UserLifestyle` in `src/types/index.ts`

```typescript
export interface UserLifestyle {
  // ... existing fields unchanged
  taskPriorityPreferences?: {
    factorWeights?: {
      reach?: number;       // Multiplier, default 1.0
      impact?: number;      // Multiplier, default 1.0
      confidence?: number;  // Multiplier, default 1.0
      effort?: number;      // Multiplier, default 1.0 (note: higher effort weight = more penalty)
    };
    timeOfDayOverrides?: Record<string, Partial<{
      reach: number;
      impact: number;
      confidence: number;
      effort: number;
    }>>;
    dismissedProposals?: Array<{
      pattern: string;
      dismissedAt: string;  // ISO; re-propose after 30 days
    }>;
  };
}
```

No new top-level types — all changes nest under `taskPriorityPreferences`.

---

## Pattern Detection Strategy

`src/modules/hitlLearner.ts` scans `FeedbackMemory.corrections` where `kind === "task_priority"` and groups them by shared attributes of the task snapshot (resolved at read time from `tasks.json`):

| Pattern | Detection rule | Proposed adjustment |
|---------|----------------|---------------------|
| Consistently demotes OKR-linked | 5+ `bump_down` on tasks with `okrLink !== null` | Reduce Reach/Impact OKR bonus by 20% |
| Consistently promotes low-priority quick tasks | 5+ `bump_up` on tasks with `priority: "low"` and `timeAllocated < 30min` | Lower Effort weight for sub-30min tasks |
| Consistently snoozes during specific hours | 5+ snoozes clustered in a time window | Add a `timeOfDayOverride` for that window |
| Consistently pins same category | 3+ `pin` on tasks sharing a `category` | Boost Reach/Impact for that category by 20% |

All pattern rules are **pure functions** over the corrections log + current tasks snapshot. Unit-testable with fixture data.

---

## Architecture Notes

### Sacred boundary

- **Pattern detection** is deterministic TypeScript in `src/modules/hitlLearner.ts`. No LLM involvement.
- **The decision to show the card** is deterministic (threshold + dismissal window check).
- **Only the card's natural-language text** may optionally be generated by the LLM — and even that should be a hardcoded template in v1. LLM generation for card text is an optional polish, not a dependency.

### Scheduling

`hitlLearner` runs as a lightweight function called:
1. Once per day via the headless runner
2. On Tasks tab focus (cached; re-run only if corrections log has grown)

Returns `Proposal[]` where each proposal has `{ pattern, humanText, adjustment, confidence }`. The tab UI decides whether to show the top-confidence proposal as a card.

### No new data files

Everything uses existing files: `feedback_memory.json` (read), `user_lifestyle.json` (read/write), `tasks.json` (read). No new JSON files are introduced.

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/types/index.ts` | Add optional `taskPriorityPreferences` on `UserLifestyle` |
| `src/modules/hitlLearner.ts` | **NEW** — pattern detection functions, proposal generation |
| `src/modules/hitlLearner.test.ts` | **NEW** — unit tests for each pattern rule with fixture corrections |
| `src/modules/taskPrioritizer.ts` | Apply factor-level multipliers from `taskPriorityPreferences` before RICE formula |
| `src/modules/taskPrioritizer.test.ts` | Add tests for learned-weight application |
| `src/components/PriorityFeedbackCard.tsx` | **NEW** — "Apply learned preference" one-tap card |
| `app/(tabs)/tasks.tsx` | Render `PriorityFeedbackCard` when proposals exist |
| `src/components/WhyThisRankSheet.tsx` | Show active learned weights alongside RICE factors (updates FEAT030's component) |
| `scripts/headless-runner.js` | Schedule daily `hitlLearner` run |
| `docs/new_architecture_typescript.md` | Update Sections 4, 5, 6, 12 |

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User dismisses a proposal | Add entry to `dismissedProposals`; re-propose after 30 days |
| User accepts then reverts a learned weight | Revert clears the weight from `taskPriorityPreferences`; add a "reverted" marker in corrections log for future learning |
| Corrections log has mixed patterns | Detect independently; queue proposals by confidence, show highest first |
| Pattern confidence is borderline | Define a minimum confidence threshold (e.g. 0.7) below which no card shows |
| User is on a new device with empty corrections log | No proposals generated; no card shown; silent fallback to defaults |
| Learned weight makes ranking worse | User reverts via the Why-this-rank sheet; no silent drift |

---

## Success Metrics

- After 2 weeks of use, at least 1 proposal has been shown and accepted (qualitative user check)
- Rate of repeat corrections drops after a proposal is accepted (measurable via the corrections log)
- No user complaint that "the order randomly changed" — all changes are proposal-gated

---

## Testing Notes

- [ ] Unit: Each pattern detection rule produces correct proposals for fixture inputs
- [ ] Unit: Dismissal window prevents re-proposal for 30 days
- [ ] Unit: Learned weights apply as multipliers, not additive, in RICE formula
- [ ] Unit: Reverting a learned weight restores the default
- [ ] Integration: Corrections accumulate -> card appears -> user accepts -> list re-sorts
- [ ] Integration: Headless runner schedule fires `hitlLearner` daily
- [ ] Manual: Seed 5+ corrections of a known pattern -> verify correct card text

---

## Open Questions

- How often should `hitlLearner` run? Every N corrections, once per day, or on Tasks tab focus? **Recommended: on Tasks tab focus, debounced to once per 24h.**
- Should learned weights be user-scoped only, or also time-of-day-scoped from the start? **Recommended: user-scoped in v1. Time-of-day overrides as a stretch goal within this feature.**
- Should the card text be templated or LLM-generated? **Recommended: hardcoded templates in v1. LLM generation is an optional polish that doesn't block shipping.**
- Should dismissed proposals expire after 30 days exactly, or on a sliding window based on new correction count? **Recommended: 30 days flat, keep it simple.**
- What's the minimum corrections count for confidence? **Recommended: 5. Tune after dogfooding.**
