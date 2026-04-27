# FEAT049 — Weekly retrospective with leverage and adherence scoring

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Focus Planning
**Priority:** 2
**Release:** v2.3
**Tags:** retro, planning, weekly-review, leverage, adherence
**Created:** 2026-04-22

**Depends on:** FEAT039 — objective layers provide the planned-vs-done data this feature scores against.
**Feeds into:** FEAT039's weekly review — retro output becomes input for the next week's objective-setting.

---

## Summary

A structured end-of-week retrospective that helps the user evaluate what actually happened versus what was planned. The user classifies each completed item by work type (leverage, aligned, noise, someone else's priority), and the system scores calendar adherence and to-do adherence across four dimensions. The retro produces a weekly scorecard with trend lines, and its output feeds directly into the next week's planning ritual (FEAT039).

---

## Problem Statement

Today, the user finishes a week with no structured way to answer:

1. **"Did I do what I said I would?"** — There is no comparison of planned objectives vs. actual completions.
2. **"Was the work I did actually valuable?"** — Completed tasks are treated equally; there is no distinction between high-leverage work that moves OKRs forward and reactive noise that consumed time without advancing goals.
3. **"Did I respect my own calendar and to-do list?"** — Calendar events get skipped, focus blocks get invaded by meetings, and planned tasks get deferred — but none of this is surfaced or scored.
4. **"Am I getting better at planning?"** — Without trend data across weeks, the user cannot see whether their planning accuracy, leverage ratio, or adherence scores are improving or declining.

Without this feedback loop, weekly planning (FEAT039) operates blind — each week starts fresh with no learning from the previous one.

---

## Goals

- Give the user a 10-minute structured retrospective at the end of each week
- Produce a leverage score (% of work that was high-leverage vs. noise)
- Produce calendar and to-do adherence scores across four dimensions
- Surface trends over time so the user can see whether their planning is improving
- Generate concrete carry-forward insights that seed the next week's planning (FEAT039)

---

## Success Metrics

- 70%+ weekly retro completion rate after 4 weeks of use
- Users who complete retros show measurable improvement in leverage ratio over 4-week rolling window
- Planned-vs-completed ratio improves (converges toward 1.0) over 4-week rolling window
- Average retro completion time under 10 minutes (measured from nudge open to confirmation)

---

## User Stories

### Story 1: Retro trigger
**As a** user, **I want** the system to prompt me to do a weekly retro on Sunday evening (or my configured retro day) **so that** I reflect on my week before the next one starts.

**Acceptance Criteria:**
- [ ] Given the user has not completed a retro for the current ISO week, when the configured retro time arrives (default: Sunday at 18:00 user timezone), then the headless runner emits a `weekly_retro_due` nudge.
- [ ] Given the user opens the nudge, when the chat loads, then the `weekly_retro` intent is triggered with the current week's data pre-loaded.
- [ ] Given the user has already completed the retro for this week, when the retro time arrives, then no nudge is emitted.
- [ ] Given the user says "weekly retro" or "let's do my retro" at any time, then the `weekly_retro` intent is triggered regardless of day/time.

### Story 2: Planned-vs-done review
**As a** user, **I want** to see a side-by-side view of what I planned to do this week versus what I actually completed **so that** I can see the gap between intention and execution.

**Acceptance Criteria:**
- [ ] Given the retro flow starts, when the planned-vs-done step loads, then the system displays: (a) weekly objectives from `objectives.json` `week.items` with their status, and (b) all tasks completed this week from `tasks.json` (completed date within the ISO week).
- [ ] Given a weekly objective has status `done`, then it appears in the "completed" column with a checkmark.
- [ ] Given a weekly objective has status `open` or `in_progress`, then it appears in the "incomplete" column.
- [ ] Given a task was completed this week but was NOT linked to any weekly objective, then it appears in a separate "unplanned completions" section.

### Story 3: Work classification tagging
**As a** user, **I want** to classify each completed item as leverage, aligned, noise, or someone else's priority **so that** I can see how much of my week was high-value work.

**Acceptance Criteria:**
- [ ] Given the classification step loads, when the user sees each completed item (both planned and unplanned), then each item shows four classification options: `leverage` (high-impact, moves OKRs/goals forward), `aligned` (useful, on-plan, but not high-impact), `noise` (low-value busywork that didn't need to happen), `someone_elses_priority` (urgent to someone else, not aligned with my objectives).
- [ ] Given the user selects a classification for an item, when they move to the next item, then the classification is persisted in the retro record.
- [ ] Given all items are classified, when the user confirms, then a leverage score is computed: `(leverage_count + aligned_count) / total_count * 100`.
- [ ] Given the user wants to skip classification for an item, when they choose "skip", then the item is excluded from the leverage score calculation.

### Story 4: Calendar adherence scoring
**As a** user, **I want** to see how well I respected my calendar this week **so that** I can identify patterns of over-commitment or avoidance.

**Acceptance Criteria:**
- [ ] Given the calendar adherence step loads, then the system computes two sub-scores:
  - **Attendance score:** number of calendar events the user attended (not cancelled/skipped) divided by total calendar events for the week, expressed as a percentage.
  - **Focus block integrity score:** number of scheduled focus blocks that were NOT interrupted by new meetings or cancellations, divided by total focus blocks scheduled, expressed as a percentage.
- [ ] Given an event was on the calendar at the start of the week but was later cancelled by the user, then it counts as "skipped" for attendance scoring.
- [ ] Given a focus block had a meeting added on top of it during the week, then it counts as "compromised" for focus block scoring.
- [ ] Given the scores are computed, then the user sees both sub-scores with a combined calendar adherence percentage (average of the two).

### Story 5: To-do adherence scoring
**As a** user, **I want** to see how well I followed my to-do plan this week **so that** I can calibrate my planning accuracy.

**Acceptance Criteria:**
- [ ] Given the to-do adherence step loads, then the system computes two sub-scores:
  - **Completion ratio:** tasks completed this week that were in the weekly objectives, divided by total weekly objective tasks, expressed as a percentage.
  - **Unplanned work ratio:** tasks completed this week that were NOT in any weekly objective, divided by total tasks completed this week, expressed as a percentage.
- [ ] Given the completion ratio is below 50%, then the system flags it as "significant planning gap" in the summary.
- [ ] Given the unplanned work ratio is above 40%, then the system flags it as "high reactive load" in the summary.
- [ ] Given the scores are computed, then the user sees both sub-scores with a combined to-do adherence percentage: `completion_ratio * 0.6 + (1 - unplanned_ratio) * 0.4`.

### Story 6: Weekly scorecard with trends
**As a** user, **I want** a single scorecard summarizing my week with trend arrows compared to previous weeks **so that** I can see at a glance whether I'm improving.

**Acceptance Criteria:**
- [ ] Given the retro is confirmed, then a scorecard is saved to `retro_history.json` with: week identifier (ISO week), leverage score, calendar adherence score, to-do adherence score, and per-item classifications.
- [ ] Given at least 2 retros exist in history, then each score on the scorecard shows a trend indicator: up arrow if improved vs. last week, down arrow if declined, dash if unchanged (within 3% tolerance).
- [ ] Given at least 4 retros exist in history, then the scorecard also shows a 4-week rolling average for each score.
- [ ] Given the scorecard is generated, then the system produces 1-3 plain-language insights (e.g., "Your leverage ratio has improved 12 points over 4 weeks" or "Unplanned work has been above 40% for 3 consecutive weeks").

### Story 7: Feed retro into next week's planning
**As a** user, **I want** my retro results to automatically inform next week's objective-setting (FEAT039) **so that** I build on what I learned.

**Acceptance Criteria:**
- [ ] Given the retro is complete, when the user starts the next weekly review (FEAT039), then the retro scorecard from the previous week is included in the assembler context.
- [ ] Given last week had incomplete objectives, then FEAT039's candidate list includes them as "carryover" items with their original estimates.
- [ ] Given last week's retro flagged "high reactive load", then the LLM's weekly review prompt includes guidance to plan fewer objectives or add buffer time.
- [ ] Given last week's leverage score was below 50%, then the LLM's weekly review prompt includes guidance to prioritize OKR-linked work.

---

## Workflow

### Retro flow (Sunday evening or on-demand)

```
Headless runner (Sunday 18:00 user timezone, or on-demand)
    |
    v
Emits nudge: "Time for your weekly retro"
    |
    v
User opens chat --> triggers `weekly_retro` intent
    |
    v
Step 1 — Planned vs Done
    |  System shows: weekly objectives + their status
    |  System shows: all tasks completed this week
    |  System shows: unplanned completions (not in weekly objectives)
    |
    v
Step 2 — Work Classification
    |  For each completed item (planned + unplanned):
    |    User tags: leverage | aligned | noise | someone_elses_priority | skip
    |
    v
Step 3 — Calendar Adherence (auto-computed, shown for review)
    |  Attendance score: attended / total events
    |  Focus block integrity: uncompromised / total focus blocks
    |
    v
Step 4 — To-do Adherence (auto-computed, shown for review)
    |  Completion ratio: planned-done / planned-total
    |  Unplanned ratio: unplanned-done / all-done
    |
    v
Step 5 — Scorecard + Insights
    |  Leverage score, calendar adherence, to-do adherence
    |  Trend arrows vs last week
    |  1-3 plain-language insights
    |  User confirms or adds a free-text reflection note
    |
    v
Write retro_history.json (append this week's record)
    |
    v
Retro complete --> available as context for next FEAT039 weekly review
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User skips retro entirely | No retro record for that week. Next week's retro shows "no data for last week" instead of trend arrows. FEAT039 proceeds without retro context. |
| User has no weekly objectives (FEAT039 not yet active) | Retro uses tasks completed this week as the full item list. Planned-vs-done step shows "no weekly plan set" and skips to classification. Completion ratio is N/A. |
| User completed zero tasks this week | Retro shows an empty classification step. Scores default to 0% leverage, and the system generates an insight about the gap. |
| User had no calendar events | Calendar adherence shows "no events" and is excluded from the combined score. |
| User had no focus blocks scheduled | Focus block integrity sub-score shows "no focus blocks" and is excluded from the calendar adherence calculation. |
| User does retro on Monday instead of Sunday | Retro still covers the previous ISO week. Works the same as Sunday. |
| User does retro twice in the same week | Second retro overwrites the first (same ISO week key). |
| Retro history file is missing or corrupt | System creates a fresh `retro_history.json` with empty history. No trends shown until second retro. |

---

## Out of Scope

- Automatic time tracking or duration measurement for tasks — defer (only task completion status is used)
- Team retrospectives or shared retros — never (personal app)
- Detailed per-hour time audit — defer (this feature works at the task/event level, not time-slice level)
- Calendar write-back (e.g., blocking time for retro) — not part of this feature
- AI-generated action items from the retro — the retro produces scores and insights, not prescriptive action plans. The LLM uses the retro data during FEAT039 planning, but doesn't generate standalone retro actions.
- Gamification (badges, streaks, rewards) — defer

---

## Assumptions & Open Questions

### Assumptions
- FEAT039 (objective layers) ships first or concurrently — retro uses `objectives.json` `week.items` as the "planned" baseline. If FEAT039 is not yet active, the retro degrades gracefully (see edge cases).
- Calendar data is available via the existing Google Calendar integration (FEAT018) — specifically, event attendance status and focus block identification.
- The user's week starts Monday and ends Sunday (ISO week). Retro day is configurable but defaults to Sunday.

### Open Questions
- How should focus blocks be identified in the calendar? Recommendation: events tagged with a specific keyword (e.g., "Focus", "Deep Work") or events matching a configurable pattern. This may need a small calendar-tagging convention.
- Should the free-text reflection note at the end be stored as-is, or should the LLM summarize it? Recommendation: store as-is in `retro_history.json`; the LLM can read it during FEAT039 context assembly.
- Should retro history be capped (e.g., rolling 52 weeks)? Recommendation: yes — keep 52 weeks, archive older records to a separate file to keep the active file small.
- Should the retro be surfaceable in the Focus Brief (HTML export)? Recommendation: yes — include the latest scorecard in the weekly section of the brief, but defer to a follow-up enhancement.

---

## Architecture Notes

[To be filled by Architect Agent]

---

## UX Notes

[To be filled after UX design review]

---

## Implementation Notes

| File | Change |
|------|--------|

[To be filled by Architect / Developer]

---

## Testing Notes

- [ ] _To be filled by Test Case Writer_

---
