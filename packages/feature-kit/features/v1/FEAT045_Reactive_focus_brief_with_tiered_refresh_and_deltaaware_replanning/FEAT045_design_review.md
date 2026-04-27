# Design Review: FEAT045 — Reactive focus brief with tiered refresh and delta-aware replanning

**Created:** 2026-04-13
**Reviewer:** Architect Agent
**Status:** Changes Required
**Spec:** `FEAT045_Reactive_focus_brief_with_tiered_refresh_and_deltaaware_replanning.md`

## Summary

FEAT045 defines a 3-tier reactivity system (TypeScript patches → Haiku refresh → Sonnet replan) to keep the focus brief live without repeated full-plan LLM calls. **The code for all three tiers is written and wired into the app UI.** However, the **headless runner** — responsible for ~70% of daily Sonnet token spend — is completely unaware of the tiers and still calls `generatePlan()` (full Sonnet `full_planning`) 3 times daily. This review adds WP-5 (headless integration) and WP-6 (reduce Haiku→Sonnet fallback) to close the gap before the feature can ship.

**Verdict:** Spec approved with two required additions (WP-5, WP-6). No architectural conflicts. Ready for development after this review.

---

## Acceptance Criteria Coverage

| AC | Architectural Answer | Status |
|----|----------------------|--------|
| Story 1: Brief updates instantly after task done | `patchBrief()` in `briefPatcher.ts`, called from `chat.tsx:519` and `focus.tsx:100` | Covered in app UI, **missing in headless runner** |
| Story 1: freeBlocks recalculated | `recalcFreeBlocks()` in `briefPatcher.ts:192` | Covered |
| Story 1: No LLM call | Pure TypeScript, verified — no imports from `llm.ts` | Covered |
| Story 2: Haiku refresh after 3+ patches | `shouldRefresh()` + `refreshBriefNarrative()` in `briefRefresher.ts` | Covered in `api-proxy.js:197`, **missing in headless runner** |
| Story 2: Only narrative fields updated | `refreshBriefNarrative()` only writes `executiveSummary`, `priorities`, `risks`, `companion` | Covered |
| Story 2: Cost < $0.001 | Haiku with ~300 input + ~200 output tokens = ~$0.0001 | Covered |
| Story 3: Delta-aware replan on "plan my day" | `buildReplanContext()` in `briefDelta.ts`, injected in `assembler.ts:91-96` | Covered |
| Story 3: Token cost ~50% less | Delta context replaces full state; `replanMode` prompt tells LLM to adjust not rewrite | Covered (needs measurement) |
| **NEW: Headless runner uses only 1 Sonnet/day** | Morning job keeps `generatePlan("day")`. Evening job replaced with Tier 2. | **WP-5 required** |
| **NEW: No silent Sonnet fallback on simple intents** | `SONNET_FALLBACK_INTENTS` whitelist in `llm.ts` | **WP-6 required** |

---

## Data Model

No new tables or entities. All types already exist:

```
FocusBrief (types/index.ts)
  _changelog?    BriefChange[]     -- added by FEAT045, line 610
  generatedAt    string            -- ISO timestamp of last generation
  dateRange      { start, end }    -- date range the brief covers
  days           DaySlot[]         -- per-day agenda
  ...

BriefChange (types/index.ts:583)
  type           BriefChangeType
  itemId         string
  itemTitle      string
  timestamp      string
  detail?        string
```

**New function (no new type):** `needsFullReplan(state): boolean` in `briefDelta.ts` — returns true only when 2+ fixed calendar events changed since `generatedAt`.

---

## API Contracts

No new API endpoints. All changes are internal module wiring between:
- `headless-runner.js` → `briefRefresher.ts` (new dependency)
- `headless-runner.js` → `briefPatcher.ts` (new dependency)
- `llm.ts` → `SONNET_FALLBACK_INTENTS` whitelist (internal change)

---

## Service Boundaries

```
headless-runner.js (scheduler)
  ├── morningJob()     → generatePlan()  → callLlm(Sonnet)     [KEEP]
  ├── eveningJob()     → refreshBrief()  → callHaiku(Tier 2)   [CHANGE from Sonnet]
  ├── lightCheck()     → refreshBrief()  → callHaiku(Tier 2)   [ADD]
  └── weeklyJob()      → generatePlan()  → callLlm(Sonnet)     [KEEP]

briefPatcher.ts      → pure TypeScript, no LLM dependency
briefRefresher.ts    → Haiku via injected function (DI pattern)
briefDelta.ts        → pure TypeScript, builds context for assembler
llm.ts               → model routing + fallback logic
```

Layer contracts respected: TypeScript owns patches and change detection, LLM owns narrative generation and planning.

---

## New vs Reusable Components

- **New:**
  - `needsFullReplan(state)` in `briefDelta.ts` — structural calendar change detector
  - `SONNET_FALLBACK_INTENTS` whitelist in `llm.ts` — controls which intents get Sonnet escalation
- **Reusable:**
  - `patchBrief()` — already works in app UI
  - `shouldRefresh()` + `refreshBriefNarrative()` — already works via `api-proxy.js`
  - `createRefreshLlmFn()` — same injection pattern, copy from `api-proxy.js:197-201`
  - `renderBriefToHtml()` — already called in headless `generatePlan`
  - `getChangelogCount()` — exported from `briefPatcher.ts`

---

## Design Patterns Used

- **Tiered degradation** — Tier 1 (free) absorbs most changes, Tier 2 (cheap) handles narrative staleness, Tier 3 (expensive) reserved for structural shifts or user request. This is the core cost-saving pattern.
- **Dependency injection** — `injectRefreshLlm()` decouples the refresher from the Anthropic SDK, allowing different callers (proxy, headless, tests) to inject their own implementation.
- **Circuit breaker** — existing pattern in `llm.ts` protects all LLM calls. No change needed.
- **Guard function** — `needsFullReplan()` acts as a gate before any non-morning Sonnet call. Prevents cost creep from future features that might add "helpful" replans.

---

## Risks & Concerns

### Performance
- **Tier 2 Haiku call latency:** ~500ms. Acceptable for background headless jobs. Not user-facing.
- **Tier 1 patch + freeBlocks recalc:** < 5ms. Already measured in app UI.

### Cost
- **Before:** ~$0.09-0.15/day (3 Sonnet plans + Haiku fallbacks)
- **After:** ~$0.03-0.04/day (1 Sonnet morning plan + occasional Haiku Tier 2)
- **Savings:** ~60-70% reduction in daily API cost

### Backwards Compatibility
- Evening "tomorrow" plan is removed. If any downstream feature depends on `state.focusBrief` being a "tomorrow" brief in the evening, it will break. **Check:** Searched for `variant === "tomorrow"` — only used in `generatePlan` variant detection and prompt text. No app UI depends on a "tomorrow" brief existing. Safe to remove.

### Race Conditions
- Headless runner already uses `.headless.lock` to prevent concurrent jobs. The `withJobLock` wrapper serializes morning/evening/light jobs. No new races introduced.

### Edge Case: Brief Not Generated by Morning
- The 30-minute missed-job-recovery check (`briefDate !== today → morningJob()`) handles this. If the headless runner wasn't running overnight, the first startup triggers a full morning plan. Unchanged behavior.

---

## UX Review Notes

No UX design surfaces for this feature (it's backend plumbing). The only user-visible change:

- **Evening view:** Previously showed a "tomorrow" brief. Now shows today's brief (kept current by Tier 1/2 patches). The tomorrow plan appears the next morning. Acceptable per user confirmation.

No gaps or conflicts.

---

## Testing Notes

### Unit Tests Required
- `needsFullReplan(state)` with 0, 1, 2 new calendar events → false, false, true
- `needsFullReplan(state)` with 5 completed tasks, 0 new events → false
- `needsFullReplan(state)` with brief from yesterday → false (different day)
- `shouldRefresh(state)` with 0, 2, 3 changelog entries → false, false, true
- `buildDelta(state)` correctly categorizes completed/new/cancelled items

### Component Tests Required (mocked dependencies)
- Headless `eveningJob` with 4 patched changes → calls `refreshBriefNarrative`, does NOT call `generatePlan`
- Headless `eveningJob` with 0 patched changes → does NOT call `refreshBriefNarrative`
- Headless `lightCheck` after inbox processing adds 3 patches → Tier 2 fires
- `SONNET_FALLBACK_INTENTS` — `bulk_input` Haiku failure returns null, does NOT call Sonnet

### Integration Tests Required
- Full day lifecycle: morning Sonnet plan → 3 task completions (Tier 1) → evening job fires Tier 2 Haiku refresh → verify brief has updated narrative, unchanged structure
- Headless startup with stale brief → morning job triggers, plan generated
- Headless startup with current brief → no morning job, light check only

### Scope Isolation Tests Required
- No — single-user app

### Agent Fixtures Required
- Haiku `submit_brief_refresh` response with 3 changelog entries (task_done × 2, event_added × 1)
- Record from live API, store as JSON fixture for deterministic testing

---

## Required Changes Before Approval

- [x] Add WP-5 (headless runner integration) to spec — **done in this review**
- [x] Add WP-6 (Sonnet fallback whitelist) to spec — **done in this review**
- [x] Add `needsFullReplan()` function spec — **done in this review**
- [x] Add Testing Notes section — **done in this review**

---

## Approved Implementation Plan

### Execution order (all WPs)

```
WP-1  (_changelog type)              → already coded ✅
WP-2  (Tier 1: briefPatcher)         → already coded ✅, wired to app UI ✅
WP-3  (Tier 2: briefRefresher)       → already coded ✅, wired to api-proxy ✅
WP-4  (Tier 3: briefDelta)           → already coded ✅, wired to assembler ✅
WP-5  (Headless runner integration)  → NEW, ready for development
  5.2  needsFullReplan() function     → standalone, add to briefDelta.ts
  5.1a Headless startup injection     → standalone
  5.1b Evening job rewrite            → needs 5.1a
  5.1c Light check Tier 2 addition    → needs 5.1a
WP-6  (Sonnet fallback whitelist)    → NEW, ready for development (independent of WP-5)
```

WP-5 and WP-6 can be developed in parallel.

### Files to modify

| File | Change | WP |
|------|--------|----|
| `src/modules/briefDelta.ts` | Add `needsFullReplan(state)` function | WP-5.2 |
| `scripts/headless-runner.js` | Inject Tier 2 at startup, rewrite evening job, add Tier 2 to light check | WP-5.1 |
| `src/modules/llm.ts` | Add `SONNET_FALLBACK_INTENTS` whitelist, guard fallback logic | WP-6 |

### Files NOT to modify
- `briefPatcher.ts` — already complete
- `briefRefresher.ts` — already complete
- `assembler.ts` — delta injection already wired
- `chat.tsx` / `focus.tsx` — app UI already wired

---

## Patterns to Capture

### For AGENTS.md (project-wide)
- **"One expensive call" rule:** When a feature involves periodic LLM calls, design for exactly ONE expensive (Sonnet) call per cycle (day/week). All incremental updates must use TypeScript patches or cheap (Haiku) calls. Never schedule multiple Sonnet calls for the same logical operation.
- **Headless runner parity rule:** When wiring a new module into the app UI, always check whether the headless runner also needs the same wiring. The headless runner is the biggest cost center because it runs unattended.

### For coding rules
- **Sonnet fallback whitelist:** The Haiku→Sonnet validation fallback must be gated by intent complexity. Simple CRUD intents (`task_create`, `bulk_input`, etc.) should fail gracefully rather than escalate to a more expensive model.
