/**
 * FEAT042 — Local embedding provider.
 * FEAT067 — Now isomorphic: works in both Node and the web bundle.
 *
 * Wraps @xenova/transformers to run all-MiniLM-L6-v2 (384-dim). The xenova
 * package's `browser` field substitutes `onnxruntime-node` → `onnxruntime-web`
 * automatically; the same source compiles in both runtimes.
 *
 * Privacy: only model WEIGHTS travel between the device and the CDN
 * (huggingface.co), and only on first use per device (xenova caches in
 * IndexedDB on browsers and on disk on Node). User phrases NEVER leave
 * the device — embedding happens locally in WASM.
 */

let _pipe: any = null;
let _loading: Promise<any> | null = null;

/**
 * Model identity surface for index-side cache invalidation (FEAT068 RAG).
 * If this constant changes, downstream indexes must be rebuilt.
 */
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2" as const;

async function getPipeline(): Promise<any> {
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  _loading = (async () => {
    const xenova: any = await import("@xenova/transformers");
    const env = xenova.env ?? xenova.default?.env;

    // FEAT070: configure xenova for the SPA-hosted web bundle.
    // - allowLocalModels=false: the SPA host (Metro / Capacitor WKWebView)
    //   serves index.html with HTTP 200 for unknown paths, including
    //   `/models/...`. Without this flag, xenova fetches the local path
    //   first, JSON.parse(HTML) throws, and the remote fallback is never
    //   reached.
    // - useBrowserCache=false: previous runs poisoned the
    //   `transformers-cache` Cache Storage with HTML 404 responses keyed
    //   by the local path. xenova's tryCache() reads localPath BEFORE
    //   the allowLocalModels gate, so even after flipping the flag the
    //   stale cache entries kept short-circuiting the fetch. Bypassing
    //   the cache forces a clean network fetch every time. The browser's
    //   HTTP cache layer still de-duplicates the ~80MB MiniLM weights
    //   across reloads, so we don't pay the full download repeatedly.
    const g = globalThis as any;
    if (typeof g.window !== "undefined" && env) {
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
    }

    // Wipe the poisoned cache once per page load. Idempotent and cheap
    // when the cache is already clean. Safe in Node (caches is undefined
    // there — Node falls through env.useBrowserCache anyway).
    if (typeof g.caches !== "undefined") {
      try {
        await g.caches.delete("transformers-cache");
      } catch {
        // ignore — cache may not exist or origin may forbid access
      }
    }

    _pipe = await xenova.pipeline("feature-extraction", MODEL_ID);
    _loading = null;
    return _pipe;
  })();
  return _loading;
}

/**
 * Embed a text string → 384-dim Float32Array.
 * First call downloads the model (~80MB, cached afterward in IndexedDB on
 * browsers / on disk on Node).
 */
export async function embed(text: string): Promise<Float32Array | null> {
  if (!text || text.length < 2) {
    return null;
  }
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(result.data);
}

/**
 * Embed multiple texts sequentially (avoids memory pressure).
 */
export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  const results: (Float32Array | null)[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

/** Check if the model is loaded (for status reporting / FEAT068 readiness UI). */
export function isModelLoaded(): boolean {
  return _pipe !== null;
}
