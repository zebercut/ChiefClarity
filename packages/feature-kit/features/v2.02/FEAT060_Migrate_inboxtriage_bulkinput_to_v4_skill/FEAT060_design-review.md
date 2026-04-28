# FEAT060 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT060_Migrate_inboxtriage_bulkinput_to_v4_skill.md`
**Refs:** FEAT057 (template, single-file), FEAT058 (template, create-only),
FEAT059 (template, third-application + safety-rule preservation),
`src/modules/inbox.ts:74-123` (`processBundle`, the chunk loop being
re-pointed), `src/constants/prompts.ts:179` (recurring guard),
`src/constants/prompts.ts:181-222` (Bulk-Input rules + source-note
attribution block), `src/types/index.ts:115-127`
(`WriteOperation` already carries `sourceNoteId`),
`src/modules/skillDispatcher.ts:63-152` (`dispatchSkill` is a
programmatic API — no chat coupling).

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

Fifth template-application after FEAT055/057/058/059. Two scope additions
beyond a clean copy-paste — both first-of-kind and template-defining:

- **Multi-file write.** Each `WriteOperation` carries its own `file`
  field (the type already supports it; legacy `bulk_input` already
  exercises it). The skill's `dataSchemas.write` becomes an array, and
  the handler enforces the allowlist per write. This sets the template
  for every future multi-target skill.
- **Non-chat entry point.** `dispatchSkill` is a pure programmatic API
  (`RouteResult` + `phrase` + `{ state }`) — no chat coupling. The
  `processInbox` timer can call it directly. This sets the template for
  every future skill invoked by background workers / CRON / nudges.

Both extensions stay inside the existing `dispatchSkill` contract. No
changes to `chat.tsx`, no changes to shared types, no changes to
executor. The only infra delta is a minimal swap inside `inbox.ts`.

---

## 2. Architecture (one screen)

```
┌─ Timer-driven (every 2 minutes) ─────────────────────────────────────┐
│ in-app interval ──► checkInbox() ──► processInbox(text, state)       │
│                                          │                            │
│                                          ▼                            │
│                                    processBundle()                    │
│                                    ├─ chunkText (≤2000 tok)           │
│                                    ├─ for each chunk:                 │
│                                    │   ├─ routeToSkill({              │
│                                    │   │    phrase: chunk,            │
│                                    │   │    directSkillId:            │
│                                    │   │      "inbox_triage" })       │
│                                    │   └─ dispatchSkill(rt, chunk,    │
│                                    │        { state })                │
│                                    └─ aggregate writes/replies        │
│                                          │                            │
│                                          ▼                            │
│                       all-chunks-succeeded? ─► clearInbox             │
└──────────────────────────────────────────────────────────────────────┘

┌─ Chat-driven ────────────────────────────────────────────────────────┐
│ user paste ──► chat.tsx ──► routeToSkill ──► inbox_triage top-1      │
│                              ──► dispatchSkill ──► same handler      │
└──────────────────────────────────────────────────────────────────────┘

inbox_triage skill (one entry, two callers)
  ├── manifest: dataSchemas.write = ["tasks","calendar","notes",
  │                                  "contextMemory","userObservations"]
  ├── prompt.md: Bulk-Input rules (verbatim) + recurring guard verbatim
  ├── context.ts: 7 keys (userToday, userProfile, tasksIndex,
  │                       calendarEvents, topicList, existingTopicHints,
  │                       contradictionIndexDates)
  └── handlers.ts: submit_inbox_triage
        ├── per-write file allowlist filter (drops out-of-allowlist)
        ├── per-file defaults map (notes / calendar / task /
        │                          contextMemory / userObservations)
        ├── strip recurring fields on calendar writes
        ├── preserve sourceNoteId verbatim per write
        └── lazy-import applyWrites; try/catch (B1)
```

Single LLM call per chunk. Same chunking contract as today. Same clear-on-
success contract as today. Same dedup contract as today (LLM still reads
`tasksIndex` + `calendarEvents` for cross-check).

---

## 3. Alternatives considered

### 3.1 Schema write scope — full parity vs phased

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Full parity day-1: tasks, calendar, notes, contextMemory, userObservations, userProfile, userLifestyle, planOkrDashboard | One PR, no split-brain. User blob never half-handled. | Test fixture bigger. Two of those (`userProfile`, `userLifestyle`) are object-shaped (not array writes); the handler needs different defaults logic per file shape. `planOkrDashboard` writes are rare in inbox dumps and have a fragile shape (KR progress paths). | Reject — the long tail isn't worth the test-fixture and shape-dispatch cost in v2.02. |
| **(b) Phased — high-volume only (CHOSEN): `tasks`, `calendar`, `notes`, `contextMemory`, `userObservations`** | Covers ≥95% of real inbox content. Each is array-shaped (uniform handler logic). Test fixture stays manageable. Profile / lifestyle / OKR writes from inbox are deferred one release; legacy `bulk_input` keeps handling them until a follow-on FEAT (or the legacy cleanup re-routes them). | Skill prompt must explicitly tell the LLM *"if you see a profile/lifestyle/OKR update, set `needsClarification` and ask the user to phrase it as a direct request"*, otherwise the LLM emits a write the handler drops silently. | **CHOSEN** — the spec's "wide blast radius" risk is real; this is the conservative cut. |
| (c) Single-file at a time (start with `tasks` + `notes` only) | Smallest possible surface | Splits a single user blob across two paths — mixed-content inbox would be half-handled. Obvious regression. | Reject — defeats the point of bulk_input. |

**Decision rationale:** the five-file allowlist is the right balance.
The deferred files (`userProfile`, `userLifestyle`, `planOkrDashboard`)
need their own design pass anyway — object-shaped writes + KR-path
mutation. A future FEAT extends the allowlist; this FEAT proves the
multi-file *pattern*, not the maximal scope.

### 3.2 Multi-file allowlist enforcement — handler vs executor-only

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Executor-only — handler accepts whatever the LLM emits, executor's `applyWrites` rejects bad files | Less code in handler. Single source of truth for "what's writable." | Executor's rejection path is a thrown error → handler catches → entire batch fails (B1). One bad write kills five good ones. | Reject — too brittle for batch processing. |
| **Belt-and-suspenders (CHOSEN) — handler validates each write's `file` against the manifest's `dataSchemas.write` allowlist; out-of-allowlist writes are dropped silently with a warn-log; executor re-validates and any survivor that slips through still gets blocked** | One bad write doesn't kill the batch. Failure mode visible in console but not user-facing. Sets clean precedent for multi-file skills. | Two layers can drift if the manifest is updated without restarting (negligible — manifests are loaded at boot). | **CHOSEN** — sets the multi-file template. |
| Handler-only, no executor re-check | Single layer | If a future skill mis-declares its manifest, executor wouldn't catch it. | Reject — defense-in-depth wins. |

**Template precedent:** every future multi-file skill validates `file`
in the handler against `manifest.dataSchemas.write`, drops mismatches
with a warn-log, then calls `applyWrites` once on the survivors.

### 3.3 Defaults helper topology — import existing helpers vs new shared module

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Factor out into `src/skills/_shared/defaults.ts` | Reuse, single source of truth, easier to update when types change | PM didn't authorize a refactor. Touches three other skill folders. Risk of breaking FEAT057-059 in the same PR. | Reject — the refactor is real value but it isn't this FEAT's job. |
| **Import existing per-file helpers from sibling skill folders (CHOSEN), define new ones inline for files no skill currently owns (`contextMemory` facts, `userObservations` emotional state)** | Zero refactor of FEAT057-059. Inbox skill owns the new helpers. Future refactor FEAT pulls all helpers into `_shared/`. | `fillNoteDefaults` and `fillCalendarEventDefaults` are currently `function`-not-`export function`. Need to bump to `export`. Visibility-only change, same pattern as FEAT059's `getActiveEvents` export. | **CHOSEN** — minimal-touch import topology, defers the proper refactor. |
| Duplicate the helpers inline in inbox handler | Zero touches to other skills | Code duplication. If the `Note` interface gains a field, two places must update. | Reject — explicitly violates DRY for no gain. |

**Note on `task_management`:** `task_management/handlers.ts` does not
have a `fillTaskDefaults` helper today (the executor's `applyAdd` fills
task defaults). The inbox skill defines its own `fillTaskDefaults` for
inbox-emitted tasks (priority="medium", status="pending", category="general")
since the inbox prompt explicitly defaults priority to "medium" per the
legacy rules.

---

## 4. Cross-feature concerns

**Upstream:** FEAT054, FEAT051, FEAT055, FEAT056, FEAT057, FEAT058,
FEAT059 — all Done. Template now proven 5×.

**Downstream:**

- **FEAT026 notes-processor.** `notesProcessor.ts` calls
  `processBundle(text, state, "notes")` from this same module — and
  that path now hits `dispatchSkill("inbox_triage", ...)` too,
  *automatically*. That is the right answer: structured notes batches
  carry `[note <id> @ <ts>]` markers, and the skill prompt preserves
  the source-note attribution rules verbatim. The skill is unaware of
  whether it's being called from inbox or notes — same handler, same
  prompt, same writes. Story 3 covers this.
- **FEAT040 admission control** — deferred. Same rationale as FEAT059:
  admission control for inbox-derived calendar events is a separate
  behavioral change. Inbox parity ships first, admission control folds
  in via a follow-on FEAT against the same skill's prompt + handler.
- **Recurring-task migration** — calendar writes from inbox dumps go
  through the same recurring-rejection guard as direct calendar
  writes (FEAT059). The handler strips `recurring` / `recurrence` /
  `recurrenceDay` fields on calendar writes before they hit the
  executor. *"Every Friday at 4pm I have a team check-in"* in an
  inbox blob produces a `recurringTasks` write (allowlisted? **NO** —
  see Open Q4 decision: `recurringTasks` is **not** in the v2.02
  allowlist) → handler drops the write silently → user gets a chat
  reply prompting them to use the recurring handler. Acceptable
  trade-off for v2.02.

  **Wait, re-decide:** legacy bulk_input *does* write `recurringTasks`
  today. Dropping that capability is a regression. Architect decision:
  **add `recurringTasks` to the allowlist** so inbox-derived recurring
  rules continue to work. Updated allowlist: `tasks`, `calendar`,
  `notes`, `contextMemory`, `userObservations`, `recurringTasks`
  (six files). Calendar-recurring-fields stripping still applies on
  calendar writes specifically.

- **FEAT083 Topics** — unchanged. `contextMemory.facts` writes still
  populate `topic` from `existingTopicHints`, same as today.

**Latent issue (acknowledge, don't fix):** `processBundle` is shared
between the inbox timer and the notes processor. After FEAT060, both
paths share the v4 skill. If a future FEAT wants to make notes
processing *behave differently from* inbox processing (e.g., different
prompt rules, different allowlist), `processBundle` becomes a wrong
abstraction and must split. Not this FEAT's problem; flag for the
next architect who touches notesProcessor.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Recurring rule drops from prompt during copy-paste from `prompts.ts:179` | Low | High | Stage 7 fixture includes the *"every Friday"* phrase; assert handler emits a `recurringTasks` write, not a `calendar` write with recurring fields. Same defense as FEAT059. |
| Dedup divergence — LLM stops checking `tasksIndex` + `calendarEvents` because the prompt phrasing shifted | Medium | Medium | Verbatim copy of the Bulk-Input rules block. Test fixture asserts the load-bearing "check tasksIndex and calendarEvents to avoid creating duplicates" string is present in `prompt.md`. Real-data smoke check: dump a known-duplicate list, confirm zero new tasks. |
| Multi-file write atomicity — partial batch failure leaves state inconsistent | Medium | Medium | `applyWrites` already runs the batch transactionally per file (each `WriteOperation` is independent). One bad write doesn't roll back others; that matches legacy. Document explicitly: "no transactional grouping across files." |
| Chunking ownership confusion — future contributor moves chunking into the skill | Low | High | AGENTS.md gets a new entry: "Chunking is the orchestrator's job, not the skill's. Skills receive one pre-chunked phrase per call." |
| Prompt token bloat — verbatim Bulk-Input block + recurring guard + per-write file rules pushes prompt over budget | Medium | Low | `tokenBudget: 6000` matches legacy. Assembler/dispatcher already enforces the ceiling. If the Haiku response truncates, fixture catches it (the regression set is co-located with the test). |
| Defaults helper export breaks FEAT057-059 tests | Low | Low | Visibility-only change (function → export function). Same pattern as FEAT059's `getActiveEvents`. Existing tests never imported the helpers, so the change is purely additive. |
| `directSkillId` route + dispatcher confidence === 1.0 silently bypasses tiebreaker | Low | Low | This is desired behavior — timer-driven calls explicitly want `inbox_triage`, no embedding routing involved. Doc-only. |
| `setV4SkillsEnabled([])` revert path fails for timer-driven calls | Medium | Medium | The `processBundle` loop must check `getV4SkillsEnabled().has("inbox_triage")` before dispatching; on miss, fall through to `callLlm("bulk_input")`. Stage 7 explicitly tests both gates. |
| `userObservations.emotionalState` + `contextMemory.facts` write shapes diverge from what executor expects (these are object-shaped, not array-shaped) | Medium | Medium | These two files require non-array write semantics. Verify in stage 7: emit one fixture write per file, assert the executor accepts it. If the executor doesn't support non-array writes for these files cleanly, downgrade those two files out of the allowlist (back to the four-file scope). |

---

## 6. Conditions

1. All ACs in Stories 1-8 testable + tested in stage 7.
2. **Per-file defaults helpers exported** from
   `notes_capture/handlers.ts` (`fillNoteDefaults`) and
   `calendar_management/handlers.ts` (`fillCalendarEventDefaults`).
   Visibility-only change. New helpers
   (`fillTaskDefaults`, `fillContextMemoryFactDefaults`,
   `fillObservationDefaults`, `fillRecurringTaskDefaults`) live in
   `inbox_triage/handlers.ts`.
3. **Per-write file allowlist enforced in handler**: each write's
   `file` is checked against
   `["tasks", "calendar", "notes", "contextMemory", "userObservations", "recurringTasks"]`;
   non-allowlist writes dropped with a `[inbox_triage] dropped write
   for unsupported file=...` warn-log.
4. **Bulk-Input prompt block + source-note attribution sub-block +
   recurring-guard rule preserved verbatim** in
   `inbox_triage/prompt.md`. Automated test asserts the prompt file
   contains the load-bearing strings: `"process EVERY item"`,
   `"check tasksIndex and calendarEvents"`,
   `"[note <id> @ <timestamp>]"`,
   `"NEVER set \"recurring\""`.
5. **Recurring-attempt fixture**: *"every Friday at 4pm I have a team
   check-in"* in an inbox blob → handler emits a `recurringTasks`
   write (not a calendar write with recurring fields). Stage 7
   regression.
6. **`inbox.ts` swap is minimal**: replace
   `callLlm(context, "bulk_input")` inside `processBundle`'s loop
   with a `dispatchSkill` call gated by
   `getV4SkillsEnabled().has("inbox_triage")`; on gate-miss or
   dispatcher returning null/degraded, fall back to `callLlm`.
   Chunking, stability check, clear-on-success, all post-processing
   stays put.
7. **Boot wiring** — append `"inbox_triage"` to the
   `setV4SkillsEnabled([...])` array in `app/_layout.tsx`.
8. **Zero changes** to `chat.tsx`, `types/index.ts`,
   `types/orchestrator.ts`, `executor.ts`, `assembler.ts`. Resolver
   keys (`tasksIndex`, `calendarEvents`, `topicList`,
   `existingTopicHints`, `userToday`, `contradictionIndexDates`,
   `userProfile`) are all already in `SUPPORTED_KEYS` — no resolver
   work.
9. **Bundle gate** — `npm run build:web` exports.
10. **Regression threshold** — 6-phrase regression fixture (Story 8
    + Story 1 + Story 2): ≥5/6 strict.
11. **Disable test** — with `setV4SkillsEnabled` excluding
    `"inbox_triage"`, both timer-driven and chat-driven paths fall
    back to the legacy `bulk_input` flow and produce equivalent
    writes. Same fixture, both paths.
12. **AGENTS.md updated** with two new template-defining entries:
    (a) "Multi-file skill template — handler enforces per-write
    `file` against `manifest.dataSchemas.write` allowlist;
    out-of-allowlist writes dropped with warn-log; executor
    re-validates as defense-in-depth."
    (b) "Non-chat invocation template — `dispatchSkill(routeResult,
    phrase, { state })` is a programmatic API; background workers /
    timers / nudges call it directly with
    `directSkillId`-routed `routeResult`. No chat coupling."
13. **`docs/new_architecture_typescript.md` updated** — add
    inbox_triage to Section 12 (Feature Catalog) and update Section 6
    (Module Responsibilities) to reflect the new dispatcher entry
    point in `inbox.ts`.

---

## 7. UX

**Zero changes.** The chat-driven path already renders bulk-input
replies with the per-action bullet format. Adding the *via inbox_triage*
badge under the bubble is the same surface-level pattern as the four
prior skills. The timer-driven path produces no chat output (writes
silently while the user is in another tab) — same as today.

---

## 8. Test strategy

### 8.1 Regression fixture (6 phrases, Story 8 + Story 1 + Story 2)

1. Mixed inbox blob: *"Task A by Friday. Meeting with Contact A Tue 3pm.
   Idea: Project X needs a kickoff doc."* → 1 task write + 1 calendar
   write + 1 note (or contextMemory.facts) write.
2. Recurring-attempt blob: *"Every Friday at 4pm I have a team
   check-in. Buy bread tomorrow."* → 1 recurringTasks write + 1 task
   write. **Zero** calendar writes with recurring fields.
3. Source-note attribution blob (notes-processor path): synthetic
   `[note note_test123 @ 2026-04-27T10:00:00] Task B by Monday.
   [note note_test456 @ 2026-04-27T10:01:00] Save this thought:
   refactor inbox.` → 1 task write with `sourceNoteId="note_test123"` +
   1 note write with `sourceNoteId="note_test456"`.
4. Dedup blob (state has existing task "Buy milk"): *"Task: buy milk
   tomorrow"* → zero new task writes (LLM-driven dedup; assertion is
   probabilistic — accept ≥1 of 3 LLM trials matching).
5. Empty/whitespace inbox: → zero writes, no crash, processed=true,
   inbox cleared.
6. Out-of-allowlist attempt (synthetic, via stub LLM): handler
   produces a write with `file: "userProfile"` (not in allowlist) →
   handler drops it, warn-log emitted, batch otherwise succeeds.

Threshold: **≥5/6 strict**.

### 8.2 Unit tests (handler-level, stub LLM)

- Handler filters out malformed writes (no `file`, bad action,
  missing required `data` fields per file).
- Per-file defaults helper map applied per write's `file`.
- `sourceNoteId` preserved verbatim per write.
- Calendar writes have `recurring`/`recurrence`/`recurrenceDay`
  stripped (reuse FEAT059 pattern via the calendar-management defaults
  helper).
- `applyWrites` failure → handler captures, batch returns
  `success: false` + error in `userMessage`. Inbox-side caller
  detects via dispatch result and does NOT clear inbox.

### 8.3 Integration tests

- Stub `dispatchSkill` in the inbox test, run `processInbox` against
  a fixture blob, assert the chunk loop calls dispatcher N times
  (N = chunk count) and clears inbox iff all chunks succeeded.
- Stub `getV4SkillsEnabled` to return `new Set([])`, run
  `processInbox` against the same blob, assert `callLlm("bulk_input")`
  is invoked instead.

### 8.4 Prompt assertion test

- `prompt.md` contains the load-bearing strings listed in §6
  condition 4. String-match (not token-match) — these strings are
  load-bearing for behavior parity, drift is unacceptable.

### 8.5 Real-LLM smoke (post-merge, optional)

- One real-data inbox dump from the developer's test fixture (with
  no real user content — synthetic only). Compare write set against
  legacy. Document delta.

---

## 9. Pattern Learning

**FEAT060 is the proof point for the migration template at scale.** It
exercises the two extensions that any future "operations skill" will
need:

1. **Multi-file write.** After FEAT060, the canonical multi-file
   skill template is:
   - `manifest.dataSchemas.write` is an array of `FileKey`s.
   - Handler validates each write's `file` against the array.
   - Per-file defaults helper map (one helper per allowlisted file).
   - Out-of-allowlist writes dropped with warn-log; never thrown.
   - Executor re-validates as belt-and-suspenders.

2. **Non-chat invocation.** After FEAT060, the canonical non-chat
   skill template is:
   - Caller (timer / cron / nudge / background worker) builds a
     `RouteResult` via `routeToSkill({ phrase, directSkillId })` —
     `directSkillId` short-circuits embedding routing to confidence 1.0.
   - Caller passes `(routeResult, phrase, { state })` to
     `dispatchSkill`. No chat surface involved.
   - Caller checks `getV4SkillsEnabled().has(skillId)` first; on
     miss, falls through to legacy. Same gate as the chat path.

After FEAT060:
- 5 skills migrated (priority_planning, general_assistant,
  task_management, notes_capture, calendar_management, inbox_triage).
- Pattern proven across reasoning, multi-op CRUD, free-form capture,
  time-based CRUD with safety rules, and now multi-file batch +
  non-chat invocation.
- AGENTS.md template entry stable + extended with the two new template
  variants (multi-file, non-chat).

Subsequent migrations (emotional_checkin, learning, feedback,
suggestion_request, OKR/profile/lifestyle ops) should be near-mechanical.
The next one that *isn't* mechanical signals a legitimate new template
extension.

---

## 10. Sign-off

Architect approves. Conditions §6 binding (13 items). Coder may proceed
without further review — the post-architect human gate has been removed
for this FEAT, so decisions in §3 (alternatives) and §4 (cross-feature
re-decision adding `recurringTasks` to the allowlist) are final.

**Pay special attention to:**
- Condition 5 (recurring-attempt fixture) — this is the parity-defining
  test. If it fails, parity is broken.
- Condition 11 (disable test must run for both timer and chat paths).
  The timer-side gate is the easy thing to forget.
- Condition 13 (architecture doc + AGENTS.md update). The two new
  template-defining patterns are load-bearing for the next architect.
- Risk row 9 (`userObservations` + `contextMemory` non-array write
  shapes). If the executor can't handle these cleanly, downgrade the
  allowlist to `tasks` / `calendar` / `notes` / `recurringTasks` and
  surface the divergence in test results.
