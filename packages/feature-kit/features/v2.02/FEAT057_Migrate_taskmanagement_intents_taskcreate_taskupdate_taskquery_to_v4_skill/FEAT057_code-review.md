# Code Review: FEAT057 — task_management migration

**Reviewer:** Code Reviewer agent (project rule: reviewer fixes directly)
**Date:** 2026-04-27
**Spec:** `FEAT057_Migrate_taskmanagement_intents_taskcreate_taskupdate_taskquery_to_v4_skill.md`
**Design Review:** `FEAT057_design-review.md`
**Files reviewed:**
- `src/skills/task_management/{manifest.json, prompt.md, context.ts, handlers.ts}` — new skill (~120 lines total)
- `src/types/orchestrator.ts` — `SkillDispatchResult.items?` added
- `src/modules/skillDispatcher.ts` — resolver extended (5 new keys + items pass-through)
- `src/modules/assembler.ts` — `buildTaskIndex` exported (visibility-only change)
- `app/_layout.tsx` — boot wiring (one-line)
- `app/(tabs)/chat.tsx` — v4 hook now passes items + flushes on successful v4 dispatch

---

## Overall Status

**APPROVED WITH COMMENTS** — 2 issues found, both fixed by reviewer in this pass. 1 advisory note.

Smoke test (`scripts/scratch/feat057_smoke.ts`): all three skills load cleanly via the production registry; tools, models, dataSchemas all match the manifests.

---

## Correctness

### Spec ACs verified

| Story | AC | Status | Where |
|---|---|---|---|
| 1.1 (add task creates real record) | ⏳ | Stage 7 — covered by 10-phrase regression set |
| 1.2 (chat reply with badge) | ✅ | Code path verified — v4 hook produces `v4Meta` |
| 1.3 (parity with legacy task_create) | ⏳ | Stage 7 |
| 2.1 (mark done updates correct task) | ⏳ | Stage 7 |
| 2.2 (ambiguous → clarification) | ✅ | Prompt explicitly directs `needsClarification` for ambiguous matches |
| 2.3 (referential integrity) | ✅ | Handler builds `WriteOperation` shape applyWrites expects |
| 3.1 (overdue query renders items) | ⏳ | Stage 7 — items pass-through verified by code review |
| 3.2 (semantic match by topic) | ⏳ | Stage 7 |
| 3.3 (empty result polite reply) | ✅ | Prompt directs "No matching tasks." |
| 4.1 (dedup preserved) | ✅ | Handler delegates to `applyWrites` which has dedup |
| 4.2 (lifestyle conflict preserved) | ✅ | Same — `applyWrites` runs `validateAndAdjustWrites` |
| 4.3 (topic auto-tag preserved) | ✅ | Same — `applyWrites` records signals |
| 5.1 (rollback via empty enabled set) | ✅ | Hook only fires for skills in enabled set |
| 5.2 (full enabled set → v4 wins) | ✅ | Same |
| 6.1 (10-phrase fixture) | ⏳ | Stage 7 |
| 6.2 (legacy parity) | ⏳ | Stage 7 |
| 6.3 (v4 vs legacy match ≥9/10) | ⏳ | Stage 7 |
| 7.1-7.4 (legacy cleanup) | **DEFERRED** | Per design review §3.5 — separate follow-on PR after parity bake-in |
| 8.1 (no regression in 277 tests) | ✅ | Full `npm test` 277/277 pass |
| 8.2 (manual smoke on 3 non-task phrases) | ⏳ | User's call after merge |
| 8.3 (`npm run build:web`) | ✅ | Bundle exports |

### Design Review §6 conditions verified

| # | Condition | Status |
|---|---|---|
| 1 | All ACs testable + tested | ⏳ Stage 7 |
| 2 | `SkillDispatchResult.items?` added | ✅ |
| 3 | Dispatcher resolver supports 5 new keys | ✅ — each in SUPPORTED_KEYS + computeContextValue |
| 4 | Handler never throws | ✅ Fixed in this review (B1) |
| 5 | `buildTaskIndex` exported | ✅ — visibility-only change in assembler.ts |
| 6 | Boot wiring appended | ✅ — `setV4SkillsEnabled([..., "task_management"])` |
| 7 | chat.tsx passes items | ✅ — `items: dispatchResult.items` in setMessages |
| 8 | Bundle gate passes | ✅ |
| 9 | No process.env reads | ✅ |
| 10 | 10-phrase regression test | ⏳ Stage 7 |
| 11 | Parity ≥9/10 verified | ⏳ Stage 7 |

### Type check

`npx tsc --noEmit` → only pre-existing executor.ts:229 error. No new errors.

---

## Bugs (FIXED in this review)

### B1 — Handler doesn't catch `applyWrites` throws

**Was:** Handler `submit_task_action` calls `await applyWrites(plan, state)` without try/catch. If applyWrites throws (state validation failure, partial write, etc.), the handler throws → dispatcher catches and returns degraded → chat falls through to legacy. Functionally OK but violates §6 condition 4 ("handler never throws") and produces a worse UX (silent fallback to legacy when the user wanted task creation).

**Fix:** wrapped `applyWrites` in try/catch. On error, captures `writeError` string and returns a graceful failure result with `success: false` and a user-facing message that names what went wrong. Console-error preserved for diagnostics.

### B2 — v4 dispatch never persisted writes (CRITICAL)

**Was:** The legacy chat dispatch flow in `processPhrase` calls `flush(s)` near the end of the function (line ~687) to write `_dirty` files to disk. The FEAT056 v4 hook returns early via `return` at line ~447 — **before** the legacy flush runs. Result: when a v4 skill (task_management) called `applyWrites` to mutate `state.tasks`, the change was visible in-memory but **never written to disk**. On app restart, the user's task would disappear.

This is a silent data-loss bug. It would not have been caught by the test suite (which doesn't exercise restart) and would have shown up as "I added a task and it's gone now" days later.

**Fix:** the v4 hook now calls `flush(s)` after dispatchSkill returns successfully and `s._dirty.size > 0`. Wrapped in try/catch — if flush fails the user still sees the v4 reply (don't block render); error logged for next turn to retry. Matches the legacy flow's flush behavior.

**Why I missed this in the architecture phase:** I traced the success path (orchestrator → dispatcher → handler → applyWrites) but stopped at "applyWrites mutates state". I didn't follow the chain into "but what writes that state to disk?". The legacy chat.tsx had the answer — flush is at the end of processPhrase. My early-return skipped it.

Adding to AGENTS.md: when a v4 hook short-circuits the legacy flow, audit every side effect (file writes, scheduler triggers, hot-reload notifications) the legacy flow performs *after* the hook's insertion point. Anything not replicated in the v4 path is a silent regression.

---

## Security

| Check | Status |
|---|---|
| No secrets / credentials in code | ✅ |
| No `process.env` reads | ✅ |
| Handler validates writes target "tasks" file only | ✅ — `file: "tasks" as FileKey` hardcoded |
| LLM-supplied ids referenced in `update`/`delete` against `tasksIndex` (prompt rule) | ✅ — prompt is explicit; id format validated by executor |
| Phrase hashed before logging (existing FEAT051 pattern) | ✅ — unchanged |
| applyWrites errors don't leak state internals to user | ✅ — `writeError` is just `err.message` |

No security issues.

---

## Performance

| Check | Status |
|---|---|
| Single LLM call per dispatch (ADR-001) | ✅ Haiku for task_management; one tool_use returned |
| Resolver computes 5 keys eagerly when declared | ⚠️ All 5 fire on every task phrase. Acceptable — `buildTaskIndex` is fast (filter + map); `topicList` and `existingTopicHints` are O(topics). Can lazy-cache later if Haiku latency becomes the bottleneck. |
| `applyWrites` already optimized (FEAT043 path) | ✅ Reused as-is |
| Bundle size impact | Negligible — task_management folder is small |

No performance issues blocking approval.

---

## Architecture Compliance

| Rule (per AGENTS.md) | Status |
|---|---|
| One LLM reasoning call per phrase (ADR-001) | ✅ |
| Skills are folders | ✅ |
| Skill handlers must write through filesystem.ts | ⚠️ Handler delegates to `executor.applyWrites` which uses filesystem.ts internally (legitimate path). No direct disk writes. |
| `handlers.ts` no work at module-load | ✅ — only function exports; lazy-import of executor |
| Routing/orchestration logs every decision | ✅ — unchanged from FEAT056 |
| No top-level Node imports in app-imported modules | ✅ — handler doesn't import fs directly; lazy-imports executor |
| `npm run build:web` verification | ✅ — bundle exports |
| v4 stack Node-only | ✅ — gate skips on web; handler also wrapped in lazy import |
| When inserting hook into long pipeline, audit downstream side effects | ✅ Fixed in B2 (flush call added) |

No architecture violations.

---

## Code Quality

### Acceptable per existing project conventions
- `console.warn` / `console.error` matches existing modules
- `as unknown as TaskActionArgs` cast tolerated for LLM tool args (no schema validator at runtime)
- Lazy `require("./assembler")` in resolver matches the existing `topicManager` lazy-require pattern in same module

### Naming
- `submit_task_action` — single tool, action-noun verb. Matches ActionPlan vocabulary.
- `TaskActionArgs` — local interface, not exported. Coder note: if FEAT083 etc. need similar shapes, extract to a shared types module.

### Function size
- handler is ~50 lines, single responsibility. Acceptable.
- `computeContextValue` is ~30 lines with one switch — clear, easy to extend for FEAT058+.

### Documentation
- Top of `handlers.ts` documents the args shape and the single-tool design choice
- Inline comment in handler explains why state-less calls are valid (test mode)
- B2-related comment in chat.tsx documents the flush requirement clearly
- Inline note in handler about persistence boundary (handler ≠ flush)

---

## Testability

| Check | Status |
|---|---|
| Pure functions for business logic | ⚠️ `applyWrites` has side effects (state mutation), but it's tested separately. Handler logic above the call is pure (filter + map). |
| Dependencies injectable | ✅ — handler reads `state` from `ctx`; tests pass `{ state: undefined }` to skip applyWrites |
| No logic at module level | ✅ |
| Explicit return types | ⚠️ Handler returns `unknown` (matches `ToolHandler` type). Caller (dispatcher) reads specific fields. Acceptable. |
| Errors typed | ⚠️ Plain `Error` — same project convention |

No testability issues.

---

## Required Changes

**None remaining.** B1 and B2 applied in this review.

---

## Optional Suggestions (advisory)

1. **Extract a shared `TaskActionArgs`-like type** when FEAT058 (notes) ships. Per CR-FEAT055-style noted "DI via opts is the v4 pattern" — similarly, "args interface mirroring ActionPlan" is becoming a pattern. Wait for the second instance before extracting.

2. **Consider `await applyWrites` retry logic** for transient failures (file IO, lock contention). Out of scope for FEAT057; could matter on Capacitor mobile where the SQLite lock may be contended.

---

## Pattern Learning — additions to AGENTS.md

Two real lessons from B2 (added):

- **When a v4 hook short-circuits the legacy flow, audit every side effect** (flush calls, scheduler triggers, hot-reload notifications, telemetry sends) the legacy flow performs *after* the hook's insertion point. Anything not replicated in the v4 path is a silent regression. (CR-FEAT057 B2)
- **`executor.applyWrites` mutates state and marks `_dirty`; it does NOT persist to disk.** The chat surface owns the flush call. Any new dispatcher / consumer that calls `applyWrites` must follow with `flush(state)` if `state._dirty.size > 0`. Document in `executor.ts` JSDoc and any new dispatcher. (CR-FEAT057 B2)

---

## Sign-off

Code review **APPROVED WITH COMMENTS**. Tester (stage 7) may proceed.

**Status update:** FEAT057 → `Code Reviewed`.

**Outstanding for separate action:**
- 10-phrase regression test (Stage 7)
- Manual smoke (user's call after merge)
- Capacitor smoke (accumulated v4 follow-up)
- Legacy cleanup PR (Story 7) — separate follow-on after parity bake-in
