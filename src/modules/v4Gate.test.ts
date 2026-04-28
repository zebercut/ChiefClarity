/**
 * FEAT056 — v4Gate (shouldTryV4) tests + general_assistant skill smoke.
 *
 * Run with: npx ts-node --transpile-only src/modules/v4Gate.test.ts
 *       or: npm test
 *
 * Tests the gate decision logic in isolation (pure function modulo the
 * module-level _v4SkillsEnabled state in router.ts, which is reset
 * between cases). Plus a smoke test that the general_assistant skill
 * loads via the production registry.
 */
import * as fs from "fs";
import * as path from "path";
import assert from "assert";
import { shouldTryV4 } from "./v4Gate";
import {
  setV4SkillsEnabled,
  _resetOrchestratorForTests,
} from "./router";
import {
  loadSkillRegistry,
  _resetSkillRegistryForTests,
} from "./skillRegistry";
import type { AppState } from "../types";

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

// ─── Fixture state ─────────────────────────────────────────────────────────

function makeState(extras: Partial<AppState> = {}): AppState {
  // Minimal fixture state; gate only reads `_pendingContext`.
  return {
    _pendingContext: null,
    _loadedCounts: {},
    _dirty: new Set(),
    // Other AppState fields aren't read by the gate, so leave loose.
    ...extras,
  } as unknown as AppState;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  section("shouldTryV4 — gate decision matrix");

  await test("returns false when v4-enabled set is empty", () => {
    _resetOrchestratorForTests();
    setV4SkillsEnabled([]);
    const result = shouldTryV4({ state: makeState(), triageLegacyIntent: null });
    assert.strictEqual(result, false);
  });

  await test("isNode() check is the first guard (Node test always passes it)", () => {
    // Tests run in Node, so isNode() returns true. This test verifies the
    // gate doesn't accidentally regress to the older "no platform check"
    // behavior. The non-Node branch is only reachable from the bundle —
    // exercised by the real app, not by Node tests.
    _resetOrchestratorForTests();
    setV4SkillsEnabled(["priority_planning"]);
    const result = shouldTryV4({ state: makeState(), triageLegacyIntent: null });
    assert.strictEqual(result, true, "Node platform + non-empty enabled set + no pending context → true");
  });

  await test("returns false when pending-context multi-turn is in flight", () => {
    _resetOrchestratorForTests();
    setV4SkillsEnabled(["priority_planning"]);
    const state = makeState({
      _pendingContext: { type: "general", tokenBudget: 3000, phrase: "earlier" } as any,
    });
    const result = shouldTryV4({ state, triageLegacyIntent: null });
    assert.strictEqual(result, false);
  });

  await test("triage's legacyIntent is IGNORED — gate trusts the orchestrator instead", () => {
    // Earlier design gated v4 off when triage matched a fast-path intent.
    // That blocked v4 from handling planning phrases (full_planning) and
    // any phrase triage's safeDefault punted on (legacyIntent="general").
    // The fix: drop the guard entirely. Orchestrator + dispatcher decide.
    _resetOrchestratorForTests();
    setV4SkillsEnabled(["priority_planning"]);
    const result = shouldTryV4({
      state: makeState(),
      triageLegacyIntent: "task_create", // triage thinks it's CRUD; gate doesn't care
    });
    assert.strictEqual(result, true, "triage metadata should not block v4");
  });

  await test("returns true when all three guards are clear", () => {
    _resetOrchestratorForTests();
    setV4SkillsEnabled(["priority_planning", "general_assistant"]);
    const result = shouldTryV4({
      state: makeState(),
      triageLegacyIntent: null,
    });
    assert.strictEqual(result, true);
  });

  await test("gate ignores triageLegacyIntent='general' (triage's safeDefault punt)", () => {
    // Triage's safeDefault sets legacyIntent="general" when it can't
    // classify confidently. v4 should still get a chance.
    _resetOrchestratorForTests();
    setV4SkillsEnabled(["priority_planning", "general_assistant"]);
    const result = shouldTryV4({
      state: makeState(),
      triageLegacyIntent: "general",
    });
    assert.strictEqual(result, true, "safeDefault punt must not block v4");
  });

  await test("clears state correctly between cases via _resetOrchestratorForTests", () => {
    _resetOrchestratorForTests();
    // No setV4SkillsEnabled call → set is empty
    const result = shouldTryV4({
      state: makeState(),
      triageLegacyIntent: null,
    });
    assert.strictEqual(result, false, "after reset, set is empty so gate returns false");
  });

  // ─── general_assistant skill smoke check ──────────────────────────────

  section("general_assistant skill — smoke check");

  await test("general_assistant loads via production registry with expected manifest", async () => {
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
    if (!fs.existsSync(cachePath)) {
      fs.writeFileSync(cachePath, JSON.stringify(cache));
    }

    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("general_assistant");
    assert.ok(skill, "general_assistant skill must load");
    assert.strictEqual(skill!.manifest.model, "haiku", "general_assistant uses Haiku tier");
    assert.deepStrictEqual(
      skill!.manifest.tools.sort(),
      ["submit_general_response"],
      "expected tool exists"
    );
    assert.ok(
      skill!.handlers.submit_general_response,
      "submit_general_response handler exported"
    );
    assert.strictEqual(skill!.manifest.surface, null);
    assert.strictEqual(skill!.manifest.tokenBudget, 3000);
  });

  await test("general_assistant data schemas declared as expected", async () => {
    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("general_assistant");
    assert.ok(skill);
    assert.deepStrictEqual(
      skill!.manifest.dataSchemas.read.sort(),
      ["objectives", "recentTasks", "userProfile"]
    );
    assert.deepStrictEqual(skill!.manifest.dataSchemas.write, []);
  });

  await test("general_assistant prompt includes the no-fabrication rule", async () => {
    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("general_assistant");
    assert.ok(skill);
    // The CRITICAL rule must be present per design review §6 condition 10.
    assert.ok(
      skill!.prompt.toLowerCase().includes("do not pretend"),
      "prompt must explicitly forbid pretending to perform specialized actions"
    );
    assert.ok(
      skill!.prompt.toLowerCase().includes("specialized"),
      "prompt mentions specialized handlers"
    );
  });

  await test("general_assistant handler returns the user's reply text", async () => {
    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("general_assistant");
    assert.ok(skill);
    const handler = skill!.handlers.submit_general_response;
    const result: any = await handler({ reply: "Sure, here's a joke." }, { phrase: "tell me a joke", skillId: "general_assistant" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Sure, here's a joke.");
    assert.strictEqual(result.data.reply, "Sure, here's a joke.");
  });

  await test("general_assistant handler degrades gracefully on missing reply", async () => {
    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    const skill = reg.getSkill("general_assistant");
    assert.ok(skill);
    const handler = skill!.handlers.submit_general_response;
    const result: any = await handler({}, { phrase: "test", skillId: "general_assistant" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "(no reply)");
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
