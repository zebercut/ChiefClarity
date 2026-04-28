# FEAT061 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT061_Fix_v4_dispatcher_state_forwarding_to_handlers.md`
**Refs:** FEAT054 (original dispatcher), FEAT057-060 (the four
migrations that propagated the cast pattern),
`src/modules/skillDispatcher.ts:131-133` (the bug site),
`src/types/skills.ts:25-28` (`ToolHandler` shape),
`src/skills/{task_management,notes_capture,calendar_management,inbox_triage}/handlers.ts`
(line ~38 / ~28 / ~43 / ~55 — the four cast sites).

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions. Pure
unblocking fix — one line of dispatcher code, one type tweak, four
cast removals, four regression tests.

---

## 2. Architecture

The dispatcher accepts `options.state`, hands it to `resolveContext`
to populate the LLM prompt, but never forwards it to the handler ctx.
Handlers read `(ctx as { state?: AppState }).state` and find
`undefined`, so every chat-driven `applyWrites` block is dead code on
the dispatcher path. Fix: add `state: options.state` to the ctx
literal at `skillDispatcher.ts:133`, type the ctx shape on
`ToolHandler`, drop the four casts. Same pattern, no new abstraction,
no new module. Future skill authors get `ctx.state` as a typed field
from day one.

---

## 3. Alternatives considered

### 3.1 Type-the-ctx vs cast-cleanup-only

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Forward `state` in dispatcher only; leave the casts in place | Smallest possible diff (1 line + 4 tests) | The casts now lie — they say `as { state?: AppState }` against a `Record<string, unknown>` type, when the runtime shape *does* have `state`. Future authors keep writing the cast. The bug recurs the next time someone adds a skill and forgets `ctx.state` is typed. | Reject. |
| **(b) Forward `state` AND type the ctx AND drop the four casts (CHOSEN)** | Cast pattern dies. Future migrations get typed `ctx.state`. Diff stays small (4 cast removals, all visibility-pattern, behavior-identical). | Touches four handler files in this FEAT. | **CHOSEN** — the cleanup *is* the typed-access payoff per spec Open Q2. |
| (c) Defer (b) to a separate FEAT | Keeps this FEAT to one file | Splits the typed-access work across two FEATs for no scoping benefit. The cast removal cannot regress behavior — it's pure type narrowing. | Reject — artificial split. |

### 3.2 Required vs optional `state` on handler ctx

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Required (`state: unknown`) | Loudest contract; impossible to forget; the bug literally cannot recur | Every existing direct-handler unit test (FEAT057-060) needs a fixture-state argument. Wider blast radius than the bug being fixed. | Reject. |
| **Optional (`state?: unknown`) (CHOSEN)** | Matches today's `(ctx as { state?: AppState })` defensive pattern. Direct-handler tests keep working as written. The Story-2 dispatcher-level regression tests are what enforce the contract going forward. | Future skill author could still pass an empty ctx in a test that exercises the write path — but they'd see `state` undefined and the test would obviously fail. | **CHOSEN** — matches PM lean, matches existing handler defensive code, smallest correct change. |

### 3.3 `unknown` vs `AppState | undefined` on ctx

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `AppState | undefined` | Honest about runtime shape. No use-site narrowing. | `types/skills.ts` is the stable contracts module. Importing `AppState` from `types/index.ts` couples the registry contract to the churning domain model. Every domain-model field-rename now propagates to the contract surface. | Reject. |
| **`unknown` (CHOSEN)** | `types/skills.ts` stays decoupled. Each handler narrows at use site (`ctx.state as AppState | undefined`) — identical to today's `(ctx as { state?: AppState }).state` posture, just typed on the ctx instead of the cast. | One token of narrowing per handler. | **CHOSEN** — preserves contract module's stability per FEAT054 design intent. |

---

## 4. Cross-feature concerns

- **FEAT057 (task_management)** — chat-write block currently dead on
  the v4 path. Fix unblocks it. Story-2 test in
  `task_management.test.ts` proves the pass-through.
- **FEAT058 (notes_capture)** — same. Chat-driven note creates were
  silently dropped on v4. Fixed.
- **FEAT059 (calendar_management)** — same. Chat-driven calendar
  creates / updates / cancels were silently dropped on v4.
  Recurring-rejection prompt path was already correct (it short-circuits
  before `applyWrites`); only the persisting-writes path was dead.
- **FEAT060 (inbox_triage)** — chat-driven path was dead, but the
  timer-driven `processBundle` flow owns its own `applyWrites` loop
  outside the handler, so it kept working. After this fix, the
  chat-driven inbox-paste path also persists. The timer path is
  unchanged — `processBundle` still calls `applyWrites` directly; the
  handler's internal `applyWrites` block is a no-op when called from
  `processBundle` because that caller doesn't pass `state` to
  `dispatchSkill`. (It bypasses dispatcher state forwarding entirely
  and that is intentional and correct for that flow.)
- **FEAT044 (Capacitor)** — un-blocked. End-to-end chat-write smoke on
  mobile depends on this fix; without it, every v4 chat write is
  silent data-loss the moment Capacitor takes the web bundle out of
  legacy fallback.
- **Future skills (FEAT063+)** — get typed `ctx.state` from day one.
  Cast pattern stops propagating.

**Latent issue:** the timer-driven inbox path (`processBundle` →
`dispatchSkill(rt, chunk, { /* no state */ })`) means the inbox handler's
internal `applyWrites` never runs from that caller, but the caller does
its own write loop. Today this is double-bookkeeping that happens to be
benign. Worth a flag for the next architect who refactors
`processBundle`. Not this FEAT's problem.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Forwarding `state` exposes latent handler bugs that assumed state-absence | Low | Medium | Story-2 tests run each migrated handler end-to-end through `dispatchSkill` with fixture state and assert the expected mutation. If a handler had a state-absent assumption, the Story-2 test surfaces it. |
| Cast removal alters narrowing semantics in a handler (e.g. an `if (!state)` branch becomes type-narrowed differently than today) | Low | Low | Behavior-equivalent narrowing: `(ctx as { state?: AppState }).state` and `ctx.state as AppState | undefined` produce the same runtime value and the same compile-time narrow. Existing tests cover. |
| Inbox timer path double-write (handler `applyWrites` runs *and* `processBundle` runs its own loop) | Very Low | High | Confirmed in §4: `processBundle` does not pass `state` to `dispatchSkill`, so the inbox handler's internal `applyWrites` block is gated by `if (state && plan.writes.length > 0)` and stays dormant on the timer path. Verified by reading `inbox.ts` and `inbox_triage/handlers.ts:77`. |
| `types/skills.ts` ctx-shape change ripples to other `ToolHandler` consumers we haven't accounted for | Low | Low | `ToolHandler` is consumed only by `LoadedSkill.handlers` (registry) and the four migrated skill `handlers.ts` files. `tsc --noEmit` will surface any miss. |

---

## 6. Conditions

1. **Dispatcher line 133 forwards state.** The handler ctx literal becomes
   `{ phrase, skillId: skill.manifest.id, state: options.state }`.
   No other dispatcher changes.
2. **`ToolHandler` ctx is named-shape, not `Record<string, unknown>`.**
   `src/types/skills.ts:25-28`:
   `(args: Record<string, unknown>, ctx: { phrase: string; skillId: string; state?: unknown }) => Promise<unknown>`.
   `state` is `unknown`, not `AppState | undefined` — preserves the
   contracts module's decoupling from the domain model.
3. **All four migrated handlers replace the cast.** In each of
   `task_management/handlers.ts`, `notes_capture/handlers.ts`,
   `calendar_management/handlers.ts`, `inbox_triage/handlers.ts`,
   replace `const state = (ctx as { state?: AppState }).state;` with
   `const state = ctx.state as AppState | undefined;`. No other
   handler logic changes.
4. **One Story-2 regression test per migrated skill.** Each of
   `task_management.test.ts`, `notes_capture.test.ts`,
   `calendar_management.test.ts`, `inbox_triage.test.ts` gains a
   single test invoking `dispatchSkill(routeResult, phrase, { state, llmClient, registry, enabledSkillIds })`
   with a stub LLM returning one canonical write. Test asserts the
   relevant fixture-state collection mutated. Existing direct-handler
   tests untouched.
5. **`tsc --noEmit` clean** (only the pre-existing `executor.ts:229`
   warning remains).
6. **`npm run build:web` exports** without warnings introduced by
   this change.
7. **No changes** to `chat.tsx`, `inbox.ts`, `executor.ts`,
   `assembler.ts`, `router.ts`, `types/index.ts`, or any other
   dispatcher caller. The fix is local to the dispatcher, the
   `ToolHandler` type, and the four handler files.

---

## 7. UX

**Zero changes.** Bug fix is invisible end-to-end except that
chat-driven v4 writes now actually persist. No prompt change, no
chat surface change, no copy change.

---

## 8. Test strategy

**One regression test per migrated skill** (the test that should have
caught this). Each test:

1. Builds a fixture `AppState` with the relevant collection (tasks /
   notes / calendar.events / etc.) starting empty or at known length.
2. Stubs the LLM client to return a single canonical tool call (one
   write op).
3. Stubs the registry with the real skill (loaded from disk via the
   test fixtures the FEAT057-060 tests already use).
4. Calls `dispatchSkill(routeResult, phrase, { state, llmClient, registry, enabledSkillIds })`.
5. Asserts the relevant fixture-state collection grew by 1.

**Why this is the right test:** the existing direct-handler tests
invoke handlers with `state` already in `ctx`, bypassing the
dispatcher entirely — they cannot catch the dispatcher-handoff bug.
A regression test at the `dispatchSkill` boundary is the only level
that proves the contract end-to-end.

**Out of scope:** real-LLM smoke (this is a type / wiring fix, not a
prompt or behavior fix); cross-handler integration; performance.

---

## 9. Pattern Learning

The Story-2 test (`dispatchSkill forwards state to handler ctx →
fixture mutates`) is now a **template requirement for FEAT063+**.
Every future skill migration ships this regression test alongside its
handler unit tests. The direct-handler tests prove the handler does
the right thing *given* state; the dispatcher-level test proves the
handler *receives* state. Both are needed; either one alone leaves
the gap that produced FEAT061.

**AGENTS.md follow-up (low-priority, may roll into the FEAT057-060
docs cleanup PR rather than this FEAT):** add an entry to the
skill-migration template — "Every skill ships a `dispatchSkill`-level
test that asserts the handler's `applyWrites` mutated the fixture
state. Direct-handler tests are not sufficient — they bypass the
dispatcher and would not catch a contract regression at the ctx
boundary."

---

## 10. Sign-off

Architect approves. Conditions §6 binding (7 items). Coder may
proceed without further review — the post-architect human gate has
been removed for this FEAT, and the three open questions are decided
in §3.

**Pay special attention to:**
- Condition 4 (regression tests). The test must call `dispatchSkill`,
  not the handler directly. Calling the handler directly defeats the
  whole point — it's how this bug shipped in the first place.
- Condition 2 (`state: unknown` on `ToolHandler`). Resist the
  temptation to import `AppState` into `types/skills.ts`. The
  contracts module decoupling is load-bearing for FEAT054 / FEAT070
  / FEAT080.
- The narrowing pattern in handlers stays
  `ctx.state as AppState | undefined` — same defensive shape as
  today, just on a typed ctx field instead of a casted ctx record.
- Inbox timer path (FEAT060 `processBundle`) is unaffected because
  it deliberately does not pass `state` to `dispatchSkill`. Do not
  "fix" that — it's intentional.
