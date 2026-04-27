# AGENTS.md — LifeOS (Chief Clarity)

**Updated:** 2026-04-14

This file holds project-specific rules accumulated from Architect and Code Reviewer cycles for the LifeOS / Chief Clarity project. All agents must read this file before starting work on this project.

Generic ADLC-framework rules live in `ADLC/AGENTS.md` (submodule). Do not duplicate rules across both files — project-specific learnings stay here, cross-project rules stay in the submodule.

Coder-specific rules that govern day-to-day implementation style also live in `CLAUDE.md` at the project root.

## Rules

<!-- Rules are added here by the Architect Agent and Code Reviewer Agent after each review. Do not delete existing rules. -->

### Data Integrity
- When a function regenerates a section of a file while preserving another section, always write the preserved section's heading (even empty) so subsequent appends land in the correct location. Example: topic Dashboard regeneration must always write the `## Notes` marker so later `appendToTopicFile()` calls have a home. (DR-FEAT023)
- Never use `require()` for static imports in ES module files — always use top-level `import`. Dynamic `require()` bypasses tree-shaking and is a code smell. (DR-FEAT023)
- File-writing operations triggered by user action must include try-catch with user-facing error feedback. Silent write failures erode user trust. (DR-FEAT023)

### Architecture
- UI handlers for domain actions must delegate to the corresponding executor actions rather than duplicating state-mutation logic. Each inline copy of state mutation in the UI is a missed side-effect waiting to happen (e.g., fact migration, signal recording, conflict checks). If an action exists in the executor, the UI must call it — not reimplement it. (CR-FEAT023: `handleAccept` in `topics.tsx` bypassed `migrateFactsToTopic`.)
- The headless runner and the UI share the same assembler and executor pipeline. When adding a new per-intent context field in `assembler.ts`, both paths automatically benefit. When adding a new side-effect in `executor.ts`, it runs from both paths — confirm that's the intent. (DR-FEAT023)

### Performance
- When iterating over N items that each need a cross-reference against M entities, build the cross-reference once above the loop and index it by key (e.g., `Map<topic, TopicCrossRef>`). Do not rebuild the cross-reference inside the loop. (CR-FEAT023: `buildTopicCrossRef` was called per `topicDigest` item inside `updateTopicPagesFromBrief`.)

### Concurrency
- Shared SQLite writes across processes must use a lock file (or DB-level coordination) to avoid `SQLITE_BUSY`. The proxy and headless runner both start at `npm run dev`; long-running write sweeps (e.g., background embedding indexer) need a TTL-based lock at `{DB_PATH}/.indexer.lock` to serialize them. Stale-lock reclaim prevents crashes from wedging future runs.

### State integrity
- The flush `ShrinkageGuardError` catches corrupted-reload overwrites (> 50% loss between loaded and written counts). Any executor action that **intentionally** shrinks a guarded collection must rebase `state._loadedCounts[<key>]` after the shrinkage so the guard doesn't block a legitimate write. Known cases: `accept_suggestion` migrates facts from `contextMemory` to a topic file. Forgetting this produces runtime errors the user can't recover from without reloading the app.

### Sacred boundary — schedule computation
- When context sent to the LLM contains schedule definitions that require date computation (e.g., "weekly on Tuesday/Thursday"), TypeScript must pre-compute the applicable dates and send a date-keyed map. The LLM must not be expected to parse schedule types, compute weekday-to-date mappings, or handle exclude-date logic — that violates the sacred boundary ("TypeScript owns data computation, LLM owns language"). (CR: recurring events ignored in weekly plan because LLM was expected to compute which dates "weekly on tuesday" applies to.)

### Data model migrations
- When adding a new flag to a data model (e.g., `isRecurringInstance` on CalendarEvent), remember that existing records in the database won't have the flag set. Any filter that depends on the new flag must include a fallback for legacy data (e.g., matching by ID prefix `rcev_` as a backward-compatible heuristic). Without this, the first deploy after the fix still produces incorrect behavior until the old data ages out. (CR: recurring events, assembler filter.)

### Testing
- (Rules will be added here after first test cycle)
- Every sensor unit test must include the empty-database case — sensor returns zero signals when there is nothing to detect. (DR v2 portfolio §7)
- Every skill PR records a fixture for the LLM output of each acceptance criterion. CI runs against fixtures (deterministic); a nightly job re-runs against live LLM. (DR v2 portfolio §7)
- Negative privacy tests are mandatory in Phase 3+. For every new skill, add a test that proves it cannot read a sensitive category not in its manifest. (DR v2 portfolio §7)
- Dual-path divergence tests required for every legacy-intent → v4-skill migration. Legacy code cannot be deleted until divergence is < 5% on a 50-phrase labeled set. (DR v2 portfolio §7)

### Architecture (v4 portfolio)
- Skills are folders, not flat data. Manifest + prompt + context + handlers per `docs/v4/02_skill_registry.md`. PR review rejects flat-file skill specs. (DR v2 portfolio §7)
- One LLM reasoning call per user phrase. ADR-001 is binding. Any feature that introduces a second reasoning call within one phrase needs an ADR override before merge. (DR v2 portfolio §7)
- No on-the-fly skill composition. A skill that doesn't fit either: (a) routes to `general_assistant`, or (b) prompts the user to author one via FEAT053 — never silently composed. (DR v2 portfolio §7, supersedes FEAT051 v3 composer)
- Capabilities are integrations, skills are domain expertise. Don't merge them. `src/integrations/` is for external systems (Google, Slack); `src/skills/` is for LLM-facing behaviors. (DR v2 portfolio §1, supersedes FEAT020 hook model)
- Privacy filter is upstream. Every new skill PR includes its `dataSchemas.read/write` declaration; PRs without are rejected. Restricted data is excluded at retrieval, not stripped from output. (DR v2 portfolio §7)
- Locked prompt zones for any safety-bearing skill. Companion is the first; future medical/financial/legal skills follow the same pattern with explicit `promptLockedZones` in the manifest. (DR v2 portfolio §7)
- Sensors emit signals, never call the LLM, never notify the user directly. Pluggable folder pattern per `docs/v4/05_proactive_intelligence.md §1`. (DR v2 portfolio §7)
- One migration per PR. No PR ships two new data tables or file additions simultaneously. (DR v2 portfolio §7)

### Coding (v4 portfolio)
- Skill handlers must write through `filesystem.ts`, never direct disk writes. (DR v2 portfolio §7)
- Executor writes go through the topic auto-tag hook (FEAT084) once Phase 2 ships. Skill handlers do not call `topicManager.recordSignal` directly. (DR v2 portfolio §7)
- No `process.env` reads outside `src/config/settings.ts` (after FEAT035 ships). Every other module reads through `settings.get()` for live-update support. (DR v2 portfolio §7)
- Skill `handlers.ts` files must do NO work at module-load time (no top-level await, no factory-instantiation, no I/O). Every skill `handlers.ts` is dynamic-imported sequentially during boot; heavy module-load work blocks the entire skill registry boot. Define handlers as plain function exports; defer setup to first invocation. (CR-FEAT054)
- When a per-boot derived cache (e.g. embedding cache, computed-state snapshot) keys entries by an external identifier that can disappear (skill folder deleted, file removed), rebuild the cache from scratch each boot rather than starting from the previous on-disk cache and adding to it. Otherwise removed-id entries linger forever, causing slow disk growth and stale-data bugs when an id is reused. (CR-FEAT054: B1 — `skillRegistry.ts` cache file accumulated entries for deleted skills.)

### Architecture (v4 portfolio cont.)
- Skill manifests can declare a `surface` (UI tab). Routes must be validated against (a) a regex that prevents path traversal / scheme injection (`/^(?:\/[a-z0-9_-]+)+\/?$/`), and (b) a reserved-route list of shell-owned paths. Both checks at load time, not at render time. (CR-FEAT054: B2)
- When two pluggable contributors (skills, sensors, capabilities) can collide on a uniqueness constraint (id, route, port, etc.), the loader must detect the collision deterministically and reject one with a named warning. Alphabetical-first-wins is the agreed tiebreak for skill folders. (CR-FEAT054: B4)
- Routing / orchestration code must log every decision with a structured entry that includes a SHA-256-hashed form of the user phrase (first 16 hex chars), the chosen skill id, confidence, routing method, and the candidates considered. Hash format must match the audit_log convention (FEAT056) so log entries can be cross-referenced. Never log plaintext user phrases. (CR-FEAT051: B3)
- Any module imported (directly or transitively) from `app/` must NOT have top-level `import * as fs from "fs"` (or `path`, `crypto`, `child_process`, `os`). The Metro bundler builds these into the web/Capacitor bundle and fails to resolve them. Follow the `src/utils/filesystem.ts` pattern: declare `function nodeFs() { return require("fs"); }` at module top and call it inside functions that are gated by `isNode()`. Type-only imports (`import type ... from "fs"`) are fine. (CR-FEAT055: B2)
- Dynamic `import(<runtime-computed-path>)` is rejected by Metro's transform-worker (e.g., `import(path.resolve(file))`). When a Node-only module needs to dynamically load a file by computed path, use `const dynRequire: NodeRequire = eval("require"); dynRequire(absolutePath);` to hide the call from Metro's static analyzer. Works only in Node — must be gated by `isNode()`. (CR-FEAT055: B3)
- Verify any v4 module imported from `app/` builds via `npm run build:web` before marking a feature Done. The test suite runs in Node where everything works; only Metro catches bundle-time resolution failures. (CR-FEAT055)
- When inserting a hook into a long-existing pipeline (chat.tsx, executor, headless runner), verifying "code below the hook is byte-equal" is **not enough**. Trace at least one realistic input through the integrated flow during code review. Earlier short-circuit branches (early returns, exception throws, "I can't do that" guards) can intercept the input before the hook ever runs, leaving the new code dead and the test suite green. Code review must answer "what happens when a real phrase enters the function?", not just "does the new code compile and run in isolation?" (CR-FEAT056: B1 — v4 hook placed after triage's canHandle/needsClarification short-circuits, never fired in production)
- When a pure function consumes structured data from another module (triage outputs, parsed manifests, derived state), unit tests must use **realistic outputs from that module**, not synthetic happy-path inputs. Triage's `safeDefault` sets `legacyIntent="general"` whenever its Haiku call fails or returns malformed JSON — a real production case the gate's "guard on truthy legacyIntent" check broke on. Pure-function tests would have caught this if they tested against actual triage outputs (general, full_planning fast-path, fast-path failures) instead of an abstract "happy path" / "all guards triggered" matrix. (CR-FEAT056: B2)
- Lazy `require("crypto")` doesn't actually save you from Metro: the bundler returns a stub object without `createHash` for the web bundle. Use `eval("require")` instead AND check `typeof X.method === "function"` before calling, with a graceful fallback. Same applies to any Node module surfaced via lazy require: `fs`, `path`, `crypto`, `child_process`. (CR-FEAT056: B3)
- v4 stack (`skillRegistry` + `skillDispatcher` + `routeToSkill`) is currently Node-only. Modules imported from `app/` that depend on the registry must short-circuit with `isNode()` for the web/browser bundle. Until FEAT044 ships a generated-skill-index path for Capacitor (and equivalent proxy support is added for web), v4 is **inert on web** by design — chat surface falls through to legacy automatically. Anything that "should run on every phrase" must live in legacy until v4 has a non-Node story. (CR-FEAT056: B3)
- When a v4 hook short-circuits the legacy flow with an early `return`, audit every side effect (flush calls, scheduler triggers, hot-reload notifications, telemetry, persistence) the legacy flow performs *after* the hook's insertion point. Anything not replicated in the v4 path is a **silent regression**. The hook is responsible for replicating those side effects when v4 wins the turn. (CR-FEAT057: B2)
- `executor.applyWrites(plan, state)` mutates `state` and marks `state._dirty`; it does **NOT** persist to disk. The chat surface owns the `flush(state)` call. Any new dispatcher / consumer that calls `applyWrites` must follow with `if (state._dirty.size > 0) await flush(state);` — otherwise writes appear in-memory and are lost on app restart. (CR-FEAT057: B2)
