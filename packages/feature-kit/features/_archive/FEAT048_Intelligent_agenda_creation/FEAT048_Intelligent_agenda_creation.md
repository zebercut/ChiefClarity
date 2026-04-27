# FEAT048 — Intelligent Agenda Creation

**Status:** Planned  
**MoSCoW:** MUST  
**Category:** Planning  
**Priority:** 1  
**Release:** v2.3  
**Tags:** agenda, recurring, calendar, conflicts, hygiene, planning, intelligence  
**Created:** 2026-04-21

---

## Problem Statement

The agenda creation pipeline produces time-blocked plans that miss or misplace items in ways a human would never accept. The system gets the basic mechanics right (routine templates, calendar events, task slotting) but lacks the intelligence to produce plans that make real-world sense.

Concrete failures observed:

- **Recurring events vanish from weekly plans** — Child A's weekly class (Tue/Thu) and Child B's Friday activity (Fri) don't appear because the LLM was expected to parse raw schedule definitions instead of receiving pre-computed dates *(partially fixed, needs hardening)*
- **Recurring payments duplicated 4x** — same event created by the recurring processor, the LLM, and the injection post-processor because no single source of truth existed
- **Home-based tasks scheduled while user is away** — cooking dinner at 17:30 scheduled during an off-site activity across town, because the system has zero location awareness
- **All-day events never conflict** — a "Conference" all-day event and a "2pm Meeting" don't trigger conflict warnings because `T00:00:00` is silently excluded from overlap checks
- **Completed tasks haunt the agenda** — marking a task done sets `_completed: true` on the brief addition but doesn't remove it; if the flag is lost, it reappears
- **Brief goes stale without knowing it** — Tier 1 patches don't update `generatedAt`, so a 9-hour-old brief with 20 patches is treated as current
- **Recurring instances bloat the task file** — no archival policy for completed recurring instances; tasks.json grows unbounded
- **Google Calendar edits overwritten on sync** — local notes/edits on a synced event are replaced by the next sync because upsert is unconditional

---

## Goals

1. An agenda where every recurring commitment reliably appears on every applicable day — no omissions, no duplicates
2. Conflict detection that catches time overlaps, capacity overflow, and location impossibilities — not just identical-time clashes
3. A data lifecycle that prevents task/event bloat and preserves user edits
4. LLM context that gives the planner enough ground truth to make human-quality scheduling decisions

---

## Success Metrics

- Zero recurring event omissions across 30 consecutive daily + weekly plans
- Zero duplicate calendar items from recurring + LLM + injection overlap
- Conflict detection catches all-day event overlaps and capacity-overloaded days
- Completed recurring instances archived within 48 hours
- Google Calendar synced events preserve local edits across re-syncs

---

## User Stories

### Story 1 — Recurring events reliably appear in every plan

**As a** user with 5+ recurring commitments (weekly classes, extracurricular activities, tutoring, standup, etc.), **I want** every applicable recurring event to appear in my daily and weekly plans at the correct time, **so that** I can trust the agenda without manually checking.

**Acceptance Criteria:**
- [ ] Given a recurring task "Weekly Class" (weekly, Tue/Thu, 16:00, 90 min), when the user says "plan my week", then Tuesday and Thursday each show "Weekly Class" at 16:00 in their additions with duration 90
- [ ] Given a recurring task "Journal" (daily, 07:00), when the user says "plan my day", then today shows "Journal" at 07:00
- [ ] Given a recurring task with `excludeDates: ["2026-04-22"]`, when the plan covers that date, then no entry appears for that date
- [ ] Given `active: false` on a recurring task, then it never appears in any plan
- [ ] Given `schedule.type: "weekdays"`, then the task appears Mon–Fri and NOT on Sat/Sun in a weekly plan
- [ ] A single recurring event appears at most ONCE per day in the focus brief — no duplicates from LLM + injection + processor
- [ ] Recurring calendar instances (ID prefix `rcev_` or `isRecurringInstance: true`) do not appear in `calendarEvents` sent to the LLM — they appear only via `recurringByDate`
- [ ] The weekly job processes recurring tasks for all 7 days BEFORE generating the weekly plan

### Story 2 — No duplicate calendar items from recurring events

**As a** user, **I want** each recurring event to exist exactly once per day in my calendar and my agenda, **so that** I don't see "Recurring tutoring payment" four times on Wednesday.

**Acceptance Criteria:**
- [ ] Given a recurring task with `schedule.time` set, when `processRecurringTasks()` creates a calendar event, then the event has `isRecurringInstance: true`
- [ ] Given a recurring calendar event already in `calendarEvents` and the same item in `recurringByDate`, then the LLM receives the item from ONE source only (recurringByDate), not both
- [ ] Given the LLM emits an addition with the same title and date as a recurring calendar instance, then `injectMissingCalendarEvents()` does not inject the duplicate (matches by title+date, not just ID)
- [ ] Given `deduplicateDayAdditions()` runs on the brief, then same-title + same-time entries within a day are collapsed to one
- [ ] Given a legacy recurring instance (created before `isRecurringInstance` flag), then the assembler filters it by ID prefix `rcev_` as fallback

### Story 3 — Location-aware scheduling

**As a** user who leaves home for activities (off-site venue, office, errands), **I want** the planner to not schedule home-based tasks (cooking, laundry) while I'm away, **so that** the plan is physically possible.

**Acceptance Criteria:**
- [ ] Given a `CalendarEvent` or `RecurringTask` has field `location: string` populated (e.g., "Community Center, Main St"), then the LLM receives this in context
- [ ] Given a `RecurringDayItem` in `recurringByDate` has `isAway: true`, then the planner does not schedule tasks with `locationConstraint: "at_home"` during that time window (including travel buffer)
- [ ] Given a user's `userProfile.location` is set (home address) and a calendar event has a different location, then the assembler pre-computes an away-block for that event with a configurable travel buffer (default: 15 min each way)
- [ ] Given two consecutive away events at the same location, then no travel buffer is added between them
- [ ] Given a task has `locationConstraint: "flexible"` or no constraint, then it may be scheduled during away time (e.g., "respond to emails" can happen at a venue waiting room)
- [ ] Given a routine item is `category: "routine"` with title containing "cook" or similar home keywords, then the planner infers `at_home` unless overridden
- [ ] The Focus Brief's `AgendaEvent` includes an optional `location?: string` field so the UI can display where each event happens

### Story 4 — Intelligent conflict detection

**As a** user, **I want** the system to warn me about scheduling problems beyond simple time overlaps, **so that** I don't discover conflicts in the moment.

**Acceptance Criteria:**
- [ ] Given an all-day event "Conference" and a task at 14:00, then conflict detection flags the overlap (currently skipped because `T00:00:00` is excluded)
- [ ] Given 5 tasks each allocating 4 hours on the same day (20 hrs total), then a capacity warning surfaces: "Today has X hours of work scheduled but only Y hours available"
- [ ] Given a new event overlaps with a `flexibility: "fixed"` event, then the conflict is flagged as "immovable — must reschedule the new item"
- [ ] Given two writes in the same LLM batch create events at the same time, then the intra-batch conflict is detected (not just each-vs-existing)
- [ ] Given a task is marked `locationConstraint: "at_home"` and is scheduled during an away block, then a location conflict is flagged

### Story 5 — Brief freshness and completion lifecycle

**As a** user, **I want** my agenda to stay accurate throughout the day as I complete tasks and events change, **so that** I don't have to re-plan manually.

**Acceptance Criteria:**
- [ ] Given a task is marked done via Tier 1 patch, then the brief's `generatedAt` is updated to the current timestamp
- [ ] Given the brief is older than 4 hours AND has 3+ changelog entries, then the system triggers a Tier 2 narrative refresh automatically
- [ ] Given a task is marked done, then it is removed from the day's `additions` array (not just hidden by `_completed` flag) so it cannot reappear
- [ ] Given a completed recurring instance is older than 48 hours, then it is archived from the tasks table (same as calendar event archival)
- [ ] Given an event is cancelled via Tier 1 patch, then free blocks are recalculated to include the newly freed time

### Story 6 — Notes-to-event intelligence

**As a** user who captures thoughts as notes ("call dentist tomorrow 3pm", "tutoring payment wednesday"), **I want** the system to create the right tasks and events with proper dedup, **so that** I don't get duplicates or misclassified items.

**Acceptance Criteria:**
- [ ] Given a note "call dentist tomorrow 3pm", when processed via bulk_input, then a calendar event is created with title "Call dentist", datetime tomorrow 15:00, duration 30 min
- [ ] Given a note that matches an existing task by semantic similarity (cosine distance < 0.10), then no new task is created and the write is silently blocked
- [ ] Given a note that is semantically similar (distance 0.10–0.20) to an existing task, then the LLM response includes a flag or comment "similar to existing task: X" (not silently blocked)
- [ ] Given a note processed into a task, then `WriteOperation.sourceNoteId` is populated so the note's processed summary can trace which writes it generated
- [ ] Semantic dedup works on both Node (proxy) and Web (Capacitor) — not Node-only

### Story 7 — Google Calendar edit preservation

**As a** user who adds notes to synced Google events, **I want** my local edits to survive the next sync, **so that** I don't lose my preparation notes.

**Acceptance Criteria:**
- [ ] Given a Google Calendar event was synced and the user locally edited the `notes` field, when the next sync runs, then the local `notes` value is preserved (not overwritten by Google's empty notes)
- [ ] Given a Google Calendar event changed its `datetime` on Google, when the next sync runs, then the local copy's datetime is updated but other local edits (notes, priority) are preserved
- [ ] Given a Google Calendar event was deleted locally (marked cancelled), when the next sync detects it still exists in Google, then the event is re-synced (user's local deletion is overridden by Google as source of truth for existence)
- [ ] Google Calendar events in the LLM context carry a `source: "google_calendar"` hint so the LLM knows not to reschedule them

### Story 8 — Task and event lifecycle hygiene

**As a** user with months of accumulated data, **I want** the system to clean up completed and stale items automatically, **so that** the task list stays fast and relevant.

**Acceptance Criteria:**
- [ ] Given a completed task older than 7 days, then it is archived (same policy as completed calendar events)
- [ ] Given a completed recurring task instance older than 48 hours, then it is archived
- [ ] Given a task in status "parked" for more than 30 days with no updates, then a nudge is surfaced: "This task has been parked for a month — still relevant?"
- [ ] Given hygiene runs, then a summary is logged to chat history: "Archived X tasks, Y events, cleaned Z duplicates"
- [ ] Hygiene never deletes items — only archives (soft delete via `archived: true` or `status: "archived"`)

---

## Architecture Notes

*To be filled by Architect Agent.*

### Data model changes needed
- `CalendarEvent`: add `location?: string`, `isAway?: boolean`, `travelTimeMinutes?: number`
- `Task`: add `locationConstraint?: "at_home" | "at_work" | "flexible"`, `location?: string`
- `RecurringTask`: add `location?: string`, `isAway?: boolean`
- `RecurringDayItem`: add `location?: string`, `isAway?: boolean`
- `AgendaEvent`: add `location?: string`
- `UserProfile`: populate existing `location` field (home address)

### Modules affected
- `recurringProcessor.ts` — location fields on instances + recurringByDate
- `assembler.ts` — pre-compute away-blocks, send location context
- `prompts.ts` — TRAVEL RULE with location data backing
- `conflict.ts` — all-day event handling, capacity checks, intra-batch, location conflicts
- `briefPatcher.ts` — update generatedAt, remove completed additions
- `calendarHygiene.ts` — task archival, recurring instance cleanup
- `executor.ts` — location validation on writes
- `google/calendar.ts` — edit preservation on sync, source hint in context

---

## Out of Scope

- Two-way Google Calendar sync (write-back to Google)
- Travel time estimation via maps API (use configurable default buffer)
- Shared calendars / multi-user conflict detection
- Custom hygiene retention policies per user
- Drag-and-drop agenda editing in the UI
- Smart time-of-day preferences ("I prefer deep work in the morning") — this is a companion/pattern insight, not a scheduling constraint

---

## Open Questions

1. How should the user set location on events? Via chat ("weekly class is at Main St venue") → LLM writes to `location` field? Or a UI field on the event editor?
2. Should the default travel buffer (15 min) be configurable per user or per event? Per event is more flexible but more effort to populate.
3. Should task archival use `archived: true` (like calendar events) or a separate `status: "archived"` value? The Task interface currently has no `archived` field.
4. For Google sync edit preservation: should we track `locallyEdited: true` on events, or diff individual fields on sync?
5. Should capacity warnings consider the user's `availableWorkWindows` from `userLifestyle`, or just count total hours in the day minus sleep?
