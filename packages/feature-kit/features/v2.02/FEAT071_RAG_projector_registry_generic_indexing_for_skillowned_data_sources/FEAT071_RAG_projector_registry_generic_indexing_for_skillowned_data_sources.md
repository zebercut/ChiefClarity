# FEAT071 — RAG projector registry: generic indexing for skill-owned data sources

**Type:** architecture
**Status:** In Progress
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02
**Tags:** rag, skills, registry, architecture, info_lookup
**Created:** 2026-04-29

---

## Summary

Today, every new data source has to be wired into the RAG index by hand: `src/modules/rag/backfill.ts:buildQueueFromState` has hardcoded knowledge of `state.notes.notes` and `state.contextMemory.facts`, and there's no path for a skill that introduces a new data shape (e.g., a future Scheduling skill writing calendar events) to make its data searchable through `info_lookup` without editing `backfill.ts`.

This FEAT introduces a generic "RAG projector" contract that lives next to each skill's manifest. A projector says: "from `state.<schema>`, here's how to iterate, and here's how to project each item into the chunk shape the indexer needs." The registry is loaded by the skill registry alongside `manifest.json`, `prompt.md`, `context.ts`, `handlers.ts`. Backfill becomes a thin loop over registered projectors, and the executor write path fires a same-projector re-index on every add/update/delete so freshness is always live, not waiting for the next backfill.

## Problem Statement

- Adding a new skill that owns a write schema (FEAT059 calendar, hypothetical FEAT-N scheduling, future habit-tracking, etc.) currently has zero path to the `info_lookup` retriever without editing `backfill.ts`.
- `backfill.ts` is a backfill, not a write hook — newly created notes / facts only become searchable after the next boot.
- The current shape encodes assumptions about state layout (`state.notes?.notes ?? []`, `state.contextMemory?.facts ?? []`) that should be the data owner's concern, not the indexer's.

## Design

### The contract

A projector is a small data structure each skill exports as `projector.ts` (or `ragProjectors`, plural) alongside its manifest:

```ts
export interface RagProjector<T = unknown> {
  /** State key — must match a top-level FileKey in AppState. */
  schema: FileKey;
  /** ChunkSource the projected items index under. */
  source: ChunkSource;
  /** Walk `state[schema]` and yield items. Pure / synchronous. */
  iterate: (state: AppState) => Iterable<T>;
  /** Map one item to the indexer payload. Return null to skip. */
  project: (item: T) => { sourceId: string; text: string; metadata?: Record<string, unknown> } | null;
}
```

The skill folder gets one new optional file:

```
src/skills/<skill_id>/
├── manifest.json
├── prompt.md
├── context.ts
├── handlers.ts
└── projector.ts          ← NEW (optional). Exports `projector` (single) OR `projectors` (array).
```

### Loading

`scripts/bundle-skills.ts` emits an additional optional `projector` field per skill into the generated bundle. `skillRegistry` reads it on `buildSkillFromBundle`. `LoadedSkill` gains an optional `projector?: RagProjector | RagProjector[]` field.

A new `src/modules/rag/projectorRegistry.ts` module owns the global map. The skill registry calls `registerProjectorsFor(loadedSkill)` once per skill on load. Collisions on `schema` log a warning and keep the first registration (predictable, debuggable).

### Backfill

`src/modules/rag/backfill.ts` is rewritten so `buildQueueFromState` iterates `projectorRegistry.getAll()` rather than hardcoded paths. Behavior stays identical for the existing `note` / `contextMemory` sources after they're migrated to projectors.

### Live re-index (write hook)

`src/modules/executor.ts:applyWrites` calls a new `ragWriteHook(action, fileKey, id, item)` after each `applyAdd` / `applyUpdate` / `applyDelete`. The hook:

1. Looks up the projector keyed by `fileKey`.
2. For `add` / `update`: re-projects the item, calls `indexEntity()`. The indexer's existing upsert semantics handle "edited record" cleanly because `chunkId` is deterministic from `(source, sourceId)`.
3. For `delete`: calls `deindexEntity(projector.source, id)`.
4. Failures are logged and swallowed — relational write integrity is paramount, RAG drift is recoverable on next backfill.
5. Fired as fire-and-forget (`void hook(...).catch(warn)`) so write latency isn't bound by embedding cost.

The hook is a direct import from the executor (no `inject*` indirection): `indexEntity` already lazy-imports `embed`, so xenova does not load until the first projection actually runs.

### Migration

`notes` and `contextMemory` projectors ship in this FEAT — they live next to their owning skills:

| Schema           | Projector lives in                              |
|------------------|-------------------------------------------------|
| `notes`          | `src/skills/notes_capture/projector.ts`         |
| `contextMemory`  | `src/skills/inbox_triage/projector.ts`          |

After migration, `backfill.ts` no longer references either schema directly.

### Out of scope

- **Calendar projector.** Deliberately deferred — this FEAT proves the architecture; a later FEAT adds `src/skills/calendar_management/projector.ts` and unblocks "when was my meeting with X" queries.
- **Topic pages.** They flow through `topicManager` + `indexTopicPage` (paragraph chunks), which is a different shape than the simple "one item → one chunk" contract here. Out of scope until we generalize chunking.
- **Cross-skill schema sharing.** Both `notes_capture` and `inbox_triage` declare `notes` as a write schema. The projector lives where the data shape is most natural (`notes_capture`); collision is detected at registration time and the first registration wins.

## Implementation Notes

| File | Change |
|------|--------|
| `src/types/rag.ts` | Add `RagProjector<T>` interface. Reuse existing `IndexEntityInput`-shaped output. |
| `src/modules/rag/projectorRegistry.ts` | NEW — `register`, `getAll`, `getBySchema`, `_resetForTests`. |
| `src/modules/skillRegistry.ts` | Add `projector?` field to `LoadedSkill`. On load, register into `projectorRegistry`. |
| `scripts/bundle-skills.ts` | Detect optional `projector.ts` per skill folder; emit `projector` (or `projectors`) in the bundle. |
| `src/skills/_generated/skillBundle.ts` | Auto-regenerated via `npm run bundle:skills`. |
| `src/modules/rag/backfill.ts` | `buildQueueFromState` iterates `projectorRegistry.getAll()`. Hardcoded note/contextMemory branches removed. |
| `src/modules/executor.ts` | After each write, fire the RAG hook (direct import of `indexEntity` / `deindexEntity`). |
| `src/skills/notes_capture/projector.ts` | NEW — projector for `notes`. |
| `src/skills/inbox_triage/projector.ts` | NEW — projector for `contextMemory`. |

## Testing Notes

- `src/modules/rag/projectorRegistry.test.ts` (NEW) — register, getAll, getBySchema, collision warning.
- `src/modules/rag/backfill.test.ts` — extend / refresh: projector-driven queue produces same output as the prior hardcoded version on a representative state.
- `src/modules/executor.test.ts` — assert `ragWriteHook` fires after each write action. Use a stubbed indexer to avoid xenova in tests.

## Success Metrics

- Adding a calendar projector (next FEAT) is a 1-file change inside `src/skills/calendar_management/` — zero edits to `backfill.ts`, zero edits to `executor.ts`, zero edits to `skillRegistry.ts`.
- `note` and `contextMemory` continue to be indexed identically (same chunkIds, same embeddings) after migration.
