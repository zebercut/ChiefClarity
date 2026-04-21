/**
 * Standalone test runner for notesStore.
 * Run with: npx ts-node src/modules/notesStore.test.ts
 *
 * All fixtures use fictional content per CLAUDE.md "No Real User Data" rule.
 */
import assert from "assert";
import type { AppState, Note, NoteStatus } from "../types";
import {
  addNote,
  editNote,
  deleteNote,
  retryNote,
  markProcessing,
  markProcessed,
  markFailed,
  getProcessableNotes,
  recoverStaleProcessing,
  searchNotes,
  MAX_ATTEMPTS,
} from "./notesStore";

// ─── Fixture helpers ───────────────────────────────────────────────────────

function makeState(): AppState {
  // Only the slices touched by notesStore matter; cast to satisfy AppState.
  return {
    notes: { _summary: "", notes: [] },
    _dirty: new Set(),
  } as unknown as AppState;
}

function makeNote(partial: Partial<Note> = {}): Note {
  return {
    id: "note_" + Math.random().toString(36).slice(2, 10),
    text: "Note A",
    createdAt: new Date().toISOString(),
    status: "pending",
    processedAt: null,
    writeCount: 0,
    processedSummary: null,
    attemptCount: 0,
    lastError: null,
    ...partial,
  };
}

// ─── Test runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log("  \u2713", name);
    passed++;
  } catch (e: any) {
    console.error("  \u2717", name);
    console.error("   ", e.message);
    failed++;
  }
}

console.log("notesStore");

// ─── addNote ───────────────────────────────────────────────────────────────

test("addNote creates a pending note with id and timestamp", () => {
  const state = makeState();
  const note = addNote(state, "Project X update");
  assert.strictEqual(note.status, "pending");
  assert.strictEqual(note.text, "Project X update");
  assert.ok(note.id.startsWith("note_"));
  assert.ok(note.createdAt.length > 0);
  assert.strictEqual(note.attemptCount, 0);
  assert.strictEqual(note.lastError, null);
  assert.strictEqual(state.notes.notes.length, 1);
  assert.ok(state._dirty.has("notes"));
});

test("addNote trims whitespace", () => {
  const state = makeState();
  const note = addNote(state, "   Note A   ");
  assert.strictEqual(note.text, "Note A");
});

test("addNote rejects empty/whitespace-only text", () => {
  const state = makeState();
  assert.throws(() => addNote(state, ""), /empty/i);
  assert.throws(() => addNote(state, "   "), /empty/i);
});

// ─── markProcessing / markProcessed / markFailed ──────────────────────────

test("markProcessing flips matching notes to processing", () => {
  const state = makeState();
  const a = addNote(state, "Note A");
  const b = addNote(state, "Note B");
  const c = addNote(state, "Note C");
  state._dirty.clear();
  markProcessing(state, [a.id, c.id]);
  assert.strictEqual(state.notes.notes[0].status, "processing");
  assert.strictEqual(state.notes.notes[1].status, "pending");
  assert.strictEqual(state.notes.notes[2].status, "processing");
  assert.ok(state._dirty.has("notes"));
});

test("markProcessed sets processed status, processedAt, writeCount, processedSummary, clears lastError", () => {
  const state = makeState();
  const a = addNote(state, "Note A");
  markProcessing(state, [a.id]);
  // Pretend it had a previous failure
  state.notes.notes[0].lastError = "old error";
  markProcessed(state, a.id, 3, "Created 2 tasks, Added 1 event.");
  const n = state.notes.notes[0];
  assert.strictEqual(n.status, "processed");
  assert.strictEqual(n.writeCount, 3);
  assert.strictEqual(n.processedSummary, "Created 2 tasks, Added 1 event.");
  assert.ok(n.processedAt);
  assert.strictEqual(n.lastError, null);
});

test("markFailed sets failed status, increments attemptCount, sets lastError", () => {
  const state = makeState();
  const a = addNote(state, "Note A");
  markFailed(state, a.id, "LLM timeout");
  assert.strictEqual(state.notes.notes[0].status, "failed");
  assert.strictEqual(state.notes.notes[0].attemptCount, 1);
  assert.strictEqual(state.notes.notes[0].lastError, "LLM timeout");
  // Second failure increments again
  markFailed(state, a.id, "Network error");
  assert.strictEqual(state.notes.notes[0].attemptCount, 2);
  assert.strictEqual(state.notes.notes[0].lastError, "Network error");
});

// ─── recoverStaleProcessing ────────────────────────────────────────────────

test("recoverStaleProcessing flips processing → pending without bumping attemptCount", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "n1", status: "processing", attemptCount: 2 }),
    makeNote({ id: "n2", status: "pending", attemptCount: 0 }),
    makeNote({ id: "n3", status: "processed", attemptCount: 0 }),
    makeNote({ id: "n4", status: "failed", attemptCount: 3 })
  );
  const recovered = recoverStaleProcessing(state);
  assert.strictEqual(recovered, 1);
  assert.strictEqual(state.notes.notes[0].status, "pending");
  assert.strictEqual(state.notes.notes[0].attemptCount, 2); // unchanged
  assert.strictEqual(state.notes.notes[1].status, "pending");
  assert.strictEqual(state.notes.notes[2].status, "processed");
  assert.strictEqual(state.notes.notes[3].status, "failed");
  assert.ok(state._dirty.has("notes"));
});

test("recoverStaleProcessing returns 0 when no stale processing notes", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ status: "pending" }));
  state._dirty.clear();
  assert.strictEqual(recoverStaleProcessing(state), 0);
  assert.strictEqual(state._dirty.has("notes"), false);
});

// ─── getProcessableNotes ───────────────────────────────────────────────────

test("getProcessableNotes returns pending and failed-under-cap, sorted by createdAt", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "p1", status: "pending", createdAt: "2026-04-06T10:00:00Z" }),
    makeNote({ id: "f1", status: "failed", attemptCount: 2, createdAt: "2026-04-06T09:00:00Z" }),
    makeNote({ id: "f2", status: "failed", attemptCount: MAX_ATTEMPTS, createdAt: "2026-04-06T08:00:00Z" }),
    makeNote({ id: "d1", status: "processed", createdAt: "2026-04-06T07:00:00Z" }),
    makeNote({ id: "x1", status: "processing", createdAt: "2026-04-06T11:00:00Z" })
  );
  const out = getProcessableNotes(state);
  assert.deepStrictEqual(
    out.map((n) => n.id),
    ["f1", "p1"]
  );
});

test("getProcessableNotes excludes failed notes at MAX_ATTEMPTS", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "ok", status: "failed", attemptCount: MAX_ATTEMPTS - 1 }),
    makeNote({ id: "stuck", status: "failed", attemptCount: MAX_ATTEMPTS })
  );
  const out = getProcessableNotes(state);
  assert.deepStrictEqual(out.map((n) => n.id), ["ok"]);
});

// ─── editNote ──────────────────────────────────────────────────────────────

test("editNote on pending updates text only", () => {
  const state = makeState();
  const n = addNote(state, "old text");
  state._dirty.clear();
  editNote(state, n.id, "new text");
  assert.strictEqual(state.notes.notes[0].text, "new text");
  assert.strictEqual(state.notes.notes[0].status, "pending");
  assert.strictEqual(state.notes.notes[0].attemptCount, 0);
  assert.ok(state._dirty.has("notes"));
});

test("editNote on failed updates text AND resets attemptCount + lastError", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "f1", status: "failed", attemptCount: 3, lastError: "LLM down" })
  );
  editNote(state, "f1", "rephrased note");
  const n = state.notes.notes[0];
  assert.strictEqual(n.text, "rephrased note");
  assert.strictEqual(n.status, "failed"); // status unchanged
  assert.strictEqual(n.attemptCount, 0);
  assert.strictEqual(n.lastError, null);
});

test("editNote on processing throws", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ id: "p", status: "processing" }));
  assert.throws(() => editNote(state, "p", "new"), /processing/i);
});

test("editNote on processed throws", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ id: "d", status: "processed" }));
  assert.throws(() => editNote(state, "d", "new"), /processed/i);
});

test("editNote rejects empty text", () => {
  const state = makeState();
  const n = addNote(state, "old");
  assert.throws(() => editNote(state, n.id, "   "), /empty/i);
});

test("editNote on missing id throws", () => {
  const state = makeState();
  assert.throws(() => editNote(state, "missing", "new"), /not found/i);
});

// ─── deleteNote ────────────────────────────────────────────────────────────

test("deleteNote removes notes in any non-processing status", () => {
  const statuses: NoteStatus[] = ["pending", "processed", "failed"];
  for (const status of statuses) {
    const state = makeState();
    state.notes.notes.push(makeNote({ id: "x", status }));
    state.notes.notes.push(makeNote({ id: "y", status: "pending" }));
    deleteNote(state, "x");
    assert.strictEqual(state.notes.notes.length, 1);
    assert.strictEqual(state.notes.notes[0].id, "y");
    assert.ok(state._dirty.has("notes"));
  }
});

test("deleteNote on processing throws", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ id: "p", status: "processing" }));
  assert.throws(() => deleteNote(state, "p"), /processing/i);
  assert.strictEqual(state.notes.notes.length, 1);
});

test("deleteNote on missing id throws", () => {
  const state = makeState();
  assert.throws(() => deleteNote(state, "missing"), /not found/i);
});

// ─── retryNote ─────────────────────────────────────────────────────────────

test("retryNote on failed resets attemptCount, clears lastError, flips to pending", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "f", status: "failed", attemptCount: MAX_ATTEMPTS, lastError: "boom" })
  );
  retryNote(state, "f");
  const n = state.notes.notes[0];
  assert.strictEqual(n.status, "pending");
  assert.strictEqual(n.attemptCount, 0);
  assert.strictEqual(n.lastError, null);
  assert.ok(state._dirty.has("notes"));
});

test("retryNote on non-failed throws", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ id: "p", status: "pending" }));
  assert.throws(() => retryNote(state, "p"), /failed/i);
});

// ─── searchNotes ───────────────────────────────────────────────────────────

test("searchNotes filters by case-insensitive substring on text", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "1", text: "Project X update — design ready" }),
    makeNote({ id: "2", text: "Buy milk" }),
    makeNote({ id: "3", text: "PROJECT X — review required" })
  );
  const out = searchNotes(state, "project x");
  assert.deepStrictEqual(out.map((n) => n.id), ["1", "3"]);
});

test("searchNotes with status filter narrows further", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "1", text: "foo", status: "pending" }),
    makeNote({ id: "2", text: "foo", status: "processed" }),
    makeNote({ id: "3", text: "foo", status: "failed" })
  );
  const out = searchNotes(state, "foo", "pending");
  assert.deepStrictEqual(out.map((n) => n.id), ["1"]);
});

test("searchNotes with empty query returns all (subject to status filter)", () => {
  const state = makeState();
  state.notes.notes.push(
    makeNote({ id: "1", status: "pending" }),
    makeNote({ id: "2", status: "processed" })
  );
  assert.strictEqual(searchNotes(state, "").length, 2);
  assert.strictEqual(searchNotes(state, "", "pending").length, 1);
  assert.strictEqual(searchNotes(state, "", "all").length, 2);
});

test("searchNotes returns empty list when nothing matches", () => {
  const state = makeState();
  state.notes.notes.push(makeNote({ text: "Project X" }));
  assert.strictEqual(searchNotes(state, "nonexistent").length, 0);
});

// ─── chunkNotesForBatch ────────────────────────────────────────────────────

import { chunkNotesForBatch, summarizeWrites } from "./notesProcessor";
import type { WriteOperation } from "../types";

test("chunkNotesForBatch keeps a small batch in a single chunk", () => {
  const notes = [
    makeNote({ id: "1", text: "Buy milk" }),
    makeNote({ id: "2", text: "Email Project Alpha update" }),
    makeNote({ id: "3", text: "Schedule dentist appointment" }),
  ];
  const chunks = chunkNotesForBatch(notes);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].length, 3);
});

test("chunkNotesForBatch splits at note boundaries when total exceeds budget", () => {
  // ~2500 chars per note × 4 notes = ~10000 chars > SAFE_CHUNK_CHARS (5000)
  const big = "x".repeat(2500);
  const notes = [
    makeNote({ id: "1", text: big }),
    makeNote({ id: "2", text: big }),
    makeNote({ id: "3", text: big }),
    makeNote({ id: "4", text: big }),
  ];
  const chunks = chunkNotesForBatch(notes);
  assert.ok(chunks.length >= 2, `expected >= 2 chunks, got ${chunks.length}`);
  // No note should appear twice across chunks
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const n of chunk) {
      assert.ok(!seen.has(n.id), `note ${n.id} appears in more than one chunk`);
      seen.add(n.id);
    }
  }
  assert.strictEqual(seen.size, 4);
});

test("chunkNotesForBatch puts an oversized single note in its own chunk", () => {
  const huge = "y".repeat(20000); // way bigger than SAFE_CHUNK_CHARS
  const notes = [
    makeNote({ id: "small1", text: "tiny" }),
    makeNote({ id: "huge", text: huge }),
    makeNote({ id: "small2", text: "tiny" }),
  ];
  const chunks = chunkNotesForBatch(notes);
  // The oversized note should be alone in its chunk; tiny ones can pair up
  const hugeChunk = chunks.find((c) => c.some((n) => n.id === "huge"));
  assert.ok(hugeChunk, "huge note should be in some chunk");
  assert.strictEqual(hugeChunk!.length, 1, "huge note should be alone in its chunk");
});

test("chunkNotesForBatch on empty input returns empty array", () => {
  assert.deepStrictEqual(chunkNotesForBatch([]), []);
});

// ─── summarizeWrites ───────────────────────────────────────────────────────

function w(file: string, action: "add" | "update" | "delete"): WriteOperation {
  return { file: file as any, action, data: {} };
}

test("summarizeWrites pluralizes correctly", () => {
  assert.strictEqual(
    summarizeWrites([w("tasks", "add")]),
    "Created 1 task."
  );
  assert.strictEqual(
    summarizeWrites([w("tasks", "add"), w("tasks", "add"), w("tasks", "add")]),
    "Created 3 tasks."
  );
});

test("summarizeWrites combines multiple buckets", () => {
  const result = summarizeWrites([
    w("tasks", "add"),
    w("tasks", "add"),
    w("calendar", "add"),
    w("contextMemory", "add"),
  ]);
  assert.ok(result.includes("Created 2 tasks"), result);
  assert.ok(result.includes("Added 1 event"), result);
  assert.ok(result.includes("Noted 1 fact"), result);
});

test("summarizeWrites returns empty string for empty input", () => {
  assert.strictEqual(summarizeWrites([]), "");
});

test("summarizeWrites unknown bucket falls back without leaking file key", () => {
  // Suppress the warn for this test
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const result = summarizeWrites([w("hotContext", "add")]);
    // Must not contain the file key or the action verb
    assert.ok(!result.includes("hotContext"), `leaked file key: ${result}`);
    assert.ok(!/\badd\b/i.test(result), `leaked action verb: ${result}`);
    assert.ok(/item/i.test(result), `expected generic "item" fallback: ${result}`);
  } finally {
    console.warn = origWarn;
  }
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
