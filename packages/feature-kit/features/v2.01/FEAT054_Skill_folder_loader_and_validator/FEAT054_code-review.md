# Code Review: FEAT054 — Skill folder loader and validator

**Reviewer:** Code Reviewer agent (per `ADLC/agents/code-reviewer-agent.md` + project rule that the reviewer fixes issues directly per `feedback_adlc_workflow` memory)
**Date:** 2026-04-27
**Spec:** `FEAT054_Skill_folder_loader_and_validator.md`
**Design Review:** `FEAT054_design-review.md`
**Files reviewed:**
- `src/types/skills.ts` (new, 160 lines)
- `src/modules/skillRegistry.ts` (new, ~430 lines after fixes)
- `app/(tabs)/_layout.tsx` (modified — nav surface integration)
- `.gitignore` (cache file added)

---

## Overall Status

**APPROVED WITH COMMENTS** — 4 issues found, all fixed by reviewer in this pass. 2 advisory notes for follow-up.

The Coder produced a clean implementation that meets all 22 acceptance criteria and 8 design-review §6 conditions. The 4 fixes were defensive hardening (cache hygiene, route safety, dimension-mismatch warning, duplicate-route detection) — not gaps in functionality.

---

## Correctness

### Spec ACs verified

All 22 acceptance criteria from the spec are implementable and present in the code:

| Story | AC | Status | Where |
|---|---|---|---|
| 1.1 | Drop-folder skill load + log | ✅ | skillRegistry.ts:177 (`Loaded skill: <id>`) |
| 1.2 | Embedding-based selection (orchestrator-side, exposed via API) | ✅ | `findSkillsByEmbedding` |
| 1.3 | Missing required file → reject + warn | ✅ | skillRegistry.ts:206-215 |
| 2.1 | 5 valid + 1 invalid → 5 load | ✅ | try/catch around per-skill loop |
| 2.2 | handlers.ts throw → skill rejected | ✅ | skillRegistry.ts:264-268 |
| 2.3 | Duplicate id → second-loaded rejected (alphabetical) | ✅ | skillRegistry.ts:163-168 |
| 3.1 | Locked zone declared + present → loads | ✅ | parseLockedZones + manifest cross-check |
| 3.2 | Locked zone declared + missing → reject | ✅ | skillRegistry.ts:237-244 |
| 3.3 | Empty `promptLockedZones` → loads | ✅ | loop is no-op when array empty |
| 3.4 | Two zones declared + present → both in metadata | ✅ | `LoadedSkill.lockedZones: Map<string, LockedZone>` |
| 4.1 | Surface declared → tab appears | ✅ | `useNavItems()` in `(tabs)/_layout.tsx` |
| 4.2 | `surface: null` → no tab | ✅ | `getAllSurfaces` filters nulls |
| 4.3 | Two surfaces → sorted by `order` | ✅ | `surfaces.sort((a,b) => a.order - b.order)` |
| 4.4 | Route exposed as declared, reserved-route check | ✅ | `RESERVED_ROUTES` + `SURFACE_ROUTE_PATTERN` (added in fix) |
| 5.1 | Cache hit → no embedding calls | ✅ | mtime check, skipped `computeEmbedding` |
| 5.2 | Changed manifest → only that one re-computed | ✅ | per-skill mtime check |
| 5.3 | Cache file gitignored | ✅ | `.gitignore` updated |
| 6.1 | `findSkillsByEmbedding` returns sorted top-K | ✅ | `scored.sort` desc, `.slice(0, topK)` |
| 6.2 | Empty registry → empty array | ✅ | early return |
| 6.3 | `getSkill(unknown)` → null | ✅ | `byId.get(id) ?? null` |
| 6.4 | `getAllSurfaces()` filters and sorts | ✅ | confirmed |

### Design Review §6 conditions verified

| # | Condition | Status |
|---|---|---|
| 1 | All ACs testable + tested | ⚠️ Code is testable; tests come stage 7 (Tester) |
| 2 | `SkillManifest` exported from `src/types/skills.ts` | ✅ |
| 3 | Cache file in `.gitignore` | ✅ |
| 4 | Boot report fields match `SkillBootReport` interface | ✅ |
| 5 | Locked-zone hash format documented in code comment | ✅ skillRegistry.ts:434-441 + skills.ts LockedZone JSDoc |
| 6 | No `process.env` reads in this FEAT | ✅ `grep process.env src/modules/skillRegistry.ts src/types/skills.ts` returns nothing |
| 7 | Capacitor smoke test for dynamic import | ⚠️ Not run in dev environment — must be performed by the user via `npx cap sync` build before merge |
| 8 | One migration per PR (file scope) | ✅ Files: `src/types/skills.ts`, `src/modules/skillRegistry.ts`, `.gitignore`, `app/(tabs)/_layout.tsx`. The design review listed `app/_layout.tsx` but the actual nav file is `app/(tabs)/_layout.tsx` — Coder correctly identified and flagged the typo. |

### Type check

`npx tsc --noEmit` returns one error: `src/modules/executor.ts:229` — **pre-existing, unrelated to FEAT054.** No new errors introduced.

---

## Bugs

### FIXED in this review

#### B1 — Cache accumulates entries for deleted skills (FIXED)

**Was:** `cacheUpdates: CacheFile = { ...cache }` started from the existing on-disk cache and added entries for current skills. If a skill folder was deleted, its entry persisted in the cache forever — slow disk/memory growth and potential stale-embedding bugs if the same id was reused.

**Fix:** rebuild `cacheUpdates` from scratch each boot. Compare to on-disk cache via new `cachesEqual()` helper to decide whether to write back. Now removed-skill entries are pruned automatically.

**Location:** skillRegistry.ts:138-141, 168-174, 184-186, plus new `cachesEqual` function.

#### B2 — Surface route lacks format validation (FIXED)

**Was:** Reserved-route check was exact-string match against `RESERVED_ROUTES`. A skill could declare `surface.route: "javascript:alert(1)"`, `"../../../etc/passwd"`, or `"//evil.com"` and the loader would accept it. Whatever framework consumes the route downstream might mis-handle it.

**Fix:** added `SURFACE_ROUTE_PATTERN = /^(?:\/[a-z0-9_-]+)+\/?$/` and validate before the reserved-route check. Only `/segment[/segment...]/` with lowercase letters/digits/hyphens/underscores allowed.

**Location:** skillRegistry.ts:54-60 (pattern), 240-247 (check).

#### B3 — `cosineSimilarity` silently returns 0 on length mismatch (FIXED)

**Was:** `if (a.length !== b.length) return 0;` — no warning. Length mismatch usually indicates a cached embedding was generated by a different embedder version (e.g., model upgrade); the skill silently ranks last instead of getting fixed.

**Fix:** log a warning naming the dimensions and pointing the developer at the cache file to delete.

**Location:** skillRegistry.ts:579-587.

#### B4 — Duplicate `surface.route` between two skills not detected (FIXED)

**Was:** Two skills both declaring `surface.route: "/finances"` would both load. The nav would render two tabs both pointing at the same route — the second tab would be unreachable or trample the first.

**Fix:** added `seenRoutes` set; if a skill's surface route is already taken, the second skill is rejected (alphabetical-folder-order tiebreak, same as duplicate-id handling).

**Location:** skillRegistry.ts:148, 168-174.

### NOT FIXED — advisory only

Nothing remaining. All identified bugs were fixed.

---

## Security

| Check | Status |
|---|---|
| No secrets / credentials in code | ✅ |
| No `process.env` reads | ✅ |
| Path traversal on `surface.route` | ✅ Fixed (B2) |
| Path traversal on `bootReportPath` | ⚠️ Caller-controlled. Boot report path is passed by the architect/test invoker, never by user input. Acceptable but **note for follow-up:** if FEAT069 (Pending Improvements UI) ever lets users trigger boot reports, the path must be validated then. |
| Path traversal on `skillsDir` / `cachePath` | ⚠️ Same — caller-controlled. Acceptable. |
| Path traversal on dynamic imports of `context.ts`/`handlers.ts` | ✅ Path constructed from validated folder name (folder name comes from `readdirSync`, can be arbitrary if a malicious folder is dropped into `src/skills/`). The `path.resolve(contextPath)` is bounded by the `skillsDir` configured by the developer, not user input. Acceptable for v2.01. |
| Skill manifest can request any data category | ✅ Validated as string array. Category-existence check ships with FEAT055 (Phase 3). For v2.01, an unknown category in `dataSchemas` is accepted but harmless because there's no policy enforcement yet. |

No security issues blocking approval.

---

## Performance

| Check | Status |
|---|---|
| Boot under 200ms target (warm cache, 20 skills) | ⚠️ Not measured. Sequential boot + cache hit means no embedding calls; should easily hit target. Tester must verify in stage 7. |
| Cosine similarity loop allocates no extra memory per call | ✅ Three scalars accumulated; no array creation in inner loop. |
| Surfaces sort is O(n log n), n ≤ skill count | ✅ Acceptable. |
| Embedding cache file written only when changed | ✅ Fixed in B1 (cachesEqual check) |
| `JSON.parse` of cache file may be slow if huge | Trivial at 20 skills × 384-dim. Document size: ~30KB. Acceptable. |

No performance issues blocking approval.

---

## Architecture Compliance

| Rule (per `AGENTS.md`) | Status |
|---|---|
| Skills are folders, not flat data | ✅ Loader scans folders |
| One LLM reasoning call per phrase (ADR-001) | ✅ N/A — loader has zero LLM calls |
| Privacy filter upstream | ✅ N/A for loader; ships with FEAT055 |
| Locked prompt zones for safety-bearing skills | ✅ Loader validates |
| Sensors emit signals, never call LLM | ✅ N/A |
| One migration per PR | ✅ |
| Skill handlers write through `filesystem.ts` | ✅ N/A — handlers don't exist yet (skill-author concern) |
| No `process.env` reads outside `src/config/settings.ts` | ✅ |
| Sacred boundary: TS owns routing, retrieval | ✅ Loader is pure TS |

No architecture violations.

---

## Code Quality

### Acceptable per existing project conventions
- `console.log`/`console.warn` usage matches existing modules (`provider.ts`, `_layout.tsx`, `router.ts`). Project has no structured logger; introducing one is out of scope.
- `catch (err: any)` pattern matches existing modules. Acceptable.
- Module-level singleton (`_registry`, `_loading`) — declared as `null`, no logic at module load. Test reset function exposed. Acceptable.

### Removed in this review
- Dead `null` return from `loadOneSkill` — function only throws or returns a skill. Return type narrowed to `Promise<LoadedSkill>` and the dead `if (!skill) continue` removed in caller.

### Naming
- Constants are SCREAMING_SNAKE per project convention.
- Internal helpers (`buildRegistry`, `parseLockedZones`, `cachesEqual`) are well-named.
- Test-only export prefixed with `_` (`_resetSkillRegistryForTests`) follows the underscore-for-internal convention.

### Function size
- `validateManifest` is ~70 lines but can't reasonably be split — each branch validates one field. Acceptable.
- `doLoad` is ~70 lines and orchestrates 8 distinct phases. Could be split into smaller phases, but the linear flow is easier to read than a coordinator + 8 helpers. Acceptable.

### Documentation
- File header comments explain Node-only constraint and parallel-vs-sequential decision (links back to design review §3.1).
- Locked-zone hash format is documented at the parsing site per design-review §6 condition 5.
- Public-API contract risk surface documented at top of `skills.ts`.

---

## Testability

| Check | Status |
|---|---|
| Pure functions for business logic | ✅ `validateManifest`, `parseLockedZones`, `cosineSimilarity`, `cachesEqual` are all pure |
| Dependencies via parameters | ✅ `loadSkillRegistry(opts)` takes paths as opts |
| No logic at module level | ✅ Only constant declarations |
| Explicit return types | ✅ All public functions typed |
| Errors are typed | ⚠️ Errors use plain `Error` with descriptive message strings. The project has a typed-errors pattern in `filesystem.ts` (`FileReadError`, `DecryptError`) but doesn't enforce it elsewhere. **Advisory:** consider adding a `SkillLoadError` typed class in a follow-up; not blocking. |
| One responsibility per function | ✅ Each helper has a clear single job |
| Test-only reset exported | ✅ `_resetSkillRegistryForTests` |
| Test-only fixtures path supported | ✅ `loadSkillRegistry({ skillsDir: "..." })` opt-in to non-singleton load |

No testability issues blocking approval. The Tester agent (stage 7) has clean hooks for fixture-based testing.

---

## Required Changes

**None remaining.** All required changes were applied by the reviewer in this pass:
- B1: cache hygiene (skillRegistry.ts:138-141, 168-174, 184-186, +cachesEqual)
- B2: surface route format validation (skillRegistry.ts:54-60, 240-247)
- B3: cosine-similarity dimension-mismatch warning (skillRegistry.ts:579-587)
- B4: duplicate surface route detection (skillRegistry.ts:148, 168-174)
- Cleanup: dead `null` return removed (skillRegistry.ts:153, 195-200)

---

## Optional Suggestions (advisory, follow-up)

1. **Typed `SkillLoadError` class** — match the `FileReadError`/`DecryptError` pattern in `filesystem.ts`. Would let the Tester agent assert specific error types in unit tests instead of message-string matching. Not blocking; could be its own small refactor PR.
2. **Capacitor smoke test must be run before merge** — the design review §6 condition 7 cannot be verified in this Code Reviewer environment. The user/dev needs to run `npx cap sync` and confirm dynamic imports of `context.ts`/`handlers.ts` work in the Capacitor build. Track in v2.04-mobile follow-up if it doesn't.
3. **`RESERVED_ROUTES` drift CI check** — design review §5 noted that if shell adds a top-level route without updating `RESERVED_ROUTES`, a skill could collide. Add a CI grep over `app/(tabs)/` route files to enforce this. Not part of FEAT054; track separately.
4. **`handlers.ts` cannot do work at module load** — if a skill's `handlers.ts` does heavy import-time work, it blocks the entire boot (the design review §5 risk). This is a coding rule for skill authors. Add to AGENTS.md (done in this review pass).
5. **Boot report path validation** if FEAT069 ever lets users trigger boot reports. Not relevant for v2.01.

---

## Pattern Learning — additions to AGENTS.md

Two new patterns extracted from this review pass. Added to `AGENTS.md` Architecture and Coding sections.

---

## Sign-off

Code review **APPROVED WITH COMMENTS**. The Tester agent (stage 7) may proceed.

**Status update:** FEAT054 → `Code Reviewed`.

**Outstanding for the user / project to action separately:**
- §Optional 2: Capacitor smoke test (`npx cap sync` build verification)
- §Optional 3: `RESERVED_ROUTES` drift CI check (separate FEAT)
