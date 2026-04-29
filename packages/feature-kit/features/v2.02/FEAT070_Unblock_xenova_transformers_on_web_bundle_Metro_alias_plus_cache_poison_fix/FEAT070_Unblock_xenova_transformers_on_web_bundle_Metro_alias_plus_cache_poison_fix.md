# FEAT070 — Unblock xenova transformers on web bundle (Metro alias plus cache poison fix)

**Type:** bug fix
**Status:** Done
**MoSCoW:** MUST
**Category:** Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** embeddings, web, metro, xenova, routing
**Created:** 2026-04-29

---

## Summary

`npm run dev` would not load on web — the page threw `Cannot use 'import.meta' outside a module`, and once that was bypassed, every `embed()` call threw `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`. Both errors traced back to `@xenova/transformers` interacting badly with Metro and with the SPA's catch-all index.html response. The router's embedding path therefore fell back to `general_assistant` for every chat phrase, defeating FEAT067/068/069.

## Problem Statement

Three distinct failures stacked on top of each other:

1. **`import.meta` parse error.** The `@xenova/transformers` package's `package.json` `main` points at `src/transformers.js` (ESM source). `src/env.js:42` uses `import.meta.url` to resolve `__dirname`. Metro treats packages as CJS and throws on `import.meta` at runtime in the web bundle.
2. **HTML masquerading as model JSON.** With the package resolving, xenova defaults to `allowLocalModels: true` and probes `<origin>/models/<MODEL_ID>/config.json` first. The SPA host (Expo dev server, Capacitor WKWebView in production) returns the index.html shell with HTTP 200 for any unknown path. xenova `JSON.parse(<!DOCTYPE...>)` throws and the remote-fallback branch is never reached.
3. **Poisoned browser Cache Storage.** xenova caches every fetch under `caches.open('transformers-cache')`. Once an HTML response was stored against the local-path key, `tryCache(cache, localPath, …)` (`hub.js:422`) hit it ahead of the `allowLocalModels` gate on every subsequent run — so even after flipping the flag the bad response kept short-circuiting the load.

## Workflow

```
metro.config.js: alias @xenova/transformers → dist/transformers.js (IIFE)
                ↓
provider.ts: env.allowLocalModels=false; env.useBrowserCache=false
                ↓
provider.ts: caches.delete('transformers-cache') once per page load
                ↓
xenova.pipeline() → fetches MiniLM weights from huggingface.co
                ↓
embed(phrase) returns Float32Array(384)
                ↓
router.findSkillsByEmbedding() → real cosine similarity → real routing
```

## Implementation Notes

| File | Change |
|------|--------|
| `metro.config.js` | Add `resolver.resolveRequest` shim that points `@xenova/transformers` at the prebundled `dist/transformers.js`. The dist is a webpack IIFE with no `import.meta`, and onnxruntime-web is already bundled in. |
| `src/modules/embeddings/provider.ts` | After dynamic-importing xenova, set `env.allowLocalModels=false`, `env.useBrowserCache=false`, and call `caches.delete('transformers-cache')`. All three guards are gated on `typeof window !== "undefined"` / `typeof caches !== "undefined"` so the Node-side path (`scripts/bundle-skills.ts`) is unaffected. |

## Out of Scope

- Re-enabling `useBrowserCache` once we're confident no stale entries remain (the HTTP cache layer still de-duplicates the ~80MB MiniLM weights, so this is a perf optimization, not a correctness gap).
- Calendar / past-event RAG indexing (separate FEAT — `info_lookup` works, but the index doesn't currently include calendar events).
- The `Unexpected text node: . A text node cannot be a child of a <View>` warning in chat.tsx (separate cosmetic FEAT).

## Verification

After the fix, with a real chat phrase:

```
[router] route phrase=… skill=info_lookup confidence=0.14 method=haiku
         candidates=[priority_planning:0.14,info_lookup:0.13,general_assistant:0.11]
[skillDispatcher] retrieved=5 topScore=0.56 skill=info_lookup
[skillDispatcher] dispatch phrase=… skill=info_lookup tool=submit_info_lookup
```

Embedding-based routing fires and RAG retrieval returns real results, where before every phrase logged `phrase embedder unavailable: Unexpected token '<'` and routed to `general_assistant`.
