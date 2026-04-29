# FEAT068 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT068_RAGbased_infolookup_skill.md`
**Refs:**
FEAT042 (Done — Node-side libSQL embeddings table + indexer + retriever +
background-indexer + linker; this FEAT converges on top of it),
FEAT067 (Done — embeddings on web bundle; provides `embed`, `embedBatch`,
`MODEL_ID`, `isModelLoaded` isomorphically),
FEAT066 (Done — triage-hint primary signal; this FEAT flips
`info_lookup → info_lookup` at `router.ts:266`),
FEAT060 (template — multi-file write, BINDING smoke 5/6),
FEAT063 (template — locked-zone safety wording, declarative skill manifest),
FEAT064 (Done — isomorphic skill loading; web bundle skill execution),
FEAT058 (Done — `notes_capture` write surface).
Code: `src/modules/embeddings/provider.ts:22` (`MODEL_ID` exported),
`src/modules/embeddings/indexer.ts:36-90` (`indexEntity`, `deindexEntity`,
`fileKeyToSourceType`), `src/modules/embeddings/retriever.ts:20-26`
(`INTENT_SOURCES.info_lookup = [task, event, fact, note, observation]`),
`src/modules/embeddings/background-indexer.ts:55-138` (`runBackgroundIndex`
lock pattern), `src/modules/embeddings/linker.ts:19-96`
(`linkTask` / `linkEvent`), `src/db/queries/embeddings.ts:16-110`
(`upsertEmbedding`, `deleteEmbedding`, `searchSimilar`, `findUnindexed`,
`countEmbeddings`), `src/db/flush.ts:103-167` (`indexAndLink` — the
ACTUAL existing hook site, NOT `executor.ts`),
`src/modules/executor.ts:17-22` (`_semanticDedupFn` injection — preserved),
`src/modules/skillDispatcher.ts:64-153` (where the `retrievalHook` read
lands, between `resolveContext` and the LLM call),
`src/modules/router.ts:266` (`TRIAGE_INTENT_TO_SKILL.info_lookup` flip),
`src/db/queries/notes.ts:32, 62` (`updateNote` / `deleteNote` exist),
`metro.config.js:15-21` (selective unblock list — embeddings/provider.ts
ONLY; indexer/retriever/linker/background-indexer stay Node-only),
`package.json` (no `idb` today; `@xenova/transformers` already present
via FEAT067), `app/_layout.tsx:317-325` (the
`setV4SkillsEnabled([...])` list this FEAT extends),
`src/modules/topicManager.ts:24-43` (`appendToTopicFile` — the topic-page
write surface to wire), `src/modules/loader.ts:67-69` (note: `contentIndex`
is still a FileKey though dormant — see audit §4).

---

## 1. Verdict

**APPROVED for implementation** subject to §7 conditions (18 binding items).

The biggest FEAT in v2.02 by surface area, but the architectural risk
is significantly lower than spec line count suggests. The PM audit was
substantively right: FEAT042 already shipped most of the Node-side
infrastructure (embeddings table, vector storage, top-k cosine search,
background backfill with file-lock concurrency, write-time indexer
hook). FEAT067 already shipped the isomorphic embedder + `MODEL_ID`
constant. The real architectural decision left to this FEAT is
**convergence vs parallel-systems** — and convergence wins.

The right framing: this FEAT is not "build a vector index." That
exists. This FEAT is "extend FEAT042 to (a) work in IndexedDB on web /
mobile via a shared `VectorStore` interface, (b) cover `topic` chunks
in addition to FEAT042's existing entity types, (c) introduce a
declarative pre-LLM retrieval pattern in the skill manifest, and
(d) ship the first skill that uses it." Each piece is small. The risk
is in the seams — particularly the FEAT042 caller compatibility check
(`_semanticDedupFn`, `linker.ts`, the assembler-side
`retrieveContext`) — covered in §6.

The single architect-corrected PM finding is load-bearing:
**the existing indexer hook lives in `src/db/flush.ts`, not
`executor.ts`.** PM's spec assumed `executor.applyAdd` /
`executor.applyDelete` is where to wire the new indexer. It's not —
the existing `indexAndLink` call site in `db/flush.ts:103-167`
already triggers on every persisted entity write, downstream of the
executor. Re-using that hook (extending it for `note` and `topic`
chunks) is one-line cleaner than introducing a parallel hook in
`executor.ts` and risks no double-indexing. See §4 audit row 2 and
§7 condition 5.

The load-bearing artifact is the **BINDING real-LLM smoke (§7
condition 13)** with a fixture corpus seeded into the new
`VectorStore`. The 6 phrases in Story 11 cover retrieval-hit,
retrieval-miss, multi-source synthesis, and source-filter scoping.
5/6 strict matches FEAT060 precedent.

---

## 2. Architecture (one screen)

```
┌─ Build time (unchanged from FEAT067) ────────────────────────────────┐
│ npm run build:web → bundle-skills.ts → SKILL_BUNDLE +                │
│ skillEmbeddings.ts (FEAT067 cond. 4a) → expo export                  │
│ This FEAT adds: bundle-skills picks up info_lookup like any new      │
│ skill. No new build step.                                            │
└──────────────────────────────────────────────────────────────────────┘

┌─ Convergence picture: VectorStore interface ────────────────────────┐
│                                                                      │
│  src/modules/rag/store.ts                                            │
│    interface VectorStore {                                           │
│      upsertChunk(c: IndexEntry): Promise<void>;                      │
│      deleteChunksBySource(s: ChunkSource, id: string): Promise<void>;│
│      searchTopK(v: Float32Array, filter, k): Promise<RetrievalResult>│
│      countByModelId(modelId: string): Promise<number>;               │
│      clearAll(): Promise<void>;                                      │
│    }                                                                 │
│                                                                      │
│  ┌─ LibsqlVectorStore (Node) ──────────┐                             │
│  │ wraps existing FEAT042 calls:       │                             │
│  │   upsertEmbedding / deleteEmbedding │                             │
│  │   searchSimilar / countEmbeddings   │                             │
│  │ Schema delta: add chunk_id, source, │                             │
│  │   text, model_id columns to the     │                             │
│  │   existing embeddings table (or     │                             │
│  │   sibling rag_chunks table — see    │                             │
│  │   §3 alt 4.1, picked: extend the    │                             │
│  │   existing table — adds the columns │                             │
│  │   needed for chunk-level identity   │                             │
│  │   while preserving every FEAT042    │                             │
│  │   caller's existing source_type +   │                             │
│  │   source_id + vector contract).     │                             │
│  └─────────────────────────────────────┘                             │
│                                                                      │
│  ┌─ IndexedDbVectorStore (web/mobile) ─┐                             │
│  │ idb wrapper (3KB).                  │                             │
│  │ DB: lifeos_vectors, store: chunks.  │                             │
│  │ Indexes: source, sourceId, modelId. │                             │
│  │ searchTopK loads all chunks into    │                             │
│  │ memory once, then in-memory cosine  │                             │
│  │ (corpus < 10K, fits easily).        │                             │
│  └─────────────────────────────────────┘                             │
│                                                                      │
│  getDefaultVectorStore() picks per platform.                         │
│  Indexer / retriever / backfill take a VectorStore param,            │
│  default to getDefaultVectorStore().                                 │
└──────────────────────────────────────────────────────────────────────┘

┌─ Runtime — info_lookup phrase end-to-end ───────────────────────────┐
│ user: "what do you know about Project Alpha"                         │
│   ↓ triage (FAST_PATH_MAP regex matches "what do you know about")    │
│       legacyIntent = "info_lookup"                                   │
│   ↓ router (TRIAGE_INTENT_TO_SKILL.info_lookup = "info_lookup")      │
│       routingMethod = "triage_hint", skillId = "info_lookup"         │
│   ↓ dispatcher                                                       │
│       resolveContext({ userToday, userProfile, topicList })          │
│       NEW: read manifest.retrievalHook = { sources, k, minScore,     │
│             minScoreInclude }                                        │
│       NEW: hook present → run retrieveTopK with 800ms soft timeout:  │
│           ↓ embed(phrase) (provider.ts WASM on web / Node)           │
│           ↓ store.searchTopK(vec, { source: ["note","topic",         │
│                                       "contextMemory"] }, k=5)       │
│           ↓ filter by minScore=0.25; tag items with                  │
│                 confident: score >= 0.40                             │
│           ↓ check getRagBackfillStatus() — if running, set partial:  │
│                 true on the result envelope                          │
│       inject into user message:                                      │
│           retrievedKnowledge: RetrievalResult[]                      │
│           retrievalMeta: { partial, topScore, count }                │
│   ↓ LLM call (Haiku, tokenBudget=4000)                               │
│       prompt: "treat retrievedKnowledge as ground truth; cite        │
│        ('from your notes…', 'you mentioned in topic X…');            │
│        if topScore < minScoreInclude or items.length === 0,          │
│        say so cleanly and offer to capture notes; never fabricate."  │
│   ↓ tool: submit_info_lookup({ reply, items })                       │
│       handler post-processes:                                        │
│         if retrievalMeta.partial: append disclaimer to reply         │
│         items pass through as RetrievalResult[]                      │
│   ↓ chat surface renders reply + items via ItemListCard              │
└─────────────────────────────────────────────────────────────────────┘

┌─ Runtime — write side (extend existing flush.ts hook) ──────────────┐
│ executor.applyAdd / applyDelete persists entity                      │
│   ↓ flush(state) → db/flush.ts                                       │
│       for each dirty key:                                            │
│         persist via collectionSavers / saveSnapshot (existing)       │
│         NEW: indexAndLink covers `note` and topic-page chunks too    │
│           (today: tasks, calendar, notes via fileKeyToSourceType;    │
│            extend: when topic file is written, chunk + index it)     │
│   ↓ async indexEntity → store.upsertChunk (route to libSQL or IDB)   │
│ Topic-page chunking: appendToTopicFile() / updateTopicPagesFromBrief │
│   trigger a deleteChunksBySource("topic", topicId) → re-chunk →      │
│   embed each → upsertChunk.                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─ First-run + model-id-change backfill ──────────────────────────────┐
│ app/_layout.tsx after applyConfig():                                 │
│   if (countByModelId(MODEL_ID) === 0) → kick runBackfill             │
│   if any chunk.modelId !== MODEL_ID → log + clearAll() → runBackfill │
│ runBackfill():                                                       │
│   web: requestIdleCallback chunks of 5-10 entities/tick;             │
│         setTimeout(0) fallback for Safari                            │
│   Node: keep existing tryAcquireLock() pattern from FEAT042          │
│   walks notes + contextMemory.facts + persisted topic files;         │
│   skips entities already indexed (sourceId match + modelId match)    │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this shape.** Three forces converge on convergence:

1. **FEAT042 already proved the Node side.** The libSQL embeddings
   table, `searchSimilar`, the file-lock backfill, the `_semanticDedupFn`
   path, `linkTask` / `linkEvent` — all production. Re-implementing on
   web from scratch would duplicate the surface.
2. **Capacitor mobile (FEAT044) inherits the web bundle.** Building
   web-side IndexedDB code as a one-off would put mobile in the same
   no-RAG hole that FEAT067 just dug us out of.
3. **The dispatcher already passes structured `items` through (line
   148-150).** A declarative `retrievalHook` field plugs into that
   path with no new chat-surface code.

The trade-off is a one-time cost: defining the `VectorStore`
interface, splitting the existing FEAT042 module into "store-facing"
vs "platform-facing" code, and porting `_semanticDedupFn` + the
assembler-side `retrieveContext` to call through the new interface.
That cost is small (the FEAT042 surface is a half-dozen functions)
and pays back permanently — every future RAG FEAT (chat history,
attachments, topic-pages-on-mobile, cross-device-sync) can build on
the same interface.

---

## 3. Alternatives considered

### 3.1 Vector store topology — convergence vs parallel vs runtime branch

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Parallel — Node keeps FEAT042 untouched, web ships a separate `IndexedDbStore` + parallel `webIndexer` / `webRetriever` modules | Fastest to ship. Zero risk to FEAT042 callers (`_semanticDedupFn`, `linkTask`, assembler `retrieveContext`). | Permanent two-codebase split. Bug fixes have to land twice. Capacitor mobile gets a separate maintenance burden. Topic chunking logic forks unless we factor it (which is half the convergence work anyway). | Reject |
| **(b) Convergence — `VectorStore` interface + libSQL backend + IndexedDB backend (CHOSEN)** | One indexer / retriever / backfill module set. Capacitor mobile inherits the web backend with zero net-new code. FEAT042 callers re-point to the new interface (mechanical). Future stores (e.g., a server-synced backend) are a new backend, not a new module. | Requires factoring FEAT042 (mechanical but touches every caller). Two-backend test matrix. Schema-delta migration on the existing `embeddings` table. | **CHOSEN** |
| (c) Single shared module with runtime branch (`if (isNode())`) | Avoids the interface ceremony | The branch is everywhere. Dead libSQL code in the web bundle (Metro can't tree-shake conditional imports cleanly). FEAT042's batch-indexer needs `fs` + `path` for the lock — that pulls Node-only code into the web bundle even if the branch is dead. Unblockable. | Reject |

**Decision rationale.** Convergence is the only path that gives
Capacitor mobile (FEAT044) a working RAG without a third migration.
The mechanical port of FEAT042 callers is small (six call sites). The
test matrix doubles for the store layer only — indexer / retriever /
backfill tests stay backend-agnostic via the interface.

### 3.2 Pre-LLM retrieval hook — declarative manifest field vs imperative branch vs skill-exported hook

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Imperative — `if (routeResult.skillId === "info_lookup")` branch in `dispatchSkill` | Simplest possible | Sets a precedent for skill-id branches in the dispatcher. Every future RAG-using skill needs a new branch. Tests have to mock per skill. | Reject |
| **(b) Declarative `retrievalHook` field in manifest (CHOSEN)** | One dispatcher-side implementation. Future skills opt in by adding the field. Test matrix is "hook present" vs "hook absent." Manifest is the single source of truth for retrieval policy. | One more field to validate. The dispatcher gains one more pre-LLM step. Must handle the "hook present but embedder unavailable" path. | **CHOSEN** |
| (c) Skill-exported `onBeforeLLM(phrase, ctx)` hook from `handlers.ts` | Maximum per-skill flexibility | Skills bypass the dispatcher's observability. Every skill writes its own retrieval boilerplate. No central place to enforce timeout / score-threshold conventions. | Reject |

**Decision rationale.** Declarative wins because the retrieval call
shape is uniform — embed phrase, search top-K, filter by score,
inject. There's no per-skill creativity to preserve. Centralizing the
implementation also centralizes the soft-timeout, the partial-backfill
disclaimer, and the dispatch-decision log line.

### 3.3 Backfill scheduling on web — `setTimeout(0)` vs Worker vs `requestIdleCallback`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `setTimeout(0)` chunks | Universal browser support (incl. Safari, iOS WebKit). | Less responsive — runs as soon as the event loop empties, even if the user is mid-interaction. | Acceptable as fallback |
| Web Worker | True parallelism. Main thread stays fully responsive. | Workers can't share the xenova `_pipe` singleton — would have to re-init the model + re-load weights inside the worker, doubling the IndexedDB cache footprint. Heavy infra for "embed N strings then upsert N rows." | Reject |
| **`requestIdleCallback` + `setTimeout(0)` fallback (CHOSEN)** | Backfill yields to user interactions automatically. Falls back to `setTimeout(0)` on Safari (which doesn't support `requestIdleCallback`). | Two code paths to test (modern + Safari). Idle-callback timeout shaping needs care so backfill doesn't stall. | **CHOSEN** |

**Decision rationale.** Worker is overkill for the operation profile.
`requestIdleCallback` is the lightest path that keeps the main thread
responsive. The Safari fallback adds maybe 10 lines.

### 3.4 Chunk eviction strategy

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Never evict (CHOSEN for v1)** | Simple. Spec-aligned (out of scope per spec line 81). | IndexedDB quota warnings when corpus exceeds ~10K chunks * 384 floats * 4 bytes ≈ 16MB plus indexes ≈ 20-30MB. | **CHOSEN** for v1 |
| LRU eviction by `indexedAt` | Bounds storage | Deletes rows the user might still want. No telemetry to know what's safe to drop. | Defer to future FEAT |
| Source-aware eviction (drop oldest `note` chunks first) | Smarter than pure LRU | Premature optimization. Personal-app scale hasn't proven this matters. | Defer |

**Decision rationale.** Spec is explicit on this. Add eviction in a
follow-on FEAT once telemetry shows quota pressure.

---

## 4. Audit results — verification of PM's technical claims

PM made 10 specific technical claims about the existing code. The
architect re-verified each by reading the cited files.

| # | PM claim | Verified? | Notes |
|---|---|---|---|
| 1 | FEAT042 ships libSQL `embeddings` table + indexer/retriever/etc. | **CORRECT** | `src/db/queries/embeddings.ts` (table queries), `src/modules/embeddings/{indexer,retriever,linker,background-indexer,provider}.ts` all exist and are wired. |
| 2 | `executor.ts:18-22` has `_semanticDedupFn` injection | **CORRECT-WITH-CAVEAT** | The injection is at lines 17-22 (PM's range was off by one line, immaterial). Important caveat: it is `injectSemanticDedup`, NOT an indexer injection. **The indexer hook itself is in `src/db/flush.ts:103-167` (`indexAndLink`), not `executor.ts`.** PM's spec text in the open questions assumed "executor only" for the indexer hook — that's wrong. The hook is at the flush layer, downstream of executor, and that's where this FEAT extends. See §7 cond. 5. |
| 3 | `runBackgroundIndex()` exists and backfills on Node boot | **CORRECT** | `background-indexer.ts:98-138`. Lock pattern (`tryAcquireLock`) reused for this FEAT's Node-side path. Web-side path uses `requestIdleCallback` (no fs lock — single tab assumption). |
| 4 | `retriever.ts:21` maps `info_lookup → [task, event, fact, note, observation]` | **CORRECT** | `INTENT_SOURCES.info_lookup` at `retriever.ts:20-26` exactly as PM described. This is the assembler-side retriever (broader source set, includes tasks + events). The new `info_lookup` skill scopes to `["note", "topic", "contextMemory"]` via its `retrievalHook.sources` — keeps the two retrievers consistent on store but tighter on filter. |
| 5 | `notes` has `updateNote` + `deleteNote` at DB layer | **CORRECT** | `src/db/queries/notes.ts:32` (`updateNote`), `:62` (`deleteNote`). Confirms the open-question rationale for "executor-only hook" — these DB-layer functions are infrastructure-only and won't be wired for indexing (single-source-of-truth at flush layer). |
| 6 | `provider.ts:9-13` confirms IndexedDB caching for model weights | **CORRECT** | `provider.ts:9-13` is the privacy-posture comment block. xenova caches model weights in IndexedDB on browsers natively (no code we wrote — it's the runtime). The same machinery this FEAT's `IndexedDbVectorStore` reuses for vector data. |
| 7 | `dispatcher.ts:148-150` passes structured `items` through | **CORRECT** | `skillDispatcher.ts:148-150` — `items: Array.isArray(handlerResult?.items) ? handlerResult.items : undefined`. Chat surface renders via `ItemListCard` (FEAT057 pattern). The new skill's `submit_info_lookup` returns `items: RetrievalResult[]` and they pipe through with no dispatcher change. |
| 8 | FEAT066 map is at `router.ts:266` | **CORRECT** | `router.ts:266` — `info_lookup: "general_assistant", // forward-compat`. This FEAT flips it to `"info_lookup"`. |
| 9 | `content_index.json` is gone from runtime (only in archives) | **WRONG (CORRECTION)** | `content_index.json` is **still a live FileKey**: `src/modules/loader.ts:69` declares `contentIndex: "content_index.json"` in `FILE_MAP`; `:124` declares `contentIndex: { schemaVersion: "1.0", updatedAt: "", entities: {} }` as the default state shape; `src/db/flush.ts:47` lists `contentIndex` as a snapshot key; `src/modules/assembler.ts:160` reads `state.contentIndex`; `src/db/queries/state-bridge.ts` round-trips it. The legacy v3 keyword-index path is still wired even if no skill writes to it today. **This does not block FEAT068**, but the indexer must NOT collide with `contentIndex` semantics — they coexist. The new vector index is a SEPARATE store. Update the spec and the architecture doc to remove the "content_index.json is gone" assertion. |
| 10 | `package.json` does NOT have `idb` | **CORRECT** | Verified — `package.json` deps include `@xenova/transformers`, `@libsql/client`, `expo-*`, but no `idb`. This FEAT adds it. |

**Net of audit:** PM's findings are largely correct. Two important
corrections: (a) the existing indexer hook lives in `db/flush.ts`, not
`executor.ts` (item 2 — material to §7 cond. 5); (b) `content_index.json`
is still part of the live state model (item 9 — non-blocking but the
spec's assertion must be removed and the architecture doc updated to
reflect the coexistence).

---

## 5. Cross-feature concerns

**FEAT042 Node-side caller compatibility.** The convergence path
(§3.1 (b)) re-points six FEAT042 callers to the new `VectorStore`
interface:

- `executor.ts` `_semanticDedupFn` (set by proxy / headless on boot) —
  the dedup function still calls `searchSimilar` semantics. The
  injection moves from "raw FEAT042 function" to "function that
  delegates to `getDefaultVectorStore().searchTopK`." Behavior
  preserved.
- `linker.ts` `linkTask` / `linkEvent` — internally call
  `searchSimilar` for cross-domain candidates. Migrate to
  `store.searchTopK`. Same input/output contract.
- `retriever.ts` `retrieveContext` (assembler-side) — internally calls
  `searchSimilar` + joins back to source tables. Migrate the
  search call; the source-table-join logic stays unchanged.
- `background-indexer.ts` `runBackgroundIndex` — calls
  `findUnindexed` + `indexEntity`. Migrate to use the
  `store.upsertChunk` path.
- `db/flush.ts` `indexAndLink` — extends to cover `note` (already)
  and the new topic-chunk source.

**Regression test (§7 cond. 14):** existing FEAT042 tests
(`embeddings.test.ts`, semantic-dedup smoke, linker test) must pass
unchanged after the migration. Any divergence means the interface is
leaking.

**FEAT044 Capacitor mobile.** This FEAT delivers the IndexedDB
backend that mobile inherits. WebKit's IndexedDB is standard; the
storage path "just works" in the Capacitor webview without
Capacitor-specific code (per FEAT067 §4 precedent). Two open risks
deferred to FEAT044:

1. **iOS quota.** WebKit applies stricter IndexedDB quotas on iOS
   than desktop Chrome. A 10K-chunk corpus at ~30MB should fit, but
   FEAT044 owns the quota smoke. If iOS rejects the write, the
   degraded in-memory path (Story 12) catches it.
2. **Capacitor's structured-clone serializer.** `Float32Array` is
   structured-clonable, so IndexedDB stores it natively. No serializer
   wrapper needed. Confirm in FEAT044's smoke.

**FEAT066 triage-hint map.** This FEAT changes one line at
`router.ts:266`: `info_lookup: "general_assistant"` →
`info_lookup: "info_lookup"`. FEAT066's binding smoke (10/11
phrases) was embedder-DISABLED — none of those phrases triage as
`info_lookup`, so this flip is regression-free for FEAT066's own
smoke. The new triage `FAST_PATH_MAP` regex entry for
"what do you know about" is the parity-defining piece (§7 cond. 4).

**FEAT083+ Topics (future).** This FEAT's chunker (`chunkTopicPage`)
unit-tests cleanly without a topic-page write surface. The
flush-layer indexer hook is wired so when a future FEAT (FEAT083+)
adds new topic-page write paths, indexing happens automatically. The
existing `appendToTopicFile` / `updateTopicPagesFromBrief` paths in
`topicManager.ts` are wired NOW — when topics ship as a regular write
target, they index from day one without code change.

**FEAT067 model invalidation.** `MODEL_ID` is exported from
`provider.ts:22`. This FEAT records `modelId` on every chunk; on
boot, `countByModelId(MODEL_ID)` returns the number of chunks
matching the current model. If any chunk has a non-matching
`modelId`, log + `clearAll()` + trigger backfill. Same pattern
FEAT067's design review §6 cond. 4 anticipated.

**Coexistence with `contentIndex` (audit row 9).** The legacy v3
keyword-index file `content_index.json` is still in the state model
(default empty shape, no current writers). The new vector index is a
SEPARATE store (libSQL `embeddings` table on Node, IndexedDB on web).
The two never interact. Architecture doc gets a one-line note:
"`contentIndex` is the legacy v3 keyword-lookup file, dormant since
v4. The vector index introduced in FEAT068 supersedes it
functionally; the file remains as a state-shape placeholder for
backwards compatibility."

**Privacy posture.** Unchanged from FEAT067. Embedding happens
on-device (xenova WASM on web, onnxruntime on Node). Vector data
lives on-device (libSQL on Node, IndexedDB on web). The model
weights still come from huggingface.co on first use per device
(FEAT067 cond. 11 release-note language applies). Documented in
`docs/v4/03_memory_privacy.md` (cond. 17).

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **FEAT042 caller breakage during convergence** — porting `_semanticDedupFn`, `linker.ts`, assembler `retrieveContext` to the new interface introduces a behavior delta (e.g., different `maxDistance` default, different join semantics, different `metadata` shape) | Medium | High | §7 cond. 14 — existing FEAT042 unit tests pass unchanged. Cond. 15 — write a parity smoke that runs the same query through old + new path and asserts vector-set equality. The interface adapter for libSQL is intentionally thin: it calls the existing `searchSimilar` underneath. Behavior should be byte-identical. |
| **IndexedDB quota exhaustion on web** — large corpus (>10K chunks) + browser default quota (~50MB-2GB depending on origin) trips a write failure. | Low-Medium | Medium | Story 12's degraded path catches quota failures (single WARN, fall through to in-memory). Eviction policy deferred. Cond. 11 mandates the failure-mode test (mock `IDBObjectStore.put` rejection → fallback path engages). For FEAT044 mobile, the quota is tighter — that risk is FEAT044's. |
| **Backfill UX during first run with large corpus** — user opens app for the first time with 1K+ existing notes; backfill takes 30-60s; main thread responsive but `info_lookup` queries return partial results | Medium | Low-Medium | `requestIdleCallback` keeps interactions snappy. The retrieval result envelope carries `partial: true` when `getRagBackfillStatus().state === "running"`; handler appends "still building your index — answer may be incomplete" disclaimer. User sees progress implicitly through better answers as backfill completes. |
| **Retrieval timeout flapping** — 800ms soft timeout fires in 5-10% of calls when the embedder cold-starts on web (model weights downloading); user gets "no info" reply when index actually has the answer | Medium | Medium | Cond. 8 — soft timeout fires only when `await embed(phrase)` exceeds 800ms; the cold-start window is the FIRST query of a session, which may also be the user's first long-tail phrase. Two mitigations: (a) the prompt's "no info" branch is honest ("I'm not finding anything…") rather than confidently wrong; (b) future polish (FEAT-future) adds a warmup `embed("warmup")` after boot. The 800ms ceiling is intentionally aggressive — the user is waiting on the chat reply, and a slow `info_lookup` is worse than a fast "no info" + retry. |
| **Index drift** — indexer fails silently on a write (xenova throws, network blip during model load, IndexedDB quota); the entity persists relationally but never indexes; user later asks about it and gets "no info" when the data is right there | Medium | Medium | Cond. 12 — indexer logs every failure with `[rag-indexer] embed failed for note/<id>: <err>`. Cond. 13 — the boot-time backfill walker finds-unindexed and re-tries. So a transient failure self-heals on the next reload. Persistent failure (e.g., model permanently unloadable) is the FEAT067 fallback territory and surfaces in cond. 13's smoke. |
| **Multi-tab IndexedDB write conflicts** — user opens app in two tabs; both run backfill concurrently; double-indexing or inconsistent state | Low | Medium | IndexedDB transactions serialize writes per object store. The `chunks` store has a unique key on `chunkId`, so a duplicate upsert is a no-op (or overwrite, same content). Backfill walker checks `findUnindexed`-equivalent before embedding. Worst case: both tabs do a redundant embed that costs CPU but produces the same chunk. Acceptable. (Web-side single-tab assumption flagged in `docs/v4/04_attachments_rag.md`.) |
| **Schema-delta migration on the existing `embeddings` table** — adding `chunk_id`, `source`, `text`, `model_id` columns to a populated production DB | Medium | High | The libSQL backend's column add is a single `ALTER TABLE`. Existing rows backfill `model_id = 'unknown'` and `chunk_id = source_type || ':' || source_id` (synthetic id from existing fields). Cond. 16 mandates a migration script in `scripts/` (PERMANENT — not scratch — because it's reused on every fresh-clone Node setup) and a smoke that verifies the migration is idempotent. |
| **`retrievalHook` field validation** — a manifest declares the field with bad shape (e.g., `sources: "note"` instead of `["note"]`); dispatcher crashes mid-call | Low | Low | Cond. 9 — dispatcher validates the field shape on registry load. Bad shape → log WARN + treat as "hook absent" + dispatch normally. Manifest validation is the single place to enforce shape, parallel to FEAT054's locked-zone validation. |
| **Embedder unavailable on web during cold load** — first phrase of session hits `info_lookup`; embedder still downloading; retrieval returns `[]`; LLM gets "no chunks" + answers "I don't have any info" — even though the index is populated | Medium | Low | The same behavior FEAT067 already lives with for the routing step. Acceptable for v1. The user's second phrase reaches the warm path and works. The "no info" reply is honest. Cond. 8 makes the soft timeout 800ms specifically because waiting for the cold load behind every `info_lookup` would be worse UX. |

---

## 7. Conditions (numbered, BINDING)

1. **All ACs in Stories 1-13 testable + tested in stage 7.**
   The 13 user stories cover skill folder, store, indexer, chunker,
   retriever, dispatcher hook, triage, hint-map, backfill, model-id
   invalidation, BINDING smoke, IndexedDB-unavailable fallback, and
   docs.

2. **`VectorStore` interface in `src/modules/rag/store.ts`.** Define
   `interface VectorStore` with `upsertChunk`, `deleteChunksBySource`,
   `searchTopK`, `countByModelId`, `clearAll`. Two backends:
   `LibsqlVectorStore` (Node — wraps existing FEAT042 calls) and
   `IndexedDbVectorStore` (web/mobile — uses `idb`). Factory
   `getDefaultVectorStore()` picks per platform. **Indexer /
   retriever / backfill code is platform-agnostic and takes a
   `VectorStore` parameter** (defaults to `getDefaultVectorStore()`).

3. **Schema delta on existing `embeddings` table.** Add columns
   `chunk_id TEXT`, `source TEXT`, `text TEXT`, `model_id TEXT`. Populate
   with synthetic values for existing rows: `chunk_id =
   source_type || ':' || source_id`, `source = source_type`,
   `text = ''`, `model_id = 'unknown'`. Migration script
   `scripts/migrate-embeddings-schema.ts` (PERMANENT — not scratch).
   Idempotent. Tested against a fixture libSQL DB.

4. **Triage `FAST_PATH_MAP` entry.** Add an `info_lookup` regex
   covering at minimum: `^what do you know about\b`,
   `^tell me about\b`, `^what about\b` (when not a verb-prefix
   already-matched phrase), `^what can you tell me about\b`,
   `^do you know anything about\b`, `^any info on\b`,
   `^summarize what i (know|have) (about|on)\b`. Each match sets
   `legacyIntent: "info_lookup"`. Test asserts each Story 11 smoke
   phrase classifies as `info_lookup` either via fast-path OR
   embedding-routing on the skill's `triggerPhrases`.

5. **Indexer hook extends `db/flush.ts:indexAndLink`, NOT
   `executor.ts`.** The architect-corrected gap. Existing FEAT042 hook
   stays where it is; this FEAT extends `indexAndLink` (and
   `fileKeyToSourceType`) to cover `note` (already wired but verify),
   topic-chunk writes (new — fires when `appendToTopicFile` /
   `updateTopicPagesFromBrief` write a topic file), and
   `contextMemory.facts`. **Do NOT** add a new indexer call site in
   `executor.ts` — that would risk double-indexing.

6. **Declarative `retrievalHook` manifest field.** Add to
   `src/types/skills.ts`:
   ```ts
   retrievalHook?: {
     sources: ChunkSource[];
     k: number;
     minScore: number;          // include threshold (e.g., 0.25)
     minScoreInclude: number;   // confidence threshold (e.g., 0.40)
     softTimeoutMs?: number;    // default 800
   };
   ```
   `info_lookup`'s manifest declares
   `{ sources: ["note", "topic", "contextMemory"], k: 5,
   minScore: 0.25, minScoreInclude: 0.40 }`.

7. **Dispatcher reads `retrievalHook` between `resolveContext` and
   the LLM call.** When present, run `retrieveTopK` with the soft
   timeout. Inject results under `retrievedKnowledge` in the user
   message; inject metadata `retrievalMeta: { partial, topScore,
   count }`. On timeout / embedder failure, set
   `retrievedKnowledge: []` and proceed; the prompt's "no info"
   branch handles it. Log line:
   `[skillDispatcher] retrieved=N topScore=X.XX skill=info_lookup`.

8. **Soft timeout 800ms.** Implementation:
   `Promise.race([retrieveTopK(...), sleep(800).then(() =>
   ({ items: [], partial: false, topScore: 0, timedOut: true }))])`.
   On timeout, log WARN once per session and proceed.

9. **Manifest field validation on registry load.** Bad shape →
   WARN + treat as `retrievalHook: undefined`. Same pattern as
   FEAT054 locked-zone validation. Dispatcher never crashes on a
   misconfigured manifest.

10. **`MODEL_ID` cache invalidation on boot.** Before serving any
    retrieval, check `countByModelId(MODEL_ID)` against
    `countAllChunks()`. If any chunk has a non-matching `model_id`,
    log `[rag] model changed (was=X is=Y), rebuilding index — N
    chunks dropped`, call `store.clearAll()`, kick `runBackfill()`.
    The check itself is cheap (single indexed query).

11. **IndexedDB-unavailable degraded path.** Probe `indexedDB.open`
    on store init. On rejection, log a single WARN
    (`[rag] IndexedDB unavailable, running with in-memory only —
    knowledge will not persist across reloads`), use an in-memory
    `Map<chunkId, IndexEntry>` as the store, kick the backfill into
    it. Unit test mocks `indexedDB.open` to reject and asserts the
    fallback engages.

12. **Indexer failure logging.** `indexEntity` failure path logs
    `[rag-indexer] embed failed for <source>/<id>: <err>` (already
    present in FEAT042's `indexer.ts:53-56`). Failures are
    non-throwing — relational write integrity is preserved.

13. **MANDATORY — Real-LLM smoke (BINDING).** Tester runs
    `scripts/scratch/smoke-feat068.ts` (gitignored). The harness
    seeds a fixture corpus into the new `VectorStore`:
    - One note about "Project Alpha" with at least 3 sentences of
      generic content
    - One topic page about "Topic X" with 2-3 paragraphs of
      generic content
    - 3-5 `contextMemory` facts including
      `{ topic: "family", text: "Family member relation:
      [generic role]" }`
    - One note about "Project Beta" with one sentence
    - One topic page about "Topic Y" with 2 paragraphs +
      `contextMemory` facts about Topic Y

    The harness runs the 6 phrases from Story 11 against the live
    API end-to-end (triage → router → dispatcher → retrieval →
    LLM → handler). Per phrase, assert:
    - `routeResult.skillId === "info_lookup"`
    - `dispatchResult.handlerResult` is non-degraded
    - `dispatchResult.items.length > 0` for the 5 hit phrases
    - `dispatchResult.items.length === 0` for the no-info phrase
    - The LLM's `reply` quotes or paraphrases at least one
      retrieved chunk (regex/keyword check)
    - The LLM's `reply` does NOT mention any string from outside
      the fixture corpus (anti-hallucination check)

    **Pass threshold: 5/6 strict** (one slot of variance for LLM
    nondeterminism). Output captured in `FEAT068_test-results.md`:
    per-phrase log line, retrieved-chunk count, top-score, model
    output verbatim, anti-hallucination check result.

14. **FEAT042 regression — existing semantic-dedup test passes
    unchanged.** Whatever test exercises `_semanticDedupFn` /
    `linker.ts` / assembler `retrieveContext` today must pass with
    the same fixtures after the convergence port. If a test has to
    change, document why in the test results.

15. **FEAT042 parity smoke.** A new test runs the same query
    (`"buy milk"`) through both:
    - Old path: direct `searchSimilar` from `db/queries/embeddings.ts`
    - New path: `getDefaultVectorStore().searchTopK` via the
      libSQL adapter
    Asserts byte-equal `RetrievalResult[]` (sourceId, distance,
    metadata). Catches interface-leakage bugs.

16. **Schema migration is reusable.** The
    `scripts/migrate-embeddings-schema.ts` script is committed
    (PERMANENT, not scratch) because every fresh-clone Node setup
    needs it. Idempotent — running twice is a no-op.

17. **`docs/new_architecture_typescript.md` updated.** Section 3
    (Project Structure) lists `src/modules/rag/`. Section 4 (Data
    Files) notes the IndexedDB store on web (NOT a JSON file) and
    the libSQL `embeddings` table on Node, with the
    `contentIndex` coexistence note from §5. Section 5 (Types) adds
    `IndexEntry`, `RetrievalResult`, `RagBackfillStatus`,
    `ChunkSource`, `RetrievalHook`. Section 6 (Module
    Responsibilities) adds the rag/* modules and updates the
    data-flow diagram with the pre-LLM retrieval hop. Section 8
    (Token Budgets) lists `info_lookup` at 4000. Section 9 (ADR)
    records two new decisions: "Persistent vector index from day
    one with `VectorStore` interface + platform backends," and
    "Pre-LLM retrieval is declarative via manifest `retrievalHook`
    field." Section 12 (Feature Catalog) adds `info_lookup`.
    Update `docs/v4/03_memory_privacy.md` (vector data on-device)
    and `docs/v4/04_attachments_rag.md` (concrete vector path
    landed). Update `README.md` features list, modules table, data
    files table, skills section.

18. **Bundle gate — `npm run build:web` exports.** Bundle-size
    delta < 5% per FEAT064 budget. Expected ~5KB increase from
    `idb` + the new rag/* modules. The xenova / onnx-web payload
    was already shipped by FEAT067 — this FEAT adds no new heavy
    dependencies.

---

## 8. UX

**Zero blocking changes.** App boot path is unchanged:
`applyConfig` → `setV4SkillsEnabled([... "info_lookup"])` → kick
`runBackfill()` (non-blocking) → app ready.

**Visible deltas after this FEAT lands:**

- "what do you know about X" / "tell me about Y" / "what about
  X" / similar phrases route to `info_lookup` and return cited,
  grounded answers instead of the polite-refusal pattern from
  `general_assistant`.
- Chat surface renders an `ItemListCard` underneath the reply
  showing the cited chunks (one item per retrieved chunk above
  threshold). User can click through to the source. Existing
  pattern from `task_management` query results.
- First-run users with existing notes see a brief "still building
  index" disclaimer on early `info_lookup` queries; the
  disclaimer disappears once backfill completes (typically <60s
  for ~1K-chunk corpora).
- IndexedDB-disabled users (private browsing) get the in-session
  fallback — `info_lookup` works for the session but doesn't
  persist on reload. Single WARN in console; no user-visible
  error.
- Model-id change between runs (very rare — only if
  `provider.ts:MODEL_ID` is bumped) triggers a one-time rebuild
  on the next boot, logged once.

The cold-start window (first phrase of a fresh session) may hit
the 800ms retrieval timeout and return "I don't have anything
specific about X" even when the index has the answer. This is
intentional — better honest miss than slow chat. Subsequent
phrases hit the warm path.

---

## 9. Test strategy

### 9.1 Unit — `VectorStore` interface

Test both backends in isolation with the same test suite (parametrized):
- `upsertChunk` round-trips the full `IndexEntry` shape.
- `deleteChunksBySource` removes only the matching `(source,
  sourceId)` chunks.
- `searchTopK` with no filter returns top-K across all sources.
- `searchTopK` with `source` filter narrows correctly.
- `searchTopK` with `minScore` cuts below threshold.
- `countByModelId` matches inserted modelIds.
- `clearAll` empties the store.
- Empty store: `searchTopK` returns `[]`.

Backend-specific tests:
- `LibsqlVectorStore`: in-memory libSQL DB, schema migration
  applied, FEAT042 parity (cond. 15).
- `IndexedDbVectorStore`: `fake-indexeddb` (already a transitive
  dep candidate), open/close cycle, transaction abort recovery.

### 9.2 Unit — indexer / retriever / backfill

- `indexer.indexChunk` calls `embed` + `store.upsertChunk` with
  the right `IndexEntry` shape per source. Skips text < 5 chars.
  Skips NaN/Inf vectors.
- `retriever.retrieveTopK` embeds query, calls
  `store.searchTopK`, applies score thresholds correctly.
  Returns `[]` on null embedder + WARN once per session.
- `backfill.runBackfill` walks notes + facts + topic files,
  skips already-indexed entities (matching sourceId + modelId).
  Idempotent on second run.
- Backfill respects `requestIdleCallback` chunking (mock
  `requestIdleCallback`; verify chunk-size 5-10 per tick).
  Safari fallback path (no `requestIdleCallback`) uses
  `setTimeout(0)`.
- Concurrent write during backfill: write-time hook upserts the
  chunk; backfill walker skips it (no double-indexing). Cover
  with a fixture that simulates the race.
- Cache invalidation on `MODEL_ID` change: seed an index with
  `modelId: "old-model"`, set `MODEL_ID` to a different value,
  boot → log emitted → all chunks dropped → backfill kicked.

### 9.3 Unit — chunker

- `chunkTopicPage` splits on double newline, drops empties, caps
  each chunk at ~500 chars, splits further on sentence boundary
  if longer. Generic fixture topic page (no real user data).
- Topic-page rewrite: `deleteChunksBySource("topic", topicId)`
  → re-chunk → upsert. No stale chunks linger.

### 9.4 Unit — dispatcher hook

- Manifest with `retrievalHook` triggers retrieval call;
  manifest without it skips it.
- `retrievalHook.softTimeoutMs` honored (mock `retrieveTopK` to
  delay 1000ms; assert the dispatcher proceeds at 800ms).
- `partial: true` flag propagates when `getRagBackfillStatus()`
  returns "running."
- Bad-shape `retrievalHook` (e.g., `sources: "note"`) → WARN +
  treat as absent. Skill dispatch still succeeds.

### 9.5 Integration — `info_lookup` skill end-to-end

- Stub LLM returns a fixed `submit_info_lookup({ reply, items })`
  call. Fixture corpus seeded into the (mocked) vector store.
  Assert: phrase routes to `info_lookup`, retrieval populates
  `retrievedKnowledge` with the right chunks, handler returns
  `items: RetrievalResult[]`, dispatcher pipes through to
  `dispatchResult.items`.
- TriageResult with `legacyIntent: "info_lookup"` routes to
  `skillId: "info_lookup"` with `routingMethod: "triage_hint"`.
- `setV4SkillsEnabled` excluding `info_lookup` → dispatch
  returns `null` → caller falls through to legacy.

### 9.6 BINDING — real-LLM smoke

Per cond. 13. 6 phrases, 5/6 strict, anti-hallucination check
per phrase, output in `FEAT068_test-results.md`.

### 9.7 Regression

- FEAT042 unit suite passes unchanged (cond. 14).
- FEAT042 parity smoke (cond. 15) — same query through old +
  new path returns byte-equal results.
- FEAT066 binding smoke (10/11 phrases, embedder DISABLED) still
  passes — this FEAT does not regress head-of-distribution
  routing (the triage-hint flip is an additive change).
- FEAT067 binding smoke (10/10 phrases, embedder ENABLED) still
  passes — the embedder surface is unchanged.
- Every existing skill's BINDING smoke continues to pass with
  the new dispatcher hook present (manifest without
  `retrievalHook` field is the no-op path).

### 9.8 Out of scope

- iOS/Android quota smoke (deferred to FEAT044).
- Cross-tab IndexedDB consistency (single-tab assumption
  documented).
- Re-ranking with cross-encoder (deferred per spec).
- BM25 hybrid search (deferred per spec).
- Eviction policy (deferred per spec).

---

## 10. Pattern Learning

**FEAT068 codifies two patterns for the next migration / extension:**

1. **Declarative pre-LLM retrieval hook.** When a skill needs to
   retrieve before reasoning, declare the hook in the manifest:
   ```json
   "retrievalHook": {
     "sources": ["note", "topic", "contextMemory"],
     "k": 5,
     "minScore": 0.25,
     "minScoreInclude": 0.40
   }
   ```
   The dispatcher reads the field, embeds the phrase, runs
   `retrieveTopK`, injects results under `retrievedKnowledge`
   in the user message, and tags the envelope with `partial:
   true` when backfill is in progress. No skill-specific
   dispatcher code. Future RAG-using skills (`priority_planning`
   over notes, `suggestion_request` over context-memory,
   `learning` over a knowledge base) opt in by adding the field.

2. **Cross-platform persistent storage via `VectorStore`-style
   interface.** When a future FEAT needs persistent storage that
   spans Node + web + Capacitor mobile, define an interface
   first, then ship platform-specific backends (libSQL on Node,
   IndexedDB on web/mobile). Platform-agnostic logic
   (indexer / retriever / backfill in this FEAT's case) takes
   the interface as a parameter. The same shape works for any
   future cross-platform store (chat history, attachments,
   user-settings sync). FEAT044 mobile inherits whichever
   web-backend the FEAT ships.

After FEAT068:
- 8 skills migrated (priority_planning, general_assistant,
  task_management, notes_capture, calendar_management,
  inbox_triage, emotional_checkin, info_lookup).
- First skill with a declarative pre-LLM retrieval hook.
- First cross-platform persistent storage with platform
  backends.
- AGENTS.md generic-rules pass picks up two new template
  entries (deferred per project-memory rule).

**Carry-forward:**

- FEAT044 Capacitor verifies IndexedDB quota + structured-clone
  on iOS/Android.
- FEAT083+ Topics' write surface auto-indexes via the existing
  flush-layer hook with no FEAT083 work.
- v2.03+ may add eviction policy, hybrid search (BM25 +
  vector), cross-device sync, or cross-encoder re-ranking
  per spec out-of-scope list.

---

## 11. Sign-off

Architect approves. Conditions §7 binding (18 items). Conditions
2 (`VectorStore` interface), 5 (indexer hook stays in
`db/flush.ts`), 6+7 (declarative `retrievalHook` field),
13 (BINDING smoke 5/6 strict), 14+15 (FEAT042 parity) are the
parity-defining artifacts — coder must complete all five before
declaring Done.

**Pay special attention to:**

- **Condition 5 (indexer hook location).** The architect-corrected
  gap. PM's spec assumed `executor.applyAdd` /
  `executor.applyDelete` — the existing FEAT042 hook actually
  lives in `src/db/flush.ts:103-167` (`indexAndLink`). Extend
  THAT, not executor. Adding a parallel hook in executor risks
  double-indexing.
- **Conditions 14 + 15 (FEAT042 regression + parity).** The
  convergence port touches six FEAT042 callers
  (`_semanticDedupFn`, `linkTask`, `linkEvent`,
  `retrieveContext`, `runBackgroundIndex`, `indexAndLink`). Any
  behavioral delta breaks production semantic dedup. The parity
  smoke (cond. 15) is the load-bearing artifact — same query
  through old + new path must return byte-equal results.
- **Condition 13 (BINDING smoke 5/6).** Six phrases, anti-
  hallucination check per phrase. Phrase #4 (no-info) is the
  fabrication-catcher — if the LLM invents facts, that phrase
  fails. Phrase #5 (Project Beta with one note + one task,
  task NOT in source filter) is the source-filter test — if
  the answer mentions the task, the `retrievalHook.sources`
  scoping is broken.
- **Audit row 9 (`contentIndex`).** PM said "gone from
  runtime" — it isn't. Don't remove `contentIndex` references
  in this FEAT. Update the spec text and the architecture doc
  to note the coexistence.
- **Audit row 2 (executor vs flush).** This is the same
  finding as cond. 5, restated: PM's "executor only" framing
  for the indexer hook was wrong. The flush hook is the
  existing single source of truth.
- **Soft timeout 800ms (cond. 8).** Aggressive on purpose.
  The first phrase of a fresh session may flap to "no info"
  even when the index has the answer. That's intentional.
  Don't bump to 3s — a slow `info_lookup` is worse than a
  fast honest miss.
- **Schema migration (cond. 3 + 16).** The migration script is
  PERMANENT (committed to `scripts/`), not scratch. Every
  fresh-clone Node setup needs it. Idempotent.
- **`retrievalHook` shape validation (cond. 9).** Bad shape
  must NEVER crash the dispatcher. WARN + treat as absent.

This auto-advances to the coder. No further architect review
required unless the coder surfaces a condition-blocking finding
during stage 5 or the BINDING smoke (cond. 13) fails.
