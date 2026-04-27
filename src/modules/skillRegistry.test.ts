/**
 * FEAT054 — Skill Registry tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/skillRegistry.test.ts
 *       or: npm test
 *
 * All tests use temporary directories under os.tmpdir(); production
 * src/skills/ is never touched. Embeddings are pre-populated in fake cache
 * files so tests don't need to download the bge-m3 model.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import assert from "assert";
import {
  loadSkillRegistry,
  _resetSkillRegistryForTests,
  RESERVED_ROUTES,
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

// ─── Test fixtures ─────────────────────────────────────────────────────────

const VALID_PROMPT = "You are a test skill.\n\nDo the thing.";
const VALID_CONTEXT = "export const contextRequirements = { tasks: true };\n";
const VALID_HANDLERS =
  "export async function doThing(args, ctx) { return { ok: true, args }; }\n";

interface ManifestExtras {
  id?: string;
  version?: string;
  description?: string;
  triggerPhrases?: string[];
  structuralTriggers?: string[];
  model?: any;
  modelSelector?: any;
  minModelTier?: any;
  dataSchemas?: any;
  supportsAttachments?: boolean;
  tools?: string[];
  autoEvaluate?: boolean;
  tokenBudget?: any;
  promptLockedZones?: string[];
  surface?: any;
}

function validManifest(id: string, extras: ManifestExtras = {}): any {
  return {
    id,
    version: "1.0.0",
    description: `test skill ${id}`,
    triggerPhrases: ["do the thing"],
    structuralTriggers: [],
    model: "haiku",
    dataSchemas: { read: [], write: [] },
    supportsAttachments: false,
    tools: ["doThing"],
    autoEvaluate: false,
    tokenBudget: 1000,
    promptLockedZones: [],
    surface: null,
    ...extras,
  };
}

interface SkillFiles {
  manifest?: unknown;            // pass an object → JSON.stringify; pass a raw string → write as-is
  prompt?: string;
  context?: string;
  handlers?: string;
}

function writeSkill(root: string, folderName: string, files: SkillFiles): void {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  if (files.manifest !== undefined) {
    const content =
      typeof files.manifest === "string"
        ? (files.manifest as string)
        : JSON.stringify(files.manifest, null, 2);
    fs.writeFileSync(path.join(dir, "manifest.json"), content);
  }
  if (files.prompt !== undefined) {
    fs.writeFileSync(path.join(dir, "prompt.md"), files.prompt);
  }
  if (files.context !== undefined) {
    fs.writeFileSync(path.join(dir, "context.ts"), files.context);
  }
  if (files.handlers !== undefined) {
    fs.writeFileSync(path.join(dir, "handlers.ts"), files.handlers);
  }
}

function writeValidSkill(root: string, folderName: string, manifestExtras: ManifestExtras = {}): void {
  // Use folderName as the id by default if extras doesn't override
  const id = manifestExtras.id ?? folderName;
  writeSkill(root, folderName, {
    manifest: validManifest(id, manifestExtras),
    prompt: manifestExtras.promptLockedZones?.length
      ? promptWithLockedZones(manifestExtras.promptLockedZones)
      : VALID_PROMPT,
    context: VALID_CONTEXT,
    handlers: VALID_HANDLERS,
  });
}

function promptWithLockedZones(zones: string[]): string {
  let p = VALID_PROMPT + "\n\n";
  for (const z of zones) {
    p += `<!-- LOCKED:${z} -->\nProtected text for ${z}.\n<!-- /LOCKED -->\n\n`;
  }
  return p;
}

function setupTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillreg-"));
}

function teardownTmp(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// Pre-populated cache so tests don't trigger the real embedder.
function writeFakeCache(skillsDir: string, entries: Record<string, number[]>): string {
  const cachePath = path.join(skillsDir, ".embedding_cache.json");
  // mtimeMs must match each manifest's actual mtime for cache hits.
  const data: Record<string, { manifestMtimeMs: number; embedding: number[] }> = {};
  for (const [id, vec] of Object.entries(entries)) {
    const manifestPath = path.join(skillsDir, id, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const stat = fs.statSync(manifestPath);
      data[id] = { manifestMtimeMs: stat.mtimeMs, embedding: vec };
    }
  }
  fs.writeFileSync(cachePath, JSON.stringify(data));
  return cachePath;
}

function unitVector(dim: number, hot: number): number[] {
  const v = new Array(dim).fill(0);
  v[hot % dim] = 1;
  return v;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // Story 1 — Drop-folder skill addition

  section("Story 1 — Drop-folder skill addition");

  await test("AC 1.1: valid skill folder loads and is registered", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "test_skill_one");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("test_skill_one");
      assert.ok(s, "skill should be registered");
      assert.strictEqual(s!.manifest.id, "test_skill_one");
      assert.strictEqual(s!.manifest.version, "1.0.0");
      assert.strictEqual(typeof s!.handlers.doThing, "function");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 1.3: missing required file → skill rejected, registry has only loaded skills", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "good");
      // Bad: no prompt.md
      writeSkill(tmp, "no_prompt", {
        manifest: validManifest("no_prompt"),
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.ok(reg.getSkill("good"), "good skill should load");
      assert.strictEqual(reg.getSkill("no_prompt"), null, "incomplete skill should not load");
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 2 — Boot-safe loader

  section("Story 2 — Boot-safe loader");

  await test("AC 2.1: 5 valid + 1 malformed → 5 load, app boots", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      for (let i = 0; i < 5; i++) writeValidSkill(tmp, `skill_${i}`);
      writeSkill(tmp, "broken", {
        manifest: "{not valid json,",
        prompt: VALID_PROMPT,
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getAllSkills().length, 5, "exactly 5 should load");
      assert.strictEqual(reg.getSkill("broken"), null, "broken should be rejected");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 2.2: handlers.ts throws on import → skill rejected", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "throws_on_import", {
        manifest: validManifest("throws_on_import"),
        prompt: VALID_PROMPT,
        context: VALID_CONTEXT,
        handlers: 'throw new Error("boom at import"); export const noop = () => {};',
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("throws_on_import"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 2.3: duplicate id → first folder wins (alphabetical)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      // Two folders, same id — "a_dup" comes first alphabetically.
      writeValidSkill(tmp, "a_dup", { id: "shared_id", description: "from a" });
      writeValidSkill(tmp, "b_dup", { id: "shared_id", description: "from b" });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("shared_id");
      assert.ok(s);
      assert.strictEqual(s!.manifest.description, "from a", "first alphabetical should win");
      assert.strictEqual(reg.getAllSkills().length, 1);
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 3 — Locked safety zones

  section("Story 3 — Locked safety zones");

  await test("AC 3.1: declared zone present → loads", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "with_zones", {
        promptLockedZones: ["safety_boundary"],
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("with_zones");
      assert.ok(s);
      assert.ok(s!.lockedZones.has("safety_boundary"));
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 3.2: declared zone missing in prompt → rejected", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "missing_zone", {
        manifest: validManifest("missing_zone", { promptLockedZones: ["safety_boundary"] }),
        prompt: VALID_PROMPT, // no LOCKED block
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("missing_zone"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 3.3: empty promptLockedZones → loads", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "no_zones");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("no_zones");
      assert.ok(s);
      assert.strictEqual(s!.lockedZones.size, 0);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 3.4: two zones declared and present → both in metadata with hashes", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "two_zones", {
        promptLockedZones: ["safety_boundary", "non_clinical_disclaimer"],
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("two_zones");
      assert.ok(s);
      assert.strictEqual(s!.lockedZones.size, 2);
      const safety = s!.lockedZones.get("safety_boundary");
      const clinical = s!.lockedZones.get("non_clinical_disclaimer");
      assert.ok(safety && /^[a-f0-9]{64}$/.test(safety.hash), "safety hash must be sha256 hex");
      assert.ok(clinical && /^[a-f0-9]{64}$/.test(clinical.hash), "clinical hash must be sha256 hex");
      assert.notStrictEqual(safety!.hash, clinical!.hash, "different content → different hashes");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("locked-zone hash format is sha256 of inner content (FEAT058/FEAT070 contract)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      // Prompt with one known LOCKED block, exact bytes — verify hash matches manual sha256.
      const inner = "\nProtected text for x.\n";
      const prompt = `lead-in text\n<!-- LOCKED:x -->${inner}<!-- /LOCKED -->\n`;
      writeSkill(tmp, "hash_check", {
        manifest: validManifest("hash_check", { promptLockedZones: ["x"] }),
        prompt,
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("hash_check");
      assert.ok(s);
      const expected = crypto.createHash("sha256").update(inner, "utf8").digest("hex");
      assert.strictEqual(s!.lockedZones.get("x")!.hash, expected);
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 4 — Declarative UI surfaces

  section("Story 4 — Declarative UI surfaces");

  await test("AC 4.1 + 4.2: surface declared appears in getAllSurfaces; null surface is filtered", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "with_surface", {
        surface: {
          id: "with_surface",
          label: "With Surface",
          icon: "star",
          route: "/with-surface",
          component: "ui/View.tsx",
          order: 100,
        },
      });
      writeValidSkill(tmp, "no_surface");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const surfaces = reg.getAllSurfaces();
      assert.strictEqual(surfaces.length, 1);
      assert.strictEqual(surfaces[0].id, "with_surface");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 4.3: two surfaces sorted by order ascending", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "later", {
        surface: { id: "later", label: "Later", icon: "z", route: "/later", component: "ui/L.tsx", order: 200 },
      });
      writeValidSkill(tmp, "earlier", {
        surface: { id: "earlier", label: "Earlier", icon: "a", route: "/earlier", component: "ui/E.tsx", order: 50 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const surfaces = reg.getAllSurfaces();
      assert.strictEqual(surfaces.length, 2);
      assert.strictEqual(surfaces[0].id, "earlier", "lower order first");
      assert.strictEqual(surfaces[1].id, "later");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 4.4: surface route matching RESERVED_ROUTES → rejected", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "collides", {
        surface: { id: "collides", label: "X", icon: "x", route: "/chat", component: "ui/V.tsx", order: 1 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("collides"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("(B2 fix) unsafe route → rejected: javascript: scheme", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "unsafe_js", {
        surface: { id: "unsafe_js", label: "X", icon: "x", route: "javascript:alert(1)", component: "ui/V.tsx", order: 1 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("unsafe_js"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("(B2 fix) unsafe route → rejected: path traversal", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "unsafe_traversal", {
        surface: { id: "unsafe_traversal", label: "X", icon: "x", route: "/../etc", component: "ui/V.tsx", order: 1 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("unsafe_traversal"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("(B2 fix) unsafe route → rejected: missing leading slash", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "no_slash", {
        surface: { id: "no_slash", label: "X", icon: "x", route: "noslash", component: "ui/V.tsx", order: 1 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("no_slash"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("(B4 fix) duplicate surface route between two skills → second rejected", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "a_route", {
        surface: { id: "a_route", label: "A", icon: "a", route: "/finances", component: "ui/A.tsx", order: 1 },
      });
      writeValidSkill(tmp, "b_route", {
        surface: { id: "b_route", label: "B", icon: "b", route: "/finances", component: "ui/B.tsx", order: 1 },
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.ok(reg.getSkill("a_route"), "first alphabetical wins");
      assert.strictEqual(reg.getSkill("b_route"), null, "duplicate route rejected");
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 5 — Boot performance under cache

  section("Story 5 — Boot performance under cache");

  await test("AC 5.1: pre-populated cache → embedding present without computing", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "cached");
      writeFakeCache(tmp, { cached: unitVector(384, 7) });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("cached");
      assert.ok(s);
      assert.ok(s!.descriptionEmbedding, "embedding should be populated from cache");
      assert.strictEqual(s!.descriptionEmbedding!.length, 384);
      assert.strictEqual(s!.descriptionEmbedding![7], 1);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 5.2: cache invalidated when manifest mtime changes", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "stale_test");
      writeFakeCache(tmp, { stale_test: unitVector(384, 0) });

      // Force manifest mtime to change after the cache was written
      const manifestPath = path.join(tmp, "stale_test", "manifest.json");
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(manifestPath, future, future);

      // Loader should detect mtime mismatch and try to compute (returns null when
      // embedder is not available in test env — that's the observable signal).
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("stale_test");
      assert.ok(s, "skill still loads");
      // Either embedding was recomputed (embedder available) or null (not available).
      // Both prove the stale cache entry was NOT reused — that's the AC.
      const cached = unitVector(384, 0);
      const used = s!.descriptionEmbedding;
      if (used) {
        assert.notStrictEqual(used[0], cached[0], "should not be the stale cache vector");
      }
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("(B1 fix) cache rebuilt from scratch — entries for removed skills pruned", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "kept");
      // Pre-populate cache with both "kept" and a phantom "removed" skill
      writeFakeCache(tmp, { kept: unitVector(384, 1), removed: unitVector(384, 99) });

      // Force a difference so the cache gets rewritten
      const manifestPath = path.join(tmp, "kept", "manifest.json");
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(manifestPath, future, future);

      await loadSkillRegistry({ skillsDir: tmp });

      const cachePath = path.join(tmp, ".embedding_cache.json");
      const cacheNow = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      assert.ok(!("removed" in cacheNow), "phantom 'removed' entry should be pruned");
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("corrupted cache file → loader rebuilds (no crash)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "robust");
      const cachePath = path.join(tmp, ".embedding_cache.json");
      fs.writeFileSync(cachePath, "{this is not json");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.ok(reg.getSkill("robust"), "skill loads despite corrupt cache");
    } finally {
      teardownTmp(tmp);
    }
  });

  // Story 6 — Registry API for downstream consumers

  section("Story 6 — Registry API");

  await test("AC 6.2: empty registry → findSkillsByEmbedding returns empty array", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const results = reg.findSkillsByEmbedding(new Float32Array(384), 3);
      assert.deepStrictEqual(results, []);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 6.3: getSkill(unknown_id) → null (not exception)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "exists");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("does_not_exist"), null);
      assert.ok(reg.getSkill("exists"));
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 6.1: findSkillsByEmbedding returns sorted top-K (cached vectors)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "near");
      writeValidSkill(tmp, "mid");
      writeValidSkill(tmp, "far");
      // Pre-populate cache with known unit vectors so cosine similarity is deterministic.
      writeFakeCache(tmp, {
        near: unitVector(384, 0),
        mid: unitVector(384, 100),
        far: unitVector(384, 200),
      });

      const reg = await loadSkillRegistry({ skillsDir: tmp });

      const phrase = new Float32Array(384);
      phrase[0] = 1; // perfect match for "near"

      const results = reg.findSkillsByEmbedding(phrase, 3);
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0].skillId, "near", "highest similarity first");
      assert.ok(results[0].score > results[1].score, "results sorted descending");
      assert.ok(results[1].score >= results[2].score);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("AC 6.4: getAllSurfaces() filters skills without surface and sorts", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeValidSkill(tmp, "with_surface_1", {
        surface: { id: "ws1", label: "1", icon: "1", route: "/r1", component: "ui/V1.tsx", order: 5 },
      });
      writeValidSkill(tmp, "with_surface_2", {
        surface: { id: "ws2", label: "2", icon: "2", route: "/r2", component: "ui/V2.tsx", order: 1 },
      });
      writeValidSkill(tmp, "no_surface_a");
      writeValidSkill(tmp, "no_surface_b");
      writeValidSkill(tmp, "no_surface_c");
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const surfaces = reg.getAllSurfaces();
      assert.strictEqual(surfaces.length, 2);
      assert.strictEqual(surfaces[0].id, "ws2");
      assert.strictEqual(surfaces[1].id, "ws1");
    } finally {
      teardownTmp(tmp);
    }
  });

  // Manifest validator — one bad case per field

  section("Manifest validator — bad cases");

  const validatorBadCases: Array<{ name: string; mutate: (m: any) => any | string }> = [
    { name: "id missing", mutate: (m) => ({ ...m, id: undefined }) },
    { name: "id wrong format (UPPERCASE)", mutate: (m) => ({ ...m, id: "BadId" }) },
    { name: "id too short", mutate: (m) => ({ ...m, id: "ab" }) },
    { name: "version not semver", mutate: (m) => ({ ...m, version: "v1" }) },
    { name: "description empty", mutate: (m) => ({ ...m, description: "" }) },
    { name: "triggerPhrases not array", mutate: (m) => ({ ...m, triggerPhrases: "do thing" }) },
    { name: "triggerPhrases contains non-string", mutate: (m) => ({ ...m, triggerPhrases: [123] }) },
    { name: "model unknown tier", mutate: (m) => ({ ...m, model: "gpt5" }) },
    { name: "model object missing default", mutate: (m) => ({ ...m, model: { deep: "sonnet" } }) },
    { name: "modelSelector unknown value", mutate: (m) => ({ ...m, modelSelector: "magic" }) },
    { name: "minModelTier invalid", mutate: (m) => ({ ...m, minModelTier: "opus" }) },
    { name: "dataSchemas not object", mutate: (m) => ({ ...m, dataSchemas: [] }) },
    { name: "dataSchemas.read not array", mutate: (m) => ({ ...m, dataSchemas: { read: "tasks", write: [] } }) },
    { name: "supportsAttachments not boolean", mutate: (m) => ({ ...m, supportsAttachments: "yes" }) },
    { name: "tools empty array", mutate: (m) => ({ ...m, tools: [] }) },
    { name: "autoEvaluate not boolean", mutate: (m) => ({ ...m, autoEvaluate: 1 }) },
    { name: "tokenBudget zero", mutate: (m) => ({ ...m, tokenBudget: 0 }) },
    { name: "tokenBudget not number", mutate: (m) => ({ ...m, tokenBudget: "lots" }) },
    { name: "promptLockedZones not array", mutate: (m) => ({ ...m, promptLockedZones: "safety" }) },
    { name: "surface missing required field", mutate: (m) => ({
        ...m,
        surface: { id: "x", label: "X", icon: "x", route: "/x", component: "ui/X.tsx" /* no order */ },
      }) },
  ];

  for (const c of validatorBadCases) {
    await test(`reject: ${c.name}`, async () => {
      const tmp = setupTmp();
      try {
        _resetSkillRegistryForTests();
        const m = c.mutate(validManifest("good_id"));
        writeSkill(tmp, "bad_skill", {
          manifest: m,
          prompt: VALID_PROMPT,
          context: VALID_CONTEXT,
          handlers: VALID_HANDLERS,
        });
        const reg = await loadSkillRegistry({ skillsDir: tmp });
        // The manifest's id may or may not be valid; check that NO skill was loaded.
        assert.strictEqual(reg.getAllSkills().length, 0, "bad manifest should produce empty registry");
      } finally {
        teardownTmp(tmp);
      }
    });
  }

  // Locked-zone parser edge cases

  section("Locked-zone parser — malformed cases");

  await test("unterminated locked zone (no closing tag) → zone not registered, declared zone check fails", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "unterminated", {
        manifest: validManifest("unterminated", { promptLockedZones: ["x"] }),
        prompt: "<!-- LOCKED:x -->\ncontent without closing\n",
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("unterminated"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("two LOCKED blocks with the same name → loader rejects skill", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "dup_zone_name", {
        manifest: validManifest("dup_zone_name", { promptLockedZones: ["x"] }),
        prompt: "<!-- LOCKED:x -->one<!-- /LOCKED -->\n<!-- LOCKED:x -->two<!-- /LOCKED -->",
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("dup_zone_name"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  await test("LOCKED block present but not declared in manifest → still loads (extra zones allowed)", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "extra_zone", {
        manifest: validManifest("extra_zone", { promptLockedZones: [] }),
        prompt: "<!-- LOCKED:bonus -->extra protected stuff<!-- /LOCKED -->",
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS,
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      const s = reg.getSkill("extra_zone");
      assert.ok(s, "skill should load — manifest doesn't have to declare every zone");
      // The bonus zone is parsed and queryable, just not asserted by manifest.
      assert.ok(s!.lockedZones.has("bonus"));
    } finally {
      teardownTmp(tmp);
    }
  });

  // Reserved-route exposure

  section("Reserved routes");

  await test("RESERVED_ROUTES is a non-empty set", () => {
    assert.ok(RESERVED_ROUTES.size > 0);
    assert.ok(RESERVED_ROUTES.has("/chat"));
  });

  // Handler/manifest contract

  section("Handler ↔ manifest tools cross-check");

  await test("handlers.ts missing a function listed in manifest.tools → rejected", async () => {
    const tmp = setupTmp();
    try {
      _resetSkillRegistryForTests();
      writeSkill(tmp, "missing_handler", {
        manifest: validManifest("missing_handler", { tools: ["doThing", "doOther"] }),
        prompt: VALID_PROMPT,
        context: VALID_CONTEXT,
        handlers: VALID_HANDLERS, // exports doThing only
      });
      const reg = await loadSkillRegistry({ skillsDir: tmp });
      assert.strictEqual(reg.getSkill("missing_handler"), null);
    } finally {
      teardownTmp(tmp);
    }
  });

  // ─── Summary ─────────────────────────────────────────────────────────────

  // Output format must match the regex used by scripts/run-tests.js
  // (`/(\d+)\s+passed,?\s*(\d+)\s+failed/`) so the central runner picks it up.
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
