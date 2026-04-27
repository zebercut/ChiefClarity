/**
 * FEAT054 — Skill Registry types.
 *
 * These are the public-API stability contracts consumed by:
 *   - FEAT051 Orchestrator (findSkillsByEmbedding)
 *   - FEAT079/080/081 Skill migrations (manifest authors)
 *   - FEAT083 Topics skill (surface field)
 *   - FEAT072 Companion skill (model object form, promptLockedZones, minModelTier)
 *   - FEAT058 Locked-zone enforcement (lockedZones map, hashes)
 *   - FEAT070 Self-test on patch approval (lockedZones hashes for integrity check)
 *
 * Breaking changes here ripple to all of the above.
 */

/**
 * Forward-declared placeholders. These shapes will grow as the skill system
 * matures (FEAT080/081 add real fields per migrated intent; FEAT051 wires the
 * orchestrator to consume them). For FEAT054 we only need them as opaque
 * types so the registry compiles.
 */
export interface ContextRequirements {
  [key: string]: unknown;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: Record<string, unknown>
) => Promise<unknown>;

export type ModelTier = "haiku" | "sonnet";

export type SkillModel =
  | ModelTier
  | { default: ModelTier; deep: ModelTier };

export interface SkillSurface {
  /** Unique surface id; usually matches the skill id. */
  id: string;
  /** Display label in the navigation. */
  label: string;
  /** Icon name from the app's icon set, or an emoji. */
  icon: string;
  /**
   * App route (e.g. "/topics"). Exposed exactly as declared — no namespace
   * prefix. Skill authors must avoid colliding with shell-owned routes
   * (see RESERVED_ROUTES in skillRegistry.ts).
   */
  route: string;
  /**
   * Path to the React component, relative to the skill folder
   * (e.g. "ui/TopicsView.tsx").
   */
  component: string;
  /** Sort order in the navigation (lower first). */
  order: number;
}

export interface SkillManifest {
  /** snake_case, ^[a-z][a-z0-9_]{2,40}$ */
  id: string;
  /** semver */
  version: string;
  /** 1-2 sentences. Used for embedding-based routing. */
  description: string;
  /** Natural-language seeds (5-10) for embedding match. */
  triggerPhrases: string[];
  /** Slash commands or button events that directly activate this skill. */
  structuralTriggers: string[];
  /** Single tier or { default, deep } for tier-split skills (see Companion). */
  model: SkillModel;
  /** When model is an object, how to pick the tier (currently only "tool-arg"). */
  modelSelector?: "tool-arg";
  /**
   * Minimum tier the Evaluator may propose. Prevents auto-downgrade for
   * safety-bearing skills. Null means no floor.
   */
  minModelTier?: ModelTier | null;
  /** References categories defined in data_schemas.json (FEAT055, Phase 3). */
  dataSchemas: { read: string[]; write: string[] };
  supportsAttachments: boolean;
  /** Tool ids; must match exports in handlers.ts. */
  tools: string[];
  autoEvaluate: boolean;
  tokenBudget: number;
  /**
   * Names of <!-- LOCKED:<name> --> blocks declared in prompt.md.
   * Loader rejects the skill if a declared zone is missing from the prompt.
   * Each found zone is hashed (sha256 of its inner content, no leading/trailing
   * whitespace trim) for the FEAT070 post-apply integrity check.
   */
  promptLockedZones: string[];
  /** Optional UI surface contributed by this skill. */
  surface: SkillSurface | null;
}

export interface LockedZone {
  /** Character offset of the opening <!-- LOCKED: --> tag in prompt.md. */
  start: number;
  /** Character offset just after the closing <!-- /LOCKED --> tag. */
  end: number;
  /**
   * sha256 hex digest of the inner content (between opening and closing tags,
   * exact bytes — no whitespace trim). Format pinned by FEAT054 design review §5
   * for compatibility with FEAT058 / FEAT070.
   */
  hash: string;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  /** Raw markdown (whole file). */
  prompt: string;
  /** Map of zone name → location + hash. */
  lockedZones: Map<string, LockedZone>;
  /** Default export of context.ts. */
  contextRequirements: ContextRequirements;
  /** Named exports of handlers.ts that match manifest.tools. */
  handlers: Record<string, ToolHandler>;
  /**
   * Description embedding. Null means embedding hasn't been computed yet
   * (lazy on first findSkillsByEmbedding call) — happens on platforms where
   * the embedder isn't available at boot.
   */
  descriptionEmbedding: Float32Array | null;
}

export interface SkillRegistryAPI {
  getSkill(id: string): LoadedSkill | null;
  getAllSkills(): LoadedSkill[];
  /**
   * Returns top-K skills by cosine similarity of their description embeddings
   * to the provided phrase embedding. Empty array if registry is empty.
   * Skills with null descriptionEmbedding are skipped (logged as warning).
   */
  findSkillsByEmbedding(
    phraseEmbedding: Float32Array,
    topK: number
  ): Array<{ skillId: string; score: number }>;
  /** Surfaces declared by skills, sorted by their `order` field. */
  getAllSurfaces(): SkillSurface[];
}

export interface SkillBootReport {
  /** ISO timestamp. */
  ts: string;
  loaded: Array<{ id: string; version: string; surface: boolean }>;
  rejected: Array<{ folder: string; reason: string }>;
  /** Total time spent in loadSkillRegistry, ms. */
  totalMs: number;
}

export interface LoadSkillRegistryOptions {
  /** Default: "src/skills". Tests pass an override pointing at fixtures. */
  skillsDir?: string;
  /** Default: "src/skills/.embedding_cache.json". */
  cachePath?: string;
  /** When set, the loader writes a JSON boot report to this absolute path. */
  bootReportPath?: string;
}
