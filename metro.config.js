const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// FEAT041/042: Exclude Node-only modules from the web bundle.
// On web, the api-proxy handles all DB + embedding operations.
// On Capacitor (future), these will be unblocked with platform-specific adapters.
config.resolver.blockList = [
  ...(config.resolver.blockList ? [config.resolver.blockList] : []),
  /src[/\\]db[/\\].*/,
  /src[/\\]modules[/\\]embeddings[/\\].*/,
  /node_modules[/\\]@libsql[/\\].*/,
  /node_modules[/\\]googleapis[/\\].*/,
  /node_modules[/\\]@xenova[/\\].*/,
  /node_modules[/\\]onnxruntime[/\\].*/,
];

module.exports = config;
