# FEAT067 — Enable embeddings on web bundle (unblock @xenova/transformers OR proxy delegation)

**Type:** infrastructure
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture / Infrastructure
**Priority:** 1
**Release:** v2.02
**Tags:** embeddings, web, wasm, xenova, routing, rag-prep
**Created:** 2026-04-27

**Depends on:** FEAT051 (Done — v4 router + embedding ladder), FEAT054 (Done — skill registry + skill embeddings), FEAT064 (Done — isomorphic skill loading + WebCrypto SHA), FEAT066 (Done — triage-hint primary signal)
**Unblocks:** FEAT068 (RAG-based `info_lookup` skill — depends on a working query embedder on the same surfaces the user runs); semantic routing for long-tail phrases the regex+Haiku triage cannot classify; future on-device retrieval for notes/topics/contextMemory; FEAT044 Capacitor parity (mobile webview shares the web embedding path).

---

## Status

Planned — PM has authored the spec. Awaiting human review before the architect picks it up for stages 3–4 (design notes + design review + option pick).

---

## Problem Statement

The v4 router has three routing signals: (a) triage hint (FEAT066), (b) structural-trigger first-token compare, and (c) embedding similarity against each skill's `triggerPhrases` vector. On the web bundle today, only (a) and (b) work. The embedder is intentionally degraded to `null` on web because `@xenova/transformers`, `onnxruntime`, and `src/modules/embeddings/*` are all in Metro's `blockList` (`metro.config.js:8-16`, FEAT041/042 era). FEAT064 confirmed the gate and codified graceful degradation; the router's `embedPhrase` swallows the import failure and returns `null`, and the embedding step in `routeToSkillInternal` falls through to the `general_assistant` fallback. FEAT066 closed the highest-impact misroute path by routing on triage's classification before structural — but triage's regex fast-path covers a finite verb-prefix grammar, and triage's Haiku tiebreaker only fires for a narrow set of intents. **Any phrase the regex misses and the Haiku tiebreaker is uncertain on still falls through to `general_assistant` on web** with a polite-refusal reply.

Beyond routing, FEAT068 ("RAG-based `info_lookup` skill") is fully blocked on this work. RAG needs a query embedder on the same surface where the user runs the app — web today, web + Capacitor mobile tomorrow. Without web embeddings, the RAG skill cannot ship to the web bundle at all, and FEAT044 mobile would inherit the same dead-end. FEAT066's triage-hint approach is the right cheap fix for verb-prefix routing, but it cannot help RAG: there is no upstream classification of "embed this query against an index" — the act IS the embedding. This FEAT delivers a working query-embedding API on the web bundle so that (i) the v4 router's embedding step lights up for novel phrases that triage cannot classify, AND (ii) FEAT068 has a foundation to build the RAG vector path on. The user has explicitly asked for "the real thing" rather than another stopgap — FEAT066 was the stopgap; this is the foundation.

---

## Goals

1. The web bundle exposes a working `embed(text: string) → Promise<Float32Array | null>` API at the same call site (`src/modules/embeddings/provider.ts` or its successor module) that the Node bundle uses today.
2. The router's embedding step (`routeToSkillInternal` Step 2) returns a non-null vector on web for any phrase ≥ 2 characters, so the cosine-similarity ladder can produce a top-3 candidate set.
3. A user phrase that triage CANNOT classify (e.g., a long-tail descriptive phrase that is not in any regex fast-path AND that the Haiku tiebreaker doesn't pin) routes via `routingMethod: "embedding"` (or `"haiku"` after the tiebreaker) on web, NOT via `"fallback"`.
4. The query-embedding API on web is shape-compatible with FEAT068's RAG needs: synchronous-looking call, same vector dimension as the indexed corpus, same model family across web and Node so vectors compare correctly.
5. Capacitor (mobile webview, FEAT044 future) inherits the web path with no additional work — the mobile bundle reuses whatever the web bundle does.
6. Headless runner / Node-side tests / scheduled flows continue to use the existing local Node embedder unchanged. No regression in any non-web path.
7. The legacy test injection pattern (`embedder: async () => null` via `RouteOptions`) continues to work — tests do not auto-load the real embedder.

---

## Success Metrics

- Web bundle: typing a long-tail descriptive phrase (e.g., the smoke set in Story 7) produces a `[router] route ... method=embedding` or `method=haiku` log line, NOT `method=fallback`.
- Web bundle boot: zero unhandled exceptions from the embedder loader. Cold-start is either deferred (lazy on first use) OR completes before the first phrase is typed (architect picks).
- Web bundle: subsequent embedding calls reuse the in-memory pipeline; no repeated model fetch per call.
- Web bundle: subsequent app reloads (browser refresh) reuse the persistent cache (architect picks the cache mechanism — IndexedDB, Capacitor Filesystem, or HTTP cache); no re-download of model weights from a CDN on every reload.
- Bundle size: the JS delta added to `dist/` is documented in the design review and is below the FEAT064 5% budget. Model weights are NOT counted toward the JS bundle if loaded at runtime from a CDN; if bundled, the architect explicitly approves the size impact.
- Node parity: headless runner produces byte-equal embedding vectors for a fixed test phrase before and after this FEAT.
- All baseline tests continue to pass.
- BINDING real-LLM smoke (Story 7) passes 10/10 with the embedder ENABLED (the inverse of FEAT066's smoke, which ran with the embedder disabled).

---

## User Stories

### Story 1 — Pick the embedding-on-web approach

**As an** architect, **I want** to pick exactly one of three approaches for getting embeddings working on web, **so that** the implementation has a single coherent shape.

**Acceptance Criteria:**
- [ ] The design-review doc records the picked approach (A, B, or C below) with explicit reasoning.
- [ ] Approaches NOT picked are explicitly rejected in the design-review doc with one-paragraph rationale each.
- [ ] All subsequent stories assume the picked approach; conflicting subdecisions in those stories are resolved or removed before the architect signs off.

**Approach options (PM proposal: A, with subdecisions left to architect):**

- **Option A — In-bundle `@xenova/transformers` (WASM, runs in browser/mobile webview).** Remove `@xenova/transformers` and `onnxruntime` from `metro.config.js`'s `blockList`. The web bundle ships the JS shim (~200KB minified, per FEAT064 budget call-out). Model weights (~80MB for the current `Xenova/all-MiniLM-L6-v2`, smaller options exist — see Open Q3) load at runtime from a CDN or are bundled, then are cached locally for reload. All embedding happens in the browser/mobile webview — no network round-trip per call, works offline after first load, identical path on web and Capacitor mobile. PM's recommended option; the bundle-size hit is one-time per device, the WASM ecosystem has matured, and mobile parity is a non-negotiable for FEAT044.

- **Option B — Proxy-delegated embeddings (api-proxy computes, web calls).** Keep `@xenova/transformers` blocked on web. Extend `scripts/api-proxy.js` with a `POST /embed` endpoint that takes a phrase and returns a vector. The web client calls the proxy. Smaller web bundle (no WASM), one network round-trip per embedding (~50ms localhost). Doesn't work without the proxy running — same constraint as today's `/v1/messages` and `/files` endpoints. **On Capacitor mobile (FEAT044), the proxy is not available — embeddings degrade again, undoing this FEAT for mobile.**

- **Option C — Both (proxy primary, in-bundle as fallback for offline).** Doubles the surface area. PM proposal: REJECT unless the architect surfaces a specific reason both are needed (e.g., dev-mode hot-reload speed favors proxy, production favors in-bundle).

### Story 2 — Web bundle exposes a working `embed()` API

**As a** caller of `src/modules/embeddings/*` (today: the router; future: FEAT068 RAG), **I want** the same `embed(text)` call signature available on web as on Node, **so that** I do not branch on platform at every call site.

**Acceptance Criteria:**
- [ ] On web, `embed(text)` returns a `Promise<Float32Array | null>` with the same vector dimension and same model family as the Node-side embedder.
- [ ] On web, the FIRST call to `embed()` may be slow (model download / cold start). The architect picks the cold-start UX (Open Q4): deferred-on-first-use vs eager-on-app-start vs progress-indicator. PM proposal: deferred-on-first-use, no progress indicator, since embedding is synchronous-looking from the router's perspective and cold-start happens off the critical path.
- [ ] Subsequent calls within the same session reuse the in-memory pipeline (same `_pipe` lazy-init pattern as `provider.ts:8-21`).
- [ ] If the embedder genuinely cannot load (e.g., user's browser blocks WASM, model fetch fails, IndexedDB is full), `embed()` returns `null` — the existing `routeToSkill` `if (!phraseEmbedding)` fallback catches this and degrades gracefully, just as it does on web today. The error is logged once.
- [ ] The Node path is unchanged. `provider.ts` continues to work as-is for the headless runner and ts-node scripts.

### Story 3 — Metro `blockList` updated for the picked approach

**As a** developer running `npm run build:web`, **I want** Metro's `blockList` to reflect the picked embedding approach, **so that** the bundle compiles correctly without dead-code paths.

**Acceptance Criteria:**

For **Option A** (in-bundle WASM):
- [ ] `metro.config.js`'s `blockList` removes the `@xenova` and `onnxruntime` entries (lines 14-15).
- [ ] `src/modules/embeddings/*` either (a) is removed from the blockList AND the modules become isomorphic (Node + browser), OR (b) stays blocked AND a new `src/modules/embeddings/web/*` module mirrors the API, with the platform decision picked by the architect.
- [ ] PM proposal: option (a) — make `provider.ts` isomorphic. The xenova library auto-detects browser vs Node and uses `onnxruntime-web` or `onnxruntime-node` accordingly, so a single source file should suffice. Architect confirms in design review.
- [ ] Other Node-only modules (`src/db/*`, `@libsql`, `googleapis`) remain blocked.

For **Option B** (proxy-delegated):
- [ ] `metro.config.js`'s `blockList` is unchanged for `@xenova` / `onnxruntime` / `src/modules/embeddings/*`.
- [ ] A new `src/modules/embeddings/webProvider.ts` (or similarly-named) is NOT in the blockList and provides the `embed()` API by calling the proxy.

### Story 4 — Model weight delivery and caching

**As a** web user, **I want** model weights to download once and be reused on subsequent app loads, **so that** I do not pay the cold-start cost every time I open the app.

**Acceptance Criteria (Option A only — Option B does not download weights to the browser):**
- [ ] The model weights' source is documented in the design review (Open Q5): bundled in `dist/`, fetched from huggingface.co at runtime, fetched from jsdelivr CDN, or self-hosted. PM proposal: huggingface.co (xenova's default) for v2.02, with a note that self-hosting is a future hardening step.
- [ ] On the first run after install, the embedder downloads the model weights from the chosen source.
- [ ] On every subsequent run (including hard browser reloads), the embedder reads weights from a persistent cache. PM proposal: IndexedDB (xenova's default browser cache mechanism). Capacitor uses Filesystem under the hood — architect confirms.
- [ ] If the cache is missing or corrupt, the embedder re-downloads transparently and rebuilds the cache.
- [ ] The persistent cache size is bounded — if a smaller model is picked later (Open Q3), the old cache entries are not orphaned forever. PM proposal: defer cache eviction to xenova's default; architect may add explicit eviction.
- [ ] Privacy note in the design review: the user's chat phrases NEVER leave the device. Only the model weights are downloaded from the chosen source. This must be called out explicitly because a CDN fetch is an external dependency the user did not have before this FEAT.

### Story 5 — Router integration: embedding step lights up on web

**As a** v4 router, **I want** Step 2 (embedding similarity) to produce a real top-3 candidate set on web, **so that** novel phrases that triage cannot classify still route to the right skill.

**Acceptance Criteria:**
- [ ] No code change in `src/modules/router.ts` `routeToSkillInternal` is required by this FEAT — the existing `embedder: options.embedder ?? embedPhrase` injection pattern (line 453) and the `if (!phraseEmbedding) { ... fallback }` guard (line 455-458) already do the right thing. The change is environmental: `embedPhrase` now succeeds on web instead of failing.
- [ ] When `embedPhrase` returns a real vector on web, `registry.findSkillsByEmbedding` runs against the skill embeddings already bundled by FEAT064.
- [ ] The confidence gate (top-1 ≥ HIGH=0.80, gap ≥ GAP=0.15) and Haiku tiebreaker behave identically to the Node path.
- [ ] The triage-hint pre-emption (FEAT066, Step 1a) continues to fire FIRST when triage classified the phrase. The embedding step only matters for phrases triage CANNOT classify — which is the contract this FEAT exists to satisfy.
- [ ] Telemetry: the `[router] route ... method=embedding|haiku` log lines now appear in web sessions, not just Node. The audit log (FEAT069 future) will capture web embedding routes for the first time.

### Story 6 — RAG-prep: API surface for FEAT068

**As** FEAT068 (RAG-based `info_lookup` skill), **I want** a stable, web-compatible embedding API surface to build on, **so that** RAG indexing and query-embedding work on web from the day FEAT068 lands.

**Acceptance Criteria:**
- [ ] The exported API from `src/modules/embeddings/provider.ts` (or successor) is documented in the design review with the exact function signatures FEAT068 will consume:
  - [ ] `embed(text: string): Promise<Float32Array | null>` — single-text, used for query embedding at retrieval time.
  - [ ] `embedBatch(texts: string[]): Promise<(Float32Array | null)[]>` — used for indexing time. Already exists in `provider.ts:39-45`; must work on web with the same signature.
  - [ ] `isModelLoaded(): boolean` — used to gate FEAT068's "RAG ready" UX (e.g., disable retrieval mode while model warms up). Already exists.
- [ ] The vector dimension is the same on web and Node (e.g., 384 for all-MiniLM-L6-v2). FEAT068 will index the user's notes/topics/contextMemory using the SAME embedder, so a dimension mismatch between index time (could be Node, headless runner) and query time (web) would corrupt cosine similarity.
- [ ] The model identity is recorded somewhere queryable so FEAT068 can detect a model upgrade and trigger re-indexing. PM proposal: export `MODEL_ID: string` from `provider.ts`; architect confirms or picks a different surface.
- [ ] No FEAT068 code lives in this FEAT. This story only ensures the API shape FEAT068 will need is solid.

### Story 7 — BINDING real-LLM smoke covering embedding-based routing on web

**As a** tester, **I want** a real-LLM smoke that exercises long-tail phrases triage CANNOT classify, with the embedder ENABLED, **so that** the next regression on web embedding routing is caught before users see it.

**Acceptance Criteria:**
- [ ] A real-LLM smoke (analogous in shape to FEAT065 / FEAT066, gitignored under `scripts/scratch/`) runs at least 10 phrases that triage's regex fast-path does NOT match AND for which the Haiku triage tiebreaker is not pinning a `legacyIntent`. PM proposes the seed phrase set below; architect / tester finalize.
- [ ] The smoke runs with the **real web-side embedder ENABLED** — NOT the `embedder: async () => null` injection FEAT066 used. This FEAT's contract is that the embedder works on web; the smoke proves it.
- [ ] The smoke runs in a Node ts-node harness that loads the WEB build of the embedder (or, if the architect picks Option B, calls the running api-proxy `/embed` endpoint). The exact harness is described in the design review.
- [ ] For each phrase, the smoke asserts:
  - [ ] `routeResult.routingMethod === "embedding"` OR `"haiku"` (NOT `"fallback"`),
  - [ ] `routeResult.skillId !== "general_assistant"` for phrases the architect tags as "should reach a specific skill",
  - [ ] `phraseEmbedding` was non-null (the embedder did not no-op).
- [ ] Pass criterion: 10/10 strict for the routing method assertion (no soft-pass). Per-phrase skill-id assertion is at the architect's discretion — if a phrase is genuinely ambiguous, "general_assistant via fallback" is acceptable AS LONG AS the embedder produced a vector.
- [ ] Test results document (FEAT067_test-results.md) includes the per-phrase log lines, the cold-start time for the first call, and a baseline-comparison line for one Node embedding to verify byte-equality (Goal 6).

**Proposed BINDING smoke phrase set (PM — architect / tester finalize):**

| # | Phrase (long-tail, triage-misses) | Expected behavior on web post-FEAT |
|---|---|---|
| 1 | `what's the weather like in Antarctica` | embedding/haiku → likely `general_assistant` (no info skill yet); vector must be non-null |
| 2 | `give me a quick rundown of where things stand` | embedding/haiku → `priority_planning` candidate |
| 3 | `I could use a hand pulling things together` | embedding/haiku → `priority_planning` candidate |
| 4 | `something is bugging me about the upcoming review` | embedding/haiku → `emotional_checkin` candidate |
| 5 | `clear my plate for the morning` | embedding/haiku → `priority_planning` or `task_management` candidate |
| 6 | `let's lock in some time for that placeholder thing` | embedding/haiku → `calendar_management` candidate |
| 7 | `actually, scratch that last one` | embedding/haiku → `task_management` (update path) candidate |
| 8 | `track this for me — Project Alpha review next month` | embedding/haiku → `task_management` candidate |
| 9 | `pull together a quick brief on Topic X` | embedding/haiku → `general_assistant` (info_lookup not yet); FEAT068 will revisit |
| 10 | `wrap up where I am with the placeholder project` | embedding/haiku → `priority_planning` or `notes_capture` |

All phrases use generic placeholders only — no real names, companies, or events (per the No Real User Data rule).

### Story 8 — Backwards-compat for tests and the existing degraded-web fallback

**As a** test author, **I want** the existing test injection patterns to keep working, **so that** I do not have to rewrite hundreds of lines of router tests because the production embedder now works on web.

**Acceptance Criteria:**
- [ ] `RouteOptions.embedder` (in `routeToSkill`) continues to accept `async () => null` and continues to mean "simulate an unavailable embedder for this test case". Real production code does not auto-load the embedder during tests.
- [ ] Existing test fixtures in `src/modules/router.test.ts` that inject `embedder: async () => null` continue to pass unchanged. The web embedder does not auto-load when `RouteOptions.embedder` is supplied.
- [ ] Unit tests that DO want to exercise the real embedder must do so explicitly — the architect picks the mechanism (e.g., a separate test file gated by an env flag, or an explicit `embedder: realWebEmbedder` injection). The fast unit-test suite does not load WASM.
- [ ] The `if (!phraseEmbedding)` graceful-degrade path in `routeToSkillInternal` (line 455-458) stays — it covers the genuine failure case (browser blocks WASM, fetch fails).

---

## Out of Scope

- **FEAT068 — RAG-based `info_lookup` skill.** Separate FEAT, depends on this one shipping. This FEAT only makes embedding *available* on web; it does not build a vector store, does not index any content, does not add a retrieval skill, and does not change the `info_lookup` intent's behavior.
- **Vector store / persistent embedding index for notes/topics/contextMemory.** Also FEAT068. This FEAT does not write any embeddings to disk beyond the model-weight cache.
- **Re-embedding existing content.** Today the only persisted embeddings are the skill-manifest embeddings bundled by FEAT064. Re-embedding user content lands with FEAT068.
- **Replacing triage's regex with embeddings.** Triage's regex is fast, deterministic, and free; FEAT066 demonstrated it covers the high-impact verb-prefix grammar. This FEAT adds embedding as a parallel signal for the long-tail, NOT a replacement for triage. Pruning triage is a different decision.
- **Removing the FEAT066 triage-hint step.** Step 1a stays. It runs BEFORE the embedding step and pre-empts it when triage has classified the phrase. Embedding only matters for the phrases triage cannot classify.
- **Bundling the model weights into `dist/`.** PM's default is "load from CDN at runtime, cache in IndexedDB". Architect may decide to bundle for offline-first guarantee — that is a subdecision of Story 4, not a separate scope item.
- **Embedding-driven UX surfaces.** No UI changes in this FEAT. No "show me semantically similar tasks" affordance. No clustering view. Those are future feature work that builds on the embedding API this FEAT delivers.
- **AGENTS.md / `docs/new_architecture_typescript.md` updates** beyond what describes the new embedding-on-web path. The architect updates Section 6 (Module Responsibilities — embeddings module is now isomorphic) and Section 9 (ADR — option chosen), per the project rule. Wider doc sweeps are out of scope.
- **Headless runner / scheduled flows changing embedder.** They continue to use the Node embedder. No behavior change.
- **Smaller-model migration.** Open Q3 surfaces the question of `all-MiniLM-L6-v2` vs an even smaller model; that is a subdecision of this FEAT, not a separate FEAT, but if the architect decides to keep the current model, no migration is needed.
- **Production CDN hardening / self-hosting model weights.** PM proposal is to use xenova's default huggingface.co fetch for v2.02. Self-hosting is a v2.03+ hardening step.

---

## Open Questions (for the architect)

1. **Approach: A, B, or C?** PM recommends Option A (in-bundle WASM) for mobile parity, offline-first, and no-proxy-required UX. Option B is faster to ship but punts the same problem to FEAT044 mobile and ties the user to a running proxy for routing-quality. Option C is rejected unless a specific reason is surfaced. Architect picks one and records the rationale.
2. **(Option A only) Bundle the model weights or fetch from a CDN?** PM proposal: fetch from huggingface.co (xenova's default), cache in IndexedDB. Bundle would guarantee offline-first from install but adds ~20-80MB to the install payload; CDN is smaller install + first-run download. Architect picks. Capacitor mobile may favor bundling because the install payload is paid for once at install time.
3. **(Option A only) Keep `Xenova/all-MiniLM-L6-v2` (384-dim, ~80MB) or downsize?** The current Node embedder uses MiniLM. The router previously referenced bge-m3 in some docs but the actual code uses MiniLM. PM proposal: KEEP MiniLM as-is — it is already the smallest production-grade option that matches the existing Node-side index, and any migration would force re-embedding all skill manifests AND the future FEAT068 corpus. Architect may pick differently if the design review surfaces a compelling reason.
4. **(Option A only) Cold-start UX — deferred-on-first-use, eager-on-app-start, or progress-indicator?** PM proposal: deferred-on-first-use, no UI. The router's existing `if (!phraseEmbedding)` fallback covers the in-flight cold-start case (the first phrase routes via fallback while the model loads, subsequent phrases route via embedding). Architect may prefer eager-on-app-start to avoid the first-phrase fallback, OR a progress indicator if cold-start exceeds a threshold the architect picks. **Cold-start time is the single user-visible regression risk.**
5. **(Option A only) Cache mechanism — IndexedDB, Capacitor Filesystem, or browser HTTP cache?** PM proposal: IndexedDB on web (xenova default), Capacitor Filesystem on mobile (FEAT044). Architect confirms whether xenova's auto-detection picks the right backend or whether explicit configuration is needed.
6. **(Option B only) Proxy endpoint shape — `POST /embed` with JSON body, or streaming over WebSocket for batch?** PM proposal: simple JSON `POST /embed { text } → { vector: number[] }` for v2.02; streaming is a future optimization if FEAT068 needs batch indexing latency improvements. Architect confirms.
7. **Capacitor compatibility verification.** Whatever path is picked must survive FEAT044 wrapping. PM proposal: architect's design review explicitly states that the picked approach has been verified against Capacitor's webview constraints (CSP, IndexedDB persistence across app updates, WASM execution) and lists any mobile-specific subdecisions. If it has NOT been verified, this FEAT does not block on FEAT044 — but the design review must call out the open risk.
8. **Backwards-compat for the `embedder: async () => null` injection — is the existing test pattern still meaningful?** PM proposal: YES — the injection still simulates "unavailable embedder" for unit tests. Production code path now succeeds on web by default, but tests can still pin null to exercise the `if (!phraseEmbedding)` branch. Architect confirms; if disagree, propose an alternative test-time mechanism that does not load WASM in unit tests.
9. **Embedder API exports for FEAT068 — what's the minimum surface?** PM proposal: `embed`, `embedBatch`, `isModelLoaded`, plus a new `MODEL_ID: string` constant for re-index detection (Story 6). Architect may want more (e.g., a `getEmbeddingDim(): number` helper, an `onModelReady(cb)` event for cold-start UX). FEAT068 will negotiate further additions as needed; this FEAT delivers the minimum.
10. **JS bundle-size budget — does the picked approach stay under FEAT064's 5%?** PM proposal: yes for Option A — xenova's JS shim is ~200KB minified, well under 5%. The model weights are NOT counted toward the JS bundle if loaded from a CDN. Architect confirms with the actual measured delta in the design review and explicitly approves the size impact.

---

## References

- **Routing ladder context:** `src/modules/router.ts` `routeToSkillInternal` (the ladder where the embedding step is currently a no-op on web), specifically lines 448-462 (Step 2) and 453-458 (the graceful-degrade fallback).
- **Embedding provider:** `src/modules/embeddings/provider.ts` (current Node-only `embed`, `embedBatch`, `isModelLoaded` — uses `Xenova/all-MiniLM-L6-v2`, 384-dim).
- **Metro blockList:** `metro.config.js:8-16` (FEAT041/042 era block of `@xenova`, `onnxruntime`, `src/modules/embeddings/*`, `@libsql`, `googleapis`).
- **Skill embedding consumer:** `src/modules/skillRegistry.ts` `findSkillsByEmbedding` (already isomorphic per FEAT064; consumes Float32Array vectors that this FEAT enables on web).
- **Skill embeddings bundled at build time:** `src/skills/_generated/skillBundle.ts` (FEAT064 — skill `triggerPhrases` are embedded at Node build time and shipped in the web bundle as static vectors; this FEAT closes the loop by enabling the QUERY-side embedder on web so the cosine similarity has both sides).
- **Triage hint step (predecessor / complementary FEAT):** `src/modules/router.ts` Step 1a `TRIAGE_INTENT_TO_SKILL`, FEAT066.
- **Web bundle isomorphic infrastructure:** FEAT064 (`skillBundle.ts`, isomorphic crypto, web-mode v4 gate). FEAT064 set the 5% bundle-size budget this FEAT must respect.
- **Proxy infrastructure (Option B substrate):** `scripts/api-proxy.js` (current CORS proxy for Anthropic + local file API; would gain `/embed` endpoint under Option B).
- **RAG design intent (downstream consumer):** `docs/v4/04_attachments_rag.md`, `docs/v4/03_memory_privacy.md`, `docs/v4/00_overview.md`.
- **Boot sequence (cold-start hook candidates):** `app/_layout.tsx`.
- **Pre-cached model evidence:** `node_modules/@xenova/transformers/.cache/Xenova/all-MiniLM-L6-v2/` exists in the dev environment — confirms the model identity used today and provides a baseline for byte-equality checks (Goal 6).
- **Onnxruntime variants installed:** `node_modules/onnxruntime-web` and `node_modules/onnxruntime-node` are both present in the dev environment — confirms the WASM runtime is already available; the blockList is the only thing keeping it out of the web bundle.
- **Related FEATs:** FEAT051 (router algorithm), FEAT054 (skill registry + locked-zone hashing), FEAT064 (isomorphic skill loading + WebCrypto), FEAT066 (triage-hint primary signal — closes the cheap-fix path; this FEAT closes the long-tail path), FEAT068 (RAG `info_lookup` skill — directly depends on this FEAT), FEAT044 (Capacitor mobile — inherits the web embedder path).

---

## Architecture Notes (added stage 3 — see `FEAT067_design-review.md` for full review)

**Approach picked: Option A (in-bundle xenova WASM).** Mobile parity (FEAT044) is the deciding factor; B re-creates the same gap on Capacitor. C is rejected for doubled surface. Full rationale in design review §3.1.

**Decisions on the 10 open questions:**
1. **A** (in-bundle WASM). Reject B (mobile breaks); reject C (no rationale).
2. **CDN fetch + IndexedDB cache** — bundling 80MB into `dist/` violates FEAT064's 5% budget; xenova manages IndexedDB caching natively.
3. **Keep `Xenova/all-MiniLM-L6-v2` (384-dim).** Downsizing forces re-indexing; future FEAT can reconsider.
4. **Defer-on-first-use, no progress UI for v1.** Triage-hint (FEAT066) covers the head, so only long-tail phrases pay the cold-load cost, and only the first one. Future polish FEAT can add warmup + UI.
5. **xenova's native IndexedDB cache** — no roll-your-own cache. Works on Capacitor's webview the same way.
6. **N/A** — Option B rejected.
7. **Capacitor compatibility deferred to FEAT044.** Standard web APIs (WASM, IndexedDB) should work; **iOS WebKit WASM memory ceiling is the open risk** — FEAT044 must run an iOS cold-load smoke; if iOS fails, FEAT044 ships an iOS-only proxy fallback.
8. **Preserve `embedder: async () => null` test injection.** Production now succeeds on web by default; tests still pin null when they want the fallback branch. No fixture changes.
9. **FEAT068 API surface:** `embed`, `embedBatch`, `isModelLoaded` (already exist) plus a new `MODEL_ID: string = "Xenova/all-MiniLM-L6-v2"` constant exported from `provider.ts` for index-side cache invalidation.
10. **Bundle-size measurement is in the gate.** Expected ~200-300KB JS shim from xenova + onnx-web; weights NOT counted (CDN-loaded). Threshold <5% per FEAT064. If breached, surface in test results — do NOT block on the budget alone.

**Architect-corrected PM finding (load-bearing):** The PM spec assumed `src/skills/_generated/skillBundle.ts` ships skill-side embeddings. **Audit verified: it does NOT.** The bundle ships only manifest + prompt + context + handlers. Skill `descriptionEmbedding` is computed at registry-load time (`skillRegistry.ts:178-190`) gated by `if (isNode())`. The on-disk `src/skills/.embedding_cache.json` contains placeholder all-zero-but-first vectors that look like uninitialized stubs. Without fixing the skill-side path too, unblocking the embedder on web is necessary but NOT sufficient — `findSkillsByEmbedding` returns empty and the long tail still falls back. Design review condition 4 mandates either bundle-time pre-compute (preferred) or lifting the runtime gate.

**PM technical-finding audit results:**
- **xenova auto-detects Node vs browser:** CONFIRMED. Verified `node_modules/@xenova/transformers/package.json` `browser` field substitutes `onnxruntime-node` → `onnxruntime-web` automatically. Single isomorphic provider works.
- **onnxruntime-web + onnxruntime-node both installed:** CONFIRMED. Both at `1.14.0` in `node_modules/`.
- **`skillBundle.ts` ships skill-side embeddings:** CORRECTED — DOES NOT. See above. Condition 4 fixes.
- **api-proxy.js can directly reuse provider.ts via existing ts-node setup:** CONFIRMED but moot — Option B rejected. The proxy already imports `embed` from `provider.ts` at line 217 (FEAT047 semantic dedup), so the integration point exists if Option B were ever revisited.

**Files touched:**
- `metro.config.js` — remove three regexes (xenova, onnxruntime, embeddings folder); replace embeddings folder regex with a path-allowlist that keeps indexer/retriever/linker/background-indexer Node-only (cond. 1-2).
- `src/modules/embeddings/provider.ts` — add `export const MODEL_ID` constant only; no logic change (cond. 6).
- `scripts/bundle-skills.ts` — extend to compute and emit skill-side embeddings (cond. 4a, preferred).
- `src/skills/_generated/skillEmbeddings.ts` — new committed file with skill-id → Float32Array(384) (cond. 4a).
- `src/modules/skillRegistry.ts` — load skill embeddings from the bundle (cond. 4a path); OR lift the `if (isNode())` gate (cond. 4b path). Coder picks; 4a strongly preferred.
- `docs/new_architecture_typescript.md` — Section 6, 9, 12 updates (cond. 14).
- `scripts/scratch/smoke-feat067.ts` — new gitignored binding smoke (cond. 13).
- Release note draft — privacy posture statement (cond. 11).

**Files NOT touched:** `src/modules/router.ts` (unchanged), `chat.tsx` (unchanged), the seven skill folders' source code, types in `src/types/orchestrator.ts`, dispatcher, executor, assembler.

**BINDING smoke phrase set:** PM's 10-phrase Story 7 table is finalized as-is. Pass threshold 10/10 strict on the routing-method assertion (`embedding` or `haiku`, NOT `fallback`). Per-phrase skill-id match is at architect's discretion for genuinely ambiguous phrases.

**FEAT068 hand-off API (locked):**
```
embed(text: string): Promise<Float32Array | null>      // primary; null = unavailable
embedBatch(texts: string[]): Promise<(Float32Array | null)[]>  // for indexing
isModelLoaded(): boolean                                // for UI/telemetry
MODEL_ID: string                                        // for cache invalidation
```

**Coder pay-extra-attention:**
1. **Condition 4 is the architect-corrected gap.** Skill-side embeddings must be made available on web at the SAME time as the embedder unblock — otherwise the long-tail routing still falls back. Pick 4a (bundle-time pre-compute) unless infeasible.
2. **Condition 13 (BINDING smoke, embedder ENABLED) is 10/10 strict.** This is the binding artifact. Output goes in `FEAT067_test-results.md`.
3. **Privacy posture in the release note.** User chat phrases NEVER leave the device. Only model weights flow from huggingface.co, once per device. Document explicitly (cond. 11).
4. **Backwards-compat for `embedder: async () => null` test injection** stays. Don't accidentally hard-wire the real embedder. Existing `router.test.ts` fixtures pass unchanged.
5. **iOS WebKit cold-load risk** is documented but deferred to FEAT044. The architect cannot verify it from the desktop dev environment.

---

**Coder pay-extra-attention (PM placeholder, architect to refine):**

- The router code in `src/modules/router.ts` should NOT change. The change is environmental (Metro blockList + provider isomorphism). If a router change becomes necessary, that is a sign the embedder API contract has drifted — flag in code review.
- Existing `embedder: async () => null` test injections must keep passing; do NOT add a new mandatory option that breaks them.
- The model-weight download is the ONE external network dependency this FEAT introduces. Privacy note in the design review and the user-facing release note must call this out (only model weights leave the device, never user phrases).
- FEAT068 is the immediate downstream consumer. Coordinate the API surface (Story 6) with FEAT068's PM spec before locking the export list.
