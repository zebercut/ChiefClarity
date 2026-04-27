# Code Review: FEAT055 — POC priority_planning skill

**Reviewer:** Code Reviewer agent (project rule: reviewer fixes directly)
**Date:** 2026-04-27
**Spec:** `FEAT055_POC_priorityplanning_skill_proves_FEAT054FEAT051_endtoend.md`
**Design Review:** `FEAT055_design-review.md`
**Files reviewed:**
- `src/skills/priority_planning/manifest.json` (new, ~25 lines)
- `src/skills/priority_planning/prompt.md` (new, ~25 lines)
- `src/skills/priority_planning/context.ts` (new, ~17 lines)
- `src/skills/priority_planning/handlers.ts` (new, ~55 lines)
- `src/modules/skillDispatcher.ts` (new, ~250 lines after fixes)
- `src/types/orchestrator.ts` (extended — added `SkillDispatchResult`)
- `app/_layout.tsx` (one-line addition: `setV4SkillsEnabled(["priority_planning"])` in `applyConfig`)

---

## Overall Status

**APPROVED WITH COMMENTS** — 1 issue found, fixed by reviewer in this pass. 1 advisory note.

Smoke-tested via `scripts/scratch/feat055_smoke.ts` (gitignored): the `priority_planning` skill loads through the FEAT054 registry with no warnings; tools `submit_priority_ranking` + `request_clarification` are present in the loaded handlers map.

---

## Correctness

### Revised AC mapping verification (per Architecture Notes "Revised AC mapping")

| Story | Revised AC | Status |
|---|---|---|
| 1 | Skill folder + boot log + routing API | ✅ Smoke test loaded skill, handlers populated |
| 2 | Dispatcher executes the skill end-to-end with stub LLM | ✅ Dispatcher path implemented; tests in stage 7 |
| 3 | `setV4SkillsEnabled` gate works (returns null when not enabled) | ✅ Step 1 of `dispatchSkill` |
| 4 | Fixture-based correctness (5 fixtures + canned LLM tool calls) | ⏳ Tests in stage 7 |
| 5 | No regression in 248 existing tests | ⏳ Verified in stage 7 via full `npm test` |

### Design Review §6 conditions verified

| # | Condition | Status |
|---|---|---|
| 1 | All revised ACs testable + tested | ⏳ Stage 7 |
| 2 | `SkillDispatchResult` exported from `src/types/orchestrator.ts` | ✅ |
| 3 | Dispatcher never throws on runtime failures | ✅ All `try/catch` paths return `degradedAndLog` |
| 4 | No `process.env` reads added | ✅ `grep process.env src/modules/skillDispatcher.ts src/skills/priority_planning/*.ts` returns 0 |
| 5 | Skill folder loads with no warnings | ✅ Smoke test confirms |
| 6 | Boot wiring is one line in `app/_layout.tsx` | ✅ `setV4SkillsEnabled(["priority_planning"]);` added inside existing `applyConfig` |
| 7 | Persistence (`priority_log`) explicitly NOT wired | ✅ Handler returns ranking; no filesystem writes |
| 8 | Capacitor smoke test for phrase embedder + skill loader | ⚠️ Same constraint as FEAT054/051 — defer to user |

### Type check

`npx tsc --noEmit` → only the pre-existing `executor.ts:229` error. No new errors.

---

## Bugs (FIXED in this review)

### B1 — Dispatcher missed AGENTS.md routing-decision logging rule

**Was:** Per AGENTS.md `(CR-FEAT051)`: *"Routing/orchestration code must log every decision with a structured entry that includes a SHA-256-hashed form of the user phrase."* The dispatcher is orchestration code (it picks a tool, runs a handler, decides whether to dispatch at all). The original implementation only emitted `console.warn` on degraded paths — successful dispatches produced no orchestration log entry.

**Fix:** added `logDispatchDecision(phrase, result)` called from both the success path and from a refactored `degradedAndLog` helper. Every dispatch outcome — success, clarification-required, or degraded — now produces a `[skillDispatcher] dispatch phrase=<hash> skill=... tool=...` line. Hash format matches the router's (`sha256First16`).

The dispatch log + the existing router log give a complete orchestration audit for every phrase, with cross-referenceable hashes.

---

## Security

| Check | Status |
|---|---|
| No secrets in code | ✅ |
| No `process.env` reads | ✅ |
| Phrase hashed before logging (per CR-FEAT051 rule) | ✅ Fixed in B1 |
| Tool args from LLM never written to disk in this FEAT (handler does no I/O) | ✅ Persistence deferred to FEAT080 |
| Manifest's `dataSchemas.read` is declarative-only for v2.01 (no enforcement yet) | ⚠️ Documented as v2.01 limitation; enforcement ships in Phase 3 |
| LLM-returned `toolName` validated against `skill.handlers` map before invocation | ✅ Step 6 — unknown tool name returns degraded result |

No security issues.

---

## Performance

| Check | Status |
|---|---|
| Single LLM call per dispatch (ADR-001) | ✅ One `messages.create` call |
| Boot wiring is sync (no await) | ✅ `setV4SkillsEnabled` is sync |
| Context resolver is O(n) over declared keys | ✅ Trivial loop |
| `JSON.stringify(context)` in user message could bloat input | ⚠️ Acceptable for v2.01 fixtures; full Assembler in Phase 3 enforces token budget per skill |

No performance issues blocking approval.

---

## Architecture Compliance

| Rule (per `AGENTS.md`) | Status |
|---|---|
| One LLM reasoning call per phrase (ADR-001) | ✅ Dispatcher makes exactly one Sonnet call |
| Skills are folders, not flat data | ✅ `src/skills/priority_planning/` with all 4 files |
| Skill handlers must write through `filesystem.ts` | ✅ N/A — POC handler does not write |
| Skill `handlers.ts` files must do NO work at module-load | ✅ Only function exports; no top-level code |
| No `process.env` reads outside `src/config/settings.ts` | ✅ |
| Routing/orchestration code logs decisions with hashed phrase (CR-FEAT051) | ✅ Fixed in B1 |
| Locked prompt zones for safety-bearing skills | ✅ N/A — `priority_planning` is not safety-bearing; `promptLockedZones: []` |
| One migration per PR | ✅ Files: 4 skill files + dispatcher + types extension + boot wiring. All within FEAT055 scope. |

No violations.

---

## Code Quality

### Acceptable per existing project conventions
- `console.log` / `console.warn` — matches existing modules
- `catch (err: any)` — matches existing pattern
- `as const` for the literal `"object"` in tool schemas — required by Anthropic SDK type signature

### Naming
- `dispatchSkill` — verb-noun, matches `routeToSkill` and `loadSkillRegistry` naming patterns
- `degradedAndLog` — explicit about both responsibilities
- `pickModel`, `buildUserMessage`, `buildToolSchemas` — clear, single-responsibility helpers

### Function size
- `dispatchSkill` is ~85 lines orchestrating 6 numbered steps. Linear flow reads better than 6 helpers. Acceptable.
- All other functions < 30 lines.

### Documentation
- Top-of-file JSDoc explains purpose, scope, and ADR alignment
- Each step in `dispatchSkill` has a numbered comment
- Context-resolver scope (5 keys, full Assembler later) documented inline
- TODO comment for FEAT035 settings migration on the boot wiring

---

## Testability

| Check | Status |
|---|---|
| Pure functions for business logic | ✅ `pickModel`, `buildUserMessage`, `buildToolSchemas`, `resolveContext`, `sha256First16` are all pure |
| Three-axis dependency injection | ✅ `DispatchOptions { llmClient, registry, state, enabledSkillIds }` lets tests run without globals |
| No logic at module level | ✅ Only constants + function declarations |
| Explicit return types | ✅ Public `dispatchSkill` returns `Promise<SkillDispatchResult \| null>` |
| Errors typed | ⚠️ Plain `Error` from caught exceptions — same project convention |

No testability issues.

---

## Required Changes

**None remaining.** B1 was applied in this review.

---

## Optional Suggestions (advisory)

1. **`SUPPORTED_KEYS` and `priority_planning/context.ts` are tightly coupled.** If either drifts (a key added to context.ts not in SUPPORTED_KEYS), the dispatcher silently drops the data and the skill gets less context than declared. Mitigation: a smoke test could assert overlap. For v2.01 this is acceptable — when the full Assembler ships in Phase 3, `SUPPORTED_KEYS` goes away.

---

## Pattern Learning — additions to AGENTS.md

The CR-FEAT051 logging rule is now load-bearing across two modules (router + dispatcher). No new pattern; this FEAT confirmed the rule's value.

One soft addition (not added, but noted for future review):

- **Dependency injection via opts object is the v4 pattern for testability.** All v4 modules (`loadSkillRegistry({ skillsDir, cachePath })`, `routeToSkill(input, { registry, embedder, llmClient })`, `dispatchSkill(routeResult, phrase, { registry, llmClient, state, enabledSkillIds })`) accept an opts argument with optional dependency overrides. Tests use these to isolate from globals. Future v4 modules should follow.

---

## Post-Tester findings (2026-04-27 follow-up)

After the user asked "will the app work now?" I attempted `npm run build:web` and found **two more bugs** that the test suite missed:

### B2 — `skillRegistry.ts` had top-level `import * as fs from "fs"` etc.

**Was:** Top-level Node-module imports (`fs`, `path`, `crypto`) at the top of `src/modules/skillRegistry.ts`. Tests passed because they run in Node. But `app/(tabs)/_layout.tsx` and `app/_layout.tsx` import this module → Metro bundler tries to resolve `fs` for the web/Capacitor bundle → bundle fails to build.

**Fix:** converted to lazy-require pattern (matching `src/utils/filesystem.ts` convention). All `fs`/`path`/`crypto` calls moved inside functions that are only invoked after `isNode()` check. Top of file documents the rule.

### B3 — `await import(path.resolve(contextPath))` is not Metro-compatible

**Was:** Skill loader used `await import()` with a runtime-computed path. Metro's transform-worker errored: *"Invalid call ... import(path.resolve(contextPath))"* because dynamic `import()` paths must be statically analyzable.

**Fix:** replaced with `const dynRequire: NodeRequire = eval("require"); dynRequire(path.resolve(contextPath))`. Hides the dynamic require from Metro's static analyzer; works at runtime in Node only (already gated by isNode upstream).

### Why the test suite missed both

Tests run in Node where these imports work fine. The web bundle is built by Metro, which has different resolution semantics. **The test suite is necessary but not sufficient** — for any module imported by the React Native app shell, `npm run build:web` is the additional gate.

### Verification

After both fixes:
- `npx tsc --noEmit` — clean (only pre-existing executor.ts:229)
- `npm test` — 265 / 265 pass
- `npm run build:web` — bundle exports successfully (670 modules, 1.42 MB entry bundle)

## Sign-off

Code review **APPROVED WITH COMMENTS**. Tester (stage 7) may proceed.

**Status update:** FEAT055 → `Code Reviewed`.

**Outstanding for the user / project to action separately:**
- Capacitor smoke test (same as FEAT054/FEAT051)
- chat.tsx wiring (deferred to FEAT080 batch 1)
- `priority_log` persistence wiring (deferred to FEAT080)
