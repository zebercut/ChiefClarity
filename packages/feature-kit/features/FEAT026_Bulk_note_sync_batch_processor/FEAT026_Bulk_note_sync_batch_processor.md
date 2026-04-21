# FEAT026 — Bulk note sync batch processor

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** SHOULD
**Category:** Performance
**Priority:** 6
**Release:** v2.1
**Tags:** tokens, optimization, notes, batch, encryption-safe, headless
**Created:** 2026-04-05

---

## Summary

Add a Notes tab where the user captures freeform thoughts throughout the day. Notes are persisted to an encrypted local store with a `pending | processing | processed | failed` status. Processing happens in **batches** — either manually via a "Process" button or automatically by a headless job every ~4 hours — bundling all pending notes into a single `bulk_input` LLM call instead of one call per note. Each note's status updates live in the UI so the user can see what's been ingested by the system and what's still in queue.

---

## Problem Statement

Today, freeform notes go through the chat tab and trigger one LLM call per submission. The result: high token usage for thoughts that don't need immediate action ("design team says assets ready Thursday — escalate if delayed"), no clean separation between "I want to think out loud" and "I want a response right now," and no audit of what the system has actually absorbed from a user's stream of notes.

There is already an existing batch path for bulk content: `inbox.txt` → `processInbox()` in [src/modules/inbox.ts](src/modules/inbox.ts) → `bulk_input` intent → `assembleContext` → `callLlm` → `applyWrites`. That pipeline is proven and chunked. **This feature reuses it** rather than building a new one — the only new infrastructure is the notes store, the Notes tab UI, and the batch trigger.

---

## User Stories

### Story 1 — Capture without commitment
**As a** user, **I want** to jot down a thought in the Notes tab without the system reacting immediately, **so that** I can offload my brain without paying a token cost or interrupting my flow with a reply.

**Acceptance Criteria:**
- [ ] Given I'm on the Notes tab, when I type a note and tap "Add Note" (or press Cmd/Ctrl+Enter), then the note appears in "Today's Notes" with a `pending` status badge and no LLM call is made.
- [ ] Given a `pending` note, when I revisit the Notes tab, then it is still there with the same status (persisted across app restarts).

### Story 2 — Manual batch process
**As a** user, **I want** to tap a "Process" button to push all my pending notes through at once, **so that** I can decide when the batch happens (e.g., end of day, before a planning session).

**Acceptance Criteria:**
- [ ] Given there are ≥1 pending notes, when I tap "Process", then all pending notes are bundled into a single `bulk_input` LLM call.
- [ ] During processing, each pending note transitions to a `processing` badge so I can see something is happening.
- [ ] On success, each note transitions to `processed`, shows the number of writes it produced (or zero), and is timestamped with `processedAt`.
- [ ] On failure (LLM down, network error), notes transition to `failed` with `attemptCount` incremented and `lastError` set; they are automatically retried on the next batch run as long as `attemptCount < MAX_ATTEMPTS` (5). After the cap, the note stays `failed` and requires manual retry. Nothing is silently lost.
- [ ] Tapping "Process" while a batch is already running is a no-op (button disabled / shows spinner).

### Story 3 — Automatic batch every ~4 hours
**As a** user, **I want** the system to process my notes automatically every ~4 hours in the background, **so that** I don't have to remember and the data stays fresh for planning.

**Acceptance Criteria:**
- [ ] While the app is open, an in-app interval fires every 4 hours and triggers the batch if there are pending notes (per `CLAUDE.md` "App Runs Continuously" rule).
- [ ] When the app is closed, the headless runner picks up pending notes on its next scheduled cycle and processes them.
- [ ] The interval respects the same `loadingRef` / `inboxProcessingRef` guards as inbox processing — no concurrent batches.
- [ ] If the user manually processes within the 4h window, the next automatic run still fires on schedule (no special-case skipping); it just sees an empty queue and exits.

### Story 4 — Visible status per note
**As a** user, **I want** to see a status badge on every note (`pending`, `processing`, `processed`, `failed`), **so that** I know what the system has and hasn't absorbed.

**Acceptance Criteria:**
- [ ] Each note in "Today's Notes" displays its status badge (color-coded: gray pending, blue processing, green processed, red failed).
- [ ] Processed notes show a small "✓ ingested HH:MM" timestamp.
- [ ] Failed notes show the error in a tooltip or expandable line.
- [ ] The notes list is sorted by `createdAt` descending (most recent at top).

### Story 5 — No data loss
**As a** user, **I want** my notes to survive every failure mode (app crash, mid-batch close, LLM error), **so that** I trust the Notes tab as a real capture surface.

**Acceptance Criteria:**
- [ ] If the app closes mid-batch, on next open all `processing` notes are reverted to `pending` (stale processing state recovery).
- [ ] If the LLM call fails, no note is marked `processed` — all stay `pending` with an updated `lastError`.
- [ ] Notes are written to disk synchronously after each add (no in-memory-only window).

### Story 6 — Search, edit, delete
**As a** user, **I want** to search my notes, edit ones I haven't ingested yet, and delete any I no longer want, **so that** the Notes tab functions as a real capture surface and not just a write-only log.

**Acceptance Criteria:**
- [ ] A search bar above "Today's Notes" filters the list by case-insensitive substring match on `text`. The list updates as I type.
- [ ] An optional status filter chip (`all | pending | processed | failed`) further narrows the list. Default is `all`.
- [ ] When the search yields no results, the list shows "No notes match your search" with a clear-search action.
- [ ] Each note has an edit button (pencil icon) and a delete button (trash icon).
- [ ] **Edit is allowed only on `pending` and `failed` notes.** The edit button is hidden (or disabled with a tooltip) on `processing` and `processed` notes — once a note has been ingested by the LLM, the downstream tasks/events already exist independently and editing the source text would be meaningless.
- [ ] Editing a `failed` note also resets `attemptCount` to 0 and clears `lastError` (the user is effectively saying "try this version instead"); status stays `failed` until the next batch picks it up via the normal retry path, but the next batch run will re-include it because it's now under the cap again.
- [ ] **Delete is allowed on every status except `processing`.** The delete button is disabled (with a tooltip) while a note is being processed.
- [ ] Delete shows a confirmation only for `processed` notes (the user might want the audit trail). `pending` and `failed` notes delete immediately.
- [ ] Edit and delete operations write to `notes.json` synchronously and the UI updates from the new state.

---

## Workflow

```
┌──────────────────────────────────────────────────────────┐
│ CAPTURE (immediate, no LLM)                              │
│                                                          │
│ User types note → Add Note                               │
│   ↓                                                      │
│ notesStore.add(text)                                     │
│   ↓                                                      │
│ writeJsonFile("notes.json", state.notes)  ← encrypted    │
│   ↓                                                      │
│ UI re-renders with pending badge                         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ BATCH (manual OR automatic every 4h)                     │
│                                                          │
│ Trigger: "Process" button | in-app 4h interval | headless│
│   ↓                                                      │
│ acquireLock(notesProcessingRef)  ← guard against         │
│   ↓                                  concurrent runs     │
│ batch = getProcessableNotes(state)                       │
│   = pending ∪ (failed where attemptCount < MAX_ATTEMPTS) │
│ if batch.length === 0 → release lock, exit               │
│   ↓                                                      │
│ batch.forEach(n => n.status = "processing")              │
│ writeJsonFile("notes.json", ...)                         │
│   ↓                                                      │
│ bundled = batch.map(n =>                                 │
│   `[note ${n.id} @ ${n.createdAt}]: ${n.text}`           │
│ ).join("\n\n")                                           │
│   ↓                                                      │
│ processBundle(bundled, state)  ← reuses inbox.ts:        │
│   chunkText() + bulk_input intent + assembleContext +    │
│   callLlm + applyWrites                                  │
│   ↓                                                      │
│ on success:                                              │
│   batch.forEach(n => {                                   │
│     n.status = "processed"                               │
│     n.processedAt = now()                                │
│     n.writeCount = (writes attributed to this note)      │
│     n.lastError = null                                   │
│   })                                                     │
│ on failure:                                              │
│   batch.forEach(n => {                                   │
│     n.status = "failed"                                  │
│     n.attemptCount += 1                                  │
│     n.lastError = err.message                            │
│   })                                                     │
│   (notes still under MAX_ATTEMPTS will be picked up      │
│    automatically by the next batch run)                  │
│   ↓                                                      │
│ writeJsonFile("notes.json", ...)                         │
│ releaseLock(notesProcessingRef)                          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ RECOVERY (on app open / headless start)                  │
│                                                          │
│ loader.ts loads notes.json                               │
│   ↓                                                      │
│ Any note with status === "processing" → revert "pending" │
│ (a stale processing state means a previous run died;     │
│  attemptCount is NOT incremented because we don't know   │
│  whether the LLM call actually completed — penalizing    │
│  crashes would burn the retry budget unfairly)           │
└──────────────────────────────────────────────────────────┘

### Status transitions (full table)

| From | Trigger | To | Notes |
|---|---|---|---|
| (none) | user adds note | `pending` | initial state |
| `pending` | batch starts | `processing` | included in batch snapshot |
| `failed` (attemptCount < 5) | batch starts | `processing` | auto-retried |
| `failed` (attemptCount ≥ 5) | batch starts | `failed` (skipped) | requires manual retry |
| `processing` | batch succeeds | `processed` | sets `processedAt`, clears `lastError` |
| `processing` | batch fails | `failed` | `attemptCount++`, `lastError` set |
| `processing` | app killed mid-batch | `pending` | recovery on next load; `attemptCount` NOT incremented |
| `failed` | user taps "Retry" | `pending` | resets `attemptCount` to 0 and clears `lastError` |
| `processed` | (anything) | `processed` | terminal — never re-processed |
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| App closes mid-batch | On next open, `processing` notes revert to `pending`. They will be picked up by the next manual or 4h trigger. |
| Two triggers fire simultaneously (manual + 4h interval) | `notesProcessingRef` lock makes the second trigger a no-op. |
| Bundle exceeds `MAX_CHUNK_TOKENS` (2000) | Reuse `chunkText()` from `inbox.ts:139` — split bundle at note boundaries first, then paragraph, then sentence. |
| Single note exceeds chunk budget | The note stays as one chunk (chunker's last-resort behavior). LLM still gets it; downstream truncation is its problem. |
| LLM call partially succeeds (some chunks ok, some failed) | All notes in the batch transition to `failed` (with `attemptCount++`) if ANY chunk failed, mirroring the conservative path in `inbox.ts:98-101`. Avoids silent half-state. They will be retried on the next batch as long as they're under `MAX_ATTEMPTS`. |
| User adds a new note during processing | New note is created with `status: "pending"`. It is NOT included in the in-flight batch (snapshot-at-start semantics). It will be picked up next batch. |
| User deletes a note (trash icon) while it's `processing` | Deletion is blocked while status is `processing`; UI disables the trash icon. After completion the user can delete normally. |
| User tries to edit a `processed` note | Edit button is hidden / disabled with tooltip "Already ingested — add a new note to correct". |
| User tries to edit a `processing` note | Edit button is hidden / disabled with tooltip "Currently processing". |
| User edits a `failed` note | Text is updated, `attemptCount` resets to 0, `lastError` clears, status flips to `pending`. Picked up by next batch. |
| User edits a `pending` note | Text is updated; status stays `pending`; no other fields change. |
| User deletes a `processed` note | Confirmation dialog: "This note has already been ingested. Deleting removes the audit trail but does NOT undo any tasks/events the system created from it." |
| Search query yields zero results | List shows "No notes match your search" with a one-tap clear-search action. |
| Search active when a new note is added | New note appears in the list only if it matches the active filter; otherwise the list shows "1 hidden by filter" hint. |
| Headless runner has no app state in memory | Headless runner already loads `state` via `loader.ts`; notes.json comes along automatically once added to FILE_MAP. |
| `notes.json` does not yet exist (first run) | `loader.ts` defaults to `{ notes: [] }` (same pattern as other files). |
| User has 200+ pending notes | Chunker handles it. Worst case is multiple sequential LLM calls, but still far fewer than 200 individual ones. Token savings still significant. |
| Processed note is older than 7 days | Stays in store but UI hides it from "Today's Notes" (only today's date shown). Older notes remain in `notes.json` for traceability. |
| User wants to retry a failed note | Tap on a `failed` note → "Retry" action → `attemptCount` reset to 0, `lastError` cleared, status flipped to `pending`. Picked up by next batch. Useful when a note has hit `MAX_ATTEMPTS` and is no longer auto-retried. |
| Note has hit `MAX_ATTEMPTS` (5 failed attempts) | Stays `failed`, excluded from automatic batches. UI shows it with a "Max retries — tap Retry" hint. |
| Note text is empty/whitespace only | Add Note button is disabled; cannot create empty notes. |

---

## Success Metrics

- Reduce daily LLM token usage for note-style inputs by **60–80%** (measured by comparing average tokens-per-note before/after, pre-existing chat-as-notes baseline vs. batched).
- **Zero note loss** across 30-day test window (manual audit: count of `processed` + `pending` + `failed` always equals total notes ever created).
- Median time from "Add Note" to "ingested" badge ≤ 4h (when relying on auto), <30s (when using manual Process).
- "Process" button success rate (no error) > 95% under normal LLM availability.
- Zero new entries in real-data leakage scans (test fixtures use only fictional notes).

---

## Out of Scope

- **Real-time collaborative note editing** — single user, single device write model.
- **Note prioritization within a batch** — bundle order is by `createdAt`. The LLM decides what to act on.
- **Per-note "process now" override** — manual Process is all-or-nothing for the pending queue. (Follow-up if users ask for it.)
- **Note categorization / tagging in UI** — notes are freeform text. The LLM may extract topics/tasks/events from them, which surface in their normal places.
- **Editing `processed` notes** — once the LLM has absorbed a note, the downstream tasks/events exist independently. Editing the source would either re-ingest (risk of duplicates) or desync the UI from the data the system actually acted on. To "correct" a processed note, the user adds a new note saying so. Edit is therefore restricted to `pending` and `failed`.
- **Multi-device sync** — relies on the same Google Drive folder mechanism as everything else; no extra sync logic.
- **Full-text search across history / older days** — v1 search is scoped to the visible "Today's Notes" list (today + recently added). A history view with search across all time is a follow-up.
- **Encrypting `topics/*.md`** — flagged in FEAT033, separate decision.
- **Urgency keywords that auto-bypass the queue** — explicitly out. Adds NLP complexity for marginal value; users wanting immediacy use chat.
- **Push notifications for "your notes were processed"** — out for v1.

---

## Architecture Notes

### Data model

New file: **`notes.json`** (encrypted via existing filesystem layer).

```ts
interface Note {
  id: string;                    // ulid or short hash
  text: string;
  createdAt: string;             // ISO timestamp
  status: "pending" | "processing" | "processed" | "failed";
  processedAt: string | null;
  writeCount: number;            // number of writes the LLM generated for this note (best-effort attribution; 0 if none)
  attemptCount: number;          // how many times we've tried to process it
  lastError: string | null;
}

interface NotesFile {
  _summary: string;              // for assembler summary path, like other files
  notes: Note[];
}
```

### Batch selection

```ts
const MAX_ATTEMPTS = 5;

function getProcessableNotes(state: AppState): Note[] {
  return state.notes.notes.filter(n =>
    n.status === "pending" ||
    (n.status === "failed" && n.attemptCount < MAX_ATTEMPTS)
  );
}
```

Each batch run picks up `pending` notes plus `failed` notes still under the retry cap. `processed` notes are terminal and never re-touched. Notes that hit `attemptCount >= MAX_ATTEMPTS` are stranded as `failed` and require the user to tap "Retry" (which resets `attemptCount` to 0 and flips status back to `pending`).

This guarantees: nothing is silently lost, transient failures self-heal on the next run, and infinite retry loops on permanently broken notes are impossible.

**Write attribution caveat:** the LLM call processes the bundle as one unit; we cannot perfectly attribute which write came from which note. v1 strategy: divide `totalWrites` evenly across the notes in the batch (rounded), or simpler — set `writeCount` to `totalWrites` for the **first** note in the batch and 0 for the rest. **Decision:** set `writeCount = totalWrites` on each processed note as a flag-style indicator ("this batch produced N writes total"). Refine in a follow-up if attribution becomes important.

### Encryption (mandatory)

- **Add `"notes.json"` to `SENSITIVE_FILES` in [src/utils/crypto.ts:240](src/utils/crypto.ts#L240) in the same PR that creates the file.** Never land plaintext.
- All reads/writes go through `readJsonFile` / `writeJsonFile` in [src/utils/filesystem.ts](src/utils/filesystem.ts) — encryption is transparent.
- New module imports must NOT include `fs`, `path`, or `node:*`. Same rule as FEAT033.
- Notes content must NEVER appear in `console.log` outside debug paths.

### Module structure

| Module | Responsibility |
|---|---|
| **NEW** [src/modules/notesStore.ts](src/modules/notesStore.ts) | Pure state operations: `addNote`, `editNote(id, newText)`, `deleteNote`, `markProcessing`, `markProcessed`, `markFailed`, `retryNote(id)`, `recoverStaleProcessing`, `getProcessableNotes`, `searchNotes(query, statusFilter?)`. No I/O — operates on `state.notes`. `editNote` is rejected with an error if the note is `processing` or `processed`; on a `failed` note it also resets `attemptCount` to 0 and clears `lastError`. `searchNotes` is a pure filter (case-insensitive substring on `text`, plus optional status filter). |
| **NEW** [src/modules/notesProcessor.ts](src/modules/notesProcessor.ts) | Orchestrates a batch run: lock → snapshot pending → mark processing → write → bundle → call `processBundle` → mark processed/failed → write. Owns the lock. |
| **REUSED** [src/modules/inbox.ts](src/modules/inbox.ts) | **Refactor:** extract `processBundle(text, state)` from `processInbox` so both inbox and notes use the same chunker + bulk_input pipeline. `processInbox` becomes a thin wrapper that reads `inbox.txt` and calls `processBundle`. |
| **MODIFIED** [src/modules/loader.ts](src/modules/loader.ts) | Add `notes: "notes.json"` to `FILE_MAP`; add `notes` default `{ _summary: "", notes: [] }`; on load, call `recoverStaleProcessing` to flip stale `processing` → `pending`. |
| **MODIFIED** [src/types/index.ts](src/types/index.ts) | Add `Note`, `NotesFile`, extend `AppState` with `notes: NotesFile`, extend `FileKey` union. |
| **MODIFIED** [src/utils/crypto.ts](src/utils/crypto.ts#L240) | Add `"notes.json"` to `SENSITIVE_FILES`. |
| **NEW** `app/(tabs)/notes.tsx` | Notes tab screen — input + list with status badges. |
| **MODIFIED** `app/(tabs)/_layout.tsx` | Add the Notes tab between Tasks and Topics. |
| **MODIFIED** headless runner (location TBD — likely `scripts/headless-runner.ts` or similar) | Add a 4h scheduled task that calls `runNotesBatch(state)`. |
| **MODIFIED** main app shell (location of existing inbox interval) | Add a `setInterval` for 4h notes batch alongside the existing inbox/nudges/state-refresh intervals, guarded by `notesProcessingRef`. |

### Lock semantics

- New ref: `notesProcessingRef` (similar to existing `inboxProcessingRef` from `CLAUDE.md` rules).
- `acquireLock` is a simple boolean check + set; release in `finally`.
- Manual Process button reads the same ref and disables itself when locked.
- Headless runner respects the same lock (file-based lock if needed for cross-process safety; in practice headless and app don't run simultaneously since the user closes one to use the other).

### Reuse of `bulk_input`

- The batch processor calls `assembleContext` with intent `bulk_input` — same as inbox today.
- Token budget already exists at `TOKEN_BUDGETS.bulk_input = 6000` ([router.ts:26](src/modules/router.ts#L26)).
- No new prompt work, no new intent, no new schema. The notes batch is invisible to the LLM; it just sees a bulk text blob like inbox does.

### UI

- **Notes tab** matches the screenshot: header "Notes / Capture thoughts, process later", textarea, "Add Note" + "Process" buttons, "Today's Notes" list.
- **Search bar** above the list: text input with magnifying glass icon, clear-X when text is present, optional status filter chips (`all | pending | processed | failed`). Filter is purely client-side (substring match on `text`, `text.toLowerCase().includes(query.toLowerCase())`).
- Status badge: small pill at the top-right of each note card.
  - `pending` — gray "•"
  - `processing` — blue spinner
  - `processed` — green checkmark + "ingested HH:MM"
  - `failed` — red "!" with tap-to-see-error and "Max retries — tap Retry" hint when `attemptCount >= MAX_ATTEMPTS`
- **Per-note actions** (right side of each card, visible on hover/tap):
  - **Edit (pencil icon)** — only shown when status is `pending` or `failed`. Opens an inline editor (tap to expand the card into a textarea + Save/Cancel). Save calls `editNote(id, newText)`.
  - **Delete (trash icon)** — disabled when status is `processing`. Shows a confirmation dialog only when status is `processed`.
- "Process" button shows `Processing N notes...` with spinner during a run; disabled when the queue is empty.
- Empty state: "No notes yet. Capture thoughts to process later."
- Search empty state: "No notes match your search" + clear-search action.

### Documentation updates required (per CLAUDE.md)

- [docs/new_architecture_typescript.md](docs/new_architecture_typescript.md) — Section 3 (project structure: `notes.json`), Section 4 (data files), Section 5 (types: `Note`, `NotesFile`), Section 6 (modules: `notesStore`, `notesProcessor`; refactor of `inbox.ts`), Section 9 (ADR: "Notes batch reuses bulk_input pipeline"), Section 12 (feature catalog).
- [README.md](README.md) — Modules table (notesStore, notesProcessor), Data Files table (notes.json), feature list at top (Notes tab), tree update.

---

## Implementation Notes

| File | Change |
|------|--------|
| [src/types/index.ts](src/types/index.ts) | Add `Note`, `NotesFile`; extend `FileKey` and `AppState` |
| [src/utils/crypto.ts](src/utils/crypto.ts#L240) | **Add `"notes.json"` to `SENSITIVE_FILES`** (must land in same PR as the file itself) |
| [src/modules/loader.ts](src/modules/loader.ts) | Add to `FILE_MAP`, add default, call `recoverStaleProcessing` |
| [src/modules/notesStore.ts](src/modules/notesStore.ts) | **NEW** — pure state ops including `addNote`, `editNote`, `deleteNote`, `retryNote`, `searchNotes`, `getProcessableNotes`, `recoverStaleProcessing`, status transitions. ~180 lines |
| [src/modules/notesProcessor.ts](src/modules/notesProcessor.ts) | **NEW** — batch orchestration with lock, ~150 lines |
| [src/modules/inbox.ts](src/modules/inbox.ts) | **Refactor** — extract `processBundle(text, state)`; `processInbox` becomes a wrapper |
| `app/(tabs)/notes.tsx` | **NEW** — Notes tab UI |
| `app/(tabs)/_layout.tsx` | Register Notes tab |
| Main app shell (existing 2-min inbox interval site) | Add 4h notes batch interval alongside existing intervals |
| Headless runner | Add 4h scheduled task calling `runNotesBatch(state)` |
| [docs/new_architecture_typescript.md](docs/new_architecture_typescript.md) | Sections 3, 4, 5, 6, 9, 12 |
| [README.md](README.md) | Feature list, Data Files, Modules, tree |
| `packages/feature-kit/features/FEAT026_.../` | Status updates as the feature progresses |

---

## Testing Notes

### Unit tests

- [ ] **`notesStore.test.ts`** —
  - `addNote` creates pending note with id and current timestamp.
  - `markProcessing` / `markProcessed` / `markFailed` transitions are correct; `markFailed` increments `attemptCount` and sets `lastError`; `markProcessed` clears `lastError`.
  - `recoverStaleProcessing` flips `processing` → `pending` without incrementing `attemptCount` and without touching other statuses.
  - `getProcessableNotes` returns `pending ∪ failed where attemptCount < 5`, in `createdAt` order; excludes `processed` and `failed-at-cap`.
  - `editNote` on `pending` updates text only.
  - `editNote` on `failed` updates text AND resets `attemptCount` to 0 AND clears `lastError`.
  - `editNote` on `processing` throws.
  - `editNote` on `processed` throws.
  - `deleteNote` on `processing` throws.
  - `deleteNote` on every other status removes the note from the array.
  - `retryNote` on `failed` resets `attemptCount` to 0, clears `lastError`, flips status to `pending`.
  - `searchNotes("foo")` returns notes whose text contains "foo" case-insensitively.
  - `searchNotes("foo", "pending")` filters by both query AND status.
  - `searchNotes("")` returns all notes.
- [ ] **`notesProcessor.test.ts`** — happy path (mocks `processBundle`); failure path (notes revert to pending with lastError, attemptCount++); empty queue (no-op, no LLM call); concurrent invocation (second call short-circuits via lock).
- [ ] **`inbox.test.ts` (refactor regression)** — existing inbox processing still works after `processBundle` extraction.

### Integration tests (manual)

- [ ] Add 5 notes, tap Process, verify all 5 transition pending → processing → processed in the UI.
- [ ] Add 3 notes, kill the app, reopen — verify they are still pending and visible.
- [ ] Add 3 notes, tap Process, kill app while spinner is showing — reopen and verify they are pending again (not stuck in processing).
- [ ] Disable network, tap Process — verify notes go to `failed` status with error visible; re-enable network, tap Process again, verify success.
- [ ] Add 1 note that's 5000+ characters — verify chunker handles it and a single note still processes.
- [ ] Add 50 notes, tap Process — verify completion and that token usage is materially less than 50 individual chat submissions would be.
- [ ] Leave app open for 4h with 1 pending note — verify auto-batch fires and processes it.
- [ ] Close app with pending notes, run headless runner — verify it processes them.
- [ ] Add 10 notes with varying text, type a substring in the search bar — verify the list filters live as I type and reset clears the filter.
- [ ] Apply the `failed` status filter — verify only failed notes show.
- [ ] Edit a `pending` note — verify the new text is saved and the status stays `pending`.
- [ ] Edit a `failed` note — verify text saves, `attemptCount` resets, error clears, next batch picks it up.
- [ ] Try to edit a `processed` note — verify the edit affordance is hidden / disabled.
- [ ] Delete a `pending` note — verify it disappears immediately, no confirmation.
- [ ] Delete a `processed` note — verify the confirmation dialog appears with the audit warning.
- [ ] Try to delete a `processing` note — verify the trash icon is disabled.

### Encryption audit checklist

- [ ] `notes.json` is in `SENSITIVE_FILES`.
- [ ] On disk after first add, `notes.json` is binary (encrypted), not plaintext JSON. Verify with a hex dump.
- [ ] `notesStore.ts` and `notesProcessor.ts` have zero `fs`/`path`/`node:*` imports.
- [ ] All reads via `readJsonFile`, all writes via `writeJsonFile`.
- [ ] No `console.log(note.text)` in production paths.
- [ ] Test fixtures contain only fictional content (`"Note A"`, `"Project X update"`).
- [ ] No real names, companies, or family details in test files (per `CLAUDE.md` "No Real User Data" rule).

### Regression tests

- [ ] Inbox processing (`inbox.txt` flow) still works after `processBundle` refactor.
- [ ] Existing intervals (inbox 2min, nudges 2min, state refresh 5min) still fire.
- [ ] Other tabs (Chat, Tasks, Focus) unchanged.

---

## Open Questions

- **Write attribution to individual notes.** v1 sets `writeCount = totalWrites` on each processed note (flag-style). Acceptable, or should we attempt LLM-based attribution? My recommendation: keep flag-style for v1, revisit only if the count is misleading users.
- **Headless runner location.** Need to confirm where the 4h schedule registration lives (likely in `scripts/headless-runner.ts` — to be confirmed during Step 1).
- **Cross-process lock.** App + headless run mostly mutually exclusively. Do we need a file-based lock to be safe, or is the in-memory ref enough? My recommendation: in-memory ref for v1 (matches inbox's existing pattern); add file lock only if we observe a real conflict.
- **Today's Notes window.** "Today" = same calendar day in user timezone (`state.userProfile.timezone`)? Or last 24h rolling? My recommendation: calendar day in user TZ, mirroring how the rest of the app handles "today".
- **Retention of old processed notes.** Keep forever? Auto-archive after N days? My recommendation: keep forever in `notes.json` for v1; UI hides them after today. Add an archive job in a follow-up.
- **What does "Process" do if there are zero pending notes?** My recommendation: button is disabled when queue is empty.
- **Should the user see which notes were in the most recent batch?** My recommendation: yes, group by `processedAt` timestamp in the UI when scrolling history (post-v1).
- ~~**Failure cap.**~~ **RESOLVED:** `MAX_ATTEMPTS = 5`. After 5 failed attempts, the note stays `failed` and is excluded from automatic batches. The user can tap "Retry" on any failed note to reset `attemptCount` to 0 and flip it back to `pending`. See `getProcessableNotes` in Architecture Notes and the Status Transitions table.
