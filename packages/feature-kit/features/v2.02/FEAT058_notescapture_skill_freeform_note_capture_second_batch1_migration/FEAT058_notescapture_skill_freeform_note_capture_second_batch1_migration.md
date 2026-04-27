# FEAT058 — `notes_capture` skill (free-form note capture, second batch-1 migration)

**Type:** feature
**Status:** Approved by user 2026-04-27 — stages 3–7 ran. **Stage 2 review notes:** all 5 open Qs deferred to architect; PM proposals accepted. Q1 context keys = userProfile + userToday + topicList + existingTopicHints (no tasksIndex/contradictionIndex needed); Q2 noun-prefixed triggers ("note", "idea", "remember") to avoid general_assistant overlap; Q3 verbatim text (no LLM cleanup); Q4 single tool `submit_note_capture`; Q5 topic auto-tag stays server-side in executor; 5/5 strict parity threshold.
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02 (Phase 2 — third deliverable; second per-intent migration)
**Tags:** skill-migration, notes, batch-1, template-validation
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done), FEAT051 (Done), FEAT055 (Done), FEAT056 (Done), FEAT057 (Done — established the migration template)
**Unblocks:** FEAT059+ (calendar, inbox_triage, emotional_checkin migrations)

---

## Status

Draft — awaiting human review before architect picks it up for stages 3–4.

---

## Problem Statement

Notes are created implicitly today. The user says *"save this idea: ..."*
or *"add a note: ..."* and the legacy `general` intent (Haiku fallback)
decides whether to create a note. There's no explicit `note_capture` intent
in `IntentType`. Note writes happen via:

- **`bulk_input`** — when the user dumps text into the inbox, the LLM
  parses and may create notes alongside tasks/events/facts. (Out of
  scope for FEAT058.)
- **`topic_note`** — note-pinned-to-topic. (Migrating with FEAT083 Topics
  skill, not here.)
- **`general` (catch-all)** — Haiku fallback decides notes from chat
  phrases. Behavior is implicit and inconsistent.

This implicit-routing approach has two costs:
1. **Inconsistent UX.** Same phrasing might or might not create a note,
   depending on the Haiku fallback's mood.
2. **No clean v4 skill exists for "I want to capture an idea."**
   `general_assistant` is the freeform skill but its prompt explicitly
   redirects on specialized actions. Note capture should have its own
   specialized skill.

This FEAT creates a `notes_capture` v4 skill that explicitly handles
note-capture phrases. Same migration template as FEAT057 (single tool +
array writes + delegate to `executor.applyWrites`), smaller surface,
validates that the FEAT057 pattern generalizes.

---

## Goals

1. A `notes_capture` skill folder exists, loads at boot, and routes via
   FEAT051 for note-capture phrases.
2. Phrases like *"save this idea: stash interview prep"*, *"add a note:
   the API redesign needs a security review"*, *"remember this: ..."*
   route to `notes_capture` and produce a real note in `state.notes`.
3. The skill writes through `executor.applyWrites` — same dedup /
   conflict / topic-tagging pipeline as task_management uses. No
   reimplementation.
4. After FEAT058 ships, *"save this idea"*-style phrases no longer route
   to `general_assistant` via fallback. They route to `notes_capture`
   and produce a structured note immediately.
5. Setting `setV4SkillsEnabled([])` reverts all phrases to legacy paths.
   No regression in 300 baseline tests.
6. The migration template established by FEAT057 (single tool with
   `writes` array, direct `applyWrites` import, lazy executor import)
   reuses cleanly. If anything in the template breaks at the second
   instance, surface and fix in this FEAT.

---

## Success Metrics

- Skill loads at boot (`Loaded skill: notes_capture` in registry log).
- 5-phrase regression set produces correct `Note` writes in `state.notes`
  via the v4 path (5/5 — strict, since the template is now proven on
  FEAT057).
- Setting `setV4SkillsEnabled([])` reverts all 5 phrases to the legacy
  `general` intent path.
- All 300 existing tests pass after FEAT058. New skill tests added.
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Capture a free-form note via v4

**As a** user, **when** I say *"save this idea: hire a security consultant
for the API redesign"*, **I want** v4 to create a real note with that
text, **so that** my idea is captured immediately and consistently.

**Acceptance Criteria:**
- [ ] Given `notes_capture` is in `setV4SkillsEnabled`, when I send
      *"save this idea: ..."*, then a `Note` is added to `state.notes`
      with `text` containing the captured content, `status: "pending"`,
      and a generated `id` and `createdAt`.
- [ ] Chat reply confirms the action ("Saved as note: ...") with a
      *via notes_capture* badge.
- [ ] Same phrase with `setV4SkillsEnabled([])` produces a note via the
      legacy `general` path (or doesn't create one — depending on
      Haiku's mood, which the v4 path replaces).

### Story 2 — Note vs. task disambiguation

**As a** user, **when** I say something that could be either a task or a
note, **I want** the system to do what I asked and not silently convert
between them.

**Acceptance Criteria:**
- [ ] Given an explicit note phrase (*"add a note: ..."*, *"save this:
      ..."*, *"remember this idea: ..."*), routes to `notes_capture` and
      produces a note (not a task).
- [ ] Given an explicit task phrase (*"add a task to ..."*), routes to
      `task_management` and produces a task (not a note). Verified by
      regression: FEAT057's 10-phrase set still passes.
- [ ] Given an ambiguous phrase (e.g., *"jot down: review the contract"*),
      router's confidence gate decides; if it picks `notes_capture` →
      note created; if it picks `general_assistant` via fallback →
      redirect message. Document expected outcome per phrase in the
      regression fixture.

### Story 3 — Skill writes through executor (preservation)

**As a** developer, **I want** the v4 notes skill's writes to go through
the same `executor.applyWrites` pipeline as today, **so that** any
dedup / conflict / topic-tagging logic that applies to notes is preserved.

**Acceptance Criteria:**
- [ ] Handler delegates to `executor.applyWrites` exactly as
      task_management does. No reimplementation.
- [ ] When the v4 skill creates a note whose text matches an existing
      topic by embedding similarity, the topic auto-tag fires (same
      path `topicManager.recordSignal` runs from for the existing
      flow).
- [ ] After FEAT057's `flush(state)` fix in chat.tsx, v4 note writes
      persist on app restart. Already covered by the FEAT057 chat hook
      change — no new chat.tsx changes needed.

### Story 4 — Dual-path coexistence

**As a** developer, **I want** to flip `notes_capture` off without code
changes, **so that** if v4 produces wrong note text I can revert
instantly.

**Acceptance Criteria:**
- [ ] Given `setV4SkillsEnabled` excludes `notes_capture`, when I send
      *"save this idea ..."*, then v4 dispatcher returns null →
      chat falls through to legacy `general` path.
- [ ] Given full enabled set, v4 wins. Same `[skillDispatcher] dispatch
      skill=notes_capture` log entry.

### Story 5 — Migration template validation

**As a** developer / architect, **I want** FEAT058 to expose any places
where the FEAT057 template doesn't generalize, **so that** the gaps get
fixed before batch 1 expands further.

**Acceptance Criteria:**
- [ ] FEAT058's skill folder follows the same shape as
      `src/skills/task_management/`: manifest + prompt + context.ts +
      handlers.ts.
- [ ] Handler structure mirrors task_management's (validate args, build
      ActionPlan, lazy-import `applyWrites`, defensive try/catch around
      the call, return `{ success, userMessage, items, data }`).
- [ ] Context resolver requires no new keys (notes don't need any
      key beyond what FEAT057 added — verify during stage 3).
- [ ] If anything in the template needs change to fit notes (e.g. the
      handler shape, the ActionPlan mapping), document the change in
      stage 3 and update FEAT057's pattern note in AGENTS.md.

### Story 6 — No regression elsewhere

**As a** user, **I want** every other intent to behave exactly as
before FEAT058.

**Acceptance Criteria:**
- [ ] All 300 pre-FEAT058 tests still pass.
- [ ] Manual smoke check (post-merge) on three non-notes phrases:
      *"add a task to ..."* (task_management), *"what should I focus
      on?"* (priority_planning), *"tell me a joke"*
      (general_assistant) — each produces the same response as before
      FEAT058.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **`bulk_input` migration** — multi-item paste/inbox processing is its
  own beast (parses N items, writes to multiple files). Will be its own
  FEAT later in the migration sequence.
- **`topic_note` migration** — note-pinned-to-topic is part of FEAT083
  (Topics skill) where it naturally fits.
- **Notes UI changes** — the existing notes tab is unaffected.
- **Notes search / query** — the v4 skill captures notes; querying is
  legacy `info_lookup` for now (its own future migration).
- **Note-to-task conversion** — out of scope. User must explicitly say
  task vs. note.
- **Audit log of note writes** — Phase 3.
- **Privacy filter on notes** — Phase 3 (note: `notes:work` /
  `notes:personal` split per `03_memory_privacy.md` is a Phase 3
  concern).
- **Legacy cleanup** — there's nothing to clean up since `note_capture`
  isn't a legacy intent. The legacy path is `general` (Haiku fallback)
  which we don't remove.

---

## Assumptions & Open Questions

**Assumptions:**
- `Note` shape (id, text, createdAt, status, processedAt, writeCount,
  processedSummary, attemptCount, lastError) is already the canonical
  notes type. Skill writes match this shape.
- `executor.applyWrites` already supports `file: "notes"` writes (it does
  per the existing implicit `general` → note flow).
- Notes writes don't need a complex context — handler can write a note
  with minimal pre-context (no tasksIndex, no calendarEvents).
- The FEAT057 migration template (single tool + array writes + lazy
  executor import + try/catch) generalizes to notes without
  modification.

**Open Questions for the Architect:**
1. What context keys does `notes_capture` need? PM proposes:
   `userProfile`, `userToday`, `topicList`, `existingTopicHints`. No
   need for `tasksIndex` / `contradictionIndexDates` (notes don't
   conflict with tasks/events the way tasks/events conflict with each
   other). Confirm.
2. Should `notes_capture` triggerPhrases overlap with the
   `general_assistant` triggers? Risk: if both score similarly on
   "save this idea", routing is non-deterministic. Recommendation: make
   `notes_capture` triggers explicit and noun-prefixed ("note", "idea",
   "remember this") so the embedding distance is clear.
3. **What does the LLM do with the user's text?** Two paths:
   - (a) **Verbatim** — the note `text` is the user's phrase minus the
     command prefix ("save this idea: X" → text="X").
   - (b) **Light editing** — LLM cleans up the text (capitalization,
     punctuation), maybe extracts a title separately.
   PM proposes (a) — verbatim is simpler and respects user intent.
   Architect call.
4. **One tool or two?** task_management has `submit_task_action`
   covering create/update/query. notes_capture is create-only for v2.02
   (queries are out of scope). Single tool `submit_note_capture` makes
   sense. Confirm.
5. **What about the `topicSignal`?** When a note's text matches a topic,
   `executor.applyWrites` records the signal. Does the skill prompt
   need to know about topics to suggest tagging? PM proposes no —
   topic auto-tag happens server-side in the executor, no LLM
   awareness needed. Architect to verify.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27 (workflow stage 3). Full design
review in `FEAT058_design-review.md`.*

### Open-question resolutions (PM proposals confirmed)

| Q | Decision |
|---|---|
| 1 — Context keys | `userProfile`, `userToday`, `topicList`, `existingTopicHints`. No tasksIndex/contradictionIndex (notes don't conflict with time blocks). All four already in dispatcher's resolver from FEAT057 — zero resolver changes needed. |
| 2 — Trigger phrases | Noun-prefixed for unambiguous routing: "note", "idea", "remember this", "save this idea", "write this down", "capture this", "jot down", "thought:". Distinct enough from general_assistant's conversational triggers ("tell me a joke", etc.). |
| 3 — Text handling | **Verbatim.** Skill prompt directs the LLM to extract the user's content as-is (after the command prefix). No paraphrasing, no editing, no title extraction for v2.02. |
| 4 — Tool count | **Single tool** `submit_note_capture` with `writes[]` array — matches FEAT057 pattern. |
| 5 — Topic auto-tag awareness | Server-side only. Executor's `applyWrites` records `topicSignals` automatically when note text matches a topic by embedding similarity. Skill prompt does NOT include topic-tagging instructions. |

### Data Models — no new types

Reuses `Note` (line 216-232 of `src/types/index.ts`) as-is. Skill writes
`{ file: "notes", action: "add", data: <Note shape> }`.

### Skill folder spec

```
src/skills/notes_capture/
├── manifest.json     # id "notes_capture", model haiku, tools: [submit_note_capture]
├── prompt.md         # ~25 lines — verbatim capture rules
├── context.ts        # 4 keys (no new resolver work)
└── handlers.ts       # delegates to executor.applyWrites with defensive Note defaults
```

**`manifest.json`:**

```jsonc
{
  "id": "notes_capture",
  "version": "1.0.0",
  "description": "Capture free-form notes and ideas verbatim. Handles 'save this idea', 'add a note', 'remember this', 'write this down'. Does NOT paraphrase or summarize — text is captured as-is. Topic auto-tagging happens server-side in the executor.",
  "triggerPhrases": [
    "save this idea",
    "add a note",
    "remember this",
    "write this down",
    "capture this",
    "jot down",
    "note that",
    "save this",
    "remember the idea"
  ],
  "structuralTriggers": ["/note", "/idea"],
  "model": "haiku",
  "dataSchemas": {
    "read": ["notes", "topics", "objectives"],
    "write": ["notes"]
  },
  "supportsAttachments": false,
  "tools": ["submit_note_capture"],
  "autoEvaluate": true,
  "tokenBudget": 2000,
  "promptLockedZones": [],
  "surface": null
}
```

**`prompt.md`** (~25 lines — focused on verbatim capture):

```markdown
You are the notes capture specialist. Your job is to capture the user's
note verbatim — exactly as they said it, minus the command prefix.

You will receive in context:
- `userProfile` — timezone, working hours
- `userToday` — today's date
- `topicList` — known topics (informational only — do NOT tag)
- `existingTopicHints` — informational only

Always respond using the `submit_note_capture` tool.

Rules:
- Extract the user's note text verbatim. Remove only the command prefix
  ("save this idea: X" → text = "X"). Do not paraphrase, summarize, or
  edit punctuation.
- Set `writes` to one entry: `{ action: "add", data: { text: <captured>, status: "pending" } }`.
  The handler fills in defaults for the other Note fields.
- Confirm in `reply` with a short acknowledgement: "Saved: <first 60 chars>"
  or "Added to notes: <first 60 chars>". Match user's tone (formal /
  casual based on phrasing).
- If the captured text would be empty (user said "save this" with no
  content), set `needsClarification: true` and ask "What would you like
  to save?".

What you do NOT do:
- Do NOT tag topics — the executor does that automatically. Don't
  mention topics in your reply unless the user explicitly asked.
- Do NOT create tasks or events. If the user clearly wants a task ("add
  a task to ..."), set `needsClarification: true` and tell them to use
  the task handler.
- Do NOT write to any file other than notes.
```

**`context.ts`:**

```ts
import type { ContextRequirements } from "../../types/skills";

export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  topicList: true,
  existingTopicHints: true,
};
```

**`handlers.ts`:**

Same shape as `task_management/handlers.ts`. Handler:
1. Validates writes (single tool, file is forced to "notes")
2. **Defensively fills in required Note defaults** for `add` actions:
   `status: "pending"`, `processedAt: null`, `writeCount: 0`,
   `processedSummary: null`, `attemptCount: 0`, `lastError: null`. The
   executor adds `id` and `createdAt` per its existing default-branch
   logic for array-based files.
3. Builds `ActionPlan`, lazy-imports `applyWrites`, calls it inside
   try/catch (B1 pattern from FEAT057).
4. Returns `{ success, userMessage, items, data, ... }`.

### Boot wiring

```ts
// app/_layout.tsx — append to the FEAT057 array
setV4SkillsEnabled(["priority_planning", "general_assistant", "task_management", "notes_capture"]);
```

### chat.tsx integration

**Zero changes.** FEAT057's chat.tsx wiring (items pass-through + flush
after dispatch) already handles all the cases this skill needs.

### Service Dependencies

| Internal | Used for |
|---|---|
| `src/modules/executor.ts` (`applyWrites`) | Persists Note via the existing default-branch logic |
| `src/modules/skillRegistry.ts` | Boot loading |
| `src/modules/router.ts` | Routing |
| `src/modules/skillDispatcher.ts` | Dispatch |

No third-party deps added. No new dispatcher resolver keys. No type
changes.

### Design Patterns

- **Same as FEAT057.** Single tool, array writes, lazy executor import,
  defensive try/catch around `applyWrites`. Story 5 of the spec exists
  to *prove* this generalizes — and it does.
- **Defensive Note defaults in handler.** The executor sets `id` and
  `createdAt`, but the rest of the Note shape (status, processedAt,
  etc.) needs a default fill. This is the only meaningful difference
  from `task_management`'s handler. Document in handler comment so
  FEAT059+ can pattern-match.

### New vs. Reusable Components

**New:**
- `src/skills/notes_capture/` (4 files, all small)
- `src/skills/notes_capture.test.ts` (5-phrase fixture + handler tests)

**Touched:**
- `app/_layout.tsx` — append to enabled set

**Reusable as-is:**
- `executor.applyWrites` — handles `notes` writes via default branch
- Dispatcher's resolver — already supports the 4 context keys this skill
  needs
- chat.tsx hook — items + flush already wired by FEAT057

### Risks & Concerns

- **Trigger phrase overlap with general_assistant.** Mitigation: noun-
  prefixed triggers + general_assistant's prompt explicitly redirects
  on "save this idea" (it knows about specialized handlers). If the
  router still picks general_assistant for a clear notes phrase,
  retune triggers in a follow-up — small prompt patch.
- **LLM might emit non-verbatim text** despite the prompt rule.
  Mitigation: regression fixture asserts the exact captured text.
- **Defensive Note defaults:** if the executor's default-branch logic
  for "notes" file changes in the future, the handler's defaults could
  drift. Mitigation: a unit test asserts the Note shape produced by the
  handler matches the type. If the type changes, the test fails.
- **Notes don't have FEAT040-style admission control.** Notes are
  always free to create. No new conflict logic needed.

### UX Review Notes

UX scope: zero new screens. Reply is short ("Saved: ..."). Existing
notes tab renders the new note via the existing notes-list component.

### Testing Notes

#### Unit Tests Required
- Handler with no state — returns plan in `data`, no executor call.
- Handler with stub state — calls applyWrites with file="notes",
  Note defaults filled.
- Handler defensive defaults: Note has all 8 required fields populated.
- Handler graceful failure on applyWrites throw (B1 pattern).
- Handler propagates clarificationRequired (empty-text case).

#### Component Tests Required
- Skill loads via FEAT054 production registry (smoke).
- Manifest declares notes_capture as freeform-tier
  (model="haiku", surface=null, no locked zones).

#### Integration Tests Required
- 5-phrase regression fixture, all create operations:
  1. "save this idea: hire a security consultant" → text="hire a security consultant"
  2. "add a note: remember to follow up with Sarah" → text="remember to follow up with Sarah"
  3. "remember this: API redesign blocked on auth" → text="API redesign blocked on auth"
  4. "jot down: weekly review process is broken" → text="weekly review process is broken"
  5. "save this" (empty) → needsClarification=true, no write

#### Regression Tests Required
- Full `npm test` passes (current 300 baseline + ~10 new).
- `npm run build:web` exports.

#### Scope Isolation Tests Required
**No** — privacy filter ships in Phase 3.

#### Agent Fixtures Required
**No** — handler tests use stub LLM with canned `submit_note_capture` args.

---

## UX Notes

[**To be filled after architect review.** UX scope: zero new screens.
Reply confirms the capture ("Saved as note: ..."). The badge from
FEAT056 ("via notes_capture") appears under the bubble.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.**
Required:
- Skill folder loads via FEAT054 (smoke check).
- Handler tests with stub state — assert applyWrites called with right
  shape.
- 5-phrase regression fixture co-located in test file.
- Bundle gate.
- Full `npm test` regression (300 baseline).]
