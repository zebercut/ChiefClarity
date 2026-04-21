# Code Review: FEAT047 — Data Hygiene with LLM-Assisted Cleanup

**Created:** 2026-04-14
**Reviewer:** Code Reviewer Agent
**Status:** APPROVED WITH COMMENTS

## Files Reviewed

| File | Change |
|------|--------|
| `src/modules/dataHygiene.ts` | New — Tier 1 deterministic cleanup + Tier 2 Haiku audit |
| `src/modules/executor.ts` | Tier 0 semantic dedup in `applyAdd()` |
| `scripts/headless-runner.js` | Morning job: Tier 1, Weekly job: Tier 2, Startup: Tier 0 + audit injection |
| `scripts/api-proxy.js` | Startup: Tier 0 injection |
| `src/modules/dataHygiene.test.ts` | 20 unit tests |

## Overall Status: APPROVED WITH COMMENTS

No blocking bugs. All acceptance criteria met. Tests pass 20/20. Type-check clean.

---

## Correctness — Acceptance Criteria

- [x] Undated events older than 7 days archived in morning job
- [x] Recurring tasks that overlap with calendar events on same day deduped
- [x] Exact duplicate open tasks auto-deferred (keeps most-active)
- [x] Parked tasks older than 30 days auto-deferred
- [x] Past-due recurring instances auto-deferred
- [x] Recurring task instances excluded from Tier 0 blocking
- [x] Tier 2 circuit breaker check present
- [x] Tier 0 thresholds conservative (0.10 block, 0.20 flag)
- [x] Weekly Haiku audit identifies fuzzy duplicates + stale items
- [x] Haiku suggestions logged to chat
- [x] All cleanup logged to chat with summary
- [x] Plan generation runs AFTER hygiene

---

## Bugs

None found.

---

## Security

- Issues found: None
- Tier 2 Haiku receives only IDs + titles (no full task content or user data)

---

## Performance

- Tier 0: ~10ms per write (embedding + vector search). Acceptable.
- Tier 1: O(N) scan of tasks/events. For current data size (<1000 items), negligible.
- Tier 1 `dedupExactTasks`: O(N) with hash map. Efficient.
- Tier 2 `possibleDuplicateTasks`: O(N²) pairwise comparison. For <100 open tasks, fine. If tasks grow to 500+, this will be slow. Capped at 10 pairs sent to Haiku, so the LLM cost is bounded.

---

## Architecture Compliance

- [x] Dependency injection pattern (same as `injectRetriever`, `injectRefreshLlm`)
- [x] Circuit breaker check for Tier 2 (per CR-FEAT045 rule)
- [x] Recurring instance exclusion in Tier 0 (per architect review)
- [x] State mutation + `_dirty` flag pattern consistent with rest of codebase
- [x] Module blocked from Metro via `lazyRequire` pattern (not needed here — `dataHygiene.ts` doesn't import from `db/`)

---

## Code Quality

- [x] Functions are small and single-purpose
- [x] Comments explain "why" not "what"
- [x] Consistent logging with `[hygiene]` prefix
- [x] Error handling wraps Tier 2 in try/catch (non-fatal)
- [x] `stringSimilarity` is a simple, readable Jaccard implementation

### Comments (not blockers):

**1. Duplicated injection code in proxy and headless runner.**
The 15-line `injectSemanticDedup(async (...) => { ... })` block is identical in both `api-proxy.js` and `headless-runner.js`. Could be extracted to a shared function in `src/modules/embeddings/dedup.ts`. Not a blocker — both files are Node-only scripts.

**2. `archivePastDueRecurring` uses "deferred" status but function name says "archived".**
The function name is `archivePastDueRecurring` and the result field is `pastDueRecurringArchived`, but the actual action sets `status: "deferred"`. Naming mismatch. The behavior is correct (soft-delete via deferred), but the name implies hard archive. Minor — consider renaming to `deferPastDueRecurring` / `pastDueRecurringDeferred`.

**3. Tier 2 `runLlmAudit` counts LLM-deferred tasks under `taskExactDeduped`.**
Lines 344, 354 — when Haiku suggests deferring or merging tasks, the counts go into `base.taskExactDeduped` rather than a separate `llmDeferred` / `llmMerged` counter. The `HygieneResult` interface has these fields defined in the spec but not in the implementation. The summary still reads correctly, but the per-tier breakdown is lost.

---

## Testability

- [x] All Tier 1 functions are pure (deterministic, given state + today)
- [x] Tests use mock state — no DB, no filesystem
- [x] 20 tests covering all 5 checks + edge cases + dirty flag tracking
- [x] Tests are standalone (`npx ts-node`) — no test framework dependency

### Missing test coverage (not blockers):

- No test for 3+ duplicates of the same title (verifies only 1 survives)
- No test for `stringSimilarity` directly (it's private, but could be exported for testing)
- No test for Tier 2 `runLlmAudit` (would need mock LLM function injection)

---

## Required Changes

None. Approved as-is.

---

## Optional Suggestions

1. Extract shared `injectSemanticDedup` closure into `src/modules/embeddings/dedup.ts`
2. Rename `archivePastDueRecurring` → `deferPastDueRecurring`
3. Add `llmDeferred` / `llmMerged` counters to `HygieneResult` for accurate per-tier metrics
4. Add test for triple-duplicate scenario
