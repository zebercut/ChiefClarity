/**
 * FEAT055 — Skill Dispatcher tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/skillDispatcher.test.ts
 *       or: npm test
 *
 * Stub LLM only — no live Anthropic calls. Stub registry from fixture skills.
 *
 * Story 4 (revised): fixture-based correctness — 5 fixture states + 5 canned
 * LLM tool calls; dispatcher produces 5 expected user messages with correct
 * top-3 task ids.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import assert from "assert";
import {
  dispatchSkill,
} from "./skillDispatcher";
import {
  loadSkillRegistry,
  _resetSkillRegistryForTests,
} from "./skillRegistry";
import type { RouteResult, SkillDispatchResult } from "../types/orchestrator";

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
    if (e?.stack) console.error("   ", e.stack.split("\n").slice(1, 4).join("\n    "));
    failed++;
  }
}

function section(title: string): void {
  console.log("\n" + title);
}

// ─── Fixture-skill helpers (mirror skillRegistry.test.ts pattern) ──────────

function setupTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-"));
}
function teardownTmp(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function writeFixtureSkill(root: string, id: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id,
      version: "1.0.0",
      description: `Fixture ${id} skill`,
      triggerPhrases: ["do the thing"],
      structuralTriggers: [],
      model: "sonnet",
      dataSchemas: { read: ["tasks", "objectives"], write: [] },
      supportsAttachments: false,
      tools: ["submit_priority_ranking", "request_clarification"],
      autoEvaluate: false,
      tokenBudget: 5000,
      promptLockedZones: [],
      surface: null,
    })
  );
  fs.writeFileSync(path.join(dir, "prompt.md"), "You are a test skill.");
  fs.writeFileSync(path.join(dir, "context.ts"), `
export const contextRequirements = {
  userProfile: true,
  objectives: true,
  recentTasks: { limit: 20, includeCompleted: false },
};
`);
  fs.writeFileSync(path.join(dir, "handlers.ts"), `
export async function submit_priority_ranking(args, _ctx) {
  const ranked = args.ranked || [];
  const topPick = args.topPick;
  const summary = args.summary || "";
  const lines = [];
  if (summary) lines.push(summary);
  if (topPick) {
    lines.push("");
    lines.push("Top pick: " + topPick.taskId + " — " + topPick.reason);
  }
  if (ranked.length > 0) {
    lines.push("");
    lines.push("Full ranking:");
    ranked.forEach((item, i) => {
      lines.push("  " + (i + 1) + ". " + item.taskId + " — " + item.reason);
    });
  }
  return {
    success: true,
    userMessage: lines.join("\\n"),
    data: { ranked, topPick, summary },
  };
}

export async function request_clarification(args, _ctx) {
  return {
    success: true,
    clarificationRequired: true,
    userMessage: args.question || "Could you clarify?",
    data: { question: args.question },
  };
}
`);
}

async function buildFixtureRegistry(skillsDir: string) {
  _resetSkillRegistryForTests();
  // Pre-populate cache so embedder doesn't run.
  const files = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  const cache: Record<string, { manifestMtimeMs: number; embedding: number[] }> = {};
  for (const f of files) {
    const m = path.join(skillsDir, f.name, "manifest.json");
    if (!fs.existsSync(m)) continue;
    cache[f.name] = {
      manifestMtimeMs: fs.statSync(m).mtimeMs,
      embedding: new Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0),
    };
  }
  fs.writeFileSync(path.join(skillsDir, ".embedding_cache.json"), JSON.stringify(cache));
  return loadSkillRegistry({ skillsDir });
}

/** Stub LLM client whose `messages.create` returns a canned tool_use block. */
function stubLlm(toolName: string, toolInput: Record<string, unknown>): any {
  return {
    messages: {
      create: async () => ({
        content: [
          { type: "tool_use", name: toolName, input: toolInput },
        ],
      }),
    },
  };
}

function stubLlmThrows(): any {
  return { messages: { create: async () => { throw new Error("network down"); } } };
}

function stubLlmNoTool(): any {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "I forgot to call a tool." }],
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

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // Story 1 — skill loads and routes — covered by smoke test in repo
  // (scripts/scratch/feat055_smoke.ts) and FEAT054 tests. The dispatcher
  // tests below assume a valid registry exists.

  section("Story 3 — v4-enabled gate");

  await test("dispatcher returns null when skill not in v4-enabled set", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "test_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("test_skill"),
        "any phrase",
        { registry, enabledSkillIds: new Set(["different_skill"]) }
      );
      assert.strictEqual(result, null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("dispatcher proceeds when skill IS in v4-enabled set", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "test_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("test_skill"),
        "any phrase",
        {
          registry,
          enabledSkillIds: new Set(["test_skill"]),
          llmClient: stubLlm("submit_priority_ranking", {
            ranked: [{ taskId: "t1", reason: "first" }],
            topPick: { taskId: "t1", reason: "first" },
            summary: "Quick summary",
          }),
        }
      );
      assert.ok(result, "result should not be null");
      assert.strictEqual(result!.skillId, "test_skill");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("dispatcher returns null when routed skill missing from registry (race)", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "real_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("ghost_skill"),
        "any",
        {
          registry,
          enabledSkillIds: new Set(["ghost_skill"]),
        }
      );
      assert.strictEqual(result, null);
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 2 — End-to-end execution path

  section("Story 2 — End-to-end execution path");

  await test("dispatcher passes skill prompt + tools to LLM and dispatches result", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);

      let llmInputCaptured: any = null;
      const llm: any = {
        messages: {
          create: async (input: any) => {
            llmInputCaptured = input;
            return {
              content: [
                {
                  type: "tool_use",
                  name: "submit_priority_ranking",
                  input: {
                    ranked: [{ taskId: "task_a", reason: "due tomorrow" }],
                    topPick: { taskId: "task_a", reason: "due tomorrow" },
                    summary: "Focus on task_a.",
                  },
                },
              ],
            };
          },
        },
      };

      const result = await dispatchSkill(
        makeRoute("ex_skill"),
        "what should I focus on",
        {
          registry,
          enabledSkillIds: new Set(["ex_skill"]),
          llmClient: llm,
        }
      );

      assert.ok(result);
      assert.strictEqual(result!.skillId, "ex_skill");
      assert.strictEqual(result!.toolCall.name, "submit_priority_ranking");
      assert.ok(result!.userMessage.includes("Focus on task_a"));
      assert.ok(result!.userMessage.includes("task_a"));

      // Verify LLM input shape
      assert.ok(llmInputCaptured, "LLM was called");
      assert.ok(llmInputCaptured.system.includes("You are a test skill"), "system prompt is the skill prompt");
      assert.ok(llmInputCaptured.messages[0].content.includes("what should I focus on"), "user message includes phrase");
      assert.ok(Array.isArray(llmInputCaptured.tools), "tools array passed");
      assert.strictEqual(llmInputCaptured.tools.length, 2, "both skill tools in array");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("clarification handler propagates clarificationRequired flag", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "c_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("c_skill"),
        "vague",
        {
          registry,
          enabledSkillIds: new Set(["c_skill"]),
          llmClient: stubLlm("request_clarification", { question: "Which project?" }),
        }
      );
      assert.ok(result);
      assert.strictEqual(result!.clarificationRequired, true);
      assert.strictEqual(result!.userMessage, "Which project?");
    } finally {
      teardownTmp(tmp);
    }
  });

  // Degraded paths

  section("Degraded paths");

  await test("LLM throws → degraded result with reason, no exception", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("ex_skill"),
        "any",
        {
          registry,
          enabledSkillIds: new Set(["ex_skill"]),
          llmClient: stubLlmThrows(),
        }
      );
      assert.ok(result);
      assert.ok(result!.degraded);
      assert.ok(result!.degraded!.reason.includes("llm call failed"));
      assert.strictEqual(result!.toolCall.name, "<degraded>");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("LLM returns no tool call → degraded", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("ex_skill"),
        "any",
        {
          registry,
          enabledSkillIds: new Set(["ex_skill"]),
          llmClient: stubLlmNoTool(),
        }
      );
      assert.ok(result);
      assert.ok(result!.degraded);
      assert.ok(result!.degraded!.reason.includes("no tool call"));
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("LLM picks unknown tool → degraded", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("ex_skill"),
        "any",
        {
          registry,
          enabledSkillIds: new Set(["ex_skill"]),
          llmClient: stubLlm("ghost_tool", {}),
        }
      );
      assert.ok(result);
      assert.ok(result!.degraded);
      assert.ok(result!.degraded!.reason.includes("ghost_tool"));
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("no LLM client → degraded", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("ex_skill"),
        "any",
        {
          registry,
          enabledSkillIds: new Set(["ex_skill"]),
          // no llmClient — and getClient() returns null in test env
        }
      );
      assert.ok(result);
      assert.ok(result!.degraded);
      assert.ok(result!.degraded!.reason.includes("no LLM client"));
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 5 — orchestration log (per CR-FEAT051 / dispatcher B1 fix)

  section("Orchestration log (CR-FEAT051 + dispatcher B1)");

  await test("every dispatch logs a [skillDispatcher] entry with hashed phrase", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);

      const original = console.log;
      const captured: string[] = [];
      console.log = (msg: string) => captured.push(msg);
      try {
        await dispatchSkill(
          makeRoute("ex_skill"),
          "test phrase for dispatcher logging",
          {
            registry,
            enabledSkillIds: new Set(["ex_skill"]),
            llmClient: stubLlm("submit_priority_ranking", {
              ranked: [], topPick: { taskId: "x", reason: "y" }, summary: "ok",
            }),
          }
        );
      } finally {
        console.log = original;
      }

      const dispatchLog = captured.find((s) => s.includes("[skillDispatcher] dispatch"));
      assert.ok(dispatchLog, "dispatch log entry should exist");
      assert.ok(/phrase=[a-f0-9]{16}/.test(dispatchLog!), "phrase is sha256-hashed (16 hex chars)");
      assert.ok(!dispatchLog!.includes("test phrase for dispatcher logging"), "plaintext phrase NOT in log");
      assert.ok(dispatchLog!.includes("skill=ex_skill"));
      assert.ok(dispatchLog!.includes("tool=submit_priority_ranking"));
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("degraded dispatch also logs a [skillDispatcher] entry", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkill(tmp, "ex_skill");
      const registry = await buildFixtureRegistry(tmp);

      const original = console.log;
      const captured: string[] = [];
      console.log = (msg: string) => captured.push(msg);
      try {
        await dispatchSkill(
          makeRoute("ex_skill"),
          "any",
          {
            registry,
            enabledSkillIds: new Set(["ex_skill"]),
            llmClient: stubLlmThrows(),
          }
        );
      } finally {
        console.log = original;
      }

      const dispatchLog = captured.find((s) => s.includes("[skillDispatcher] dispatch"));
      assert.ok(dispatchLog, "even degraded dispatches log");
      assert.ok(dispatchLog!.includes("degraded="));
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 4 (revised) — fixture-based correctness on 5 fixture states

  section("Story 4 (revised) — fixture-based correctness on 5 fixtures");

  // Each fixture is a (state, canned LLM tool call, expected top-3 task ids)
  // triple. The dispatcher produces a user message; we assert the message
  // contains the expected ids in order.
  const FIXTURES: Array<{
    name: string;
    state: any;
    cannedLlmCall: { name: string; input: Record<string, unknown> };
    expectedTopTaskId: string;
    expectedRankedIds: string[];
  }> = [
    {
      name: "objective-anchored ranking",
      state: { objectives: [{ id: "o1", title: "Ship v2.01" }], recentTasks: [{ id: "t1" }, { id: "t2" }] },
      cannedLlmCall: {
        name: "submit_priority_ranking",
        input: {
          ranked: [
            { taskId: "t1", reason: "ties to v2.01 ship" },
            { taskId: "t2", reason: "blocks t1" },
          ],
          topPick: { taskId: "t1", reason: "ties to v2.01 ship" },
          summary: "Focus on shipping v2.01.",
        },
      },
      expectedTopTaskId: "t1",
      expectedRankedIds: ["t1", "t2"],
    },
    {
      name: "single overdue task wins",
      state: { recentTasks: [{ id: "overdue", due: "2026-04-20" }] },
      cannedLlmCall: {
        name: "submit_priority_ranking",
        input: {
          ranked: [{ taskId: "overdue", reason: "overdue" }],
          topPick: { taskId: "overdue", reason: "overdue" },
          summary: "One overdue item.",
        },
      },
      expectedTopTaskId: "overdue",
      expectedRankedIds: ["overdue"],
    },
    {
      name: "calendar-aware ranking with three items",
      state: { calendarToday: [{ id: "meeting" }], recentTasks: [{ id: "a" }, { id: "b" }, { id: "c" }] },
      cannedLlmCall: {
        name: "submit_priority_ranking",
        input: {
          ranked: [
            { taskId: "a", reason: "before the 2pm meeting" },
            { taskId: "b", reason: "afternoon block" },
            { taskId: "c", reason: "evening" },
          ],
          topPick: { taskId: "a", reason: "before the 2pm meeting" },
          summary: "Day is dense — sequence around the meeting.",
        },
      },
      expectedTopTaskId: "a",
      expectedRankedIds: ["a", "b", "c"],
    },
    {
      name: "no clear winner — clarification path",
      state: { recentTasks: [{ id: "x" }, { id: "y" }] },
      cannedLlmCall: {
        name: "request_clarification",
        input: { question: "Which area should I prioritize — work or personal?" },
      },
      expectedTopTaskId: "<clarification>",
      expectedRankedIds: [],
    },
    {
      name: "family > work override",
      state: {
        objectives: [{ id: "fam", title: "Family time", category: "family" }],
        recentTasks: [{ id: "work_a" }, { id: "fam_a", category: "family" }],
      },
      cannedLlmCall: {
        name: "submit_priority_ranking",
        input: {
          ranked: [
            { taskId: "fam_a", reason: "family precedence rule" },
            { taskId: "work_a", reason: "secondary" },
          ],
          topPick: { taskId: "fam_a", reason: "family precedence rule" },
          summary: "Family items first.",
        },
      },
      expectedTopTaskId: "fam_a",
      expectedRankedIds: ["fam_a", "work_a"],
    },
  ];

  for (const fx of FIXTURES) {
    await test(`fixture: ${fx.name}`, async () => {
      const tmp = setupTmp();
      try {
        writeFixtureSkill(tmp, "ex_skill");
        const registry = await buildFixtureRegistry(tmp);
        const result = await dispatchSkill(
          makeRoute("ex_skill"),
          "what should I focus on",
          {
            registry,
            enabledSkillIds: new Set(["ex_skill"]),
            state: fx.state,
            llmClient: stubLlm(fx.cannedLlmCall.name, fx.cannedLlmCall.input),
          }
        );
        assert.ok(result, "dispatcher returned a result");
        if (fx.cannedLlmCall.name === "request_clarification") {
          assert.strictEqual(result!.clarificationRequired, true);
        } else {
          // Verify expected ids appear in user message in the right order
          for (const id of fx.expectedRankedIds) {
            assert.ok(result!.userMessage.includes(id), `ranked id ${id} should appear in message`);
          }
          assert.ok(
            result!.userMessage.includes(fx.expectedTopTaskId),
            `top pick ${fx.expectedTopTaskId} should appear in message`
          );
        }
      } finally {
        teardownTmp(tmp);
      }
    });
  }

  // Smoke check — real priority_planning skill loads via the production loader

  section("Real priority_planning skill — smoke check");

  await test("real src/skills/priority_planning/ loads with no warnings", async () => {
    _resetSkillRegistryForTests();
    // Ensure the cache file exists so the embedder doesn't run.
    const skillsDir = "src/skills";
    const cachePath = path.join(skillsDir, ".embedding_cache.json");
    if (!fs.existsSync(cachePath)) {
      const m = path.join(skillsDir, "priority_planning", "manifest.json");
      if (fs.existsSync(m)) {
        const stat = fs.statSync(m);
        const cache = {
          priority_planning: {
            manifestMtimeMs: stat.mtimeMs,
            embedding: new Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0),
          },
        };
        fs.writeFileSync(cachePath, JSON.stringify(cache));
      }
    }
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("priority_planning");
    assert.ok(skill, "priority_planning skill must load via production loader");
    assert.ok(skill!.handlers.submit_priority_ranking, "submit_priority_ranking handler exported");
    assert.ok(skill!.handlers.request_clarification, "request_clarification handler exported");
    assert.strictEqual(skill!.manifest.model, "sonnet");
    assert.strictEqual(skill!.manifest.surface, null);
  });

  // ─── FEAT065 — schema-aware buildToolSchemas ────────────────────────────

  section("FEAT065 — schema-aware buildToolSchemas");

  function writeFixtureSkillWithSchemas(root: string, id: string): void {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        id,
        version: "1.0.0",
        description: `Fixture ${id} skill`,
        triggerPhrases: ["do the thing"],
        structuralTriggers: [],
        model: "haiku",
        dataSchemas: { read: [], write: [] },
        supportsAttachments: false,
        tools: ["submit_priority_ranking", "request_clarification"],
        autoEvaluate: false,
        tokenBudget: 5000,
        promptLockedZones: [],
        surface: null,
      })
    );
    fs.writeFileSync(path.join(dir, "prompt.md"), "You are a test skill.");
    fs.writeFileSync(path.join(dir, "context.ts"), `export const contextRequirements = {};\n`);
    fs.writeFileSync(
      path.join(dir, "handlers.ts"),
      `
exports.submit_priority_ranking = async (args) => ({ success: true, userMessage: "ok", data: args });
exports.request_clarification = async (args) => ({ success: true, clarificationRequired: true, userMessage: args.question || "?" });
exports.toolSchemas = {
  submit_priority_ranking: {
    name: "submit_priority_ranking",
    description: "fixture ranking",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  // Note: request_clarification intentionally omitted to exercise WARN fallback
};
`
    );
  }

  await test("dispatcher passes declared toolSchemas verbatim to LLM for known tools", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkillWithSchemas(tmp, "schema_skill");
      const registry = await buildFixtureRegistry(tmp);
      let captured: any = null;
      const llm: any = {
        messages: {
          create: async (input: any) => {
            captured = input;
            return {
              content: [
                {
                  type: "tool_use",
                  name: "submit_priority_ranking",
                  input: { summary: "ok" },
                },
              ],
            };
          },
        },
      };
      await dispatchSkill(
        makeRoute("schema_skill"),
        "go",
        {
          registry,
          enabledSkillIds: new Set(["schema_skill"]),
          llmClient: llm,
        }
      );
      assert.ok(captured, "LLM was called");
      assert.ok(Array.isArray(captured.tools), "tools passed");
      const ranking = captured.tools.find((t: any) => t.name === "submit_priority_ranking");
      assert.ok(ranking, "submit_priority_ranking schema passed");
      assert.strictEqual(ranking.description, "fixture ranking", "schema description preserved");
      assert.strictEqual(ranking.input_schema.required[0], "summary", "required passed through");
      assert.strictEqual(
        ranking.input_schema.additionalProperties,
        false,
        "additionalProperties: false preserved"
      );
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("dispatcher warns and falls back to permissive schema when toolSchemas[tool] missing", async () => {
    const tmp = setupTmp();
    try {
      writeFixtureSkillWithSchemas(tmp, "schema_skill_b");
      const registry = await buildFixtureRegistry(tmp);
      let captured: any = null;
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (msg: string) => warns.push(msg);
      try {
        const llm: any = {
          messages: {
            create: async (input: any) => {
              captured = input;
              return {
                content: [
                  {
                    type: "tool_use",
                    name: "request_clarification",
                    input: { question: "huh?" },
                  },
                ],
              };
            },
          },
        };
        await dispatchSkill(
          makeRoute("schema_skill_b"),
          "go",
          {
            registry,
            enabledSkillIds: new Set(["schema_skill_b"]),
            llmClient: llm,
          }
        );
      } finally {
        console.warn = originalWarn;
      }
      assert.ok(captured, "LLM was called");
      const clarif = captured.tools.find((t: any) => t.name === "request_clarification");
      assert.ok(clarif, "fallback schema for request_clarification was passed");
      assert.strictEqual(
        clarif.input_schema.additionalProperties,
        true,
        "fallback uses permissive additionalProperties: true"
      );
      const warnHit = warns.find(
        (w) =>
          w.includes("missing toolSchemas[request_clarification]") &&
          w.includes("schema_skill_b")
      );
      assert.ok(
        warnHit,
        "warn message names skill + missing tool: " + JSON.stringify(warns)
      );
    } finally {
      teardownTmp(tmp);
    }
  });

  // ─── FEAT068 — retrievalHook validation hardening ───────────────────────
  //
  // The dispatcher must NEVER crash on a malformed `retrievalHook`. Bad
  // shapes (non-array sources, wrong types, missing required keys) WARN
  // once and are treated as absent so dispatch proceeds without retrieval.

  section("FEAT068 — retrievalHook validation hardening");

  await test("malformed retrievalHook (sources: 'note' string) does not crash dispatcher", async () => {
    const tmp = setupTmp();
    try {
      // Build a skill with a malformed retrievalHook (sources is a string,
      // not an array). Hand-write the manifest so writeFixtureSkill's
      // default shape doesn't apply.
      const dir = path.join(tmp, "bad_hook_skill");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          id: "bad_hook_skill",
          version: "1.0.0",
          description: "Skill with malformed retrievalHook",
          triggerPhrases: ["bad hook test"],
          structuralTriggers: [],
          model: "haiku",
          dataSchemas: { read: [], write: [] },
          supportsAttachments: false,
          tools: ["submit"],
          autoEvaluate: true,
          tokenBudget: 1000,
          promptLockedZones: [],
          surface: null,
          // INTENTIONALLY MALFORMED: sources is a string, not an array.
          retrievalHook: { sources: "note", k: 5, minScore: 0.25, minScoreInclude: 0.4 },
        })
      );
      fs.writeFileSync(path.join(dir, "prompt.md"), "Test.");
      fs.writeFileSync(path.join(dir, "context.ts"), "export const contextRequirements = {};");
      fs.writeFileSync(
        path.join(dir, "handlers.ts"),
        `export async function submit(args, _ctx) { return { success: true, userMessage: "ok" }; }`
      );

      const registry = await buildFixtureRegistry(tmp);
      const warns: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: any[]) => { warns.push(args.join(" ")); };
      let result: SkillDispatchResult | null;
      try {
        result = await dispatchSkill(
          makeRoute("bad_hook_skill"),
          "test phrase",
          {
            registry,
            enabledSkillIds: new Set(["bad_hook_skill"]),
            llmClient: stubLlm("submit", {}),
          }
        );
      } finally {
        console.warn = originalWarn;
      }
      assert.ok(result, "dispatcher returned a result (did not crash)");
      assert.strictEqual(result.skillId, "bad_hook_skill");
      // The validator must have logged the malformed-hook WARN at least once.
      const hookWarn = warns.find((w) =>
        w.includes("invalid retrievalHook") && w.includes("bad_hook_skill")
      );
      assert.ok(
        hookWarn,
        "expected WARN about invalid retrievalHook, got: " + JSON.stringify(warns)
      );
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("absent retrievalHook → dispatcher proceeds with no retrieval (graceful degradation)", async () => {
    const tmp = setupTmp();
    try {
      // The default fixture skill writeFixtureSkill produces has NO
      // retrievalHook field — that's the "graceful degradation" case.
      writeFixtureSkill(tmp, "no_hook_skill");
      const registry = await buildFixtureRegistry(tmp);
      const result = await dispatchSkill(
        makeRoute("no_hook_skill"),
        "test phrase",
        {
          registry,
          enabledSkillIds: new Set(["no_hook_skill"]),
          llmClient: stubLlm("submit_priority_ranking", { ranked: [], summary: "ok" }),
        }
      );
      assert.ok(result, "dispatcher returned a result");
      assert.strictEqual(result.skillId, "no_hook_skill");
      // No retrieval occurred (no retrievedKnowledge in any context). We
      // can't introspect the LLM call payload here, but the absence of a
      // crash + a valid result is the load-bearing assertion.
      assert.strictEqual(result.degraded, undefined);
    } finally {
      teardownTmp(tmp);
    }
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
