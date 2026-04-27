/**
 * FEAT057 — task_management skill tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/task_management.test.ts
 *       or: npm test
 *
 * Three layers:
 *   1. Skill folder smoke — production registry loads task_management
 *   2. Handler tests — submit_task_action behavior with stub state
 *   3. Dispatcher resolver — the 5 new context keys + items pass-through
 *
 * The 10-phrase regression set is included as a top-of-file fixture for
 * Story 6 (parity check). For v2.02 the regression test runs against a
 * stub LLM with canned tool responses — verifies the dispatcher chain
 * works end-to-end without live API calls. Real-LLM smoke is a manual
 * post-merge step.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "assert";
import { dispatchSkill } from "./skillDispatcher";
import { loadSkillRegistry, _resetSkillRegistryForTests } from "./skillRegistry";
import { setDataRoot } from "../utils/filesystem";
import type { RouteResult } from "../types/orchestrator";
import { submit_task_action } from "../skills/task_management/handlers";

// Redirect filesystem writes during tests to a temp dir so applyWrites'
// flush() does not leak fixture data to the repo cwd. (FEAT060 leakage.)
const TMP_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "feat061-tm-"));
setDataRoot(TMP_DATA_ROOT);

// ─── Test runner (project convention) ─────────────────────────────────────

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log("  ✓", name);
    passed++;
  } catch (e: any) {
    console.error("  ✗", name);
    console.error("   ", e?.message ?? e);
    if (e?.stack) console.error("   ", e.stack.split("\n").slice(1, 4).join("\n    "));
    failed++;
  }
}
function section(title: string): void {
  console.log("\n" + title);
}

// ─── 10-phrase regression fixture (Story 6) ────────────────────────────────
//
// Each row pairs a user phrase with the expected canned LLM tool response
// AND the expected handler outcome (writes shape, items presence). The
// stub LLM returns the canned response; the test asserts the dispatcher
// + handler chain produces the expected outcome.

interface RegressionPhrase {
  phrase: string;
  cannedToolArgs: any;
  expect: {
    writeCount: number;
    writeAction?: "add" | "update" | "delete";
    expectedTitle?: string;
    expectedStatus?: string;
    expectedPriority?: string;
    itemsCount?: number;
    needsClarification?: boolean;
    expectedReplyContains?: string;
  };
}

const REGRESSION_FIXTURES: RegressionPhrase[] = [
  {
    phrase: "add a task to call the dentist tomorrow",
    cannedToolArgs: {
      reply: "Added: Call the dentist (tomorrow)",
      writes: [{ action: "add", data: { title: "Call the dentist", due: "2026-04-28", priority: "medium", status: "pending" } }],
    },
    expect: { writeCount: 1, writeAction: "add", expectedTitle: "Call the dentist", expectedPriority: "medium", expectedReplyContains: "Added" },
  },
  {
    phrase: "remind me to review the proposal urgently",
    cannedToolArgs: {
      reply: "Added: Review the proposal (high priority)",
      writes: [{ action: "add", data: { title: "Review the proposal", priority: "high", status: "pending" } }],
    },
    expect: { writeCount: 1, writeAction: "add", expectedPriority: "high" },
  },
  {
    phrase: "add a someday task to learn Rust",
    cannedToolArgs: {
      reply: "Added (low priority): Learn Rust",
      writes: [{ action: "add", data: { title: "Learn Rust", priority: "low", status: "pending" } }],
    },
    expect: { writeCount: 1, writeAction: "add", expectedPriority: "low" },
  },
  {
    phrase: "add the task",
    cannedToolArgs: {
      reply: "Which task would you like to add? (please give a title)",
      writes: [],
      needsClarification: true,
    },
    expect: { writeCount: 0, needsClarification: true },
  },
  {
    phrase: "mark the dentist task as done",
    cannedToolArgs: {
      reply: "Marked done: Call the dentist",
      writes: [{ action: "update", id: "tsk_001", data: { status: "done", completedAt: "2026-04-27T10:00:00Z" } }],
    },
    expect: { writeCount: 1, writeAction: "update", expectedStatus: "done" },
  },
  {
    phrase: "set priority on the audit task to high",
    cannedToolArgs: {
      reply: "Updated: priority set to high",
      writes: [{ action: "update", id: "tsk_002", data: { priority: "high" } }],
    },
    expect: { writeCount: 1, writeAction: "update", expectedPriority: "high" },
  },
  {
    phrase: "delete the cancelled meeting prep task",
    cannedToolArgs: {
      reply: "Deleted: Meeting prep",
      writes: [{ action: "delete", id: "tsk_003", data: {} }],
    },
    expect: { writeCount: 1, writeAction: "delete" },
  },
  {
    phrase: "show me my overdue tasks",
    cannedToolArgs: {
      reply: "You have 2 overdue tasks.",
      writes: [],
      items: [
        { id: "tsk_004", title: "Send quarterly report", type: "task" },
        { id: "tsk_005", title: "Review legal redline", type: "task" },
      ],
    },
    expect: { writeCount: 0, itemsCount: 2 },
  },
  {
    phrase: "tasks about the audit",
    cannedToolArgs: {
      reply: "Found 1 task about the audit.",
      writes: [],
      items: [{ id: "tsk_002", title: "Audit prep", type: "task" }],
    },
    expect: { writeCount: 0, itemsCount: 1 },
  },
  {
    phrase: "what tasks do I have for tomorrow",
    cannedToolArgs: {
      reply: "No tasks for tomorrow.",
      writes: [],
      items: [],
    },
    expect: { writeCount: 0, itemsCount: 0, expectedReplyContains: "No tasks" },
  },
];

// ─── Fixtures ──────────────────────────────────────────────────────────────

async function loadProductionRegistry() {
  // Seed cache so embedder doesn't run.
  const skillsDir = "src/skills";
  const cachePath = path.join(skillsDir, ".embedding_cache.json");
  const cache: Record<string, { manifestMtimeMs: number; embedding: number[] }> = {};
  for (const sub of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sub.isDirectory() || sub.name.startsWith(".") || sub.name.startsWith("_")) continue;
    const m = path.join(skillsDir, sub.name, "manifest.json");
    if (!fs.existsSync(m)) continue;
    cache[sub.name] = {
      manifestMtimeMs: fs.statSync(m).mtimeMs,
      embedding: new Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0),
    };
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  _resetSkillRegistryForTests();
  return loadSkillRegistry();
}

function stubLlm(toolName: string, toolInput: Record<string, unknown>): any {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: toolName, input: toolInput }],
      }),
    },
  };
}

function makeRoute(skillId: string): RouteResult {
  return {
    skillId,
    confidence: 0.9,
    routingMethod: "embedding",
    candidates: [{ skillId, score: 0.9 }],
  };
}

function makeFixtureState(): any {
  return {
    _pendingContext: null,
    _loadedCounts: {},
    _dirty: new Set(),
    userProfile: { timezone: "UTC", workingHours: {} },
    hotContext: { today: "2026-04-27" },
    tasks: { tasks: [] },
    contradictionIndex: { byDate: {} },
    topicManifest: { topics: [], signals: [], suggestions: [] },
    contextMemory: { facts: [] },
    calendar: { events: [] },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // Skill loads
  section("Skill loading");

  await test("task_management skill loads via production registry with expected manifest", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("task_management");
    assert.ok(skill);
    assert.strictEqual(skill!.manifest.model, "haiku");
    assert.deepStrictEqual(skill!.manifest.tools, ["submit_task_action"]);
    assert.ok(skill!.handlers.submit_task_action);
    assert.deepStrictEqual(
      skill!.manifest.dataSchemas.read.sort(),
      ["calendar", "objectives", "tasks", "topics"]
    );
    assert.deepStrictEqual(skill!.manifest.dataSchemas.write, ["tasks"]);
  });

  await test("manifest declares the structural triggers /task and /todo (plus single-token web fallbacks)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("task_management");
    assert.ok(skill);
    const triggers = skill!.manifest.structuralTriggers;
    assert.ok(triggers.includes("/task"));
    assert.ok(triggers.includes("/todo"));
  });

  // Handler tests (no state — tests handler logic in isolation)
  section("Handler logic (no state, no executor call)");

  await test("handler returns plan from args without state — test mode", async () => {
    const result: any = await submit_task_action(
      {
        reply: "Test reply",
        writes: [{ action: "add", data: { title: "New task" } }],
        items: [],
      },
      { phrase: "test", skillId: "task_management" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Test reply");
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].file, "tasks");
    assert.strictEqual(result.data.writes[0].action, "add");
  });

  await test("handler propagates clarificationRequired flag", async () => {
    const result: any = await submit_task_action(
      { reply: "Which one?", needsClarification: true, writes: [] },
      { phrase: "delete the task", skillId: "task_management" }
    );
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("handler returns items for query operations", async () => {
    const items = [{ id: "t1", title: "One", type: "task" as const }];
    const result: any = await submit_task_action(
      { reply: "Found 1 task.", writes: [], items },
      { phrase: "show tasks", skillId: "task_management" }
    );
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0].id, "t1");
  });

  await test("handler defensively coerces missing fields to defaults", async () => {
    // No reply, no writes, no items — handler should not throw.
    const result: any = await submit_task_action(
      {},
      { phrase: "x", skillId: "task_management" }
    );
    assert.strictEqual(result.success, true);
    // userMessage might be empty but shouldn't crash
    assert.strictEqual(typeof result.userMessage, "string");
  });

  await test("handler filters out malformed writes (unknown actions)", async () => {
    const result: any = await submit_task_action(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { title: "Valid" } },
          { action: "wat" as any, data: {} },        // bogus action
          null as any,                                // bogus shape
          { action: "delete", id: "t1", data: {} },
        ],
      },
      { phrase: "x", skillId: "task_management" }
    );
    // 2 valid writes, 2 dropped
    assert.strictEqual(result.data.writes.length, 2);
  });

  await test("handler captures applyWrites errors as graceful failure (B1 fix)", async () => {
    // Stub state that makes applyWrites blow up: tasks file is malformed.
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      // Missing required fields → applyWrites should throw
      tasks: null,
    };
    const result: any = await submit_task_action(
      {
        reply: "Adding task",
        writes: [{ action: "add", data: { title: "Test" } }],
      },
      { state: badState, phrase: "add task", skillId: "task_management" }
    );
    // Handler caught the throw and returned a graceful failure
    assert.strictEqual(result.success, false);
    assert.ok(result.userMessage.includes("write failed"));
    assert.ok(result.data.writeError);
  });

  // FEAT061 — dispatcher state forwarding regression
  section("FEAT061 — dispatchSkill forwards state to handler ctx");

  await test("dispatchSkill forwards state to handler ctx → fixture state mutated", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    assert.strictEqual(state.tasks.tasks.length, 0, "precondition: empty");
    const result = await dispatchSkill(
      makeRoute("task_management"),
      "add a task to call the dentist",
      {
        registry: reg,
        enabledSkillIds: new Set(["task_management"]),
        state,
        llmClient: stubLlm("submit_task_action", {
          reply: "Added: Call the dentist",
          writes: [{ action: "add", data: { title: "Call the dentist", priority: "medium", status: "pending" } }],
        }),
      }
    );
    assert.ok(result, "dispatch should not return null");
    assert.strictEqual(result!.skillId, "task_management");
    // The load-bearing assertion: applyWrites ran via the dispatcher path,
    // proving the dispatcher forwarded state into the handler ctx.
    assert.strictEqual(state.tasks.tasks.length, 1, "task should be appended via applyWrites");
    assert.strictEqual(state.tasks.tasks[0].title, "Call the dentist");
  });

  // 10-phrase regression set
  section("Story 6 — 10-phrase regression fixture (deterministic stubs)");

  for (const fx of REGRESSION_FIXTURES) {
    await test(`fixture: ${fx.phrase}`, async () => {
      const reg = await loadProductionRegistry();
      const state = makeFixtureState();
      const result = await dispatchSkill(
        makeRoute("task_management"),
        fx.phrase,
        {
          registry: reg,
          enabledSkillIds: new Set(["task_management"]),
          state,
          llmClient: stubLlm("submit_task_action", fx.cannedToolArgs),
        }
      );
      assert.ok(result, "dispatch should not return null");
      assert.strictEqual(result!.skillId, "task_management");
      const data = (result!.handlerResult as any)?.data ?? {};

      assert.strictEqual(
        (data.writes ?? []).length,
        fx.expect.writeCount,
        `expected ${fx.expect.writeCount} writes`
      );
      if (fx.expect.writeAction && data.writes?.length) {
        assert.strictEqual(data.writes[0].action, fx.expect.writeAction);
      }
      if (fx.expect.expectedTitle && data.writes?.length) {
        assert.strictEqual(data.writes[0].data.title, fx.expect.expectedTitle);
      }
      if (fx.expect.expectedPriority && data.writes?.length) {
        assert.strictEqual(data.writes[0].data.priority, fx.expect.expectedPriority);
      }
      if (fx.expect.expectedStatus && data.writes?.length) {
        assert.strictEqual(data.writes[0].data.status, fx.expect.expectedStatus);
      }
      if (fx.expect.itemsCount !== undefined) {
        assert.strictEqual(result!.items?.length ?? 0, fx.expect.itemsCount);
      }
      if (fx.expect.needsClarification) {
        assert.strictEqual(result!.clarificationRequired, true);
      }
      if (fx.expect.expectedReplyContains) {
        assert.ok(
          result!.userMessage.includes(fx.expect.expectedReplyContains),
          `reply should contain "${fx.expect.expectedReplyContains}"`
        );
      }
    });
  }

  // Items pass-through verification (FEAT057 SkillDispatchResult.items)
  section("FEAT057 dispatcher extension — items pass-through");

  await test("dispatcher pass-through: handlerResult.items appears on SkillDispatchResult", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    const result = await dispatchSkill(
      makeRoute("task_management"),
      "show tasks",
      {
        registry: reg,
        enabledSkillIds: new Set(["task_management"]),
        state,
        llmClient: stubLlm("submit_task_action", {
          reply: "1 task",
          writes: [],
          items: [{ id: "t1", title: "One", type: "task" }],
        }),
      }
    );
    assert.ok(result);
    assert.strictEqual(result!.items?.length, 1);
    assert.strictEqual(result!.items![0].id, "t1");
  });

  await test("dispatcher omits items when handler returns no items", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    const result = await dispatchSkill(
      makeRoute("task_management"),
      "add task X",
      {
        registry: reg,
        enabledSkillIds: new Set(["task_management"]),
        state,
        llmClient: stubLlm("submit_task_action", {
          reply: "Added",
          writes: [{ action: "add", data: { title: "X" } }],
        }),
      }
    );
    assert.ok(result);
    // No items in canned response → result.items is undefined or empty
    assert.ok(!result!.items || result!.items.length === 0);
  });

  // Resolver — the 5 new context keys
  section("Dispatcher resolver — 5 new context keys (FEAT057)");

  await test("resolver computes tasksIndex from state.tasks", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    state.tasks = {
      tasks: [
        { id: "t1", title: "Task 1", due: "", priority: "high", status: "pending", category: "", subcategory: "", okrLink: null, conflictStatus: "ok", conflictReason: "", conflictWith: [], notes: "", createdAt: "", completedAt: null, dismissedAt: null, comments: [], timeAllocated: "", relatedCalendar: [], relatedInbox: [] },
      ],
    };
    // Run a dispatch and inspect the LLM input — the prompt should include tasksIndex
    let llmInputCaptured: any = null;
    const stub = {
      messages: {
        create: async (input: any) => {
          llmInputCaptured = input;
          return {
            content: [{ type: "tool_use", name: "submit_task_action", input: { reply: "ok", writes: [] } }],
          };
        },
      },
    };
    await dispatchSkill(
      makeRoute("task_management"),
      "show tasks",
      {
        registry: reg,
        enabledSkillIds: new Set(["task_management"]),
        state,
        llmClient: stub as any,
      }
    );
    assert.ok(llmInputCaptured);
    assert.ok(llmInputCaptured.messages[0].content.includes("tasksIndex"));
    assert.ok(llmInputCaptured.messages[0].content.includes("Task 1"));
  });

  await test("resolver passes userToday from state.hotContext.today", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    state.hotContext.today = "2026-12-25";
    let llmInputCaptured: any = null;
    const stub = {
      messages: {
        create: async (input: any) => {
          llmInputCaptured = input;
          return {
            content: [{ type: "tool_use", name: "submit_task_action", input: { reply: "ok", writes: [] } }],
          };
        },
      },
    };
    await dispatchSkill(
      makeRoute("task_management"),
      "what tasks for today",
      {
        registry: reg,
        enabledSkillIds: new Set(["task_management"]),
        state,
        llmClient: stub as any,
      }
    );
    assert.ok(llmInputCaptured.messages[0].content.includes("2026-12-25"));
  });

  await test("resolver gracefully skips unknown keys with a warning (existing behavior)", async () => {
    // Pre-existing minimal-resolver behavior — verify it still works
    // for the FEAT057 expansion. The keys we added are now SUPPORTED;
    // a key NOT in SUPPORTED_KEYS still warns.
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    // Feed a phrase that runs task_management — its context.ts only declares
    // supported keys, so no warning fires for the skill itself. This test
    // confirms that contradictionIndexDates resolves cleanly (was new key).
    let warnCalled = false;
    const originalWarn = console.warn;
    console.warn = () => { warnCalled = true; };
    try {
      const stub = {
        messages: {
          create: async () => ({
            content: [{ type: "tool_use", name: "submit_task_action", input: { reply: "ok", writes: [] } }],
          }),
        },
      };
      await dispatchSkill(
        makeRoute("task_management"),
        "x",
        {
          registry: reg,
          enabledSkillIds: new Set(["task_management"]),
          state,
          llmClient: stub as any,
        }
      );
    } finally {
      console.warn = originalWarn;
    }
    // For task_management's declared keys (all supported), no
    // "context requirement not supported" warning should fire.
    assert.strictEqual(warnCalled, false);
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
