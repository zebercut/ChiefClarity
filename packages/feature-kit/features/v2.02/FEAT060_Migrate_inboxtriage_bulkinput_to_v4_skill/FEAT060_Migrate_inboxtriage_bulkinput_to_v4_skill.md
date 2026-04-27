# FEAT060 — Migrate `inbox_triage` / `bulk_input` to a v4 skill

**Type:** feature
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02 (Phase 2 — fifth deliverable)
**Tags:** skill-migration, inbox, bulk-input, batch-1, template-application, multi-file-write
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done), FEAT051 (Done), FEAT055 (Done), FEAT056 (Done), FEAT057 (Done — migration template), FEAT058 (Done — template generalized for create-only), FEAT059 (Done — template applied to a third CRUD intent)
**Unblocks:** Future FEAT026 notes-processor skill alignment; Phase-3 admission-control rollout for inbox-derived calendar events

---

## Status

Planned — PM has authored the spec. Awaiting human review before the
architect picks it up for stages 3–4 (design notes + design review).

---

## Problem Statement

`bulk_input` is the legacy intent that handles **batch text processing** —
arbitrary free-form dumps that may contain a mix of action items, calendar
events, profile/lifestyle updates, OKR progress notes, observations, and
emotional state in a single blob. Today it has two entry points:

1. **Timer-driven (the main one).** The app polls `inbox.txt` every 2
   minutes via `processInbox` (`src/modules/inbox.ts`). When the file
   has stable, non-empty content, the module chunks it (~2000 tokens
   per chunk via `chunkText`), runs each chunk through
   `assembleContext` → `callLlm("bulk_input")` → `applyWrites`, then
   clears the file if all chunks succeeded. The same `processBundle`
   pipeline also feeds the `notesProcessor` (FEAT026) when a
   structured note batch needs LLM processing.
2. **Chat-driven.** A user can paste a bulk dump directly into chat;
   the regex router maps it to the `bulk_input` intent (`router.ts`,
   `TOKEN_BUDGETS.bulk_input = 6000`), and the assembler `switch`
   case routes it through the same
   `SYSTEM_PROMPT § Bulk Input` rules (`prompts.ts:181-222`).

Both paths share the same prompt block and the same executor surface.
That is exactly the kind of intent the v4 skill template was designed
to absorb — *one prompt, one tool, defensive defaults, applyWrites
does the rest* — except for two extensions this FEAT introduces:

- **First multi-file-write skill.** Every prior migration writes to a
  single file (`tasks`, `notes`, `calendar`). Inbox dumps legitimately
  span tasks + calendar + notes + (occasionally) profile / lifestyle /
  observations. The skill's `dataSchemas.write` is therefore an array
  of file keys, and the handler must NOT force a single `file` value
  on every write. `executor.applyWrites` already handles this — each
  `WriteOperation` carries its own `file`.
- **Entry-point-agnostic skill.** The skill itself is the
  "language → writes" core. It is invoked by **both** the
  `processInbox` timer (every 2 minutes via the in-app interval) and
  the chat dispatcher when the user pastes a bulk dump. The timer
  path stays in `inbox.ts` and continues to perform stability checks,
  size limiting, chunking, and post-success file clearing — it just
  swaps `callLlm("bulk_input")` for
  `dispatchSkill("inbox_triage", chunk, state)`. The chat path goes
  through the FEAT051 router → FEAT054 dispatcher in the usual way.

This FEAT migrates that flow to a v4 skill `inbox_triage` and proves
the migration template extends cleanly to (a) multi-file writes and
(b) non-chat entry points.

---

## Goals

1. An `inbox_triage` skill folder exists, loads at boot, and routes
   via FEAT051 for typical bulk-dump phrases plus the explicit
   timer-driven invocation from `inbox.ts`.
2. The skill's handler produces the **same writes** (across tasks,
   calendar, notes, and any other in-scope legacy targets) as
   today's `bulk_input` legacy path for an equivalent input chunk.
3. The legacy chunking + stability-check + clear-on-success behavior
   in `processInbox` is preserved end-to-end. Chunking stays in
   `processBundle`; the skill receives one chunk at a time.
4. Setting `setV4SkillsEnabled([])` reverts to the legacy path
   (`callLlm("bulk_input")`) for both timer-driven and chat-driven
   entry.
5. The bulk-input parsing rules from
   `SYSTEM_PROMPT § Bulk Input` (`prompts.ts:181-222`) — including
   the source-note attribution block — are preserved verbatim in
   the new skill prompt. No behavior drift.
6. The recurring-event guard from `SYSTEM_PROMPT:179` is also
   reproduced in the skill prompt (bulk dumps regularly contain
   "every Friday …" items that must become RecurringTasks, not
   CalendarEvents). Same precedent as FEAT059.
7. No regression in the existing test baseline (current 315+ tests
   plus the suites added by FEAT057/058/059).
8. The migration template (single tool + array writes + lazy
   executor import + try/catch + defensive defaults) is reused with
   **only the documented extensions** (multi-file write +
   entry-point-agnostic invocation). If anything else needs
   adjustment, surface and fix.

---

## Success Metrics

- Skill loads at boot and is listed by the dispatcher.
- The 6-phrase regression set produces correct writes across the
  expected files via the v4 path (≥5/6).
- The timer-driven `processInbox` flow, when run against a fixture
  inbox blob, produces the same write set under v4 as under legacy
  (golden-output diff or structural equivalence — architect's call).
- Setting `setV4SkillsEnabled([])` reverts both timer and chat paths
  to legacy.
- All existing tests pass.
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Timer-driven inbox processing via v4

**As a** user, **when** I drop a multi-item dump into `inbox.txt` and
the 2-minute interval fires, **I want** the v4 skill to parse every
item and apply the same set of writes the legacy `bulk_input` path
would have applied.

**Acceptance Criteria:**
- [ ] Given `inbox_triage` is enabled and `inbox.txt` contains a
      stable blob with N distinct items (mixed tasks / events /
      notes), the next `processInbox` cycle calls the v4 skill once
      per chunk.
- [ ] The skill's combined writes cover all N items, each with the
      correct `file` value (`tasks`, `calendar`, `notes`, etc.) — no
      item dropped, none misrouted.
- [ ] On full success, `inbox.txt` is cleared exactly as today
      (same `clearInbox` logic in `inbox.ts` — unchanged).
- [ ] On any chunk failing (LLM returns no plan / handler error),
      the file is **not** cleared and the next cycle retries — same
      legacy contract.
- [ ] Same input with `setV4SkillsEnabled([])` produces the same
      write set via the legacy `bulk_input` flow.

### Story 2 — Chat-driven bulk paste via v4

**As a** user, **when** I paste a multi-item dump directly into the
chat input, **I want** the v4 path to handle it identically to the
inbox path.

**Acceptance Criteria:**
- [ ] Pasting *"Task A by Friday. Meeting with Contact A Tue 3pm.
      Idea: Project X needs a kickoff doc."* routes to
      `inbox_triage`.
- [ ] The handler produces three writes: one task, one calendar
      event, one note.
- [ ] Chat reply uses the per-action bullet format defined in the
      legacy prompt (`prompts.ts:216-222`) with the
      *via inbox_triage* badge.
- [ ] Same paste with `setV4SkillsEnabled([])` produces an identical
      write set via the legacy flow.

### Story 3 — Source-note attribution preserved

**As a** developer of the FEAT026 notes processor, **I want** the
v4 skill to honor the `[note <id> @ <ts>]` marker convention, **so
that** writes generated from a structured note batch carry
`sourceNoteId` and the per-note "what was done" UI keeps working.

**Acceptance Criteria:**
- [ ] When the input chunk contains `[note <id> @ <ts>]` markers,
      every write produced for that block carries the `sourceNoteId`
      verbatim from the marker.
- [ ] If a single note produces multiple writes, all share the same
      `sourceNoteId`.
- [ ] When the input has no markers (regular inbox path), no write
      carries a `sourceNoteId` (or the field is undefined / null).
- [ ] The skill's `prompt.md` includes the verbatim source-note
      attribution block from
      `SYSTEM_PROMPT § Bulk Input → Source-note attribution`.

### Story 4 — Multi-file write template extension

**As an** architect, **I want** the handler to fan writes out across
files based on each write's own `file` value (rather than forcing
one file per skill), **so that** the migration template generalizes
from single-file CRUD skills to mixed-target skills.

**Acceptance Criteria:**
- [ ] `inbox_triage`'s `manifest.json` declares `dataSchemas.write`
      as an array of multiple file keys (architect picks the exact
      set — see Open Question 4).
- [ ] The handler accepts each write's own `file` value (validated
      against an allowlist) instead of overwriting it with a single
      constant. Writes whose `file` is missing or not in the
      allowlist are dropped (defensive).
- [ ] `executor.applyWrites` is called once with the aggregated
      plan; it dispatches per-write to the right file path with no
      skill-side fan-out.
- [ ] Architect documents the multi-file write convention in
      `AGENTS.md` so future multi-target skills can reuse it.

### Story 5 — Migration template validation

**As an** architect, **I want** FEAT060 to ship with the smallest
possible deltas to shared infrastructure (chat.tsx, dispatcher
SUPPORTED_KEYS structure, shared types), **so that** the template
remains canonical and any new resolver / context keys are clearly
attributed.

**Acceptance Criteria:**
- [ ] No changes to `app/(tabs)/chat.tsx`.
- [ ] No changes to `src/types/orchestrator.ts` or
      `src/types/index.ts`. (`IntentType` keeps `bulk_input` until
      the legacy cleanup FEAT removes it after parity bake-in.)
- [ ] Any new context-resolver keys are additive branches in
      `skillDispatcher.computeContextValue` (mirrors FEAT057's
      `buildTaskIndex` and FEAT059's `getActiveEvents`).
- [ ] If anything beyond additive resolver branches is required
      (e.g., a per-write `file` allowlist on the handler validator),
      surface the divergence in stage 3/4 and update AGENTS.md.

### Story 6 — Bulk-input parsing rules + recurring guard preserved

**As a** developer, **I want** every parsing rule from the legacy
`SYSTEM_PROMPT § Bulk Input` (`prompts.ts:181-222`) **and** the
recurring-event guard from `SYSTEM_PROMPT:179` to be present in the
new skill's prompt verbatim, **so that** behavior does not silently
drift between paths.

**Acceptance Criteria:**
- [ ] The verbatim block covers: "process EVERY item", "do NOT set
      `needsClarification`", "check `tasksIndex` and `calendarEvents`
      to avoid duplicates", per-action bullet format with examples,
      "zero actions" wording, and the source-note attribution
      sub-rules.
- [ ] An automated test asserts that the prompt file contains the
      key load-bearing strings (architect picks the assertion shape
      — string match or token-set match).
- [ ] Recurring-event guard from `SYSTEM_PROMPT:179` is reproduced
      in this skill's prompt. A regression test verifies that
      *"every Friday at 4pm I have a team check-in"* in an inbox
      blob produces a `recurringTasks` write, never a calendar
      event with `recurring`/`recurrence`/`recurrenceDay` fields.
      Same defense pattern as `calendar_management` (FEAT059).

### Story 7 — Dual-path coexistence

**Acceptance Criteria:**
- [ ] `setV4SkillsEnabled` excluding `inbox_triage` → legacy
      `bulk_input` runs for both timer and chat entry.
- [ ] Full enabled set → v4 wins for both entry points.
- [ ] No double-processing: timer path does not invoke both legacy
      and v4.

### Story 8 — No regression elsewhere

- [ ] All baseline tests pass (current 315 + suites added by
      FEAT057/058/059, plus the new FEAT060 suite).
- [ ] Manual smoke check on five non-bulk phrases: *"add a task to
      …"* (task_management), *"save this idea: …"* (notes_capture),
      *"schedule a meeting …"* (calendar_management), *"what should
      I focus on?"* (priority_planning), and a fallback general
      assistant phrase — each produces the same response as before
      FEAT060.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **FEAT040 admission control for inbox-derived calendar events.**
  Same deferral pattern as FEAT059 — admission control is its own
  behavioral change, not parity work.
- **Batch summarization / batch admission control.** The skill emits
  one plan per chunk. Cross-chunk summarization or "should we even
  apply this big a batch?" gating is a follow-on FEAT.
- **Replacing the chunker.** Chunking stays in `processBundle()`
  (the orchestrator). Whether the skill could ever consume an
  un-chunked blob is a future concern; for v2.02 it always sees a
  pre-chunked piece.
- **FEAT026 notes-processor skill alignment.** The notes processor
  (which calls `processBundle` for its own structured batches)
  keeps its current orchestrator. Once `inbox_triage` is stable, a
  separate FEAT can refactor the notes processor to call
  `dispatchSkill` directly, but that is not this FEAT.
- **Profile / lifestyle / OKR / observations writes via v4.**
  Architect decides whether the v4 skill emits writes for those
  files in v2.02 or whether they stay legacy-only for one more
  release. See Open Question 4.
- **Legacy cleanup PR.** Removing `bulk_input` from `IntentType`
  and stripping the `SYSTEM_PROMPT § Bulk Input` block is a
  separate FEAT after FEAT060 parity is proven (same pattern as
  FEAT057/058/059).
- **Audit log / privacy filter.** Phase 3.

---

## Assumptions & Open Questions

**Assumptions:**

- `executor.applyWrites` already handles writes spanning multiple
  `file` values correctly — it dispatches each `WriteOperation` to
  the appropriate writer based on its `file` field. The legacy
  `bulk_input` path already exercises this. No executor change
  expected.
- `processBundle`'s chunking, stability check, and
  `clearInbox`-on-success behavior is correct and stays put. Only
  the **inner** call (`callLlm` → `dispatchSkill`) changes.
- The bulk-input section of `SYSTEM_PROMPT` can be lifted verbatim
  into the new skill's prompt without behavioral drift, in the same
  way the recurring guard moved to `calendar_management` in FEAT059.
- The token budget for one chunk is comparable to today's
  `TOKEN_BUDGETS.bulk_input = 6000`. The skill's `tokenBudget` in
  the manifest will likely be 6000 (architect to confirm).

**Open Questions for the Architect:**

1. **Does the timer-driven flow stay in `inbox.ts`?** PM proposes
   yes — `processBundle` keeps chunking, stability checks, and
   clear-on-success behavior, and only its inner LLM call swaps
   from `callLlm("bulk_input")` to
   `dispatchSkill("inbox_triage", chunk, state)`. Confirm the swap
   point and whether the dispatcher's invocation surface is
   suitable for a non-chat caller (it should be — FEAT054 already
   exposes a programmatic dispatch API). If the dispatcher needs a
   small adapter for non-chat callers, surface it in stage 3.

2. **Token budget.** Legacy `TOKEN_BUDGETS.bulk_input = 6000` (the
   highest budget in the table — bulk needs more context room
   because it must cross-check `tasksIndex` and `calendarEvents`
   for dedup). PM proposes the manifest mirrors this with
   `tokenBudget: 6000`. Confirm; flag if the per-chunk size
   (`MAX_CHUNK_TOKENS = 2000`) plus context expansion exceeds the
   skill's effective ceiling.

3. **Chunking strategy.** PM proposes chunking stays in
   `processBundle()` (the orchestrator) and the skill receives one
   pre-chunked piece per call. Alternative: move chunking into the
   skill / dispatcher. PM recommends keeping it in `processBundle`
   because (a) it is entry-point-aware (only inbox-style callers
   chunk; chat input is small), (b) it owns the stability /
   clear-on-success contract that depends on per-chunk success
   bookkeeping, and (c) it is shared with the FEAT026 notes
   processor.

4. **Schema scope — which `file` keys go in `dataSchemas.write`?**
   Legacy bulk_input writes to: `tasks`, `calendar`, `notes`,
   `userProfile` / `userLifestyle` (lifestyle/profile updates),
   `planOkrDashboard` (OKR progress), `userObservations`
   (emotional state), and `contextMemory.facts` (structured facts).
   That is a wide blast radius. Two options:
   - (a) **Full parity.** Declare all of the above in
     `dataSchemas.write` from day one.
   - (b) **Phased parity.** Start with the high-volume cases
     (`tasks`, `calendar`, `notes`, `contextMemory`) and explicitly
     defer profile/lifestyle/OKR/observations writes from the v4
     path; legacy stays the source of truth for those for one more
     release. The skill prompt would tell the LLM to skip those
     categories or emit a clarification.
   PM proposes (a) full parity to avoid splitting a single user
   blob across two paths. Architect's call — (b) is a legitimate
   risk-reduction option if the multi-file allowlist proves
   tricky.

5. **Schema scope — which `file` keys go in `dataSchemas.read`?**
   PM proposes the legacy bulk_input read set:
   `inbox` (the raw text being processed — passed as the phrase),
   `tasks`, `calendar`, `topics`, `objectives`. The skill needs
   `tasksIndex` and `calendarEvents` for dedup (per the legacy
   prompt's "check tasksIndex and calendarEvents to avoid creating
   duplicates"). Both keys already resolve in the dispatcher
   (FEAT057 + FEAT059). Confirm and add `existingTopicHints` /
   `topicList` to mirror notes_capture so topic hinting works for
   the structured-facts case.

6. **Single tool name and arg shape.** PM proposes a single tool
   `submit_inbox_triage` with the canonical shape:

   ```ts
   {
     reply: string;
     writes?: Array<{
       file: FileKey;            // NEW vs prior skills — per-write
       action: "add" | "update" | "delete";
       id?: string;
       data?: Record<string, unknown>;
       sourceNoteId?: string;    // for notes-batch attribution
     }>;
     conflictsToCheck?: string[];
     suggestions?: string[];
     needsClarification?: boolean;
   }
   ```

   This matches FEAT057/058/059 except for the per-write `file`
   field. Confirm the tool definition / JSON schema.

7. **Multi-file allowlist enforcement.** Where does the validator
   live? PM proposes the handler validates each write's `file`
   against the manifest's `dataSchemas.write` array and drops any
   that fall outside. Alternative: rely solely on
   `executor.applyWrites`'s file-key validation. PM proposes
   belt-and-suspenders (handler drops + executor would also reject)
   so the handler never produces a malformed batch.

8. **Defensive defaults helper(s).** Each prior skill defined a
   per-file `fill*Defaults` helper (`fillNoteDefaults`,
   `fillCalendarEventDefaults`). The inbox skill needs a per-file
   map of helpers (one per allowlisted file). PM proposes reusing
   the existing per-file helpers from `notes_capture/handlers.ts`,
   `calendar_management/handlers.ts`, and
   `task_management/handlers.ts` by exporting them. Architect
   picks the import topology — direct imports vs a shared
   `skills/_shared/defaults.ts` module.

---

## Migration Template Confirmation

This is the **fifth** application of the canonical migration template
established by FEAT057 and refined by FEAT058 / FEAT059. Mirror the
following bits **verbatim** unless explicitly extending:

- **Single tool per skill** — `submit_inbox_triage` returning the
  canonical args shape (with the per-write `file` extension; see
  Open Question 6).
- **Array writes** — handler builds `plan.writes` as an array,
  filters malformed entries, returns once via `applyWrites`.
- **Lazy executor import** — `const { applyWrites } = await
  import("../../modules/executor");` inside the handler, not at
  module-load (per AGENTS.md / FEAT057 rule).
- **Try/catch around `applyWrites`** — FEAT057 B1 pattern. Capture
  into `writeError`; surface via `userMessage` on failure; handler
  never throws.
- **Defensive defaults per write** — per-file helpers fill the
  required fields the LLM may omit (extension: a map keyed by
  `file` rather than a single helper).
- **`setV4SkillsEnabled` boot-list addition** — append
  `"inbox_triage"` to the enabled set.
- **Zero infrastructure changes** — no chat.tsx edits, no shared
  type changes, no new types. Resolver additions (if any) are
  additive branches with `SUPPORTED_KEYS` updated, mirroring
  FEAT059's `getActiveEvents` pattern.

**Documented extensions vs prior skills:**

1. **Multi-file write.** Each write carries its own `file` field,
   validated against the manifest's `dataSchemas.write` allowlist.
   First skill to do this; architect documents the convention in
   `AGENTS.md`.
2. **Non-chat entry point.** The skill is invoked both by chat
   (FEAT051 router) and by the `processInbox` timer
   (`inbox.ts` → `dispatchSkill`). The skill itself is unaware of
   which entry point invoked it — same arg shape, same handler.

---

## References

- **Migration template:** FEAT057 (task_management — first
  application), FEAT058 (notes_capture — generalized to
  create-only), FEAT059 (calendar_management — third application
  with safety-rule preservation pattern).
- **Legacy behavior parity source:** `src/modules/inbox.ts`
  (`processBundle`, `processInbox`, `chunkText`, `clearInbox`,
  stability check), `src/constants/prompts.ts:181-222`
  (bulk-input parsing rules + source-note attribution),
  `src/constants/prompts.ts:179` (recurring guard), and
  `src/modules/router.ts` (`TOKEN_BUDGETS.bulk_input = 6000`,
  intent regex routing).
- **Dispatcher / resolver:** `src/modules/skillDispatcher.ts`
  (SUPPORTED_KEYS, `computeContextValue`).
- **Recurring-guard preservation precedent:**
  `src/skills/calendar_management/prompt.md` (FEAT059) and
  `SYSTEM_PROMPT:179`.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27. Full design review in
`FEAT060_design-review.md`.*

### Open-question resolutions

| Q | Decision |
|---|---|
| 1 — Timer flow stays in `inbox.ts` | **Yes.** `processBundle`'s chunk loop swaps `callLlm("bulk_input")` for `dispatchSkill(routeToSkill({ phrase, directSkillId: "inbox_triage" }), chunk, { state })`. The dispatcher is already a programmatic API (`src/modules/skillDispatcher.ts:63`) — no adapter needed. Caller checks `getV4SkillsEnabled().has("inbox_triage")` first; on gate-miss, fall through to legacy `callLlm`. |
| 2 — Token budget | **6000 confirmed** — matches `TOKEN_BUDGETS.bulk_input` in `router.ts:26`. Manifest sets `tokenBudget: 6000`. Per-chunk cap of 2000 input tokens (`MAX_CHUNK_TOKENS`) leaves ~4000 for context + reply, which fits. |
| 3 — Chunking stays in `processBundle` | **Yes.** Chunking is the orchestrator's job, not the skill's. (a) Only inbox-style callers chunk; chat paste is small. (b) Stability-check + clear-on-success bookkeeping is per-chunk. (c) Shared with FEAT026 notesProcessor. AGENTS.md gets a new entry codifying this. |
| 4 — Schema write scope | **Phased six-file allowlist:** `tasks`, `calendar`, `notes`, `contextMemory`, `userObservations`, `recurringTasks`. Profile/lifestyle/OKR writes from inbox stay legacy until a follow-on FEAT (legacy `bulk_input` continues handling those when v4 is gated off; when v4 is on, prompt directs LLM to set `needsClarification` for those categories). `recurringTasks` is in the allowlist because legacy bulk_input writes it today and dropping that capability would be a regression — the recurring guard still applies to *calendar* writes specifically. See design review §3.1 + §4. |
| 5 — Schema read scope | **PM proposal accepted with one tweak.** Read keys: `userToday`, `userProfile`, `tasksIndex`, `calendarEvents`, `topicList`, `existingTopicHints`, `contradictionIndexDates`. (`inbox` is the phrase itself, not a context key.) All seven keys are already in `SUPPORTED_KEYS` from FEAT057-059 — **zero resolver work**. Story 7's "additive resolver branches if needed" allowance is unused. |
| 6 — Tool definition `submit_inbox_triage` | **Confirmed.** Single tool, args: `{ reply: string; writes?: Array<{ file: FileKey; action: "add"\|"update"\|"delete"; id?: string; data?: Record<string, unknown>; sourceNoteId?: string }>; conflictsToCheck?: string[]; suggestions?: string[]; needsClarification?: boolean }`. Per-write `file` is the only deviation from prior skills (FEAT057-059 force `file = "<single>"` in handler). `sourceNoteId` is already a field on `WriteOperation` in `types/index.ts:126` — handler preserves it verbatim. |
| 7 — Multi-file allowlist enforcement | **Belt-and-suspenders (CHOSEN).** Handler validates each write's `file` against the manifest's `dataSchemas.write` array; out-of-allowlist writes are dropped silently with `[inbox_triage] dropped write for unsupported file=...` warn-log. Executor re-validates as defense-in-depth. **This is the template precedent for every future multi-file skill** — codified in AGENTS.md per condition §6.12. |
| 8 — Defaults helpers topology | **Import existing helpers from sibling skill folders.** `notes_capture/handlers.ts` exports `fillNoteDefaults` (visibility-only refactor). `calendar_management/handlers.ts` exports `fillCalendarEventDefaults`. New helpers (`fillTaskDefaults`, `fillContextMemoryFactDefaults`, `fillObservationDefaults`, `fillRecurringTaskDefaults`) live inline in `inbox_triage/handlers.ts` because no sibling skill owns those files yet. Future refactor FEAT (not this one) factors all helpers into `src/skills/_shared/defaults.ts`. PM didn't authorize a refactor; deferred. |

### Data model touches

**None.** `WriteOperation.sourceNoteId` and `FileKey` are already
defined and exercised by legacy `bulk_input`. `IntentType` keeps
`"bulk_input"` until the legacy cleanup FEAT (per Out-of-Scope §).

### API / module touches

| File | Change |
|---|---|
| `src/skills/inbox_triage/manifest.json` | NEW — `dataSchemas.write` is the six-file allowlist; tools = `["submit_inbox_triage"]`; tokenBudget = 6000; model = "haiku". |
| `src/skills/inbox_triage/prompt.md` | NEW — verbatim Bulk-Input rules from `prompts.ts:181-222` + verbatim recurring guard from `prompts.ts:179` + per-write `file` instruction. |
| `src/skills/inbox_triage/context.ts` | NEW — 7 keys (all already in `SUPPORTED_KEYS`). |
| `src/skills/inbox_triage/handlers.ts` | NEW — `submit_inbox_triage`. Per-write file allowlist filter. Per-file defaults helper map. Recurring-field strip on calendar writes. Lazy-import `applyWrites`; try/catch (B1). Preserves `sourceNoteId`. |
| `src/skills/notes_capture/handlers.ts` | EXPORT `fillNoteDefaults` (visibility-only). |
| `src/skills/calendar_management/handlers.ts` | EXPORT `fillCalendarEventDefaults` (visibility-only). |
| `src/modules/inbox.ts` | One-line LLM call swap inside `processBundle`'s loop, gated on `getV4SkillsEnabled().has("inbox_triage")`; fallback to `callLlm("bulk_input")` on gate-miss or dispatcher returning null/degraded. Chunking + stability + clear-on-success unchanged. |
| `app/_layout.tsx` | Append `"inbox_triage"` to `setV4SkillsEnabled([...])`. |
| `src/modules/skillDispatcher.ts` | **No changes** — all 7 read keys are already in `SUPPORTED_KEYS` (FEAT057 + FEAT059 added them). Story 5 / 7's resolver-branch allowance is unused. |
| `app/(tabs)/chat.tsx` | **No changes** — chat-driven path uses the existing `routeToSkill` → `dispatchSkill` flow. |
| `src/types/index.ts`, `src/types/orchestrator.ts` | **No changes**. |
| `src/modules/executor.ts`, `src/modules/assembler.ts` | **No changes**. |

### Patterns reused

- **Single-tool template** (FEAT057-059) — one `submit_*` tool, one
  handler, array writes.
- **Lazy executor import** (AGENTS.md / FEAT057) — `const { applyWrites } = await import("../../modules/executor");` inside the handler.
- **Try/catch around `applyWrites`** (FEAT057 B1 pattern) — handler
  never throws; capture into `writeError`; surface via
  `userMessage` on failure.
- **Defensive defaults helpers per file** (FEAT058 pattern) — extended
  to a per-file *map* keyed by `write.file`, dispatching to the
  right helper.
- **Recurring-fields strip on calendar writes** (FEAT059 pattern) —
  reuse `stripRecurringFields` helper exported from
  `calendar_management/handlers.ts` (or duplicate inline if export
  is too much surface — coder's call, both are acceptable).
- **`directSkillId`-routed `RouteResult` for non-chat callers** —
  `routeToSkill` already supports `directSkillId` (router.ts:299) and
  returns confidence 1.0; no embedding involved.
- **`setV4SkillsEnabled` boot-list addition** — append `"inbox_triage"`.

### New patterns introduced

1. **Multi-file write skill template.** Each write carries its own
   `file`. Handler validates against `manifest.dataSchemas.write`
   allowlist. Out-of-allowlist writes dropped with warn-log.
   Executor re-validates as defense-in-depth. AGENTS.md gets a new
   entry codifying this.
2. **Non-chat invocation template.** `dispatchSkill` is invoked
   directly from a background worker (the inbox timer, in this case).
   Caller builds `RouteResult` via `routeToSkill({ phrase,
   directSkillId })`. Same enabled-set gate as the chat path. No
   chat coupling. AGENTS.md gets a new entry codifying this.

### Dependencies

FEAT054 (Done), FEAT051 (Done), FEAT055 (Done), FEAT056 (Done),
FEAT057 (Done — migration template), FEAT058 (Done — template
generalized for create-only), FEAT059 (Done — template applied to a
third CRUD intent + safety-rule preservation pattern).

### Risks & Concerns (carry-over from design review)

- **Recurring rule preservation.** Highest-impact risk. The
  `prompt.md` must include verbatim `prompts.ts:179` AND the calendar
  writes must strip recurring fields. Stage 7 fixture explicitly
  tests *"every Friday at 4pm"* → produces a `recurringTasks` write,
  zero calendar writes with recurring fields.
- **`userObservations` + `contextMemory` write shapes.** These two
  files are object-shaped (not array-shaped) at the executor level.
  If `applyWrites` doesn't handle non-array writes for these files
  cleanly via the multi-file `file: <key>` path, downgrade the
  allowlist to the four array-shaped files
  (`tasks`, `calendar`, `notes`, `recurringTasks`). Surface the
  divergence in test results. **Coder must verify on real fixture
  state before declaring parity.**
- **Disable-gate for timer path.** The `getV4SkillsEnabled()` check
  inside `processBundle`'s loop is the easy thing to forget. Stage 7
  explicitly tests both gate states for both entry points.
- **FEAT040 admission control deferred.** Same rationale as FEAT059 —
  admission control is a separate behavioral change. Inbox parity
  ships first.

---

## UX Notes

*Filled by Architect agent 2026-04-27.*

Zero new screens. Chat-driven path renders bulk-input replies with
the per-action bullet format defined in `prompts.ts:216-222`,
unchanged. Adding the *via inbox_triage* badge under the bubble is
the same surface-level pattern as the four prior skills. Timer-driven
path produces no chat output (writes silently while user is in
another tab) — same as today.

---

## Testing Notes

*Filled by Architect agent 2026-04-27.*

### Unit tests (handler-level, stub LLM)

- Handler filters out malformed writes (missing `file`, bad action,
  empty `data`).
- Per-file defaults helper map applied per write's `file`.
- Out-of-allowlist `file` values dropped with warn-log.
- `sourceNoteId` preserved verbatim per write.
- Calendar writes have `recurring` / `recurrence` / `recurrenceDay`
  stripped.
- `applyWrites` failure → handler captures (B1), batch returns
  `success: false` + error in `userMessage`.

### Integration tests

- Stub `dispatchSkill`, run `processInbox` against fixture blob,
  assert dispatcher called N times (N = chunk count), inbox cleared
  iff all chunks succeeded.
- Stub `getV4SkillsEnabled` to return `new Set([])`, run
  `processInbox` against the same blob, assert
  `callLlm("bulk_input")` invoked instead of dispatcher.

### Prompt assertion test

- `prompt.md` contains load-bearing strings:
  - `"process EVERY item"`
  - `"check tasksIndex and calendarEvents"`
  - `"[note <id> @ <timestamp>]"`
  - `"NEVER set \"recurring\""`

### Regression fixture (6 phrases — see design review §8.1)

Threshold: ≥5/6 strict. Includes the recurring-attempt phrase
(parity-defining), source-note attribution path, dedup blob, empty
inbox, and out-of-allowlist defense.

### Disable test

- `setV4SkillsEnabled` excluding `"inbox_triage"` → both timer-driven
  and chat-driven paths fall back to legacy `bulk_input` and produce
  equivalent writes. Same fixture, both paths.

### Bundle gate

- `npm run build:web` exports.
