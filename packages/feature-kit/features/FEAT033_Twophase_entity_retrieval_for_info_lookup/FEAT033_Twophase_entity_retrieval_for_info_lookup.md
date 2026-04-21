# FEAT033 — Two-phase entity retrieval for info lookup

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.4
**Tags:** retrieval, llm, architecture, info-lookup, encryption-safe
**Created:** 2026-04-06

---

## Summary

Replace the LLM's "search-and-guess" behavior on `info_lookup` / `topic_query` with a two-phase pipeline: TypeScript performs deterministic, encryption-safe retrieval across all in-memory state to build an `EntityDossier`, and the LLM is reduced to synthesis and natural-language reply. Eliminates the failure mode where ChiefClarity tells the user "I'd need you to point me to which files contain X" — because retrieval is no longer the LLM's job.

---

## Problem Statement

When the user asks "tell me all about X" (a person, project, or topic), the current `info_lookup` intent in the assembler sends a fixed, generic slice of context (`tasksIndex`, `contentIndex`, `calendarEvents`, `contextMemory`) — none of it filtered to the entity in question. The LLM has no tool to search files (single-LLM-call architecture by design), so it can only answer from what was pre-baked. Token-budget truncation in `enforceBudget` then drops items at the tail of `tasksIndex`, silently hiding entity-relevant data.

Result: the user repeatedly asks "search everywhere" and the system repeatedly fails — not because the LLM is lazy, but because the retrieval step does not exist. The architecture violates its own sacred boundary (TypeScript owns file I/O / search; LLM owns judgment) by asking the LLM to scan generic blobs for entity matches.

---

## User Stories

### Story 1 — Person lookup
**As a** user, **I want** to ask "tell me about [family member]" and get a complete summary of every task, event, observation, and OKR linked to them, **so that** I do not have to repeat myself or manually point the system at files.

**Acceptance Criteria:**
- [ ] Given a family member listed in `userProfile.familyMembers`, when I ask "tell me about [abbr]", then the reply enumerates relevant open tasks, upcoming events, related OKR progress, and any topic notes.
- [ ] Given the dossier was truncated, when the reply is rendered, then it explicitly states "showing top N of M".
- [ ] Given there is genuinely no data on the entity, when I ask, then the reply says so honestly without asking me to point to files.

### Story 2 — Topic / project lookup
**As a** user, **I want** to ask "everything about [project]" and get a focused report drawn from tasks, events, topic notes, and observations, **so that** I get a single source of truth without manually opening files.

**Acceptance Criteria:**
- [ ] Given a topic in `topicManifest.topics`, when I ask "everything about [topic]", then the topic file content is included alongside related tasks/events.
- [ ] Given a topic-id-only match (existing path via `extractTopicFromPhrase`), when matched, then current behavior is preserved.

### Story 3 — No regression on generic queries
**As a** user, **I want** non-entity queries like "what is Quebec installment tax" to still work, **so that** the new path does not break existing flows.

**Acceptance Criteria:**
- [ ] Given a phrase with no recognizable entity, when classified as `info_lookup`, then today's broad-context behavior is preserved (fall-through).

---

## Workflow

```
User phrase ─▶ classifyIntent() ─▶ info_lookup | topic_query
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │ Phase 1 — Deterministic retrieval    │
        │ entityRetriever.ts (pure, no I/O*)   │
        │                                      │
        │ buildEntityIndex(state)              │
        │   ← userProfile.familyMembers        │
        │   ← topicManifest.topics             │
        │   ← topicManifest.signals            │
        │                                      │
        │ extractEntities(phrase, index)       │
        │   word-boundary regex match          │
        │   max 3 entities                     │
        │                                      │
        │ buildDossier(entity, state)          │
        │   scan tasks, events, recurring,     │
        │   observations, facts, summaries,    │
        │   okrDashboard, topic file*          │
        │   rank + cap + record totals         │
        └──────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │ assembler injects entityDossiers     │
        │ replaces broad tasksIndex slice      │
        │ keeps calendarEvents, contextMemory  │
        └──────────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │ Phase 2 — LLM (single call as today) │
        │ prompt: "entityDossiers is the       │
        │ authoritative result of a            │
        │ deterministic search; synthesize."   │
        └──────────────────────────────────────┘

* Only I/O is readTopicFile() which routes through filesystem.ts
  and is therefore encryption-transparent.
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Family member has 1-character abbreviation | Skipped during extraction (min entity id length = 2 chars) to avoid false positives in task titles |
| Phrase contains a substring of an entity name (e.g. "video" vs entity "vid") | Word-boundary regex prevents the match |
| Multiple entities in one phrase (e.g. "tell me about A and B") | Build up to 3 dossiers; if more, take first 3 by phrase position |
| Entity exists in index but has zero matches anywhere | Return dossier with all-zero `totals`; LLM replies honestly that nothing is on file |
| Topic file is missing on disk | `topicNote: null`; other dossier fields still populated |
| `userProfile.familyMembers` is empty (new user) | Index built from topics only; person-query path simply yields no matches |
| Token budget exceeded by 3 large dossiers | `enforceBudget` truncates dossier task arrays uniformly; `totals` still report pre-truncation counts |
| Phrase has no recognizable entity | Fall through to today's `info_lookup` behavior — zero regression |
| `chat_history.json` not loaded into state | `mentionsInChatCount = 0`; documented limitation, follow-up feature can address |

---

## Success Metrics

- Zero "I'd need you to point me to which files" replies for queries containing a known entity (regression-tested manually).
- For a query targeting a known family member, dossier returns ≥ 90% of entity-tagged items present in the underlying state files (measured by spot-check on 5 entities).
- No increase in single-call LLM latency beyond +200ms p95 (Phase 1 is in-memory, only I/O is at most 3 small topic file reads).
- Zero new files added to the data folder; zero new entries in `SENSITIVE_FILES`; encryption audit checklist passes.

---

## Out of Scope

- Router changes that auto-route entity-bearing `general` queries to `info_lookup`. (Follow-up.)
- Encryption of `topics/*.md` files. (Separate decision; flagged for follow-up.)
- Haiku-based entity extraction fallback. Regex/alias-map only for v1.
- A persisted entity index file. The index is rebuilt at query time from in-memory state.
- Multi-entity comparative answers ("compare A and B"). v1 returns multiple dossiers; LLM may synthesize, but no special prompting.
- Including chat history mentions in dossier. `mentionsInChatCount` defaults to 0 with a TODO.
- Surfacing notes/long-text fields from tasks (false-positive prone, large).

---

## Architecture Notes

**New types** (`src/types/index.ts`):
- `EntityKind = "person" | "topic" | "project" | "org"`
- `Entity { id, kind, name, aliases[] }`
- `EntityIndex { entities[], byId }`
- `EntityDossier { entity, tasks[], events[], recurring[], observations[], facts[], topicNote, okrLinks[], mentionsInChatCount, totals }`

**New module** (`src/modules/entityRetriever.ts`):
- `buildEntityIndex(state): EntityIndex` — derives entities at runtime from `userProfile.familyMembers` + `topicManifest.topics` + `topicManifest.signals`. Pure, no I/O.
- `extractEntities(phrase, index): Entity[]` — word-boundary regex over id/name/aliases (mirrors `extractTopicFromPhrase` in `assembler.ts:283`). Returns up to 3.
- `buildDossier(entity, state): Promise<EntityDossier>` — async only because of `readTopicFile`. All other reads are from in-memory `state`.
- **Imports allowed:** `types`, `topicManager.readTopicFile`. **Imports forbidden:** `fs`, `path`, `node:*`, any platform module.

**Encryption strategy:**
- All sensitive data is already loaded into `state` by `loader.ts` via `filesystem.ts`, which transparently decrypts via `crypto.ts`. The retriever reads only from `state` → encryption is automatically respected.
- The only I/O is `readTopicFile` which already routes through `filesystem.ts`.
- Dossier is constructed in memory per query and dies after the LLM call. Never persisted, never logged.
- Zero new files in the data folder, zero changes to `SENSITIVE_FILES`.

**Token budget:**
- `info_lookup` budget: 3000 → 6000 tokens (in `router.ts:TOKEN_BUDGETS`).
- `enforceBudget` (`assembler.ts:181`) extended: dossier task arrays added to truncatable keys, truncated uniformly per entity. `totals` always reflect pre-truncation counts.

**Ranking** (deterministic):
- Tasks: open before done; high → low priority; near-due first; cap 20.
- Events: future before past (vs `state.hotContext.today`); ascending datetime; cap 15.
- Recurring: alphabetic by title; cap 10.
- Observations: source order (recent first by convention); cap 10.
- Facts: by `f.date` desc; cap 10.
- OKR links: by `tasksTotal` desc; no cap.

**Wiring:**
- `assembler.ts` `info_lookup` case: call `extractEntities`; if matches, build dossiers and replace broad `tasksIndex`/`contentIndex` slice. Keep `calendarEvents` + `contextMemory`. Else fall through to today's behavior.
- `assembler.ts` `topic_query` case: only run new path if existing `extractTopicFromPhrase` returns null.

**Prompt change** (`src/constants/prompts.ts`):
- Append (only when `entityDossiers` present): "`entityDossiers` is the authoritative, complete result of a deterministic search across the user's data. Synthesize from it. Use `totals` to acknowledge truncation honestly. Do not claim other data exists. Do not ask the user to point you to files."

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `EntityKind`, `Entity`, `EntityIndex`, `EntityDossier` types near `TaskIndex` |
| `src/modules/entityRetriever.ts` | **NEW** — `buildEntityIndex`, `extractEntities`, `buildDossier` + matchers/rankers. ~250 lines. Zero `fs`/`path`/platform imports. |
| `src/modules/entityRetriever.test.ts` | **NEW** — standalone runner (matches `taskPrioritizer.test.ts` convention). 11 tests, fictional fixtures only (`Child A`, `Project X`). |
| `src/modules/assembler.ts` | Modify `info_lookup` and `topic_query` cases to call entity retriever; extend `enforceBudget` truncatable keys for dossier task arrays |
| `src/modules/router.ts` | Bump `info_lookup: 3000` → `6000` in `TOKEN_BUDGETS` |
| `src/constants/prompts.ts` | Add scoped prompt addition for intents that receive `entityDossiers` |
| `docs/new_architecture_typescript.md` | Update sections 5 (types), 6 (modules + flow diagram), 8 (token budgets), 9 (ADR), 12 (feature catalog) |
| `README.md` | Modules table: add `entityRetriever` |

**Files NOT touched:** `loader.ts`, `crypto.ts`, `filesystem.ts`, `chatHistory.ts`, `topicManager.ts`.

---

## Testing Notes

### Unit tests (`entityRetriever.test.ts`)

- [ ] T1 `buildEntityIndex` — given a state with 2 family members + 3 topics + 5 signal-only topics, returns 10 distinct entities, dedup by id, family members marked `kind: "person"`
- [ ] T2 `extractEntities` happy path — phrase "tell me about Child A" matches `{id: "ca", kind: "person"}`
- [ ] T3 `extractEntities` word boundary — phrase "video editing" does NOT match entity `{id: "vid"}`
- [ ] T4 `extractEntities` multi-token alias — phrase "what's on for Project X" matches `{name: "Project X", aliases: ["projectx", "px"]}`
- [ ] T5 `extractEntities` case-insensitive — "PROJECT X" matches
- [ ] T6 `buildDossier` task ranking — 25 matching tasks → result has 20, open before done, high before low, near-due first
- [ ] T7 `buildDossier` totals correctness — 47 matches → `totals.tasks === 47` even though `tasks.length === 20`
- [ ] T8 `buildDossier` encryption boundary — mock `readTopicFile` to throw if called for unexpected id; verify only legitimate calls happen
- [ ] T9 `buildDossier` no topic file — entity is a person → `topicNote === null`, no `readTopicFile` call
- [ ] T10 `buildDossier` fact filtering — fact with `topic: "projectx"` matches even if `text` doesn't contain "projectx"
- [ ] T11 `buildDossier` empty entity — entity with zero matches returns dossier with all-zero `totals` (not null)

### Integration tests (manual)

- [ ] Run "tell me all about [family member abbr]" against real encrypted state — verify substantive answer, no "point me to files" reply
- [ ] Toggle encryption off and on — behavior identical
- [ ] 3 entities × 50 matches each — token budget stays under 6000

### Regression tests

- [ ] `info_lookup` with no entity match (e.g. "what is Quebec installment tax") still works via fall-through
- [ ] `topic_query` with explicit topic id still uses `extractTopicFromPhrase`
- [ ] `task_create`, `task_query`, `calendar_query`, `full_planning`, `okr_update` smoke-tested

### Encryption audit checklist

- [ ] `entityRetriever.ts` has zero `fs`/`path`/`node:*` imports (grep verified)
- [ ] All data access via `state` (already decrypted in memory)
- [ ] Only I/O is `topicManager.readTopicFile`
- [ ] Dossier never persisted (no `writeJson`/`writeFile` in new code)
- [ ] No `console.log(dossier)` in production paths
- [ ] No new file added to data folder
- [ ] Tests use only fictional fixtures, no real names
- [ ] `chat_history.json` not read by retriever

---

## Open Questions

- **Topic file caching** — does `topicManager.readTopicFile` cache reads, or does every entity query hit disk for matching topic files? If not cached, accept the cost (max 3 small reads per query) or add an LRU cache in a follow-up.
- **Single-letter family member abbreviations** — confirmed: skip entities with id length < 2 to prevent task-title false positives. Should this minimum become a config value?
- **Dossier truncation strategy under budget pressure** — uniform across entities, or weighted by phrase position (the first-named entity gets more)? v1: uniform. Revisit if user feedback shows the leading entity gets shortchanged.
- **Promotion of `pendingSuggestions` to real topics** — `family` is at count 15, threshold 3, still `pending`. Out of scope for FEAT033 but worth a follow-up: auto-promote when count ≥ 5× threshold.
