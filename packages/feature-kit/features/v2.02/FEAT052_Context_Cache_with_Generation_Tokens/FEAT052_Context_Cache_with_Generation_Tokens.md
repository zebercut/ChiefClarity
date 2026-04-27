# FEAT052 — Context Cache with Generation Tokens

**Type:** feature
**Status:** Planned
**MoSCoW:** MUST
**Category:** Performance
**Priority:** 1
**Release:** v3.0
**Tags:** cache, performance, generation-tokens, data-freshness

**Independent of:** FEAT050 and FEAT051. Ships standalone as an immediate perf win. Once FEAT050 is available, the cache keys by `skillId` for more reuse.

**Created:** 2026-04-23

---

## Summary

Cache the assembled context for a turn so the next turn does not re-read the same data from disk or database when nothing has changed. Each data source carries a **generation token** (last-write timestamp + row-count hash) that invalidates the cache automatically when any write occurs. The cache is keyed by `(skillId or legacy intent, dataSources, generationTokens)` and stored in memory per session. This removes the duplicate-load cost on follow-up turns ("what about Thursday?" right after "what's on my calendar this week?") and on repeated similar requests across a session.

---

## Problem Statement

Every turn today reads the same user state from disk / libSQL, runs the same assembler branch, and produces a context object that is nearly identical to the previous turn's — because the user has not added new data between messages. On a slow storage path (Capacitor on mobile, encrypted files, or Google Drive-backed data) this is wasted time and battery. On any platform it is wasted CPU.

Beyond raw time, the cost is more real once FEAT050 ships: advisory skills load pre-summarised views (e.g., `projects.summary`) that are deterministic functions of their sources. Recomputing them per turn is pure waste unless the underlying data has changed.

The system has no notion of data freshness at the view level. The assembler cannot tell "this task index is already up to date" vs "this needs a full rebuild."

---

## Goals

1. Avoid rereading/recomputing the same data view when nothing has changed since the last turn.
2. Invalidate cache entries automatically and reliably when writes occur, with zero manual invalidation calls.
3. Cache survives across turns within one session; resets on app restart.
4. Never serve stale data; a false-negative (cache miss when we could have hit) is acceptable; a false-positive (stale hit) is not.
5. Zero configuration — works by default for every data view in the menu.

---

## Success Metrics

- On a synthetic session of 10 consecutive related turns (all reading the same data sources), 9 of the 10 hit the cache for at least the bulk of the context.
- Measured turn-to-turn context build time drops by ≥ 40% on Capacitor for a same-data follow-up turn.
- Zero stale-data incidents in QA: after any write, the next read of the affected data sources always rebuilds.
- Cache footprint stays under 10 MB in memory for a typical user (weighted by row counts).
- Disabling the cache via a setting produces identical outputs to cache-enabled (proves correctness).

---

## User Stories

### Story 1 — Follow-up turns reuse context

**As a** user asking a sequence of related questions, **I want** the system to respond faster on the second, third, and fourth turns, **so that** conversation flow is not interrupted by repeated data loading.

**Acceptance Criteria:**
- [ ] Given turn A loads data views `tasks.open` and `calendar.week`, when turn B (same skill, same data views) runs and no writes happened between, then the context is served from cache without re-reading disk / libSQL.
- [ ] Measured user-perceived latency for turn B is lower than turn A (on Capacitor, meaningfully).
- [ ] The cache hit is logged (debug only) so the team can verify reuse.

### Story 2 — Writes invalidate automatically

**As a** user, **I want** the cache to reflect my latest writes without me thinking about it, **so that** the next turn always sees reality.

**Acceptance Criteria:**
- [ ] Given a write to any data source (e.g., adding a task), then the generation token for that source is incremented.
- [ ] Given the next turn needs that source, then the cache miss rebuilds the view from fresh data.
- [ ] Given a write affects only `tasks`, then cached views keyed only on untouched sources (e.g., `okrs.active`) still hit.
- [ ] Given the executor writes via the existing `flush()` path, then generation-token updates happen inside that path — no separate call needed.

### Story 3 — Generation tokens are per source, not global

**As a** developer, **I want** invalidation to be precise, **so that** writing a task does not invalidate the calendar cache.

**Acceptance Criteria:**
- [ ] Each data source in the menu (`tasks`, `calendar`, `okrs`, `facts`, `observations`, `notes`, `topics`, `lifestyle`, `profile`, `chat_history`, `decisions_log`, `projects`) has its own token.
- [ ] Writing `tasks` increments only `tasks.token`; other tokens remain.
- [ ] A cached context entry stores the tokens for every source it used; it hits only when every token still matches.
- [ ] Views derived from multiple sources (e.g., `projects.summary` reading from `tasks` + `okrs` + `topics`) record the tokens of all contributing sources.

### Story 4 — Cache is session-scoped, not persistent

**As a** user, **I want** the cache to reset on app restart, **so that** a fresh session never serves data that existed before a disk-level change I made while the app was closed.

**Acceptance Criteria:**
- [ ] The cache is in-memory only. On app restart, it is empty.
- [ ] On app restart, the first read of each source rebuilds tokens from the current data state.
- [ ] There is no persisted cache file on disk.
- [ ] The cache does not survive user switching (multi-user is out of scope per FEAT015, but safety: per-user keying prevents cross-user leakage if multi-user is reintroduced).

### Story 5 — Correctness under concurrency

**As a** user on a platform where the headless runner may write while the app reads, **I want** the cache to never serve pre-write data when a write has landed, **so that** displayed data is always truthful.

**Acceptance Criteria:**
- [ ] Writes update generation tokens atomically with the write itself (same transaction or same `flush()` boundary).
- [ ] Reads check tokens at cache-lookup time; if the token moved between last-seen and now, the entry is discarded.
- [ ] If the headless runner writes while the app is open, the next in-app read observes the new token and rebuilds.
- [ ] The system detects external changes (headless writes) via file-mtime polling of tracked sources at a configurable interval (default: on turn start) and bumps the in-memory token if the file changed outside the app's own write path.

### Story 6 — Per-skill cache keys

**As a** developer, **I want** different skills to cache separately, **so that** one skill's view shape does not mask another skill's needs.

**Acceptance Criteria:**
- [ ] Cache key includes `skillId` (or `"legacy"` + intent name for the pre-FEAT050 path).
- [ ] Two skills requesting the same data sources with the same tokens still store separate cache entries because the *shaped view* may differ.
- [ ] Eviction policy: LRU with a configurable entry count (default 50).
- [ ] Cache can be cleared manually from a debug menu or via a dev CLI command.

### Story 7 — Disable cleanly for debugging

**As a** developer diagnosing a suspected caching issue, **I want** to disable the cache via a setting, **so that** I can compare outputs with and without cache.

**Acceptance Criteria:**
- [ ] Setting `contextCacheEnabled: false` disables all lookups and stores; every turn rebuilds context from scratch.
- [ ] With the setting off, the user-visible output is identical to with the setting on (except for timing) for a matched sequence of turns. This is the correctness check.

---

## Workflow

```
Turn start
  └─ router picks skillId + dataNeeds
       └─ cache.lookup(skillId, dataNeeds)
            ├─ Hit (all tokens match)
            │    └─ return cached context → skip data loading
            └─ Miss
                 ├─ load requested views (FEAT050 runtime)
                 ├─ record each source's current token
                 └─ cache.store(key, context, tokens)

Executor write
  └─ inside flush(state):
       └─ for each dirty source: incrementToken(source)
       └─ writes land on disk / libSQL

External (headless) write
  └─ on next turn start, pollMtimes() compares each tracked source's file
       └─ if mtime changed: bump token for that source
```

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Same skill, same dataNeeds, write in between | Miss — rebuild. |
| Same skill, subset of previous dataNeeds | Miss (different key). Future optimization: partial reuse. Out of scope for v3.0. |
| Circuit-breaker open, cache still populated | Cache serves normally; only the LLM call is affected. |
| Encrypted data files (FEAT021) | Cache stores decrypted shaped views in memory only. Never persisted. |
| Very large view (e.g., `tasks.all` with thousands of rows) | Stored normally but counts against the 10 MB / 50-entry budget. LRU evicts. |
| Write fails mid-flush | Token is incremented only after successful flush; failed writes do not invalidate. |
| Clock skew affecting mtime-based external-change detection | Token uses mtime + size; size change alone triggers a bump even if mtime is same. |
| User rapidly undoes a change | Two writes → two token bumps → normal cache misses. |
| Memory pressure on Capacitor | LRU eviction keeps the cache bounded; no swapping to disk. |

---

## Out of Scope

- Persistent (cross-session) cache on disk. Reconsidered in a later FEAT if warranted.
- Partial-key reuse (e.g., cached `[tasks, calendar]` used to serve `[tasks]`).
- Shared cache across users or devices.
- Replacing or bypassing the existing `hotContext` / `contradictionIndex` caches — those remain.
- Caching LLM responses.
- Caching vector-search results (those have their own invalidation story tied to FEAT042).

---

## Architecture Notes

*To be filled by Architect Agent.*

### Signals for the Architect

- Token bump must be inside `executor.flush()` so writes atomically publish new tokens. Do not add token bumps at every call site.
- Generation tokens are cheap: a monotonic integer per source, plus a `(mtime, size)` tuple for external-change detection. No hashing the file contents.
- Memory budget is a hard cap; pick an LRU library already in use or write a 30-line LRU map.
- The cache is a singleton per session, injected into the FEAT050 runtime (`resolveDataNeeds`).

### Key types (illustrative)

```ts
type SourceName = "tasks" | "calendar" | "okrs" | "facts" | "observations" |
                  "notes" | "topics" | "lifestyle" | "profile" |
                  "chat_history" | "decisions_log" | "projects";

type GenerationToken = number;                 // monotonic per source
type TokenMap = Record<SourceName, GenerationToken>;

interface CacheEntry {
  key: string;                                 // hash(skillId + dataNeeds)
  context: Record<string, unknown>;
  tokensAtStore: TokenMap;                     // snapshot at store time
  storedAt: number;                            // ms
  lastHitAt: number;
}

interface ContextCache {
  lookup(skillId: string, dataNeeds: string[]): Record<string, unknown> | null;
  store(skillId: string, dataNeeds: string[], ctx: Record<string, unknown>): void;
  onWrite(sources: SourceName[]): void;        // called by executor.flush
  onExternalChange(source: SourceName): void;  // called by mtime poller
  clear(): void;
  stats(): { hits: number; misses: number; evictions: number; entries: number };
}
```

### Integration points

| Module | Change |
|---|---|
| `src/modules/executor.ts` | Call `cache.onWrite(dirtySources)` inside `flush()` after successful write. |
| `src/modules/skills/runtime.ts` (FEAT050) | Call `cache.lookup` before loading views; `cache.store` after. |
| `src/modules/assembler.ts` (legacy path) | Same pattern for legacy intents. |
| `src/modules/externalChangeWatcher.ts` | New. On each turn start, poll `(mtime, size)` for tracked files; fire `onExternalChange`. |
| `src/types/index.ts` | Add cache types. |

---

## Implementation Notes

| File | Change |
|---|---|
| `src/modules/contextCache.ts` | New. LRU map + token logic. |
| `src/modules/externalChangeWatcher.ts` | New. Lightweight mtime poller. |
| `src/modules/executor.ts` | Call `onWrite` after `flush()` succeeds. |
| `src/modules/skills/runtime.ts` | Wire lookup/store around data loading. |
| `src/modules/assembler.ts` | Same wiring for legacy path. |
| `docs/new_architecture_typescript.md` | Section: Context cache semantics + invalidation rules. |

---

## Testing Notes

- [ ] Unit: lookup miss on first call; store; hit on second call.
- [ ] Unit: write to source bumps token; next lookup misses.
- [ ] Unit: LRU eviction at capacity.
- [ ] Unit: external mtime change bumps token.
- [ ] Integration: same-skill same-dataNeeds sequence of 5 turns — 1 miss, 4 hits.
- [ ] Integration: write between turns → correct miss on sources touched, hit on untouched.
- [ ] Regression: turn off cache → identical outputs to cache-on for a matched sequence.
- [ ] Performance: measured turn-2 latency on Capacitor with cache on vs off; document delta.

---

## Assumptions & Open Questions

- **Assumption:** Views are pure functions of their declared sources. No hidden inputs (env vars, clock-based logic beyond `today`).
- **Assumption:** Mtime-based external-change detection is sufficient for the headless-runner + app coexistence. If it proves flaky, fall back to per-turn token-file reading.
- **Open question:** Does `today` (calendar) count as a token input? If a turn spans midnight the cached "today" is stale. Recommendation: include `today: YYYY-MM-DD` in the cache key so the boundary naturally invalidates.
- **Open question:** For libSQL-backed sources, should the token be maintained as a row in a `generation_tokens` table rather than in-memory? Recommendation: start in-memory; add a table if the headless coordination requires it.
- **Open question:** Should cache entries carry a TTL as a belt-and-suspenders on top of tokens? Recommendation: 60-minute TTL as a safety net.

---

## UX Notes

User-invisible feature. No UI changes beyond an optional debug surface in FEAT035 (Settings Panel) showing `{hits, misses, entries}` for diagnostics.
