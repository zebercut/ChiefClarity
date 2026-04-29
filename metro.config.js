const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// FEAT070: Alias @xenova/transformers to its prebundled dist file. The
// package's `main` points at src/transformers.js (ESM source) which uses
// `import.meta.url` in env.js. Metro treats packages as CJS and emits the
// runtime error "Cannot use 'import.meta' outside a module" on the web
// bundle. The prebundled dist/transformers.js is an IIFE that has already
// resolved import.meta at build time, so it works under Metro.
const xenovaDist = path.resolve(
  __dirname,
  "node_modules/@xenova/transformers/dist/transformers.js"
);
const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@xenova/transformers") {
    return { type: "sourceFile", filePath: xenovaDist };
  }
  if (prevResolveRequest) {
    return prevResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

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
