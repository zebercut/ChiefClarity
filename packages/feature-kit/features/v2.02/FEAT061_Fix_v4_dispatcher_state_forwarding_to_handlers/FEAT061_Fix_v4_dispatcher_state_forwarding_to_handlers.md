# FEAT061 — Fix v4 dispatcher state forwarding to handlers

**Type:** bug-fix
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up)
**MoSCoW:** MUST
**Category:** Architecture / Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** skill-migration, dispatcher, bug-fix, template-fix
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done — dispatcher), FEAT057 (Done — first handler with the cast pattern)
**Unblocks:** FEAT044 (Capacitor) end-to-end chat-write smoke; future skill migrations after FEAT060 inherit the typed `state` access from day one.

---

## Problem Statement

`src/modules/skillDispatcher.ts:131-133` invokes the routed skill handler with a context object that omits `state`:

```ts
handlerResult = await handler(toolArgs, { phrase, skillId: skill.manifest.id });
```

`DispatchOptions.state` is accepted at line 51 and consumed by `resolveContext` at line 85, but never forwarded to the handler `ctx`. Every v4 handler shipped by FEAT057-060 reads `(ctx as { state?: AppState }).state` to decide whether to call `applyWrites` (e.g. `src/skills/task_management/handlers.ts:38`, `src/skills/inbox_triage/handlers.ts:55`). Because state is always undefined on the dispatcher-mediated path, the production chat-write block in each handler is dead code.

---

## Impact

The chat-driven write path for `task_management`, `notes_capture`, `calendar_management`, and `inbox_triage` never persists. The bug has not surfaced yet because (a) v4 is gated to Node-only via `shouldTryV4`'s `isNode()` check so the web bundle still runs the legacy path, (b) FEAT044 Capacitor has not shipped, so the user has not exercised v4 chat writes end-to-end on mobile, and (c) FEAT060's timer-driven inbox flow is unaffected — `processBundle` owns its own `applyWrites` loop outside the handler. The handler unit tests pass because they invoke handlers directly with `state` in `ctx`, bypassing the dispatcher entirely. Once Capacitor lands this surfaces as a silent data-loss bug: chat-driven task / note / calendar / inbox creates appear to succeed but never reach disk. Discovered during FEAT060 testing — see FEAT060_test-results.md "Implementation/contract notes for follow-on work".

---

## User Stories

### Story 1 — Dispatcher forwards state to handler ctx

**As a** v4 chat-write user, **I want** the dispatcher to forward `state` into the handler's `ctx`, **so that** handlers can call `applyWrites` and my chat-driven creates actually persist.

**Acceptance Criteria:**
- [ ] `skillDispatcher.ts:133` passes `state: options.state` as a third field on the handler ctx.
- [ ] `ToolHandler` type in `src/types/skills.ts:25-28` declares the ctx shape with `state?: unknown` (or `AppState | undefined` — see Open Question 1) so callers no longer need the `(ctx as { state?: AppState }).state` cast.
- [ ] All four existing v4 handlers (`task_management`, `notes_capture`, `calendar_management`, `inbox_triage`) compile against the new signature without behavior change.
- [ ] No changes to `chat.tsx`, `inbox.ts`, or any other dispatcher caller — the existing `dispatchSkill(routeResult, phrase, { state })` call site already supplies state; only the handoff inside the dispatcher is fixed.

### Story 2 — Regression test per skill (the test that should have caught this)

**As a** developer migrating future skills, **I want** each skill's test file to assert that `dispatchSkill(..., { state })` causes the handler to receive state and `applyWrites` to mutate the fixture state, **so that** a future regression of the dispatcher-handler ctx contract fails loudly.

**Acceptance Criteria:**
- [ ] Each of `src/modules/task_management.test.ts`, `notes_capture.test.ts`, `calendar_management.test.ts`, `inbox_triage.test.ts` gains exactly one new test case named along the lines of *"dispatchSkill forwards state to handler ctx"*.
- [ ] Each test invokes `dispatchSkill` (not the handler directly) with a fixture state, a stub LLM client returning a single canonical write, and `enabledSkillIds` containing the skill id.
- [ ] Each test asserts the relevant fixture-state collection mutated (e.g. `state.tasks.length` increased, `state.notes.length` increased, `state.calendar.events.length` increased, etc.) — proving `applyWrites` actually ran.
- [ ] Existing direct-handler tests are left unchanged.

### Story 3 — Drop the `(ctx as { state?: AppState })` cast in handlers (cleanup)

**As a** future skill author, **I want** to read `ctx.state` directly with type safety, **so that** the cast pattern doesn't propagate to the next migration.

**Acceptance Criteria:**
- [ ] In each of the four handler files, the `const state = (ctx as { state?: AppState }).state;` line is replaced with typed access (`ctx.state` on a properly-typed handler context).
- [ ] Behavior is unchanged — the test suite passes without modification (other than the new tests from Story 2).
- [ ] If the architect chooses to defer this cleanup to a separate FEAT (see Open Question 2), Story 3 is split off and its acceptance criteria removed from this FEAT's scope.

### Story 4 — No regression elsewhere

**Acceptance Criteria:**
- [ ] All existing tests pass (`task_management`, `notes_capture`, `calendar_management`, `inbox_triage`, `skillDispatcher`, `router`, `skillRegistry`, `v4Gate`, plus the rest of the baseline).
- [ ] `npm run build:web` exports.
- [ ] `tsc --noEmit` is clean (only the pre-existing `executor.ts:229` warning).

---

## Out of Scope

- **Legacy classifier / `bulk_input` cleanup PR.** Accumulated from FEAT057-060; same pattern, post-bake-in. Not this FEAT.
- **AGENTS.md / `docs/new_architecture_typescript.md` updates from the FEAT057-060 backlog.** Tracked separately on the FEAT060 outstanding list.
- **FEAT044 Capacitor work.** This bug is a pre-condition for Capacitor smoke, not a Capacitor change.
- **Adding new resolver keys to `SUPPORTED_KEYS`.** No new context keys are required by this fix.
- **Refactoring `processBundle`'s own write loop in `inbox.ts`.** That path works today; the timer flow is unaffected.
- **A shared `src/skills/_shared/handlerContext.ts` typing module.** If the architect wants one, they can introduce it in stage 3 — PM does not pre-decide.

---

## Open Questions

1. **Make `state` required or keep it optional on the handler ctx?** Optional preserves the unit-test ergonomic where tests call handlers directly without state. Required makes the contract louder but forces every test to thread a fixture state. PM leans optional (matches today's pattern; required would be a wider change). Architect's call.
2. **Drop the `(ctx as { state?: AppState }).state` cast in scope here, or defer to a separate cleanup FEAT?** PM included it as Story 3 because it is the typed-access payoff that makes this fix worth doing. Architect may split it out if it bloats the diff or risks behavior change.
3. **Type `state` as `unknown` or `AppState | undefined` on the ctx?** `unknown` matches today's `(ctx as { state?: AppState })` defensive cast and keeps the `types/skills.ts` import surface tiny (no `AppState` dependency from the types module). `AppState | undefined` is more honest. PM leans `unknown` — every handler narrows to `AppState` at the use site already.

---

## References

- **Discovery:** `packages/feature-kit/features/v2.02/FEAT060_Migrate_inboxtriage_bulkinput_to_v4_skill/FEAT060_test-results.md` — section "Implementation/contract notes for follow-on work".
- **Bug site:** `src/modules/skillDispatcher.ts:131-133`.
- **Type to update:** `src/types/skills.ts:25-28` (`ToolHandler`).
- **Affected handlers:** `src/skills/task_management/handlers.ts:38`, `src/skills/notes_capture/handlers.ts`, `src/skills/calendar_management/handlers.ts`, `src/skills/inbox_triage/handlers.ts:55`.
- **Test files to extend:** `src/modules/task_management.test.ts`, `src/modules/notes_capture.test.ts`, `src/modules/calendar_management.test.ts`, `src/modules/inbox_triage.test.ts`.
- **Related FEATs:** FEAT054 (original dispatcher), FEAT057 / FEAT058 / FEAT059 / FEAT060 (the four migrations that introduced and propagated the cast pattern).

---

## Architecture Notes (architect, 2026-04-27)

**Open question decisions (final):**
1. **`state` optional, not required.** Preserves direct-handler unit-test ergonomics; matches today's pattern; required would force every existing test to thread fixture state. Story 3 still removes the cast.
2. **Cast cleanup stays in scope.** Story 3 ships with this FEAT. The typed access *is* the payoff — splitting it would leave dead `as { state?: AppState }` casts across four files and no enforcement that future skill authors stop writing them. Diff is small (4 lines, one per handler).
3. **Type `state` as `unknown` on `ToolHandler` ctx.** Keeps `types/skills.ts` decoupled from `types/index.ts` (`AppState` import would couple a stable contracts file to a churning domain model). Matches the existing defensive `(ctx as { state?: AppState })` posture — every handler narrows at the use site already.

**Files touched (3 source + 4 tests):**
- `src/modules/skillDispatcher.ts` — line 133, add `state: options.state` to handler ctx.
- `src/types/skills.ts` — `ToolHandler` ctx becomes `{ phrase: string; skillId: string; state?: unknown }` (named-shape, not `Record<string, unknown>`).
- `src/skills/{task_management,notes_capture,calendar_management,inbox_triage}/handlers.ts` — replace `(ctx as { state?: AppState }).state` with `ctx.state as AppState | undefined` (narrow at use site, same as today's intent).
- `src/modules/{task_management,notes_capture,calendar_management,inbox_triage}.test.ts` — one new test per file (Story 2).

**New patterns:** none. This unblocks an existing pattern (`ctx.state` access) by making the contract typed instead of cast-mediated.

**Risks:** Forwarding state to handlers that previously received `undefined` could expose latent bugs in handler logic that assumed state-absence (e.g. a test path that silently skipped writes is now wired and might fail differently). Mitigation: the four Story-2 regression tests run end-to-end through the dispatcher with fixture state and assert the expected mutation, which is exactly the path that would surface such a bug.
