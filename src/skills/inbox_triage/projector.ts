/**
 * FEAT071 — RAG projector for `contextMemory.facts`.
 *
 * Lives next to `inbox_triage` because that skill's manifest is the
 * canonical writer for `contextMemory` (per `dataSchemas.write`). Other
 * skills may also write here; the registry's first-wins rule keeps
 * registration deterministic.
 *
 * Facts in `ContextMemory.facts` are typed as `(string | Fact)[]` and
 * the older entries don't carry stable IDs. The previous backfill used
 * a positional sourceId (`<topic>:<index>`) which shifted whenever the
 * array was edited and produced index churn in the vector store. This
 * projector switches to a content-derived sourceId via FNV-1a so the
 * same fact text always upserts to the same chunk regardless of array
 * position. One-time consequence on rollout: existing chunks indexed
 * under the positional scheme become orphans (still in the store, but
 * no longer matched on backfill); the next time the user clears the
 * cache or `MODEL_ID` flips, the index is rebuilt cleanly.
 */

import type { RagProjector } from "../../types/rag";
import type { AppState, Fact } from "../../types";
import { fnv1a64Hex } from "../../utils/fnv1a";

const MIN_TEXT_CHARS = 5;

type FactItem = string | Fact;

export const projector: RagProjector<FactItem> = {
  schema: "contextMemory",
  source: "contextMemory",
  iterate: (state) => {
    const s = state as AppState | null;
    return s?.contextMemory?.facts ?? [];
  },
  project: (fact) => {
    const text = typeof fact === "string" ? fact : fact?.text ?? "";
    const topic = typeof fact === "string" ? null : fact?.topic ?? null;
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT_CHARS) return null;
    const composed = [trimmed, topic].filter(Boolean).join(" ");
    return {
      sourceId: fnv1a64Hex(composed),
      text: composed,
      metadata: topic ? { topic } : undefined,
    };
  },
};
