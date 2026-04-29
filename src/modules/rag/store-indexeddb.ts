/**
 * FEAT068 — IndexedDB VectorStore backend (web + Capacitor).
 *
 * Uses `idb` (~3KB) for ergonomics. All records load into memory once on
 * first search; subsequent searches brute-force cosine in JS (acceptable
 * up to ~10K vectors on personal-corpus scale per FEAT068 design review §3.4).
 *
 * IndexedDB-unavailable degraded path: if `indexedDB.open` throws (private
 * browsing, quota disabled), the store falls back to an in-memory Map for
 * the session and emits a single WARN. Knowledge does not persist across
 * reload in that mode (acceptable per FEAT068 cond. 11).
 */

import { openDB, type IDBPDatabase } from "idb";
import {
  cosineSimilarity,
  type VectorStore,
} from "./store";
import type {
  ChunkSource,
  RetrievalResult,
  SearchFilter,
  VectorRecord,
} from "../../types/rag";

const DB_NAME = "lifeos_vectors";
const STORE_NAME = "chunks";
const DB_VERSION = 1;

interface StoredRecord extends VectorRecord {
  // IndexedDB stores arrays directly (Float32Array is structured-clonable
  // but plain number[] avoids serializer surprises across browsers).
  embedding: number[];
}

let _warnedIdbUnavailable = false;

export class IndexedDbVectorStore implements VectorStore {
  private db: IDBPDatabase | null = null;
  private memory: Map<string, StoredRecord> | null = null;
  private cacheLoaded = false;
  private cache: StoredRecord[] = [];

  async init(): Promise<void> {
    if (this.db || this.memory) return;
    try {
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            const os = database.createObjectStore(STORE_NAME, {
              keyPath: "chunkId",
            });
            os.createIndex("source", "source", { unique: false });
            os.createIndex("sourceId", "sourceId", { unique: false });
            os.createIndex("modelId", "modelId", { unique: false });
          }
        },
      });
    } catch (err: any) {
      if (!_warnedIdbUnavailable) {
        _warnedIdbUnavailable = true;
        console.warn(
          "[rag] IndexedDB unavailable, running with in-memory only — " +
          "knowledge will not persist across reloads. " +
          `(err: ${err?.message ?? err})`
        );
      }
      this.memory = new Map();
    }
  }

  async upsert(r: VectorRecord): Promise<void> {
    await this.init();
    const stored: StoredRecord = {
      ...r,
      embedding: Array.from(r.embedding),
    };
    if (this.db) {
      await this.db.put(STORE_NAME, stored);
    } else if (this.memory) {
      this.memory.set(r.chunkId, stored);
    }
    // Update cache if loaded
    if (this.cacheLoaded) {
      const idx = this.cache.findIndex((c) => c.chunkId === r.chunkId);
      if (idx >= 0) this.cache[idx] = stored;
      else this.cache.push(stored);
    }
  }

  async upsertBatch(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.init();
    if (this.db) {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      for (const r of records) {
        await tx.store.put({ ...r, embedding: Array.from(r.embedding) });
      }
      await tx.done;
    } else if (this.memory) {
      for (const r of records) {
        this.memory.set(r.chunkId, { ...r, embedding: Array.from(r.embedding) });
      }
    }
    // Invalidate cache; next search reloads.
    this.cacheLoaded = false;
  }

  async delete(chunkId: string): Promise<void> {
    await this.init();
    if (this.db) {
      await this.db.delete(STORE_NAME, chunkId);
    } else if (this.memory) {
      this.memory.delete(chunkId);
    }
    if (this.cacheLoaded) {
      this.cache = this.cache.filter((c) => c.chunkId !== chunkId);
    }
  }

  async deleteBySource(source: ChunkSource, sourceId: string): Promise<void> {
    await this.init();
    if (this.db) {
      const tx = this.db.transaction(STORE_NAME, "readwrite");
      const all = await tx.store.getAll();
      for (const r of all) {
        const rec = r as StoredRecord;
        if (rec.source === source && rec.sourceId === sourceId) {
          await tx.store.delete(rec.chunkId);
        }
      }
      await tx.done;
    } else if (this.memory) {
      for (const [k, v] of this.memory) {
        if (v.source === source && v.sourceId === sourceId) {
          this.memory.delete(k);
        }
      }
    }
    this.cacheLoaded = false;
  }

  async search(
    queryEmbedding: number[] | Float32Array,
    k: number,
    filter?: SearchFilter
  ): Promise<RetrievalResult[]> {
    await this.init();
    await this.loadCache();

    const minScore = filter?.minScore ?? 0;
    const sources = filter?.sources ? new Set(filter.sources) : null;

    const scored: Array<{ rec: StoredRecord; score: number }> = [];
    for (const rec of this.cache) {
      if (sources && !sources.has(rec.source)) continue;
      const score = cosineSimilarity(queryEmbedding, rec.embedding);
      if (score < minScore) continue;
      scored.push({ rec, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ rec, score }) => ({
      chunkId: rec.chunkId,
      source: rec.source,
      sourceId: rec.sourceId,
      text: rec.text,
      score,
      metadata: rec.metadata,
    }));
  }

  async deleteAll(): Promise<void> {
    await this.init();
    if (this.db) {
      await this.db.clear(STORE_NAME);
    } else if (this.memory) {
      this.memory.clear();
    }
    this.cache = [];
    this.cacheLoaded = true;
  }

  async count(filter?: SearchFilter): Promise<number> {
    await this.init();
    await this.loadCache();
    const sources = filter?.sources ? new Set(filter.sources) : null;
    if (!sources) return this.cache.length;
    return this.cache.filter((r) => sources.has(r.source)).length;
  }

  async countMismatched(currentModelId: string): Promise<number> {
    await this.init();
    await this.loadCache();
    return this.cache.filter((r) => r.modelId !== currentModelId).length;
  }

  async getAllIds(): Promise<string[]> {
    await this.init();
    await this.loadCache();
    return this.cache.map((r) => r.chunkId);
  }

  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;
    if (this.db) {
      const all = await this.db.getAll(STORE_NAME);
      this.cache = all as StoredRecord[];
    } else if (this.memory) {
      this.cache = Array.from(this.memory.values());
    } else {
      this.cache = [];
    }
    this.cacheLoaded = true;
  }
}
