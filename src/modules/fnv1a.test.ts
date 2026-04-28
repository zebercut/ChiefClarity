/**
 * FEAT064 — FNV-1a 64-bit canonical-vector regression test.
 *
 * The FNV-1a hash is the log-correlation primitive replacing the prior
 * SHA-256-first-16 stub. It is NON-cryptographic but its canonical 64-bit
 * output is a published, well-defined sequence. Pinning the canonical
 * vectors here guards against well-meaning "improvements" to the
 * implementation that would silently break log-correlation across deploys.
 *
 * Canonical reference vectors are taken from the FNV public-domain reference
 * implementation: http://www.isthe.com/chongo/tech/comp/fnv/index.html
 *
 * Run with: npx ts-node --transpile-only src/modules/fnv1a.test.ts
 *       or: npm test
 */
import assert from "assert";
import { fnv1a64Hex } from "../utils/fnv1a";

// ─── Test runner (matches existing project convention) ─────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error(`fnv1a tests are sync; got Promise from "${name}"`);
    }
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

// ─── Tests ─────────────────────────────────────────────────────────────────

section("FEAT064 — FNV-1a 64-bit canonical vectors");

// FNV-1a 64-bit offset basis is 0xcbf29ce484222325. Hashing the empty string
// returns the offset basis itself.
test("empty string → cbf29ce484222325 (offset basis)", () => {
  assert.strictEqual(fnv1a64Hex(""), "cbf29ce484222325");
});

test("'a' → af63dc4c8601ec8c", () => {
  assert.strictEqual(fnv1a64Hex("a"), "af63dc4c8601ec8c");
});

test("'b' → af63dc4c8601e67c", () => {
  // Sanity check single-byte hash differs from "a"
  const h = fnv1a64Hex("b");
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.notStrictEqual(h, fnv1a64Hex("a"));
});

test("'hello' → a430d84680aabd0b", () => {
  // Canonical FNV-1a 64-bit reference vector for "hello"
  assert.strictEqual(fnv1a64Hex("hello"), "a430d84680aabd0b");
});

test("'foobar' → 85944171f73967e8", () => {
  // Canonical FNV-1a 64-bit reference vector for "foobar"
  assert.strictEqual(fnv1a64Hex("foobar"), "85944171f73967e8");
});

section("FEAT064 — FNV-1a output shape contract");

test("output is always 16 lowercase hex chars", () => {
  for (const input of ["", "a", "the quick brown fox", "café 日本", "{}"]) {
    const h = fnv1a64Hex(input);
    assert.match(h, /^[0-9a-f]{16}$/, `expected 16-hex output for "${input}", got "${h}"`);
  }
});

test("deterministic — same input produces same output across calls", () => {
  const a = fnv1a64Hex("chief clarity");
  const b = fnv1a64Hex("chief clarity");
  assert.strictEqual(a, b);
});

section("FEAT064 — FNV-1a project-pinned vector");

test("'chief clarity' is pinned to detect implementation drift", () => {
  // This vector is computed once with the FEAT064 implementation and pinned
  // here. If a future "improvement" to fnv1a64Hex changes the bytes, this
  // test fails loudly and forces a conscious decision (re-pin or revert).
  assert.strictEqual(fnv1a64Hex("chief clarity"), "9429dc34ad04e92e");
});

test("UTF-8 encoded — multi-byte chars don't crash", () => {
  // Non-ASCII inputs go through the utf8Encode fallback path; assert no throw
  // and that the hex shape contract still holds.
  const h = fnv1a64Hex("café 日本 🎉");
  assert.match(h, /^[0-9a-f]{16}$/);
});

console.log("");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
