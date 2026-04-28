/**
 * FEAT064 — sha256Hex Node↔WebCrypto byte-equal regression test.
 *
 * This is the load-bearing parity test for the locked-zone integrity contract.
 * Every fixture is hashed via:
 *   (a) the sha256Hex helper (prefers globalThis.crypto.subtle on Node 19+,
 *       which is the same WebCrypto API the browser exposes), AND
 *   (b) Node's native crypto.createHash directly (the legacy path).
 * Both must produce byte-equal lowercase hex output. If they ever drift,
 * FEAT054 §5 locked-zone integrity breaks and FEAT058/070 auto-patcher
 * stops being able to detect tampering.
 *
 * Run with: npx ts-node --transpile-only src/modules/sha256.test.ts
 *       or: npm test
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import assert from "assert";
import { sha256Hex } from "../utils/sha256";

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

// ─── Helpers ───────────────────────────────────────────────────────────────

function nodeCreateHashHex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Compute SHA-256 via globalThis.crypto.subtle directly. Node 19+ exposes
 * this natively as the same WebCrypto surface the browser ships. If subtle
 * is unavailable (older Node), the test is a no-op for that fixture and
 * passes trivially — sha256Hex's own Node fallback is exercised separately.
 */
async function webcryptoSubtleHex(input: string): Promise<string | null> {
  const subtle = (globalThis as any)?.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") return null;
  const buf = new TextEncoder().encode(input);
  const hashBuf = await subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const SAFETY_BLOCK = `## Safety

If the user expresses any of the following, treat the message as a
crisis signal — do NOT log to userObservations and do NOT produce
a normal acknowledgement.`;

// The longest known prompt in the bundle is inbox_triage at ~6.6 KB.
// We use its on-disk content as the "longest known prompt's locked-zone
// content" fixture per the brief.
const INBOX_PROMPT_PATH = path.join(__dirname, "..", "skills", "inbox_triage", "prompt.md");
const INBOX_PROMPT = fs.existsSync(INBOX_PROMPT_PATH)
  ? fs.readFileSync(INBOX_PROMPT_PATH, "utf8")
  : "";

const FIXTURES: Array<{ name: string; input: string }> = [
  { name: "empty string", input: "" },
  { name: "ASCII short", input: "hello" },
  { name: "ASCII multi-line", input: "line one\nline two\nline three\n" },
  { name: "unicode mixed", input: "café 日本 — résumé 🎉" },
  { name: "safety block (locked-zone style)", input: SAFETY_BLOCK },
  { name: "longest known prompt (inbox_triage)", input: INBOX_PROMPT },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  section("FEAT064 — sha256Hex parity (Node createHash ↔ WebCrypto subtle)");

  for (const fx of FIXTURES) {
    await test(`byte-equal hash for: ${fx.name}`, async () => {
      const helperHex = await sha256Hex(fx.input);
      const nodeHex = nodeCreateHashHex(fx.input);
      assert.strictEqual(
        helperHex,
        nodeHex,
        `sha256Hex output must match Node crypto.createHash for fixture "${fx.name}"`
      );
      assert.match(helperHex, /^[0-9a-f]{64}$/, "must be 64-char lowercase hex");

      // Also verify against globalThis.crypto.subtle directly when available
      // (Node 19+). This proves the WebCrypto path the browser uses produces
      // the same bytes.
      const subtleHex = await webcryptoSubtleHex(fx.input);
      if (subtleHex !== null) {
        assert.strictEqual(
          subtleHex,
          nodeHex,
          `WebCrypto subtle.digest must match Node createHash for fixture "${fx.name}"`
        );
      }
    });
  }

  await test("known SHA-256 vector: empty string", async () => {
    // Canonical SHA-256 of "" is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const actual = await sha256Hex("");
    assert.strictEqual(actual, expected, "SHA-256 of empty string must match published vector");
  });

  await test("known SHA-256 vector: 'abc'", async () => {
    // Canonical SHA-256 of "abc" is ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const actual = await sha256Hex("abc");
    assert.strictEqual(actual, expected, "SHA-256 of 'abc' must match published vector");
  });

  console.log("");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
