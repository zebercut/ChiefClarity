# Code Review: Recurring Events in Agenda Creation (v2)

**Reviewer:** Code Reviewer Agent  
**Date:** 2026-04-20  
**Scope:** Post-fix review of recurring event handling during plan generation  
**Prior review:** FEAT023_code-review-recurring-bugs.md (filed same day)

## Overall Status

**APPROVED WITH COMMENTS** — The core bugs are fixed. The `recurringByDate` pre-computation, `isRecurringInstance` flag, and title+date injection dedup together resolve the reported problems (ignored recurring events + 4x duplicates). Two remaining issues should be addressed but are not blockers.

---

## Correctness

### Fixed (verified)
- [x] `buildRecurringByDate()` correctly maps recurring tasks to specific dates using `shouldRunToday()` for each day in the plan range
- [x] `isRecurringInstance: true` now set on calendar events created by `processRecurringTasks()` (line 68)
- [x] Assembler filters `isRecurringInstance` events from `calendarEvents` (line 91-94) to prevent LLM seeing the same item from two sources
- [x] Weekly job now calls `processRecurringTasks()` for 7 days before planning (headless-runner.js)
- [x] `injectMissingCalendarEvents()` matches by title+date in addition to ID (executor.ts line 1128-1140)
- [x] `deduplicateDayAdditions()` catches same-title+same-time within a day (executor.ts line 1085)
- [x] Prompt step 2 rewritten to use `recurringByDate` and explicitly says "do NOT re-parse recurringCommitments.schedule yourself"
- [x] Old "RECURRING COMMITMENT RULE" removed from step 4
- [x] 12 unit tests cover day/week/tomorrow variants, weekday-only, exclude dates, grouping, inactive filtering

### Issue 1 — `recurringCommitments` still sent alongside `recurringByDate` (LOW)
**File:** `assembler.ts:80-81`

Both raw `recurringCommitments` (with `.schedule` fields) and the pre-computed `recurringByDate` are sent to the LLM. Line 260 of prompts.ts also mentions "recurringCommitments" in the overview paragraph. The prompt at line 283 says "do NOT re-parse recurringCommitments.schedule" — but sending both objects is wasted tokens and invites the LLM to look at the raw schedules anyway.

**Recommendation:** Stop sending `recurringCommitments` in the full_planning case. The LLM gets titles and durations from `recurringByDate` already. If the LLM needs the raw list for some other purpose (e.g., displaying all recurring tasks including those with no matches this week), send a stripped version without `.schedule`.

### Issue 2 — Pre-existing recurring instances without `isRecurringInstance` flag (MEDIUM)
**File:** `assembler.ts:91-94`

The filter `(e) => !e.isRecurringInstance` works for events created **after** this fix. But the user's database contains recurring calendar events created by `processRecurringTasks()` from previous runs — those have no `isRecurringInstance` field (it was missing before today's fix). They'll pass through the filter and appear in BOTH `calendarEvents` AND `recurringByDate`, causing the LLM to see duplicates.

**Recommendation:** Additionally filter by ID prefix — recurring instances have IDs starting with `rcev_`. Add as a fallback:
```typescript
(e) => !e.isRecurringInstance && !String(e.id).startsWith("rcev_")
```
This is backward-compatible and catches all legacy instances.

---

## Bugs

No functional bugs found in the new code. The two issues above are quality/robustness concerns, not bugs.

---

## Security

No security issues. Recurring event data contains no secrets.

---

## Performance

### Observation — `recurringByDate` is a Record, not an Array
**File:** `assembler.ts:245-253`

`recurringByDate` is not in `truncatableKeys`. But the budget enforcement only truncates arrays (`!Array.isArray(val)` check at line 261). Since `recurringByDate` is a Record, adding it to `truncatableKeys` wouldn't help — it would be skipped.

**Impact:** For a week plan with 5 recurring items × 5 applicable days = 25 entries ≈ 400 tokens. This is bounded and small. Not a real risk, but worth documenting.

**No fix needed.**

---

## Architecture Compliance

- [x] Sacred boundary respected — TypeScript computes dates, LLM just places items
- [x] `buildRecurringByDate()` is a pure function with no side effects — testable
- [x] `shouldRunToday()` reused between `processRecurringTasks()` and `buildRecurringByDate()` — no duplication

---

## Code Quality

- [x] `buildRecurringByDate()` is cleanly separated from `processRecurringTasks()` — the former is read-only (for assembler), the latter mutates state (for instance creation)
- [x] `computeDateRange()` is extracted as a helper — readable
- [x] Tests cover the important edge cases (weekday-only on weekend, exclude dates, multiple items per day)

### Minor: `custom` schedule type is identical to `weekly`
**File:** `recurringProcessor.ts:96`

The `custom` case in `shouldRunToday()` is a copy of `weekly`. If there's no semantic difference, remove the duplicate case and document that `custom` is an alias for `weekly`. If there IS an intended difference, implement it.

---

## Testability

- [x] `buildRecurringByDate()` is a pure function — tested with 12 unit tests
- [x] All tests pass (176 total)

### Gap: no test for `isRecurringInstance` filter in assembler
Would need a component test that mounts the assembler with recurring instances in state and verifies they're filtered from `calendarEvents`. Not a blocker — the logic is one line and trivially correct.

---

## Required Changes

1. **MUST** — Add `rcev_` ID prefix fallback to the `isRecurringInstance` filter in assembler.ts line 92. Without this, the user's existing recurring events (created before today's fix) will still duplicate in the LLM context.

## Optional Suggestions

1. Stop sending `recurringCommitments` in `full_planning` — saves tokens and removes a source of LLM confusion.
2. Remove or document the `custom` schedule type.
3. Update prompt line 260 to not mention `recurringCommitments` since the LLM should use `recurringByDate`.

## Pattern Learning

Add to project `AGENTS.md`:
> When adding a new flag to a data model (e.g., `isRecurringInstance` on CalendarEvent), remember that existing records in the database won't have the flag set. Any filter that depends on the new flag must include a fallback for legacy data (e.g., matching by ID prefix `rcev_` as a backward-compatible heuristic). Without this, the first deploy after the fix still produces incorrect behavior until the old data ages out.
