# FEAT047 — Data Hygiene with LLM-Assisted Cleanup

**Type:** feature
**Status:** Design Reviewed
**MoSCoW:** MUST
**Category:** Data Quality
**Priority:** 1
**Release:** v4.0
**Tags:** hygiene, data-quality, dedup, cleanup, automation
**Created:** 2026-04-14

---

## Problem Statement

The LLM generates plans based on whatever data it receives. When the data contains duplicates, wrong dates, undated ghost events, or stale items, the plan comes out wrong — and the user has to manually debug it. Today's session exposed:

- **11 undated ghost events** leaking into the planner (Child A's class, Candidate X interview, Example Corp, etc.)
- **3 events with wrong dates** (ADLC and Candidate X were yesterday, Example Corp was tomorrow)
- **3 redundant blog tasks** all firing on Tuesday
- **Calendar events duplicating recurring tasks** (activity blog session existed as both)

These are not code bugs — they're **data quality issues** that accumulate over time as the user creates items via chat, inbox, and integrations. The system needs a regular cleanup job that catches these before they reach the planner.

---

## Design: Three-Tier Data Hygiene

### Tier 0: Semantic Dedup at Entry Time (free, every write)

Uses FEAT042's vector embeddings to catch duplicates BEFORE they enter the database. Runs inside `executor.ts → applyAdd()` for every task and calendar event creation.

| Similarity (cosine distance) | Action |
|------------------------------|--------|
| < 0.15 (near-identical) | **Block** the add. Log: "Skipped: similar to '[existing title]'" |
| 0.15 — 0.25 (very similar) | **Add but flag**: `conflictStatus: "flagged"`, `conflictReason: "possible duplicate of '[title]'"` |
| > 0.25 (different enough) | **Add normally** |

This catches "Candidate X Interview" vs "Interview screening — Candidate X" at the moment the LLM or inbox processor tries to create the duplicate. ~10ms overhead per write (embedding model already loaded in memory by FEAT042).

### Tier 1: TypeScript Deterministic Cleanup (free, every morning)

Pure logic — no LLM, no cost. Runs in the morning job before plan generation.

| Check | What it does | Module |
|-------|-------------|--------|
| **Undated event cleanup** | Archive events with no `datetime` that are older than 7 days | `calendarHygiene.ts` |
| **Recurring-calendar dedup** | If a recurring task creates the same event that already exists as a calendar event (same title + same day), archive the calendar event | new: `dataHygiene.ts` |
| **Task dedup** | Find open tasks with identical titles (case-insensitive). Keep the one with the most recent activity (comments, notes). Mark the other as deferred with a note "duplicate of [id]" | `dataHygiene.ts` |
| **Stale parked cleanup** | Tasks parked for > 30 days → auto-defer with note "auto-deferred: parked too long" | `dataHygiene.ts` |
| **Past-due recurring skip** | If a recurring task generated an instance for yesterday that was never started, archive it instead of leaving it overdue | `dataHygiene.ts` |

### Tier 2: Haiku LLM Audit (cheap, weekly)

A focused Haiku call that reviews the data and returns structured cleanup suggestions. Runs in the weekly job.

**Input to Haiku (~500 tokens):**
```json
{
  "undatedEvents": [{ "id": "...", "title": "Child A's Class", "status": "scheduled" }],
  "possibleDuplicateTasks": [
    { "a": { "id": "t1", "title": "Write blog post" }, "b": { "id": "t2", "title": "Write and publish blog post" } }
  ],
  "possibleDuplicateEvents": [
    { "a": { "id": "e1", "title": "Candidate X Interview" }, "b": { "id": "e2", "title": "Interview screening — Candidate X" } }
  ],
  "recurringCalendarOverlap": [
    { "recurring": "Blog prep (activity waiting)", "event": "Blog prep session (activity waiting time)", "eventId": "..." }
  ],
  "staleTasks": [{ "id": "...", "title": "...", "daysSinceCreated": 45, "status": "pending" }]
}
```

**Output from Haiku (~200 tokens):**
```json
{
  "archiveEvents": ["e1", "e3"],
  "deferTasks": ["t2"],
  "mergeTasks": [{ "keep": "t1", "remove": "t2", "reason": "duplicate" }],
  "suggestions": ["Consider cancelling 'Contact B Tire Change' — no date and likely completed"]
}
```

**Cost:** ~$0.0001 per weekly audit.

**Key principle:** Haiku only **suggests** — TypeScript executes. The LLM identifies fuzzy duplicates (e.g., "Candidate X Interview" vs "Interview screening — Candidate X") that exact string matching can't catch. But the actual archive/defer/merge is done by TypeScript code, not by the LLM.

---

## Architecture Notes

### New Module: `src/modules/dataHygiene.ts`

```typescript
interface HygieneResult {
  // Tier 1 (deterministic)
  undatedArchived: number;
  recurringDeduped: number;
  taskDeduped: number;
  staleParkedDeferred: number;
  pastDueRecurringArchived: number;
  // Tier 2 (LLM-assisted, weekly only)
  llmArchived: number;
  llmDeferred: number;
  llmMerged: number;
  llmSuggestions: string[];
}

/** Tier 1: deterministic cleanup. Run daily before plan generation. */
export function runDeterministicHygiene(state: AppState): HygieneResult;

/** Tier 2: Haiku-assisted audit. Run weekly. */
export async function runLlmAudit(state: AppState): Promise<HygieneResult>;
```

### Scheduling

| When | What runs | Cost |
|------|-----------|------|
| **Morning job** (daily, before `generatePlan`) | Tier 1 deterministic cleanup | Free |
| **Weekly job** (before `generatePlan("week")`) | Tier 1 + Tier 2 Haiku audit | ~$0.0001 |

### Headless Runner Integration

```javascript
// Morning job — after calendar hygiene, before plan generation:
const hygieneResult = runDeterministicHygiene(state);
if (hygieneResult changed > 0) {
  await flush(state);
  console.log(`[hygiene] ${hygieneResult.summary}`);
}

// Weekly job — after weekly calendar hygiene:
const weeklyHygiene = await runLlmAudit(state);
if (weeklyHygiene changed > 0) {
  await flush(state);
}
// Log to chat
await logToChat(`Data hygiene: ${weeklyHygiene.summary}`);
```

### Data Flow

```
Morning job starts
  ↓
runDailyHygiene(state)         ← existing calendar cleanup
  ↓
runDeterministicHygiene(state) ← NEW: Tier 1 data cleanup
  ↓
flush(state)                   ← persist changes
  ↓
generatePlan("day", state)     ← planner receives clean data
```

### Haiku Tool Schema (Tier 2)

```typescript
const HYGIENE_TOOL = {
  name: "submit_hygiene_actions",
  input_schema: {
    properties: {
      archiveEvents: { type: "array", items: { type: "string" }, description: "Event IDs to archive" },
      deferTasks: { type: "array", items: { type: "string" }, description: "Task IDs to defer" },
      mergeTasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keep: { type: "string" },
            remove: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      suggestions: { type: "array", items: { type: "string" }, description: "Human-readable suggestions for the user" },
    },
    required: ["archiveEvents", "deferTasks", "mergeTasks", "suggestions"],
  },
};
```

### What Each Tier Catches

| Issue | Tier 1 (deterministic) | Tier 2 (Haiku) |
|-------|----------------------|----------------|
| Undated events older than 7 days | Yes | — |
| Exact duplicate titles | Yes | — |
| Fuzzy duplicate titles ("Candidate X Interview" vs "Interview screening — Candidate X") | — | Yes |
| Recurring task + calendar event overlap (same title + day) | Yes | — |
| Stale parked tasks (>30 days) | Yes | — |
| Wrong dates (event says Tuesday but user meant Monday) | — | Partial (can flag anomalies) |
| Orphaned references | Yes (existing in calendarHygiene) | — |
| Stale undated events that are likely completed | — | Yes (suggests archiving) |

### Files to Create

| File | Purpose |
|------|---------|
| `src/modules/dataHygiene.ts` | Tier 1 deterministic + Tier 2 Haiku audit |

### Files to Modify

| File | Change |
|------|--------|
| `scripts/headless-runner.js` | Call `runDeterministicHygiene` in morning job, `runLlmAudit` in weekly job |
| `src/modules/calendarHygiene.ts` | Extract shared helpers if needed |

### Acceptance Criteria

- [ ] Undated events older than 7 days are archived in the morning job
- [ ] Recurring tasks that overlap with calendar events on the same day are deduped
- [ ] Exact duplicate open tasks are auto-deferred (keep the one with more activity)
- [ ] Parked tasks older than 30 days are auto-deferred
- [ ] Weekly Haiku audit identifies fuzzy duplicates the deterministic check misses
- [ ] Haiku suggestions are logged to chat so the user can act on them
- [ ] All cleanup is logged to chat with a summary
- [ ] Plan generation always runs AFTER hygiene (receives clean data)
- [ ] Total daily cost: $0 (Tier 1 only). Weekly cost: ~$0.0001 (Tier 1 + Tier 2)

### Risks

1. **False positive dedup** — Tier 1 uses exact title match only. Tier 2 (Haiku) can do fuzzy matching but may wrongly merge similar-but-different items. Mitigation: Tier 2 only suggests, user reviews via chat nudge.
2. **Auto-deferring parked tasks** — user may have intentionally parked something for months. Mitigation: log to chat so user can reopen. 30-day threshold is conservative.
3. **Archiving undated events** — some undated events are intentional reminders (e.g., "Visa renewal"). Mitigation: 7-day threshold + only archive if `status === "scheduled"` and no recent modifications.

---

## Execution Order

```
1. Create src/modules/dataHygiene.ts (Tier 1 functions)
2. Wire into headless-runner.js morning job
3. Test: verify undated events archived, duplicates caught
4. Add Tier 2 Haiku audit function
5. Wire into headless-runner.js weekly job
6. Test: verify fuzzy duplicate detection
```

Steps 1-3 can ship first. Steps 4-6 can follow.

---

## Architecture Review — 2026-04-14

**Reviewer:** Architect Agent
**Status:** Changes Required (1 bug, 2 issues)

### Bug: Tier 0 blocks legitimate recurring task instances

When `recurringProcessor` creates today's "ChiefClarity — 1 hour development", Tier 0's `searchSimilar()` finds yesterday's instance (same title, cosine distance ~0.0) and **blocks the add**. The recurring processor never produces duplicates by design (it checks by ID+date), so Tier 0 should skip recurring task writes.

**Fix:** In `executor.ts`, skip Tier 0 for writes that come from the recurring processor. Detect via the `[Recurring]` note prefix or add a `_skipDedup` flag to the write data:

```typescript
// In applyAdd, before the semantic dedup block:
const isRecurringInstance = fileKey === "tasks" && d.notes && String(d.notes).includes("[Recurring]");
if (_semanticDedupFn && d.title && (fileKey === "tasks" || fileKey === "calendar") && !isRecurringInstance) {
```

### Issue: Tier 2 audit missing circuit breaker check

`runLlmAudit()` calls `_auditLlmFn()` (raw Haiku client) without checking `isCircuitOpen()`. Per the CR-FEAT045 rule: injected LLM functions bypass the circuit breaker, callers must check explicitly.

**Fix:** Add guard at the top of `runLlmAudit`:
```typescript
const { isCircuitOpen } = require("./llm");
if (!_auditLlmFn || isCircuitOpen()) return base;
```

### Issue: Tier 0 thresholds need tuning

The current thresholds (0.15 block, 0.25 flag) are untested against real data. Cosine distance varies by embedding model. Too aggressive = blocks legitimate items. Too lenient = misses duplicates.

**Recommendation:** Log distances for 1 week without blocking (flag-only mode), then set thresholds based on observed data. Start with:
- Block threshold: 0.10 (extremely similar, essentially identical)
- Flag threshold: 0.20

### Testing Notes

#### Unit Tests Required
- `runDeterministicHygiene` with mock state: undated events archived, duplicates caught, stale parked deferred
- `archivePastDueRecurring` only targets `[Recurring]` tasks with `status === "pending"`
- `dedupRecurringVsCalendar` matches exact titles only (case-insensitive)
- `stringSimilarity` returns expected values for known pairs

#### Integration Tests Required
- Morning job: calendarHygiene → recurringProcessor → dataHygiene → generatePlan — verify recurring instances NOT blocked by Tier 0
- Weekly job: Tier 1 + Tier 2 audit — verify Haiku suggestions applied correctly
- Tier 0: add task via chat → verify similar existing task triggers flag (not block unless nearly identical)

### Approved Implementation Order

```
1. Fix Tier 0 recurring exclusion (executor.ts)         ← MUST before shipping
2. Add circuit breaker check to Tier 2 (dataHygiene.ts)  ← MUST before shipping
3. Lower Tier 0 block threshold to 0.10 (executor.ts)    ← SHOULD
4. Ship Tier 0 + Tier 1 + Tier 2                        ← already implemented
5. Monitor distances in logs for 1 week, tune thresholds  ← post-ship
```
