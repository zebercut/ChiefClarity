# FEAT055 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT055_POC_priorityplanning_skill_proves_FEAT054FEAT051_endtoend.md`
**Architecture refs:** `docs/v4/01_request_flow.md §3`, `docs/v4/02_skill_registry.md`, `docs/v4/09_dev_plan.md §5 Phase 1`

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

Two material findings reshape the spec — see Architecture Notes "Two
findings". The architect made these calls without re-confirming with the
user (per "do not ask my confirmation" instruction):
1. **Story 4 pivots** from "parity vs legacy `priority_ranking`" to
   "fixture-based correctness" because no legacy intent exists to mirror.
2. **chat.tsx wiring deferred** to the next FEAT (skill batch 1) — end-to-end
   proof for FEAT055 lives in `skillDispatcher.test.ts`, not in the running
   chat surface.

Both findings shrink scope and reduce risk. The user can override either by
asking for a follow-up FEAT.

---

## 2. Architecture summary (one screen)

```
                    ┌─────────────────────────┐
                    │  Boot (app/_layout.tsx)  │
                    │  setV4SkillsEnabled([    │
                    │   "priority_planning"    │
                    │  ])                      │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  loadSkillRegistry()     │
                    │  scans src/skills/       │
                    │  loads priority_planning │
                    └────────────┬────────────┘
                                 │
                                 ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Test or future chat.tsx consumer                        │
   │                                                          │
   │  routeResult = await routeToSkill({ phrase })            │
   │     ↓                                                    │
   │  result = await dispatchSkill(routeResult, phrase)       │
   │     ↓                                                    │
   │  if (result === null) → fall back to legacy              │
   │  else → render result.userMessage                        │
   └─────────────────────────────────────────────────────────┘

   Inside dispatchSkill (the new module):
     ┌─────────────────────────────────────────────────────────┐
     │  1. check getV4SkillsEnabled() — return null if missing │
     │  2. registry.getSkill(routeResult.skillId)              │
     │  3. resolve context per skill.contextRequirements       │
     │  4. LLM call with skill.prompt + skill.handlers' tools  │
     │  5. dispatch tool call to skill.handlers[toolName]      │
     │  6. return { skillId, toolCall, handlerResult, userMsg } │
     └─────────────────────────────────────────────────────────┘
```

**Key invariant:** dispatcher returns `null` whenever the v4 path can't
or shouldn't run for this skill. Caller falls back. No throws on
runtime failures.

---

## 3. Alternatives considered

### 3.1 Story 4 pivot (parity vs fixture-correctness)

The spec assumed a legacy `priority_ranking` intent existed to compare
against. Code audit showed it doesn't. Three options:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Pivot target intent to `task_create` (which exists) | Real parity test possible | Different shape (CRUD, not reasoning) — doesn't exercise Sonnet path | Reject — defeats POC goal |
| Skip Story 4 entirely | Simplest | No correctness signal at all | Reject |
| **Pivot Story 4 to fixture-based correctness** | Tests prove the dispatcher runs the right tool against fixture states; no legacy needed | Doesn't validate against an "old truth" | **CHOSEN** |

The fixture-correctness approach matches what the FEAT054 and FEAT051 tests
already do for their layers. Consistent.

### 3.2 chat.tsx wiring (now or defer)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Wire chat.tsx now | User-visible proof | High risk in a 600-line file with complex pending-context logic; little marginal proof beyond what tests already give | Reject for v2.01 |
| **Defer to skill batch 1 (next FEAT)** | Bundle the wiring with 5+ skills going through it at once; lower per-skill risk; tests prove dispatcher contract | No live-app demo of FEAT055 alone | **CHOSEN** |
| Wire a separate dev-only chat surface | Pure proof, no risk | More code to write and throw away | Reject |

### 3.3 Context resolver scope

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Full Assembler with all `02_skill_registry.md §4` features | Future-proof | Massive scope creep; the full Assembler is its own FEAT in Phase 3 | Reject |
| **Minimal resolver supporting 5 declaration keys** | Just enough for `priority_planning`; clear extension point | Will need rewrite when more skills land | **CHOSEN** |
| No resolver — pass raw state to skill | Simplest | Defeats the per-skill-context point of v4 | Reject |

The minimal resolver supports: `userProfile`, `objectives`, `recentTasks`,
`calendarToday`, `calendarNextSevenDays`. Unknown keys log a warning and are
skipped. Replaced by the full Assembler in Phase 3.

### 3.4 Persistence (priority_log write)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Wire `filesystem.ts` write in handler | Complete | Couples FEAT055 to executor changes (which are FEAT080's scope) | Reject |
| **Console-log only for v2.01 POC** | Simple, scoped | Skill produces ranking but doesn't persist | **CHOSEN** |
| Mock `filesystem.ts` and assert in test | Test-only persistence | Confusing semantics | Reject |

Persistence ships with FEAT080 batch 1 alongside chat.tsx wiring. Documented
in spec.

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependencies

| Dep | Status |
|---|---|
| FEAT054 SkillRegistryAPI | Done |
| FEAT051 routeToSkill / setV4SkillsEnabled | Done |

### 4.2 Hard downstream consumers

| FEAT | How it depends |
|---|---|
| FEAT080 (skill batch 1) | Will reuse `dispatchSkill`. Will wire `chat.tsx`. Will add 5+ skills + `general_assistant`. |
| FEAT081 (skill batch 2) | Same |
| All future skills | Same dispatcher |

`SkillDispatchResult` and `dispatchSkill` signatures become a stability
contract once FEAT080 ships. PR review must reject breaking changes
without a migration note.

### 4.3 Soft downstream

- **FEAT055/Schema Registry (Phase 3)** will replace the minimal context
  resolver with the full policy-aware Assembler. Migration: dispatcher's
  context-build phase swaps from inline resolver to Assembler call.
- **FEAT080's chat.tsx wiring** will sit before line 424's
  `classifyIntentWithFallback` call. The dispatcher returns null when v4
  can't handle it; chat.tsx falls through to legacy.

### 4.4 Coexistence with legacy

For v2.01, **no consumer calls the dispatcher.** Legacy chat dispatch is
unchanged. The dispatcher exists but is exercised only in tests. Once
FEAT080 wires chat.tsx, the dual-path window opens (legacy + v4 side by
side, gated by `setV4SkillsEnabled([...])`).

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `priority_planning` prompt drifts from quality bar in production once chat.tsx is wired | Medium | Medium | Real prompt quality verified at FEAT080 wiring time, not now. POC bar is "produces structured output", not "high-quality output" |
| Context resolver's minimal key set doesn't cover what `priority_planning` actually needs | Low | Low | Architect already specified the 5 keys to match the manifest's declared needs |
| `SkillDispatchResult` interface needs change after FEAT080 lands | Medium | Medium | Treat as public API; PR review rejects breaking changes |
| Dispatcher silently returns null when consumer expects a result | Low | High | Tests explicitly cover the null-return cases (4 of them — see Testing Notes); contract documented |
| Stub LLM tests pass but real LLM produces malformed tool call | Medium | Low for POC | Dispatcher handles unknown-tool-name gracefully (degraded result); real-LLM smoke happens at FEAT080 |
| Boot wiring in `app/_layout.tsx` accidentally enables v4 for production users before chat is wired | Low | Low | No effect — chat.tsx still calls legacy. The `setV4SkillsEnabled` only matters when `dispatchSkill` is called |

---

## 6. Conditions before code-review approval

Non-negotiable gates the Coder must hit:

1. **All revised ACs (per §3 architecture-notes "Revised AC mapping") testable + tested** in `skillDispatcher.test.ts`.
2. **`SkillDispatchResult` exported from `src/types/orchestrator.ts`** — not inline.
3. **Dispatcher never throws** on runtime failures. Returns null on can't-handle, degraded result on LLM failure.
4. **No `process.env` reads** added.
5. **Skill folder exists** with all four required files; loader smoke check confirms it loads with no warnings.
6. **Boot wiring is one line** in `app/_layout.tsx` — no other shell changes.
7. **Persistence (`priority_log` write) explicitly NOT wired** — handler returns the data; persistence ships with FEAT080. Console-log only.
8. **Capacitor smoke test** — same as FEAT054/FEAT051. Defer to user verification.

---

## 7. UX review

UX scope is zero (per Architecture Notes). No conflicts.

---

## 8. Test strategy review

The Tester writes tests covering:
- All revised ACs (Story 1 boot/route, Story 2 dispatch contract, Story 3 enable/disable gate, Story 4 fixture correctness, Story 5 regression check)
- 5-fixture-state correctness check with canned LLM responses
- Dispatcher null-return cases (4 of them)
- Dispatcher degraded-result cases (LLM throw, unknown tool name)

The test file is `src/modules/skillDispatcher.test.ts`. The fixture skill
(`priority_planning`) is committed to `src/skills/priority_planning/` —
production code, not `_examples/`. The loader will load it on every boot,
but until chat.tsx is wired, nothing exercises it at runtime.

---

## 9. Pattern Learning — additions to AGENTS.md

After implementation completes, the Code Reviewer extracts patterns. No
predictive additions.

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.

The two findings (priority_ranking doesn't exist; chat.tsx wiring deferred)
are documented in the spec's Architecture Notes "Two findings" section so
the Coder, Code Reviewer, and Tester all start from the same shared
understanding.
