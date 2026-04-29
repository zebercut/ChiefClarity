/**
 * FEAT071 — RAG write hook.
 *
 * Fires from `executor.applyWrites` after each add/update/delete so the
 * vector index stays live without waiting for the next backfill. Looks
 * up the projector keyed by the file being written and calls the
 * indexer / deindexer.
 *
 * Fire-and-forget: never throws and never blocks the executor's write
 * path. Embedding cost (~50ms cached pipeline) is irrelevant compared
 * to the LLM call that produced the write, so we don't bother batching.
 */

import { getProjector } from "./projectorRegistry";
import { indexEntity, deindexEntity } from "./indexer";

export type RagWriteAction = "add" | "update" | "delete";

/**
 * Fire the RAG hook for a single write. Caller does not await — this
 * function intentionally swallows errors so executor write integrity is
 * never blocked by RAG indexing.
 */
export async function fireRagWriteHook(
  action: RagWriteAction,
  fileKey: string,
  item: unknown,
  id: string
): Promise<void> {
  const projector = getProjector(fileKey);
  if (!projector) return;

  try {
    if (action === "delete") {
      // The projector's source identifies the chunk family; the id is the
      // schema's primary key (tasks, calendar, notes — all have stable
      // ids). For schemas without stable ids (e.g. contextMemory), delete
      // is a no-op — the orphaned chunk falls out on the next full
      // backfill / model rotation.
      if (id) {
        await deindexEntity(projector.source, id);
      }
      return;
    }

    // add | update — project the item and upsert. chunkId is deterministic
    // from (source, sourceId), so an update lands on the same chunk and
    // edits its embedding in place.
    const projected = projector.project(item);
    if (!projected) return;
    if (!projected.text || projected.text.trim().length < 5) return;
    if (!projected.sourceId) return;

    await indexEntity({
      source: projector.source,
      sourceId: projected.sourceId,
      text: projected.text,
      metadata: projected.metadata,
    });
  } catch (err: any) {
    console.warn(
      `[rag-writeHook] ${action} failed for ${fileKey}/${id || "?"}: ${err?.message ?? err}`
    );
  }
}
