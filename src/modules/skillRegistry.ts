/**
 * FEAT054 — Skill folder loader and validator.
 * FEAT064 — Dual-loader: web/mobile + Node default read the build-time
 * SKILL_BUNDLE; LIFEOS_SKILL_LIVE_RELOAD=1 re-enables fs.readdirSync on Node
 * for skill-author live editing.
 *
 * Discovers skills, validates manifests, parses locked safety zones, and
 * exposes a registry API consumed by the Orchestrator (FEAT051) and the app
 * shell.
 *
 * Boot is sequential by design (see FEAT054 design review §3.1) — the boot
 * report is easier to read and the cache means warm boot is fast anyway.
 */

// IMPORTANT: do NOT add top-level imports for `fs`, `path`, or `crypto`.
// This module loads in the web/Capacitor bundle, and the React Native /
// browser runtime has no `fs`. Lazy-require Node-only modules inside the
// live-reload branch.
import { isNode } from "../utils/platform";
import { sha256Hex } from "../utils/sha256";
import { SKILL_BUNDLE } from "../skills/_generated/skillBundle";

type FsLike = typeof import("fs");
type PathLike = typeof import("path");

function nodeFs(): FsLike { const dynRequire: NodeRequire = eval("require"); return dynRequire("fs"); }
function nodePath(): PathLike { const dynRequire: NodeRequire = eval("require"); return dynRequire("path"); }
import type {
  ContextRequirements,
  LoadSkillRegistryOptions,
  LoadedSkill,
  LockedZone,
  ModelTier,
  SkillBootReport,
  SkillManifest,
  SkillRegistryAPI,
  SkillSurface,
  SkillTool,
  ToolHandler,
} from "../types/skills";

const DEFAULT_SKILLS_DIR = "src/skills";
const DEFAULT_CACHE_FILENAME = ".embedding_cache.json";

/**
 * Routes the app shell owns. A skill that declares one of these as its surface
 * route is rejected. Update this list when the shell adds a top-level route.
 */
export const RESERVED_ROUTES: ReadonlySet<string> = new Set([
  "/chat",
  "/tasks",
  "/notes",
  "/topics",
  "/focus",
  "/settings",
  "/setup",
  "/recovery",
  "/auth",
  "/pending-improvements",
]);

const ID_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
/**
 * Surface routes: must start with `/`, then one or more segments of
 * lowercase letters, digits, hyphens or underscores. No `..`, no scheme,
 * no double slash. Prevents path traversal and javascript:/data: routes.
 */
const SURFACE_ROUTE_PATTERN = /^(?:\/[a-z0-9_-]+)+\/?$/;
const LOCKED_ZONE_PATTERN =
  /<!--\s*LOCKED:([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:[^>]*?)-->([\s\S]*?)<!--\s*\/LOCKED\s*-->/g;

// Module-level singleton — loadSkillRegistry is idempotent.
let _registry: SkillRegistryAPI | null = null;
let _loading: Promise<SkillRegistryAPI> | null = null;

interface CacheEntry {
  manifestMtimeMs: number;
  embedding: number[];
}
type CacheFile = Record<string, CacheEntry>;

/**
 * Load (or return cached) skill registry. Idempotent — safe to call from
 * multiple entry points (app shell, headless runner, tests with overrides).
 *
 * Tests should pass `skillsDir` to point at a fixtures folder under
 * src/skills/_examples/ (the underscore prefix means production scans skip it).
 */
export async function loadSkillRegistry(
  opts: LoadSkillRegistryOptions = {}
): Promise<SkillRegistryAPI> {
  // Tests can opt out of singleton behavior by passing a custom skillsDir.
  const useSingleton = !opts.skillsDir;
  if (useSingleton && _registry) return _registry;
  if (useSingleton && _loading) return _loading;

  const promise = doLoad(opts);
  if (useSingleton) {
    _loading = promise;
    promise.then((r) => {
      _registry = r;
      _loading = null;
    }).catch(() => {
      _loading = null;
    });
  }
  return promise;
}

/** Test-only: reset the singleton between tests. */
export function _resetSkillRegistryForTests(): void {
  _registry = null;
  _loading = null;
}

/** Synchronous accessor for callers that know the registry has loaded. */
export function getSkillRegistry(): SkillRegistryAPI | null {
  return _registry;
}

async function doLoad(opts: LoadSkillRegistryOptions): Promise<SkillRegistryAPI> {
  const t0 = Date.now();

  // Tests pass an explicit skillsDir (fixture folder) — those always go
  // through the fs path so they exercise the validator on synthetic skills.
  // Production reads the bundle by default; LIFEOS_SKILL_LIVE_RELOAD=1 on Node
  // re-enables the fs walk for skill-author live editing.
  const liveReload =
    isNode() &&
    typeof process !== "undefined" &&
    process.env?.LIFEOS_SKILL_LIVE_RELOAD === "1";
  const useFsPath = !!opts.skillsDir || liveReload;

  if (!useFsPath) {
    return loadFromBundle(t0, opts);
  }
  return loadFromFs(t0, opts);
}

async function loadFromBundle(
  t0: number,
  opts: LoadSkillRegistryOptions
): Promise<SkillRegistryAPI> {
  const loaded: LoadedSkill[] = [];
  const rejected: SkillBootReport["rejected"] = [];
  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();

  const ids = Object.keys(SKILL_BUNDLE).sort();
  for (const id of ids) {
    const entry = SKILL_BUNDLE[id];
    try {
      const skill = await buildSkillFromBundle(id, entry);
      if (seenIds.has(skill.manifest.id)) {
        const reason = `duplicate id "${skill.manifest.id}" — first-seen wins (alphabetical), rejecting "${id}"`;
        rejected.push({ folder: id, reason });
        console.warn(`[skillRegistry] rejected ${id}: ${reason}`);
        continue;
      }
      if (skill.manifest.surface && seenRoutes.has(skill.manifest.surface.route)) {
        const reason = `duplicate surface.route "${skill.manifest.surface.route}" — first-seen wins (alphabetical), rejecting "${id}"`;
        rejected.push({ folder: id, reason });
        console.warn(`[skillRegistry] rejected ${id}: ${reason}`);
        continue;
      }
      seenIds.add(skill.manifest.id);
      if (skill.manifest.surface) seenRoutes.add(skill.manifest.surface.route);
      loaded.push(skill);
      console.log(`[skillRegistry] Loaded skill: ${skill.manifest.id} (v${skill.manifest.version})`);
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      rejected.push({ folder: id, reason });
      console.warn(`[skillRegistry] rejected ${id}: ${reason}`);
    }
  }

  // Embeddings: Node computes from the embedder; web is null and the router
  // falls through to its "phrase embedder unavailable" path.
  if (isNode()) {
    for (const s of loaded) {
      if (s.descriptionEmbedding) continue;
      const emb = await computeEmbedding(s.manifest.description);
      if (emb) {
        // Reassign — LoadedSkill's descriptionEmbedding field is mutable
        // because the registry computes it lazily on Node.
        (s as { descriptionEmbedding: Float32Array | null }).descriptionEmbedding = emb;
      }
    }
  }

  const registry = buildRegistry(loaded);
  const totalMs = Date.now() - t0;
  if (opts.bootReportPath && isNode()) {
    writeBootReport(opts.bootReportPath, loaded, rejected, totalMs);
  }
  return registry;
}

async function buildSkillFromBundle(folderName: string, entry: typeof SKILL_BUNDLE[string]): Promise<LoadedSkill> {
  const manifest = validateManifest(entry.manifest);
  const lockedZones = await parseLockedZones(entry.prompt);
  for (const declared of manifest.promptLockedZones) {
    if (!lockedZones.has(declared)) {
      throw new Error(
        `manifest declares promptLockedZones=["${declared}"] but prompt.md ` +
        `is missing the matching <!-- LOCKED:${declared} --> block`
      );
    }
  }
  if (manifest.surface) {
    if (!SURFACE_ROUTE_PATTERN.test(manifest.surface.route)) {
      throw new Error(
        `surface.route "${manifest.surface.route}" must match ${SURFACE_ROUTE_PATTERN}`
      );
    }
    if (RESERVED_ROUTES.has(manifest.surface.route)) {
      throw new Error(
        `surface.route "${manifest.surface.route}" is shell-owned (RESERVED_ROUTES)`
      );
    }
  }
  const ctx = entry.context as any;
  const contextRequirements: ContextRequirements =
    ctx?.contextRequirements ?? ctx?.default ?? {};

  const handlersModule = entry.handlers as Record<string, unknown>;
  const handlers: Record<string, ToolHandler> = {};
  for (const toolName of manifest.tools) {
    const handler = handlersModule[toolName];
    if (typeof handler !== "function") {
      throw new Error(
        `manifest.tools includes "${toolName}" but handlers has no matching exported function (folder "${folderName}")`
      );
    }
    handlers[toolName] = handler as ToolHandler;
  }

  // FEAT065 — `import * as <skill>Handlers` surfaces every named export from
  // handlers.ts including the `toolSchemas` constant. Default to {} when the
  // export is absent; the dispatcher's WARN fallback handles that case.
  const toolSchemas = readToolSchemas(handlersModule);

  // FEAT067 — Skill description embeddings are pre-computed at bundle time
  // and shipped in SKILL_BUNDLE for both web and Node default loads. The
  // runtime compute fallback below (in loadFromBundle) only fires when an
  // older bundle without the field is in play (defensive — the field is now
  // mandatory in the generated bundle).
  let descriptionEmbedding: Float32Array | null = null;
  const bundleEmbedding = (entry as { descriptionEmbedding?: ReadonlyArray<number> }).descriptionEmbedding;
  if (bundleEmbedding && Array.isArray(bundleEmbedding) && bundleEmbedding.length === 384) {
    descriptionEmbedding = new Float32Array(bundleEmbedding);
  }

  return {
    manifest,
    prompt: entry.prompt,
    lockedZones,
    contextRequirements,
    handlers,
    toolSchemas,
    descriptionEmbedding,
  };
}

function readToolSchemas(handlersModule: Record<string, unknown>): Record<string, SkillTool> {
  const raw = (handlersModule as { toolSchemas?: unknown }).toolSchemas;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, SkillTool>;
  }
  return {};
}

async function loadFromFs(t0: number, opts: LoadSkillRegistryOptions): Promise<SkillRegistryAPI> {
  const loaded: LoadedSkill[] = [];
  const rejected: SkillBootReport["rejected"] = [];

  if (!isNode()) {
    console.warn(
      "[skillRegistry] non-Node platform — fs path requested but unavailable; using bundle"
    );
    return loadFromBundle(t0, opts);
  }

  const fs = nodeFs();
  const path = nodePath();
  const skillsDir = opts.skillsDir ?? DEFAULT_SKILLS_DIR;
  const cachePath =
    opts.cachePath ?? path.join(skillsDir, DEFAULT_CACHE_FILENAME);

  if (!fs.existsSync(skillsDir)) {
    console.warn(`[skillRegistry] skills dir not found: ${skillsDir}`);
    const empty = buildRegistry(loaded);
    if (opts.bootReportPath) {
      writeBootReport(opts.bootReportPath, loaded, rejected, Date.now() - t0);
    }
    return empty;
  }

  const cache = readCache(cachePath);
  // Rebuild cacheUpdates from scratch each boot so entries for removed
  // skill folders don't accumulate. Whether to write back is decided by
  // comparing the rebuilt set to the on-disk file.
  const cacheUpdates: CacheFile = {};

  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();
  const folders = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort(); // deterministic order — duplicate-id rejection is alphabetical

  for (const folderName of folders) {
    const folderPath = path.join(skillsDir, folderName);
    try {
      const skill = await loadOneSkill(folderPath, folderName, cache, cacheUpdates);

      if (seenIds.has(skill.manifest.id)) {
        const reason = `duplicate id "${skill.manifest.id}" — first-seen folder wins (alphabetical), rejecting "${folderName}"`;
        rejected.push({ folder: folderName, reason });
        console.warn(`[skillRegistry] rejected ${folderName}: ${reason}`);
        continue;
      }
      if (skill.manifest.surface && seenRoutes.has(skill.manifest.surface.route)) {
        const reason = `duplicate surface.route "${skill.manifest.surface.route}" — first-seen folder wins (alphabetical), rejecting "${folderName}"`;
        rejected.push({ folder: folderName, reason });
        console.warn(`[skillRegistry] rejected ${folderName}: ${reason}`);
        continue;
      }
      seenIds.add(skill.manifest.id);
      if (skill.manifest.surface) seenRoutes.add(skill.manifest.surface.route);
      loaded.push(skill);

      if (skill.descriptionEmbedding) {
        const stat = fs.statSync(path.join(folderPath, "manifest.json"));
        cacheUpdates[skill.manifest.id] = {
          manifestMtimeMs: stat.mtimeMs,
          embedding: Array.from(skill.descriptionEmbedding),
        };
      }

      console.log(`[skillRegistry] Loaded skill: ${skill.manifest.id} (v${skill.manifest.version})`);
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      rejected.push({ folder: folderName, reason });
      console.warn(`[skillRegistry] rejected ${folderName}: ${reason}`);
    }
  }

  if (!cachesEqual(cache, cacheUpdates)) {
    writeCache(cachePath, cacheUpdates);
  }

  const registry = buildRegistry(loaded);
  const totalMs = Date.now() - t0;

  if (opts.bootReportPath) {
    writeBootReport(opts.bootReportPath, loaded, rejected, totalMs);
  }

  return registry;
}

async function loadOneSkill(
  folderPath: string,
  folderName: string,
  cache: CacheFile,
  cacheUpdates: CacheFile
): Promise<LoadedSkill> {
  // Caller (doLoad) only invokes this after the isNode() gate, so requiring
  // here is safe.
  const fs = nodeFs();
  const path = nodePath();
  const manifestPath = path.join(folderPath, "manifest.json");
  const promptPath = path.join(folderPath, "prompt.md");
  const contextPath = path.join(folderPath, "context.ts");
  const handlersPath = path.join(folderPath, "handlers.ts");

  for (const [name, p] of [
    ["manifest.json", manifestPath],
    ["prompt.md", promptPath],
    ["context.ts", contextPath],
    ["handlers.ts", handlersPath],
  ] as const) {
    if (!fs.existsSync(p)) {
      throw new Error(`missing required file ${name}`);
    }
  }

  // Manifest
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err: any) {
    throw new Error(`malformed manifest.json: ${err?.message ?? err}`);
  }
  const manifest = validateManifest(manifestRaw);

  // Prompt + locked zones
  const prompt = fs.readFileSync(promptPath, "utf-8");
  const lockedZones = await parseLockedZones(prompt);
  for (const declared of manifest.promptLockedZones) {
    if (!lockedZones.has(declared)) {
      throw new Error(
        `manifest declares promptLockedZones=["${declared}"] but prompt.md ` +
        `is missing the matching <!-- LOCKED:${declared} --> block`
      );
    }
  }

  // Surface validation
  if (manifest.surface) {
    if (!SURFACE_ROUTE_PATTERN.test(manifest.surface.route)) {
      throw new Error(
        `surface.route "${manifest.surface.route}" must match ${SURFACE_ROUTE_PATTERN} ` +
        `(starts with "/", lowercase letters/digits/hyphens, no traversal or scheme)`
      );
    }
    if (RESERVED_ROUTES.has(manifest.surface.route)) {
      throw new Error(
        `surface.route "${manifest.surface.route}" is shell-owned (RESERVED_ROUTES) — ` +
        `pick a different route`
      );
    }
  }

  // Dynamic loading. Use Node `require` rather than `import()` because
  // Metro disallows dynamic `import()` with a runtime-computed path (it
  // can't statically analyze the bundle). This module is gated by isNode()
  // upstream, so the require() runs only in the Node runtime where it's
  // supported. Wrapping in (() => require())() keeps Metro from trying to
  // resolve the path at bundle time.
  let contextModule: any;
  let handlersModule: any;
  const dynRequire: NodeRequire = eval("require");
  try {
    contextModule = dynRequire(path.resolve(contextPath));
  } catch (err: any) {
    throw new Error(`context.ts import failed: ${err?.message ?? err}`);
  }
  try {
    handlersModule = dynRequire(path.resolve(handlersPath));
  } catch (err: any) {
    throw new Error(`handlers.ts import failed: ${err?.message ?? err}`);
  }

  const contextRequirements: ContextRequirements =
    contextModule.contextRequirements ?? contextModule.default ?? {};

  const handlers: Record<string, ToolHandler> = {};
  for (const toolName of manifest.tools) {
    const handler = handlersModule[toolName];
    if (typeof handler !== "function") {
      throw new Error(
        `manifest.tools includes "${toolName}" but handlers.ts has no matching exported function`
      );
    }
    handlers[toolName] = handler;
  }

  // FEAT065 — pull `toolSchemas` named export off the handlers module if it
  // exists. Default to {} so the dispatcher WARN fallback catches missing.
  const toolSchemas = readToolSchemas(handlersModule);

  // Embedding — try cache first, then compute
  let descriptionEmbedding: Float32Array | null = null;
  const stat = fs.statSync(manifestPath);
  const cached = cache[manifest.id];
  if (cached && cached.manifestMtimeMs === stat.mtimeMs) {
    descriptionEmbedding = new Float32Array(cached.embedding);
  } else {
    descriptionEmbedding = await computeEmbedding(manifest.description);
    // Note: cache write happens in the caller (doLoad) so all updates batch.
  }

  return {
    manifest,
    prompt,
    lockedZones,
    contextRequirements,
    handlers,
    toolSchemas,
    descriptionEmbedding,
  };
}

// ─── Manifest validation ────────────────────────────────────────────────────
//
// Hand-rolled validator (no Ajv/zod dependency for v2.01). Each branch throws
// with a precise message so the loader's rejection log names the field.

function validateManifest(raw: unknown): SkillManifest {
  if (!isObject(raw)) throw new Error("manifest must be an object");
  const r = raw as Record<string, unknown>;

  expectString(r, "id");
  if (!ID_PATTERN.test(r.id as string)) {
    throw new Error(
      `manifest.id "${r.id}" must match ${ID_PATTERN} (lowercase, snake_case, 3-41 chars)`
    );
  }
  expectString(r, "version");
  if (!SEMVER_PATTERN.test(r.version as string)) {
    throw new Error(`manifest.version "${r.version}" must be semver (e.g. "1.0.0")`);
  }
  expectString(r, "description");
  expectStringArray(r, "triggerPhrases");
  expectStringArray(r, "structuralTriggers");

  // model: string tier or { default, deep }
  const model = r.model;
  if (typeof model === "string") {
    if (model !== "haiku" && model !== "sonnet") {
      throw new Error(`manifest.model "${model}" must be "haiku" or "sonnet"`);
    }
  } else if (isObject(model)) {
    const m = model as Record<string, unknown>;
    if (!isModelTier(m.default) || !isModelTier(m.deep)) {
      throw new Error(`manifest.model object form requires { default, deep } as "haiku" | "sonnet"`);
    }
  } else {
    throw new Error(`manifest.model must be a tier string or { default, deep } object`);
  }

  if (r.modelSelector !== undefined && r.modelSelector !== "tool-arg") {
    throw new Error(`manifest.modelSelector, if present, must be "tool-arg"`);
  }
  if (r.minModelTier !== undefined && r.minModelTier !== null && !isModelTier(r.minModelTier)) {
    throw new Error(`manifest.minModelTier, if present, must be "haiku" | "sonnet" | null`);
  }

  if (!isObject(r.dataSchemas)) throw new Error("manifest.dataSchemas must be an object");
  const ds = r.dataSchemas as Record<string, unknown>;
  expectStringArray(ds, "read", "dataSchemas.");
  expectStringArray(ds, "write", "dataSchemas.");

  if (typeof r.supportsAttachments !== "boolean") {
    throw new Error("manifest.supportsAttachments must be boolean");
  }

  expectStringArray(r, "tools");
  if ((r.tools as string[]).length === 0) {
    throw new Error("manifest.tools must list at least one tool");
  }

  if (typeof r.autoEvaluate !== "boolean") {
    throw new Error("manifest.autoEvaluate must be boolean");
  }
  if (typeof r.tokenBudget !== "number" || r.tokenBudget <= 0) {
    throw new Error("manifest.tokenBudget must be a positive number");
  }

  expectStringArray(r, "promptLockedZones");

  // surface — null or full SkillSurface
  let surface: SkillSurface | null = null;
  if (r.surface !== null && r.surface !== undefined) {
    if (!isObject(r.surface)) throw new Error("manifest.surface must be an object or null");
    const s = r.surface as Record<string, unknown>;
    expectString(s, "id", "surface.");
    expectString(s, "label", "surface.");
    expectString(s, "icon", "surface.");
    expectString(s, "route", "surface.");
    expectString(s, "component", "surface.");
    if (typeof s.order !== "number") throw new Error("manifest.surface.order must be a number");
    surface = {
      id: s.id as string,
      label: s.label as string,
      icon: s.icon as string,
      route: s.route as string,
      component: s.component as string,
      order: s.order,
    };
  }

  // FEAT068 — Pass through `retrievalHook` if present. Shape validation
  // happens at dispatch time (`skillDispatcher.validateRetrievalHook`):
  // bad shapes WARN once and degrade to "no retrieval" rather than
  // failing manifest load. Keeping the validation downstream means a
  // misconfigured `retrievalHook` doesn't take the whole skill offline.
  const retrievalHook = r.retrievalHook;

  return {
    id: r.id as string,
    version: r.version as string,
    description: r.description as string,
    triggerPhrases: r.triggerPhrases as string[],
    structuralTriggers: r.structuralTriggers as string[],
    model: model as SkillManifest["model"],
    modelSelector: r.modelSelector as "tool-arg" | undefined,
    minModelTier: (r.minModelTier ?? null) as ModelTier | null,
    dataSchemas: {
      read: ds.read as string[],
      write: ds.write as string[],
    },
    supportsAttachments: r.supportsAttachments,
    tools: r.tools as string[],
    autoEvaluate: r.autoEvaluate,
    tokenBudget: r.tokenBudget,
    promptLockedZones: r.promptLockedZones as string[],
    surface,
    ...(retrievalHook !== undefined ? { retrievalHook: retrievalHook as SkillManifest["retrievalHook"] } : {}),
  };
}

function isObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isModelTier(v: unknown): v is ModelTier {
  return v === "haiku" || v === "sonnet";
}

function expectString(o: Record<string, unknown>, field: string, prefix = "manifest."): void {
  if (typeof o[field] !== "string" || (o[field] as string).length === 0) {
    throw new Error(`${prefix}${field} must be a non-empty string`);
  }
}

function expectStringArray(
  o: Record<string, unknown>,
  field: string,
  prefix = "manifest."
): void {
  const v = o[field];
  if (!Array.isArray(v)) throw new Error(`${prefix}${field} must be an array of strings`);
  for (const item of v) {
    if (typeof item !== "string") throw new Error(`${prefix}${field} contains a non-string item`);
  }
}

// ─── Locked-zone parsing ────────────────────────────────────────────────────
//
// Pinned format per FEAT054 design review §5 for FEAT058/FEAT070 compatibility:
//   <!-- LOCKED:<name> ...optional comment text... --> ...content... <!-- /LOCKED -->
// Hash = sha256 hex of the inner content (between opening and closing tags),
// exact bytes — no whitespace trim. Changing this format breaks the auto-patcher
// integrity check.

async function parseLockedZones(prompt: string): Promise<Map<string, LockedZone>> {
  const zones = new Map<string, LockedZone>();
  // Reset regex state defensively (global regexes preserve lastIndex).
  LOCKED_ZONE_PATTERN.lastIndex = 0;
  // Collect first, hash second so async hashing doesn't fight the global regex.
  const matches: Array<{ name: string; content: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = LOCKED_ZONE_PATTERN.exec(prompt)) !== null) {
    const [full, name, content] = m;
    if (zones.has(name) || matches.some((x) => x.name === name)) {
      throw new Error(`duplicate locked zone name "${name}" in prompt.md`);
    }
    matches.push({
      name,
      content,
      start: m.index,
      end: m.index + full.length,
    });
    // Mark seen so the duplicate check above triggers across the loop.
    zones.set(name, { start: 0, end: 0, hash: "" });
  }
  zones.clear();
  for (const x of matches) {
    const hash = await sha256Hex(x.content);
    zones.set(x.name, { start: x.start, end: x.end, hash });
  }
  return zones;
}

// ─── Embedding cache ────────────────────────────────────────────────────────

function readCache(cachePath: string): CacheFile {
  const fs = nodeFs();
  try {
    if (!fs.existsSync(cachePath)) return {};
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    return parsed as CacheFile;
  } catch (err: any) {
    console.warn(`[skillRegistry] cache file unreadable, rebuilding: ${err?.message}`);
    return {};
  }
}

function cachesEqual(a: CacheFile, b: CacheFile): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!(k in b)) return false;
    if (a[k].manifestMtimeMs !== b[k].manifestMtimeMs) return false;
    // Embedding bytes assumed unchanged when mtime matches; skip element compare.
  }
  return true;
}

function writeCache(cachePath: string, cache: CacheFile): void {
  const fs = nodeFs();
  try {
    const tmp = cachePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmp, cachePath);
  } catch (err: any) {
    console.warn(`[skillRegistry] cache write failed (non-fatal): ${err?.message}`);
  }
}

async function computeEmbedding(text: string): Promise<Float32Array | null> {
  try {
    // Lazy import — embedder is Node-only and may not be available everywhere.
    const { embed } = await import("./embeddings/provider");
    return await embed(text);
  } catch (err: any) {
    console.warn(`[skillRegistry] embedder unavailable, skipping: ${err?.message}`);
    return null;
  }
}

// ─── Boot report ────────────────────────────────────────────────────────────

function writeBootReport(
  reportPath: string,
  loaded: LoadedSkill[],
  rejected: SkillBootReport["rejected"],
  totalMs: number
): void {
  const fs = nodeFs();
  const report: SkillBootReport = {
    ts: new Date().toISOString(),
    loaded: loaded.map((s) => ({
      id: s.manifest.id,
      version: s.manifest.version,
      surface: s.manifest.surface !== null,
    })),
    rejected,
    totalMs,
  };
  try {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  } catch (err: any) {
    console.warn(`[skillRegistry] boot report write failed (non-fatal): ${err?.message}`);
  }
}

// ─── Registry API ───────────────────────────────────────────────────────────

function buildRegistry(loaded: LoadedSkill[]): SkillRegistryAPI {
  const byId = new Map<string, LoadedSkill>();
  for (const s of loaded) byId.set(s.manifest.id, s);

  return {
    getSkill(id: string): LoadedSkill | null {
      return byId.get(id) ?? null;
    },
    getAllSkills(): LoadedSkill[] {
      return Array.from(byId.values());
    },
    findSkillsByEmbedding(
      phraseEmbedding: Float32Array,
      topK: number
    ): Array<{ skillId: string; score: number }> {
      if (loaded.length === 0 || topK <= 0) return [];
      const scored: Array<{ skillId: string; score: number }> = [];
      for (const s of loaded) {
        if (!s.descriptionEmbedding) {
          // Logged only once per skill to avoid log spam under repeated calls.
          continue;
        }
        const score = cosineSimilarity(phraseEmbedding, s.descriptionEmbedding);
        scored.push({ skillId: s.manifest.id, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    },
    getAllSurfaces(): SkillSurface[] {
      const surfaces: SkillSurface[] = [];
      for (const s of loaded) {
        if (s.manifest.surface) surfaces.push(s.manifest.surface);
      }
      surfaces.sort((a, b) => a.order - b.order);
      return surfaces;
    },
  };
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    // Length mismatch usually means a cached embedding was generated by a
    // different embedder version. Caller should invalidate the cache.
    console.warn(
      `[skillRegistry] embedding dimension mismatch: ${a.length} vs ${b.length} ` +
      `— consider deleting src/skills/.embedding_cache.json to force re-embed`
    );
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
