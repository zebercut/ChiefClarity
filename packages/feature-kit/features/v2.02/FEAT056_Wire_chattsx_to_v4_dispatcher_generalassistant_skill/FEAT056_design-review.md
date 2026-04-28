# FEAT056 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT056_Wire_chattsx_to_v4_dispatcher_generalassistant_skill.md`
**Refs:** `docs/v4/01_request_flow.md`, `app/(tabs)/chat.tsx:360–428` (current dispatch loop)

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions. Open questions
all resolved by architect (see Architecture Notes "Open-question
resolutions"). The biggest call: **silent fallback** on degraded
results (Q2) — the dispatcher's "couldn't complete" message is for
log/audit, never user-facing.

---

## 2. One-screen architecture

```
chat.tsx processPhrase(phrase, now):
  ├─ checkEmotionalTone, friction-cooldown filter      [unchanged]
  ├─ runTriage(phrase, ...)                            [unchanged]
  ├─ if !triage.canHandle → return                     [unchanged]
  ├─ if triage.needsClarification → render+return      [unchanged]
  │
  ├─ ★★★ FEAT056 v4 hook ★★★
  │  if shouldTryV4({ state: s, triageLegacyIntent }):
  │    routeResult = await routeToSkill({ phrase })
  │    dispatchResult = await dispatchSkill(routeResult, phrase, { state: s })
  │    if dispatchResult && !dispatchResult.degraded:
  │      setMessages(... v4Meta: { skillId, confidence, routingMethod })
  │      return  ← v4 handled the turn
  │    // else fall through (null OR degraded)
  │
  ├─ let intent = triage.legacyIntent ? ... : await classifyIntentWithFallback
  │  (existing legacy flow below — unchanged)
  └─ ...
```

**Key invariant:** the only added control flow is a single `if` block
that may early-return. Legacy code below is byte-for-byte unchanged.

---

## 3. Alternatives considered

### 3.1 Silent fallback vs. show-degraded-then-fallback (Q2)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Silent fallback (CHOSEN)** | Cleaner UX; user sees one cohesive reply; v4 failure is invisible (good — don't telegraph internal complexity to user) | Loses transparency about what went wrong | **CHOSEN** |
| Show degraded + fallback | Transparent | User sees a confusing "I couldn't complete that with v4" then a normal reply 5 seconds later. Confusing dual-bubble. | Reject |
| Show degraded only (no fallback) | Most transparent | Bad UX; user gets a no-help message when legacy could have answered | Reject |

The dispatcher already logs every degraded result with `[skillDispatcher] dispatch ... degraded="..."` per CR-FEAT051 + CR-FEAT055-B1. That's where transparency lives — for developers, not users.

### 3.2 Multi-turn pending-context integration (Q3)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **v4 bypassed when pending-context (CHOSEN)** | Simple; preserves existing multi-turn behavior; no surprises | v4 skills can't have follow-up turns within a clarification | **CHOSEN for v2.02** |
| v4 supports pending-context | Future-proof | Requires dispatcher to know about multi-turn state; adds complexity to FEAT055's contract | Reject for v2.02; revisit when companion ships (clarification-heavy) |

`priority_planning` doesn't trigger clarification flows often enough for this to bite in v2.02. Companion (v2.08) is the right time to add multi-turn v4.

### 3.3 Pure-function gate vs. inline check

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Pure-function `shouldTryV4` (CHOSEN)** | Unit-testable in isolation; clear contract; can be reused by headless runner if it ever needs v4 | One extra file | **CHOSEN** |
| Inline `if` in chat.tsx | Less file overhead | Buried in 1000-line file; hard to test | Reject |

Per the Coder testability standard: business logic in pure functions.

### 3.4 Where to store `v4Meta`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **On the `ChatMessage` object (CHOSEN)** | Persists with chat history; renders consistently after reload; one source of truth | Extends existing type | **CHOSEN** |
| In separate side state | Doesn't touch `ChatMessage` | Lost on reload; render flicker; two places to keep in sync | Reject |
| Don't store, derive from logs | Most minimal | Logs are one-way; can't render after reload | Reject |

### 3.5 `general_assistant` model tier

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Haiku (CHOSEN)** | Cheap; freeform doesn't need reasoning; matches FEAT051's tiebreaker tier | Quality lower than Sonnet | **CHOSEN** |
| Sonnet | Higher quality | Cost matters for the most-frequently-hit fallback skill | Reject |

`general_assistant` is the safety net — fast and cheap is right.

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependencies (all Done)

- FEAT054 SkillRegistryAPI
- FEAT051 routeToSkill, getV4SkillsEnabled
- FEAT055 dispatchSkill

### 4.2 Hard downstream consumers

| FEAT | How it depends |
|---|---|
| FEAT057+ (per-intent migrations) | Each migration just adds an id to `setV4SkillsEnabled([...])` — no chat.tsx changes needed |
| FEAT083 Topics skill | Will route via the same v4 path, render via same `v4Meta` badge |
| FEAT072 Companion (Phase 8) | Same; will additionally need pending-context multi-turn support (Q3 deferred) |

The `v4Meta` field on `ChatMessage` is a stability contract — adding fields OK, removing/renaming requires migration.

### 4.3 Soft downstream

- **FEAT066 Feedback skill (Phase 6)** consumes the badge tap action.
  For v2.02 the tap only logs; FEAT066 wires the log into the feedback
  loop. Tap action signature is forward-compatible.
- **FEAT035 Settings panel (Phase 3)** will provide UI for
  `setV4SkillsEnabled`. For v2.02, the array stays hardcoded in
  `app/_layout.tsx`.

### 4.4 Coexistence with legacy

The dual-path window opens with this FEAT. Per skill, the routing is:

| Phrase routes to... | Skill in `setV4SkillsEnabled([...])`? | Path taken |
|---|---|---|
| `priority_planning` | Yes | v4 |
| `general_assistant` | Yes | v4 |
| `task_management` (not yet migrated) | No (skill doesn't exist) | router returns fallback or `general_assistant` |
| (legacy intent like `task_create`) | N/A (legacy path doesn't go through v4) | legacy |

**Edge case:** what if v4 router picks `general_assistant` for a phrase
that should have gone to a yet-to-be-migrated specialized skill? E.g.,
"add a task" — the user would currently get a `general_assistant`
response saying "sounds like you want to create a task" instead of an
actual created task. **Mitigation:** `general_assistant`'s prompt
explicitly redirects to specialized intents in the legacy path.
Architect-side note for the Coder: prompt must include
*"If the user asks for a specialized action (creating a task,
scheduling an event, planning), tell them you'll need to switch to the
specialized handler — do not pretend to do the action."*

This isn't perfect — it adds an extra round-trip for the user. The fix
is to migrate the specialized intents (FEAT057+), at which point the v4
router picks the right specialized skill.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| chat.tsx hook insertion has typo / breaks legacy flow | Low | High | Pure-function gate isolates decision; integration test asserts legacy path still works for non-enabled phrases |
| `general_assistant` "swallows" specialized phrases (e.g., "add a task" routes to `general_assistant` because no `task_management` skill exists yet) | High during dual-path window | Medium | Skill prompt explicitly redirects; user gets a polite "switch to the specialized handler" reply. Resolves once specialized skills land in FEAT057+ |
| Badge UX added to wrong renderer file | Medium | Low | Coder locates exact file in stage 5; if too disruptive, badge ships in FEAT057 instead of blocking FEAT056 |
| `v4Meta` field added to `ChatMessage` breaks chat history serialization | Low | Medium | Optional field (`?`); existing serializer should ignore unknown/optional fields. Tester verifies a saved-and-reloaded message preserves v4Meta |
| Headless runner accidentally inherits v4 routing | Low | Medium | Headless runner doesn't import `dispatchSkill` and doesn't call `setV4SkillsEnabled`. Out of scope by construction |
| Build:web fails on the chat.tsx changes | Low | High | The hook adds only standard imports; bundle gate per CR-FEAT055 catches it |
| Pending-context bypass means multi-turn clarification can't use v4 | Medium | Low | Documented; revisit when Companion ships in Phase 8 |

---

## 6. Conditions before code-review approval

Non-negotiable:

1. **All revised ACs from spec** are testable + tested.
2. **`shouldTryV4` is a pure function** in `src/modules/v4Gate.ts` with its own test file.
3. **`general_assistant` skill folder** exists with all 4 files + loads via FEAT054 smoke check.
4. **chat.tsx delta is < 30 lines** (excluding imports). One block, between line 419 and 422 in `processPhrase`.
5. **Legacy code path byte-equal below the hook** — verify with diff.
6. **Boot wiring updated** to `setV4SkillsEnabled(["priority_planning", "general_assistant"])`.
7. **Bundle gate (`npm run build:web`) passes** before marking Done. Per CR-FEAT055.
8. **Manual smoke documented** in test results doc — three scenarios per Spec §Testing Notes.
9. **`v4Meta?` is optional on `ChatMessage`** — chat history loaded from before v2.02 must work.
10. **`general_assistant` prompt explicitly redirects on specialized requests** per §4.4 mitigation.

---

## 7. UX review

- Badge: small text under bubble, muted color, format like *"via priority_planning"*. Architect to spot-check Coder's output for visual fit; if it looks wrong, it's a one-line CSS change.
- `general_assistant` replies should feel natural. The prompt drives quality — Coder copies the prompt template from spec §Architecture Notes.
- `Alert.alert` for badge tap is acceptable for v2.02. Custom popover lands when the chat surface gets a broader UX pass.

No conflicts.

---

## 8. Test strategy review

Spec is correct. Two architect-side notes:

1. **Locate the bubble renderer file** during stage 5 first. If badge addition is too disruptive (e.g., the renderer is a heavily-customized component used elsewhere), defer badge to a follow-up FEAT — don't block FEAT056 on UX polish.
2. **Manual smoke is mandatory** for FEAT056 — automated tests can't catch a visual regression in chat. Test results doc must include the three smoke scenarios with pass/fail per Spec §Testing Notes.

---

## 9. Pattern Learning

After implementation:
- Likely a new pattern: "consumer-side gate via pure function." If FEAT057+ each add their own gate, we may need to consolidate. Watch for it.
- Likely confirmation: silent fallback is the right default for any v4-vs-legacy dual-path window.

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.
