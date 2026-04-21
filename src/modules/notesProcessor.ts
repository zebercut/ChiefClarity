/**
 * notesProcessor — batch orchestrator for the Notes tab (FEAT026).
 *
 * Triggered by:
 *   - Manual "Process" button on the Notes tab
 *   - In-app 4h interval (while the app is open)
 *   - Headless runner light check (every 4h when the app is closed)
 *
 * Pipeline:
 *   1. Acquire in-process lock (no concurrent batches)
 *   2. Snapshot processable notes (pending ∪ failed-under-cap)
 *   3. Mark them all as `processing`, flush
 *   4. Group notes into chunks at NOTE BOUNDARIES (never splitting a single
 *      note across chunks). Each chunk's combined size stays under
 *      `SAFE_CHUNK_CHARS` so `processBundle` will only ever see one internal
 *      chunk — meaning chunk success/failure maps 1:1 to a known set of notes.
 *   5. For each chunk: bundle its notes with `[note <id> @ <ts>]` markers and
 *      send through `processBundle`. The `bulk_input` prompt instructs the LLM
 *      to tag each write with `sourceNoteId` so attribution is free.
 *   6. On chunk success: keep its writes for the per-note summary pass.
 *      On chunk failure: mark only that chunk's notes `failed` so the rest of
 *      the batch can still complete. (No more "marked processed but the LLM
 *      never saw it" — that was the bug in the previous bundled-everything
 *      design.)
 *   7. After all chunks complete, group writes by `sourceNoteId`, build a
 *      deterministic per-note summary with `summarizeWrites`, and mark each
 *      surviving note `processed` with its own writeCount + summary. Notes
 *      with no attributed writes still get marked processed with "no changes".
 *   8. Flush, release lock.
 *
 * Cost: same total LLM cost as the inbox path — one call per chunk, NOT one
 * per note. Most batches fit in a single chunk; large batches scale linearly
 * the same way the inbox path does.
 *
 * All file I/O goes through `flush(state)` which uses the encrypted
 * filesystem layer transparently.
 */

import type { AppState, Note, WriteOperation } from "../types";
import {
  getProcessableNotes,
  markProcessing,
  markProcessed,
  markFailed,
} from "./notesStore";
import { processBundle } from "./inbox";
import { flush } from "./executor";

/**
 * Build a deterministic per-action summary from the LLM's writes.
 * Used as a reliable fallback when the LLM's free-text reply is terse or
 * generic. Counts each write by file + action (e.g. "Created 2 tasks,
 * updated 1 event, noted 3 facts").
 *
 * Returns an empty string if there are no writes.
 */
export function summarizeWrites(writes: WriteOperation[]): string {
  if (writes.length === 0) return "";

  // Bucket: "file.action" -> count
  const buckets: Record<string, number> = {};
  for (const w of writes) {
    const key = `${w.file}.${w.action}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }

  // Map FileKey + action -> human label. Every entry must produce
  // user-friendly text — never leak the file key or "add/update/delete"
  // jargon into the UI (CLAUDE.md: no system jargon in user-visible text).
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const LABELS: Record<string, (n: number) => string> = {
    "tasks.add": (n) => `Created ${n} ${plural(n, "task", "tasks")}`,
    "tasks.update": (n) => `Updated ${n} ${plural(n, "task", "tasks")}`,
    "tasks.delete": (n) => `Deleted ${n} ${plural(n, "task", "tasks")}`,
    "calendar.add": (n) => `Added ${n} ${plural(n, "event", "events")}`,
    "calendar.update": (n) => `Updated ${n} ${plural(n, "event", "events")}`,
    "calendar.delete": (n) => `Deleted ${n} ${plural(n, "event", "events")}`,
    "contextMemory.add": (n) => `Noted ${n} ${plural(n, "fact", "facts")}`,
    "contextMemory.update": (n) => `Updated ${n} ${plural(n, "fact", "facts")}`,
    "contextMemory.delete": (n) => `Removed ${n} ${plural(n, "fact", "facts")}`,
    "userObservations.add": (n) => `Logged ${n} ${plural(n, "observation", "observations")}`,
    "userObservations.update": (n) => `Updated ${n} ${plural(n, "observation", "observations")}`,
    "planOkrDashboard.update": (n) => `Updated ${n} ${plural(n, "goal", "goals")}`,
    "planOkrDashboard.add": (n) => `Added ${n} ${plural(n, "goal", "goals")}`,
    "userProfile.update": () => `Updated your profile`,
    "userLifestyle.update": () => `Updated your lifestyle`,
    "topicManifest.add": (n) => `Added ${n} topic ${plural(n, "note", "notes")}`,
    "topicManifest.update": (n) => `Updated ${n} topic ${plural(n, "note", "notes")}`,
    "recurringTasks.add": (n) => `Added ${n} recurring ${plural(n, "task", "tasks")}`,
    "recurringTasks.update": (n) => `Updated ${n} recurring ${plural(n, "task", "tasks")}`,
    "recurringTasks.delete": (n) => `Removed ${n} recurring ${plural(n, "task", "tasks")}`,
    "feedbackMemory.add": (n) => `Saved ${n} ${plural(n, "preference", "preferences")}`,
    "feedbackMemory.update": (n) => `Updated ${n} ${plural(n, "preference", "preferences")}`,
    "learningLog.add": (n) => `Captured ${n} ${plural(n, "insight", "insights")}`,
    "suggestionsLog.add": (n) => `Saved ${n} ${plural(n, "suggestion", "suggestions")}`,
    "planNarrative.update": () => `Updated your plan`,
    "planAgenda.update": () => `Updated your agenda`,
    "planRisks.update": (n) => `Flagged ${n} ${plural(n, "risk", "risks")}`,
    "focusBrief.add": () => `Built your focus brief`,
    "focusBrief.update": () => `Updated your focus brief`,
  };

  const parts: string[] = [];
  for (const [key, count] of Object.entries(buckets)) {
    const label = LABELS[key];
    if (label) {
      parts.push(label(count));
    } else {
      // Unknown bucket — generic, jargon-free fallback. Never expose the
      // file key or action verb. If you see this in the UI, add a label above.
      console.warn(`[summarizeWrites] no label for bucket "${key}" — using generic fallback`);
      parts.push(`Updated ${count} ${plural(count, "item", "items")}`);
    }
  }

  return parts.join(", ") + ".";
}

// Conservative per-chunk char budget. `inbox.ts` uses MAX_CHUNK_TOKENS=2000
// (~6000 chars) before its internal chunker kicks in. We bundle notes ourselves
// and want to stay comfortably under that so processBundle never re-splits the
// payload — that re-split is what would break per-chunk attribution. Headroom
// covers the per-note `[note <id> @ <ts>]\n` marker overhead.
const SAFE_CHUNK_CHARS = 5000;

/**
 * Group notes into chunks at note boundaries. Guarantees:
 *  - A single note never appears in more than one chunk
 *  - Each chunk's combined bundled-text size is under SAFE_CHUNK_CHARS, EXCEPT
 *    when a single note already exceeds that budget, in which case it gets its
 *    own (oversized) chunk and processBundle's internal chunker may split it.
 *    That's strictly better than today's behavior — only that one note's
 *    attribution is at risk, not its neighbors'.
 */
export function chunkNotesForBatch(notes: Note[]): Note[][] {
  const chunks: Note[][] = [];
  let current: Note[] = [];
  let currentChars = 0;

  for (const note of notes) {
    // ~32 chars overhead for the marker line + delimiter
    const noteCost = note.text.length + 32;

    if (current.length > 0 && currentChars + noteCost > SAFE_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(note);
    currentChars += noteCost;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function bundleChunk(notes: Note[]): string {
  return notes
    .map((n) => `[note ${n.id} @ ${n.createdAt}]\n${n.text}`)
    .join("\n\n");
}

// In-process lock — prevents concurrent batches in the same runtime.
// The app and the headless runner do not run simultaneously in practice,
// so a file-based cross-process lock is not needed for v1.
let isProcessing = false;

export interface NotesBatchResult {
  /** True if processing actually ran (false = lock held or no work). */
  ran: boolean;
  /** Number of notes included in the batch. */
  noteCount: number;
  /** Number of writes the LLM produced for the batch (0 if none/failed). */
  writeCount: number;
  /** True if the batch finished successfully. */
  succeeded: boolean;
  /** Concatenated LLM replies, or a status message. */
  reply: string;
}

export function isNotesBatchRunning(): boolean {
  return isProcessing;
}

/**
 * Run a notes batch. Safe to call from multiple triggers — concurrent calls
 * after the first will return early with `ran: false`.
 */
export async function runNotesBatch(state: AppState): Promise<NotesBatchResult> {
  if (isProcessing) {
    return {
      ran: false,
      noteCount: 0,
      writeCount: 0,
      succeeded: false,
      reply: "A notes batch is already running.",
    };
  }

  isProcessing = true;

  try {
    const batch: Note[] = getProcessableNotes(state);
    if (batch.length === 0) {
      return {
        ran: true,
        noteCount: 0,
        writeCount: 0,
        succeeded: true,
        reply: "No notes to process.",
      };
    }

    const allIds = batch.map((n) => n.id);
    console.log(`[notes] starting batch with ${batch.length} note(s)`);

    // Mark processing and persist immediately so a crash mid-flight is recoverable
    markProcessing(state, allIds);
    await flush(state);

    // Group notes at note boundaries so each chunk's success/failure maps
    // cleanly back to a known set of notes. processBundle is then guaranteed
    // to see one internal chunk per call (assuming no single note exceeds
    // SAFE_CHUNK_CHARS), so per-chunk outcomes are unambiguous.
    const noteChunks = chunkNotesForBatch(batch);
    console.log(`[notes] split into ${noteChunks.length} chunk(s)`);

    // Aggregate state across all chunks
    const successfulNoteIds = new Set<string>();
    const failedNoteIds = new Set<string>();
    const allWrites: WriteOperation[] = [];
    const allReplies: string[] = [];
    let chunkFailureMessage = "";

    for (let ci = 0; ci < noteChunks.length; ci++) {
      const chunk = noteChunks[ci];
      const chunkIds = chunk.map((n) => n.id);
      const bundled = bundleChunk(chunk);

      let result;
      try {
        result = await processBundle(bundled, state, `notes:chunk${ci + 1}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[notes] chunk ${ci + 1} threw:`, message);
        for (const id of chunkIds) {
          markFailed(state, id, message);
          failedNoteIds.add(id);
        }
        chunkFailureMessage = message;
        continue;
      }

      if (!result.succeeded) {
        const message = "LLM unavailable or rejected the chunk.";
        console.error(`[notes] chunk ${ci + 1} failed: ${message}`);
        for (const id of chunkIds) {
          markFailed(state, id, message);
          failedNoteIds.add(id);
        }
        chunkFailureMessage = message;
        continue;
      }

      // Chunk succeeded — these notes will be marked processed below
      for (const id of chunkIds) successfulNoteIds.add(id);
      allWrites.push(...result.writes);
      if (result.replies.length > 0) allReplies.push(...result.replies);
    }

    // All chunks failed → nothing to mark processed; bail
    if (successfulNoteIds.size === 0) {
      await flush(state);
      console.error(`[notes] batch failed: all ${noteChunks.length} chunk(s) failed`);
      return {
        ran: true,
        noteCount: batch.length,
        writeCount: 0,
        succeeded: false,
        reply: chunkFailureMessage
          ? `Notes batch failed: ${chunkFailureMessage}`
          : "Notes batch failed. Will retry on next batch.",
      };
    }

    // Group writes by sourceNoteId so each note gets only the writes the LLM
    // attributed to it. Writes tagged with an id we didn't process (or untagged)
    // land in the unattributed bucket — counted in the batch reply, not in any
    // individual note's summary.
    const writesByNote = new Map<string, WriteOperation[]>();
    let unattributedCount = 0;
    for (const w of allWrites) {
      const tag = w.sourceNoteId && successfulNoteIds.has(w.sourceNoteId) ? w.sourceNoteId : "";
      if (!tag) unattributedCount++;
      const arr = writesByNote.get(tag) ?? [];
      arr.push(w);
      writesByNote.set(tag, arr);
    }

    if (unattributedCount > 0) {
      console.warn(
        `[notes] ${unattributedCount}/${allWrites.length} write(s) had no valid sourceNoteId — those notes show "no changes" in their summary`
      );
    }

    // Mark every successful note processed with its own deterministic summary.
    // Notes belonging to failed chunks have already been marked failed above.
    for (const note of batch) {
      if (!successfulNoteIds.has(note.id)) continue;
      const noteWrites = writesByNote.get(note.id) ?? [];
      const summary =
        noteWrites.length > 0
          ? summarizeWrites(noteWrites)
          : "No changes were needed.";
      markProcessed(state, note.id, noteWrites.length, summary);
    }
    await flush(state);

    // Build the user-facing batch reply: deterministic write summary first
    // (always reliable, includes unattributed writes), LLM's free-text reply
    // second (adds nuance). Unattributed writes are intentionally counted here
    // so the banner total matches what actually got written to disk, even
    // though they don't appear in any individual note's summary.
    const deterministicSummary = summarizeWrites(allWrites);
    const llmReply = allReplies.join(" ").trim();
    let reply: string;
    if (deterministicSummary && llmReply) {
      reply = `${deterministicSummary}\n${llmReply}`;
    } else if (deterministicSummary) {
      reply = deterministicSummary;
    } else if (llmReply) {
      reply = llmReply;
    } else {
      reply = `Processed ${successfulNoteIds.size} note(s). No changes were needed.`;
    }

    if (failedNoteIds.size > 0) {
      reply = `${reply}\n${failedNoteIds.size} note(s) failed and will retry.`;
    }

    const allChunksSucceeded = failedNoteIds.size === 0;
    console.log(
      `[notes] batch complete: ${successfulNoteIds.size} processed, ${failedNoteIds.size} failed, ${allWrites.length} writes (${unattributedCount} unattributed)`
    );

    return {
      ran: true,
      noteCount: batch.length,
      writeCount: allWrites.length,
      succeeded: allChunksSucceeded,
      reply,
    };
  } finally {
    isProcessing = false;
  }
}
