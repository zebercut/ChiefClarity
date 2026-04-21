# Code Review: FEAT045 — Reactive focus brief (WP-5 + WP-6)

**Created:** 2026-04-13
**Reviewer:** Code Reviewer Agent
**Status:** CHANGES REQUIRED
**Spec:** `FEAT045_Reactive_focus_brief_with_tiered_refresh_and_deltaaware_replanning.md`
**Design Review:** `FEAT045_design_review.md`
**Scope:** WP-5 (headless runner integration) + WP-6 (Sonnet fallback whitelist)

## Files Reviewed

| File | WP | Lines changed |
|------|----|--------------|
| `src/modules/briefDelta.ts` | WP-5.2 | +36 (new `needsFullReplan` function) |
| `scripts/headless-runner.js` | WP-5.1 | ~50 (startup injection, evening job rewrite, light check addition) |
| `src/modules/llm.ts` | WP-6 | ~20 (fallback whitelist + guard) |
| `docs/new_architecture_typescript.md` | docs | +4 lines |

---

## Overall Status

**CHANGES REQUIRED** (2 bugs, 1 dead code issue)

---

## Correctness

- [x] WP-5.1a: `injectRefreshLlm` called at headless startup — correct
- [x] WP-5.1b: Evening job no longer calls `generatePlan("tomorrow")` — correct
- [x] WP-5.1c: Light check calls Tier 2 after inbox/notes — correct
- [x] WP-5.2: `needsFullReplan` function added — correct logic, but see Bug #2
- [x] WP-6: `SONNET_FALLBACK_INTENTS` whitelist guards fallback — correct
- [x] Morning job unchanged — verified
- [x] Weekly job unchanged — verified
- [x] Architecture doc updated — verified

### Issues found:

**1. [BUG] `needsFullReplan()` is defined but never called anywhere.**
The design review spec says it should be "used as guard before any Sonnet call outside the morning job." Currently no code calls it. It's dead — not wired in.

However, reviewing the actual architecture: the only place where a non-morning Sonnet call *could* happen is if the user says "plan my day" interactively (handled by assembler's `buildReplanContext`), which already uses delta-aware replanning and is triggered by user intent, not scheduled. The headless runner no longer has any non-morning Sonnet plan calls. So `needsFullReplan` has no current consumer.

**Verdict:** Not a bug in behavior, but the function is unused dead code. Either wire it somewhere or remove it. See Required Changes.

---

## Bugs

### Bug #1 (MUST FIX): Evening job missing circuit breaker guard

`headless-runner.js:267` — the evening job calls `shouldRefresh(state)` and then `refreshBriefNarrative(state)` without checking `isCircuitOpen()`.

The `refreshBriefNarrative` function uses the injected `_refreshLlmFn` which is a *raw Anthropic SDK client* — it completely bypasses the circuit breaker in `llm.ts`. If the API is down or returning errors, the evening Tier 2 call will hit the API anyway and throw, potentially masking the failure from the circuit breaker.

Compare with the light check at line 364 which correctly guards:
```javascript
if (shouldRefresh(state) && !isCircuitOpen()) {  // <-- correct
```

But the evening job at line 267:
```javascript
if (shouldRefresh(state)) {  // <-- missing !isCircuitOpen()
```

**Fix:** Add `&& !isCircuitOpen()` to the evening job's `shouldRefresh` check.

### Bug #2 (LOW): `needsFullReplan` false positives from pre-existing events

`briefDelta.ts:51-56` — `newFixedEvents` filters calendar events NOT in the brief's additions that have today's date. But `CalendarEvent` has no `createdAt` field, so the filter cannot distinguish between:
- Events that genuinely appeared after the brief was generated (new meetings)
- Events that existed before the brief but were not included in `days[].additions` (e.g., events the LLM intentionally excluded, or events in the routine template)

This could cause false positives — reporting events as "new" when they were just excluded from the brief for legitimate reasons (low priority, routine overlap, etc.).

**Severity:** Low — `needsFullReplan` is currently unused (Bug #1 in Correctness), so this has no runtime impact. But if it's wired in later, it will misfire.

**Potential mitigation (if keeping the function):** Use the `_changelog` as the source of truth instead:
```typescript
const newEventChanges = (brief._changelog || []).filter(c => c.type === "event_added");
const cancelledEventChanges = (brief._changelog || []).filter(c => c.type === "event_cancelled");
return newEventChanges.length >= 2 || cancelledEventChanges.length >= 2;
```

---

## Security

- Issues found: None
- No secrets exposed, no new API endpoints, no auth changes

---

## Performance

- Issues found: None
- Evening job goes from one Sonnet call (~5s, ~$0.03) to one conditional Haiku call (~500ms, ~$0.0001). Net improvement.
- Light check adds one conditional Haiku call (~500ms). Acceptable for background job.

---

## Architecture Compliance

- [x] Layer contracts respected — TypeScript owns patches, LLM owns narrative
- [x] Dependency injection pattern reused from `api-proxy.js`
- [x] Circuit breaker pattern followed (except Bug #1)
- [x] Headless runner parity now achieved — all tiers wired
- [x] No new cross-module import violations

### Issue:

**`patchBrief` imported but unused in headless runner.**
`headless-runner.js:68` imports `patchBrief` from `briefPatcher.ts` but never calls it anywhere in the file. The headless runner's `morningJob` calls `generatePlan` → `applyWrites`, but does not call `patchBrief` after writes from inbox or notes processing.

This is technically correct for WP-5 scope (the Architect did not spec Tier 1 patches for headless inbox/notes writes). But it means changelog entries from headless inbox processing are NOT created, so `shouldRefresh` may undercount changes.

**Verdict:** Remove the unused `patchBrief` import to avoid confusion. If headless inbox writes should trigger Tier 1 patches, that's a separate follow-up.

---

## Code Quality

- [x] Comments explain the "why" not the "what" — good
- [x] Consistent logging format with `[${ts()}]` prefix
- [x] Error handling wraps async operations in try/catch
- [x] No `console.log` in TypeScript modules — only in headless runner (Node script, acceptable)

### Minor:

**1. Ternary in `recordFailure` message is hard to read.**
`llm.ts:453` — the three-way ternary is technically correct but a reviewer has to pause:
```typescript
recordFailure(`${model === HAIKU && SONNET_FALLBACK_INTENTS.has(intentType) ? "haiku+sonnet" : model === HAIKU ? "haiku" : "sonnet"} validation failed for ${intentType}`);
```
Consider extracting to a variable for readability. Not a blocker.

---

## Testability

- [x] `needsFullReplan` is a pure function — testable with no mocks
- [x] `SONNET_FALLBACK_INTENTS` is a module-level constant — testable via `callLlm` behavior
- [x] Evening job and light check changes are in named async functions — testable with mocked dependencies
- [x] No hidden side effects at import time (the `injectRefreshLlm` call is explicit in startup)

### Issue:

**`SONNET_FALLBACK_INTENTS` is not exported.** If the test case writer wants to verify the whitelist contents or test boundary behavior, they cannot access it directly. Not a blocker — they can test via `callLlm` behavior.

---

## Required Changes

1. **[MUST] Add `!isCircuitOpen()` guard to evening job Tier 2 call** (`headless-runner.js:267`)
   ```javascript
   if (shouldRefresh(state) && !isCircuitOpen()) {
   ```

2. **[MUST] Remove unused `patchBrief` import** from `headless-runner.js:68`
   Change:
   ```javascript
   const { patchBrief, getChangelogCount } = require("../src/modules/briefPatcher");
   ```
   To:
   ```javascript
   const { getChangelogCount } = require("../src/modules/briefPatcher");
   ```

3. **[SHOULD] Remove or defer `needsFullReplan` function** from `briefDelta.ts`. It has no consumer and has a logic issue (false positives from pre-existing events). Options:
   - (a) Remove entirely — add it back when there's an actual consumer
   - (b) Keep but rewrite to use `_changelog` as source of truth instead of scanning calendar events

---

## Optional Suggestions

1. **Extract the Tier 2 refresh block into a helper function** in `headless-runner.js`. The same 10-line block (shouldRefresh → refreshBriefNarrative → flush → renderHtml) appears in both `eveningJob` and `lightCheck`. A `runTier2Refresh(state)` helper would reduce duplication.

2. **Consider adding `okr_update` to `SONNET_FALLBACK_INTENTS`** in `llm.ts`. OKR updates involve cross-referencing objectives with key results and tasks — Haiku sometimes produces malformed KR progress arrays. This is a judgment call, not a blocker.

---

## Patterns to Capture

### For AGENTS.md
- **Injected LLM functions bypass the circuit breaker.** When using the DI pattern (`injectRefreshLlm`), the injected function is a raw SDK client. The caller must explicitly check `isCircuitOpen()` before calling it. This is different from `callLlm()` which has the circuit breaker built in.

### For coding rules
- **No unused imports.** When adding a module import for future use, add a `// TODO: wire patchBrief for headless inbox writes` comment, or don't import it until it's used.
