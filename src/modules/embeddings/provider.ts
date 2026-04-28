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
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", MODEL_ID);
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
