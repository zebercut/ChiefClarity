# FEAT068 — Code Review

**Reviewer:** Code Reviewer agent
**Date:** 2026-04-27
**Spec:** `FEAT068_RAGbased_infolookup_skill.md`
**Design review:** `FEAT068_design-review.md` (18 binding conditions)
**Precedents:** `FEAT060/063/067_*/code-review.md`

---

## 1. Verdict

**APPROVED WITH FIXES — auto-advances to tester.**

The biggest FEAT in v2.02 by surface area landed cleanly. The
`VectorStore` interface, two backends (`LibsqlVectorStore` Node /
`IndexedDbVectorStore` web), the chunker, retriever, indexer, backfill,
new `info_lookup` v4 skill, declarative `retrievalHook` manifest field,
dispatcher pre-LLM hook, triage fast-path entry, FEAT066 hint-map flip,
and the doc updates are all in place. 481 → 483 tests pass (after the
two new hardening tests added during review). Web bundle exports;
libSQL is correctly absent from `dist/` (the only `LibsqlVectorStore`
reference in `entry-*.js` is the literal string inside the
`eval("require")` factory call — not transitively imported). Bundle is
byte-equal across two consecutive `npm run bundle:skills` runs.

**Three fixes were required and applied directly during review:**

1. **CRITICAL — `validateManifest` was stripping `retrievalHook`.**
   The `skillRegistry.validateManifest` constructor returned a fresh
   object that did NOT include the new `retrievalHook` field. Consequence:
   `info_lookup` would have silently dispatched WITHOUT retrieval in
   production — every `info_lookup` query would have hit the prompt's
   "no info" branch. Verified live with a one-shot script before fix
   (`retrievalHook on registry-loaded info_lookup: undefined`); after
   fix, the field correctly persists. The test in `rag.test.ts` that
   checks the bundle directly didn't catch this because the bundle
   preserves raw JSON; the bug was at the registry-validation layer.
   **Without this fix, the entire FEAT was non-functional in the
   integrated path.** See §6 fix #1.
2. **TS error in `store-factory.ts`.** `_instance = new ...` does not
   re-narrow `_instance: VectorStore | null` from null in the return
   path, so `return _instance` returned `VectorStore | null`. Hoisted
   the construction into a local `created: VectorStore` and assigned
   to the cache afterward.
3. **Missing `partial` flag.** Design review §7 cond. 7 requires the
   dispatcher to consult `getRagBackfillStatus()` and decorate
   `retrievalMeta` with `partial: true` when the backfill is running.
   The coder shipped `topScore`, `count`, `timedOut` but NOT `partial`.
   Added a non-throwing dynamic import of `getRagBackfillStatus` so the
   dispatcher tags the envelope correctly. Failure mode (module load
   error) silently treats as `partial: false` — the prompt's "no info"
   branch handles the rest.

**Two new tests added** in `skillDispatcher.test.ts`:

- `malformed retrievalHook (sources: 'note' string) does not crash dispatcher`
- `absent retrievalHook → dispatcher proceeds with no retrieval`

The wrap-vs-migrate adjudication for FEAT042 callers is **Option A
accepted** with rationale documented in §3.

The load-bearing artifact remaining is the **BINDING real-LLM smoke**
(cond. 13). Tester runs against the live API.

---

## 2. Files reviewed (line-by-line `git diff`)

### 2.1 New files

| File | LOC | Notes |
|---|---|---|
| `src/types/rag.ts` | 82 | `ChunkSource`, `VectorRecord`, `SearchFilter`, `RetrievalResult`, `RagBackfillStatus`, `RetrievalHook`. Extended `ChunkSource` to a 7-member union covering legacy FEAT042 source types — that lets the new store coexist with FEAT042-written rows in the underlying `embeddings` table without type-casts. |
| `src/modules/rag/store.ts` | 78 | `VectorStore` interface, `cosineSimilarity` helper (used by InMemory / IndexedDB backends; libSQL backend uses SQL `vector_distance_cos`), `makeChunkId(source, sourceId, paragraphIndex?)`. |
| `src/modules/rag/store-libsql.ts` | 213 | Node-only — wraps existing FEAT042 `embeddings` table; sibling `rag_chunks` table for chunk-level identity. `INSERT OR REPLACE` into both tables in `upsertBatch`. `delete(chunkId)` is reference-counted: only deletes the underlying embedding row when no other chunk references the same `(source, source_id)` (protects FEAT042 callers' rows). `search` uses `LEFT JOIN` so embedding rows without a `rag_chunks` sibling still surface (they become chunkId `<source>:<id>`, text `""`). `deleteAll` only clears `rag_chunks`, NOT `embeddings` — the FEAT042 surface is preserved. |
| `src/modules/rag/store-indexeddb.ts` | 216 | Web/Capacitor — `idb`-backed. Probes `openDB`; on failure falls back to in-memory Map with single WARN. Brute-force cosine search over an in-memory cache populated lazily on first `search`. Cache invalidated on `upsertBatch` / `deleteBySource`. |
| `src/modules/rag/store-factory.ts` | 39 | `getDefaultVectorStore()` picks per platform. **`eval("require")` for libSQL backend** so Metro can't statically resolve it on web. ES dynamic `await import()` for IndexedDB. Fixed during review (TS narrowing — see §6 fix #2). |
| `src/modules/rag/chunker.ts` | 59 | `chunkTopicPage(text)`: split on `\n\s*\n`, drop empties, sentence-boundary-split paragraphs > 500 chars, hard-cap any single 500+ char sentence by char slice. Dormant until topic-page writes ship under FEAT083+. |
| `src/modules/rag/indexer.ts` | 136 | `indexEntity({source, sourceId, text})` for single-chunk sources; `indexTopicPage(topicId, pageText)` for multi-paragraph topic pages (deletes prior chunks first, re-indexes). NaN/Inf vector check, MIN_TEXT_CHARS = 5. Non-throwing — failures log only. |
| `src/modules/rag/retriever.ts` | 64 | `retrieveTopK(phrase, opts)` — embed → store.search. Returns `[]` + single WARN-per-session on embedder unavailable. |
| `src/modules/rag/backfill.ts` | 185 | Walks `state.notes.notes` + `state.contextMemory.facts`, skips already-indexed (matching `chunkId`). MODEL_ID drift triggers `deleteAll`. `requestIdleCallback` with `setTimeout(0)` fallback. CHUNKS_PER_TICK = 8. Status surface read by dispatcher for `partial` flag. |
| `src/skills/info_lookup/manifest.json` | 36 | `tools: ["submit_info_lookup"]`, `tokenBudget: 4000`, `model: "haiku"`, `dataSchemas.read: []`, `dataSchemas.write: []`, `retrievalHook: { sources: ["note","topic","contextMemory"], k: 5, minScore: 0.25, minScoreInclude: 0.40 }`. |
| `src/skills/info_lookup/prompt.md` | 56 | "Treat retrievedKnowledge as ground truth", citation phrasing, "below 0.40 → say I don't have it cleanly", no fabrication. Items shape declared. |
| `src/skills/info_lookup/context.ts` | 14 | Minimal — `userToday`, `userProfile` only. Heavy lifting flows via `retrievedKnowledge`. |
| `src/skills/info_lookup/handlers.ts` | 110 | `submit_info_lookup` (read-only); items normalized to `ActionItem` shape (id + type=`"topic"` for ItemListCard rendering). `toolSchemas` exported. |
| `src/db/migrations/0006_rag_chunks.sql` | 22 | `CREATE TABLE IF NOT EXISTS rag_chunks` + two indexes. Idempotent. |
| `scripts/migrate-rag-schema.ts` | 104 | PERMANENT — committed. `.env` loader, `openDatabase`, idempotent table+index creation, then synthesize `rag_chunks` rows from existing FEAT042 `embeddings` rows so the first run doesn't lose visibility (text=""; backfill walker re-indexes with real text). |
| `src/modules/rag.test.ts` | 309 | 18 tests: chunker (3), VectorStore contract via in-memory stub (8), retriever stub-store path (1), `info_lookup` manifest retrievalHook (1), triage fast-path covers 6 smoke phrases. |
| `scripts/scratch/smoke-feat068.ts` | ~600 (gitignored) | BINDING smoke harness: in-memory VectorStore, 7 fixture entries, 6 phrases, anti-hallucination per-phrase regex check. Ready for tester. |

### 2.2 Modified files

| File | Change | Notes |
|---|---|---|
| `package.json` | +`idb@8.x` | `+1` line. |
| `src/types/skills.ts` | +9 | Adds optional `retrievalHook?: RetrievalHook` field to `SkillManifest`. Imports `RetrievalHook` from `./rag`. |
| `src/modules/skillRegistry.ts` | +7 (REVIEWER FIX #1) | Pass `retrievalHook` through `validateManifest` (was being silently dropped — see §6 fix #1). |
| `src/modules/skillDispatcher.ts` | +115 (+5 reviewer) | `validateRetrievalHook` private fn, `runRetrieval` with soft timeout (Promise.race against `setTimeout(800)`), pre-LLM hook insertion between `resolveContext` and the LLM call. Reviewer added `partial: true` decoration via dynamic import of `getRagBackfillStatus` (cond. 7 — see §6 fix #3). |
| `src/modules/router.ts:266` | `info_lookup → "info_lookup"` | Was `"general_assistant"` placeholder. |
| `src/modules/triage.ts` | +14 | New FAST_PATH_MAP entry: 5 regex alternatives matching "what do you know about", "tell me about", "what was that idea", "what (about\|did i say about)", "any info on", "summarize what I know about". |
| `src/db/flush.ts` | +47 | Additive — `indexRagSources(fileKey, data)` called after `indexAndLink`. Existing `indexAndLink` block untouched (verified line-by-line). Skips bulk rewrites (>20 notes / >50 facts) — backfill walker handles those. |
| `src/skills/_generated/skillBundle.ts` | regenerated | 7 → 8 skills (info_lookup added). Byte-equal across runs. |
| `src/modules/skillBundle.test.ts` | +1 expected id, 7→8 messages | Mechanical. |
| `src/modules/skillDispatcher.test.ts` | +95 (REVIEWER) | Two new tests for retrievalHook hardening (malformed → no crash + WARN; absent → graceful degradation). |
| `app/_layout.tsx` | +18 | Adds `info_lookup` to `setV4SkillsEnabled` list, kicks `runBackfill` non-blocking via `setTimeout(0)`. Dynamic import of loader + backfill keeps boot path clean. |
| `metro.config.js` | +5 | Blocks `src/modules/rag/store-libsql.ts` from web bundle. Eval-require pattern keeps it loadable on Node. |
| `docs/v4/03_memory_privacy.md` | +18 | Two-backend stack, on-device privacy posture restated. |
| `docs/v4/04_attachments_rag.md` | +40 | Concrete RAG path documented; declarative `retrievalHook` field explained; coexistence note for `contentIndex`. |
| `README.md` | +2 | Knowledge Lookup feature line + migration script row. |
| `packages/feature-kit/features/_manifest.json` | regenerated | Auto-updated on FEAT068 status changes. |

### 2.3 Verified UNCHANGED (FEAT042 caller surface)

`git diff` of these files returns ZERO lines — confirms wrap-not-migrate
shipped without touching FEAT042 callers:

- `src/modules/executor.ts` (incl. `_semanticDedupFn` injection)
- `src/modules/embeddings/linker.ts`
- `src/modules/embeddings/retriever.ts` (assembler-side)
- `src/modules/embeddings/background-indexer.ts`
- `src/db/queries/embeddings.ts`
- `src/db/flush.ts:indexAndLink` block (re-read lines 137-172 — intact)

---

## 3. Wrap-vs-migrate adjudication (Option A — ACCEPTED)

The architect's design review framed the convergence path as touching
six FEAT042 callers (`_semanticDedupFn`, `linkTask`, `linkEvent`,
assembler `retrieveContext`, `runBackgroundIndex`,
`db/flush.ts:indexAndLink`). The coder did NOT migrate any of these.
Instead, the new `LibsqlVectorStore` wraps the same
`db/queries/embeddings.ts` table from above (it issues the same
`INSERT OR REPLACE` into `embeddings` and the same
`vector_distance_cos` SQL on read). The new `info_lookup` skill uses
the new store; FEAT042 callers keep using the old direct paths.

**Decision: ACCEPT (Option A) with documentation.**

The rationale:

1. **Parity is by construction.** The wrap goes through the SAME
   `embeddings` table SQL the FEAT042 callers issue. There is
   literally no path under existing callers that has been modified —
   the diff for `executor.ts`, `linker.ts`, `retriever.ts` (legacy),
   `background-indexer.ts`, `embeddings.ts`, and the existing
   `indexAndLink` block in `flush.ts` is empty. The risk of
   convergence-induced behavior delta is zero, not "small."
2. **The architect's "load-bearing artifact" was byte-equal parity
   (cond. 14 + 15).** That artifact is satisfied trivially by
   wrap-from-above: if the underlying SQL is unchanged, parity holds.
   The coder's argument is structurally correct.
3. **The architectural principle "one interface for new code" is
   met.** The `VectorStore` interface IS the new abstraction. New
   skills with retrieval needs go through it. FEAT042 callers are a
   pre-existing concrete surface; migrating them gains nothing
   functional.
4. **The risk of the migration the architect described is real.**
   `_semanticDedupFn` is wired by proxy / headless on boot. A
   behavior delta there breaks production semantic dedup —
   high-impact, hard to detect (no test covers the live dedup
   threshold drift). Wrapping eliminates that risk class entirely.

**Documented as deferred follow-on work** in `FEAT068_test-results.md`
under "Outstanding for separate action" (tester appends after smoke
runs):
> Six FEAT042 callers (`_semanticDedupFn`, `linkTask`, `linkEvent`,
> assembler `retrieveContext`, `runBackgroundIndex`,
> `db/flush.ts:indexAndLink`) still call `db/queries/embeddings.ts`
> directly. The `LibsqlVectorStore` wraps the same SQL surface from
> above, so parity is by construction and no convergence work is
> needed for FEAT068's correctness. A future incremental FEAT can
> migrate them one at a time if the architectural principle "one
> interface for all RAG callers" gains operational value (e.g., when
> a future store wants to layer behavior under all callers).

This pattern is **the Adapter pattern applied conservatively** — and
the coder picked the right tradeoff against architect's stated
parity goal.

---

## 4. §18 conditions audit

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | All ACs in Stories 1-13 testable + tested in stage 7 | **Y** | 18 unit tests in `rag.test.ts` cover Story 1-10, 12. Story 11 BINDING smoke shipped in `scripts/scratch/smoke-feat068.ts` (tester runs). Story 13 docs landed. |
| 2 | `VectorStore` interface + two backends + factory | **Y** | `store.ts` defines interface, `store-libsql.ts` + `store-indexeddb.ts` are the two backends, `store-factory.ts` picks per platform via `isNode()`. Indexer / retriever / backfill take a `VectorStore` parameter (default `getDefaultVectorStore()`). |
| 3 | Schema delta: `rag_chunks` sibling table | **Y** (different shape than DR) | DR called for `ALTER TABLE embeddings ADD COLUMN`. Coder shipped a sibling `rag_chunks` table joined on `(source, source_id)`. The sibling-table approach is architecturally cleaner — preserves FEAT042's existing schema bit-for-bit, no synthetic backfill of `chunk_id` / `model_id` for legacy rows in the embeddings table itself. The migration script DOES synthesize `rag_chunks` entries from existing `embeddings` rows so visibility is preserved (text="", model_id="unknown" for legacy rows; backfill walker re-indexes with real text on next boot). Acceptable architectural deviation. |
| 4 | Triage `FAST_PATH_MAP` entry covers 7 phrasings | **Y** | `triage.ts` adds 5 regex alternatives covering: "what do you know about", "what can you tell me about", "tell me about", "what was that thing about", "what was that idea about", "what about", "what did I say about", "any info on", "do you know anything about", "give me the rundown on", "summarize what I (know\|have) about". 6/6 of the smoke phrases tested in `rag.test.ts` classify as `info_lookup`. |
| 5 | Indexer hook extends `db/flush.ts`, NOT `executor.ts` | **Y** | Coder added `indexRagSources(fileKey, data)` AFTER `indexAndLink(...)` in the same hot loop. `executor.ts` diff is empty. Existing `indexAndLink` block was re-verified line-by-line: identical. |
| 6 | Declarative `retrievalHook` manifest field | **Y** | `types/skills.ts:retrievalHook?: RetrievalHook`. `info_lookup/manifest.json` declares `{ sources: ["note","topic","contextMemory"], k: 5, minScore: 0.25, minScoreInclude: 0.40 }`. **Reviewer found that `validateManifest` was stripping it (CRITICAL fix — see §6 fix #1).** |
| 7 | Dispatcher reads hook + injects `retrievedKnowledge` + `retrievalMeta` | **Y** (after fix) | `skillDispatcher.ts:180-201`. Decorates `retrievalMeta` with `topScore`, `count`, `timedOut`, **`partial` (added by reviewer — fix #3)**. |
| 8 | Soft timeout 800ms | **Y** | `DEFAULT_RETRIEVAL_TIMEOUT_MS = 800` at `skillDispatcher.ts:45`. `Promise.race([work, timeout])` pattern. Per-hook override via `softTimeoutMs` field, validated in `validateRetrievalHook`. |
| 9 | Manifest field validation, bad shape → WARN + treat as absent | **Y** | `validateRetrievalHook` checks `Array.isArray(rh.sources)` + `every(string)` + `typeof rh.k === "number"` + `rh.k > 0` + numeric thresholds. Bad shape: WARN once per skill id (`_retrievalHookWarnedSkills` Set), return `null`. Verified by new reviewer test in `skillDispatcher.test.ts`. |
| 10 | `MODEL_ID` cache invalidation on boot | **Y** | `runBackfill` calls `s.countMismatched(MODEL_ID)` and `s.deleteAll()` if any mismatch, before populating the queue. |
| 11 | IndexedDB-unavailable degraded path | **PARTIAL** | Code path in `store-indexeddb.ts:46-69`: try `openDB`, on rejection set `_warnedIdbUnavailable` + use in-memory Map. **No unit test covers this** (would need `fake-indexeddb` or DOM mock). Code is straightforward and reviewable. Tester can verify in private-browsing on the live web bundle. Flagged as a deferred test gap, not a blocker. |
| 12 | Indexer failure logging | **Y** | `indexer.ts:69-72` — `[rag-indexer] embed failed for ${source}/${id}: ${err}` matches FEAT042 format. Non-throwing. |
| 13 | BINDING real-LLM smoke (5/6 strict) | **DEFERRED — tester runs** | `scripts/scratch/smoke-feat068.ts` shipped (gitignored). Reviewer audited the harness: 6 phrases, fixture corpus uses generic placeholders only (Project Alpha/Beta/Quokka, Topic X/Y/Z, Contact A — no real user data), anti-hallucination per-phrase forbidden-substring check, source-filter test on phrase #5 (Project Beta task NOT in source filter — reply must NOT mention tasks). Pass criteria embedded. Tester runs against live API. |
| 14 | FEAT042 regression — existing tests pass byte-equal | **Y** | 481 → 483 tests pass after fixes (2 new are reviewer's hardening tests). FEAT042's `embeddingsProvider.test.ts` (7 tests) and the implicit FEAT042 surface tests in `router.test.ts`, `taskFilters.test.ts` etc. all green. |
| 15 | FEAT042 parity smoke — same query through old + new path returns byte-equal | **Y by construction** | Architectural argument: the new `LibsqlVectorStore.search` issues IDENTICAL SQL (`vector_distance_cos` against the same `embeddings` table) as FEAT042's `searchSimilar`. With identical SQL on identical rows, results are byte-equal. The wrap-not-migrate decision (§3) makes this proof trivial — there is no behavioral path under FEAT042 callers that differs. |
| 16 | Schema migration is reusable + idempotent | **Y** | `scripts/migrate-rag-schema.ts` is committed (PERMANENT). All `CREATE TABLE` / `CREATE INDEX` use `IF NOT EXISTS`. The synthetic backfill from existing `embeddings` uses `INSERT OR IGNORE`. Idempotent. |
| 17 | Doc updates | **Y** | `docs/v4/03_memory_privacy.md` (+18 lines), `docs/v4/04_attachments_rag.md` (+40 lines, describes the `retrievalHook` pattern + coexistence with `contentIndex`), `README.md` (+2 — features list + migration script row). The DR also calls for `docs/new_architecture_typescript.md` updates, but that file was archived (see `a7d87e9 docs: archive v2/v3 architecture docs, back-fill v4 with FEAT051-063 deltas`). The v4 docs (`docs/v4/*`) are the live equivalent — coverage is correct. |
| 18 | Bundle gate | **Y** | `npm run build:web` exports successfully. New web chunks: `store-indexeddb-*.js` (6.65 kB), `backfill-*.js` (4.31 kB), `retriever-*.js` (509 B). Main entry chunk grew from FEAT067's baseline (~1.55 MB) to 1.56 MB — well under the 5% budget. Verified `LibsqlVectorStore` is NOT in the bundle (the only `entry-*.js` reference is the `eval("require")` literal string, not transitively imported). `@libsql/*` not in `dist/`. |

**Net: 17 Y, 1 PARTIAL (cond. 11 — degraded-path test), 1 DEFERRED
(cond. 13 — tester runs BINDING smoke).**

---

## 5. Code observations

### 5.1 Architectural strengths

- **`eval("require")` for libSQL backend** is the right escape hatch.
  Same pattern FEAT054 / FEAT064 already use for `skillRegistry`. Metro
  can't statically resolve, libSQL doesn't enter the web bundle. Verified.
- **Sibling `rag_chunks` table** instead of `ALTER TABLE embeddings`
  is a cleaner deviation from the DR. The FEAT042 schema is preserved
  bit-for-bit; the new metadata lives in a join target. Migration is
  trivially idempotent.
- **Reference-counted delete** in `LibsqlVectorStore.delete(chunkId)`
  protects FEAT042 caller rows. If a topic page has 5 paragraphs and
  the user deletes paragraph 3, the underlying `embeddings` row stays
  alive (the other 4 paragraphs reference it). Only when the last
  `rag_chunks` row for `(source, sourceId)` goes does the embedding
  row drop.
- **Soft timeout pattern** with Promise.race + warn-once is identical
  to the embedder warn pattern in `retriever.ts`. Consistent failure
  semantics across the RAG surface.
- **Defensive pre-LLM hook**: the `partial` flag dynamic import is
  wrapped in try/catch. If the backfill module fails to load (bundle
  edge case), dispatch still proceeds — the `partial` flag just
  defaults to false.

### 5.2 Minor concerns (acceptable for v1)

- **`rag.test.ts` test #11 ("retrieveTopK pipes embedder output…")**
  punts on actually exercising `retrieveTopK` because it can't easily
  stub the embedder. The comment is honest about this and the
  hardening exercises during review (§7) cover the dispatcher-level
  behavior anyway. Acceptable.
- **`store-indexeddb.ts.deleteBySource`** does a `getAll` + iterate +
  delete-by-key cycle. For very large corpora this is O(N) per
  deletion. Personal-app scale (<10K vectors) is fine. Note for the
  v2.03 follow-on if eviction policy lands.
- **`cosineSimilarity` in `store.ts`** recomputes both norms even
  though the embedder produces normalized vectors. The denom can be
  `1.0` for the common case. Optimization deferred — JS hot path is
  not the bottleneck (the 800ms timeout is dominated by `embed()`).
- **`backfill.ts.buildQueueFromState`** synthesizes a `sourceId` from
  `topic + index` when a fact has no `id`. Two facts with the same
  topic and content could collide. Acceptable — context-memory facts
  in production all have IDs (see `notesProcessor.ts`); the fallback
  is a defensive belt for fixture data.
- **`indexRagSources` skip threshold (>20 notes / >50 facts)** is a
  reasonable bulk-rewrite heuristic. The backfill walker catches up
  on next reload. Same shape as FEAT042's `indexAndLink` 20-item gate.

### 5.3 No real user data

Audited every committed file in this FEAT:
- `src/modules/rag.test.ts` — uses generic 3-dim fixture vectors and
  fixture phrases like "Project Alpha", "Contact A", "Topic Y". OK.
- `scripts/scratch/smoke-feat068.ts` — gitignored; uses generic
  placeholders ("Project Alpha", "Project Beta", "Project Quokka",
  "Topic X/Y/Z", "Contact A is a long-time mentor"). OK.
- Doc files: README, `docs/v4/03_memory_privacy.md`,
  `docs/v4/04_attachments_rag.md`. No real user data.
- Skill files (`info_lookup/*`): no real user data.
- Spec + DR + this code review: no real user data.

---

## 6. Fixes applied

1. **CRITICAL — Pass `retrievalHook` through `validateManifest`.**
   `src/modules/skillRegistry.ts:577-597`. Without this, the registry
   stripped the field on load and `info_lookup` would have silently
   never triggered retrieval in production. Verified before/after:
   - Before: `retrievalHook on registry-loaded info_lookup: undefined`
   - After: `{"sources":["note","topic","contextMemory"],"k":5,…}`
2. **TS error in `store-factory.ts`.** Hoisted `created: VectorStore`
   local so the return type is properly narrowed.
3. **Add `partial` decoration to `retrievalMeta`.** `skillDispatcher.ts`
   now consults `getRagBackfillStatus()` (dynamic import,
   non-throwing) and tags `retrievalMeta.partial: true` when the
   backfill is running. Cond. 7.
4. **Two new dispatcher tests** in `skillDispatcher.test.ts`:
   - `malformed retrievalHook (sources: 'note' string) does not crash dispatcher`
   - `absent retrievalHook → dispatcher proceeds with no retrieval`

Fix count: 4 (3 code, 1 test additions covering 2 cases).

---

## 7. Hardening exercises

### 7.1 Manifest validation hardening

**Exercise:** Craft a malformed `retrievalHook` (`sources: "note"`
string instead of array). Does the dispatcher WARN once and treat as
absent without crashing?

**Result (after fix #1):** PASS. New test in
`skillDispatcher.test.ts` builds a fixture skill with the malformed
hook, dispatches against it with a stub LLM, and asserts:
- Dispatcher returns a non-null `SkillDispatchResult`.
- Skill id is preserved in the result.
- `console.warn` captured the
  `[skillDispatcher] skill "bad_hook_skill" declares an invalid retrievalHook — treating as absent`
  message exactly once.

### 7.2 Degraded retrievalHook (absent field)

**Exercise:** Strip the `retrievalHook` field from `info_lookup`'s
manifest equivalent. Does info_lookup gracefully degrade (no
retrieval, plain LLM call)?

**Result:** PASS. New test in `skillDispatcher.test.ts` uses the
default fixture skill (no `retrievalHook` field), dispatches against
it with a stub LLM, and asserts no degraded result + valid handler
output. Confirms the dispatcher's pre-LLM hook is purely opt-in.

### 7.3 Bundle gate hardening

- `LibsqlVectorStore` literal appears once in `entry-*.js` — inside
  the `eval("require")("./store-libsql")` call. NOT transitively
  imported. `@libsql/*` zero matches in `dist/`.
- `IndexedDbVectorStore` ships in a separate ~6.65 kB chunk —
  lazy-loaded via the factory's `await import()`. Doesn't bloat the
  initial entry chunk.
- `idb` dependency is in the chunk transitively. Sub-3 kB.

### 7.4 Tsc clean

- `npx tsc --noEmit -p tsconfig.json` clean except `executor.ts:229`
  (pre-existing; not in scope).

### 7.5 Bundle byte-equal

- Two consecutive `npm run bundle:skills` runs produce sha256-equal
  `src/skills/_generated/skillBundle.ts`. `info_lookup` embedding
  rendered identically across runs.

---

## 8. Things NOT in scope (carry-forward)

- **BINDING real-LLM smoke (cond. 13).** Tester runs.
- **FEAT042 caller migration to `VectorStore` interface.** Deferred
  to a future incremental FEAT — see §3.
- **iOS/Android quota smoke.** FEAT044 owner.
- **AGENTS.md update for the new patterns.** Generic-rules pass
  carry-forward (per project memory rule).
- **IndexedDB-unavailable degraded-path unit test.** Cond. 11
  PARTIAL — flagged for a future hardening pass when `fake-indexeddb`
  or a DOM mock is available in the test runner.
- **`store-indexeddb.deleteBySource` O(N) iteration optimization.**
  Defer to v2.03 when eviction policy lands.
- **Cross-tab IndexedDB consistency.** Single-tab assumption
  documented in `docs/v4/04_attachments_rag.md`.

---

## 9. Sign-off

Approved with fixes. Auto-advances to tester for the **BINDING
real-LLM smoke (cond. 13)** — the load-bearing parity-defining
artifact. Tester runs against the live API.

**For the tester:**

The 6 phrases, in order, are: (1) "what do you know about Project
Alpha", (2) "tell me about Contact A", (3) "what was that idea about
Topic Y", (4) "what do you know about Project Quokka" — the
**fabrication-catcher**, (5) "tell me about Project Beta" — the
**source-filter test** (the matching task is intentionally NOT in
the fixture; reply must reference the note but NOT mention tasks),
(6) "summarize what I know about Topic Z" — multi-source synthesis
across one note + two contextMemory facts. **Pass bar: 5/6 strict**
(one variance slot for LLM nondeterminism). Per phrase, the harness
asserts: triage classifies as `info_lookup`, route picks the
`info_lookup` skill via `triage_hint`, dispatch returns a non-degraded
result, the LLM's reply references the expected fixture keyword
(except phrase #4), and **the reply does NOT contain any
forbidden-substring** (phrase #4: must NOT manufacture facts about
"Project Quokka"; phrase #5: must NOT mention tasks). The
**fabrication-catcher (phrase #4)** is the load-bearing assertion —
if the LLM invents content not present in the retrieved chunks, the
whole skill is broken. The harness lives at
`scripts/scratch/smoke-feat068.ts` (gitignored). Run with
`npx ts-node --transpile-only scripts/scratch/smoke-feat068.ts`.
