# FEAT059 — Migrate `calendar_management` intents (calendar_create + calendar_update + calendar_query) to v4 skill

**Type:** feature
**Status:** Approved by user 2026-04-27 — stages 3–7 ran. **Stage 2 review notes:** all 7 open Qs deferred to architect; PM proposals accepted. Q1 export `getActiveEvents` + add `calendarEvents` resolver branch; Q2 fix latent `calendarToday`/`calendarNextSevenDays` resolver bug in this FEAT; Q3 default duration 60 min; Q4 composite "free?" reply; Q5 single tool `submit_calendar_action`; Q6 7-phrase set with ≥6/7 threshold; Q7 recurring redirect language as proposed.
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02 (Phase 2 — fourth deliverable)
**Tags:** skill-migration, calendar, batch-1, template-application
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done), FEAT051 (Done), FEAT055 (Done), FEAT056 (Done), FEAT057 (Done — migration template), FEAT058 (Done — template generalized)
**Unblocks:** FEAT040 admission control (rule belongs inside calendar skill prompt — will be a follow-on FEAT)

---

## Status

Draft — awaiting human review before architect picks it up for stages 3–4.

---

## Problem Statement

Calendar CRUD is the third specialized intent in the v4 migration sequence,
following task_management and notes_capture. Today's legacy paths handle:

- `calendar_create` — *"schedule a meeting with X tomorrow at 3pm"*
- `calendar_update` — *"reschedule the standup to Wednesday"*, *"cancel
  Tuesday's call"*
- `calendar_query` — *"what's on my calendar today?"*, *"am I free Friday
  afternoon?"*

All three flow through the regex router → assembler `switch` case (line
54-61) → `SYSTEM_PROMPT` rules (`prompts.ts:18-19`) →
`executor.applyWrites` for time-validation, conflict detection, and
recurring-event safety.

The migration template (proven across 3 skills now: priority_planning,
task_management, notes_capture) applies cleanly. Two calendar-specific
considerations:

1. **Recurring-event safety rule.** `SYSTEM_PROMPT:179` states *"NEVER
   set recurring/recurrence/recurrenceDay fields on a calendar event
   write — those are RecurringTask, not calendar events."* This rule
   must move into the calendar skill's prompt verbatim or the
   migration produces wrong writes.
2. **FEAT040 admission control** belongs in the calendar skill's
   prompt + handler (per portfolio review §1 verdict). **Out of scope
   for FEAT059** — folding admission control into this FEAT doubles
   its scope. FEAT040 ships as a follow-on after FEAT059's parity is
   proven, similar to how FEAT057's legacy cleanup is deferred.

This FEAT validates the migration template against a third real CRUD
intent (after task_management) — at which point the template is
unambiguously canonical.

---

## Goals

1. A `calendar_management` skill folder exists, loads at boot, and
   routes via FEAT051 for typical calendar phrases.
2. The skill's handler produces the **same writes** as today's legacy
   intents for an equivalent phrase. Same time-validation, same
   conflict detection, same recurring-event rejection.
3. Setting `setV4SkillsEnabled([])` reverts to legacy paths.
4. The recurring-event safety rule from `SYSTEM_PROMPT:179` is
   preserved verbatim in the new skill prompt — no behavior drift.
5. No regression in 315 baseline tests.
6. The migration template (single tool + array writes + lazy executor
   import + try/catch + items pass-through) is reused **without
   modification**. If anything in the template needs adjustment,
   surface and fix.

---

## Success Metrics

- Skill loads at boot.
- 7-phrase regression set produces correct writes / items via the v4
  path (≥6/7).
- Setting `setV4SkillsEnabled([])` reverts all 7 phrases to legacy.
- All 315 existing tests pass.
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Schedule a meeting via v4

**As a** user, **when** I say *"schedule a meeting with Contact A on
Friday at 3pm"*, **I want** the v4 path to create a calendar event with
the right title, datetime, and duration.

**Acceptance Criteria:**
- [ ] Given `calendar_management` is enabled, *"schedule a meeting with
      Contact A on Friday at 3pm"* creates a `CalendarEvent` with title
      containing "Contact A", `datetime` set to Friday 15:00 in user's
      timezone, default `durationMinutes` (60), `status: "scheduled"`.
- [ ] Chat reply confirms ("Scheduled: Contact A — Fri 3pm") with
      *via calendar_management* badge.
- [ ] Same phrase with `setV4SkillsEnabled([])` produces an identical
      event via the legacy `calendar_create` flow.

### Story 2 — Reschedule / cancel an event via v4

**Acceptance Criteria:**
- [ ] *"reschedule the standup to Wednesday at 10am"* updates the
      matching event's `datetime` via the v4 path.
- [ ] *"cancel Tuesday's call"* sets the matching event's `status` to
      `"cancelled"`.
- [ ] Multiple matching candidates → clarification request listing
      candidates with their ids (same pattern as task_management).

### Story 3 — Query calendar via v4

**Acceptance Criteria:**
- [ ] *"what's on my calendar today?"* returns an `items` array of
      today's events. Same shape as legacy `calendar_query`.
- [ ] *"am I free Friday afternoon?"* returns either an empty `items`
      array (with reply "You're free Friday afternoon.") or a
      populated array showing what's blocking that window — composite
      reply combining a binary answer with the underlying data.
- [ ] No matching events → polite reply, not an empty bubble.

### Story 4 — Recurring-event safety preserved

**As a** developer, **I want** the prompt's recurring-event guard to
remain in force, **so that** *"schedule a meeting every Friday"*
creates a `RecurringTask` (not a `CalendarEvent` with recurring
fields).

**Acceptance Criteria:**
- [ ] The skill's `prompt.md` includes the verbatim rule from
      `SYSTEM_PROMPT:179`.
- [ ] *"schedule a meeting every Friday at 4pm"* either redirects to
      the recurring handler (since `calendar_management.dataSchemas.write`
      doesn't include `recurringTasks`) or sets `needsClarification`.
      It does NOT emit a CalendarEvent with `recurring: true` fields.
- [ ] Test fixture verifies: in the recurring-attempt path, the
      handler's writes contain no `recurring` / `recurrence` /
      `recurrenceDay` fields.

### Story 5 — Time conflicts and lifestyle validation preserved

**As a** developer, **I want** the v4 calendar handler to delegate to
`executor.applyWrites` so existing time-conflict detection,
lifestyle-block enforcement, and conflict warnings run unchanged.

**Acceptance Criteria:**
- [ ] Handler delegates to `applyWrites` exactly as task_management /
      notes_capture do.
- [ ] When v4 creates an event at a time that conflicts with the
      user's fixed routine block, existing time-stripping fires (same
      code path).
- [ ] Conflict detection populates `conflictsToCheck` with title
      fragments per today's behavior; `applyWrites` surfaces conflicts
      in the reply via the existing executor warning prefix.

### Story 6 — Dual-path coexistence

**Acceptance Criteria:**
- [ ] `setV4SkillsEnabled` excluding `calendar_management` → legacy
      `calendar_create` / `calendar_update` / `calendar_query` runs.
- [ ] Full enabled set → v4 wins.

### Story 7 — Migration template reuse (zero infrastructure changes)

**As an** architect, **I want** FEAT059 to ship with **zero changes to
chat.tsx, dispatcher resolver SUPPORTED_KEYS structure, or shared
types**, **so that** the template is unambiguously canonical after
this third application.

**Acceptance Criteria:**
- [ ] No changes to `app/(tabs)/chat.tsx`.
- [ ] No changes to `src/types/orchestrator.ts` or
      `src/types/index.ts`.
- [ ] If the calendar skill needs `calendarEvents` (full active list)
      as a context key, ONE additive resolver branch is acceptable
      (mirrors FEAT057's `buildTaskIndex` extension pattern). Counts
      as template-compatible.
- [ ] If anything beyond a single resolver-branch addition is needed,
      surface the divergence in stage 3/4 and update AGENTS.md.

### Story 8 — No regression elsewhere

- [ ] All 315 pre-FEAT059 tests pass.
- [ ] Manual smoke check on three non-calendar phrases: *"add a task
      to ..."* (task_management), *"save this idea: ..."*
      (notes_capture), *"what should I focus on?"*
      (priority_planning) — each produces the same response as before
      FEAT059.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **FEAT040 admission control** — the rule lives in the calendar skill
  *eventually*, but folding it here doubles scope. FEAT040 is a
  follow-on after FEAT059 parity is proven.
- **Recurring task creation** — calendar skill redirects recurring
  requests to the recurring-task handler (which migrates later as a
  separate FEAT).
- **Google Calendar bidirectional sync** — FEAT018 is read-only;
  bidirectional is its own future FEAT.
- **Calendar UI changes** — existing calendar view unaffected.
- **Audit log** — Phase 3.
- **Privacy filter** — Phase 3.
- **Legacy cleanup PR** — separate FEAT after FEAT059 parity bake-in.

---

## Assumptions & Open Questions

**Assumptions:**
- `executor.applyWrites` already handles `file: "calendar"` with full
  validation (time conflicts, lifestyle blocks, recurring rejection).
  It does — today's legacy uses this exact path.
- The CalendarEvent shape matches `applyWrites` expectations. Handler
  defensively fills defaults for omitted fields (same pattern as
  notes_capture's `fillNoteDefaults`).
- The recurring-event rule from SYSTEM_PROMPT can be lifted verbatim
  into the calendar skill prompt without behavioral drift.

**Open Questions for the Architect:**

1. **`calendarEvents` resolver key.** Legacy assembler builds via a
   private `getActiveEvents(state)` helper. Two options:
   - (a) **Export `getActiveEvents`** from `assembler.ts` and add a
     `calendarEvents` branch to the dispatcher resolver. Mirrors
     FEAT057's `buildTaskIndex` extension.
   - (b) Pass `state.calendar.events` raw — wasteful (cancelled,
     archived, past events all go to the LLM).
   PM proposes (a). Architect call.

2. **Latent resolver bug: `calendarToday` and `calendarNextSevenDays`
   aren't actually computed by the resolver.** priority_planning's
   `context.ts` declares them, but the resolver's `default` branch
   returns `state[key]` which is undefined for these. Two options:
   - (a) **Fix in this FEAT** — add resolver branches that filter
     `state.calendar.events` by date range. Fixes priority_planning
     for free; calendar_management may use them too.
   - (b) Defer to a separate fix FEAT.
   PM proposes (a) — surface pre-existing gaps as we encounter them.

3. **Default duration for "schedule a meeting" with no duration?**
   Legacy default is 60 minutes. PM proposes same. Confirm.

4. **"Am I free X?" composite reply.** Both `items` (events
   blocking the window) AND a binary `reply` ("You're free 2-5pm" or
   "You have 1 thing"). PM proposes this composite. Confirm.

5. **Single tool or split create/update/query?** Same question as
   FEAT057 / FEAT058. PM proposes single tool `submit_calendar_action`
   matching the canonical template. Confirm.

6. **7-phrase regression set:**
   - 3 creates (with time, without time → clarification, with explicit
     duration)
   - 2 updates (reschedule, cancel)
   - 2 queries (today, free-time check)
   Threshold: ≥6/7. Architect can adjust.

7. **Recurring-event redirect language.** Skill prompt redirects
   recurring requests with what wording? PM proposes: *"That sounds
   like something that repeats — try saying 'add a weekly recurring
   task to ...' and the recurring handler will pick it up."*
   Architect / UX call on tone.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27. Full design review in
`FEAT059_design-review.md`.*

### Open-question resolutions (all PM proposals confirmed)

| Q | Decision |
|---|---|
| 1 — calendarEvents resolver | Export `getActiveEvents` from `assembler.ts` (visibility-only refactor); add three resolver branches: `calendarEvents` (today + future, active), `calendarToday` (today only), `calendarNextSevenDays` (today through today+6). |
| 2 — Latent resolver bug | Fix in this FEAT. The `calendarToday` and `calendarNextSevenDays` branches added per Q1 also fix priority_planning's silent-undefined behavior for those keys. |
| 3 — Default duration | 60 minutes when LLM omits it. Handler defensively fills if missing. |
| 4 — "Am I free?" reply | Composite. Skill prompt directs LLM to populate both `items` (events blocking the window) AND a `reply` answering the binary question. |
| 5 — Single tool | `submit_calendar_action` — matches canonical template. |
| 6 — Regression set | 7 phrases (3 create / 2 update / 2 query) with ≥6/7 threshold. |
| 7 — Recurring redirect | *"That sounds like something that repeats — try saying 'add a weekly recurring task to ...' and the recurring handler will pick it up."* Inside the skill prompt's "do NOT" section. |

### Skill folder spec

```
src/skills/calendar_management/
├── manifest.json     # id "calendar_management", model haiku, tools: [submit_calendar_action]
├── prompt.md         # ~50 lines — CRUD rules + recurring-event guard verbatim from SYSTEM_PROMPT:179
├── context.ts        # 6 keys (5 supported + 1 new: calendarEvents)
└── handlers.ts       # mirrors task_management; defensive CalendarEvent defaults
```

**`manifest.json`:**

```jsonc
{
  "id": "calendar_management",
  "version": "1.0.0",
  "description": "Schedule, reschedule, cancel, and query calendar events. Handles 'schedule a meeting', 'reschedule the standup', 'cancel Tuesday's call', 'what's on my calendar today', 'am I free Friday'. NEVER creates recurring events as calendar entries — those belong to the recurring-task handler.",
  "triggerPhrases": [
    "schedule a meeting",
    "book a meeting",
    "set up a call",
    "reschedule",
    "cancel the meeting",
    "what's on my calendar",
    "what do I have today",
    "am I free",
    "do I have anything",
    "block off time"
  ],
  "structuralTriggers": ["/cal", "/event"],
  "model": "haiku",
  "dataSchemas": {
    "read": ["calendar", "tasks", "topics", "objectives"],
    "write": ["calendar"]
  },
  "supportsAttachments": false,
  "tools": ["submit_calendar_action"],
  "autoEvaluate": true,
  "tokenBudget": 3000,
  "promptLockedZones": [],
  "surface": null
}
```

**`prompt.md`** (~50 lines): CRUD rules with verbatim recurring guard.

**`context.ts`:**

```ts
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  calendarEvents: true,         // NEW key (this FEAT)
  contradictionIndexDates: true,
  topicList: true,
  existingTopicHints: true,
};
```

**`handlers.ts`:** Same shape as task_management. Defensive fill for
CalendarEvent fields the LLM omits (status, type, priority, notes,
relatedInbox, durationMinutes default 60). Lazy-imports
`executor.applyWrites` inside try/catch (FEAT057 B1 pattern).

### Dispatcher resolver extension

`src/modules/skillDispatcher.ts` — three new branches in
`computeContextValue` (and add the three keys to `SUPPORTED_KEYS`):

```ts
case "calendarEvents": {
  const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
  return getActiveEvents(state as any);
}
case "calendarToday": {
  const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
  const today = (state.hotContext as { today?: string } | undefined)?.today;
  if (!today) return [];
  return getActiveEvents(state as any).filter((e: any) =>
    typeof e.datetime === "string" && e.datetime.slice(0, 10) === today
  );
}
case "calendarNextSevenDays": {
  const { getActiveEvents } = require("./assembler") as typeof import("./assembler");
  const today = (state.hotContext as { today?: string } | undefined)?.today;
  if (!today) return [];
  // ISO date arithmetic — add 6 days to "today"
  const startD = new Date(today + "T00:00:00Z");
  const endD = new Date(startD); endD.setUTCDate(endD.getUTCDate() + 6);
  const endISO = endD.toISOString().slice(0, 10);
  return getActiveEvents(state as any).filter((e: any) => {
    const d = typeof e.datetime === "string" ? e.datetime.slice(0, 10) : "";
    return d >= today && d <= endISO;
  });
}
```

This three-branch addition is the only resolver work. Story 7's
"zero infrastructure changes" allowance covers it.

### `assembler.ts` change

`getActiveEvents` is exported (visibility-only):

```ts
// Before (line 329): function getActiveEvents(state: AppState) { ... }
// After:           : export function getActiveEvents(state: AppState) { ... }
```

No behavioral change.

### Boot wiring

```ts
setV4SkillsEnabled([
  "priority_planning",
  "general_assistant",
  "task_management",
  "notes_capture",
  "calendar_management",
]);
```

### chat.tsx integration

**Zero changes.**

### Service Dependencies

| Internal | Used for |
|---|---|
| `executor.applyWrites` | Persists writes; conflict + lifestyle + recurring rejection |
| `assembler.getActiveEvents` (newly exported) | Filters active events for context |
| Existing FEAT054/051/055/056/057/058 stack | Unchanged |

No third-party deps. No new types.

### Risks & Concerns

- **Recurring rule preservation.** Highest-impact risk. The
  `prompt.md` must include the verbatim `SYSTEM_PROMPT:179` rule.
  Stage 7 fixture explicitly tests *"schedule every Friday"* → no
  CalendarEvent write with recurring fields.
- **`calendarToday` filter semantics.** `getActiveEvents` already
  excludes `eventDate < today`. Filtering by `eventDate === today`
  on top is straightforward. Edge case: events with empty/invalid
  datetime get excluded by `getActiveEvents`'s pre-filter.
- **FEAT040 admission control deferred.** Calendar without admission
  control is functionally equivalent to today's `calendar_create` (no
  objective impact analysis). Acceptable for parity; admission control
  is a separate behavioral change scoped to FEAT040.
- **Default duration handling.** If LLM omits `durationMinutes`,
  handler fills 60. Different from legacy where the LLM might omit it
  and applyWrites would default later. Architect-side note: verify
  applyWrites doesn't override an explicit value, or the 60-default
  could mask LLM choosing a different duration.

### UX Review Notes

Zero new screens. "via calendar_management" badge under bubbles for v4
calendar phrases. Items render via existing ItemListCard for queries.

### Testing Notes

#### Unit Tests
- Handler: writes filtered to file="calendar"
- Handler: defensive defaults fill required CalendarEvent fields
- Handler: graceful applyWrites failure (B1 pattern)
- Handler: clarification flag propagated

#### Component Tests
- Skill loads via FEAT054 (smoke)
- Recurring guard: prompt contains the verbatim rule

#### Resolver Tests
- `calendarEvents` returns active events (fixture state with mix)
- `calendarToday` filters to today only
- `calendarNextSevenDays` filters to 7-day window
- `getActiveEvents` is exported and importable

#### Integration Tests
- 7-phrase regression fixture (Story 6) — co-located in test file:
  1. "schedule a meeting with Contact A on Friday at 3pm"
  2. "schedule a quick sync next Tuesday" (no time → clarification)
  3. "block 2 hours for deep work tomorrow morning" (explicit duration)
  4. "reschedule the standup to Wednesday at 10am" (update)
  5. "cancel Tuesday's call" (update / cancel)
  6. "what's on my calendar today?" (query, items)
  7. "am I free Friday afternoon?" (composite query)
- Recurring-attempt test: *"schedule a meeting every Friday at 4pm"* →
  handler does NOT emit CalendarEvent with recurring=true.

#### Regression
- Full `npm test` passes (current 315 baseline + ~14 new).
- `npm run build:web` exports.

---

## UX Notes

[**To be filled after architect review.** Same UX as
task_management / notes_capture: "via calendar_management" badge,
items render via ItemListCard for queries. No layout changes.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.**]
