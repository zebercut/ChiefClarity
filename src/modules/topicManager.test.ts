/**
 * Standalone test runner for topicManager — FEAT023.
 * Covers: slugifyTopic, buildTopicList, getExistingHints, recordSignal,
 *         updateSuggestions, buildTopicCrossRef, matchesTopicName (via buildTopicCrossRef).
 *
 * Run with: npx ts-node src/modules/topicManager.test.ts
 */
import assert from "assert";
import type { Task, CalendarEvent, TopicManifest, TopicSignal, Fact } from "../types";
import {
  slugifyTopic,
  buildTopicList,
  getExistingHints,
  recordSignal,
  updateSuggestions,
  buildTopicCrossRef,
} from "./topicManager";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeManifest(partial?: Partial<TopicManifest>): TopicManifest {
  return {
    topics: [],
    pendingSuggestions: [],
    rejectedTopics: [],
    signals: [],
    ...partial,
  };
}

function makeTopic(
  id: string,
  name: string,
  aliases: string[] = [],
  extras: { excludedIds?: string[]; archivedAt?: string | null } = {}
) {
  return {
    id,
    name,
    aliases,
    createdAt: "2026-04-01T00:00:00Z",
    excludedIds: extras.excludedIds,
    archivedAt: extras.archivedAt,
  };
}

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

function makeEvent(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "E?",
    title: "?",
    datetime: "2026-04-14T10:00:00",
    durationMinutes: 60,
    status: "scheduled",
    type: "",
    priority: "medium",
    notes: "",
    relatedInbox: [],
    ...partial,
  };
}

// ── Test runner ──────────────────────────────────────────────────────────────

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

// ── slugifyTopic ─────────────────────────────────────────────────────────────

console.log("\nslugifyTopic");

test("converts name to lowercase slug", () => {
  assert.strictEqual(slugifyTopic("Job Search"), "job-search");
});

test("removes special characters", () => {
  assert.strictEqual(slugifyTopic("Kids (activities)"), "kids-activities");
});

test("trims leading/trailing hyphens", () => {
  assert.strictEqual(slugifyTopic("--Health--"), "health");
});

test("handles single word", () => {
  assert.strictEqual(slugifyTopic("Finance"), "finance");
});

test("collapses multiple separators", () => {
  assert.strictEqual(slugifyTopic("job   search!!!"), "job-search");
});

// ── buildTopicList ───────────────────────────────────────────────────────────

console.log("\nbuildTopicList");

test("returns topic names", () => {
  const m = makeManifest({ topics: [makeTopic("job", "Job Search")] });
  assert.deepStrictEqual(buildTopicList(m), ["Job Search"]);
});

test("includes aliases in parentheses", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["career", "interview"])],
  });
  assert.deepStrictEqual(buildTopicList(m), ["Job Search (career, interview)"]);
});

test("returns empty array for no topics", () => {
  assert.deepStrictEqual(buildTopicList(makeManifest()), []);
});

// ── getExistingHints ─────────────────────────────────────────────────────────

console.log("\ngetExistingHints");

test("extracts hints from structured facts", () => {
  const m = makeManifest({
    signals: [{ topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" }],
  });
  const facts: (string | Fact)[] = [
    { text: "Dentist appointment", topic: "health", date: "2026-04-01" },
    "plain string fact",
  ];
  const hints = getExistingHints(m, facts);
  assert.ok(hints.includes("health"));
});

test("deduplicates hints from facts and signals", () => {
  const m = makeManifest({
    signals: [{ topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" }],
  });
  const facts: Fact[] = [{ text: "test", topic: "health", date: "2026-04-01" }];
  const hints = getExistingHints(m, facts);
  assert.strictEqual(hints.filter((h) => h === "health").length, 1);
});

test("returns empty for empty manifest and facts", () => {
  assert.deepStrictEqual(getExistingHints(makeManifest(), []), []);
});

// ── recordSignal ─────────────────────────────────────────────────────────────

console.log("\nrecordSignal");

test("adds new signal and returns true", () => {
  const m = makeManifest();
  const result = recordSignal(m, "health", "task", "t1", "2026-04-01");
  assert.strictEqual(result, true);
  assert.strictEqual(m.signals.length, 1);
  assert.strictEqual(m.signals[0].topic, "health");
});

test("rejects duplicate signal (same sourceType + sourceId)", () => {
  const m = makeManifest({
    signals: [{ topic: "health", sourceType: "task", sourceId: "t1", date: "2026-04-01" }],
  });
  const result = recordSignal(m, "health", "task", "t1", "2026-04-02");
  assert.strictEqual(result, false);
  assert.strictEqual(m.signals.length, 1);
});

test("allows same topic with different sourceId", () => {
  const m = makeManifest({
    signals: [{ topic: "health", sourceType: "task", sourceId: "t1", date: "2026-04-01" }],
  });
  const result = recordSignal(m, "health", "task", "t2", "2026-04-02");
  assert.strictEqual(result, true);
  assert.strictEqual(m.signals.length, 2);
});

test("evicts oldest signals when exceeding MAX_SIGNALS (1000)", () => {
  const signals: TopicSignal[] = [];
  for (let i = 0; i < 1000; i++) {
    signals.push({ topic: "t", sourceType: "mention", sourceId: `s${i}`, date: "2026-01-01" });
  }
  const m = makeManifest({ signals });
  recordSignal(m, "t", "mention", "new_signal", "2026-04-01");
  assert.strictEqual(m.signals.length, 1000);
  // Oldest evicted, newest kept
  assert.strictEqual(m.signals[m.signals.length - 1].sourceId, "new_signal");
  assert.strictEqual(m.signals[0].sourceId, "s1"); // s0 evicted
});

// ── updateSuggestions ────────────────────────────────────────────────────────

console.log("\nupdateSuggestions");

test("creates accumulating suggestion when count < 3", () => {
  const m = makeManifest({
    signals: [
      { topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" },
      { topic: "health", sourceType: "fact", sourceId: "f2", date: "2026-04-02" },
    ],
  });
  const changed = updateSuggestions(m);
  assert.strictEqual(changed, true);
  assert.strictEqual(m.pendingSuggestions.length, 1);
  assert.strictEqual(m.pendingSuggestions[0].status, "accumulating");
  assert.strictEqual(m.pendingSuggestions[0].count, 2);
});

test("promotes to pending when count reaches threshold (3)", () => {
  const m = makeManifest({
    signals: [
      { topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" },
      { topic: "health", sourceType: "fact", sourceId: "f2", date: "2026-04-02" },
      { topic: "health", sourceType: "fact", sourceId: "f3", date: "2026-04-03" },
    ],
  });
  updateSuggestions(m);
  assert.strictEqual(m.pendingSuggestions[0].status, "pending");
});

test("skips topics that are already registered", () => {
  const m = makeManifest({
    topics: [makeTopic("health", "Health")],
    signals: [
      { topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" },
      { topic: "health", sourceType: "fact", sourceId: "f2", date: "2026-04-02" },
      { topic: "health", sourceType: "fact", sourceId: "f3", date: "2026-04-03" },
    ],
  });
  updateSuggestions(m);
  assert.strictEqual(m.pendingSuggestions.length, 0);
});

test("skips rejected topics", () => {
  const m = makeManifest({
    rejectedTopics: ["health"],
    signals: [
      { topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" },
      { topic: "health", sourceType: "fact", sourceId: "f2", date: "2026-04-02" },
      { topic: "health", sourceType: "fact", sourceId: "f3", date: "2026-04-03" },
    ],
  });
  updateSuggestions(m);
  assert.strictEqual(m.pendingSuggestions.length, 0);
});

test("re-promotes deferred suggestion when count exceeds raised threshold", () => {
  const m = makeManifest({
    pendingSuggestions: [{ topic: "health", count: 3, threshold: 6, status: "deferred" }],
    signals: Array.from({ length: 6 }, (_, i) => ({
      topic: "health",
      sourceType: "fact" as const,
      sourceId: `f${i}`,
      date: "2026-04-01",
    })),
  });
  const changed = updateSuggestions(m);
  assert.strictEqual(changed, true);
  assert.strictEqual(m.pendingSuggestions[0].status, "pending");
  assert.strictEqual(m.pendingSuggestions[0].count, 6);
});

test("returns false when no changes needed", () => {
  const m = makeManifest({
    pendingSuggestions: [{ topic: "health", count: 2, threshold: 3, status: "accumulating" }],
    signals: [
      { topic: "health", sourceType: "fact", sourceId: "f1", date: "2026-04-01" },
      { topic: "health", sourceType: "fact", sourceId: "f2", date: "2026-04-02" },
    ],
  });
  const changed = updateSuggestions(m);
  assert.strictEqual(changed, false);
});

// ── buildTopicCrossRef ───────────────────────────────────────────────────────

console.log("\nbuildTopicCrossRef");

test("returns empty array when no topics registered", () => {
  const result = buildTopicCrossRef(makeManifest(), [makeTask({ id: "T1" })], []);
  assert.deepStrictEqual(result, []);
});

test("matches task to topic via signal", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search")],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [makeTask({ id: "T1", title: "Update resume" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "job");
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

test("matches task to topic via name matching", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["interview", "career"])],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview at ExampleCorp" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "job");
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

test("name matching uses word boundaries (no partial match)", () => {
  const m = makeManifest({
    topics: [makeTopic("art", "Art")],
  });
  const tasks = [makeTask({ id: "T1", title: "Read article about painting" })];
  const result = buildTopicCrossRef(m, tasks, []);
  // "art" should NOT match "article"
  assert.strictEqual(result.length, 0);
});

test("name matching works with topic alias", () => {
  const m = makeManifest({
    topics: [makeTopic("kids", "Kids", ["children", "school"])],
  });
  const tasks = [makeTask({ id: "T1", title: "Pick up children from school" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "kids");
});

test("matches event to topic via signal", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search")],
    signals: [{ topic: "job", sourceType: "event", sourceId: "E1", date: "2026-04-01" }],
  });
  const events = [makeEvent({ id: "E1", title: "Networking meetup" })];
  const result = buildTopicCrossRef(m, [], events);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].eventIds, ["E1"]);
});

test("matches event to topic via name matching", () => {
  const m = makeManifest({
    topics: [makeTopic("health", "Health", ["doctor", "dentist"])],
  });
  const events = [makeEvent({ id: "E1", title: "Dentist appointment" })];
  const result = buildTopicCrossRef(m, [], events);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].eventIds, ["E1"]);
});

test("includes okrLinks from matched tasks", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search")],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [makeTask({ id: "T1", title: "Update resume", okrLink: "kr_applications" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.deepStrictEqual(result[0].okrLinks, ["kr_applications"]);
});

test("item matching two topics appears in both", () => {
  const m = makeManifest({
    topics: [
      makeTopic("job", "Job Search", ["interview"]),
      makeTopic("prep", "Preparation", ["prepare"]),
    ],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 2);
  const jobRef = result.find((r) => r.topic === "job");
  const prepRef = result.find((r) => r.topic === "prep");
  assert.ok(jobRef);
  assert.ok(prepRef);
  assert.deepStrictEqual(jobRef!.taskIds, ["T1"]);
  assert.deepStrictEqual(prepRef!.taskIds, ["T1"]);
});

test("excludes topics with no matched items", () => {
  const m = makeManifest({
    topics: [
      makeTopic("job", "Job Search"),
      makeTopic("health", "Health"),
    ],
  });
  const tasks = [makeTask({ id: "T1", title: "Job Search follow-up" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "job");
});

test("deduplicates task IDs when matched by both signal and name", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search")],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  // Task title also contains "Job Search" — should not produce duplicate
  const tasks = [makeTask({ id: "T1", title: "Job Search: update resume" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result[0].taskIds.length, 1);
});

test("handles special regex characters in topic name", () => {
  const m = makeManifest({
    topics: [makeTopic("cpp", "C++", ["c-plus-plus"])],
  });
  // "C++" has regex special chars — should not throw
  const tasks = [makeTask({ id: "T1", title: "Study C++ templates" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

test("handles empty tasks and events arrays", () => {
  const m = makeManifest({ topics: [makeTopic("job", "Job Search")] });
  const result = buildTopicCrossRef(m, [], []);
  assert.strictEqual(result.length, 0);
});

test("combines signals and name matches across tasks and events", () => {
  const m = makeManifest({
    topics: [makeTopic("kids", "Kids", ["soccer"])],
    signals: [{ topic: "kids", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [
    makeTask({ id: "T1", title: "Buy school supplies" }),
    makeTask({ id: "T2", title: "Register for soccer camp" }),
  ];
  const events = [makeEvent({ id: "E1", title: "Kids soccer practice" })];
  const result = buildTopicCrossRef(m, tasks, events);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskIds.length, 2);
  assert.ok(result[0].taskIds.includes("T1")); // via signal
  assert.ok(result[0].taskIds.includes("T2")); // via name match on "soccer"
  assert.deepStrictEqual(result[0].eventIds, ["E1"]); // via name match on "Kids"
});

// ── buildTopicCrossRef: exclusions ───────────────────────────────────────────

console.log("\nbuildTopicCrossRef — exclusions");

test("excluded task ID is skipped despite signal match", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", [], { excludedIds: ["T1"] })],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [makeTask({ id: "T1", title: "Update resume" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 0);
});

test("excluded task ID is skipped despite name match", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["interview"], { excludedIds: ["T1"] })],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 0);
});

test("excluded event ID is skipped", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["interview"], { excludedIds: ["E1"] })],
  });
  const events = [makeEvent({ id: "E1", title: "Interview at Example Corp" })];
  const result = buildTopicCrossRef(m, [], events);
  assert.strictEqual(result.length, 0);
});

test("exclusion on one topic does not affect other topics", () => {
  const m = makeManifest({
    topics: [
      makeTopic("job", "Job Search", ["interview"], { excludedIds: ["T1"] }),
      makeTopic("prep", "Preparation", ["prepare"]),
    ],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview" })];
  const result = buildTopicCrossRef(m, tasks, []);
  // Excluded from job, still matches prep
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "prep");
});

test("empty excludedIds array treated as no exclusions", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", [], { excludedIds: [] })],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [makeTask({ id: "T1", title: "Update resume" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
});

// ── buildTopicCrossRef: archival ─────────────────────────────────────────────

console.log("\nbuildTopicCrossRef — archival");

test("archived topic is excluded from cross-ref entirely", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", [], { archivedAt: "2026-04-10T00:00:00Z" })],
    signals: [{ topic: "job", sourceType: "task", sourceId: "T1", date: "2026-04-01" }],
  });
  const tasks = [makeTask({ id: "T1", title: "Job Search follow-up" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 0);
});

test("archived topic not matched by name either", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["interview"], { archivedAt: "2026-04-10T00:00:00Z" })],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 0);
});

test("active topics work alongside archived ones", () => {
  const m = makeManifest({
    topics: [
      makeTopic("job", "Job Search", [], { archivedAt: "2026-04-10T00:00:00Z" }),
      makeTopic("kids", "Kids", ["soccer"]),
    ],
  });
  const tasks = [
    makeTask({ id: "T1", title: "Job Search follow-up" }),
    makeTask({ id: "T2", title: "Soccer practice pickup" }),
  ];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "kids");
});

test("unarchive (archivedAt=null) restores topic to cross-ref", () => {
  const m = makeManifest({
    topics: [makeTopic("job", "Job Search", ["interview"], { archivedAt: null })],
  });
  const tasks = [makeTask({ id: "T1", title: "Prepare for interview" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
});

// ── End-to-end: manual topic creation ────────────────────────────────────────
// These tests exercise the in-memory state transitions the executor performs
// for create_topic / unassign / reassign actions, without going through the DB.

console.log("\nmanual topic creation");

test("manually created topic auto-matches new tasks by name", () => {
  // User creates an empty "Finance" topic (no signals, no aliases).
  const m = makeManifest({ topics: [makeTopic("finance", "Finance")] });
  // A new task arrives with "finance" in the title.
  const tasks = [makeTask({ id: "T1", title: "Review finance report" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "finance");
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

test("manually created topic with aliases matches broader terms", () => {
  const m = makeManifest({ topics: [makeTopic("finance", "Finance", ["budget", "taxes"])] });
  const tasks = [
    makeTask({ id: "T1", title: "Submit quarterly taxes" }),
    makeTask({ id: "T2", title: "Plan 2026 budget" }),
  ];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskIds.length, 2);
});

test("manually created topic accepts new signals after creation", () => {
  // Simulate: user creates topic, then LLM emits a signal toward it on next turn.
  const m = makeManifest({ topics: [makeTopic("finance", "Finance")] });
  // Simulate what the executor does: recordSignal when plan.topicSignals arrives.
  const added = recordSignal(m, "finance", "task", "T1", "2026-04-15");
  assert.strictEqual(added, true);
  assert.strictEqual(m.signals.length, 1);
  // Cross-ref picks it up via the signal even with a title that wouldn't name-match.
  const tasks = [makeTask({ id: "T1", title: "Untitled random work" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

// ── End-to-end: reassign flow ────────────────────────────────────────────────

console.log("\nreassign flow");

test("reassign moves task from source to destination (exclusion + signal)", () => {
  // Simulate the executor's reassign_topic action on a manifest.
  const m = makeManifest({
    topics: [
      makeTopic("old", "Old Topic", ["meeting"]),
      makeTopic("new", "New Topic"),
    ],
  });
  // Before: task name-matches "old" via the alias "meeting".
  const tasks = [makeTask({ id: "T1", title: "Team meeting agenda" })];
  let result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "old");

  // Perform the reassignment (mirror executor logic):
  const oldTopic = m.topics.find(x => x.id === "old")!;
  if (!oldTopic.excludedIds) oldTopic.excludedIds = [];
  oldTopic.excludedIds.push("T1");
  recordSignal(m, "new", "task", "T1", "2026-04-15");

  // After: task should only appear under "new".
  result = buildTopicCrossRef(m, tasks, []);
  const byTopic = Object.fromEntries(result.map(r => [r.topic, r.taskIds]));
  assert.deepStrictEqual(byTopic.new, ["T1"]);
  assert.strictEqual(byTopic.old, undefined);
});

test("unassign removes item from topic even if name still matches", () => {
  const m = makeManifest({ topics: [makeTopic("health", "Health", ["doctor"])] });
  const tasks = [makeTask({ id: "T1", title: "Doctor appointment" })];
  // Mirror executor unassign_from_topic:
  const topic = m.topics.find(x => x.id === "health")!;
  if (!topic.excludedIds) topic.excludedIds = [];
  topic.excludedIds.push("T1");
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 0);
});

test("create-and-reassign in one batch: topic appears with item under it", () => {
  // Start with one topic and a task signaled to it.
  const m = makeManifest({
    topics: [makeTopic("old", "Old Topic")],
    signals: [{ topic: "old", sourceType: "task", sourceId: "T1", date: "2026-04-14" }],
  });
  // User creates a new topic AND reassigns the task into it atomically.
  m.topics.push(makeTopic("brand-new", "Brand New"));
  const oldTopic = m.topics.find(x => x.id === "old")!;
  if (!oldTopic.excludedIds) oldTopic.excludedIds = [];
  oldTopic.excludedIds.push("T1");
  m.signals = m.signals.filter(s => !(s.topic === "old" && s.sourceId === "T1"));
  recordSignal(m, "brand-new", "task", "T1", "2026-04-15");

  const tasks = [makeTask({ id: "T1", title: "Some work" })];
  const result = buildTopicCrossRef(m, tasks, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].topic, "brand-new");
  assert.deepStrictEqual(result[0].taskIds, ["T1"]);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
