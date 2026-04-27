# FEAT054 — Skill folder loader and validator

**Type:** feature
**Status:** Draft (awaiting human review — workflow stage 2)
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.01 (Phase 1 anchor)
**Tags:** skills, registry, loader, validator, surfaces
**Created:** 2026-04-27

**Architecture reference:** `docs/v4/02_skill_registry.md` §2, §8, §9, §10
**Related FEATs:** FEAT050 (subsumed — flat-data skill model replaced by folders), FEAT051 (rescoped Orchestrator depends on this), FEAT079 (POC skill that proves the loader)

---

## Status

Approved by user 2026-04-27 — workflow stages 3–4 (architect) next.

**Stage 2 review notes:**
- Open Question 5 (surface routing) resolved: no namespacing, reserved-route
  list. Story 4 AC #4 updated accordingly.
- Open Questions 1, 3, 6 deferred to architect.
- All other content approved.

---

## Problem Statement

Today, adding a new domain capability (financial advice, parenting coaching,
research helper, etc.) requires editing 4+ shared core files: `router.ts`
(regex pattern), `assembler.ts` (per-intent switch case), `llm.ts` (model
mapping), `executor.ts` (write handlers). The system is closed at the edge —
only a developer with full architectural understanding can extend it without
breaking existing flows. Every new domain costs hours of integration work,
and a mistake in the router or assembler can silently misroute existing
intents.

The blocker for v2 is that we cannot ship the privacy filter, the proactive
sensors, the topics work, the companion safety zones, or anything else that
depends on per-skill manifests until skills exist as first-class objects.

This feature is the foundation. Once skills are folders that the system
discovers at boot, every other v2 feature can be built against a stable skill
contract.

---

## Goals

- A new skill is a folder. Adding it requires zero changes to shared core files.
- The skill registry boots cleanly even when individual skills are malformed —
  a bad skill doesn't crash the rest.
- Skills can declare safety-critical prompt sections that are immutable from
  the auto-improvement loop. The loader validates this at boot.
- Skills can optionally contribute a UI tab (surface) without editing the app
  shell.
- Boot time stays acceptable as the skill count grows.

---

## Success Metrics

- **Time to add a new skill** (from "I have an idea" to "it routes correctly"
  in dev environment): under 30 minutes for a CRUD-style skill, under 2 hours
  for a reasoning skill.
- **Boot time impact:** under 200ms for a 20-skill registry on a warm start.
- **Migration enabling:** every router/assembler/llm/executor branch tied to a
  v3 intent has a clear path to deletion once the matching skill ships
  (validated by FEAT079, FEAT080, FEAT081).
- **Zero loader-caused production incidents** in the first 30 days after
  shipping (a malformed skill must not break the app).

---

## User Stories

### Story 1 — Drop-folder skill addition

As a developer, I want to add a new skill by creating a folder and restarting
the app, so that I can extend the assistant without touching shared core files.

**Acceptance Criteria:**
- [ ] Given a new folder `src/skills/<id>/` containing valid `manifest.json`,
      `prompt.md`, `context.ts`, and `handlers.ts`, when the app boots, then
      the skill is registered and a startup log line confirms
      `Loaded skill: <id>`.
- [ ] Given the registered skill, when a user phrase matches one of its
      `triggerPhrases` via embedding similarity above the routing threshold,
      then the orchestrator selects this skill (verifiable in the routing
      log).
- [ ] Given a skill folder missing one of the four required files, when the
      app boots, then the skill is rejected with a startup warning naming the
      skill id and the missing file, but the app continues to boot.

### Story 2 — Boot-safe loader

As a developer, I want one bad skill to not crash the entire registry, so that
I can iterate on a new skill without breaking the existing ones.

**Acceptance Criteria:**
- [ ] Given 5 valid skill folders and 1 invalid (malformed `manifest.json`),
      when the app boots, then all 5 valid skills load and the invalid one is
      logged as a warning (not an error), and the app reaches the chat screen.
- [ ] Given a skill whose `handlers.ts` throws during dynamic import, when
      the app boots, then the skill is rejected with the import error captured
      in the warning, and the app continues without the skill.
- [ ] Given two skill folders that declare the same `id` in their manifests,
      when the app boots, then the second-loaded skill (alphabetical folder
      order) is rejected with a duplicate-id warning, and the first one
      remains registered.

### Story 3 — Locked safety zones

As an architect, I want skill prompts to declare immutable safety zones that
the loader validates at boot, so that the auto-improvement loop cannot strip
safety guardrails after the skill ships.

**Acceptance Criteria:**
- [ ] Given a manifest declaring `promptLockedZones: ["safety_boundary"]` and
      a `prompt.md` containing a matching `<!-- LOCKED:safety_boundary -->...
      <!-- /LOCKED -->` block, when the app boots, then the skill loads
      successfully.
- [ ] Given the same manifest but the `prompt.md` is missing the
      `<!-- LOCKED:safety_boundary -->` block, when the app boots, then the
      skill is rejected with a warning naming the missing zone.
- [ ] Given a manifest with `promptLockedZones: []`, when the app boots, then
      the skill loads successfully (no zones required).
- [ ] Given a manifest declaring two zones and the prompt contains both, when
      the app boots, then the skill loads and both zones are recorded in the
      registry's metadata for the skill (queryable by other modules).

### Story 4 — Declarative UI surfaces

As a developer, I want my skill's manifest to optionally declare a UI tab, so
that the app shell renders the new tab without me editing the shell code.

**Acceptance Criteria:**
- [ ] Given a manifest with a `surface` object containing `id`, `label`,
      `route`, `component`, and `order`, when the app boots, then a tab with
      that label appears in the navigation.
- [ ] Given a manifest with `surface: null` (or missing), when the app boots,
      then no tab is added (the skill exists and is reachable via chat only).
- [ ] Given two skills that both declare surfaces, when the app boots, then
      both tabs appear in the navigation, sorted by their `order` value
      (lower first).
- [ ] Given a skill that declares the route `/topics`, when the user
      navigates to that surface, then the shell exposes the route exactly as
      declared (no namespace prefix). The skill author is responsible for
      picking a route that does not collide with shell-owned routes
      (`/chat`, `/settings`, `/setup`, etc.). The loader rejects any skill
      that declares a route matching a known shell-owned route.

### Story 5 — Boot performance under cache

As a developer, I want skill description embeddings cached at boot, so that
boot time stays acceptable as the skill count grows.

**Acceptance Criteria:**
- [ ] Given 20 skills with unchanged manifests since the last boot, when the
      app boots, then no embedding API/model calls are made for skill
      descriptions (cache reused based on manifest mtime).
- [ ] Given a skill whose `manifest.json` mtime changed since the last boot,
      when the app boots, then the embedding for only that skill is
      re-computed; the other 19 cached embeddings are reused.
- [ ] Given the cache file (location TBD by architect), the file is gitignored
      and never committed to the repository.

### Story 6 — Registry API for downstream consumers

As the orchestrator (FEAT051), I want a query API to find skills relevant to a
phrase, so that I can route phrases without knowing skill internals.

**Acceptance Criteria:**
- [ ] Given the registry loaded with 5 skills, when a caller invokes
      `findSkillsByEmbedding(phraseEmbedding, topK=3)`, then the caller
      receives an array of 3 entries, each with `{ skillId, score }`, sorted
      by score descending.
- [ ] Given an empty registry, when a caller invokes `findSkillsByEmbedding`,
      then the caller receives an empty array (not an error).
- [ ] Given a registry with 5 skills, when a caller invokes
      `getSkill(<unknown_id>)`, then the caller receives `null` (not an
      exception).
- [ ] Given a registry with 2 skills that declared surfaces and 3 that did
      not, when a caller invokes `getAllSurfaces()`, then the caller receives
      exactly 2 surface entries sorted by `order`.

---

## Out of Scope

- **Hot-reload of skills** — restart is required after editing a skill folder.
  A future feature may add a `/reload-skills` admin command.
- **Skill versioning / migration** — `manifest.version` field exists but no
  automated cross-version migration is built in this FEAT.
- **Skill authoring UI** — that is FEAT053 (Phase 9).
- **Per-skill private storage** — all skills read and write through the shared
  `filesystem.ts` and DB layers; no per-skill scratch space.
- **Skill marketplace / installation from external sources** — out of v2 scope
  per `docs/v4/09_dev_plan.md §9`.
- **Migrating any specific intent to a skill** — that work happens in FEAT079
  (POC priority_planning), FEAT080, and FEAT081. This FEAT delivers only the
  loader infrastructure.
- **Locked-zone enforcement in the Evaluator and Pattern Learner** — the
  loader-side validation is here; the auto-improvement-loop elision logic
  ships in FEAT058 (Phase 3).
- **Multi-locale prompts per skill** — single `prompt.md` per skill in v2.01.
- **Cross-skill calls** — explicitly violates ADR-001; never in scope.

---

## Assumptions & Open Questions

**Assumptions:**
- The existing embeddings stack (`src/modules/embeddings/`, FEAT042 Done) is
  reusable for skill description embeddings without modification.
- The app boots from a single entry point that can be extended with a
  registry-load step before the chat surface mounts.
- The React Native / Capacitor shell can render a dynamically-discovered
  surface list (to verify with the architect against current
  `app/_layout.tsx`).
- The existing `feedback-kit` validator pattern (used for feature manifests)
  is a usable template for the skill manifest validator.

**Open Questions for the Architect:**
1. Where should the embedding cache file live? Inside `src/skills/` (close to
   the skills it caches) or in a project-level cache directory (cleaner
   separation)?
2. Should the registry expose a `reload()` method for tests, or do tests
   construct registries from fixtures and not need reload?
3. Should the loader run in parallel for multiple skills (faster boot) or
   sequentially (simpler error handling)? Architect to decide based on N skill
   expectation.
4. How are skill validation errors surfaced to the user vs. only logged for
   the developer? Recommend: developer log only; users never see them.
5. ~~Surface route namespacing~~ — **RESOLVED 2026-04-27 (user)**: routes are
   exposed as declared, with no namespace prefix. The loader maintains a
   reserved-route list (`/chat`, `/settings`, `/setup`, etc.) and rejects any
   skill that collides with one. Architect to decide where the reserved-route
   list lives (constant in `src/skills/registry.ts` vs. config file).
6. Should the loader produce a machine-readable boot report (e.g., JSON
   `boot_report.json`) so other tools can audit which skills loaded? Or only
   console logs?

---

## Architecture Notes

*Filled by Architect agent 2026-04-27 (workflow stage 3). Full design review
in `FEAT054_design-review.md` (workflow stage 4).*

### Data Models

```ts
// src/types/skills.ts

export interface SkillManifest {
  id: string;                    // unique, snake_case, validated against /^[a-z][a-z0-9_]{2,40}$/
  version: string;               // semver
  description: string;           // 1-2 sentences, used for embedding
  triggerPhrases: string[];      // 5-10 natural-language seeds for embedding match
  structuralTriggers: string[];  // slash commands, e.g. ["/plan"]
  model: "haiku" | "sonnet" | { default: ModelTier; deep: ModelTier };
  modelSelector?: "tool-arg";    // when model is an object, how to pick
  minModelTier?: "haiku" | "sonnet" | null;  // evaluator may not propose downgrade
  dataSchemas: { read: string[]; write: string[] };
  supportsAttachments: boolean;
  tools: string[];               // must match handlers.ts exports
  autoEvaluate: boolean;
  tokenBudget: number;
  promptLockedZones: string[];   // names of <!-- LOCKED:<name> --> blocks in prompt.md
  surface: SkillSurface | null;
}

export interface SkillSurface {
  id: string;
  label: string;
  icon: string;                  // icon name from app icon set
  route: string;                 // e.g. "/topics" — exposed as declared (no namespace)
  component: string;             // path inside the skill folder, e.g. "ui/TopicsView.tsx"
  order: number;                 // sort order (lower first)
}

export interface LoadedSkill {
  manifest: SkillManifest;
  prompt: string;                // raw markdown
  lockedZones: Map<string, { start: number; end: number; hash: string }>;
  contextRequirements: ContextRequirements;  // from context.ts default export
  handlers: Record<string, ToolHandler>;     // from handlers.ts exports
  descriptionEmbedding: Float32Array;
}

export type SkillRegistry = {
  getSkill(id: string): LoadedSkill | null;
  getAllSkills(): LoadedSkill[];
  findSkillsByEmbedding(embedding: Float32Array, topK: number): Array<{ skillId: string; score: number }>;
  getAllSurfaces(): SkillSurface[];
};

export interface SkillBootReport {
  ts: string;
  loaded: Array<{ id: string; version: string; surface: boolean }>;
  rejected: Array<{ folder: string; reason: string }>;
  totalMs: number;
}
```

### API Contracts

```ts
// src/modules/skillRegistry.ts

export async function loadSkillRegistry(opts?: {
  skillsDir?: string;            // defaults to "src/skills"
  cachePath?: string;            // defaults to "src/skills/.embedding_cache.json"
  bootReportPath?: string;       // defaults to undefined (no report file)
}): Promise<SkillRegistry>;

// Reserved routes the loader will reject if a skill declares them.
// Constant in src/modules/skillRegistry.ts (Open Question 5 resolution).
export const RESERVED_ROUTES = [
  "/chat", "/settings", "/setup", "/auth", "/pending-improvements"
] as const;
```

### Service Dependencies

| Internal | Used for |
|---|---|
| `src/modules/embeddings/provider.ts` (FEAT042 Done) | Embed each skill description at boot; reuse cached embedding when manifest mtime unchanged |
| `src/utils/filesystem.ts` (existing) | Read manifest, prompt, cache file; never direct `fs` calls |
| `src/types/index.ts` (existing) | Import `ToolHandler`, `ContextRequirements` types |
| `src/db/` (existing) | NOT used by the loader directly — only consumed downstream by skills |

No third-party dependencies added. No new npm packages.

### Design Patterns

- **Plugin-by-folder** (already validated in `featmap` package): scan a directory, validate each entry, register in an in-memory map. Failures logged, never thrown to top.
- **Atomic boot:** `loadSkillRegistry` resolves with a registry that may be partial if some skills failed. The app boots regardless. Per `02_skill_registry.md §8`.
- **Manifest validation = JSON Schema**: hand-rolled in `src/modules/skillRegistry.ts` (no Ajv dependency for v2.01 — simple enough). 5+ test cases per field per `11_v2_design_review.md §5 Phase 1`.
- **Locked-zone parsing**: regex match `/<!--\s*LOCKED:(\w+)\s*-->([\s\S]*?)<!--\s*\/LOCKED\s*-->/g` on `prompt.md`. Each found zone hashed (SHA-256) for the post-apply integrity check (FEAT070, Phase 6). Zones declared in manifest but missing in prompt → skill rejected.
- **Sequential loading** (Open Question 3 resolution): for v2.01 with ≤20 skills, the boot-time gain from parallelism is small (~50ms estimated) and error-handling is much simpler sequential. Switch to parallel only if boot exceeds 200ms target.

### New vs. Reusable Components

**New:**
- `src/modules/skillRegistry.ts` — the loader and registry
- `src/types/skills.ts` — interfaces
- `src/skills/.embedding_cache.json` — gitignored cache file (Open Question 1 resolution: lives inside `src/skills/`, close to the skills it caches; simpler mtime check)
- `src/skills/_examples/` — fixture skills used by tests (folder name starts with `_` so the loader skips them in production scan; tests pass `skillsDir` override)

**Reusable (no changes):**
- `src/modules/embeddings/provider.ts` for the bge-m3 embedder
- `src/utils/filesystem.ts` for atomic read/write

**Touched (small changes):**
- `app/_layout.tsx` — add `getAllSurfaces()` consumer to render dynamic nav tabs
- `package.json` / `.gitignore` — add `src/skills/.embedding_cache.json` to gitignore
- App boot entry (`app/_layout.tsx` or wherever the registry is constructed) — add a `loadSkillRegistry()` call before chat surface mounts

### Risks & Concerns

- **Performance risk on Capacitor mobile** (FEAT044 hold): the embedding step on mobile is ~30-50ms per embedding (per FEAT044 spec). 20 skills × 50ms = 1s on a cold cache. Mitigation: the cache means cold-cache happens once; warm boots are < 50ms total. First-launch experience may need a "preparing skills…" splash for ≥10 skills on mobile.
- **Surface API stability:** once external skills declare surfaces, changing the `SkillSurface` shape becomes a breaking change. The shape is intentionally minimal (5 fields) and matches what app shells in this codebase already render.
- **Reserved-route list drift:** if shell routes are added later without updating `RESERVED_ROUTES`, a skill could collide. Mitigation: add a CI check that grep's `app/` for new top-level routes and fails if they aren't in the list. (Out of scope for this FEAT — flag to architect to track separately.)
- **Locked-zone regex brittleness:** a developer who edits `prompt.md` manually and breaks the comment syntax (e.g., extra whitespace) will fail validation. Mitigation: clear error message naming the zone and showing the expected pattern.
- **Sequential boot blocking:** if a `handlers.ts` import is slow (e.g., does heavy work at module load), it blocks the entire boot. Mitigation: PR review rule — no work at module-load time in `handlers.ts`. Add to `AGENTS.md` Coding section after first occurrence.

### UX Review Notes

The spec's UX scope is correctly small. The single UX touchpoint is the dynamic
nav: existing nav style is reused, no new components needed. Architect-side
note for the Coder: the existing nav rendering is in `app/_layout.tsx` (Tabs
component); injecting dynamic surfaces means appending to the static tab list
at render time after the registry resolves. Loading state during the brief
boot window: render the existing static tabs immediately, append surfaces
when ready (no spinner needed; the gap is < 200ms warm).

### Testing Notes

#### Unit Tests Required

- Manifest validator: 1 valid case + 1 bad case per field (id format, version
  format, model union, dataSchemas shape, surface shape, promptLockedZones
  array). ~30 test cases total.
- Locked-zone parser: well-formed, 3 malformed (unterminated block, mismatched
  zone name, nested zones).
- Embedding cache: hit (same mtime), miss (changed mtime), missing file
  (rebuild from scratch), corrupted file (rebuild from scratch).
- Reserved-route collision detector: skill declaring `/chat` rejected;
  declaring `/topics` accepted.
- `findSkillsByEmbedding`: empty registry returns `[]`; single skill returns
  `[{ skillId, score }]`; sorted descending; topK respected.

#### Component Tests Required

- `loadSkillRegistry` with a fixture `_examples/` folder containing 5 valid +
  3 invalid skills: confirms 5 load, 3 are rejected with named warnings.
- `loadSkillRegistry` with two skills declaring same id: confirms first wins,
  second logged as warning.
- `loadSkillRegistry` with a skill whose `handlers.ts` throws on import:
  confirms skill rejected, app boot continues.
- Surface collection: 2 skills with surfaces + 3 without → `getAllSurfaces()`
  returns exactly 2, sorted by `order`.

#### Integration Tests Required

- End-to-end: boot the app with `_examples/financial/` skill, send a phrase
  matching `triggerPhrases`, verify orchestrator selects `financial` (via
  routing log).
- Boot performance: 20-skill fixture with warm cache → boot under 200ms
  (CI gate). 20-skill with cold cache → boot under 2s (informational, not a
  gate).
- Dynamic nav: skill with surface → tab appears; remove skill → tab gone after
  restart.

#### Scope Isolation Tests Required

**No** — this feature does not touch user data; it only loads configuration.
Privacy filter scope isolation arrives in FEAT055 (Phase 3).

#### Agent Fixtures Required

**No** — this feature has no LLM output. All tests are deterministic against
the loader's own logic. Agent fixtures begin with FEAT079 (POC skill).

#### Boot report (Open Question 6 resolution)

The loader writes a `boot_report.json` to a configurable path **only if
opts.bootReportPath is provided**. Default: not written. Fields per the
`SkillBootReport` interface above. Used by tests + future admin tooling. Not
visible to end users.

---

## UX Notes

[**To be filled after architect review and before implementation.** UX scope
is small for this FEAT — surfaces appear in the existing nav, no new screens.
Surface affordance (icon + label rendering) needs to match the existing nav
style.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.** Reference:
`docs/v4/11_v2_design_review.md §5 Phase 1 testing strategy` already lists the
required test types for this phase: manifest validator unit tests (good +
5 bad cases per field), embedding cache hit/miss, locked-zone block parsing
(well-formed + 3 malformed), 50-phrase routing accuracy regression set, etc.]
