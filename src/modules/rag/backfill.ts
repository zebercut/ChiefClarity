/**
 * FEAT068 — RAG backfill walker.
 * FEAT071 — Backfill is now projector-driven. Each skill that owns a
 * write schema and wants its data discoverable through `info_lookup`
 * ships a `projector.ts` next to its manifest; the skill registry
 * registers projectors at boot; this walker iterates the registry
 * rather than carrying hardcoded knowledge of `state.notes` /
 * `state.contextMemory`.
 *
 * Non-blocking:
 *   web      — `requestIdleCallback` chunks; `setTimeout(0)` fallback
 *              for Safari. 5–10 chunks per tick.
 *   Node     — synchronous-ish loop yielded with setImmediate; the
 *              FEAT042 background indexer keeps using its file lock
 *              for legacy callers (unchanged).
 *
 * Triggered:
 *   - On boot if the vector store is empty for the current MODEL_ID.
 *   - On MODEL_ID change (the boot guard clears + rebuilds).
 *   - Manually via `triggerBackfill` for dev/debug.
 */

import { MODEL_ID } from "../embeddings/provider";
import { indexEntity } from "./indexer";
import { getDefaultVectorStore } from "./store-factory";
import { getAllProjectors } from "./projectorRegistry";
import type { VectorStore } from "./store";
import type { AppState } from "../../types";
import type { RagBackfillStatus, ChunkSource } from "../../types/rag";

const CHUNKS_PER_TICK = 8;

let _status: RagBackfillStatus = {
  state: "idle",
  processed: 0,
  total: 0,
};

export function getRagBackfillStatus(): RagBackfillStatus {
  return { ..._status };
}

/** Test-only state reset. */
export function _resetBackfillStatusForTests(): void {
  _status = { state: "idle", processed: 0, total: 0 };
}

interface QueueEntry {
  source: ChunkSource;
  sourceId: string;
  text: string;
}

function buildQueueFromState(state: AppState): QueueEntry[] {
  // FEAT071 — projector-driven. Each skill that wants its data searchable
  // ships a projector; backfill iterates the registry. New data sources
  // plug in by adding a `projector.ts` next to a skill manifest, with no
  // edits required to this file.
  const queue: QueueEntry[] = [];
  for (const projector of getAllProjectors()) {
    let items: Iterable<unknown>;
    try {
      items = projector.iterate(state) ?? [];
    } catch (err: any) {
      console.warn(
        `[rag-backfill] projector.iterate failed for schema "${projector.schema}": ${err?.message ?? err}`
      );
      continue;
    }
    for (const item of items) {
      let projected;
      try {
        projected = projector.project(item);
      } catch (err: any) {
        console.warn(
          `[rag-backfill] projector.project failed for schema "${projector.schema}": ${err?.message ?? err}`
        );
        continue;
      }
      if (!projected) continue;
      if (!projected.text || projected.text.trim().length < 5) continue;
      if (!projected.sourceId) continue;
      queue.push({
        source: projector.source,
        sourceId: projected.sourceId,
        text: projected.text,
      });
    }
  }
  return queue;
}

/**
 * Schedule the next chunk slice. Uses requestIdleCallback when present,
 * setTimeout(0) on Safari / Node.
 */
function schedule(fn: () => void): void {
  const g = globalThis as any;
  if (typeof g.requestIdleCallback === "function") {
    g.requestIdleCallback(fn);
  } else {
    setTimeout(fn, 0);
  }
}

/**
 * Run the backfill against the given AppState. Resolves when all entries
 * have been visited (each one either indexed or skipped because it was
 * already present for the current MODEL_ID). Failures are logged and
 * accounted into `processed` so the status reaches `done`.
 */
export async function runBackfill(
  state: AppState,
  store?: VectorStore
): Promise<RagBackfillStatus> {
  const s = store ?? (await getDefaultVectorStore());
  if (_status.state === "running") return _status;

  // Cache invalidation: drop everything if any chunk has a stale modelId.
  try {
    const mismatched = await s.countMismatched(MODEL_ID);
    if (mismatched > 0) {
      console.log(
        `[rag] model changed, rebuilding index — ${mismatched} chunk(s) had a non-matching modelId`
      );
      await s.deleteAll();
    }
  } catch (err: any) {
    console.warn(`[rag-backfill] modelId check failed: ${err?.message ?? err}`);
  }

  const queue = buildQueueFromState(state);
  if (queue.length === 0) {
    _status = {
      state: "done",
      processed: 0,
      total: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    return _status;
  }

  // Skip entries already present in the store with matching modelId.
  let existingIds: Set<string>;
  try {
    existingIds = new Set(await s.getAllIds());
  } catch {
    existingIds = new Set();
  }
  const todo = queue.filter((q) => !existingIds.has(`${q.source}:${q.sourceId}`));

  _status = {
    state: "running",
    processed: 0,
    total: todo.length,
    startedAt: new Date().toISOString(),
  };

  return new Promise<RagBackfillStatus>((resolve) => {
    let i = 0;
    const tick = async (): Promise<void> => {
      const end = Math.min(i + CHUNKS_PER_TICK, todo.length);
      for (; i < end; i++) {
        const entry = todo[i];
        try {
          await indexEntity(
            { source: entry.source, sourceId: entry.sourceId, text: entry.text },
            s
          );
        } catch (err: any) {
          console.warn(
            `[rag-backfill] index failed for ${entry.source}/${entry.sourceId}: ${err?.message ?? err}`
          );
        }
        _status = { ..._status, processed: _status.processed + 1 };
      }
      if (i < todo.length) {
        schedule(() => {
          tick();
        });
      } else {
        _status = {
          ..._status,
          state: "done",
          finishedAt: new Date().toISOString(),
        };
        resolve(_status);
      }
    };
    schedule(() => {
      tick();
    });
  });
}

/**
 * Dev/debug entry point. Runs the backfill against the current AppState
 * loaded by the app shell; intended to be called from the browser
 * console (`window.lifeosTriggerBackfill = triggerBackfill`).
 */
export async function triggerBackfill(state: AppState): Promise<RagBackfillStatus> {
  return runBackfill(state);
}
