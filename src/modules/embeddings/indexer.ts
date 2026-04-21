/**
 * FEAT042 — Entity indexer.
 *
 * Hooks into the executor's write flow to embed entities on add/update/delete.
 * Node-only — blocked from web bundle by metro.config.js.
 */
import { embed } from "./provider";
import { upsertEmbedding, deleteEmbedding } from "../../db/queries/embeddings";

/** Extract embeddable text from an entity by its source type. */
function extractText(
  sourceType: string,
  data: Record<string, unknown>
): string {
  switch (sourceType) {
    case "task":
      return [data.title, data.notes, data.category, data.subcategory]
        .filter(Boolean)
        .join(" ");
    case "event":
      return [data.title, data.notes, data.type].filter(Boolean).join(" ");
    case "note":
      return (data.text as string) || "";
    case "fact":
      return [data.text, data.topic].filter(Boolean).join(" ");
    case "observation":
      return (data.observation as string) || (data.pattern as string) || "";
    case "chat":
      return (data.content as string) || "";
    default:
      return String(data.title || data.text || data.name || "").slice(0, 500);
  }
}

/** Index a single entity. Returns the vector (for reuse by the linker) or null. */
export async function indexEntity(
  sourceType: string,
  sourceId: string,
  data: Record<string, unknown>
): Promise<Float32Array | null> {
  const text = extractText(sourceType, data);
  if (!text || text.length < 5) return null;
  try {
    const vector = await embed(text);
    if (!vector) return null;
    // Validate: skip if vector contains NaN/Inf
    if (vector.some((v) => !Number.isFinite(v))) {
      console.warn(`[indexer] bad vector for ${sourceType}/${sourceId}, skipping`);
      return null;
    }
    await upsertEmbedding(sourceType, sourceId, vector);
    return vector;
  } catch (err: any) {
    // Non-fatal: the relational write already committed
    console.warn(
      `[indexer] embed failed for ${sourceType}/${sourceId}:`,
      err?.message
    );
    return null;
  }
}

/** Remove an entity's embedding. Call after applyDelete. */
export async function deindexEntity(
  sourceType: string,
  sourceId: string
): Promise<void> {
  try {
    await deleteEmbedding(sourceType, sourceId);
  } catch (err: any) {
    console.warn(
      `[indexer] delete failed for ${sourceType}/${sourceId}:`,
      err?.message
    );
  }
}

/** Map executor FileKey to the indexer's source type. */
export function fileKeyToSourceType(
  fileKey: string
): string | null {
  const map: Record<string, string> = {
    tasks: "task",
    calendar: "event",
    notes: "note",
    contextMemory: "fact",
    userObservations: "observation",
  };
  return map[fileKey] || null;
}
