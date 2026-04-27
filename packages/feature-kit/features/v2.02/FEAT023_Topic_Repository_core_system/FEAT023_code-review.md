# Code Review: FEAT023 — Topic Repository core system

**Reviewer:** Code Reviewer Agent  
**Date:** 2026-04-14  
**Spec:** FEAT023_Topic_Repository_core_system.md  
**Design Review:** FEAT023_design-review.md (all 3 MUST conditions applied)

## Overall Status

**CHANGES REQUIRED** — one bug against acceptance criteria, one performance issue, and one architecture compliance violation. All other checks pass. Overall implementation is close to ready; the issues below should be addressed before this is marked Code Reviewed.

## Correctness

- [x] Stories 1-4 (core topic system) — previously implemented, still passing
- [x] Story 5 (topic-aware daily planning) — topicCrossRef + topicDigest wired end-to-end
- [x] Story 6 (topic page Dashboard regeneration) — preserves Notes, always writes `## Notes` marker
- [x] Story 7 (Topics list page) — search, pagination, suggestions, empty state all present
- [x] Story 8 (Topic detail page) — all sections render, Add Note works, missing-data guards in place

### Issue 1 — Bug: Accept Suggestion skips fact migration
**Severity:** HIGH — violates Story 4 AC "creates topic **and migrates facts**"  
**File:** `app/(tabs)/topics.tsx:162-179` (`handleAccept`)

The new Topics page inlines topic-creation logic instead of delegating to the existing executor action:

```typescript
manifest.topics.push({ id: topicSlug, name, aliases: [], createdAt: ... });
manifest.pendingSuggestions = manifest.pendingSuggestions.filter(...);
appState._dirty.add("topicManifest");
await flush(appState);
```

But [executor.ts:360-374](src/modules/executor.ts#L360-L374) already implements `accept_suggestion` correctly — it also calls `migrateFactsToTopic(id, name, state.contextMemory.facts)` which moves all context-memory facts tagged with that topic hint into `topics/{slug}.md`. The UI path bypasses this, so facts the user accumulated before accepting the suggestion stay in `context_memory` and never appear on the new topic's detail page. For a user who accepts a suggestion after 3+ signals, this means the 3+ facts that triggered the suggestion are invisible on the topic page they just created.

**Fix:** Refactor `handleAccept` to go through the executor's `accept_suggestion` action instead of duplicating state mutation. Same for `handleReject`/`handleDefer` — `reject_suggestion` at [executor.ts:377](src/modules/executor.ts#L377) already exists.

### Issue 2 — Minor: `topicDigest` not rendered in Focus tab
**Severity:** LOW — deferred by design review  
**File:** `app/(tabs)/focus.tsx`

The HTML renderer shows the Topics section; the React Native Focus Dashboard does not. Design review deferred this to a future iteration with the decision that the Topics page is the primary UI for topic grouping. Accept this as documented debt, or add a `TopicDigestCard` now. Not a blocker.

## Bugs

See Issue 1. No other functional bugs found.

## Security

- [x] HTML output in `briefRenderer.ts` topic section — all three user-controllable fields (`td.name`, `td.items[]`, `td.okrConnection`, `td.newInsights`) go through `esc()`. Verified.
- [x] Regex injection in `matchesTopicName()` — special chars escaped before lookaround; regex was hardened during test cycle to handle names like `C++` (was using `\b` which fails with non-word chars; replaced with `(?<!\w)...(?!\w)`).
- [x] No secrets handled by this feature.
- [x] Topic files written via `filesystem.ts` — platform-aware, not plaintext-exposed beyond what the existing topics subsystem already does.

No security issues.

## Performance

### Issue 3 — `buildTopicCrossRef` called inside loop
**Severity:** MEDIUM — wastes work on replan with many topics  
**File:** `src/modules/topicManager.ts:256-260`

Inside `updateTopicPagesFromBrief`, the cross-reference is rebuilt for every digest item, then filtered with `.find()`:

```typescript
for (const item of digest) {
  ...
  const crossRef = buildTopicCrossRef(
    state.topicManifest,
    state.tasks.tasks.filter(...),  // repeats the same filter N times
    state.calendar.events.filter(...),
  ).find(c => c.topic === item.topic);
  ...
}
```

`buildTopicCrossRef` is O(tasks × topics + events × topics). For a user with 10 digest items, 10 topics, and 50 tasks, this is ~10× redundant work (~5000 ops). Every call also re-filters the tasks and events arrays.

**Fix:** Hoist `buildTopicCrossRef` and the task/event filters above the loop. Build a `Map<topic, TopicCrossRef>` once and look up by `item.topic`.

## Architecture Compliance

### Issue 4 — Direct React-state mutation
**Severity:** MEDIUM — violates AGENTS.md Coding rule  
**File:** `app/(tabs)/topics.tsx:171-174, 185-187, 200-203`

AGENTS.md says: *"Never use `Object.assign(stateObj, patch)` to update React state — it mutates in-place without triggering re-renders."* The same principle applies to the three suggestion handlers:

```typescript
manifest.topics.push({ ... });                // mutates appState.topicManifest in-place
manifest.pendingSuggestions = manifest.pendingSuggestions.filter(...);
appState._dirty.add("topicManifest");
```

`appState` is React state set via `setAppState(state)`. Mutating `state.topicManifest.topics` does not trigger a re-render. The code gets away with it today because `refresh()` reloads from disk immediately after `flush()`, which does cause a re-render via `setAppState`. But this couples correctness to the side-effect ordering — if someone later removes or delays the `refresh()` call, the UI silently goes stale.

Issue 1's fix (delegate to executor actions) also resolves this — routing through the executor means the UI just awaits the write and then `refresh()`es, without ever touching React state directly.

### Other architecture checks
- [x] Sacred boundary respected — TypeScript owns the cross-ref + page regeneration; LLM only emits the digest
- [x] Single LLM call rule — topic context is added to the existing `full_planning` prompt, no extra call
- [x] Per-intent context — topicCrossRef only added for `full_planning`
- [x] Token budget — `topicCrossRef` in `truncatableKeys`
- [x] Atomic writes — topic files go through `filesystem.writeTextFile`
- [x] Timezone — `getUserToday(state)` used in all date operations, not system locale

## Code Quality

- [x] Function sizes reasonable — `updateTopicPagesFromBrief` is the longest new function (~90 lines) but structurally clear (Dashboard build + Notes preservation + compose)
- [x] Naming consistent with project conventions
- [x] No `console.log` in hot paths. The `console.warn` calls in `executor.ts` match the existing pattern used throughout the file (e.g., `console.warn("[executor] unknown file key:"`)

### Optional: `as any` cast in executor
**File:** `src/modules/executor.ts` (topic update call site)

```typescript
await updateTopicPagesFromBrief(state.focusBrief as any, state);
```

`FocusBrief` is a typed interface and should be assignable to `Record<string, unknown>` (the parameter type). The `as any` erases the compiler's ability to flag mis-shaped calls. Prefer `as unknown as Record<string, unknown>` or — better — change the parameter type to `FocusBrief`.

## Testability

- [x] `src/modules/topicManager.test.ts` exists — 35 tests covering `slugifyTopic`, `buildTopicList`, `getExistingHints`, `recordSignal`, `updateSuggestions`, `buildTopicCrossRef`
- [x] All tests pass (`npm test` reports 149/149)
- [x] TypeScript compiles with no new errors (only a pre-existing error in `executor.ts:229`, unrelated to this feature)

### Gap: `updateTopicPagesFromBrief` not unit-tested
The function is the most complex new code and has no test coverage. Testing it requires mocking `readTextFile` / `writeTextFile` — doable but not included. The Tester agent's integration tests can cover it end-to-end after the Coder mocks the filesystem module or extracts the content-composition logic into a pure helper.

**Suggested refactor:** Split `updateTopicPagesFromBrief` into:
1. `composeTopicPageContent(name, item, crossRef, state): string` — pure, trivially testable
2. `updateTopicPagesFromBrief(...)` — thin I/O wrapper around `composeTopicPageContent`

Then unit-test the pure function with fixtures.

## Required Changes

Before this feature can be approved:

1. **MUST** — Fix `handleAccept` / `handleReject` / `handleDefer` in [topics.tsx](app/(tabs)/topics.tsx) to go through the existing executor actions (`accept_suggestion`, `reject_suggestion`). Resolves Issue 1 (fact migration) and Issue 4 (direct state mutation) together.
2. **MUST** — Hoist `buildTopicCrossRef` and the task/event filters out of the loop in `updateTopicPagesFromBrief`. Build a `Map<topic, TopicCrossRef>` once, look up per digest item.
3. **SHOULD** — Remove `as any` cast in `executor.ts` around `updateTopicPagesFromBrief` call. Either fix the parameter type to `FocusBrief` or use `as unknown as Record<string, unknown>`.

## Optional Suggestions

- Extract content composition in `updateTopicPagesFromBrief` to a pure function so it can be unit-tested.
- Consider adding a `TopicDigestCard` component to the Focus Dashboard in a future iteration (currently deferred by design review).
- Topic color in `topics.tsx` is hashed from `name`. If a topic is renamed later (not currently supported), the color would change. Consider hashing from `id` for stability if topic renaming is ever added.

## Pattern Learning — AGENTS.md updates

From this review, add to `AGENTS.md` under **Architecture**:

> UI handlers for domain actions must delegate to the corresponding executor actions rather than duplicating state-mutation logic. Each inline copy of state mutation in the UI is a missed side effect waiting to happen (e.g., fact migration, signal recording, conflict checks). If an action exists in the executor, the UI must call it — not reimplement it.

And under **Performance**:

> When iterating over N items that each need a cross-reference against M entities, build the cross-reference once above the loop and index it by key. Do not rebuild the cross-reference inside the loop.
