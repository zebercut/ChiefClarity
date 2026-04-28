/**
 * FEAT067 — Embedding provider unit tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/embeddingsProvider.test.ts
 *       or: npm test
 *
 * These run on Node — they exercise the provider directly without going
 * through Metro. The xenova package's `browser` field substitution means
 * the same source is what ships to web; verifying it on Node is the
 * cheapest fidelity check available without spinning up a browser.
 */
import assert from "assert";
import { embed, embedBatch, isModelLoaded, MODEL_ID } from "./embeddings/provider";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
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

async function run(): Promise<void> {
  console.log("\nFEAT067 — embedding provider tests");

  await test("MODEL_ID is the pinned all-MiniLM-L6-v2", () => {
    assert.strictEqual(MODEL_ID, "Xenova/all-MiniLM-L6-v2");
  });

  await test("embed(\"\") returns null", async () => {
    const v = await embed("");
    assert.strictEqual(v, null);
  });

  await test("embed(\"a\") returns null (length < 2)", async () => {
    const v = await embed("a");
    assert.strictEqual(v, null);
  });

  await test("embed(\"hello world\") returns 384-dim Float32Array", async () => {
    const v = await embed("hello world");
    assert.ok(v instanceof Float32Array, "must be Float32Array");
    assert.strictEqual(v!.length, 384);
  });

  await test("isModelLoaded() is true after first successful embed", () => {
    assert.strictEqual(isModelLoaded(), true);
  });

  await test("embed is deterministic — same input → byte-equal vectors", async () => {
    const v1 = await embed("the quick brown fox");
    const v2 = await embed("the quick brown fox");
    assert.ok(v1 && v2);
    assert.strictEqual(v1!.length, v2!.length);
    for (let i = 0; i < v1!.length; i++) {
      assert.strictEqual(v1![i], v2![i], `mismatch at index ${i}`);
    }
  });

  await test("embedBatch returns array of equal length", async () => {
    const out = await embedBatch(["alpha", "beta", "gamma"]);
    assert.strictEqual(out.length, 3);
    for (const v of out) {
      assert.ok(v instanceof Float32Array);
      assert.strictEqual(v!.length, 384);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
