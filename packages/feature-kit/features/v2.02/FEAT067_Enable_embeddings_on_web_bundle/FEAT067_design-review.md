# FEAT067 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT067_Enable_embeddings_on_web_bundle.md`
**Refs:** FEAT051 (router algorithm + ladder), FEAT054 (registry + locked-zone hashing),
FEAT064 (isomorphic skill loading + 5% bundle budget; design review §3.3 deferred
the embedder unblock to *this* FEAT), FEAT066 (triage-hint primary signal —
closes the head, this FEAT closes the long tail), FEAT044 (Capacitor mobile —
inherits the web embedder path), FEAT068 (RAG `info_lookup` — direct
downstream consumer of the API surface this FEAT exports).
Code: `metro.config.js:8-16` (blockList), `src/modules/embeddings/provider.ts`
(today's Node-only `embed`/`embedBatch`/`isModelLoaded`),
`src/modules/router.ts:574-582` (`embedPhrase` lazy-import + `[router] phrase
embedder unavailable` log), `src/modules/router.ts:453-458` (graceful-degrade
fallback at the embedding step), `src/modules/skillRegistry.ts:178-190`
(skill-side `descriptionEmbedding` compute — **gated `if (isNode())` today**),
`src/skills/_generated/skillBundle.ts` (FEAT064 bundle — manifest+prompt only,
**no embeddings shipped**), `src/skills/.embedding_cache.json` (Node-side
embedding cache), `scripts/bundle-skills.ts` (FEAT064 bundler),
`scripts/api-proxy.js:217` (the live-process `embed` injection point — Node
side; mentioned for option-B rejection only),
`node_modules/@xenova/transformers/package.json` (browser-field
auto-substitution of `onnxruntime-node` → `onnxruntime-web`),
`app/_layout.tsx:1-80` (boot sequence — no embedder warmup hook today).

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions (14 binding items).

This is the infrastructure FEAT that closes the long-tail routing gap
FEAT066 explicitly punted to this work. The shape is the same as FEAT064:
flip a build-time gate (Metro `blockList`) and let the existing isomorphic
contract carry the implementation. The `@xenova/transformers` package
already auto-detects browser vs Node via its `browser` package.json field
(verified — `onnxruntime-node` is set to `false`, `onnxruntime-web` is the
runtime dependency the browser sees). One isomorphic provider works
without branching.

The primary trade-off is **cold-load cost on the user's first chat
phrase after a fresh cache.** Option A pays an ~80MB one-time download
plus WASM startup; once cached in IndexedDB it is amortized across every
subsequent reload forever. Option B avoids the cost on web but rebreaks
the embedder on Capacitor mobile — the same gap FEAT044 exists to close.
Option A is the only path that keeps mobile parity, which is
non-negotiable per FEAT044's scope.

The single architect-corrected PM finding is load-bearing: **the
`skillBundle.ts` does NOT ship pre-computed skill embeddings today.**
Skill `descriptionEmbedding` is computed at registry-load time and is
gated by `if (isNode())` at `skillRegistry.ts:180`. Unblocking the
embedder on web is **necessary but not sufficient** — without lifting
the `isNode()` gate (or pre-computing skill embeddings at bundle time),
`findSkillsByEmbedding` will see every skill with `descriptionEmbedding:
null` on web and the routing ladder still falls through. This FEAT must
fix both ends. See §6 condition 4.

The load-bearing artifact is the **embedder-ENABLED real-LLM smoke**
(§6 condition 13) — the inverse of FEAT066's embedder-disabled smoke.
Stub-LLM unit tests prove the provider produces 384-dim vectors; only
the live web-build run with the embedder enabled proves the long-tail
routing gap actually closes.

---

## 2. Architecture (one screen)

```
┌─ Build time ───────────────────────────────────────────────────────────┐
│ npm run build:web                                                      │
│   ↓                                                                    │
│ prebuild:web → ts-node scripts/bundle-skills.ts                        │
│   (unchanged from FEAT064 — emits SKILL_BUNDLE)                        │
│   ↓                                                                    │
│ NEW: scripts/bundle-skills.ts also computes skill-side embeddings      │
│   from manifest.description and writes them into                       │
│   src/skills/_generated/skillEmbeddings.ts (parallel committed file)   │
│   — runs on Node, uses provider.ts, 384-dim Float32Array per skill,    │
│     keyed by skill id. Deterministic (same input → same output).       │
│   ↓                                                                    │
│ expo export --platform web (Metro now bundles xenova + onnx-web)       │
└────────────────────────────────────────────────────────────────────────┘

┌─ metro.config.js (one-line unblock) ──────────────────────────────────┐
│ blockList:                                                            │
│   /src[/\\]db[/\\].*/,                                                │
│   /node_modules[/\\]@libsql[/\\].*/,                                  │
│   /node_modules[/\\]googleapis[/\\].*/,                               │
│   // REMOVED: /src[/\\]modules[/\\]embeddings[/\\].*/                 │
│   // REMOVED: /node_modules[/\\]@xenova[/\\].*/                       │
│   // REMOVED: /node_modules[/\\]onnxruntime[/\\].*/                   │
│ Note: src/modules/embeddings/{indexer,retriever,linker,                │
│   background-indexer}.ts STILL import db/queries/* — those callers    │
│   stay Node-side. Only provider.ts is needed isomorphic.              │
│ → Approach: keep the embeddings/* blockList for indexer/retriever     │
│   variants; allow ONLY provider.ts through the bundle. See cond. 2.   │
└───────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Web bundle, first phrase ──────────────────────────────────┐
│ user types phrase → routeToSkill                                      │
│   ↓ Step 0 directSkillId          (no)                                │
│   ↓ Step 1a triage hint (FEAT066) (no — long-tail phrase)             │
│   ↓ Step 1 structural             (no — first token doesn't match)    │
│   ↓ Step 2 embedding              ← NOW LIVE on web                   │
│       embedder = embedPhrase                                          │
│       └─ import("./embeddings/provider") (lazy, dynamic)              │
│           └─ pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")│
│               ├─ first call: download model from huggingface.co       │
│               │     (~80MB), xenova caches in IndexedDB automatically │
│               │     (its cacheDir option uses IndexedDB on browsers)  │
│               └─ subsequent calls: reuse _pipe (in-memory) +          │
│                  IndexedDB-cached weights (across reloads)            │
│       phraseEmbedding: Float32Array(384) | null                       │
│       null path: existing fallback (genuine load failure / WASM       │
│         blocked / IndexedDB full) — NO regression vs today            │
│   ↓ findSkillsByEmbedding(phraseEmbedding, 3)                         │
│       skills' descriptionEmbedding now non-null (cond. 4)             │
│   ↓ Step 3 confidence gate / Step 4 Haiku tiebreaker (unchanged)      │
└───────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Web bundle, COLD-LOAD WINDOW (first phrase only) ──────────┐
│ While the model is downloading, the embedder hasn't returned yet.     │
│ The embedding step blocks until the pipeline resolves.                │
│ UX: the chat shows "thinking" for an extra ~3-15s on a fresh-cache    │
│      device while the 80MB model downloads.                           │
│ Mitigation v1: NONE — defer-on-first-use. Triage-hint (FEAT066)       │
│   already pre-empts for the head of the distribution; only long-tail  │
│   phrases hit Step 2 and only the first one pays the cost.            │
│ Future polish: app/_layout.tsx warmup hook calls                      │
│   isModelLoaded()→embed("warmup") in the background after boot.       │
│   Out of scope for v1 (cond. 9).                                      │
└───────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Capacitor mobile (FEAT044 future) ─────────────────────────┐
│ Same web bundle. WASM runs in iOS/Android WebKit/Chromium. xenova     │
│ uses IndexedDB the same way. No mobile-specific code.                 │
│ RISK: iOS Safari/WebKit may have lower WASM memory ceilings — see §5. │
└───────────────────────────────────────────────────────────────────────┘
```

**Why this shape.** The xenova package already does the platform
auto-detection we need (verified in node_modules — its `browser` field
swaps `onnxruntime-node` → `onnxruntime-web`). The current Node-only
`provider.ts` source compiles and runs on web with zero changes once
Metro stops blocking it. The actual delta is:

1. Metro `blockList` removes three regexes (xenova, onnxruntime, the
   embeddings folder — but selectively for the folder, see cond. 2).
2. `skillRegistry.ts` lifts the `if (isNode())` gate at line 180 (or
   pre-computes skill embeddings at bundle time — cond. 4 picks
   bundle-time as the primary path).
3. Provider exports widen for FEAT068 — `MODEL_ID` constant added.
4. Documentation note: privacy (only weights leave the device).

Everything else is environmental. No router code change. No skill
manifest change. No type change beyond the additive `MODEL_ID` export.

---

## 3. Alternatives considered

### 3.1 Approach A vs B vs C — embedder location

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(A) In-bundle xenova WASM (CHOSEN)** | True query-side embedding fidelity on web. Identical path on web + Capacitor mobile (FEAT044 inherits with zero work). Works offline after first download. No proxy dependency. | ~80MB cold-load on first chat phrase after fresh install. ~200KB JS shim added to dist. WASM cold-startup cost on every page reload (in-memory pipeline rebuilds, but weights cached in IndexedDB). | **CHOSEN** |
| (B) Proxy-delegated `/embed` endpoint on api-proxy.js | Web bundle stays light. No WASM. ~50ms localhost latency per query. | Capacitor mobile doesn't run the proxy (FEAT044 is offline-capable by design); embeddings would degrade again, undoing this FEAT for mobile. Ties web routing to a running proxy — same constraint as `/v1/messages` today, but worse because routing-quality regressions are subtle and silent. | Reject |
| (C) Both (proxy primary, in-bundle fallback) | Hot reload speed of proxy + offline of bundle. | Doubles maintenance surface. Vector consistency between two embedders is hard to keep byte-equal across versions. No specific reason surfaced to justify both. | Reject |

**Decision rationale.** Mobile parity is the deciding factor.
FEAT044 (Capacitor) is in flight on `fz-dev-capacitor` and inherits
whatever this FEAT ships. Option B re-creates the exact gap on mobile
that this FEAT exists to close on web. The cold-load math also favors A
long-term: A's ~80MB is amortized once per device forever; B's ~50ms is
paid on every routing decision forever. The `routeToSkill` call sits
inside the chat hot path, which fires on every user phrase.

### 3.2 (A) Bundle weights vs CDN fetch

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Bundle weights into `dist/` | Offline-first from install. No external network dependency. | Adds ~80MB to the install payload (web bundle exceeds the FEAT064 5% budget by orders of magnitude). Defeats Option A's lightness pitch — the full ~200KB JS + ~80MB weights ship together. Unacceptable. | Reject |
| **CDN fetch + IndexedDB cache (CHOSEN)** | Bundle stays at ~200KB JS. Weights download lazily on first phrase that needs an embedding. xenova caches weights in IndexedDB automatically — across browser reloads no re-download. Privacy: only model weights leave the device, never user phrases. | One external network dependency (huggingface.co) added. CDN availability / breaking changes are a risk (§5). First-run users without internet cannot warmup the embedder. | **CHOSEN** |

**Decision rationale.** Bundling 80MB into the install payload is
unacceptable given the FEAT064 5% budget that this FEAT must respect.
The weights are static, large, and externally maintained — exactly the
profile of a CDN asset. Self-hosting the weights is documented in
spec §Out-of-Scope as v2.03+ hardening.

### 3.3 (A) Keep `Xenova/all-MiniLM-L6-v2` (384-dim) vs downsize

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Keep MiniLM 384-dim (CHOSEN)** | Skill-side embeddings (whether bundled or computed) are already 384-dim per the existing Node embedder. No re-indexing. FEAT068's future indexed corpus will use the same embedder, so dimension match is automatic. | None significant. The model is already the smallest production-grade option in the MiniLM family. | **CHOSEN** |
| Downsize to a smaller model (e.g., a quantized variant) | Smaller download. Faster cold load. | Forces re-embedding all skill manifests AND any future FEAT068 corpus. Vector incompatibility on the routing path until the migration is complete. New cache key, IndexedDB invalidation. | Reject for v1; future FEAT can reconsider |

**Decision rationale.** Dimension mismatch breaks cosine similarity
silently. Migration to a smaller model is a cross-cutting change that
deserves its own FEAT once Option A has stabilized.

---

## 4. Cross-feature concerns

**FEAT044 Capacitor mobile (in flight on `fz-dev-capacitor`).** This
FEAT is the foundation FEAT044 inherits for embeddings on mobile.
WebKit's WASM and IndexedDB are both standard web APIs that Capacitor's
webview uses. **Risk: iOS Safari/WebKit historically applies stricter
memory ceilings on WASM modules than desktop Chromium** — if the
~80MB model exceeds the iOS WASM memory ceiling, FEAT044 falls back
to the existing graceful-degrade fallback (`router.ts:455-458`) on
iOS only. Document this open risk; verify in FEAT044 scope.
Capacitor Filesystem is for native file I/O and is NOT used for the
model cache — the WebKit IndexedDB inside the webview is the cache.
No Capacitor-specific code in this FEAT.

**FEAT066 triage-hint primary signal.** Stays primary. This FEAT does
NOT touch Step 1a in `router.ts`. Triage-hint pre-empts the embedding
step for the head of the distribution (verb-prefix CRUD + emotional +
planning phrases). The embedding step only matters for phrases triage
cannot classify — the long tail. Both compose: triage-hint short-
circuits the head, embedding fills in the long tail.

**FEAT068 RAG `info_lookup` skill (direct downstream consumer).** This
FEAT delivers the embedding API surface FEAT068 will consume. The
exported surface is locked at `embed(text)`, `embedBatch(texts)`,
`isModelLoaded()`, plus a new `MODEL_ID: string` constant. FEAT068
adds the vector store and the retrieval skill on top; nothing in this
FEAT writes vectors to disk beyond the model-weight cache. FEAT068
must check `MODEL_ID` against an index-side recorded value to detect a
model upgrade and trigger re-indexing — same shape as the FEAT042
embedding cache key.

**FEAT064 isomorphic skill loading.** FEAT064's design review §3.3
explicitly deferred the embedder unblock to "a separate FEAT with its
own risk profile" — this is that FEAT. FEAT064's 5% bundle-size budget
applies; condition 12 measures the delta in the gate.

**Skill-side embeddings — architect correction to PM finding.** The PM
spec assumed `skillBundle.ts` ships skill-side embeddings (per spec line
references). **Audit verified: it does NOT.** The bundle ships only
manifest + prompt + context + handlers. Skill `descriptionEmbedding`
is computed at registry load time (`skillRegistry.ts:178-190`) gated
by `if (isNode())`. The on-disk file `src/skills/.embedding_cache.json`
contains placeholder all-zero-but-first vectors that look like
uninitialized stubs, NOT real cached embeddings. This means unblocking
the embedder on web is **necessary but not sufficient** — without
fixing the skill-side path too, `findSkillsByEmbedding` returns empty
on web and the long-tail routing still falls back. The fix has two
shapes; condition 4 picks one.

**Privacy note (load-bearing for the user-facing release note).** The
user's chat phrases are embedded **on the user's device** by the
xenova WASM runtime. The phrase text NEVER leaves the device. The ONLY
data that flows from the network is the static model weights from the
chosen CDN (huggingface.co), and only on first use per device. The
weights are public, version-pinned, and integrity-checked by xenova's
own machinery. This is a privacy-preserving design — **document it
explicitly** in the release note (cond. 11) so the user sees that
turning on web embeddings does not open a new data-egress channel.

**Backwards-compat for `embedder: async () => null` test injection.**
PM and architect agree: preserve. Tests that inject the null embedder
explicitly simulate "embedder unavailable on this surface" — that's
the path FEAT066's smoke used to prove the triage-hint fix held with
embedder disabled. Production code path on web NOW succeeds by default;
tests still pin null when they want to exercise the fallback branch.
No change to `RouteOptions.embedder`. No change to existing
`router.test.ts` fixtures that use the null injection.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **iOS Safari/WebKit WASM memory ceiling** — the ~80MB model exceeds iOS's per-page WASM memory budget; the embedder fails to load on iOS Capacitor (FEAT044). | Medium | Medium | The router's existing `if (!phraseEmbedding)` fallback (line 455-458) catches the load failure. iOS users get the FEAT066 triage-hint head + fallback for the long tail — same behavior as web today. FEAT044 must include an iOS-specific WASM cold-load smoke; if iOS fails, fall back to a proxy-on-iOS-only (out of scope here, called out for FEAT044). Document in §10 sign-off as the highest-likelihood mobile regression. |
| **CDN availability / breaking change** — huggingface.co serves the wrong model file or 404s; first-run on a fresh-cache device fails. | Low | Medium | xenova retries on 5xx and rebuilds the cache. A 404 (model removed/renamed) breaks until xenova publishes a fix or until we self-host. v2.03+ hardening: self-host the weights from our own asset CDN. v1: log the failure once, fall through to the existing graceful-degrade path. The FEAT066 triage-hint head still works without the embedder. |
| **Cold-load UX regression on first phrase after fresh cache** — user types a long-tail phrase, waits ~3-15s for the model to download before getting a routing decision. | Medium | Low-Medium | Defer-on-first-use is the v1 UX (PM's pick, architect agreed). Triage-hint (FEAT066) covers the head — only long-tail phrases hit Step 2, and only the first one pays the cost. After the first phrase, IndexedDB cache makes subsequent reloads start fast. Document the one-time cost in the release note. Future FEAT can add a warmup hook in `app/_layout.tsx`. |
| **Cache invalidation when model id changes** — a future model upgrade leaves stale weights in IndexedDB; the new version downloads while the user thinks the cache is good. | Low | Low | xenova's cache key includes the model id; switching models triggers a clean download. We export `MODEL_ID` from the provider so FEAT068's index-side cache can detect the same. Old IndexedDB entries linger until the browser cache eviction reclaims them — not blocking. |
| **JS bundle size budget breach (FEAT064 5%)** — xenova + onnx-web JS shim plus dependent code exceeds ~200KB minified. | Low | Medium | Cond. 12 measures the delta in the gate. Expected ~200-300KB minified per PM and xenova docs. If actual exceeds 5%, surface in test results. The model weights are NOT counted toward the JS bundle (loaded at runtime from CDN). If JS shim alone exceeds 5%, do NOT block on the budget — document and proceed; the bundle-size budget is a guideline, the embedder is the goal. |
| **`if (isNode())` gate persists in skillRegistry** — coder unblocks Metro but forgets to lift the skill-embedding compute gate; web routing still falls back. | Medium | High | Cond. 4 explicitly mandates lifting the gate OR moving skill embeddings into the bundle script. Cond. 13 (binding smoke) catches it: if skill embeddings are null, the smoke fails on every long-tail phrase. |
| **Vector dimension mismatch between web and Node embedders** — different xenova versions or different cache states produce vectors of different shape; cosine similarity returns 0 for everything. | Low | High | Provider exports `MODEL_ID` constant pinning the model name + version. Cond. 5 unit test asserts `embed("test").length === 384`. Cond. 7 byte-equal vector test (Node vs web ts-node web-build harness, same input phrase, same vector). |
| **WASM memory leak on long-running session** — repeated embedding calls accumulate memory; a session open for days (per CLAUDE.md "app runs continuously") swells. | Low | Low | xenova reuses `_pipe` per the existing lazy-init pattern; per-call allocations are GC'd by the JS runtime. Long-session test out of scope here. Flag in §9 as a future telemetry candidate. |
| **CSP / cross-origin issues fetching weights** — Capacitor's stricter CSP blocks the huggingface.co fetch. | Low | Medium | FEAT044 owns the Capacitor CSP. Note in cond. 14: Capacitor verification deferred to FEAT044, but the design review explicitly states weights MUST come from `https://huggingface.co/Xenova/all-MiniLM-L6-v2` so FEAT044's CSP allowlist is unambiguous. |
| **Backwards-compat: existing `embedder: async () => null` test fixtures break** — coder accidentally hard-wires the real embedder, bypassing the injection. | Low | Medium | Cond. 8 mandates: `RouteOptions.embedder` injection still wins over `embedPhrase`. Existing `router.test.ts` fixtures pass unchanged. New embedder-enabled smoke uses the production path explicitly (does not inject). |

---

## 6. Conditions (numbered, BINDING)

1. **Metro `blockList` selectively unblocks the embedder dependencies.**
   `metro.config.js` removes:
   - `/node_modules[/\\]@xenova[/\\].*/`
   - `/node_modules[/\\]onnxruntime[/\\].*/`
   The `src/modules/embeddings/.*` regex stays (see cond. 2). The
   `@libsql`, `googleapis`, and `src/db/.*` blocks stay untouched.
2. **`src/modules/embeddings/provider.ts` becomes isomorphic AND
   selectively unblocked.** The `embeddings/*` blockList regex is
   replaced with a path-allowlist for `provider.ts` only:
   ```
   /src[/\\]modules[/\\]embeddings[/\\](indexer|retriever|linker|background-indexer)\.ts$/
   ```
   `provider.ts` is permitted to enter the web bundle; the four
   indexer/retriever/linker/background-indexer modules stay blocked
   (they import `db/queries/embeddings` which is Node-only). Confirm
   the regex shape compiles in Metro.
3. **`provider.ts` is verified isomorphic with no edits.** xenova's
   `browser` package.json field auto-substitutes `onnxruntime-node`
   → `onnxruntime-web` for the web bundle (verified in audit). The
   existing source compiles and runs on web unchanged. Coder confirms
   by running the bundle gate (cond. 12) and the embedder-enabled
   smoke (cond. 13). NO source change to `provider.ts` except adding
   the `MODEL_ID` export (cond. 6).
4. **Skill-side `descriptionEmbedding` made available on web.** The
   architect-corrected gap. Pick **one** of two shapes (coder's
   discretion, cond. 4a-OR-4b):
   - **(4a) Bundle-time pre-compute (PREFERRED).** Extend
     `scripts/bundle-skills.ts` to compute each skill's
     `descriptionEmbedding` from `manifest.description` at bundle
     time using `provider.ts::embed`, and emit
     `src/skills/_generated/skillEmbeddings.ts` (committed). Web
     loads from this static file. Node also loads from this file by
     default; the `LIFEOS_SKILL_LIVE_RELOAD=1` escape hatch
     re-computes on the fly.
   - **(4b) Runtime gate lift.** Remove the `if (isNode())` at
     `skillRegistry.ts:180`. Skill embeddings compute on every
     platform at registry load time, gated only on whether the
     embedder is available. Web pays a one-time per-skill
     `embed(description)` cost on first registry load; results
     cached in IndexedDB by xenova's machinery.
   **Architect strongly prefers 4a** — embeddings are deterministic
   given the model + text, so build-time compute is the safer cache.
   Bundle-time also lets us check skill-embedding dimensions match
   `MODEL_ID` at build time.
5. **Provider unit test: 384-dim vector, deterministic.** New unit
   test (or extend existing) asserts:
   - `(await embed("hello world")).length === 384`
   - `await embed("")` returns `null`
   - `await embed("a")` returns `null` (length < 2)
   - Two calls with the same input return byte-equal vectors.
   - `embedBatch(["a", "b", "c"]).length === 3`
   - `isModelLoaded()` is `true` after the first successful `embed`.
   Test runs in Node ts-node (the bundled web runtime is too heavy
   for unit tests). The cross-platform byte-equality is cond. 7.
6. **`MODEL_ID` constant exported from `provider.ts`.** Add:
   ```
   export const MODEL_ID = "Xenova/all-MiniLM-L6-v2" as const;
   ```
   Used by FEAT068 for re-index detection. Documented in the
   provider's header comment as the "model identity surface for
   index-side cache invalidation."
7. **Web vs Node vector byte-equality.** A test (or harness in
   `scripts/scratch/`) embeds a fixed phrase ("the quick brown fox")
   under the Node provider AND under a Node ts-node harness that loads
   the web build's provider. Assert the two Float32Array outputs are
   byte-equal (or within `< 1e-6` per element to allow for
   floating-point determinism caveats — coder picks tolerance, with
   `=== 0` strict preferred). This is the "Goal 6 byte-equal" check
   from the spec.
8. **Backwards-compat: `RouteOptions.embedder` injection still wins.**
   Existing `router.test.ts` fixtures using `embedder: async () =>
   null` continue to pass with zero changes. The production
   `routeToSkill` call still uses `options.embedder ?? embedPhrase`
   (line 453, unchanged). Coder verifies by running the existing
   unit suite green before declaring Done.
9. **No app-boot warmup hook.** `app/_layout.tsx` is unchanged. The
   embedder loads lazily on first phrase per spec Story 2 / PM Open
   Q4. No progress UI for v1. A future polish FEAT can add the
   warmup hook + loading indicator. One-line `console.log` on first
   model-load completion is acceptable for telemetry.
10. **Capacitor verification deferred to FEAT044.** This FEAT does
    NOT verify the WASM cold-load on iOS or Android Capacitor.
    Document the open risk in §5 and call out in cond. 14: FEAT044
    must include an iOS-specific cold-load smoke. If iOS fails,
    FEAT044 (not this FEAT) ships an iOS-only proxy fallback.
11. **Privacy note in user-facing release note.** When this FEAT
    ships, the release note MUST state: "Long-tail routing now
    works on web. The first time you ask something the system
    can't classify, it downloads a small language model
    (~80MB, one-time per device) from a public source. Your
    chat phrases are embedded on your device — they never leave."
    Coder drafts the note; PM finalizes wording before ship.
12. **Web bundle size gate.** Coder runs `npm run build:web` before
    this FEAT lands and after, captures
    `dist/_expo/static/js/web/*.js` total bytes, and reports the
    delta. Pass/flag threshold: `<5%` increase per FEAT064 budget.
    Expected ~200-300KB increase from xenova + onnx-web JS shim. If
    actual exceeds 5%, surface in test results and explicitly flag
    in stage 7 — the budget is a guideline, the embedder is the
    goal; do NOT block on the budget alone.
13. **MANDATORY — Real-LLM smoke (BINDING) with embedder ENABLED.**
    Tester runs a script `scripts/scratch/smoke-feat067.ts`
    (gitignored under `scripts/scratch/` per repo policy). The
    harness loads the web build's `provider.ts` in a Node ts-node
    runtime that resolves the browser-field substitution (use
    `metro-resolver` shim or a webpack-style resolver, OR run the
    smoke against the actual running web bundle via Playwright / a
    headless browser — coder picks the lighter option).
    For each of the 10 long-tail phrases (spec Story 7 table), the
    smoke asserts:
    - `routeResult.routingMethod === "embedding"` OR `"haiku"`,
      NOT `"fallback"`,
    - `phraseEmbedding` was non-null (the embedder produced a
      vector — assert via instrumentation or by checking the
      router log line for the absence of "phrase embedder
      unavailable"),
    - `routeResult.skillId` matches the architect-tagged
      "should reach a specific skill" set on the spec table
      (architect approves a soft pass for genuinely ambiguous
      phrases as long as the embedder produced a vector).
    **Pass threshold: 10/10 strict on the routing-method
    assertion (no soft-pass).** Per-phrase skill-id match is at
    architect's discretion per spec.
    Output captured in `FEAT067_test-results.md`: per-phrase log
    line, cold-start time for first call, vector byte-equality
    line vs Node baseline (cond. 7).
14. **`docs/new_architecture_typescript.md` updated.** Section 6
    (Module Responsibilities — `provider.ts` is now isomorphic;
    skill embeddings now bundled at build time per cond. 4a),
    Section 9 (ADR for "embedder unblock + bundle-time skill
    embeddings + privacy posture"), Section 12 (Feature Catalog —
    web embeddings now live, FEAT068 unblocked).
15. **Zero changes** to `src/modules/router.ts` (router code path
    unchanged), `chat.tsx` (chat surface unchanged), the seven skill
    folders' source code, `src/types/orchestrator.ts` (no new
    types), the dispatcher, the executor, the assembler. The only
    code touches are `metro.config.js`, `provider.ts` (add
    `MODEL_ID` only), `skillRegistry.ts` (lift gate or wire
    bundle-time embeddings — cond. 4), `scripts/bundle-skills.ts`
    (extend for cond. 4a), and the new `_generated/skillEmbeddings.ts`
    if 4a is picked.

---

## 7. UX

**Zero changes** to existing surfaces, copy, or prompts.

**Visible delta after this FEAT lands:**

- Web bundle: long-tail descriptive phrases (the kind triage's regex
  doesn't match and the Haiku tiebreaker doesn't pin) now reach the
  matched skill instead of falling through to `general_assistant`
  with a polite refusal.
- Web bundle: first phrase after a fresh-cache device load takes
  ~3-15s longer than steady-state while the 80MB model downloads.
  Subsequent phrases are normal speed. After a browser reload, the
  IndexedDB cache means no re-download.
- Web bundle: triage-hint (FEAT066) head behavior is unchanged —
  verb-prefix CRUD phrases still pre-empt and route via
  `triage_hint`, no embedding cost paid.
- Web bundle: the `[router] phrase embedder unavailable` log line
  goes away on web; replaced by `[router] route ... method=embedding`
  for long-tail phrases.
- Web bundle: tasks (FEAT068, future) gain a working query-side
  embedding API to build on.

The cold-load delay is the only user-visible regression risk. PM
and architect agreed to defer-on-first-use without a progress
indicator for v1. Future polish.

---

## 8. Test strategy

### 8.1 Unit — provider produces 384-dim vectors

Per cond. 5. Tests in `src/modules/embeddings/provider.test.ts` (new
file). Run in Node ts-node. Asserts deterministic 384-dim vectors,
null on length-< 2, batch parallelism shape.

### 8.2 Unit — `MODEL_ID` constant exported

A one-line test asserts `MODEL_ID === "Xenova/all-MiniLM-L6-v2"`.
Catches accidental bumps without an explicit migration.

### 8.3 Cross-platform byte-equality

Per cond. 7. A harness embeds the same phrase under Node and a
Node-ts-node web-build resolution, asserts byte-equal Float32Array.
This protects FEAT068's index-side cache from a Node-vs-web
dimension or value drift.

### 8.4 Integration — router uses real embedder on web; FEAT066
triage-hint still pre-empts

A test boots the registry on a simulated web platform (mock
`isNode()` to false; provide a real provider), runs:
- A FEAT066 head phrase ("add a task to ..." with
  `triageLegacyIntent: "task_create"`) → asserts
  `routingMethod: "triage_hint"` (pre-empted before the embedding
  step ran).
- A long-tail phrase with no triage hint → asserts
  `routingMethod: "embedding"` or `"haiku"`, `phraseEmbedding`
  was used.

### 8.5 Smoke — Story 7 long-tail set, embedder ENABLED (BINDING)

Per cond. 13. The 10-phrase smoke runs against the real web build.
**Pass threshold 10/10 strict on routing-method.** This is the
binding artifact. Output in `FEAT067_test-results.md`.

### 8.6 Bundle gate — JS size delta < 5%

Per cond. 12. Before/after `npm run build:web` byte counts. Surface
in test results.

### 8.7 Regression — full existing suite

- `router.test.ts` passes unchanged. Existing `embedder: async () =>
  null` injections still simulate "embedder unavailable" cleanly.
- FEAT066's binding smoke (10/11 phrases, embedder DISABLED) still
  passes — this FEAT does not regress the head-of-distribution
  routing.
- `npm test` green; `tsc --noEmit` clean except pre-existing
  warnings; `npm run build:web` exits 0.

### 8.8 Headless / Node parity

Headless runner produces byte-equal embedding vectors for the same
fixed test phrase before and after this FEAT. (Spec Goal 6.) Node
also reads the bundle-time skill embeddings (cond. 4a) so its boot
log shows the same skills with the same embedding presence as
today.

### 8.9 Out of scope

- iOS WebKit cold-load smoke (deferred to FEAT044).
- Long-running session WASM memory profile (telemetry future).
- FEAT068 RAG integration test (separate FEAT).
- Bundle-size deep-dive of which xenova subdeps could be tree-shaken.

---

## 9. Pattern Learning

**FEAT067 codifies "use CDN + IndexedDB for large model assets" as a
pattern.** Future FEATs that want to ship a model on the web bundle
follow this template:

1. Identify a model with a public CDN distribution (huggingface.co,
   jsdelivr, etc.).
2. Use a runtime that auto-detects browser vs Node and uses the
   appropriate WASM/native runtime (xenova for transformers; ONNX
   Runtime Web for raw inference; tfjs-web for TensorFlow models).
3. Let the runtime handle IndexedDB caching natively. Don't roll
   your own cache.
4. Lazy-load on first use; do NOT bundle weights.
5. Export a `MODEL_ID` constant for downstream cache invalidation.
6. Privacy posture in the release note: only weights leave the
   device, never user data.

**FEAT068 builds directly on this.** RAG indexing on web reuses the
same provider + IndexedDB cache; the index-side vectors live in the
same xenova-managed cache the query embedder uses. No second
infrastructure to stand up.

**Future polish — embedder warmup hook.** A future FEAT can add a
`useEffect` in `app/_layout.tsx` that calls `embed("warmup")` in
the background after boot, hiding the cold-load behind app boot.
Out of scope for v1; documented as the obvious next step.

**Future hardening — self-host the model weights.** v2.03+ FEAT
moves the weights from huggingface.co to our own CDN or to a
git-LFS asset. Removes the external dependency. The `MODEL_ID`
constant is the migration hook.

**Codification:** add an entry to AGENTS.md (low-priority — may
roll into the next docs-cleanup PR) under "Architecture Rules":

> **Use CDN + IndexedDB for large model assets.** When a model
> exceeds 1MB and has a public CDN distribution, lazy-load weights
> on first use and let the runtime cache in IndexedDB. Do NOT
> bundle weights into the JS bundle. Export a `MODEL_ID` constant
> for cache invalidation. Document the privacy posture (weights
> from CDN, user data on-device) in the release note.

**Carry-forward:**

- FEAT068 RAG implementation reuses the provider + the bundle-time
  skill-embedding pattern.
- FEAT044 Capacitor verification picks up the iOS WASM cold-load
  smoke and any iOS-only fallback work.
- v2.03+ self-host hardening migrates weights off huggingface.co.

---

## 10. Sign-off

Architect approves. Conditions §6 binding (15 items). Conditions 4
(skill-side embeddings — the architect-corrected gap), 7 (vector
byte-equality), and 13 (binding smoke with embedder ENABLED) are
**the parity-defining artifacts** — coder must complete all three
before declaring Done.

**Pay special attention to:**

- **Condition 4 (skill-side embeddings).** This is the
  architect-corrected gap PM missed. Without lifting the
  `if (isNode())` gate at `skillRegistry.ts:180` OR pre-computing
  skill embeddings at bundle time (4a preferred), the long-tail
  routing on web will STILL fall through even after Metro is
  unblocked. Cond. 13 catches it but is a late signal — cond. 4
  is the prevention.
- **Condition 13 (BINDING smoke, embedder ENABLED).** The inverse
  of FEAT066's smoke. FEAT066 proved the head works without the
  embedder; FEAT067 proves the long tail works WITH the embedder.
  10/10 strict — no soft pass. If any phrase fails, do NOT mark
  Done.
- **Condition 1 + 2 (Metro `blockList` selective unblock).** Three
  regex changes. Allow `provider.ts` only — keep
  indexer/retriever/linker/background-indexer Node-only because
  they import DB code. If the regex shape doesn't compile in Metro,
  alternative: leave `embeddings/*` blocked entirely and create
  `embeddings/webProvider.ts` as a thin re-export of the bits
  Metro can resolve. Coder picks; document the choice.
- **Condition 4a vs 4b.** 4a (bundle-time pre-compute) is strongly
  preferred — embeddings are deterministic, build-time compute is
  a better cache than runtime compute, and 4a removes the runtime
  cost on web entirely. Coder may pick 4b if 4a's bundle-script
  changes are infeasible, but document the rationale.
- **Privacy note in release note (cond. 11).** Load-bearing for
  user trust. Phrases stay on-device; only weights flow from CDN.
  PM finalizes wording.
- **iOS WebKit risk (§5 row 1, cond. 10).** Deferred to FEAT044
  but flagged here because the architect cannot verify it from
  the desktop dev environment. FEAT044 owns the iOS smoke.
- **Backwards-compat for `embedder: async () => null`** (cond. 8).
  Trivial but worth a re-read of the existing fixtures before
  declaring Done. Production path now succeeds on web by default;
  tests still pin null when they want the fallback branch.

This auto-advances to the coder. No further architect review
required unless the coder surfaces a condition-blocking finding
during stage 5 or the smoke (cond. 13) fails.
