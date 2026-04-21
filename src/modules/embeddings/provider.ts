/**
 * FEAT042 — Local embedding provider.
 *
 * Wraps @xenova/transformers to run all-MiniLM-L6-v2 locally (384-dim).
 * Node-only — Metro blockList prevents this from entering the web bundle.
 */

let _pipe: any = null;
let _loading: Promise<any> | null = null;

async function getPipeline(): Promise<any> {
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  _loading = (async () => {
    const { pipeline } = await import("@xenova/transformers");
    _pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    _loading = null;
    return _pipe;
  })();
  return _loading;
}

/**
 * Embed a text string → 384-dim Float32Array.
 * First call downloads the model (~80MB, cached afterward).
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

/** Check if the model is loaded (for status reporting). */
export function isModelLoaded(): boolean {
  return _pipe !== null;
}
