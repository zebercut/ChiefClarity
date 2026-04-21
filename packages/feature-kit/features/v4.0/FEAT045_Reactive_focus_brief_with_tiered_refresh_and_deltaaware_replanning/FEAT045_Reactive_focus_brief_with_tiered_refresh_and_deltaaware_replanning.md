# FEAT045 — Reactive focus brief with tiered refresh and delta-aware replanning

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Focus Planning
**Priority:** 1
**Release:** v4.0
**Tags:** brief, reactive, planning, patch, refresh, delta
**Created:** 2026-04-12
**Design Reviewed:** 2026-04-12

**Depends on:** FEAT041 (libSQL), FEAT043 (Two-stage triage — for Tier 2 Haiku calls)

---

## Summary

Make the focus brief a **living document** that reacts to changes in real time instead of going stale the moment a task is marked done. Three tiers of reactivity — TypeScript instant patches (free), Haiku narrative refresh (cheap), and delta-aware full replanning (smart) — keep the brief current without unnecessary LLM cost.

The key insight: even Tier 3 (full "plan my day") should NOT regenerate from scratch if a recent brief exists. It should see **what changed** since the last brief and adjust, not rewrite.

---

## Problem Statement

The focus brief is generated once (by Sonnet, ~$0.03, ~5 seconds) and never updates. The moment the user marks a task done, adds an event, or processes inbox items, the brief is stale. The only way to refresh it is to say "plan my day" again — which regenerates everything from scratch, even if only one task changed.

This creates three problems:

1. **Stale display.** The Focus Dashboard shows "Complete insurance paperwork" as a priority when it was marked done 10 minutes ago.
2. **Wasted tokens.** A full replan after one task completion costs the same as the original plan. 90% of the output is identical.
3. **Lost context.** When the user says "plan my day" at 2pm, the LLM doesn't know which items from the morning brief were completed vs skipped vs rescheduled. It generates a fresh plan that may conflict with what the user already did.

---

## User Stories

### Story 1: Brief stays current after task completion
**As a** user, **I want** to mark a task done and see the brief update instantly **so that** the Focus Dashboard always reflects my current state.

**Acceptance Criteria:**
- [ ] Mark a task done → brief's day additions show the task with strikethrough within 1 second
- [ ] freeBlocks recalculated to include the freed-up time slot
- [ ] No LLM call needed

### Story 2: Narrative refreshes after multiple changes
**As a** user, **I want** the executive summary to update after several changes **so that** the brief reads like it was written for my current state, not my morning state.

**Acceptance Criteria:**
- [ ] After 3+ Tier 1 patches, a Haiku mini-refresh runs automatically
- [ ] executiveSummary, priorities, risks, companion.motivationNote are updated
- [ ] The full day structure (routine + additions) is NOT regenerated
- [ ] Cost < $0.001 per refresh

### Story 3: Smart replanning knows what changed
**As a** user, **I want** "plan my day" at 2pm to adjust my existing plan rather than create a new one **so that** I keep the morning decisions that still make sense and only change what's different.

**Acceptance Criteria:**
- [ ] If a brief was generated today, "plan my day" builds a delta (what changed) and sends it to the LLM
- [ ] The LLM sees: "3 tasks completed, 1 new event added, 2 tasks overdue since morning"
- [ ] The LLM adjusts the afternoon portion, keeps the morning as-is
- [ ] Token cost is ~50% less than a full regeneration

---

## Developer Implementation Guide

### Three tiers of reactivity

```
Change happens (task done, event added, inbox processed)
         |
         v
   Tier 1: TypeScript patch (instant, free)
   - Update additions/removals in the current brief
   - Recalculate freeBlocks
   - Mark items done/cancelled
   - Track the patch in a _changelog array
         |
         v
   3+ patches? or 2-hour timer?
         |
         v
   Tier 2: Haiku mini-refresh (~$0.0001, ~500ms)
   - Input: current brief + _changelog
   - Rewrite: executiveSummary, priorities, risks, companion
   - Do NOT regenerate day structure
   - Clear _changelog
         |
         v
   User says "plan my day" or new day?
         |
         v
   Tier 3: Delta-aware replan (Sonnet, cheaper than full)
   - Build delta from _changelog + state diff since generatedAt
   - Input to LLM: existing brief + delta summary
   - LLM adjusts, not rewrites
```

---

### WP-1: Brief change tracker — `_changelog` on FocusBrief

**Goal:** Track every change since the last brief generation so Tier 2 and Tier 3 know what happened.

#### 1.1 New field on FocusBrief type

```typescript
// Add to FocusBrief interface in types/index.ts:
_changelog?: BriefChange[];

interface BriefChange {
  type: "task_done" | "task_added" | "task_deleted" | "event_added" | "event_cancelled" | "event_moved" | "note_processed" | "okr_updated";
  itemId: string;
  itemTitle: string;
  timestamp: string; // ISO
  detail?: string;   // e.g. "rescheduled from Apr 12 to Apr 14"
}
```

The `_changelog` is:
- Populated by Tier 1 patches
- Read by Tier 2 (Haiku refresh) and Tier 3 (delta replan)
- Cleared after each Tier 2 or Tier 3 run
- Persisted in the brief JSON/DB — survives app restarts

#### 1.2 Acceptance

- [ ] After marking a task done, `state.focusBrief._changelog` has an entry `{ type: "task_done", itemId, itemTitle }`
- [ ] After adding an event, changelog has `{ type: "event_added" }`
- [ ] Changelog persists across app restart (stored in focusBrief snapshot)

---

### WP-2: Tier 1 — TypeScript hot patches — `src/modules/briefPatcher.ts`

**Goal:** Instant brief updates with zero LLM cost.

#### 2.1 Patch operations

| Trigger | Patch | Free blocks |
|---|---|---|
| Task marked done | Find in `days[todayIdx].additions` by ID → add `_completed: true` | Recalculate: the task's time slot becomes free |
| Task deleted | Remove from `days[todayIdx].additions` by ID | Recalculate |
| Event cancelled | Find in additions → set `_cancelled: true` | Recalculate |
| New task with today's due date | Append to `days[todayIdx].additions` at next free slot (use DURATION STACKING logic) | Recalculate |
| New event today | Insert into `days[todayIdx].additions` at its time. If overlaps a routine item, add to `removals`. | Recalculate |
| OKR progress change | Update `okrSnapshot[].activityProgress` and `outcomeProgress` from live state | No change |

#### 2.2 freeBlocks recalculation

```typescript
function recalcFreeBlocks(day: DaySlot, routineTemplate: AgendaEvent[]): void {
  // 1. Build timeline: routine items (minus removals) + additions (minus completed/cancelled)
  // 2. Sort by time
  // 3. Walk the timeline, find gaps between items (where end < next start)
  // 4. Replace day.freeBlocks with the new gaps
}
```

This is pure TypeScript arithmetic — the same logic the LLM currently does in its head, but deterministic.

#### 2.3 Hook into executor

After `applyWrites()` in `processPhrase()` and in the headless runner, check if any write touched tasks/calendar/okr and call the patcher:

```typescript
// In executor.ts or chat.tsx, after applyWrites + flush:
if (plan.writes.some(w => ["tasks", "calendar", "planOkrDashboard"].includes(w.file))) {
  patchBrief(state, plan.writes);
}
```

#### 2.4 Acceptance

- [ ] Mark task done → brief's today additions show it with `_completed: true` within 1 second
- [ ] Add event at 14:00 → brief's today additions include it at 14:00
- [ ] freeBlocks recalculated after every patch
- [ ] _changelog populated with patch details
- [ ] No LLM call made

---

### WP-3: Tier 2 — Haiku narrative refresh — `src/modules/briefRefresher.ts`

**Goal:** Cheap LLM call to refresh the narrative parts of the brief after accumulated changes.

#### 3.1 When to trigger

- After 3+ Tier 1 patches since last refresh
- Every 2 hours while app is open (existing interval infrastructure)
- Manually: user taps "refresh" on the Focus Dashboard

#### 3.2 Haiku input (~300 tokens)

```json
{
  "currentBrief": {
    "executiveSummary": "...",
    "priorities": [...],
    "risks": [...],
    "companion": { "motivationNote": "...", "focusMantra": "..." }
  },
  "changelog": [
    { "type": "task_done", "itemTitle": "Review insurance", "timestamp": "14:30" },
    { "type": "event_added", "itemTitle": "Client call", "timestamp": "15:00" },
    { "type": "task_added", "itemTitle": "Buy groceries", "timestamp": "15:10" }
  ],
  "currentState": {
    "openTaskCount": 12,
    "completedToday": 4,
    "overdueCount": 3,
    "nextEvent": "Client call at 15:00"
  }
}
```

#### 3.3 Haiku output (~200 tokens)

```json
{
  "executiveSummary": "Updated: 4 of 7 priorities done. Afternoon: client call at 3, then groceries...",
  "priorities": [...updated...],
  "risks": [...updated...],
  "companion": { "motivationNote": "Strong morning — 4 tasks cleared...", "focusMantra": "Finish strong" }
}
```

Only the narrative fields are replaced. Day structure, routine, additions — untouched.

#### 3.4 Tool schema

```typescript
const BRIEF_REFRESH_TOOL = {
  name: "submit_brief_refresh",
  input_schema: {
    properties: {
      executiveSummary: { type: "string" },
      priorities: { type: "array", items: { type: "object" } },
      risks: { type: "array", items: { type: "object" } },
      motivationNote: { type: "string" },
      focusMantra: { type: "string" },
    },
    required: ["executiveSummary"],
  },
};
```

#### 3.5 Acceptance

- [ ] After 3 task completions, Haiku refresh fires automatically
- [ ] executiveSummary reflects the completed tasks
- [ ] companion.motivationNote is updated
- [ ] Day structure (additions, removals, freeBlocks) is untouched
- [ ] Cost: < $0.001 per refresh
- [ ] _changelog cleared after refresh

---

### WP-4: Tier 3 — Delta-aware replanning

**Goal:** When the user says "plan my day" and a recent brief exists, send a delta to the LLM instead of regenerating from scratch.

#### 4.1 Delta detection

When `processPhrase` routes to `full_planning` and `state.focusBrief.generatedAt` is from today:

```typescript
function buildDelta(state: AppState): BriefDelta {
  const brief = state.focusBrief;
  const changelog = brief._changelog || [];

  // Tasks completed since brief was generated
  const completedSince = state.tasks.tasks.filter(t =>
    t.status === "done" && t.completedAt && t.completedAt > brief.generatedAt
  );

  // New tasks created since brief
  const newTasks = state.tasks.tasks.filter(t =>
    t.createdAt > brief.generatedAt && t.status !== "done"
  );

  // Events added/changed since brief
  const briefEventIds = new Set(
    brief.days.flatMap(d => d.additions.map(a => a.id))
  );
  const newEvents = state.calendar.events.filter(e =>
    !e.archived && e.status !== "cancelled" &&
    !briefEventIds.has(e.id) &&
    e.datetime?.slice(0, 10) === brief.dateRange.start
  );

  // Overdue tasks that weren't overdue at generation time
  const newOverdue = state.tasks.tasks.filter(t =>
    t.status !== "done" && t.due && t.due < state.hotContext.today &&
    (!t.due || t.due >= brief.dateRange.start)
  );

  return { completedSince, newTasks, newEvents, newOverdue, changelog };
}
```

#### 4.2 Inject delta into LLM context

Add to the assembler context for `full_planning` when a same-day brief exists:

```typescript
if (existingBrief && existingBrief.dateRange.start === today) {
  context.existingBrief = {
    generatedAt: existingBrief.generatedAt,
    executiveSummary: existingBrief.executiveSummary,
    days: existingBrief.days, // current state including patches
  };
  context.delta = buildDelta(state);
  context.replanMode = true;
}
```

#### 4.3 Prompt addition for delta-aware replanning

Add to the planning prompt section:

```
## Replanning Mode
If context contains "replanMode: true" and "existingBrief":
- This is an adjustment, NOT a fresh plan. The user already has a plan for today.
- Review the "delta" object to see what changed since the morning plan.
- KEEP the existing structure for unchanged portions of the day.
- ADJUST: remove completed tasks from priorities, add new tasks/events, update risks.
- For past time slots (before current time), do NOT modify them — they already happened.
- For future time slots, rearrange if needed based on the delta.
- Update executiveSummary to reflect current state (not morning state).
- Update companion to reflect progress made.
This saves tokens and preserves the user's morning decisions.
```

#### 4.4 Acceptance

- [ ] "Plan my day" at 2pm with morning brief → LLM receives `replanMode: true` + delta
- [ ] Morning time slots preserved (not regenerated)
- [ ] Afternoon adjusted based on completed tasks + new events
- [ ] Token usage: ~50% less than full regeneration (measured)
- [ ] "Plan my day" with no existing brief → full generation (unchanged from today)
- [ ] _changelog cleared after replan

---

## Execution order

```
WP-1 (_changelog type + tracking)  → standalone
WP-2 (Tier 1: TypeScript patches)  → needs WP-1
WP-3 (Tier 2: Haiku refresh)       → needs WP-1 + WP-2
WP-4 (Tier 3: Delta-aware replan)  → needs WP-1
```

WP-2 and WP-4 can run in parallel after WP-1. WP-3 needs WP-2 (it reads the patches).

---

## Files to create

| File | Purpose |
|---|---|
| `src/modules/briefPatcher.ts` | Tier 1: TypeScript hot patches (mark done, add event, recalc freeBlocks) |
| `src/modules/briefRefresher.ts` | Tier 2: Haiku mini-refresh of narrative fields |
| `src/modules/briefDelta.ts` | Tier 3: Delta builder for delta-aware replanning |

## Files to modify

| File | Change |
|---|---|
| `src/types/index.ts` | Add `_changelog?: BriefChange[]` to FocusBrief, add `BriefChange` interface |
| `app/(tabs)/chat.tsx` | Call `patchBrief()` after writes that touch tasks/calendar/okr |
| `src/modules/executor.ts` | Hook patcher into `applyWrites` flow |
| `src/modules/assembler.ts` | For `full_planning` with same-day brief: inject `existingBrief` + `delta` + `replanMode` |
| `src/constants/prompts.ts` | Add "Replanning Mode" section |
| `scripts/headless-runner.js` | 2-hour interval triggers Tier 2 if patches > 0 |
| `src/modules/briefRenderer.ts` | Render `_completed` items with strikethrough styling |
| `app/(tabs)/index.tsx` | Show completed items dimmed; add "Refresh" button for manual Tier 2 |

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Brief is from yesterday, user says "plan my day" | Full generation (no delta — different day) |
| User marks all tasks done | Tier 1 patches all → Tier 2 refreshes: "Everything done! Here's what you could do with free time..." |
| User adds 10 events rapidly | Tier 1 patches each one; Tier 2 fires after the 3rd |
| Brief doesn't exist yet (first run) | All tiers skip — full generation only path |
| App restarts mid-Tier-2 | _changelog persisted → Tier 2 re-triggers on next interval |
| Headless runner generates plan while app is open | App's next state reload picks up the new brief; _changelog starts fresh |

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Should Tier 1 re-render HTML? | **Yes.** After patching, call `renderBriefToHtml()` so the Focus Dashboard reflects changes immediately. |
| Should _changelog have a size limit? | **Yes.** Cap at 50 entries. Older entries are summarized ("12 earlier changes"). |
| Should Tier 2 run on web? | **Yes.** On web the proxy makes the Haiku call (same pattern as all LLM calls). No new infrastructure. |
| What if the user disagrees with a Tier 1 patch? | Patches are deterministic (task done → strikethrough). There's nothing to disagree with. If the brief structure needs creative adjustment, that's Tier 2/3. |
| Should Tier 3 delta include the full existing brief? | **No.** Only `executiveSummary` + `days` (structure). The routine template is already in context from the assembler. |

---

## Architecture Notes

**Added:** 2026-04-13 — Architect Review

### Critical Gap: Headless Runner Not Integrated

The three tiers (briefPatcher, briefRefresher, briefDelta) are coded and wired into the **app UI** (`chat.tsx`, `focus.tsx`) and the **web proxy** (`api-proxy.js`). However, the **headless runner** — the biggest source of Sonnet token spend — is completely unaware of them. It still calls `generatePlan()` (full Sonnet `full_planning`) **3 times daily**:

| Job | Call | Model | Cost/day | Verdict |
|-----|------|-------|----------|---------|
| Morning (daily) | `generatePlan("day")` | Sonnet | ~$0.03 | **KEEP** — the ONE daily plan |
| Evening (daily) | `generatePlan("tomorrow")` | Sonnet | ~$0.03 | **REMOVE** — regenerated in the morning anyway |
| Weekly (1x/week) | `generatePlan("week")` | Sonnet | ~$0.03/week | **KEEP** — acceptable |
| Missed recovery (every 30min) | `morningJob()` | Sonnet | ~$0.03 if triggered | **GUARD** — only if zero brief exists |
| Light check (4x/day) | inbox + notes | Haiku → Sonnet fallback | ~$0.01-0.03 | **FIX** — no Sonnet fallback for inbox |

**Estimated daily cost before fix:** ~$0.09-0.15/day (Sonnet × 3 + Haiku fallbacks)
**Estimated daily cost after fix:** ~$0.03-0.04/day (Sonnet × 1 morning + Haiku Tier 2 refreshes)

### Data Models

No new types needed. All types exist in `src/types/index.ts`:
- `BriefChange` interface (line 583)
- `_changelog?: BriefChange[]` on `FocusBrief` (line 610)
- `WriteOperation` interface (line 115)

**New function to add:** `needsFullReplan(state: AppState): boolean` in `briefDelta.ts`
- Returns `true` only if **fixed calendar events** changed since `generatedAt` (new event, cancelled event, moved event)
- Returns `false` for task completions, new tasks, OKR changes — these are Tier 1/2 territory
- Used as guard before any Sonnet call outside the morning job

### API Contracts

No new API endpoints. All changes are internal module wiring.

### Service Dependencies

| Module | Role | LLM? |
|--------|------|------|
| `briefPatcher.ts` | Tier 1 — instant patches | No |
| `briefRefresher.ts` | Tier 2 — Haiku narrative refresh | Haiku only |
| `briefDelta.ts` | Tier 3 — delta builder for assembler | No (data prep) |
| `headless-runner.js` | Scheduler — must orchestrate tiers | Wires Sonnet + Haiku |

External: Anthropic API (Haiku for Tier 2, Sonnet for morning plan only).

### Design Patterns

- **Dependency injection** — `injectRefreshLlm()` pattern already used in `briefRefresher.ts`. Headless runner must call this at startup (same as `api-proxy.js` does at line 197-201).
- **Circuit breaker** — all LLM calls already guarded by `isCircuitOpen()`. No change needed.
- **Tiered degradation** — Tier 1 (free) → Tier 2 (cheap Haiku) → Tier 3 (Sonnet only on user request or morning job). This is the core pattern.

### New vs Reusable Components

- **New:**
  - `needsFullReplan(state)` function in `briefDelta.ts` — structural change detector
- **Reusable:**
  - `patchBrief()` from `briefPatcher.ts` — already used in `chat.tsx` and `focus.tsx`
  - `shouldRefresh()` + `refreshBriefNarrative()` from `briefRefresher.ts` — already used in `api-proxy.js`
  - `createRefreshLlmFn()` from `briefRefresher.ts` — same injection pattern as proxy
  - `renderBriefToHtml()` from `briefRenderer.ts` — already called after patches

### Risks & Concerns

1. **Evening "tomorrow" plan removal.** If the user opens the app at 9pm expecting a tomorrow preview, they won't have one until the morning job runs. **Mitigation:** The user said this is acceptable — the morning plan is the source of truth. The app can show "Tomorrow's plan will be ready at [wake+30]" in the evening.

2. **Haiku-to-Sonnet fallback in inbox/notes processing.** Lines 427-441 in `llm.ts` escalate to Sonnet when Haiku validation fails. This is a hidden cost multiplier. **Mitigation:** For `bulk_input` and simple intents, do NOT fall back to Sonnet. Let validation failure return null and log the error. The inbox will be retried at the next light check.

3. **Race between app Tier 1 patches and headless runner.** If the app patches the brief while the headless runner is also running, they may clobber each other. **Mitigation:** The existing `.headless.lock` file prevents concurrent headless writes. The app checks the lock before flushing. Existing mechanism is sufficient.

4. **No brief at all on first day.** If user installs the app and no brief exists, all tiers must be skipped. `hasSameDayBrief()` already handles this correctly.

### UX Review Notes

No UX changes needed for this scope. The existing Focus Dashboard already renders `_completed` items. The only visual change is the evening view will show today's (patched) brief instead of a "tomorrow" brief.

### Testing Notes

#### Unit Tests Required
- `needsFullReplan(state)` — returns true when calendar event added since generatedAt, false when only tasks changed
- `shouldRefresh(state)` — returns true when changelog >= 3, false otherwise
- `buildDelta(state)` — correctly identifies completed, new, cancelled items since generatedAt

#### Component Tests Required
- Headless `eveningJob` — does NOT call `generatePlan`, calls `shouldRefresh` + `refreshBriefNarrative` when patches > threshold
- Headless `lightCheck` — calls `shouldRefresh` after inbox processing
- `refreshBriefNarrative` — updates narrative fields, clears changelog, does NOT touch day structure

#### Integration Tests Required
- Full day lifecycle: morning plan (Sonnet) → task done (Tier 1) → task done (Tier 1) → task done (Tier 1) → auto Haiku refresh (Tier 2) → verify brief is current
- Evening job with 5 patched changes → Tier 2 fires, no Sonnet call

#### Scope Isolation Tests Required
- No — single-user app

#### Agent Fixtures Required
- Haiku Tier 2 `submit_brief_refresh` response fixture — for testing `refreshBriefNarrative` without live API
- Record one Haiku refresh response with 3 changelog entries as input

---

## WP-5: Headless Runner Integration (NEW — Architect Addition)

**Goal:** Wire Tier 1/2 into the headless runner, remove redundant Sonnet calls, add `needsFullReplan` guard.

### 5.1 Changes to `scripts/headless-runner.js`

#### Startup — inject Tier 2 refresh function
```javascript
// After initLlmClient(API_KEY), add:
const { injectRefreshLlm, createRefreshLlmFn } = require("../src/modules/briefRefresher");
const Anthropic = require("@anthropic-ai/sdk");
const refreshClient = new Anthropic.default({ apiKey: API_KEY });
const HAIKU_MODEL = process.env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
injectRefreshLlm(createRefreshLlmFn(refreshClient, HAIKU_MODEL));
```

#### Evening job — replace `generatePlan("tomorrow")` with Tier 2
```javascript
async function eveningJob() {
  return withJobLock("evening", async () => {
    const state = await loadState();
    rebuildHotContext(state);
    updateSummaries(state);

    // Tier 2: refresh narrative if patches accumulated
    const { shouldRefresh, refreshBriefNarrative } = require("../src/modules/briefRefresher");
    if (shouldRefresh(state)) {
      console.log(`[${ts()}]   Running Tier 2 narrative refresh...`);
      const ok = await refreshBriefNarrative(state);
      if (ok) {
        await flush(state);
        await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
      }
    }

    // Proactive checks (no LLM)
    const today = state.hotContext.today;
    const nudges = await runProactiveChecks(state, today, 21);
    await writeNudges(nudges);
  });
}
```

#### Light check — add Tier 2 after inbox/notes
```javascript
// After inbox + notes processing, before proactive checks:
const { shouldRefresh, refreshBriefNarrative } = require("../src/modules/briefRefresher");
if (shouldRefresh(state)) {
  console.log(`[${ts()}]   Tier 2 narrative refresh (${getChangelogCount(state)} patches)...`);
  const ok = await refreshBriefNarrative(state);
  if (ok) {
    await flush(state);
    await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
  }
}
```

#### Morning job — unchanged (keeps the ONE Sonnet call)

#### Weekly job — unchanged (1x/week acceptable)

### 5.2 New function: `needsFullReplan` in `src/modules/briefDelta.ts`

```typescript
/**
 * Check if the fixed agenda changed enough to warrant a full Sonnet replan.
 * Only returns true for calendar structural changes — NOT task completions.
 */
export function needsFullReplan(state: AppState): boolean {
  const brief = state.focusBrief;
  if (!brief?.generatedAt || !brief?.days?.length) return false;

  const today = getUserToday(state);
  if (brief.dateRange?.start !== today) return false; // different day = morning job handles it

  const generatedAt = brief.generatedAt;
  const briefEventIds = new Set(
    brief.days.flatMap((d) => (d.additions || []).map((a) => a.id))
  );

  // New fixed events (not tasks) added since generation
  const newFixedEvents = state.calendar.events.filter((e) =>
    !e.archived && e.status !== "cancelled" &&
    !briefEventIds.has(e.id) &&
    e.datetime?.slice(0, 10) === today &&
    e.createdAt && e.createdAt > generatedAt
  );

  // Events in the brief that were cancelled since generation
  const cancelledBriefEvents = brief.days
    .flatMap((d) => (d.additions || []))
    .filter((a) => a.source === "calendar" && (a as any)._cancelled);

  return newFixedEvents.length >= 2 || cancelledBriefEvents.length >= 2;
}
```

**Threshold:** 2+ structural calendar changes. Single event addition is handled by Tier 1 patch. Only when the day's shape fundamentally shifts (multiple new meetings, multiple cancellations) do we escalate.

### 5.3 Acceptance

- [ ] Headless morning job still calls `generatePlan("day")` — unchanged
- [ ] Headless evening job does NOT call `generatePlan` — uses Tier 2 if patches > 0
- [ ] Headless light check runs Tier 2 refresh after inbox/notes processing if patches > threshold
- [ ] `injectRefreshLlm` called at headless startup
- [ ] Weekly job unchanged
- [ ] Missed recovery only triggers if NO brief exists for today (existing behavior — verify)
- [ ] Daily Sonnet calls reduced from 3 to 1

### 5.4 Execution order

```
WP-5.2 (needsFullReplan function)        → standalone, add to briefDelta.ts
WP-5.1a (headless startup injection)     → standalone
WP-5.1b (evening job rewrite)            → needs 5.1a
WP-5.1c (light check Tier 2 addition)    → needs 5.1a
```

---

## WP-6: Reduce Haiku-to-Sonnet Fallback Cost (NEW — Architect Addition)

**Goal:** Prevent the Haiku→Sonnet validation fallback from silently doubling token cost on simple intents.

### 6.1 Change in `src/modules/llm.ts`

The fallback at lines 427-441 escalates ALL failed Haiku calls to Sonnet. For `bulk_input`, `task_create`, `task_update`, `calendar_create`, `calendar_update`, and other simple intents, this is wasteful — if Haiku can't handle it, Sonnet likely produces the same validation error.

**Change:** Only fall back to Sonnet for complex intents that genuinely benefit from a smarter model.

```typescript
const SONNET_FALLBACK_INTENTS: Set<IntentType> = new Set([
  "full_planning", "suggestion_request", "emotional_checkin", "topic_query",
]);

// In callLlm, replace the blanket Haiku fallback:
if (model === HAIKU && SONNET_FALLBACK_INTENTS.has(intentType)) {
  console.warn(`[LLM] Haiku failed for ${intentType} — retrying with Sonnet`);
  // ... existing fallback logic
} else if (model === HAIKU) {
  console.warn(`[LLM] Haiku failed for ${intentType} — no Sonnet fallback for simple intents`);
  recordFailure(`haiku validation failed for ${intentType}`);
  return null;
}
```

### 6.2 Acceptance

- [ ] `bulk_input` Haiku failure does NOT escalate to Sonnet
- [ ] `task_create` Haiku failure does NOT escalate to Sonnet
- [ ] `full_planning` Haiku failure DOES escalate to Sonnet (unchanged)
- [ ] Cost savings: eliminates ~50% of accidental Sonnet calls
