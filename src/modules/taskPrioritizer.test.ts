/**
 * Standalone test runner for taskPrioritizer.
 * Run with: npx ts-node src/modules/taskPrioritizer.test.ts
 */
import assert from "assert";
import type { Task } from "../types";
import { computeTaskPriority } from "./taskPrioritizer";

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

console.log("taskPrioritizer");

test("filters out done tasks", () => {
  const tasks = [
    makeTask({ id: "A", status: "done" }),
    makeTask({ id: "B", status: "pending" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["B"]);
});

test("returns empty list for empty input", () => {
  assert.deepStrictEqual(computeTaskPriority([], TODAY), []);
});

test("returns empty list when all tasks are done", () => {
  const tasks = [
    makeTask({ id: "A", status: "done" }),
    makeTask({ id: "B", status: "done" }),
  ];
  assert.deepStrictEqual(computeTaskPriority(tasks, TODAY), []);
});

test("orders by priority enum (high → medium → low)", () => {
  const tasks = [
    makeTask({ id: "L", priority: "low" }),
    makeTask({ id: "H", priority: "high" }),
    makeTask({ id: "M", priority: "medium" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["H", "M", "L"]);
});

test("ties on priority broken by due date ascending", () => {
  const tasks = [
    makeTask({ id: "B", priority: "medium", due: "2026-05-01" }),
    makeTask({ id: "A", priority: "medium", due: "2026-04-15" }),
    makeTask({ id: "C", priority: "medium", due: "2026-06-01" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["A", "B", "C"]);
});

test("missing due date sorts last among same priority", () => {
  const tasks = [
    makeTask({ id: "NoDue", priority: "medium", due: "" }),
    makeTask({ id: "HasDue", priority: "medium", due: "2026-05-01" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["HasDue", "NoDue"]);
});

test("overdue task bubbles to top regardless of priority", () => {
  const tasks = [
    makeTask({ id: "HighFuture", priority: "high", due: "2026-05-01" }),
    makeTask({ id: "LowOverdue", priority: "low", due: "2026-04-01" }),
    makeTask({ id: "MedFuture", priority: "medium", due: "2026-04-20" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), [
    "LowOverdue",
    "HighFuture",
    "MedFuture",
  ]);
});

test("status=overdue counts as overdue even without past due date", () => {
  const tasks = [
    makeTask({ id: "Future", priority: "high", due: "2026-05-01", status: "pending" }),
    makeTask({ id: "Marked", priority: "low", due: "", status: "overdue" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["Marked", "Future"]);
});

test("multiple overdue tasks: ordered by priority then due date", () => {
  const tasks = [
    makeTask({ id: "OL", priority: "low", due: "2026-04-01" }),
    makeTask({ id: "OH1", priority: "high", due: "2026-04-03" }),
    makeTask({ id: "OH2", priority: "high", due: "2026-04-02" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  assert.deepStrictEqual(out.map((t) => t.id), ["OH2", "OH1", "OL"]);
});

test("includeDone=true keeps done tasks but sinks them to the bottom", () => {
  const tasks = [
    makeTask({ id: "Done1", status: "done", completedAt: "2026-04-05T10:00:00Z" }),
    makeTask({ id: "Pending", status: "pending", priority: "low" }),
    makeTask({ id: "Done2", status: "done", completedAt: "2026-04-06T10:00:00Z" }),
  ];
  const out = computeTaskPriority(tasks, TODAY, { includeDone: true });
  // Pending first (active work always above done), then done newest-first
  assert.deepStrictEqual(out.map((t) => t.id), ["Pending", "Done2", "Done1"]);
});

test("includeDone=true: overdue active tasks still bubble above non-overdue active", () => {
  const tasks = [
    makeTask({ id: "Done", status: "done", completedAt: "2026-04-06T10:00:00Z" }),
    makeTask({ id: "Future", priority: "high", due: "2026-05-01" }),
    makeTask({ id: "Overdue", priority: "low", due: "2026-04-01" }),
  ];
  const out = computeTaskPriority(tasks, TODAY, { includeDone: true });
  assert.deepStrictEqual(out.map((t) => t.id), ["Overdue", "Future", "Done"]);
});

test("sortBy=due ignores priority, sorts by due date asc", () => {
  const tasks = [
    makeTask({ id: "Late", priority: "high", due: "2026-06-01" }),
    makeTask({ id: "Early", priority: "low", due: "2026-04-15" }),
    makeTask({ id: "Mid", priority: "medium", due: "2026-05-01" }),
  ];
  const out = computeTaskPriority(tasks, TODAY, { sortBy: "due" });
  assert.deepStrictEqual(out.map((t) => t.id), ["Early", "Mid", "Late"]);
});

test("sortBy=priority ignores overdue bubble, ties broken by due", () => {
  const tasks = [
    makeTask({ id: "OverdueLow", priority: "low", due: "2026-04-01" }),
    makeTask({ id: "FutureHigh", priority: "high", due: "2026-05-01" }),
    makeTask({ id: "FutureMed", priority: "medium", due: "2026-04-20" }),
  ];
  const out = computeTaskPriority(tasks, TODAY, { sortBy: "priority" });
  assert.deepStrictEqual(out.map((t) => t.id), ["FutureHigh", "FutureMed", "OverdueLow"]);
});

test("sortBy=title alphabetical case-insensitive", () => {
  const tasks = [
    makeTask({ id: "C", title: "carrot" }),
    makeTask({ id: "A", title: "apple" }),
    makeTask({ id: "B", title: "Banana" }),
  ];
  const out = computeTaskPriority(tasks, TODAY, { sortBy: "title" });
  assert.deepStrictEqual(out.map((t) => t.id), ["A", "B", "C"]);
});

test("parity: no-overdue fixture matches legacy assembler ordering", () => {
  // Mirrors the legacy buildTaskIndex sort: priority enum → due date asc.
  // For this fixture there are no overdue tasks, so the new module's overdue
  // step is a no-op and the result must match the legacy ordering exactly.
  const tasks = [
    makeTask({ id: "L1", priority: "low", due: "2026-05-01" }),
    makeTask({ id: "H2", priority: "high", due: "2026-05-10" }),
    makeTask({ id: "M1", priority: "medium", due: "2026-04-20" }),
    makeTask({ id: "H1", priority: "high", due: "2026-05-02" }),
    makeTask({ id: "Done", priority: "high", due: "2026-04-10", status: "done" }),
  ];
  const out = computeTaskPriority(tasks, TODAY);
  // Expected legacy order: H1, H2, M1, L1 (Done filtered out)
  assert.deepStrictEqual(out.map((t) => t.id), ["H1", "H2", "M1", "L1"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
