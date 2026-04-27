# FEAT057 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT057_Migrate_taskmanagement_intents_taskcreate_taskupdate_taskquery_to_v4_skill.md`
**Refs:** `docs/v4/02_skill_registry.md`, `docs/v4/01_request_flow.md`, `src/modules/executor.ts:applyWrites`, `src/modules/assembler.ts:45-52,285`, `src/constants/prompts.ts`

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

This is the **first real intent migration** — establishes the pattern batch
1 will follow. The design is conservative on purpose: minimal changes to
the dispatcher (resolver + items pass-through), direct coupling to the
existing executor (no premature abstraction), and a clean two-PR rollback
strategy (skill ships in FEAT057; legacy cleanup follows after parity bake-in).

---

## 2. One-screen architecture

```
                     User: "add a task to call dentist tomorrow"
                                          │
                                          ▼
   chat.tsx → runTriage → shouldTryV4 (Node + enabled set non-empty)
                                          │
                                          ▼
   routeToSkill({ phrase })
        ├── embedding match: task_management top-1 (high confidence)
        └── returns RouteResult { skillId: "task_management", confidence: 0.85 }
                                          │
                                          ▼
   dispatchSkill(routeResult, phrase, { state: s })
        ├── gate: task_management ∈ enabled set ✓
        ├── registry.getSkill("task_management")
        ├── resolveContext({ tasksIndex, topicList, ..., userToday })
        ├── llm.messages.create({ system: prompt.md, tools: [submit_task_action] })
        ├── tool_use: submit_task_action({ reply, writes: [...], items, ...})
        ├── handler: applyWrites(plan, state)  ← reuses existing executor
        └── returns SkillDispatchResult { skillId, userMessage, items }
                                          │
                                          ▼
   chat.tsx → setMessages([{ content, items, v4Meta: {...} }])
                                          │
                                          ▼
                             User sees: "Added: Call the dentist (tomorrow)"
                                       + via task_management badge
                                       + (no items for create — items only on query)
```

**Key invariant:** the executor's full side-effect surface (dedup, conflict
detection, topic-tagging, lifestyle validation) runs inside the handler
unchanged. v4 doesn't reimplement any of it.

---

## 3. Alternatives considered

### 3.1 Single tool vs. multi-tool dispatch (Q1)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Single `submit_task_action` with `writes[]` (CHOSEN)** | Matches today's ActionPlan; dispatcher unchanged; LLM already familiar with this shape | Less LLM-natural for genuinely independent operations | **CHOSEN** |
| Three tools (`create_task`, `update_task`, `query_tasks`) | Each operation is its own tool, clearer schema for LLM | Requires multi-tool dispatch in FEAT055 (real refactor); LLM has to pick one even when intent spans operations | Reject |
| Multi-tool dispatch (LLM emits N tool_use blocks, dispatcher iterates) | Most LLM-natural | FEAT055 dispatcher refactor; complicates degraded-result handling | Reject for v2.02; revisit if real LLM behavior shows emit-multiple is common |

### 3.2 Handler ↔ executor coupling (Q2)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Direct `executor.applyWrites` import (CHOSEN)** | Pragmatic; reuses production-tested logic; zero abstraction cost | Skill folder now imports from executor — minor coupling | **CHOSEN** |
| New `executor.applyTaskWrite(state, item)` v4-handler API | Cleaner separation between v4 and v3 | Premature abstraction; one helper today, what about FEAT058 notes? Each domain gets its own helper? | Reject — revisit after batch 1 reveals the right factoring |
| Dispatcher calls executor (handler returns plan only) | Cleanest separation | Adds layers; dispatcher needs to know about ActionPlan shape | Reject |

The direct-import choice has one real gotcha: skill folders are dynamically
imported by the registry loader (FEAT054). When a skill imports from
`src/modules/executor.ts`, the import chain pulls executor + all its
transitive deps into the bundle as soon as the skill loads. This is
already the case for `priority_planning` and `general_assistant`, so no
new bundle concern.

### 3.3 Context resolver scope (Q4)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Extend `skillDispatcher.ts`'s minimal resolver** (CHOSEN) | One change benefits all batch 1 skills (notes/calendar will need similar context); centralized | The resolver grows by 5 keys; need helper imports | **CHOSEN** |
| Each skill builds its own context inline | Most decoupled | Duplicated logic across batch 1 skills | Reject |
| Generic state-passthrough (skill says `tasks: true`, dispatcher passes `state.tasks`) | Simple | Loses the existing index/cross-ref shape that the prompt expects | Reject |

### 3.4 Prompt sourcing (Q5)

PM proposed copy ~30 lines. Architect confirms. The legacy `SYSTEM_PROMPT`
is monolithic — refactoring it now to extract per-intent fragments would
churn unrelated code. After batch 1 lands, the natural cleanup is to
delete the per-intent rules from `SYSTEM_PROMPT` (since the legacy intents
are gone) and let each skill prompt own its rules.

### 3.5 Two-PR cleanup strategy (Q7)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Two PRs (skill, then cleanup) (CHOSEN)** | Safer — 48-hour bake-in catches parity issues before legacy fallback is removed | Two PRs to land instead of one | **CHOSEN** |
| One PR (skill + cleanup together) | Single atomic ship | If parity test shows < 9/10, we either revert the whole PR (loses skill work) or ship with a known regression | Reject |

The two-PR strategy means FEAT057-cleanup gets its own backlog entry. PM
agent creates that as FEAT058 ... wait, FEAT058 is reserved for the next
intent migration. Use a different number — call it FEAT057B-cleanup for
clarity in commit history (the feature-kit CLI auto-assigns a number, so
it'll be FEAT059 or whatever's next-free at cleanup time). Tracker note,
not blocker.

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependencies (all Done)

- FEAT054 SkillRegistryAPI
- FEAT051 routeToSkill, getV4SkillsEnabled
- FEAT055 dispatchSkill (extended in FEAT057 with items pass-through)
- FEAT056 chat.tsx wiring (extended in FEAT057 with items render)

### 4.2 Hard downstream consumers

| FEAT | How it depends |
|---|---|
| FEAT058+ (notes, calendar, inbox_triage, emotional_checkin) | Same migration pattern; reuses extended resolver keys + items pass-through |
| FEAT083 Topics skill | Items pass-through is exactly what topics digest needs |
| Legacy cleanup follow-on PR | Removes the legacy task_create/update/query branches once parity proven |

The single-tool-with-array pattern becomes the default migration template.
If a future skill needs multi-tool dispatch, it's a separate FEAT against
FEAT055.

### 4.3 Soft downstream

- **FEAT066 Feedback skill (Phase 6)** consumes the v4 badge tap action —
  unchanged by FEAT057.
- **FEAT055 Schema Registry (Phase 3)** will enforce that
  `task_management.dataSchemas.read` actually limits what context the
  dispatcher gives the skill. For v2.02 the dataSchemas are declarative
  only.

### 4.4 Coexistence with legacy

Per-phrase routing during the dual-path window:

| Phrase | shouldTryV4 | routeToSkill picks | dispatchSkill outcome | Path taken |
|---|---|---|---|---|
| "add a task X" | ✓ | `task_management` (high confidence) | runs handler → applyWrites | **v4** |
| "show my tasks" | ✓ | `task_management` (high confidence) | runs handler → items | **v4** |
| "what should I focus on" | ✓ | `priority_planning` | runs handler | **v4** (FEAT055/056) |
| "tell me a joke" | ✓ | `general_assistant` (fallback) | runs handler | **v4** (FEAT056) |
| "schedule a meeting" | ✓ | `general_assistant` via fallback (calendar not migrated yet) | redirects user | v4 → user retries → legacy `calendar_create` |

All other intents stay legacy until their migrations ship.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Context resolver gets a key wrong → skill prompt sees stale data | Medium | High | 5 new resolver keys each get a unit test asserting correct shape from fixture state |
| Direct executor coupling has a circular import or test isolation problem | Low | Medium | Architect verified during stage 3; tests inject state via ctx parameter — no global executor state |
| 10-phrase parity test reveals < 9/10 match | Medium | Medium | Two-PR cleanup strategy means FEAT057 still ships skill (with safety net) even if parity isn't perfect; cleanup PR delays until parity hits target |
| `buildTaskIndex` export changes break assembler | Low | Low | Just changing visibility (private function → exported); no behavioral change |
| LLM misinterprets focused prompt and emits malformed `submit_task_action` args | Medium | Low | Handler defensively coerces missing fields to defaults; degraded-but-not-broken |
| `applyWrites` writes are observable side effects (state mutation, file writes via `flush`); test fixtures must clean up | Medium | Low | Tests use isolated state objects, never call `flush`. Coder note for stage 5. |
| Prompt drift between legacy `SYSTEM_PROMPT` and `task_management/prompt.md` | High over time | Low | Cleanup PR (Story 7) removes the legacy CRUD lines; once removed, no drift surface |

---

## 6. Conditions before code-review approval

Non-negotiable:

1. **All revised ACs (per §3 architecture-notes "Revised AC mapping")** testable + tested in stage 7. *(Note: spec didn't have a "Revised AC mapping" — pursued the spec's original Story 1-8 ACs directly.)*
2. **`SkillDispatchResult.items?`** added to `src/types/orchestrator.ts`.
3. **Dispatcher resolver** supports all 5 new keys; each has a test.
4. **Handler never throws** on missing args — defensive defaults.
5. **`buildTaskIndex` exported** from `assembler.ts` (stays in same file).
6. **Boot wiring** appends `"task_management"` to `setV4SkillsEnabled([...])`.
7. **chat.tsx** passes `dispatchResult.items` onto the rendered message.
8. **Bundle gate** (`npm run build:web`) passes per AGENTS.md.
9. **No `process.env` reads** added.
10. **10-phrase regression test** ships in the test file with explicit
    expected outputs for both legacy and v4 paths.
11. **Parity threshold ≥ 9/10** verified before status moves to Done. If
    parity is < 9/10, FEAT057 ships dual-path (skill enabled but legacy
    fallback intact via `applyWrites` consistency); legacy cleanup PR
    is deferred.

---

## 7. UX review

UX scope is zero new screens. Two visible changes for v4-handled task
phrases:

1. **"via task_management" badge** under the assistant bubble (FEAT056
   mechanism).
2. **`items` array renders identically** via existing `ItemListCard` — no
   layout change, no new component.

Replies should match today's confirmation phrasing as closely as the LLM
produces. The skill prompt explicitly directs short, action-confirmation
replies for create/update and item-only replies for query. Architect to
spot-check during stage 5; if Coder's prompt produces verbose / off-tone
replies, tighten.

---

## 8. Test strategy review

Spec is solid. Two architect-side notes for the Tester:

1. **The 10-phrase regression set should mix all three operations**
   (create / update / query) and include both unambiguous and ambiguous
   cases. Specifically:
   - 4 creates (clear, with date, with priority, ambiguous title)
   - 3 updates (mark done, set priority, delete)
   - 3 queries (overdue, by topic, by date range)

2. **Real-LLM smoke vs. stub-LLM tests:** stub LLM tests cover handler
   logic deterministically. A small one-shot real-LLM smoke at end of
   stage 7 (5 phrases, hit live Haiku) is recommended to verify the
   prompt actually produces well-formed `submit_task_action` calls in
   practice. Document the smoke results in test results doc.

---

## 9. Pattern Learning

After implementation:

- Likely confirmation: "single tool with array writes" is the default
  migration pattern for CRUD intents. Codify in AGENTS.md if FEAT058
  also goes this way.
- Likely confirmation: extending the dispatcher's resolver once per
  batch is fine; doesn't need a more elaborate Assembler until Phase 3.
- Watch for: the legacy `SYSTEM_PROMPT` getting hairy as more skills
  migrate and their CRUD rules get duplicated in skill prompts. May
  accelerate the prompt-cleanup PR strategy.

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.
