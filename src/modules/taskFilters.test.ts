/**
 * Standalone test runner for taskFilters.
 * Run with: npx ts-node src/modules/taskFilters.test.ts
 */
import assert from "assert";
import type { Task } from "../types";
import {
  filterTasks,
  searchTasks,
  groupTasks,
  dueBucketOf,
} from "./taskFilters";

const TODAY = "2026-04-06";

function makeTask(partial: Partial<Task>): Task {
  return {
    id: "T?",
    title: "?",
    due: "",
    priority: "medium",
    status: "pending",
    category: "",
    subcategory: "",
    okrLink: null,
    conflictStatus: "ok",
    conflictReason: "",
    conflictWith: [],
    notes: "",
    createdAt: "",
    completedAt: null,
    dismissedAt: null,
    comments: [],
    timeAllocated: "",
    relatedCalendar: [],
    relatedInbox: [],
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

console.log("dueBucketOf");

test("no due → No Due Date", () => {
  assert.strictEqual(dueBucketOf(makeTask({ due: "" }), TODAY), "No Due Date");
});

test("today → Today", () => {
  assert.strictEqual(dueBucketOf(makeTask({ due: TODAY }), TODAY), "Today");
});

test("tomorrow → Tomorrow", () => {
  assert.strictEqual(
    dueBucketOf(makeTask({ due: "2026-04-07" }), TODAY),
    "Tomorrow"
  );
});

test("within 7 days → This Week", () => {
  assert.strictEqual(
    dueBucketOf(makeTask({ due: "2026-04-10" }), TODAY),
    "This Week"
  );
});

test("beyond 7 days → Later", () => {
  assert.strictEqual(
    dueBucketOf(makeTask({ due: "2026-05-01" }), TODAY),
    "Later"
  );
});

test("overdue → Today (urgent surfacing)", () => {
  assert.strictEqual(
    dueBucketOf(makeTask({ due: "2026-04-01" }), TODAY),
    "Today"
  );
});

console.log("\nsearchTasks");

test("query < 2 chars returns input unchanged", () => {
  const tasks = [makeTask({ id: "A", title: "alpha" })];
  assert.strictEqual(searchTasks(tasks, "a"), tasks);
  assert.strictEqual(searchTasks(tasks, " "), tasks);
});

test("matches title (case-insensitive substring)", () => {
  const tasks = [
    makeTask({ id: "A", title: "Buy groceries" }),
    makeTask({ id: "B", title: "Call dentist" }),
  ];
  assert.deepStrictEqual(
    searchTasks(tasks, "GROC").map((t) => t.id),
    ["A"]
  );
});

test("does NOT match notes (title-only)", () => {
  const tasks = [
    makeTask({ id: "A", title: "Pay tax", notes: "remember the budget report" }),
    makeTask({ id: "B", title: "Budget review" }),
  ];
  assert.deepStrictEqual(
    searchTasks(tasks, "budget").map((t) => t.id),
    ["B"]
  );
});

test("does NOT match category or subcategory (title-only)", () => {
  const tasks = [
    makeTask({ id: "A", title: "Quarterly review", category: "Work", subcategory: "Reports" }),
    makeTask({ id: "B", title: "Report draft" }),
  ];
  assert.deepStrictEqual(
    searchTasks(tasks, "report").map((t) => t.id),
    ["B"]
  );
});

test("substring not just prefix", () => {
  const tasks = [makeTask({ id: "A", title: "submit timesheet" })];
  assert.strictEqual(searchTasks(tasks, "sheet").length, 1);
});

console.log("\nfilterTasks");

test("excludes done by default", () => {
  const tasks = [
    makeTask({ id: "A", status: "done" }),
    makeTask({ id: "B", status: "pending" }),
  ];
  assert.deepStrictEqual(
    filterTasks(tasks, {}, TODAY).map((t) => t.id),
    ["B"]
  );
});

test("includeDone=true keeps done tasks", () => {
  const tasks = [
    makeTask({ id: "A", status: "done" }),
    makeTask({ id: "B", status: "pending" }),
  ];
  assert.deepStrictEqual(
    filterTasks(tasks, { includeDone: true }, TODAY)
      .map((t) => t.id)
      .sort(),
    ["A", "B"]
  );
});

test("AND logic across status + priority + category", () => {
  const tasks = [
    makeTask({ id: "A", status: "pending", priority: "high", category: "Work" }),
    makeTask({ id: "B", status: "pending", priority: "low", category: "Work" }),
    makeTask({ id: "C", status: "pending", priority: "high", category: "Home" }),
    makeTask({ id: "D", status: "in_progress", priority: "high", category: "Work" }),
  ];
  const out = filterTasks(
    tasks,
    { status: "pending", priority: "high", category: "Work" },
    TODAY
  );
  assert.deepStrictEqual(out.map((t) => t.id), ["A"]);
});

test("dueBucket filter narrows correctly", () => {
  const tasks = [
    makeTask({ id: "A", due: TODAY }),
    makeTask({ id: "B", due: "2026-04-07" }),
    makeTask({ id: "C", due: "2026-05-15" }),
  ];
  const out = filterTasks(tasks, { dueBucket: "Later" }, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["C"]);
});

test("empty filter returns all non-done tasks", () => {
  const tasks = [
    makeTask({ id: "A" }),
    makeTask({ id: "B" }),
    makeTask({ id: "C", status: "done" }),
  ];
  assert.deepStrictEqual(
    filterTasks(tasks, {}, TODAY).map((t) => t.id).sort(),
    ["A", "B"]
  );
});

console.log("\ngroupTasks");

test("none returns single section", () => {
  const tasks = [makeTask({ id: "A" }), makeTask({ id: "B" })];
  const out = groupTasks(tasks, "none", TODAY);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, "");
  assert.strictEqual(out[0].data.length, 2);
});

test("none with empty input returns empty", () => {
  assert.deepStrictEqual(groupTasks([], "none", TODAY), []);
});

test("group by status with canonical order", () => {
  const tasks = [
    makeTask({ id: "P", status: "pending" }),
    makeTask({ id: "O", status: "overdue" }),
    makeTask({ id: "I", status: "in_progress" }),
  ];
  const out = groupTasks(tasks, "status", TODAY);
  assert.deepStrictEqual(
    out.map((s) => s.title),
    ["Overdue", "In Progress", "Pending"]
  );
});

test("group by dueBucket with canonical order", () => {
  const tasks = [
    makeTask({ id: "L", due: "2026-05-01" }),
    makeTask({ id: "T", due: TODAY }),
    makeTask({ id: "N", due: "" }),
    makeTask({ id: "W", due: "2026-04-10" }),
  ];
  const out = groupTasks(tasks, "dueBucket", TODAY);
  assert.deepStrictEqual(
    out.map((s) => s.title),
    ["Today", "This Week", "Later", "No Due Date"]
  );
});

test("group by category alphabetical", () => {
  const tasks = [
    makeTask({ id: "A", category: "Work" }),
    makeTask({ id: "B", category: "Family" }),
    makeTask({ id: "C", category: "Work" }),
  ];
  const out = groupTasks(tasks, "category", TODAY);
  assert.deepStrictEqual(
    out.map((s) => s.title),
    ["Family", "Work"]
  );
  assert.strictEqual(out[1].data.length, 2);
});

test("group by category falls back to Uncategorized", () => {
  const tasks = [makeTask({ id: "A", category: "" })];
  const out = groupTasks(tasks, "category", TODAY);
  assert.strictEqual(out[0].title, "Uncategorized");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
