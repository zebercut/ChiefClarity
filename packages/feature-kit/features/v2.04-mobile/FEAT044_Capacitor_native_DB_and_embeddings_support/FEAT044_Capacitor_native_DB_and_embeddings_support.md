# FEAT044 — Capacitor native DB and embeddings support

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Platform
**Priority:** 2
**Release:** v4.1
**Tags:** capacitor, mobile, database, embeddings, sqlite
**Created:** 2026-04-10

**Depends on:** FEAT041 (libSQL DB), FEAT042 (Embeddings)

---

## Summary

Enable the libSQL database and embedding engine on Capacitor (mobile) so the app uses the same unified DB experience on all platforms. Currently the proxy/headless (Node) handle all DB + embedding work. Capacitor needs its own native SQLite driver so it can run independently without a proxy.

---

## What's already done

- `@capacitor-community/sqlite` is installed in `package.json`
- `src/db/adapter.ts` exists with a platform-aware `createPlatformClient()` that detects Capacitor at runtime and routes to either `@libsql/client` (Node) or `@capacitor-community/sqlite` (mobile)
- The Capacitor adapter uses `CapacitorSQLite.createConnection()` with `encrypted: true` for SQLCipher
- The same SQL schema, query modules, and embeddings modules work on both platforms

## What's left

### Problem: Metro blockList

Metro's `blockList` applies to ALL platform builds (web + mobile). We block `src/db/`, `src/modules/embeddings/`, `@libsql/client` to prevent them from entering the web bundle. But on Capacitor, we NEED `src/db/` and `src/modules/embeddings/`.

### Recommended solution: Platform-specific file extensions

- Create `src/db/adapter.web.ts` — no-op (throws "use proxy on web")
- Create `src/db/adapter.native.ts` — uses `@capacitor-community/sqlite`
- Keep `src/db/adapter.ts` — uses `@libsql/client` (Node, proxy/headless only)
- Metro resolves `.web.ts` for web, `.native.ts` for iOS/Android
- Remove `src/db/` and `src/modules/embeddings/` from blockList; only block `@libsql/client` for web via the `.web.ts` no-op

### Work packages

| WP | Description |
|---|---|
| 1 | Split `src/db/adapter.ts` into `.web.ts` / `.native.ts` / base `.ts` |
| 2 | Remove `src/db/` and `src/modules/embeddings/` from Metro blockList |
| 3 | Re-add `tryOpenDatabase()` to `_layout.tsx` with Capacitor detection |
| 4 | Test on Android emulator: DB opens, data loads, embeddings generate |
| 5 | Test `npx cap sync android` + APK build |

### Embedding model on mobile

`@xenova/transformers` works via WASM in WebView:
- ~80MB model download on first launch (cached afterward)
- ~30-50ms per embedding (vs ~10ms on Node)
- Background indexing ~300 items: ~15-20s (one-time)
- Acceptable for personal-app scale

---

## Testing Notes

- [ ] Android emulator: DB opens with passphrase, smoke test passes
- [ ] Create task via chat on mobile → persists in DB → survives app restart
- [ ] Background indexer runs on mobile startup
- [ ] Semantic search works on mobile
- [ ] Web mode is unaffected (proxy still handles everything)
