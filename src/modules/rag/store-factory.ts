/**
 * FEAT068 — VectorStore factory.
 *
 * Returns the right backend per platform:
 *   - Node                  → LibsqlVectorStore
 *   - web / Capacitor       → IndexedDbVectorStore
 *
 * Metro static analysis: store-libsql.ts imports `db/queries/*` (Node-only)
 * and is on metro.config.js's blockList. To prevent Metro from trying to
 * resolve it on web, we use `eval("require")` for the libSQL backend so
 * the module path is opaque at bundle time. The IndexedDB backend is
 * imported via the standard ESM `await import()` — it ships in the web
 * bundle and is loaded lazily on first call.
 */

import { isNode } from "../../utils/platform";
import type { VectorStore } from "./store";

let _instance: VectorStore | null = null;

export async function getDefaultVectorStore(): Promise<VectorStore> {
  if (_instance) return _instance;
  let created: VectorStore;
  if (isNode()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dynRequire: NodeRequire = eval("require");
    const mod = dynRequire("./store-libsql");
    created = new mod.LibsqlVectorStore();
  } else {
    const { IndexedDbVectorStore } = await import("./store-indexeddb");
    created = new IndexedDbVectorStore();
  }
  _instance = created;
  return created;
}

/** Test-only override. Tests pass a stub VectorStore directly. */
export function _setDefaultVectorStoreForTests(store: VectorStore | null): void {
  _instance = store;
}
