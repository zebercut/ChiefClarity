# Code Review: Recurring Events in Weekly Planning

**Reviewer:** Code Reviewer Agent  
**Date:** 2026-04-20  
**Triggered by:** User report — weekly plan ignored recurring events and duplicated a recurring payment 4x

## Overall Status

**CHANGES REQUIRED** — Two independent bugs, both in pre-existing code (not FEAT023). Both are correctness issues that produce visible user-facing damage.

---

## Bug 1: Recurring Events Ignored in Weekly Plan

### Symptoms
Child A's weekly class (Tue/Thu), Child B's Friday activity (Fri), and activity waiting time do not appear in the weekly plan's `days[].additions`.

### Root Cause: Two-part failure

**Part A — `processRecurringTasks()` only creates instances for ONE day**

File: `src/modules/recurringProcessor.ts:12`

```typescript
export function processRecurringTasks(state: AppState, today: string): number {
```

It takes a single `today` string and creates instances only for that date. The morning job calls it with today's date. The weekly job at `scripts/headless-runner.js:380-418` **does NOT call `processRecurringTasks()` at all** — it jumps straight to `generatePlan("week", state)`.

So when a week plan is generated:
- `state.tasks.tasks` only contains recurring instances for TODAY (created by the morning job)
- Recurring instances for Tuesday, Thursday, Friday **don't exist yet** — they'll only be created when those days' morning jobs run
- The LLM receives `calendarEvents` which only contains today's recurring event, not the week's

**Part B — LLM is expected to parse raw `recurringCommitments` and compute dates itself**

File: `src/modules/assembler.ts:78-79`

```typescript
ctx.recurringCommitments = state.recurringTasks.recurring
  .filter((r) => r.active);
```

The LLM receives the raw definitions with `schedule: { type: "weekly", days: ["tuesday", "thursday"], time: "16:00" }` and is told:
> "Check recurringCommitments for day-specific events → add to additions"

But the LLM must:
1. Figure out which date in the plan range is "tuesday", "thursday", etc.
2. Cross-reference each `recurringCommitment.schedule.days` against the plan's `dateRange`
3. Create agenda events with the right date + time + duration

This is unreliable. The LLM frequently skips recurring commitments — especially in a week plan with 7 days of complexity. The prompt says "MUST be slotted" but provides no pre-computed mapping of which commitments apply to which days.

### Fix
TypeScript should pre-compute a `recurringByDate` map and send it to the LLM instead of (or alongside) the raw definitions:

```typescript
// In assembler.ts, full_planning case:
ctx.recurringByDate = precomputeRecurringForDateRange(
  state.recurringTasks.recurring.filter(r => r.active),
  planDateRange.start,
  planDateRange.end
);
```

Output:
```json
{
  "2026-04-22": [
    { "title": "Child A's weekly class", "time": "16:00", "duration": 90, "category": "family" },
    { "title": "Activity waiting — focus time", "time": "16:00", "duration": 90, "category": "work" }
  ],
  "2026-04-24": [
    { "title": "Child A's weekly class", "time": "16:00", "duration": 90, "category": "family" }
  ],
  "2026-04-25": [
    { "title": "Child B's Friday activity", "time": "15:00", "duration": 120, "category": "family" }
  ]
}
```

The LLM then just needs to copy each day's items into `additions` — no schedule parsing required.

---

## Bug 2: Recurring Payment Created 4 Duplicate Calendar Items

### Symptoms
"Recurring tutoring payment" (Wednesday) appeared 4 times in the calendar after weekly planning.

### Root Cause: Three compounding issues

**Issue A — `processRecurringTasks()` doesn't set `isRecurringInstance`**

File: `src/modules/recurringProcessor.ts:56-73`

Calendar events created from recurring tasks are missing the `isRecurringInstance: true` flag that the `CalendarEvent` interface supports (line 250 of types/index.ts). This means:
- Calendar hygiene can't distinguish them from user-created events
- The LLM sees them as regular events and may create additional ones
- `injectMissingCalendarEvents()` can't filter them specially

**Issue B — `injectMissingCalendarEvents()` injects recurring events AGAIN**

File: `src/modules/executor.ts:1109-1149`

After the LLM writes the focusBrief, this function checks all active calendar events and injects any that the LLM missed. If the LLM already created an agenda event with title "Recurring tutoring payment" but used a different ID than the recurring instance's `rcev_*` ID, the original recurring event gets injected again as a duplicate addition.

**Issue C — LLM creates its own calendar write for the recurring item**

The LLM sees "Recurring tutoring payment" in `recurringCommitments` AND possibly in `calendarEvents` (from the processed instance). It may emit a `calendar: add` write creating ANOTHER event, plus slot it in the brief additions. Combined with the existing processed instance and the injection, this produces 3-4 copies:

1. Instance created by `processRecurringTasks()` (rcev_* ID)
2. LLM writes a new calendar event (different ID)
3. `injectMissingCalendarEvents()` injects the original rcev_* (LLM used its own ID, so this doesn't match)
4. Possible second LLM write if the payment appears in both recurringCommitments and calendarEvents context

### Fix

1. **Set `isRecurringInstance: true`** in `recurringProcessor.ts:58-68`:
   ```typescript
   const event = {
     ...
     isRecurringInstance: true,  // ADD THIS
   };
   ```

2. **Deduplicate recurring events before sending to LLM** — in the assembler, filter `calendarEvents` to exclude recurring instances that will already be in `recurringCommitments` (or in the new `recurringByDate`). The LLM should see each item from ONE source, not two.

3. **Teach `injectMissingCalendarEvents()` to skip recurring instances** that the LLM already covered by title+date match (not just by ID).

---

## Architecture Compliance

- [x] Sacred boundary respected — both fixes are pure TypeScript, no LLM involvement
- [ ] **VIOLATION:** TypeScript is offloading date computation to the LLM (Bug 1 Part B). The architecture rule says "TypeScript owns routing, state, file I/O, conflict detection, writes, summarizing, token budgets. LLM owns language understanding, judgment, suggestions, natural language reply." Date/schedule computation is TypeScript's job.

## Performance

- The `recurringByDate` pre-computation is O(recurring × days_in_range) — trivial.
- No performance concerns.

## Required Changes

1. **MUST** — Pre-compute `recurringByDate` in the assembler for `full_planning` and send it to the LLM alongside (or instead of) raw `recurringCommitments`. TypeScript handles the schedule→date mapping.
2. **MUST** — Set `isRecurringInstance: true` on calendar events created by `recurringProcessor.ts`.
3. **MUST** — Deduplicate recurring events from `calendarEvents` context when they'll already appear in `recurringByDate`, so the LLM doesn't see the same item from two sources.
4. **SHOULD** — In the weekly job (`headless-runner.js`), call `processRecurringTasks()` for each day in the week range before calling `generatePlan("week")`, so recurring instances exist as actual tasks/events for the whole week (not just today).
5. **SHOULD** — `injectMissingCalendarEvents()` should match by title+date (not just ID) to prevent recurring duplicates.

## Pattern Learning

Add to project `AGENTS.md`:
> When context sent to the LLM contains schedule definitions that require date computation (e.g., "weekly on Tuesday/Thursday"), TypeScript must pre-compute the applicable dates and send a date-keyed map. The LLM must not be expected to parse schedule types, compute weekday-to-date mappings, or handle exclude-date logic — that violates the sacred boundary.
