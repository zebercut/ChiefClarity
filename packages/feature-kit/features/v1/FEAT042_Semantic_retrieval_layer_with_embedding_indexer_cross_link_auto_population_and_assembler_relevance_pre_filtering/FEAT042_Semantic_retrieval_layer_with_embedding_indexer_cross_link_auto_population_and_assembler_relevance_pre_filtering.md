# FEAT042 — Semantic retrieval layer with embedding indexer, cross-link auto-population, and assembler relevance pre-filtering

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** LLM Pipeline
**Priority:** 1
**Release:** v4.0
**Tags:** embeddings, semantic-search, vector-index, retrieval, rag, libsql, assembler
**Created:** 2026-04-08
**Design Reviewed:** 2026-04-10

**Depends on:** FEAT041 (libSQL migration — Done, in Testing)
**Blocks:** FEAT043 (Two-stage LLM reasoning)

---

## Summary

Add semantic search by populating the `embeddings` table (created in FEAT041) and using vector queries to: (a) auto-populate cross-domain links between tasks, calendar events, and notes, (b) replace the assembler's "dump everything" pattern with relevance-based pre-filtering, and (c) make the LLM context contain the *most relevant* items rather than the *most recent* items.

---

## Developer Implementation Guide

### Verified prerequisites

- `embeddings` table exists with `F32_BLOB(384)` column (verified)
- `vector()` function works for inserting vectors (verified)
- `vector_distance_cos()` works for cosine distance queries (verified)
- `task_calendar_links` and `task_note_links` tables exist (verified)
- Brute-force vector search (`ORDER BY vector_distance_cos(...) LIMIT k`) works — no native vector index needed at personal-app scale (< 10K embeddings)

### Four sequential work packages

---

## WP-1: Embedding provider — `@xenova/transformers` wrapper

**Goal:** A single function `embed(text) → Float32Array[384]` that works on Node.

### 1.1 Install

```bash
npm install @xenova/transformers
```

> ~80MB model download on first use. The model (`Xenova/all-MiniLM-L6-v2`) is cached in `~/.cache/huggingface/` after first download.

### 1.2 Create `src/modules/embeddings/provider.ts`

```typescript
import { pipeline, type Pipeline } from "@xenova/transformers";

let _pipe: Pipeline | null = null;

/** Initialize the embedding model (first call downloads ~80MB). */
async function getPipeline(): Promise<Pipeline> {
  if (!_pipe) {
    _pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return _pipe;
}

/**
 * Embed a text string → 384-dim Float32Array.
 * Truncates input to ~512 tokens (model max).
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(result.data);
}

/**
 * Embed multiple texts in one batch (faster than sequential).
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getPipeline();
  const results = [];
  // Process in batches of 32 to avoid memory pressure
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32);
    for (const text of batch) {
      const result = await pipe(text, { pooling: "mean", normalize: true });
      results.push(new Float32Array(result.data));
    }
  }
  return results;
}
```

> **Platform note:** `@xenova/transformers` uses ONNX Runtime (Node-native or WASM). On web mode, the proxy runs the embeddings — the browser never calls this module (same pattern as `src/db/`). Guard all imports behind the Metro blockList in `metro.config.js`.

### 1.3 Update `metro.config.js`

Add `@xenova/transformers` to the Metro blockList (Node-only, like `@libsql`):

```javascript
/node_modules[/\\]@xenova[/\\].*/,
/node_modules[/\\]onnxruntime[/\\].*/,
```

### 1.4 Acceptance

- [ ] `embed("hello world")` returns a `Float32Array` of length 384
- [ ] `embed("hello world")` and `embed("hi there")` have cosine similarity > 0.6
- [ ] `embed("hello world")` and `embed("quantum physics")` have cosine similarity < 0.3
- [ ] Second call to `embed()` is fast (model already loaded, < 15ms)

---

## WP-2: Embedding queries + indexer hooks

**Goal:** Every task/event/note/fact write also upserts an embedding. Background indexer fills gaps for existing data.

### 2.1 Create `src/db/queries/embeddings.ts`

```typescript
import { getDb } from "../index";

/** Upsert an embedding. Replaces if source_type+source_id exists. */
export async function upsertEmbedding(
  sourceType: string,
  sourceId: string,
  vector: Float32Array,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  // Convert Float32Array to the format libSQL expects for vector()
  const vecStr = "[" + Array.from(vector).join(",") + "]";
  await db.execute({
    sql: `INSERT OR REPLACE INTO embeddings (source_type, source_id, vector, metadata, created_at)
          VALUES (?, ?, vector(?), ?, datetime('now'))`,
    args: [sourceType, sourceId, vecStr, metadata ? JSON.stringify(metadata) : null],
  });
}

/** Delete an embedding by source. */
export async function deleteEmbedding(sourceType: string, sourceId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM embeddings WHERE source_type = ? AND source_id = ?",
    args: [sourceType, sourceId],
  });
}

/** Find top-k similar items by cosine distance. */
export async function searchSimilar(
  queryVector: Float32Array,
  sourceTypes: string[],
  limit: number = 10,
  maxDistance: number = 0.5  // cosine distance (0=identical, 1=orthogonal)
): Promise<Array<{ sourceType: string; sourceId: string; distance: number; metadata: string | null }>> {
  const db = getDb();
  const vecStr = "[" + Array.from(queryVector).join(",") + "]";
  const typePlaceholders = sourceTypes.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT source_type, source_id, metadata,
                 vector_distance_cos(vector, vector(?)) as distance
          FROM embeddings
          WHERE source_type IN (${typePlaceholders})
          ORDER BY distance ASC
          LIMIT ?`,
    args: [vecStr, ...sourceTypes, limit],
  });
  return result.rows
    .filter((r) => Number(r.distance) <= maxDistance)
    .map((r) => ({
      sourceType: r.source_type as string,
      sourceId: r.source_id as string,
      distance: Number(r.distance),
      metadata: r.metadata as string | null,
    }));
}

/** Count embeddings by source type. */
export async function countEmbeddings(sourceType?: string): Promise<number> {
  const db = getDb();
  const result = sourceType
    ? await db.execute({ sql: "SELECT COUNT(*) as c FROM embeddings WHERE source_type = ?", args: [sourceType] })
    : await db.execute("SELECT COUNT(*) as c FROM embeddings");
  return Number(result.rows[0].c);
}

/** Get source IDs that have no embedding yet. */
export async function findUnindexed(
  sourceType: string,
  sourceTable: string,
  idColumn: string = "id"
): Promise<string[]> {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT t.${idColumn} as id FROM ${sourceTable} t
          LEFT JOIN embeddings e ON e.source_type = ? AND e.source_id = t.${idColumn}
          WHERE e.id IS NULL`,
    args: [sourceType],
  });
  return result.rows.map((r) => r.id as string);
}
```

### 2.2 Create `src/modules/embeddings/indexer.ts`

The indexer hooks into the executor's write flow. It embeds content for each entity type.

**Text extraction per source type:**

| Source Type | Text to Embed | Source Table |
|---|---|---|
| `task` | `title + " " + notes + " " + category` | `tasks` |
| `event` | `title + " " + notes + " " + type` | `calendar_events` |
| `note` | `text` | `notes` |
| `fact` | `text + " " + topic` | `facts` |
| `observation` | `observation` | `user_observations` |
| `chat` | `content` (last 200 only) | `chat_messages` |

```typescript
import { embed } from "./provider";
import { upsertEmbedding, deleteEmbedding } from "../../db/queries/embeddings";

/** Extract embeddable text from a data object. */
function extractText(sourceType: string, data: Record<string, unknown>): string {
  switch (sourceType) {
    case "task":
      return [data.title, data.notes, data.category].filter(Boolean).join(" ");
    case "event":
      return [data.title, data.notes, data.type].filter(Boolean).join(" ");
    case "note":
      return (data.text as string) || "";
    case "fact":
      return [data.text, data.topic].filter(Boolean).join(" ");
    case "observation":
      return (data.observation as string) || "";
    case "chat":
      return (data.content as string) || "";
    default:
      return JSON.stringify(data).slice(0, 500);
  }
}

/** Index a single entity. Call after applyAdd/applyUpdate. */
export async function indexEntity(
  sourceType: string,
  sourceId: string,
  data: Record<string, unknown>
): Promise<void> {
  const text = extractText(sourceType, data);
  if (!text || text.length < 5) return; // skip trivial content
  try {
    const vector = await embed(text);
    await upsertEmbedding(sourceType, sourceId, vector);
  } catch (err: any) {
    console.warn(`[indexer] failed to embed ${sourceType}/${sourceId}:`, err?.message);
    // Non-fatal: the relational write already committed
  }
}

/** Remove an entity's embedding. Call after applyDelete. */
export async function deindexEntity(sourceType: string, sourceId: string): Promise<void> {
  try {
    await deleteEmbedding(sourceType, sourceId);
  } catch (err: any) {
    console.warn(`[indexer] failed to delete embedding ${sourceType}/${sourceId}:`, err?.message);
  }
}

/** Map FileKey to source type for the indexer. */
export function fileKeyToSourceType(fileKey: string): string | null {
  const map: Record<string, string> = {
    tasks: "task",
    calendar: "event",
    notes: "note",
    contextMemory: "fact",
    userObservations: "observation",
  };
  return map[fileKey] || null;
}
```

### 2.3 Create `src/modules/embeddings/background-indexer.ts`

Runs once at startup (or on demand) to embed all existing data that doesn't have embeddings yet.

```typescript
import { findUnindexed, countEmbeddings } from "../../db/queries/embeddings";
import { getDb } from "../../db/index";
import { indexEntity } from "./indexer";

/**
 * Index all unindexed entities in the background.
 * Returns the number of new embeddings created.
 */
export async function runBackgroundIndex(): Promise<number> {
  const db = getDb();
  let indexed = 0;

  const sources: Array<{ type: string; table: string; idCol: string; textFn: (row: any) => Record<string, unknown> }> = [
    { type: "task", table: "tasks", idCol: "id",
      textFn: (r) => ({ title: r.title, notes: r.notes, category: r.category }) },
    { type: "event", table: "calendar_events", idCol: "id",
      textFn: (r) => ({ title: r.title, notes: r.notes, type: r.type }) },
    { type: "note", table: "notes", idCol: "id",
      textFn: (r) => ({ text: r.text }) },
    { type: "fact", table: "facts", idCol: "id",
      textFn: (r) => ({ text: r.text, topic: r.topic }) },
    { type: "observation", table: "user_observations", idCol: "id",
      textFn: (r) => ({ observation: r.observation }) },
  ];

  for (const src of sources) {
    const unindexed = await findUnindexed(src.type, src.table, src.idCol);
    if (unindexed.length === 0) continue;

    console.log(`[bg-indexer] ${src.type}: ${unindexed.length} unindexed`);
    for (const id of unindexed) {
      const rows = await db.execute({
        sql: `SELECT * FROM ${src.table} WHERE ${src.idCol} = ?`,
        args: [id],
      });
      if (rows.rows.length === 0) continue;
      await indexEntity(src.type, String(id), src.textFn(rows.rows[0]));
      indexed++;
    }
  }

  console.log(`[bg-indexer] indexed ${indexed} new embeddings (total: ${await countEmbeddings()})`);
  return indexed;
}
```

### 2.4 Hook into executor

In the proxy/headless (Node-only), after a write commits, call the indexer. This is done via injection (same pattern as `flushToDb`):

Add to `src/db/flush.ts` — after each collection save, trigger indexing for the written entities. OR inject an `afterWrite` hook from the proxy/headless startup.

**Recommended approach:** Add an `onWriteComplete` callback list to the executor that Node-only code populates. The indexer registers itself at startup.

### 2.5 Acceptance

- [ ] After `insertTask(task)`, the `embeddings` table has a row for that task
- [ ] After `deleteTask(id)`, the embedding row is gone (cascade or explicit delete)
- [ ] `runBackgroundIndex()` fills embeddings for all existing unindexed entities
- [ ] `searchSimilar(queryVec, ["task"], 5)` returns the 5 closest tasks by meaning

---

## WP-3: Cross-domain linker

**Goal:** When a task is created, auto-link it to related calendar events and notes.

### 3.1 Create `src/modules/embeddings/linker.ts`

```typescript
import { searchSimilar } from "../../db/queries/embeddings";
import { getDb } from "../../db/index";
import { embed } from "./provider";

const SIMILARITY_THRESHOLD = 0.3; // cosine distance (lower = more similar)
const MAX_LINKS = 5;

/**
 * After a task is indexed, find and link related events and notes.
 */
export async function linkTask(taskId: string, taskText: string, dueDate?: string): Promise<void> {
  const queryVec = await embed(taskText);
  const db = getDb();
  const now = new Date().toISOString();

  // Find similar calendar events
  const events = await searchSimilar(queryVec, ["event"], MAX_LINKS, SIMILARITY_THRESHOLD);
  for (const match of events) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_calendar_links (task_id, event_id, similarity, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [taskId, match.sourceId, 1 - match.distance, now], // store similarity (1-distance)
    });
  }

  // Find similar notes
  const notes = await searchSimilar(queryVec, ["note"], MAX_LINKS, SIMILARITY_THRESHOLD);
  for (const match of notes) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO task_note_links (task_id, note_id, similarity, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [taskId, match.sourceId, 1 - match.distance, now],
    });
  }
}

/**
 * Get linked items for a task (for display in UI / assembler context).
 */
export async function getTaskLinks(taskId: string): Promise<{
  events: Array<{ eventId: string; similarity: number }>;
  notes: Array<{ noteId: string; similarity: number }>;
}> {
  const db = getDb();
  const eventRows = await db.execute({
    sql: "SELECT event_id, similarity FROM task_calendar_links WHERE task_id = ? ORDER BY similarity DESC",
    args: [taskId],
  });
  const noteRows = await db.execute({
    sql: "SELECT note_id, similarity FROM task_note_links WHERE task_id = ? ORDER BY similarity DESC",
    args: [taskId],
  });
  return {
    events: eventRows.rows.map((r) => ({ eventId: r.event_id as string, similarity: Number(r.similarity) })),
    notes: noteRows.rows.map((r) => ({ noteId: r.note_id as string, similarity: Number(r.similarity) })),
  };
}
```

### 3.2 Acceptance

- [ ] Creating a task "Prepare client demo" auto-links to a calendar event "Client meeting Thursday" if one exists
- [ ] Links appear in `task_calendar_links` with similarity > 0.7
- [ ] Deleting a task removes its links (FK cascade)
- [ ] `getTaskLinks(taskId)` returns the linked events and notes

---

## WP-4: Assembler integration — relevance pre-filtering

**Goal:** For `info_lookup`, `general`, and `topic_query` intents, replace "dump all" with top-k vector search.

### 4.1 Modify `src/modules/assembler.ts`

For intents that benefit from semantic retrieval, embed the user's phrase and pull the top-k relevant items:

**Intents to augment:**

| Intent | Current Behavior | With FEAT042 |
|---|---|---|
| `info_lookup` | Dumps full `contentIndex` + `tasksIndex` + `calendarEvents` + `contextMemory` | Embed user phrase → top-20 vector matches across task/event/fact/note/observation → join back to relational data |
| `general` | Dumps `tasksIndex` + `calendarEvents` + `goalsContext` + `contextMemory` | Same as today PLUS top-10 vector matches for the user phrase |
| `topic_query` | Loads topic content + topic facts | Same as today PLUS top-10 vector matches for the topic name |
| `full_planning` | Loads everything (12K budget) | No change — planning needs the full picture. But vector search can augment: pull top-5 relevant historical facts/observations |

**Integration point:** Add a helper `assembleVectorContext(phrase, sourceTypes, limit)` that:
1. Calls `embed(phrase)` to get the query vector
2. Calls `searchSimilar(queryVec, sourceTypes, limit)` to get top-k matches
3. Joins matches back to their source tables for full data
4. Returns the results as a context block the assembler can merge

**Budget interaction:** Vector-retrieved items are included BEFORE budget enforcement. They get the same truncation treatment, but since they're pre-filtered by relevance, truncation drops the least relevant items first (exactly the behavior we want).

### 4.2 Modify `enforceBudget()`

Current `enforceBudget()` truncates from the **end** of arrays (chronological tail). With vector-retrieved items, items should be sorted by relevance (distance) so truncation drops the **least relevant** items first.

Add a `_relevanceScore` field to vector-retrieved items. In `enforceBudget()`, sort by `_relevanceScore` descending before truncating.

### 4.3 Acceptance

- [ ] `info_lookup` for "notes about anxiety" returns facts/notes about stress even without the word "anxiety"
- [ ] `general` context includes vector-matched items alongside standard chronological data
- [ ] Token budget for `info_lookup` shrinks by ≥ 30% with equal or better answer quality
- [ ] `full_planning` is unchanged (no regression)

---

## Execution order constraints

```
WP-1 (provider)  → standalone, no deps
WP-2 (indexer)   → needs WP-1
WP-3 (linker)    → needs WP-1 + WP-2
WP-4 (assembler) → needs WP-1 + WP-2
```

WP-3 and WP-4 can run in parallel after WP-2.

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Native vector index vs brute-force? | **Brute-force** (`ORDER BY vector_distance_cos() LIMIT k`). Verified working. At < 10K embeddings, it's sub-millisecond. Add native index when data grows past 100K. |
| Sync vs async indexing? | **Sync in the write path** for v1. Embedding takes ~10ms on Node — acceptable. If latency becomes an issue, move to async. |
| Metro bundling? | Block `@xenova/transformers` and `onnxruntime` in `metro.config.js`. Browser never runs embeddings — the proxy does it via the `/files` endpoint layer. |
| Threshold for auto-linking? | Cosine distance 0.3 (= cosine similarity 0.7). Tunable — start conservative, loosen if too few links. |
| How to handle first-run? | `runBackgroundIndex()` called once from the proxy/headless after DB opens. Processes all unindexed entities. |

---

## Files to create

| File | Purpose |
|---|---|
| `src/modules/embeddings/provider.ts` | Wraps `@xenova/transformers` for local embedding |
| `src/modules/embeddings/indexer.ts` | Entity → embedding lifecycle hooks |
| `src/modules/embeddings/linker.ts` | Cross-domain auto-linking |
| `src/modules/embeddings/background-indexer.ts` | First-run + catch-up indexing |
| `src/db/queries/embeddings.ts` | Vector DB queries (upsert, search, count, findUnindexed) |

## Files to modify

| File | Change |
|---|---|
| `src/modules/assembler.ts` | Add `assembleVectorContext()` helper; call it for `info_lookup`, `general`, `topic_query` intents; update `enforceBudget()` to sort by relevance |
| `src/db/flush.ts` | After collection saves, trigger indexing for written entities |
| `scripts/api-proxy.js` | Call `runBackgroundIndex()` after DB opens at startup |
| `scripts/headless-runner.js` | Call `runBackgroundIndex()` after DB opens at startup |
| `metro.config.js` | Block `@xenova/transformers` and `onnxruntime` |
| `package.json` | Add `@xenova/transformers` |
