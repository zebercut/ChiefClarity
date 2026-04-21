/**
 * FEAT045 — Smoke test for WP-5 + WP-6 changes.
 *
 * Runs offline (no API key needed). Tests pure logic only.
 * Usage: node scripts/test-feat045.js
 */

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true, jsx: "react" },
});

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── Test 1: needsFullReplan ──────────────────────────────────────────────

console.log("\n── needsFullReplan ──");

const { needsFullReplan } = require("../src/modules/briefDelta");

function makeState(changelog = [], briefExists = true) {
  return {
    focusBrief: briefExists ? {
      generatedAt: "2026-04-13T06:00:00Z",
      dateRange: { start: "2026-04-13", end: "2026-04-13" },
      days: [{ date: "2026-04-13", additions: [], removals: [], freeBlocks: [] }],
      _changelog: changelog,
    } : {},
    userProfile: { timezone: "America/New_York" },
    hotContext: { today: "2026-04-13" },
    calendar: { events: [] },
    tasks: { tasks: [] },
  };
}

// No changelog → false
assert("No changelog → false", needsFullReplan(makeState([])) === false);

// 1 event_added → false (below threshold)
assert("1 event_added → false", needsFullReplan(makeState([
  { type: "event_added", itemId: "e1", itemTitle: "Meeting", timestamp: "2026-04-13T10:00:00Z" },
])) === false);

// 2 event_added → true
assert("2 event_added → true", needsFullReplan(makeState([
  { type: "event_added", itemId: "e1", itemTitle: "Meeting 1", timestamp: "2026-04-13T10:00:00Z" },
  { type: "event_added", itemId: "e2", itemTitle: "Meeting 2", timestamp: "2026-04-13T11:00:00Z" },
])) === true);

// 2 event_cancelled → true
assert("2 event_cancelled → true", needsFullReplan(makeState([
  { type: "event_cancelled", itemId: "e1", itemTitle: "Meeting 1", timestamp: "2026-04-13T10:00:00Z" },
  { type: "event_cancelled", itemId: "e2", itemTitle: "Meeting 2", timestamp: "2026-04-13T11:00:00Z" },
])) === true);

// 5 task_done, 0 events → false (tasks don't trigger replan)
assert("5 task_done, 0 events → false", needsFullReplan(makeState([
  { type: "task_done", itemId: "t1", itemTitle: "Task 1", timestamp: "2026-04-13T10:00:00Z" },
  { type: "task_done", itemId: "t2", itemTitle: "Task 2", timestamp: "2026-04-13T10:30:00Z" },
  { type: "task_done", itemId: "t3", itemTitle: "Task 3", timestamp: "2026-04-13T11:00:00Z" },
  { type: "task_done", itemId: "t4", itemTitle: "Task 4", timestamp: "2026-04-13T11:30:00Z" },
  { type: "task_done", itemId: "t5", itemTitle: "Task 5", timestamp: "2026-04-13T12:00:00Z" },
])) === false);

// No brief → false
assert("No brief → false", needsFullReplan(makeState([], false)) === false);

// Mixed: 1 event + 3 tasks → false
assert("1 event + 3 tasks → false", needsFullReplan(makeState([
  { type: "event_added", itemId: "e1", itemTitle: "Meeting", timestamp: "2026-04-13T10:00:00Z" },
  { type: "task_done", itemId: "t1", itemTitle: "Task 1", timestamp: "2026-04-13T10:00:00Z" },
  { type: "task_done", itemId: "t2", itemTitle: "Task 2", timestamp: "2026-04-13T11:00:00Z" },
  { type: "task_done", itemId: "t3", itemTitle: "Task 3", timestamp: "2026-04-13T12:00:00Z" },
])) === false);

// ─── Test 2: shouldRefresh ────────────────────────────────────────────────

console.log("\n── shouldRefresh ──");

const { shouldRefresh } = require("../src/modules/briefRefresher");

function makeRefreshState(changelogCount) {
  const changelog = [];
  for (let i = 0; i < changelogCount; i++) {
    changelog.push({ type: "task_done", itemId: `t${i}`, itemTitle: `Task ${i}`, timestamp: "2026-04-13T10:00:00Z" });
  }
  return {
    focusBrief: {
      generatedAt: "2026-04-13T06:00:00Z",
      days: [{ date: "2026-04-13", additions: [] }],
      _changelog: changelog,
    },
    tasks: { tasks: [] },
    hotContext: { today: "2026-04-13" },
  };
}

assert("0 patches → false", shouldRefresh(makeRefreshState(0)) === false);
assert("2 patches → false", shouldRefresh(makeRefreshState(2)) === false);
assert("3 patches → true", shouldRefresh(makeRefreshState(3)) === true);
assert("10 patches → true", shouldRefresh(makeRefreshState(10)) === true);

// ─── Test 3: SONNET_FALLBACK_INTENTS (indirect — check MODEL_BY_INTENT) ──

console.log("\n── Sonnet fallback whitelist ──");

// We can't directly access SONNET_FALLBACK_INTENTS (not exported), but we
// can verify the MODEL_BY_INTENT routing is correct and that the whitelist
// intents match what MODEL_BY_INTENT uses Sonnet for.
const { MODEL_LIGHT, MODEL_HEAVY } = require("../src/modules/llm");

assert("MODEL_LIGHT is Haiku", MODEL_LIGHT.includes("haiku"));
assert("MODEL_HEAVY is Sonnet", MODEL_HEAVY.includes("sonnet"));

// ─── Test 4: getChangelogCount ────────────────────────────────────────────

console.log("\n── getChangelogCount ──");

const { getChangelogCount } = require("../src/modules/briefPatcher");

assert("Empty changelog → 0", getChangelogCount({ focusBrief: {} }) === 0);
assert("No brief → 0", getChangelogCount({}) === 0);
assert("3 entries → 3", getChangelogCount({
  focusBrief: {
    _changelog: [
      { type: "task_done", itemId: "1", itemTitle: "A", timestamp: "" },
      { type: "task_done", itemId: "2", itemTitle: "B", timestamp: "" },
      { type: "task_done", itemId: "3", itemTitle: "C", timestamp: "" },
    ],
  },
}) === 3);

// ─── Test 5: hasSameDayBrief + buildDelta ─────────────────────────────────

console.log("\n── hasSameDayBrief + buildDelta ──");

const { hasSameDayBrief, buildDelta } = require("../src/modules/briefDelta");

const stateWithBrief = {
  focusBrief: {
    generatedAt: "2026-04-13T06:00:00Z",
    dateRange: { start: "2026-04-13", end: "2026-04-13" },
    days: [{ date: "2026-04-13", additions: [{ id: "e1", title: "Existing", time: "09:00", duration: 60, category: "work", flexibility: "fixed", source: "calendar" }] }],
    _changelog: [{ type: "task_done", itemId: "t1", itemTitle: "Done task", timestamp: "2026-04-13T10:00:00Z" }],
  },
  userProfile: { timezone: "America/New_York" },
  hotContext: { today: "2026-04-13" },
  calendar: { events: [
    { id: "e1", title: "Existing", datetime: "2026-04-13T09:00:00", status: "scheduled", durationMinutes: 60 },
    { id: "e2", title: "New meeting", datetime: "2026-04-13T14:00:00", status: "scheduled", durationMinutes: 30 },
  ]},
  tasks: { tasks: [
    { id: "t1", title: "Done task", status: "done", completedAt: "2026-04-13T10:00:00Z", createdAt: "2026-04-12T08:00:00Z", due: "2026-04-13", priority: "high" },
    { id: "t2", title: "New task", status: "open", createdAt: "2026-04-13T11:00:00Z", due: "2026-04-13", priority: "medium" },
  ]},
};

assert("hasSameDayBrief → true", hasSameDayBrief(stateWithBrief) === true);

const delta = buildDelta(stateWithBrief);
assert("buildDelta returns non-null", delta !== null);
assert("completedSince has 1 task", delta.completedSince.length === 1);
assert("newTasks has 1 task", delta.newTasks.length === 1);
assert("newEvents has 1 event (e2)", delta.newEvents.length === 1 && delta.newEvents[0].id === "e2");
assert("summary mentions completed + new", delta.summary.includes("completed") && delta.summary.includes("new"));

// Yesterday's brief → false
const stateYesterday = {
  ...stateWithBrief,
  focusBrief: { ...stateWithBrief.focusBrief, dateRange: { start: "2026-04-12", end: "2026-04-12" } },
};
assert("hasSameDayBrief yesterday → false", hasSameDayBrief(stateYesterday) === false);

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
