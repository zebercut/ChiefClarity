import { nowLocalIso } from "../utils/dates";

/**
 * notesStore — pure state operations for the Notes tab (FEAT026).
 *
 * No I/O. All functions operate on `state.notes` and mark `state._dirty`
 * so that the next `flush(state)` persists the change via the encrypted
 * filesystem layer.
 *
 * Status machine (see FEAT026 spec):
 *   pending -> processing -> processed (terminal)
 *   pending -> processing -> failed     (retryable until MAX_ATTEMPTS)
 *   failed  -> processing -> processed | failed
 *   failed  -> pending     (via editNote or retryNote)
 *   processing -> pending  (via recoverStaleProcessing on load — crash recovery)
 */

import type { AppState, Note, NoteStatus } from "../types";

export const MAX_ATTEMPTS = 5;

// ─── ID generation (matches annotations.ts pattern) ────────────────────────

function generateNoteId(): string {
  return (
    "note_" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

// ─── Add ───────────────────────────────────────────────────────────────────

export function addNote(state: AppState, text: string): Note {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot add an empty note");
  }
  const note: Note = {
    id: generateNoteId(),
    text: trimmed,
    createdAt: nowLocalIso(),
    status: "pending",
    processedAt: null,
    writeCount: 0,
    processedSummary: null,
    attemptCount: 0,
    lastError: null,
  };
  state.notes.notes.push(note);
  state._dirty.add("notes");
  return note;
}

// ─── Edit ──────────────────────────────────────────────────────────────────

export function editNote(state: AppState, id: string, newText: string): Note {
  const note = findNote(state, id);
  if (note.status === "processing") {
    throw new Error("Cannot edit a note that is currently processing");
  }
  if (note.status === "processed") {
    throw new Error("Cannot edit a note that has already been processed");
  }
  const trimmed = newText.trim();
  if (!trimmed) {
    throw new Error("Cannot save an empty note");
  }
  note.text = trimmed;
  // If editing a failed note, reset retry budget — user is saying "try this version"
  if (note.status === "failed") {
    note.attemptCount = 0;
    note.lastError = null;
  }
  state._dirty.add("notes");
  return note;
}

// ─── Delete ────────────────────────────────────────────────────────────────

export function deleteNote(state: AppState, id: string): void {
  const note = findNote(state, id);
  if (note.status === "processing") {
    throw new Error("Cannot delete a note that is currently processing");
  }
  state.notes.notes = state.notes.notes.filter((n) => n.id !== id);
  state._dirty.add("notes");
}

// ─── Retry (manual, e.g. after MAX_ATTEMPTS reached) ──────────────────────

export function retryNote(state: AppState, id: string): Note {
  const note = findNote(state, id);
  if (note.status !== "failed") {
    throw new Error(`Can only retry failed notes (status: ${note.status})`);
  }
  note.status = "pending";
  note.attemptCount = 0;
  note.lastError = null;
  state._dirty.add("notes");
  return note;
}

// ─── Status transitions (called by notesProcessor) ─────────────────────────

export function markProcessing(state: AppState, ids: string[]): void {
  const idSet = new Set(ids);
  for (const note of state.notes.notes) {
    if (idSet.has(note.id)) {
      note.status = "processing";
    }
  }
  state._dirty.add("notes");
}

/**
 * Mark a single note as processed with its own write count and human-readable
 * summary of what was done with it.
 */
export function markProcessed(
  state: AppState,
  id: string,
  writeCount: number,
  summary: string
): void {
  const note = findNote(state, id);
  note.status = "processed";
  note.processedAt = nowLocalIso();
  note.writeCount = writeCount;
  note.processedSummary = summary || null;
  note.lastError = null;
  state._dirty.add("notes");
}

export function markFailed(
  state: AppState,
  id: string,
  errorMessage: string
): void {
  const note = findNote(state, id);
  note.status = "failed";
  note.attemptCount += 1;
  note.lastError = errorMessage;
  state._dirty.add("notes");
}

// ─── Selection ─────────────────────────────────────────────────────────────

/**
 * Returns notes eligible for the next batch run:
 *   - all `pending` notes
 *   - all `failed` notes whose attemptCount < MAX_ATTEMPTS
 *
 * Sorted by createdAt ascending (oldest first) so the bundle reflects
 * the order the user actually captured them.
 */
export function getProcessableNotes(state: AppState): Note[] {
  return state.notes.notes
    .filter(
      (n) =>
        n.status === "pending" ||
        (n.status === "failed" && n.attemptCount < MAX_ATTEMPTS)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Recover stale `processing` notes after an unclean shutdown.
 * Called by loader.ts on startup. Returns the number of notes recovered.
 *
 * IMPORTANT: does NOT increment attemptCount — we don't know if the LLM call
 * actually completed, and penalizing crashes would burn the retry budget.
 */
export function recoverStaleProcessing(state: AppState): number {
  let recovered = 0;
  for (const note of state.notes.notes) {
    if (note.status === "processing") {
      note.status = "pending";
      recovered++;
    }
  }
  if (recovered > 0) {
    state._dirty.add("notes");
  }
  return recovered;
}

// ─── Search ────────────────────────────────────────────────────────────────

/**
 * Pure client-side search. Filters by case-insensitive substring on `text`,
 * with an optional status filter. Empty query returns all notes (subject to
 * the status filter).
 */
export function searchNotes(
  state: AppState,
  query: string,
  statusFilter?: NoteStatus | "all"
): Note[] {
  const q = query.trim().toLowerCase();
  return state.notes.notes.filter((n) => {
    if (statusFilter && statusFilter !== "all" && n.status !== statusFilter) {
      return false;
    }
    if (q && !n.text.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

// ─── Internal ──────────────────────────────────────────────────────────────

function findNote(state: AppState, id: string): Note {
  const note = state.notes.notes.find((n) => n.id === id);
  if (!note) {
    throw new Error(`Note not found: ${id}`);
  }
  return note;
}
