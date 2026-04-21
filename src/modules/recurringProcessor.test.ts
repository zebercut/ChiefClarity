/**
 * Standalone test runner for recurringProcessor — recurring event scheduling.
 * Covers: buildRecurringByDate, shouldRunToday (via buildRecurringByDate).
 *
 * Run with: npx ts-node src/modules/recurringProcessor.test.ts
 */
import assert from "assert";
import type { RecurringTask } from "../types";
import { buildRecurringByDate } from "./recurringProcessor";

function makeRecurring(partial: Partial<RecurringTask>): RecurringTask {
  return {
    id: "rec_test",
    title: "Test",
    schedule: { type: "daily" },
    category: "other",
    priority: "medium",
    okrLink: null,
    duration: 60,
    active: true,
    createdAt: "2026-04-01T00:00:00Z",
    ...partial,
  };
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log("  \u2713", name);
    passed++;
  } catch (e: any) {
    console.error("  \u2717", name);
    console.error("   ", e.message);
    failed++;
  }
}

// 2026-04-20 is a Monday. 2026-04-19 is a Sunday.
const MONDAY = "2026-04-20";
const SUNDAY = "2026-04-19";

// ── buildRecurringByDate ─────────────────────────────────────────────────────

console.log("buildRecurringByDate — day variant");

test("daily task appears on today (Monday)", () => {
  const rec = [makeRecurring({ title: "Standup", schedule: { type: "daily", time: "09:00" } })];
  const result = buildRecurringByDate(rec, "day", MONDAY);
  assert.ok(result[MONDAY]);
  assert.strictEqual(result[MONDAY].length, 1);
  assert.strictEqual(result[MONDAY][0].title, "Standup");
  assert.strictEqual(result[MONDAY][0].time, "09:00");
});

test("weekday-only task does NOT appear on Sunday", () => {
  const rec = [makeRecurring({ title: "Standup", schedule: { type: "weekdays", time: "09:00" } })];
  const result = buildRecurringByDate(rec, "day", SUNDAY);
  assert.strictEqual(result[SUNDAY], undefined);
});

test("weekly task on Tuesday does NOT appear on Monday (day variant)", () => {
  const rec = [makeRecurring({
    title: "Weekly Class",
    schedule: { type: "weekly", days: ["tuesday", "thursday"], time: "16:00" },
    duration: 90,
  })];
  const result = buildRecurringByDate(rec, "day", MONDAY);
  assert.strictEqual(result[MONDAY], undefined);
});

console.log("\nbuildRecurringByDate — week variant");

test("weekly task on Tue/Thu appears on correct dates in a week plan", () => {
  const rec = [makeRecurring({
    title: "Weekly Class",
    schedule: { type: "weekly", days: ["tuesday", "thursday"], time: "16:00" },
    duration: 90,
  })];
  // Week starting Mon 2026-04-20: Mon20, Tue21, Wed22, Thu23, Fri24, Sat25, Sun26
  const result = buildRecurringByDate(rec, "week", MONDAY);
  assert.strictEqual(result["2026-04-21"]?.length, 1, "Should appear on Tuesday");
  assert.strictEqual(result["2026-04-21"][0].title, "Weekly Class");
  assert.strictEqual(result["2026-04-23"]?.length, 1, "Should appear on Thursday");
  assert.strictEqual(result["2026-04-23"][0].title, "Weekly Class");
  // Should NOT appear on other days
  assert.strictEqual(result[MONDAY], undefined, "Should not appear on Monday");
  assert.strictEqual(result["2026-04-22"], undefined, "Should not appear on Wednesday");
});

test("daily task appears on all 7 days of a week plan", () => {
  const rec = [makeRecurring({ title: "Journal", schedule: { type: "daily", time: "07:00" } })];
  const result = buildRecurringByDate(rec, "week", MONDAY);
  const dates = Object.keys(result);
  assert.strictEqual(dates.length, 7);
});

test("weekday-only task appears on Mon-Fri but not Sat-Sun", () => {
  const rec = [makeRecurring({ title: "Check email", schedule: { type: "weekdays", time: "08:00" } })];
  // Week from Mon 20: Mon20, Tue21, Wed22, Thu23, Fri24, Sat25, Sun26
  const result = buildRecurringByDate(rec, "week", MONDAY);
  assert.strictEqual(result["2026-04-25"], undefined, "Not on Saturday");
  assert.strictEqual(result["2026-04-26"], undefined, "Not on Sunday");
  assert.ok(result["2026-04-20"], "Monday");
  assert.ok(result["2026-04-21"], "Tuesday");
  assert.ok(result["2026-04-22"], "Wednesday");
  assert.ok(result["2026-04-23"], "Thursday");
  assert.ok(result["2026-04-24"], "Friday");
});

test("multiple recurring items on the same day are grouped", () => {
  const rec = [
    makeRecurring({ id: "r1", title: "Weekly Class", schedule: { type: "weekly", days: ["tuesday"], time: "16:00" }, duration: 90 }),
    makeRecurring({ id: "r2", title: "Waiting time — focus", schedule: { type: "weekly", days: ["tuesday"], time: "16:00" }, duration: 90, category: "work" }),
  ];
  // Tuesday = 2026-04-21
  const result = buildRecurringByDate(rec, "week", MONDAY);
  assert.strictEqual(result["2026-04-21"]?.length, 2);
});

test("inactive recurring tasks are excluded", () => {
  const rec = [makeRecurring({ title: "Old task", schedule: { type: "daily" }, active: false })];
  const result = buildRecurringByDate(rec, "day", MONDAY);
  assert.deepStrictEqual(result, {});
});

test("excluded dates are respected", () => {
  const rec = [makeRecurring({
    title: "Weekly Class",
    schedule: { type: "weekly", days: ["tuesday"], time: "16:00", excludeDates: ["2026-04-21"] },
  })];
  const result = buildRecurringByDate(rec, "week", MONDAY);
  assert.strictEqual(result["2026-04-21"], undefined, "Excluded date should not appear");
});

test("tomorrow variant returns next day only", () => {
  const rec = [makeRecurring({ title: "Standup", schedule: { type: "daily", time: "09:00" } })];
  const result = buildRecurringByDate(rec, "tomorrow", MONDAY);
  const dates = Object.keys(result);
  assert.strictEqual(dates.length, 1);
  assert.strictEqual(dates[0], "2026-04-21", "Should be Tuesday");
});

test("empty recurring array returns empty object", () => {
  const result = buildRecurringByDate([], "week", MONDAY);
  assert.deepStrictEqual(result, {});
});

test("preserves duration and category from recurring definition", () => {
  const rec = [makeRecurring({
    title: "Friday Activity",
    schedule: { type: "weekly", days: ["friday"], time: "15:00" },
    duration: 120,
    category: "family",
    priority: "high",
  })];
  // Friday = 2026-04-24
  const result = buildRecurringByDate(rec, "week", MONDAY);
  const item = result["2026-04-24"]?.[0];
  assert.ok(item);
  assert.strictEqual(item.duration, 120);
  assert.strictEqual(item.category, "family");
  assert.strictEqual(item.priority, "high");
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
