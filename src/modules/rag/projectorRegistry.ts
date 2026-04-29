/**
 * FEAT071 — RAG projector registry.
 *
 * Module-scoped map of `schema → RagProjector`. Skills that own a write
 * schema register their projector at boot (via `skillRegistry`); backfill
 * iterates the registry to build its queue; the executor write hook
 * looks up the projector keyed by the file being written.
 *
 * One projector per schema. Collisions log a warning and keep the first
 * registration so behavior is deterministic and debuggable. Tests reset
 * the registry via `_resetForTests`.
 */

import type { RagProjector } from "../../types/rag";

const _registry = new Map<string, RagProjector>();

export function registerProjector(projector: RagProjector): void {
  const existing = _registry.get(projector.schema);
  if (existing) {
    if (existing === projector) return;
    console.warn(
      `[projectorRegistry] duplicate projector for schema "${projector.schema}" ` +
      `(existing source="${existing.source}", new source="${projector.source}") — ` +
      `keeping the existing registration`
    );
    return;
  }
  _registry.set(projector.schema, projector);
}

export function getProjector(schema: string): RagProjector | null {
  return _registry.get(schema) ?? null;
}

export function getAllProjectors(): RagProjector[] {
  return Array.from(_registry.values());
}

/** Test-only: clear the registry between cases. */
export function _resetProjectorRegistryForTests(): void {
  _registry.clear();
}
