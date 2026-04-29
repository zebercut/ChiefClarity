/**
 * FEAT071 — RAG projector for `notes_capture`.
 *
 * Walks `state.notes.notes[]` and emits one chunk per note. Notes have a
 * stable `id`, so `sourceId` is the note id and edits upsert in place.
 *
 * The skill registry registers this projector at boot. Backfill iterates
 * it; the executor write hook re-projects on every add/update/delete.
 */

import type { RagProjector } from "../../types/rag";
import type { AppState, Note } from "../../types";

const MIN_TEXT_CHARS = 5;

export const projector: RagProjector<Note> = {
  schema: "notes",
  source: "note",
  iterate: (state) => {
    const s = state as AppState | null;
    return s?.notes?.notes ?? [];
  },
  project: (note) => {
    const text = (note?.text ?? "").trim();
    if (text.length < MIN_TEXT_CHARS) return null;
    if (!note.id) return null;
    return {
      sourceId: String(note.id),
      text,
    };
  },
};
