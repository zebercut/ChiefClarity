# FEAT068 — RAG-based `info_lookup` skill (persistent vector index over notes / topics / contextMemory)

**Type:** feature
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture / Migration
**Priority:** 1
**Release:** v2.02
**Tags:** skill-migration, v4, rag, vector-store, indexeddb, info-lookup, real-llm-smoke
**Created:** 2026-04-27

**Depends on:** FEAT067 (Done — embeddings on web bundle), FEAT066 (Done — triage-hint primary routing signal), FEAT058 (Done — `notes_capture` v4 skill), FEAT063 (Done — `emotional_checkin` v4 skill), FEAT064 (Done — web bundle skill execution), FEAT042 (Done — Node-side embedding indexer + retriever via libSQL `vector()`)
**Unblocks:** FEAT083+ (topic-pages indexing on top of the same retriever), future RAG over chat history / attachments, future hybrid (BM25 + vector) recall, future cross-device sync of the vector index

---

## Status

Planned — PM has authored the spec. Awaiting human review before the architect picks it up for stages 3–4 (design notes + design review + option pick). Several open questions deliberately left for the architect — particularly around **whether to converge on a single isomorphic vector store (IndexedDB + libSQL) or keep two stores (Node libSQL + web IndexedDB)**, and around **where the pre-LLM retrieval call lives in the dispatch pipeline**.

---

## Problem Statement

Real conversation excerpt: the user asked the assistant "what do you know about [USER's-own-project]?" and "what about [family member name]?". Both phrases triaged as `general` → `general_assistant`, which read only `[objectives, userProfile, recentTasks]` per its manifest and replied "I don't have any info about…" — even though the user has dozens of notes, topic pages, and contextMemory facts about both subjects sitting on disk. The gap is structural, not a prompt-quality issue: triage's regex fast-path doesn't emit `info_lookup` for any phrase today; the FEAT066 triage-hint map currently routes `info_lookup → general_assistant` as a forward-compat placeholder; there is no `info_lookup` v4 skill (the v3 keyword-lookup variant referenced legacy `content_index.json`, was never migrated, and that file is no longer part of the live runtime — only historic v1/v2 docs and migration scripts still mention it). The user's knowledge is invisible to the chat surface for any "what do you know about X" / "tell me about Y" phrase.

The right answer is not "give `general_assistant` a wider read scope." Notes alone routinely exceed that skill's 3000-token budget, topic pages are paragraph-rich, and contextMemory grows monotonically — dumping all of it into every general-assistant call wastes Haiku tokens on every chitchat phrase and still fails the "what do you know about X" pattern because the model has to scan the whole haystack inside the prompt. The right answer is a dedicated `info_lookup` v4 skill that **retrieves before it reasons**: embed the query, fetch top-K semantically similar chunks from a persistent on-device vector index over the user's stored knowledge, and synthesize a sourced answer over those chunks. The vector index is **persistent from day one** (IndexedDB on web; libSQL on Node — see open question Q1 on convergence), not "in-memory to start, persist later" — embedding 1K notes can take 30s+ on cold start, and the user opens this app on web today and on Capacitor mobile tomorrow (FEAT044). xenova already caches model weights in IndexedDB (FEAT067), so the persistence infrastructure is proven on the same surface.

---

## Goals

1. A new `info_lookup` v4 skill exists at `src/skills/info_lookup/` with the standard four-file shape (`manifest.json`, `prompt.md`, `context.ts`, `handlers.ts`) and is loaded by the skill registry on web and Node.
2. A persistent vector index over the user's stored knowledge (notes, topic pages — when available — and contextMemory facts) exists on every supported surface (Node, web, Capacitor mobile), persists across app reloads, and is incrementally maintained on every relevant write.
3. The `info_lookup` skill retrieves top-K semantically similar chunks BEFORE the LLM reasoning call and passes them in the user-message context block; the LLM treats those chunks as the source of truth for the answer.
4. FEAT066's `TRIAGE_INTENT_TO_SKILL` map is updated so `info_lookup → info_lookup` (no longer the `general_assistant` forward-compat placeholder).
5. Triage emits `info_lookup` for "what do you know about X" / "tell me about Y" / "what about X" phrases via either a regex fast-path entry, embedding-based routing on the skill's manifest description, or both.
6. A first-run **backfill** walks every existing note / contextMemory fact / available topic page and embeds it without blocking app boot. The user can issue queries while the backfill is in progress; partial answers come back with a clearly-worded "still building index" disclaimer when recall would be incomplete.
7. The model identity (`MODEL_ID` from `provider.ts`) is recorded on every chunk; if it changes between runs the entire index is invalidated and rebuilt.
8. Privacy posture is unchanged from FEAT067: nothing leaves the device. Embeddings happen locally (Node onnxruntime / web WASM). The index lives locally (libSQL on Node, IndexedDB on web). Documented explicitly in `docs/v4/03_memory_privacy.md` and `docs/v4/04_attachments_rag.md`.
9. BINDING real-LLM smoke (≥6 phrases, 5/6 strict) passes against a fixture corpus seeded into the index, on the same web bundle the user runs.
10. No regression in any existing skill's BINDING smoke or unit suite.

---

## Success Metrics

- "what do you know about [project the user has notes about]?" returns an answer that quotes or paraphrases the user's own notes/facts, with a source attribution phrase ("from your notes…", "you mentioned in topic X…"), NOT the polite-refusal reply.
- "what do you know about [thing the user has nothing about]?" returns the cleanly-worded no-information reply with an offer to capture notes — NOT a hallucinated answer.
- Cold boot on web with a populated index loads the cache from IndexedDB in under 2s for ≤10K chunks (target — architect to validate).
- Backfill of an empty index on a corpus of ~1K notes/facts/topic-paragraphs completes in under 60s on web (target — architect to validate; a slower number is acceptable as long as the app remains responsive during backfill).
- Subsequent in-session queries reuse the in-memory cache with no IndexedDB read on the hot path.
- A model-id change between runs triggers a full rebuild on next boot, logged with `[rag] model changed, rebuilding index` and the prior count.
- BINDING real-LLM smoke (Story 11) passes 5/6 strict against a fixture corpus on the same web bundle the user runs.
- All baseline tests continue to pass.

---

## Scope

**In scope:**
- `info_lookup` v4 skill folder.
- Persistent vector index — IndexedDB on web (and Capacitor mobile webview), libSQL on Node (already in place via FEAT042 — architect picks: extend FEAT042 to be the shared abstraction, or run two stores side by side; see Q1).
- Write-time indexer hook covering notes, contextMemory facts, and topic-page paragraphs (where topic pages are persisted today; remaining topic surfaces ship under FEAT083 and will lazy-index when they land).
- Query-time retriever (top-K cosine, optional source filter, score threshold).
- Backfill on first run / model-id mismatch — non-blocking, with a status surface readable by the dispatcher so partial results carry a "still building index" disclaimer.
- Triage update — either a fast-path regex entry, an embedding-routing nudge via the skill's manifest description, or both (PM recommends both; architect picks).
- FEAT066 triage-hint map update: `info_lookup → info_lookup`.
- Cache invalidation on `MODEL_ID` change.
- IndexedDB-unavailability degraded path (private browsing / quota / Capacitor edge cases) — graceful fallback (PM proposes in-memory only with a one-time WARN; architect picks).
- Unit tests for indexer / retriever / backfill / cache invalidation / `info_lookup` end-to-end with stub LLM.
- BINDING real-LLM smoke (≥6 phrases, 5/6 strict).
- Doc updates: `docs/v4/03_memory_privacy.md`, `docs/v4/04_attachments_rag.md`, `docs/new_architecture_typescript.md`, `README.md`.

**Out of scope (explicit):**
- **Cross-device sync of the vector index.** No backend exists. Future FEAT.
- **Topic-pages indexing for surfaces that don't ship in v2.02.** The indexer's hook for topic-page writes is wired so topic pages index automatically when FEAT083+ surfaces them; back-indexing of pre-existing topic structures is best-effort via the same backfill walker.
- **Tasks and calendar events as RAG sources.** Their bodies are short (titles + brief notes), the assembler already loads them per-intent under file-slice context, and indexing them risks polluting "what do you know about X" with duplicate task hits. Defer to a future FEAT if recall is poor. (Note: FEAT042's existing Node-side retriever DOES embed tasks and events for the assembler's `searchSimilar` path. This FEAT does NOT remove that — it scopes the new `info_lookup` skill's filter to `["note", "fact", "topic"]` so the new pattern doesn't duplicate the assembler's existing context loading.)
- **Re-ranking with a cross-encoder.** Single-vector cosine on `all-MiniLM-L6-v2` is enough for v1 corpus sizes (<10K chunks).
- **Hybrid search (BM25 + vector).** Vector-only for v1. If recall on rare-word queries proves bad in real use, add BM25 in a follow-up.
- **Eviction policy.** Never evict for v1 — assume corpus stays small (<10K chunks). Add eviction in a future FEAT when the user's library grows.
- **Pre-LLM retrieval for OTHER skills.** `priority_planning`, `calendar_management`, `task_management`, etc. have file-slice context already. Extending RAG to them is a separate FEAT (and probably unnecessary — their contexts are already targeted).
- **Note edit / note delete re-indexing at the SKILL level.** Notes are append-only at the **skill** level today (FEAT058 / FEAT062 — `notes_capture` exposes only `add`), but `db/queries/notes.ts` already exports `updateNote` and `deleteNote`. The indexer must be designed so a future `notes_update` / `notes_delete` skill plugs in via the same centralized hook — but this FEAT does NOT ship the skill-level edit/delete path. See open question Q5.
- **AGENTS.md template entry.** Carry-forward to a generic-rules pass.

---

## User Stories

### Story 1 — `info_lookup` v4 skill folder

**As a** developer, **I want** an `info_lookup` v4 skill at `src/skills/info_lookup/` with the standard four-file shape, **so that** the skill registry loads it alongside the other v4 skills on web and Node.

**Acceptance Criteria:**
- `src/skills/info_lookup/manifest.json` exists with: `id: "info_lookup"`, `version: "1.0.0"`, `description` tuned for "what do you know about X" / "tell me about Y" phrasing, `triggerPhrases` covering at least 8 representative variants, `model: "haiku"`, `dataSchemas.read: []`, `dataSchemas.write: []`, `tools: ["submit_info_lookup"]`, `tokenBudget: 4000`, `autoEvaluate: true`.
- `src/skills/info_lookup/prompt.md` instructs the model to: (a) treat the retrieved chunks as the source of truth; (b) cite the source naturally ("from your notes…", "you mentioned in topic [Topic X]…", "I have it down that…"); (c) when no chunks score above threshold, say so cleanly and offer to capture notes; (d) never fabricate answers from outside the chunks; (e) keep the reply concise (1–3 sentences for simple lookups, longer only for synthesis).
- `src/skills/info_lookup/context.ts` declares `contextRequirements` including `userToday`, `userProfile` (basic fields the model may cross-reference for relations like family members), and `topicList` (lightweight, for cross-reference). It does NOT declare `notes`, `contextMemory`, or topic-page bodies as context — those flow in via the retrieval block, not the assembler.
- `src/skills/info_lookup/handlers.ts` exports `submit_info_lookup` (the only handler) and `toolSchemas`. The handler is read-only — it returns the LLM's `reply` and an optional `items` array (one entry per cited chunk: `{ source, sourceId, snippet }`) and never writes.
- `src/skills/_generated/` rebuilds correctly via the existing build step (FEAT064) and the new skill is part of the web bundle.

### Story 2 — Vector store: schema, persistence, model-id stamping

**As a** developer, **I want** a persistent vector store with a clear schema, **so that** the index survives app reloads and can be selectively invalidated when the embedding model changes.

**Acceptance Criteria:**
- The vector store exposes a typed API: `upsertChunk`, `deleteChunksBySource`, `searchTopK`, `countByModelId`, `clearAll` (architect picks the exact module path and whether this becomes a thin abstraction over both libSQL and IndexedDB or lives separately per surface — see Q1).
- Chunk schema (logical, regardless of physical storage): `{ chunkId: string, source: "note" | "topic" | "contextMemory", sourceId: string, text: string, embedding: Float32Array(384), indexedAt: ISO string, modelId: string }`.
- On web, the physical store is IndexedDB. PM proposes: database name `lifeos_vectors`, single object store `chunks`, indexes on `source`, on `sourceId`, on `modelId`. Architect picks (proposes `idb` as a thin wrapper dep — `package.json` confirms there is no IndexedDB wrapper today).
- On Node, the physical store is libSQL — extend the FEAT042 `embeddings` table with the `chunkId` / `source` / `text` / `modelId` fields (or a sibling `rag_chunks` table — architect picks; see Q1).
- `MODEL_ID` is read from `src/modules/embeddings/provider.ts` (FEAT067) at write time and stored on each chunk.
- Source of truth is the persistent store. An in-memory `Map<chunkId, IndexEntry>` cache loads on first retrieval call and stays warm for the session.

### Story 3 — Write-time indexer hook (centralized in executor)

**As a** developer, **I want** a single indexer hook called from `executor.applyAdd` (and the corresponding deletion hook from `applyDelete`), **so that** every skill that writes notes / facts / topic pages flows through the same indexing path without per-skill code duplication.

**Acceptance Criteria:**
- `executor.applyAdd` calls the indexer for any `fileKey` in a designated indexed set (PM proposes: `notes`, `contextMemory`, and the topic-page write surface). The indexer extracts embeddable text via a per-source extractor (mirroring FEAT042's `extractText`), embeds via `provider.embed()`, and upserts the chunk. Failure is logged but never thrown — relational write integrity is preserved.
- `executor.applyDelete` calls the deletion hook to remove any chunks where `sourceId` matches the deleted entity. (Forward-compat for when `notes_delete` ships — see Q5.)
- The indexer skips entities whose extracted text is shorter than a minimum threshold (PM proposes 5 chars, mirroring FEAT042). Verifies the embedding contains no NaN/Inf before upsert.
- Unit test: a test that calls `applyWrites` with a `notes_capture`-shaped plan also produces a corresponding chunk in the (mocked) vector store with the right `source: "note"`, `sourceId`, `text`, and `modelId`.
- The hook is ALSO callable directly (export the indexer functions) so the backfill walker can reuse them without going through the executor.

### Story 4 — Topic-page chunking

**As a** developer, **I want** topic pages chunked by paragraph before embedding, **so that** retrieval scores per-paragraph instead of being smeared across an entire long page.

**Acceptance Criteria:**
- A `chunkTopicPage(text: string) → string[]` function splits a topic page into paragraph-sized chunks. PM proposes: split on double newline, drop empties, cap each chunk at ~500 chars (split further on sentence boundary if longer). Architect refines.
- Each chunk gets its own `chunkId` (e.g., `topic:<topicSlug>:<paragraphIndex>`), shares the same `sourceId` (the topic slug or topic-page id), and `source: "topic"`.
- When a topic page is rewritten (the topicManager `appendToTopicFile` / `updateTopicPagesFromBrief` paths), the indexer first deletes all existing chunks for that `sourceId`, then re-indexes from scratch. (Avoids stale paragraphs from a previous version of the page.)
- If topic pages aren't yet a write target on the surface this FEAT ships on, the chunker exists and is unit-tested but the integration hook is dormant until FEAT083+ surfaces it.

### Story 5 — Query-time retriever

**As a** developer, **I want** a `retrieveTopK` API the dispatcher can call before the LLM, **so that** every `info_lookup` query gets a relevance-sorted chunk set without a round trip through the assembler.

**Acceptance Criteria:**
- Public API:
  ```ts
  retrieveTopK(
    query: string,
    k: number = 5,
    filter?: { source?: ChunkSource[]; minScore?: number }
  ): Promise<RetrievalResult[]>;
  ```
  where `RetrievalResult = { chunkId, source, sourceId, text, score }` and `score` is normalized cosine similarity (1.0 = identical, 0.0 = orthogonal).
- Implementation: embed the query via `provider.embed`; cosine-search the in-memory cache; apply optional `source` and `minScore` filters; return top-K sorted by score descending.
- If the embedder returns null (unavailable / model still loading), the retriever returns `[]` and logs a single WARN per session.
- Default `minScore` for the `info_lookup` skill: PM proposes 0.30 (below the FEAT066 router fallback threshold of 0.40 because retrieval is intentionally more permissive than skill routing — a chunk that's "kind of related" is still useful as a citation, whereas a skill that's "kind of related" is worse than the fallback). Architect refines.
- Unit test: against a fixture index, queries return the expected top-K in score order; filter parameters work; empty index returns `[]`.

### Story 6 — Pre-LLM retrieval in dispatch

**As a** developer, **I want** the dispatcher to call `retrieveTopK` BEFORE the LLM call when the routed skill is `info_lookup`, and inject the results into the user message, **so that** the skill prompt can cite the user's own knowledge.

**Acceptance Criteria:**
- The dispatcher (or a new pre-call hook the architect adds — see Q3) calls `retrieveTopK(phrase, 5)` when `routeResult.skillId === "info_lookup"`.
- The retrieved chunks are formatted into the user message context block under a clearly-labeled key (PM proposes `retrievedKnowledge: RetrievalResult[]`), so the prompt can reference them.
- The retrieval call is bounded — if it doesn't return within a soft timeout (PM proposes 3s), the dispatcher proceeds with `retrievedKnowledge: []` and the prompt's "no info" branch handles it.
- The retrieval call result is logged in the dispatch decision line (`[skillDispatcher] dispatch phrase=… skill=info_lookup retrieved=N topScore=0.62`) for observability.
- If the backfill is still in progress when the call lands, the retrieval result is decorated with a `partial: true` flag so the prompt can append the "still building index" disclaimer — PM proposes the disclaimer is added to `reply` post-LLM by the handler, NOT inside the prompt, so it doesn't get rephrased away by the model.
- This is a NEW PATTERN — first skill to perform a retrieval round trip pre-LLM. The architect documents the pattern (in code comments and `docs/v4/04_attachments_rag.md`) so future skills (e.g., a future RAG-augmented `priority_planning`) can adopt the same shape.

### Story 7 — Triage emits `info_lookup`

**As a** user, **I want** triage to recognize "what do you know about X" / "tell me about Y" phrases and route them to `info_lookup`, **so that** the FEAT066 hint map can dispatch them to the new skill.

**Acceptance Criteria:**
- A regex fast-path entry in `src/modules/triage.ts`'s `FAST_PATH_MAP` matches at least: "what do you know about …", "tell me about …", "what about …" (when not preceded by a verb that already matches another fast-path), "what can you tell me about …", "do you know anything about …". Each match sets `legacyIntent: "info_lookup"`. PM proposes the regex; architect refines casing / boundary handling.
- The skill's `manifest.json` `triggerPhrases` cover the same phrasing space so embedding-based routing (FEAT067) catches phrases the regex misses (e.g., "any info on …", "give me the rundown on …", "summarize what I have on …"). PM recommends both layers; architect confirms.
- A unit test asserts that each of the smoke-set phrases (Story 11) classifies as `info_lookup` either via fast-path OR via embedding routing.
- No regression: existing fast-path matches (task_create, calendar_create, full_planning, emotional_checkin, etc.) still match their original phrases.

### Story 8 — FEAT066 triage-hint map update

**As a** developer, **I want** `TRIAGE_INTENT_TO_SKILL.info_lookup = "info_lookup"`, **so that** triage's classification routes to the new skill instead of the `general_assistant` placeholder.

**Acceptance Criteria:**
- `src/modules/router.ts:266` changes from `info_lookup: "general_assistant",` (forward-compat) to `info_lookup: "info_lookup",`.
- Comment is updated: "info_lookup" no longer marked as forward-compat.
- The `info_lookup` skill is added to the `setV4SkillsEnabled` startup list in every entry point that enables the other v4 skills today (proxy, headless runner, web bundle bootstrapper).
- A unit test in `router.test.ts` asserts that a `TriageResult` with `legacyIntent: "info_lookup"` routes to `skillId: "info_lookup"` with `routingMethod: "triage_hint"`.

### Story 9 — Backfill (non-blocking, with progress)

**As a** user, **I want** the vector index to populate on first run from my existing notes / facts / topic pages without the app blocking on boot, **so that** I can use the assistant immediately and `info_lookup` queries get more useful as the backfill progresses.

**Acceptance Criteria:**
- A `runBackfill()` function walks every existing note, every contextMemory fact, and every available topic page; for each, it calls the indexer if no chunk exists yet for that `sourceId` (and `modelId` matches the current model). Mirrors the FEAT042 `runBackgroundIndex` shape.
- On boot, the backfill is invoked but does NOT block app readiness. PM proposes: kick off via `setTimeout(runBackfill, 0)` (or a worker / requestIdleCallback if architect prefers) so the main bundle finishes initializing first.
- A status surface (`getRagBackfillStatus(): { state: "idle" | "running" | "done" | "error", processed: number, total: number, startedAt?, finishedAt? }`) is readable by the dispatcher so partial-result queries can be decorated.
- Concurrency safety: if a write happens while backfill is in progress, the write-time indexer hook upserts the chunk; the backfill walker skips chunks that already exist. No double-indexing.
- The backfill never re-fetches the xenova model — it reuses the singleton from `provider.ts`.
- Unit test: starting the backfill on an empty store with N fixture entities ends with N chunks indexed. A second run is a no-op (all entities already indexed).

### Story 10 — Cache invalidation on model-id change

**As a** developer, **I want** the entire vector index to invalidate and rebuild when `MODEL_ID` changes, **so that** old vectors from a different model don't pollute cosine scores against new query vectors.

**Acceptance Criteria:**
- On boot, before serving any retrieval call, the store is checked: if any chunk's `modelId !== current MODEL_ID`, log `[rag] model changed (was=X is=Y), rebuilding index — N chunks dropped`, drop all chunks, and trigger the backfill.
- The check itself is cheap (single indexed query / aggregation) and runs on every boot — not gated by a feature flag.
- Unit test: an index seeded with `modelId: "old-model"` is detected and cleared on boot when `MODEL_ID` is set to a different value.

### Story 11 — BINDING real-LLM smoke

**As a** developer, **I want** a real-LLM smoke harness with a fixture corpus that exercises the full retrieval+synthesis loop, **so that** the regression bar is set against the live API path the user actually uses.

**Acceptance Criteria:**
- A test harness seeds a fixture corpus (generic / clearly-fictional content only — see "No real user data" project rule) into the vector store: at least one note about "Project Alpha", a topic page about "Topic X", and a few contextMemory facts including a "Family member relation: [generic role]" entry.
- The harness runs at least 6 phrases against the live API end-to-end (triage → routing → dispatcher → retrieval → LLM → handler):
  1. "what do you know about Project Alpha?" — fixture has notes about Project Alpha → answer references them with a citation phrase.
  2. "tell me about [generic family role]" — fixture has a contextMemory fact with that role → answer references the fact.
  3. "what was that idea about Topic X" — fixture has a topic page → answer cites the topic.
  4. "what do I know about [thing not in fixture]" — no chunks above threshold → answer cleanly says so + offers to capture notes; does NOT hallucinate.
  5. "tell me about Project Beta" — fixture has Project Beta with one note + one open task (task is intentionally NOT indexed by `info_lookup`'s source filter; see scope) → answer references the note, does NOT mention the task.
  6. "summarize what I know about Topic Y" — fixture has Topic Y with one note + several contextMemory facts → multi-source synthesis quotes both kinds.
- Pass bar: 5/6 strict (one slot of variance allowed for LLM nondeterminism). On failure, the harness prints the prompt + retrieved chunks + raw model output for manual review.
- The smoke runs against the same web bundle FEAT067's smoke uses (so the embedder under test is the WASM path the user runs).
- Stub-LLM tests do NOT count toward this bar — they're for unit shape only.

### Story 12 — IndexedDB-unavailability degraded path

**As a** user, **I want** the app to keep working in private-browsing / quota-exceeded / IndexedDB-disabled environments, **so that** a misbehaving browser doesn't break my chat surface.

**Acceptance Criteria:**
- On boot, the store probes IndexedDB via a try-open. On failure: log a single WARN (`[rag] IndexedDB unavailable, running with in-memory index only — knowledge will not persist across reloads`), instantiate the in-memory cache directly, and run the backfill into it (so the user gets a working index for the session even though it won't survive reload).
- The `info_lookup` skill prompt is unchanged — the user-visible behavior is identical for the in-session experience.
- A unit test mocks `indexedDB.open` to reject and asserts the in-memory fallback is used.
- This degraded path is NOT the hot path — log-level WARN, surfaced once per session.

### Story 13 — Docs and architecture updates

**As a** developer, **I want** the architecture docs and README updated, **so that** the new module / skill / data flow is discoverable.

**Acceptance Criteria:**
- `docs/new_architecture_typescript.md` is updated per CLAUDE.md's documentation rules: Section 3 (Project Structure) lists `src/skills/info_lookup/` and the vector-store module path; Section 4 (Data File Architecture) notes the persistent vector index is NOT a JSON data file; Section 5 (Types) adds `RetrievalResult` and the chunk schema; Section 6 (Module Responsibilities) adds the indexer / retriever / backfill modules and updates the data-flow diagram with the pre-LLM retrieval hop; Section 8 (Token Budgets) lists `info_lookup` at 4000; Section 9 (ADR) records the "persistent from day one" + "centralized indexer hook in executor" decisions; Section 12 (Feature Catalog) adds the skill.
- `docs/v4/04_attachments_rag.md` is updated to describe the now-implemented vector path (this FEAT is the first concrete RAG implementation).
- `docs/v4/03_memory_privacy.md` is updated to note the vector index is on-device-only with the same privacy posture as embeddings.
- `README.md` features list includes "Knowledge lookup over your notes, topics, and facts (RAG)"; the Modules table adds the indexer / retriever / backfill modules; the Data Files table notes the IndexedDB store on web; the Skills section adds `info_lookup`.
- AGENTS.md generic-rules entries (e.g., "skills that retrieve before reasoning use the dispatcher's pre-LLM hook") are deferred to the next generic-rules pass per project memory.

---

## Workflow

```
User phrase
  → triage (regex fast-path → info_lookup OR Haiku tiebreak / general)
  → router (TRIAGE_INTENT_TO_SKILL[info_lookup] = info_lookup; or embedding ladder)
  → dispatcher
      → resolveContext (userToday, userProfile, topicList)
      → NEW: retrieveTopK(phrase, k=5, filter={ source: ["note","topic","contextMemory"], minScore: 0.30 })
          → embed(phrase) [provider.ts WASM on web / onnxruntime on Node]
          → cosine search in-memory cache (warmed from IndexedDB / libSQL)
          → top-K sorted by score
      → LLM call (Haiku) with system=prompt.md, user="phrase + retrievedKnowledge"
      → handler submit_info_lookup(reply, items)
          → if backfill partial → append "still building index" disclaimer
  → chat surface renders reply + items

Write side (parallel):
notes_capture / contextMemory writes / topic-page writes
  → executor.applyAdd
    → relational write (existing path)
    → NEW: indexer hook → embed → upsertChunk (IndexedDB on web / libSQL on Node)
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User asks "what do you know about X" while backfill is still running | Retrieval returns whatever's indexed so far; handler appends "still building your index — answer may be incomplete" disclaimer to `reply`. |
| Empty index (brand new user, no notes/facts yet) | Retriever returns `[]`; prompt's "no info" branch fires → "I don't have anything specific about X — would you like to capture some notes?" |
| `MODEL_ID` changed between runs | Boot detects mismatch → drops all chunks → triggers full backfill; retrieval returns `[]` until backfill catches up. |
| IndexedDB unavailable (private browsing / quota) | Single WARN logged → in-memory index used for the session → no persistence across reload. |
| Embedder fails on retrieval (model not yet loaded) | Retriever returns `[]`; handler's "no info" branch fires; no error surfaced to user. |
| User writes a note that's <5 chars after extraction | Indexer skips it (matches FEAT042 minimum); not retrievable; not an error. |
| User deletes a note (future, when `notes_delete` ships) | `executor.applyDelete` calls deletion hook → chunk(s) for that `sourceId` removed; retrieval no longer surfaces them. |
| Topic page rewritten with different paragraphs | Indexer deletes old chunks for that `sourceId` first, then re-indexes new paragraphs; no stale chunks linger. |
| Two concurrent boots (proxy + headless runner) racing on backfill | Reuse FEAT042's lock pattern (`background-indexer.ts` `tryAcquireLock`) for the Node side. Web bundle is single-tab. |
| Retrieval cache cold on first query of a session | First query loads the cache from the persistent store; subsequent queries hit the in-memory cache directly. |
| LLM fabricates an answer not grounded in retrieved chunks | Prompt's "never fabricate" instruction + smoke phrase #4 catch this in the BINDING harness. |

---

## Architecture Notes

**New types** (`src/types/index.ts` or a new `src/types/rag.ts`):
```ts
export type ChunkSource = "note" | "topic" | "contextMemory";
export interface IndexEntry {
  chunkId: string;
  source: ChunkSource;
  sourceId: string;
  text: string;
  embedding: Float32Array; // 384-dim
  indexedAt: string;       // ISO
  modelId: string;         // matches provider.MODEL_ID at write time
}
export interface RetrievalResult {
  chunkId: string;
  source: ChunkSource;
  sourceId: string;
  text: string;
  score: number; // normalized cosine [0..1]
}
export interface RagBackfillStatus {
  state: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}
```

**New modules (proposed paths — architect picks final layout per Q1):**
- `src/modules/rag/store.ts` — VectorStore interface + IndexedDB / libSQL adapters.
- `src/modules/rag/indexer.ts` — write-time indexer (chunk extraction + embed + upsert).
- `src/modules/rag/retriever.ts` — `retrieveTopK` API.
- `src/modules/rag/backfill.ts` — non-blocking corpus walker.
- `src/modules/rag/chunker.ts` — `chunkTopicPage` plus future per-source chunkers.
- `src/skills/info_lookup/{manifest.json, prompt.md, context.ts, handlers.ts}`.

**Dispatcher hook** (architect picks per Q3):
- Option A: branch in `dispatchSkill` on `routeResult.skillId === "info_lookup"`.
- Option B: declarative in `manifest.json` (e.g., `requiresRetrieval: { k: 5, sources: [...], minScore: 0.30 }`); dispatcher reads the field and runs retrieval if present.
- Option C: skill-level pre-call hook exported from `handlers.ts` (`onBeforeLLM(phrase, ctx) → retrieved`).

PM prefers Option B — declarative is reusable, testable, and doesn't bloat the dispatcher with skill-specific branches.

**Dependency:**
- PM proposes adding `idb` (~1KB Promise wrapper for IndexedDB). `package.json` confirms there is no IndexedDB wrapper today.

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/skills/info_lookup/manifest.json` | NEW — skill manifest. |
| `src/skills/info_lookup/prompt.md` | NEW — retrieval-grounded synthesis prompt. |
| `src/skills/info_lookup/context.ts` | NEW — declares `userToday`, `userProfile`, `topicList`. |
| `src/skills/info_lookup/handlers.ts` | NEW — `submit_info_lookup` (read-only) + `toolSchemas`. |
| `src/skills/_generated/*` | Regen — picks up the new skill. |
| `src/modules/rag/store.ts` | NEW — VectorStore interface + adapters. |
| `src/modules/rag/indexer.ts` | NEW — write-time indexer. |
| `src/modules/rag/retriever.ts` | NEW — `retrieveTopK`. |
| `src/modules/rag/backfill.ts` | NEW — non-blocking corpus walker. |
| `src/modules/rag/chunker.ts` | NEW — paragraph chunker. |
| `src/modules/executor.ts` | EDIT — call rag indexer from `applyAdd` / `applyDelete` for indexed file keys. |
| `src/modules/skillDispatcher.ts` | EDIT — pre-LLM retrieval hook (per Q3). |
| `src/modules/router.ts:266` | EDIT — `info_lookup → "info_lookup"`. |
| `src/modules/triage.ts` `FAST_PATH_MAP` | EDIT — add `info_lookup` regex entry. |
| `src/types/index.ts` (or new `rag.ts`) | EDIT — add `IndexEntry`, `RetrievalResult`, `RagBackfillStatus`, `ChunkSource`. |
| `package.json` | EDIT — add `idb` (architect confirms). |
| `proxy / headless / web bootstrap` | EDIT — call `runBackfill` non-blocking; add `info_lookup` to `setV4SkillsEnabled` list. |
| `docs/new_architecture_typescript.md` | EDIT — Sections 3, 4, 5, 6, 8, 9, 12. |
| `docs/v4/04_attachments_rag.md` | EDIT — describe the implemented path. |
| `docs/v4/03_memory_privacy.md` | EDIT — note vector index is on-device. |
| `README.md` | EDIT — features / modules / data files / skills. |
| Tests: `src/modules/rag/*.test.ts`, `src/skills/info_lookup/info_lookup.test.ts`, BINDING smoke harness | NEW. |

---

## Testing Notes

- [ ] Unit: VectorStore CRUD round-trips on the IndexedDB adapter (using `fake-indexeddb`).
- [ ] Unit: VectorStore CRUD round-trips on the libSQL adapter (in-memory libSQL).
- [ ] Unit: Indexer writes a chunk with the right `source`, `sourceId`, `modelId`, `text` for each source kind.
- [ ] Unit: Indexer skips text shorter than the minimum threshold.
- [ ] Unit: Indexer skips embeddings containing NaN/Inf.
- [ ] Unit: Retriever returns top-K in score order; `source` filter narrows; `minScore` cutoff applies; empty index returns `[]`.
- [ ] Unit: Retriever returns `[]` and logs a single WARN when the embedder is null.
- [ ] Unit: Backfill on an empty store with N entities ends with N chunks; second run is a no-op.
- [ ] Unit: Concurrent write during backfill produces no double-indexing.
- [ ] Unit: Cache invalidation on `MODEL_ID` change drops all chunks and triggers backfill.
- [ ] Unit: IndexedDB-unavailable path falls back to in-memory cache.
- [ ] Unit: Topic-page chunker splits paragraphs correctly; ≤500-char cap respected.
- [ ] Unit: Topic-page rewrite deletes old chunks before re-indexing.
- [ ] Integration: `info_lookup` skill end-to-end with stub LLM → handler returns the LLM's reply + items.
- [ ] Integration: `executor.applyAdd` for a `notes` write produces a chunk in the (mocked) vector store.
- [ ] Integration: dispatcher pre-LLM hook injects `retrievedKnowledge` into the user message for `info_lookup`.
- [ ] Integration: `TriageResult.legacyIntent === "info_lookup"` routes to `skillId: "info_lookup"` with `routingMethod: "triage_hint"`.
- [ ] BINDING real-LLM smoke (Story 11) — 5/6 strict on the web bundle.
- [ ] Regression: every existing skill's BINDING smoke continues to pass with the new dispatcher hook present.

---

## Open Questions

1. **One vector store or two?** A pre-existing libSQL `embeddings` table (FEAT042) already serves the Node-side assembler retriever and the executor's semantic dedup. PM-proposed scope adds a separate IndexedDB store for web. Options: (a) keep two stores side by side (each surface uses its native store; same logical schema; same indexer/retriever interfaces); (b) converge on one isomorphic abstraction (define a `VectorStore` interface; libSQL adapter for Node, IndexedDB adapter for web; shared indexer/retriever code); (c) flip Node to IndexedDB-via-fake-indexeddb in tests and to the libSQL adapter in prod (single shared module with a runtime branch). PM prefers (b). Architect picks.
2. **Dependency on `idb` (or similar)?** `package.json` has no IndexedDB wrapper today. Native IndexedDB is verbose; `idb` (~1KB) is the de-facto thin Promise wrapper. PM proposes adding it. Architect confirms or proposes alternative.
3. **Where exactly does the pre-LLM retrieval call live?** Options: (a) inside `dispatchSkill` itself, branching on `skillId === "info_lookup"`; (b) declarative — manifest field `requiresRetrieval: { k, sources, minScore }` the dispatcher reads; (c) a new pre-call hook the skill exports from `handlers.ts`. PM proposes (b) — cleanest separation, reusable by future RAG skills. Architect picks.
4. **Score threshold for "no info" vs answer.** PM proposes 0.30 minScore for `info_lookup` retrieval (below FEAT066 FALLBACK_THRESHOLD 0.40). Architect tunes against the smoke fixture corpus.
5. **Forward-compat for note edit/delete.** The indexer's deletion hook is in `executor.applyDelete` for future `notes_update` / `notes_delete` skills — but `db/queries/notes.ts` already has `updateNote` / `deleteNote` callable from non-skill paths (notesProcessor, debug scripts). Should the indexer ALSO be wired at the DB-query layer for defense in depth, or is the executor hook enough? PM proposes: executor hook is the single source of truth; non-skill DB paths are infrastructure-only and don't write user knowledge. Architect confirms.
6. **Retrieval timeout.** PM proposes a 3s soft timeout on the pre-LLM retrieval call. Too aggressive? Too lax? Architect picks against the cold-cache load time on web.
7. **Topic-page chunk size.** PM proposes paragraph-split with a ~500-char cap. Should chunks overlap (sliding window)? PM proposes no overlap for v1. Architect picks.
8. **Backfill scheduling.** PM proposes `setTimeout(runBackfill, 0)` from boot. Should the web bundle use a Worker so embedding doesn't block the main thread? FEAT067 declined Worker for the embedder itself; same call applies here. Architect confirms or picks Worker.
9. **`info_lookup` reply style.** PM proposes 1–3 sentences for simple lookups, longer only for synthesis. Should the skill emit structured `items` (one per cited chunk) for the chat surface to render as a card list, like `task_management` query? PM proposes yes — chat surface already renders `items` via `ItemListCard` (per `skillDispatcher.ts` Line 149). Architect confirms.
10. **Capacitor surface (FEAT044 future).** Capacitor mobile uses the web bundle in a webview. PM assumes the IndexedDB path "just works" there. Architect validates against the FEAT044 design notes.
11. **Coexistence with FEAT042's existing assembler retriever.** FEAT042's Node-side `retrieveContext` already embeds tasks/events/facts/notes/observations and is injected into the assembler. This FEAT introduces a NEW retrieval path used pre-LLM by `info_lookup`. Should the two paths share the same store (Q1 collapses them) or stay separate? If they share, what about FEAT042's `intentType: "info_lookup"` source list (`["task","event","fact","note","observation"]`) — does the new skill scope to a tighter set (`["note","topic","contextMemory"]`) and let the assembler keep its own broader filter, or do we collapse onto one canonical list? PM proposes scoped retrieval per skill (the new skill filters tighter; FEAT042's assembler-side path is unchanged for now). Architect confirms.
12. **Smoke-set 6/6 vs 5/6.** PM proposes 5/6 strict (one variance slot for LLM nondeterminism). Architect picks the bar — FEAT060 used 5/6, so PM defaults to that.

---

## Architecture Notes (Architect, 2026-04-27)

**Convergence picked.** A new `VectorStore` interface in `src/modules/rag/store.ts` with two backends — `LibsqlVectorStore` (Node, wraps the existing FEAT042 `embeddings` table) and `IndexedDbVectorStore` (web + Capacitor mobile). Indexer / retriever / backfill are platform-agnostic and take a `VectorStore` parameter; a thin `getDefaultVectorStore()` factory picks per platform. Avoids long-term divergence; gives Capacitor mobile a clear path with no extra design pass.

**Pre-LLM retrieval is declarative.** The skill manifest gains an optional `retrievalHook?: { sources: ChunkSource[]; k: number; minScore: number; minScoreInclude: number }` field. The dispatcher reads it after `resolveContext` and before the LLM call, embeds the phrase, runs `retrieveTopK` against the configured `VectorStore`, and injects results into the user message under the `retrievedKnowledge` key. Future RAG-using skills opt in by adding the field — no skill-specific dispatcher branches.

**Indexer hook stays in `db/flush.ts` (correction to PM's "executor only" assumption).** The existing FEAT042 indexer hook is wired in `src/db/flush.ts` (`indexAndLink`), not `executor.ts`. This FEAT extends that same call site to also index the new sources (`note`, `topic`, `contextMemory.facts`). The executor write path remains untouched — flush is downstream of executor and is the existing single source of truth for "an entity was persisted, time to embed it." This preserves ADR-001 (executor stays sacred) while reusing the proven hook.

**No DB-query-layer hook.** The flush hook is the single source of truth. Hooking `db/queries/notes.ts` (which exposes `updateNote` / `deleteNote` to non-skill paths) would risk double-indexing.

**Decisions on the 12 open questions.**
1. Convergence (one `VectorStore` interface, libSQL + IndexedDB backends).
2. Add `idb` (~3KB Promise wrapper) — yes.
3. Declarative `retrievalHook` manifest field (Option B) — yes.
4. Score thresholds: `minScore: 0.25` for retrieval inclusion, `minScoreInclude: 0.40` for "answer worth synthesizing." Tune against fixture during stage 7.
5. Indexer hook stays in `db/flush.ts` only; no DB-query-layer wiring.
6. Retrieval soft timeout 800ms; on miss the dispatcher proceeds with empty `retrievedKnowledge` and the prompt's "no info" branch fires.
7. Topic chunks: paragraph split, 500-char cap, no overlap (deferred — topic page writes are dormant on the surfaces this FEAT ships on; chunker is unit-tested, integration is lazy until FEAT083+).
8. Backfill scheduling on web: `requestIdleCallback` with `setTimeout(0)` fallback. Process 5–10 chunks per tick. Node keeps the existing `runBackgroundIndex` lock pattern.
9. Reply emits structured `items: RetrievalResult[]` for chat-surface card rendering (already pipes through `dispatcher.ts:148-150`).
10. Capacitor IndexedDB validation deferred to FEAT044 owner.
11. Coexist with FEAT042's assembler retriever via shared store + per-skill scope. The existing `info_lookup` source list at `retriever.ts:21` (`[task, event, fact, note, observation]`) becomes the assembler-side default; the new `info_lookup` skill scopes to `["note", "topic", "contextMemory"]` via its `retrievalHook.sources`. The `_semanticDedupFn` injection is unchanged.
12. BINDING smoke pass bar: 5/6 strict (per FEAT060 precedent).

**Files touched (canonical list).** `src/modules/rag/{store.ts, indexer.ts, retriever.ts, backfill.ts, chunker.ts}` (NEW), `src/skills/info_lookup/{manifest.json, prompt.md, context.ts, handlers.ts}` (NEW), `src/skills/_generated/*` (regenerated), `src/types/rag.ts` (NEW), `src/db/flush.ts` (extend `indexAndLink` to cover `notes` and topic-page writes), `src/modules/skillDispatcher.ts` (read `retrievalHook` field, run pre-LLM retrieval, inject `retrievedKnowledge`), `src/modules/router.ts:266` (`info_lookup → "info_lookup"`), `src/modules/triage.ts` `FAST_PATH_MAP` (add `info_lookup` regex), `app/_layout.tsx` (add `info_lookup` to `setV4SkillsEnabled([...])` list and kick off `runBackfill` non-blocking), `metro.config.js` (allow `src/modules/rag/.*` and `node_modules/idb/.*` through), `package.json` (`+idb`), docs (`new_architecture_typescript.md`, `04_attachments_rag.md`, `03_memory_privacy.md`, `README.md`).

**Dependencies.** FEAT067 (provides isomorphic `embed` / `MODEL_ID` on web), FEAT042 (provides `LibsqlVectorStore` backend + `_semanticDedupFn` callers).

**New pattern (codified for AGENTS.md generic-rules pass).** "Skills that need pre-LLM retrieval declare `retrievalHook` in their manifest. The dispatcher runs retrieval before the LLM call and injects results under `retrievedKnowledge`. No skill-specific dispatcher branches." And: "Cross-platform persistent storage uses a `VectorStore`-style interface with platform backends (libSQL on Node, IndexedDB on web/mobile). Indexer / retriever / backfill code is platform-agnostic."

---

## References

- FEAT067 — Enable embeddings on web bundle (Done) — provides `provider.ts:embed()` and `MODEL_ID` on the web surface this FEAT runs on.
- FEAT066 — Use triage's intent classification as primary v4 routing signal (Done) — defines `TRIAGE_INTENT_TO_SKILL` map this FEAT updates.
- FEAT058 — `notes_capture` v4 skill (Done) — write surface this FEAT indexes from.
- FEAT063 — `emotional_checkin` v4 skill (Done) — pattern reference for non-write skills (closest to `info_lookup`'s shape, though `info_lookup` is read-only in a different sense).
- FEAT064 — Make v4 skills run on web bundle (Done) — defines the build-time skill bundling this FEAT extends.
- FEAT042 — Node-side embedding indexer + retriever via libSQL (Done) — the existing infrastructure architects must decide whether to extend or run alongside (Q1, Q11).
- FEAT062 — Fix executor `applyAdd` array-loop to include notes (Done) — established the centralized executor write path this FEAT hooks into.
- `docs/v4/04_attachments_rag.md` — the original RAG design intent; this FEAT is the first concrete implementation.
- `docs/v4/03_memory_privacy.md` — privacy posture this FEAT preserves.
- `src/modules/skillDispatcher.ts` — dispatcher this FEAT extends with a pre-LLM hook.
- `src/modules/embeddings/{indexer,retriever,background-indexer,provider}.ts` — existing Node-side module set this FEAT extends or re-architects per Q1.
- `src/modules/triage.ts` `FAST_PATH_MAP` — fast-path entries this FEAT adds an `info_lookup` regex to.
- `src/modules/executor.ts` — `applyAdd` / `applyDelete` integration points for the centralized indexer hook.
- CLAUDE.md project rules — documentation update obligations; "no real user data in any committed file" rule; one-time scripts policy.
