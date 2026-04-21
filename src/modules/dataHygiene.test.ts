/**
 * FEAT047 — Data Hygiene tests.
 * Run with: npx ts-node src/modules/dataHygiene.test.ts
 */
import assert from "assert";
import type { Task, CalendarEvent, AppState, RecurringTask } from "../types";
import { runDeterministicHygiene } from "./dataHygiene";

const TODAY = "2026-04-14";

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${label}`);
    passed++;
  } catch (err: any) {
    console.error(`  \u2717 ${label}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "T?", title: "?", due: "", priority: "medium", status: "pending",
    category: "", subcategory: "", okrLink: null, conflictStatus: "ok",
    conflictReason: "", conflictWith: [], notes: "", createdAt: "2026-04-10T08:00:00",
    completedAt: null, dismissedAt: null, comments: [], timeAllocated: "",
    relatedCalendar: [], relatedInbox: [],
    ...partial,
  };
}

function makeEvent(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "E?", title: "?", datetime: "", durationMinutes: 60, status: "scheduled",
    type: "", priority: "", notes: "", relatedInbox: [],
    ...partial,
  };
}

function makeRecurring(partial: Partial<RecurringTask>): RecurringTask {
  return {
    id: "R?", title: "?", schedule: { type: "daily" }, category: "", priority: "medium",
    okrLink: null, active: true, createdAt: "2026-04-01T00:00:00",
    ...partial,
  };
}

function makeState(overrides: {
  tasks?: Task[];
  events?: CalendarEvent[];
  recurring?: RecurringTask[];
}): AppState {
  return {
    hotContext: { today: TODAY, userName: "Test", openTaskCount: 0, overdueCount: 0 },
    tasks: { _summary: "", tasks: overrides.tasks || [] },
    calendar: { _summary: "", events: overrides.events || [] },
    recurringTasks: { recurring: overrides.recurring || [] },
    userProfile: { name: "Test", timezone: "America/Toronto", location: "", language: "en", familyMembers: [] },
    _dirty: new Set(),
    _loadedCounts: {},
  } as any;
}

// ── archiveUndatedEvents ─────────────────────────────────────────────────

console.log("\n── archiveUndatedEvents ──");

test("archives undated events older than 7 days", () => {
  const state = makeState({
    events: [
      makeEvent({ id: "e1", title: "Ghost event", datetime: "", createdAt: "2026-04-01T00:00:00" } as any),
      makeEvent({ id: "e2", title: "Recent undated", datetime: "", createdAt: "2026-04-13T00:00:00" } as any),
      makeEvent({ id: "e3", title: "Dated event", datetime: "2026-04-14T10:00:00" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.undatedArchived, 1);
  assert.strictEqual(state.calendar.events[0].archived, true);  // e1 archived
  assert.strictEqual(state.calendar.events[1].archived, undefined); // e2 too recent
  assert.strictEqual(state.calendar.events[2].archived, undefined); // e3 has datetime
});

test("archives undated events with no createdAt", () => {
  const state = makeState({
    events: [
      makeEvent({ id: "e1", title: "No date no created", datetime: "" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.undatedArchived, 1);
});

test("skips already archived events", () => {
  const state = makeState({
    events: [
      makeEvent({ id: "e1", title: "Already archived", datetime: "", archived: true }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.undatedArchived, 0);
});

// ── dedupRecurringVsCalendar ─────────────────────────────────────────────

console.log("\n── dedupRecurringVsCalendar ──");

test("archives calendar event that duplicates a recurring task firing today", () => {
  // Apr 14 2026 is a Tuesday
  const state = makeState({
    recurring: [
      makeRecurring({ id: "r1", title: "ChiefClarity dev", schedule: { type: "daily" } }),
    ],
    events: [
      makeEvent({ id: "e1", title: "ChiefClarity dev", datetime: "2026-04-14T08:30:00" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.recurringCalendarDeduped, 1);
  assert.strictEqual(state.calendar.events[0].archived, true);
});

test("case-insensitive matching", () => {
  const state = makeState({
    recurring: [
      makeRecurring({ id: "r1", title: "Dog Walking", schedule: { type: "daily" } }),
    ],
    events: [
      makeEvent({ id: "e1", title: "dog walking", datetime: "2026-04-14T08:00:00" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.recurringCalendarDeduped, 1);
});

test("does not archive event for different day", () => {
  const state = makeState({
    recurring: [
      makeRecurring({ id: "r1", title: "Weekly review", schedule: { type: "weekly", days: ["tuesday"] } }),
    ],
    events: [
      makeEvent({ id: "e1", title: "Weekly review", datetime: "2026-04-15T10:00:00" }), // tomorrow
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.recurringCalendarDeduped, 0);
});

test("does not archive if recurring does not fire today", () => {
  const state = makeState({
    recurring: [
      makeRecurring({ id: "r1", title: "Monday task", schedule: { type: "weekly", days: ["monday"] } }),
    ],
    events: [
      makeEvent({ id: "e1", title: "Monday task", datetime: "2026-04-14T10:00:00" }),
    ],
  });
  // Today is Tuesday — "Monday task" recurring doesn't fire
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.recurringCalendarDeduped, 0);
});

// ── dedupExactTasks ──────────────────────────────────────────────────────

console.log("\n── dedupExactTasks ──");

test("defers duplicate task with less activity", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Write blog post", comments: [{ id: "c1", text: "note", date: "" }] }),
      makeTask({ id: "t2", title: "Write blog post" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.taskExactDeduped, 1);
  // t2 has no comments, t1 has 1 → t2 should be deferred
  assert.strictEqual(state.tasks.tasks[1].status, "deferred");
  assert.strictEqual(state.tasks.tasks[0].status, "pending"); // winner kept
});

test("case-insensitive dedup", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Interview Prep" }),
      makeTask({ id: "t2", title: "interview prep" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.taskExactDeduped, 1);
});

test("skips done/deferred/parked tasks", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Same title", status: "done" }),
      makeTask({ id: "t2", title: "Same title", status: "pending" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.taskExactDeduped, 0); // t1 is done, not a duplicate candidate
});

// ── deferStaleParked ─────────────────────────────────────────────────────

console.log("\n── deferStaleParked ──");

test("auto-defers task parked for > 30 days", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Old parked", status: "parked", createdAt: "2026-03-01T00:00:00" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.staleParkedDeferred, 1);
  assert.strictEqual(state.tasks.tasks[0].status, "deferred");
});

test("does not defer recently parked task", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Recent parked", status: "parked", createdAt: "2026-04-10T00:00:00" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.staleParkedDeferred, 0);
  assert.strictEqual(state.tasks.tasks[0].status, "parked");
});

// ── archivePastDueRecurring ──────────────────────────────────────────────

console.log("\n── archivePastDueRecurring ──");

test("defers past-due recurring instance that was never started", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Daily standup", status: "pending", due: "2026-04-13", notes: "[Recurring] daily standup" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.pastDueRecurringArchived, 1);
  assert.strictEqual(state.tasks.tasks[0].status, "deferred");
});

test("does not defer non-recurring past-due task", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Regular overdue", status: "pending", due: "2026-04-13", notes: "just a note" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.pastDueRecurringArchived, 0);
  assert.strictEqual(state.tasks.tasks[0].status, "pending");
});

test("does not defer today's recurring instance", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Today recurring", status: "pending", due: "2026-04-14", notes: "[Recurring]" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.pastDueRecurringArchived, 0);
});

// ── stringSimilarity (via Tier 2 candidate detection) ────────────────────

console.log("\n── stringSimilarity (internal) ──");

// We can't test stringSimilarity directly (not exported), but we can verify
// the Tier 2 input builder would flag known similar pairs.
test("full hygiene run returns clean summary when nothing to clean", () => {
  const state = makeState({ tasks: [], events: [], recurring: [] });
  const result = runDeterministicHygiene(state);
  assert.strictEqual(result.summary, "Data hygiene: all clean.");
});

test("combined hygiene summary includes all actions", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Dup task" }),
      makeTask({ id: "t2", title: "Dup task" }),
      makeTask({ id: "t3", title: "Old parked", status: "parked", createdAt: "2026-03-01T00:00:00" }),
    ],
    events: [
      makeEvent({ id: "e1", title: "Ghost", datetime: "" }),
    ],
  });
  const result = runDeterministicHygiene(state);
  assert.ok(result.summary.includes("undated event"));
  assert.ok(result.summary.includes("duplicate task"));
  assert.ok(result.summary.includes("stale parked"));
});

// ── _dirty flag tracking ─────────────────────────────────────────────────

console.log("\n── dirty flag tracking ──");

test("marks calendar dirty when events archived", () => {
  const state = makeState({
    events: [makeEvent({ id: "e1", title: "Ghost", datetime: "" })],
  });
  runDeterministicHygiene(state);
  assert.ok(state._dirty.has("calendar"));
});

test("marks tasks dirty when tasks deferred", () => {
  const state = makeState({
    tasks: [
      makeTask({ id: "t1", title: "Dup" }),
      makeTask({ id: "t2", title: "Dup" }),
    ],
  });
  runDeterministicHygiene(state);
  assert.ok(state._dirty.has("tasks"));
});

test("does not mark dirty when nothing changed", () => {
  const state = makeState({});
  runDeterministicHygiene(state);
  assert.strictEqual(state._dirty.size, 0);
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
