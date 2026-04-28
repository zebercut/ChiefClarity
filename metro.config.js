const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// FEAT041/042: Exclude Node-only modules from the web bundle.
// On web, the api-proxy handles all DB operations.
// On Capacitor (future), these will be unblocked with platform-specific adapters.
//
// FEAT067: Selectively unblock the embeddings provider so query-side embedding
// works on web. The xenova/transformers package auto-detects browser vs Node
// via its `browser` package.json field (substituting onnxruntime-node →
// onnxruntime-web at bundle time). Only `provider.ts` is allowed through —
// indexer/retriever/linker/background-indexer all import db/queries/* which
// is Node-only, so they stay blocked.
config.resolver.blockList = [
  ...(config.resolver.blockList ? [config.resolver.blockList] : []),
  /src[/\\]db[/\\].*/,
  /src[/\\]modules[/\\]embeddings[/\\](indexer|retriever|linker|background-indexer)\.ts$/,
  // FEAT068 — LibsqlVectorStore imports db/queries/* (Node-only).
  // Factory lazy-imports it only when isNode(); blocking here keeps the
  // web bundle from pulling libSQL transitively. The IndexedDB backend
  // (store-indexeddb.ts) is the web/Capacitor path.
  /src[/\\]modules[/\\]rag[/\\]store-libsql\.ts$/,
  /node_modules[/\\]@libsql[/\\].*/,
  /node_modules[/\\]googleapis[/\\].*/,
];

module.exports = config;
