/**
 * FEAT064 — SKILL_BUNDLE shape contract test.
 *
 * The build-time bundle is the only path web/mobile can load skills from.
 * Its shape is a contract — an out-of-shape entry would crash the registry
 * silently on the platform that has no Node fallback. These tests assert
 * the shape contract independently of the registry loader, so a regression
 * in the codegen surfaces here even if the loader masks it.
 *
 * Also includes a parity check: the bundle-loaded registry produces the
 * same skill set (by id) as the LIFEOS_SKILL_LIVE_RELOAD fs path produces
 * against the real src/skills/ folder. This proves the dual-loader is
 * structurally equivalent.
 *
 * Run with: npx ts-node --transpile-only src/modules/skillBundle.test.ts
 *       or: npm test
 */
import * as fs from "fs";
import * as path from "path";
import assert from "assert";
import { SKILL_BUNDLE } from "../skills/_generated/skillBundle";
import {
  loadSkillRegistry,
  _resetSkillRegistryForTests,
} from "./skillRegistry";

// ─── Test runner (matches existing project convention) ─────────────────────

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

// ─── Expected skill set ────────────────────────────────────────────────────

const EXPECTED_SKILL_IDS = [
  "calendar_management",
  "emotional_checkin",
  "general_assistant",
  "inbox_triage",
  "info_lookup",
  "notes_capture",
  "priority_planning",
  "task_management",
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  section("FEAT064 — SKILL_BUNDLE shape contract");

  await test("all 8 expected skill ids are present in SKILL_BUNDLE", () => {
    const ids = Object.keys(SKILL_BUNDLE).sort();
    assert.deepStrictEqual(
      ids,
      EXPECTED_SKILL_IDS,
      `expected exactly the 8 migrated skills, got: ${ids.join(", ")}`
    );
  });

  await test("SKILL_BUNDLE keys are sorted lexicographically", () => {
    const ids = Object.keys(SKILL_BUNDLE);
    const sorted = [...ids].sort();
    assert.deepStrictEqual(
      ids,
      sorted,
      "codegen must emit keys in lexicographic order — duplicate-id rejection is alphabetical first-wins"
    );
  });

  await test("each entry has required keys: manifest, prompt, context, handlers", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      assert.ok(entry.manifest, `[${id}] missing 'manifest'`);
      assert.ok(typeof entry.prompt === "string", `[${id}] 'prompt' must be a string`);
      assert.ok(entry.context !== undefined, `[${id}] missing 'context'`);
      assert.ok(entry.handlers !== undefined, `[${id}] missing 'handlers'`);
    }
  });

  await test("each manifest has the expected id matching its bundle key", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      assert.strictEqual(
        entry.manifest.id,
        id,
        `[${id}] manifest.id mismatch — expected "${id}" got "${entry.manifest.id}"`
      );
    }
  });

  await test("each prompt is a non-empty string", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      assert.ok(
        entry.prompt.length > 0,
        `[${id}] prompt must be non-empty (got length ${entry.prompt.length})`
      );
      // The prompt should contain at least one printable character
      assert.ok(/\S/.test(entry.prompt), `[${id}] prompt must contain printable characters`);
    }
  });

  await test("each handlers object exposes at least one function", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      const handlerKeys = Object.keys(entry.handlers).filter(
        (k) => typeof entry.handlers[k] === "function"
      );
      assert.ok(
        handlerKeys.length > 0,
        `[${id}] handlers module must export at least one function (got: ${Object.keys(entry.handlers).join(", ") || "<none>"})`
      );
    }
  });

  await test("each manifest.tools entry has a matching exported handler function", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      const toolNames: string[] = entry.manifest.tools ?? [];
      assert.ok(toolNames.length > 0, `[${id}] manifest.tools must be non-empty`);
      for (const tool of toolNames) {
        assert.strictEqual(
          typeof entry.handlers[tool],
          "function",
          `[${id}] manifest.tools includes "${tool}" but handlers has no matching exported function`
        );
      }
    }
  });

  section("FEAT064 — Bundle prompt content fidelity (sampled)");

  await test("bundled prompts are byte-equal to their source prompt.md files", () => {
    // Sanity: the codegen must inline prompt.md content verbatim. If the
    // codegen ever introduces normalization (e.g., trimming, line-ending
    // changes), locked-zone hashes drift and this test catches it.
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      const sourcePath = path.join(__dirname, "..", "skills", id, "prompt.md");
      if (!fs.existsSync(sourcePath)) continue;
      const sourceText = fs.readFileSync(sourcePath, "utf8");
      // The codegen normalizes CRLF→LF before emit; do the same on the source
      // for a fair comparison.
      const sourceLF = sourceText.replace(/\r\n/g, "\n");
      assert.strictEqual(
        entry.prompt,
        sourceLF,
        `[${id}] bundled prompt drifted from source prompt.md`
      );
    }
  });

  section("FEAT064 — Dual-loader parity (bundle ↔ fs) skill set");

  await test("bundle-loaded registry produces the same 8-skill id set as the live-reload fs path", async () => {
    // Default load (no skillsDir) reads from the bundle.
    _resetSkillRegistryForTests();
    const bundleReg = await loadSkillRegistry();
    const bundleIds = bundleReg.getAllSkills().map((s) => s.manifest.id).sort();

    // Force fs path by passing the real skills dir explicitly. The registry's
    // doLoad() routes any opts.skillsDir to the fs path even outside live-reload.
    _resetSkillRegistryForTests();
    const skillsDir = path.join(__dirname, "..", "skills");
    const fsReg = await loadSkillRegistry({ skillsDir });
    const fsIds = fsReg.getAllSkills().map((s) => s.manifest.id).sort();

    // Reset so subsequent tests don't see fs-loaded singleton state.
    _resetSkillRegistryForTests();

    assert.deepStrictEqual(
      bundleIds,
      fsIds,
      "bundle path and fs path must produce the same skill set"
    );
    assert.deepStrictEqual(bundleIds, EXPECTED_SKILL_IDS);
  });

  section("FEAT067 — Skill embeddings shipped in bundle");

  await test("each bundle entry has a 384-float descriptionEmbedding", () => {
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      assert.ok(
        Array.isArray(entry.descriptionEmbedding),
        `[${id}] descriptionEmbedding must be an array`
      );
      assert.strictEqual(
        entry.descriptionEmbedding.length,
        384,
        `[${id}] descriptionEmbedding must be 384 floats (got ${entry.descriptionEmbedding.length})`
      );
      for (let i = 0; i < entry.descriptionEmbedding.length; i++) {
        assert.strictEqual(
          typeof entry.descriptionEmbedding[i],
          "number",
          `[${id}] descriptionEmbedding[${i}] must be a number`
        );
      }
    }
  });

  await test("bundle embeddings are real (not all-zero-but-first stub)", () => {
    // The pre-FEAT067 stub vectors were [1, 0, 0, ...]. Real embeddings
    // from MiniLM are normalized 384-dim with most positions non-zero.
    // Asserting a non-trivial number of non-zero entries catches the stub.
    for (const id of Object.keys(SKILL_BUNDLE)) {
      const entry = SKILL_BUNDLE[id] as any;
      const vec: number[] = entry.descriptionEmbedding;
      const nonZero = vec.filter((v) => v !== 0).length;
      assert.ok(
        nonZero > 100,
        `[${id}] descriptionEmbedding has only ${nonZero} non-zero entries — looks like a stub`
      );
    }
  });

  await test("bundle embeddings differ between distinct skills", () => {
    // Sanity: every skill should produce a distinct vector. If two are
    // byte-equal, the codegen ran with a broken embedder.
    const ids = Object.keys(SKILL_BUNDLE);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = (SKILL_BUNDLE[ids[i]] as any).descriptionEmbedding as number[];
        const b = (SKILL_BUNDLE[ids[j]] as any).descriptionEmbedding as number[];
        let allEqual = true;
        for (let k = 0; k < a.length; k++) {
          if (a[k] !== b[k]) { allEqual = false; break; }
        }
        assert.ok(!allEqual, `${ids[i]} and ${ids[j]} have identical embeddings`);
      }
    }
  });

  await test("loadFromBundle populates descriptionEmbedding from the bundle", async () => {
    _resetSkillRegistryForTests();
    const reg = await loadSkillRegistry();
    for (const skill of reg.getAllSkills()) {
      assert.ok(
        skill.descriptionEmbedding instanceof Float32Array,
        `[${skill.manifest.id}] descriptionEmbedding must be a Float32Array after bundle load`
      );
      assert.strictEqual(
        skill.descriptionEmbedding!.length,
        384,
        `[${skill.manifest.id}] descriptionEmbedding must be 384-dim`
      );
      // Real vector — not the stub [1,0,...].
      const nonZero = Array.from(skill.descriptionEmbedding!).filter((v) => v !== 0).length;
      assert.ok(
        nonZero > 100,
        `[${skill.manifest.id}] registry-loaded embedding looks like a stub (${nonZero} non-zero)`
      );
    }
    _resetSkillRegistryForTests();
  });

  console.log("");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
