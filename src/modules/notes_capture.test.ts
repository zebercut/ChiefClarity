/**
 * FEAT058 — notes_capture skill tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/notes_capture.test.ts
 *       or: npm test
 *
 * Covers:
 *   1. Skill loads via production registry (smoke)
 *   2. Handler logic with stub state (defensive Note defaults, B1 graceful failure)
 *   3. 5-phrase regression fixture (Story 1 + Story 5 template validation)
 *   4. Note shape completeness (every required Note field populated)
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "assert";
import { dispatchSkill } from "./skillDispatcher";
import { loadSkillRegistry, _resetSkillRegistryForTests } from "./skillRegistry";
import { applyWrites } from "./executor";
import { setDataRoot } from "../utils/filesystem";
import type { RouteResult } from "../types/orchestrator";
import { submit_note_capture } from "../skills/notes_capture/handlers";

// Redirect filesystem writes during tests to a temp dir so applyWrites'
// flush() does not leak fixture data to the repo cwd. (FEAT060 leakage.)
const TMP_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "feat061-nc-"));
setDataRoot(TMP_DATA_ROOT);

// ─── Test runner ────────────────────────────────────────────────────────────

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
    failed++;
  }
}
function section(title: string): void {
  console.log("\n" + title);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

async function loadProductionRegistry() {
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
  return { skillId, confidence: 0.9, routingMethod: "embedding", candidates: [{ skillId, score: 0.9 }] };
}

function makeFixtureState(): any {
  return {
    _pendingContext: null,
    _loadedCounts: {},
    _dirty: new Set(),
    userProfile: { timezone: "UTC", workingHours: {} },
    hotContext: { today: "2026-04-27" },
    notes: { _summary: "", notes: [] },
    topicManifest: { topics: [], signals: [], suggestions: [] },
    contextMemory: { facts: [] },
  };
}

// ─── 5-phrase regression fixture (Story 1 + Story 5) ────────────────────────

interface RegressionPhrase {
  phrase: string;
  cannedToolArgs: any;
  expect: {
    writeCount: number;
    expectedText?: string;
    needsClarification?: boolean;
  };
}

const REGRESSION_FIXTURES: RegressionPhrase[] = [
  {
    phrase: "save this idea: hire a security consultant for the API redesign",
    cannedToolArgs: {
      reply: "Saved: hire a security consultant for the API redesign",
      writes: [{ action: "add", data: { text: "hire a security consultant for the API redesign", status: "pending" } }],
    },
    expect: { writeCount: 1, expectedText: "hire a security consultant for the API redesign" },
  },
  {
    phrase: "add a note: remember to follow up with Contact A",
    cannedToolArgs: {
      reply: "Got it — saved.",
      writes: [{ action: "add", data: { text: "remember to follow up with Contact A", status: "pending" } }],
    },
    expect: { writeCount: 1, expectedText: "remember to follow up with Contact A" },
  },
  {
    phrase: "remember this: API redesign blocked on auth migration",
    cannedToolArgs: {
      reply: "Noted: API redesign blocked on auth migration",
      writes: [{ action: "add", data: { text: "API redesign blocked on auth migration", status: "pending" } }],
    },
    expect: { writeCount: 1, expectedText: "API redesign blocked on auth migration" },
  },
  {
    phrase: "jot down: weekly review process is broken",
    cannedToolArgs: {
      reply: "Jotted down.",
      writes: [{ action: "add", data: { text: "weekly review process is broken", status: "pending" } }],
    },
    expect: { writeCount: 1, expectedText: "weekly review process is broken" },
  },
  {
    phrase: "save this",
    cannedToolArgs: {
      reply: "What would you like me to save?",
      writes: [],
      needsClarification: true,
    },
    expect: { writeCount: 0, needsClarification: true },
  },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  section("Skill loading");

  await test("notes_capture loads via production registry with expected manifest", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("notes_capture");
    assert.ok(skill);
    assert.strictEqual(skill!.manifest.model, "haiku");
    assert.deepStrictEqual(skill!.manifest.tools, ["submit_note_capture"]);
    assert.ok(skill!.handlers.submit_note_capture);
    assert.deepStrictEqual(
      skill!.manifest.dataSchemas.read.sort(),
      ["notes", "objectives", "topics"]
    );
    assert.deepStrictEqual(skill!.manifest.dataSchemas.write, ["notes"]);
    assert.strictEqual(skill!.manifest.tokenBudget, 2000);
    assert.strictEqual(skill!.manifest.surface, null);
  });

  await test("triggerPhrases use noun-prefixes (Story 5 — embedding distance from general_assistant)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("notes_capture")!;
    // All triggers should mention "note", "idea", "remember", or similar
    // capture-noun. None should be conversational ("tell me about").
    for (const t of skill.manifest.triggerPhrases) {
      const lower = t.toLowerCase();
      const hasNoun = /note|idea|remember|capture|jot|save this|write this/.test(lower);
      assert.ok(hasNoun, `triggerPhrase "${t}" should be noun-prefixed`);
    }
  });

  section("Handler logic (no state, no executor call)");

  await test("handler returns plan from args — test mode", async () => {
    const result: any = await submit_note_capture(
      {
        reply: "Saved.",
        writes: [{ action: "add", data: { text: "Test note" } }],
      },
      { phrase: "save this", skillId: "notes_capture" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Saved.");
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].file, "notes");
    assert.strictEqual(result.data.writes[0].action, "add");
  });

  await test("handler fills Note defaults for all 8 required fields", async () => {
    const result: any = await submit_note_capture(
      {
        reply: "ok",
        writes: [{ action: "add", data: { text: "Just text" } }],
      },
      { phrase: "x", skillId: "notes_capture" }
    );
    const data = result.data.writes[0].data;
    // Required Note fields per src/types/index.ts:216-232
    // (id and createdAt are added by the executor's default branch — not here)
    assert.strictEqual(data.text, "Just text");
    assert.strictEqual(data.status, "pending");
    assert.strictEqual(data.processedAt, null);
    assert.strictEqual(data.writeCount, 0);
    assert.strictEqual(data.processedSummary, null);
    assert.strictEqual(data.attemptCount, 0);
    assert.strictEqual(data.lastError, null);
  });

  await test("handler filters writes with empty text", async () => {
    const result: any = await submit_note_capture(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { text: "real" } },
          { action: "add", data: { text: "" } },          // empty string filtered
          { action: "add", data: {} } as any,             // missing text filtered
          null as any,                                     // bogus shape filtered
        ],
      },
      { phrase: "x", skillId: "notes_capture" }
    );
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].data.text, "real");
  });

  await test("handler propagates clarificationRequired flag", async () => {
    const result: any = await submit_note_capture(
      { reply: "What would you like to save?", needsClarification: true, writes: [] },
      { phrase: "save this", skillId: "notes_capture" }
    );
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("handler defensively returns when args are empty", async () => {
    const result: any = await submit_note_capture(
      {},
      { phrase: "x", skillId: "notes_capture" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.userMessage, "string");
    assert.strictEqual(result.data.writes.length, 0);
  });

  await test("handler captures applyWrites errors gracefully (FEAT057 B1 pattern)", async () => {
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      notes: null, // malformed — applyWrites should throw
    };
    const result: any = await submit_note_capture(
      {
        reply: "Saving...",
        writes: [{ action: "add", data: { text: "Test" } }],
      },
      { state: badState, phrase: "save this", skillId: "notes_capture" }
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.userMessage.includes("write failed"));
    assert.ok(result.data.writeError);
  });

  // FEAT061 — dispatcher state forwarding regression
  section("FEAT061 — dispatchSkill forwards state to handler ctx");

  await test("dispatchSkill forwards state to handler ctx → applyWrites reached for notes", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    assert.strictEqual(state.notes.notes.length, 0, "precondition: notes empty");
    const result = await dispatchSkill(
      makeRoute("notes_capture"),
      "save this idea: review the architecture diagram",
      {
        registry: reg,
        enabledSkillIds: new Set(["notes_capture"]),
        state,
        llmClient: stubLlm("submit_note_capture", {
          reply: "Saved.",
          writes: [{ action: "add", data: { text: "review the architecture diagram", status: "pending" } }],
        }),
      }
    );
    assert.ok(result, "dispatch should not return null");
    assert.strictEqual(result!.skillId, "notes_capture");
    assert.strictEqual(state.notes.notes.length, 1, "note should be appended via applyWrites");
    assert.strictEqual(state.notes.notes[0].text, "review the architecture diagram");
    const handlerData = (result!.handlerResult as any)?.data;
    assert.strictEqual(handlerData?.writeError, null, "handler should not surface a writeError");
  });

  // FEAT062 — executor applyAdd array-loop covers notes
  section("Executor compatibility — applyAdd notes path (FEAT062)");

  await test("applyWrites add → notes appends to state.notes.notes", async () => {
    const state = makeFixtureState();
    state.calendar = { _summary: "", events: [] };
    state.tasks = { _summary: "", tasks: [] };
    state.recurringTasks = { recurring: [] };
    const plan: any = {
      reply: "",
      writes: [{
        file: "notes",
        action: "add",
        data: { text: "Test note A", status: "pending" },
      }],
      items: [],
      conflictsToCheck: [],
      suggestions: [],
      memorySignals: [],
      topicSignals: [],
      needsClarification: false,
    };
    await applyWrites(plan, state);
    assert.strictEqual(state.notes.notes.length, 1, "executor should append note to state.notes.notes");
    assert.strictEqual(state.notes.notes[0].text, "Test note A");
    assert.strictEqual(typeof state.notes.notes[0].id, "string", "executor should inject id");
    assert.ok(state.notes.notes[0].id.length > 0, "injected id should be non-empty");
    assert.strictEqual(typeof state.notes.notes[0].createdAt, "string", "executor should inject createdAt");
    assert.ok(state.notes.notes[0].createdAt.length > 0, "createdAt should be non-empty");
  });

  // 5-phrase regression set (Story 1 + Story 5)
  section("Story 1 + 5 — 5-phrase regression fixture (strict 5/5)");

  for (const fx of REGRESSION_FIXTURES) {
    await test(`fixture: ${fx.phrase.slice(0, 60)}`, async () => {
      const reg = await loadProductionRegistry();
      const state = makeFixtureState();
      const result = await dispatchSkill(
        makeRoute("notes_capture"),
        fx.phrase,
        {
          registry: reg,
          enabledSkillIds: new Set(["notes_capture"]),
          state,
          llmClient: stubLlm("submit_note_capture", fx.cannedToolArgs),
        }
      );
      assert.ok(result, "dispatch should not return null");
      assert.strictEqual(result!.skillId, "notes_capture");
      const data = (result!.handlerResult as any)?.data ?? {};
      assert.strictEqual((data.writes ?? []).length, fx.expect.writeCount);
      if (fx.expect.expectedText && data.writes?.length) {
        assert.strictEqual(data.writes[0].data.text, fx.expect.expectedText);
      }
      if (fx.expect.needsClarification) {
        assert.strictEqual(result!.clarificationRequired, true);
      }
    });
  }

  // Story 5 — template validation
  section("Story 5 — template validation (FEAT057 pattern)");

  await test("notes_capture handler signature matches task_management's pattern", () => {
    // Both handlers are async functions taking (args, ctx) and returning
    // a result with success, userMessage, data shape. This ensures the
    // FEAT057 template generalized cleanly.
    assert.strictEqual(typeof submit_note_capture, "function");
    // Async — calling it returns a Promise.
    const p = submit_note_capture({}, { phrase: "x", skillId: "notes_capture" });
    assert.ok(p && typeof p.then === "function");
  });

  await test("notes_capture context.ts uses only existing resolver keys (no new dispatcher work)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("notes_capture")!;
    const declared = Object.keys(skill.contextRequirements);
    const SUPPORTED = new Set([
      "userProfile", "objectives", "recentTasks",
      "calendarToday", "calendarNextSevenDays",
      "tasksIndex", "contradictionIndexDates", "topicList",
      "existingTopicHints", "userToday",
    ]);
    for (const k of declared) {
      assert.ok(SUPPORTED.has(k), `context key "${k}" must be in dispatcher's supported keys (no new resolver work)`);
    }
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
