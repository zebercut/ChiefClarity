# FEAT051 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT051_Skill_Router_and_Composer.md`
**Architecture refs:** `docs/v4/01_request_flow.md §1`, `docs/v4/02_skill_registry.md §2`, `docs/v4/07_operations.md` ADR-001/003, `docs/v4/11_v2_design_review.md §2 Phase 1`

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

Spec is well-scoped after the composer rejection. Architecture notes match `01_request_flow.md` exactly. The thresholds (0.80/0.40/0.15) are PM proposals — Architect confirms them as acceptable v2.01 starting values, to be re-evaluated by the Pattern Learner once usage data exists.

---

## 2. Architecture summary (one screen)

```
                   ┌──────────────────────────────┐
                   │      routeToSkill(input)      │
                   └──────────────┬───────────────┘
                                  │
   ┌──────────────────────────────┼──────────────────────────────┐
   │ (Step 0) directSkillId?      │                              │
   │   → routingMethod=direct     │                              │
   ├──────────────────────────────┤                              │
   │ (Step 1) phrase starts "/"?  │                              │
   │   exact-match structuralTrig │                              │
   │   → routingMethod=structural │                              │
   ├──────────────────────────────┤                              │
   │ (Step 2) embed phrase →      │                              │
   │   findSkillsByEmbedding(3)   │                              │
   │   empty? → fallback          │                              │
   ├──────────────────────────────┤                              │
   │ (Step 3) gate                │                              │
   │   top1≥0.80 + gap≥0.15?      │                              │
   │   → routingMethod=embedding  │                              │
   ├──────────────────────────────┤                              │
   │ (Step 4) tiebreaker          │                              │
   │   circuit open? → degraded   │                              │
   │   top1<0.40? → fallback      │                              │
   │   else: Haiku call           │                              │
   │   → routingMethod=haiku      │                              │
   ├──────────────────────────────┤                              │
   │ (Step 5) fallback            │                              │
   │   → general_assistant        │                              │
   │   missing? → top1+warn       │                              │
   └──────────────────────────────┘                              │
                                  ▼                              │
                       RouteResult { skillId, ... } ─────────────┘
```

Sequential pipeline. Each step short-circuits on hit. Router never throws.

---

## 3. Alternatives considered

### 3.1 File location (Open Q4)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Keep `src/modules/router.ts`, add new exports | Zero caller import updates; legacy + v4 coexist during dual-path window | File mixes legacy and v4 vocabulary briefly | **CHOSEN** |
| New `src/modules/orchestrator.ts`, deprecate router.ts | Matches v4 doc vocabulary | ~10 caller files need import updates; risk during dual-path | Reject for v2.01 |
| Re-export shim: `router.ts` re-exports from `orchestrator.ts` | Both names work | Two source-of-truth files; PR review fatigue | Reject |

The cleanup PR after FEAT080/081 complete the migration can rename then.

### 3.2 Disable mechanism (Open Q5)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `setV4SkillsEnabled(ids)` setter called from app boot | Honors AGENTS.md "no process.env outside settings.ts"; clean test seam (`_resetOrchestratorForTests`); explicit boot-time wiring | Slightly unusual pattern | **CHOSEN** |
| `process.env.V4_SKILLS_ENABLED` parsed in router.ts | Familiar | Violates AGENTS.md rule; harder to test | Reject |
| Module-level mutable boolean | Simplest | No way for tests to reset between runs | Reject |
| New file `src/config/featureFlags.ts` | Clean separation | Premature — only one flag; would be over-engineering for v2.01 | Reject; revisit when ≥3 flags exist |

The Coder must add `// TODO(FEAT035): replace with settings.get('v4SkillsEnabled')` at the setter site so the migration isn't lost.

### 3.3 Tiebreaker prompt content (Open Q2 confirmed)

| Option | Tokens | Pros | Cons | Verdict |
|---|---|---|---|---|
| `id` only | ~50 | Cheapest | Model has nothing to disambiguate on | Reject |
| `id` + `description` | ~150 | Adequate baseline | May miss nuance | Reject |
| `id` + `description` + 2 example trigger phrases | ~250 | Good middle ground | — | Considered |
| `id` + `description` + ALL `triggerPhrases` (5-10) | ~400 | Maximum context for accurate disambiguation | More tokens — but Haiku is cheap | **CHOSEN per "accuracy first"** |

Cost: ~$0.0001 per tiebreaker call. Even at 100 ambiguous phrases/day, that's $0.30/month. Tiny.

### 3.4 Fallback when general_assistant missing

| Option | Behavior | Verdict |
|---|---|---|
| Throw error | Forces dev to fix | Reject — router must never throw per ADR-001 spirit |
| Return top-1 with warning | Degrades gracefully | **CHOSEN** |
| Return empty skillId, let dispatcher handle | Pushes the burden | Reject |

The warning is loud (`console.warn`), and the dual-path window is short (~2 weeks until FEAT080 ships `general_assistant`).

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependency

| Dep | Why |
|---|---|
| FEAT054 SkillRegistryAPI | Calls `findSkillsByEmbedding`, `getSkill`, `getAllSkills`. **Status:** Done. |

### 4.2 Hard downstream consumers

| FEAT | How it depends |
|---|---|
| FEAT079 (POC priority_planning) | Routes through this orchestrator |
| FEAT080, FEAT081 (skill migrations) | Same |
| FEAT083 (topics skill) | Same |
| FEAT072 (companion skill) | Same |
| Any future skill | Same |

`RouteResult` shape becomes a stability contract. PR review must reject any field rename/removal without a migration note.

### 4.3 Soft downstream

- **FEAT066 Feedback skill (Channel A)** consumes the *"this didn't help"* tap. For v2.01 the tap only logs; FEAT066 wires the log entry into the feedback pipeline.
- **FEAT064 Pattern Learner** can propose threshold tuning (HIGH/GAP/FALLBACK constants) once usage data accumulates.
- **FEAT035 Settings Panel** — `setV4SkillsEnabled` migrates to `settings.get()` once FEAT035 lands.

### 4.4 Coexistence with legacy `router.ts`

During the dual-path window:
- Legacy `classifyIntent` and `PATTERNS` stay in `router.ts` untouched.
- New `routeToSkill` lives alongside as a separate exported function.
- `chat.tsx` (and headless runner) check `getV4SkillsEnabled()` — if non-empty, call `routeToSkill`; else call `classifyIntent`.
- Per-skill migration (FEAT079, then FEAT080 batch, then FEAT081 batch) flips skills from legacy to v4 by adding ids to `setV4SkillsEnabled([...])`.
- When the last legacy intent migrates, FEAT082 deletes `classifyIntent` and the regex `PATTERNS`.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Threshold values (0.80/0.40/0.15) wrong → over-fires tiebreaker or misroutes | Medium | Medium | Log every routing method; review distribution after 1 week of dogfood; Pattern Learner can propose adjustments |
| Tiebreaker accuracy < 90% on 20-phrase ambiguous set | Medium | Medium | Prompt is normal text — tune via prompt patch (no code change) |
| `general_assistant` missing during v2.01-only window → fallback warns repeatedly | High (during window) | Low | Documented as expected; FEAT080 ships it within ~2 weeks |
| Phrase embedder slow on Capacitor (FEAT044) | Medium | Medium | Same problem as FEAT054 — acceptable; explore async-parallel later |
| `RouteResult` interface changes after consumers ship | Medium | High | Treat as public API; PR review rejects breaking changes without migration note |
| Setter pattern unfamiliar → developers add `process.env` reads anyway | Medium | Low | TODO comment + AGENTS.md rule already in place; PR review catches it |
| Dual-path period: divergence between legacy and v4 routing on same phrase | Medium | High | The dual-path is gated by `setV4SkillsEnabled([...])` — only enabled skills take the v4 path. Per-skill rollout limits blast radius |

---

## 6. Conditions before code-review approval

Non-negotiable gates the Coder must hit:

1. **All ACs from the spec are testable and tested** (§Testing in spec).
2. **`RouteResult` and `RouteInput` interfaces exported from `src/types/orchestrator.ts`** — not inline in router.ts. Other modules import the types from `types/`.
3. **Router never throws.** Every external dependency wrapped in try/catch with a graceful-degradation path.
4. **No `process.env` reads added.** The setter is the only way to configure enabled skills.
5. **TODO comment at setter:** `// TODO(FEAT035): replace with settings.get('v4SkillsEnabled')`.
6. **Threshold constants exported** for test inspection (test must not duplicate the magic numbers).
7. **One migration per PR scope:** files touched limited to `src/modules/router.ts`, `src/types/orchestrator.ts`, plus the test file. `app/(tabs)/chat.tsx` wiring is **out of scope for FEAT051** — it's the consumer's concern (FEAT079 POC will wire its own consumer path). Architect call: keep this PR small.
8. **Capacitor smoke test:** verify the phrase-embedding step works in `npx cap sync` build (same concern as FEAT054 §6.7). May need to wait for the user to run; document the expectation.

---

## 7. UX review

UX scope is limited to the badge + tap action, both of which are added by the consumer (e.g., FEAT079's POC wiring), not by FEAT051. FEAT051 produces the data; the chat surface renders it.

No conflicts.

---

## 8. Test strategy review

Spec's Testing Notes are correct. Two architect-side notes for the Tester:

1. **Test fixtures co-located in `src/modules/router.test.ts`** as top-of-file constants — same pattern as `skillRegistry.test.ts` fixture skills built with `writeSkill()`. The 50-phrase set and 20-phrase ambiguous set are inline arrays of `{ phrase, expectedSkillId }`.
2. **Haiku tiebreaker mocked by default.** The tiebreaker function should accept an optional client parameter (dependency injection) so tests pass a stub returning a deterministic skill id. A real-LLM smoke test (1 phrase per release) is acceptable but not part of the per-CI run.
3. **`_resetOrchestratorForTests` is required for the setter** — without it, tests leak the v4-enabled state between cases.

---

## 9. Pattern Learning — additions to AGENTS.md

After implementation completes, the Code Reviewer agent extracts patterns. No predictive additions in this review.

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.
