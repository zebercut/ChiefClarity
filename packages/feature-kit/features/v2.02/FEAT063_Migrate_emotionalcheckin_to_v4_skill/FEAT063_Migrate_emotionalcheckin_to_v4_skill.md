# FEAT063 — Migrate `emotional_checkin` to a v4 skill

**Type:** feature
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture/Migration
**Priority:** 2
**Release:** v2.02 (Phase 2 — sixth deliverable)
**Tags:** skill-migration, emotional-checkin, batch-1, template-application, safety-rule
**Created:** 2026-04-27

**Depends on:**
- FEAT054 (Done) — skill loader / dispatcher
- FEAT051 (Done) — router-to-skill bridge
- FEAT055 (Done) — Schema Registry / dataSchemas
- FEAT056 (Done) — context resolver minimal
- FEAT057 (Done) — migration template (canonical)
- FEAT058 (Done) — template generalized for create-only / free-form capture
- FEAT059 (Done) — template applied with verbatim safety guard (recurring-event rule)
- FEAT060 (Done) — `inbox_triage` introduced `userObservations` writes + `_arrayKey: "emotionalState"` shape verified in executor
- FEAT061 / FEAT062 (in flight) — sibling Batch-1 migrations; no hard dependency

**Unblocks:** Phase 3 audit log + privacy filter for emotional content; future "emotional trend" / "weekly mood read" surface (separate FEAT).

---

## Status

Planned — PM has authored the spec. Awaiting human review before the architect picks it up for stages 3–4 (design notes + design review).

---

## Problem Statement

`emotional_checkin` is the legacy intent that handles short emotional disclosures — *"I'm feeling stressed about the project"*, *"I'm overwhelmed today"*, *"feeling anxious about Friday"*, *"had a great morning, feeling productive"*, *"I'm burned out"*. Today it flows through:

- The regex router (`src/modules/router.ts:107-111`) — matches phrases like `^(what a day|tough day|great day|exhausted|tired|stressed|happy|good day)[.!]?$/i` and `\b(feeling|venting|just wanted to say)\b/i`.
- The assembler `switch` case (`src/modules/assembler.ts:152-157`) — sends `contextMemoryRecent`, `feedbackMemorySignals`, `emotionalState`, and `communicationStyle` to the LLM.
- `SYSTEM_PROMPT` rules (`prompts.ts:21`) — *"For emotional_checkin: reply with empathy referencing what you know happened today. No writes required."*
- Tone-calibration guidance (`prompts.ts:34-44`) — *"Use detected emotions to calibrate your tone (empathy for stress, encouragement for positivity, space for venting)"* and *"NEVER mention task cleanup or overdue items during emotional conversations."*
- `TOKEN_BUDGETS.emotional_checkin = 800` (`router.ts:22`).

The legacy prompt explicitly says *"No writes required"* — but the bulk-input path documents that emotional state belongs in `userObservations.emotionalState` (`prompts.ts:192`, `prompts.ts:95-96`). That inconsistency means today the user's emotional state is captured **only when they bulk-dump it**, not when they speak it directly into chat. This migration fixes that gap as a side-effect.

The migration template (proven across 5 skills now: priority_planning, task_management, notes_capture, calendar_management, inbox_triage) applies cleanly. Three emotional-checkin–specific considerations:

1. **Safety / crisis rule (additive, not preserved).** Unlike FEAT059 (which preserved a verbatim recurring-event guard from `SYSTEM_PROMPT:179`), the legacy `emotional_checkin` prompt has **no explicit crisis-detection rule today**. The closest existing language is the tone-calibration block at `prompts.ts:38-44`, which is generic (no mention of suicide / self-harm / professional support). For an emotional-content skill this is a gap. The new skill MUST add a safety rule as best practice — see Story 4. Architect will lock the exact wording.

2. **userObservations write shape.** Re-uses the executor's `_arrayKey: "emotionalState"` path verified in FEAT060, and re-uses (via cross-skill helper or inline mirror — architect call, see Open Question Q3) the `fillObservationDefaults` pattern from `src/skills/inbox_triage/handlers.ts:233-241`.

3. **Tone constraint.** This skill's prompt explicitly forbids platitudes ("That sounds tough!" / "I hear you, that's totally valid!" / generic empathy spam). Default reply length: 1 short sentence acknowledgement + the captured observation. Architect should review whether a hard ~50-word reply length cap is appropriate.

This FEAT validates the template against a low-write, observation-only intent with a safety policy — the sixth canonical migration.

---

## Goals

1. An `emotional_checkin` skill folder exists, loads at boot, and routes via FEAT051 for typical emotional-disclosure phrases.
2. The skill's handler produces a single write to `userObservations` with `_arrayKey: "emotionalState"` for normal disclosures (parity with bulk_input's emotional-state path), and produces **no write** when a safety signal is detected (it surfaces support resources via `needsClarification` instead).
3. Setting `setV4SkillsEnabled(...)` excluding `emotional_checkin` reverts to the legacy path.
4. The skill prompt explicitly forbids platitudes and caps reply length per architect-locked wording.
5. The skill prompt includes a safety / crisis rule (NEW — additive, not preserved). Architect locks exact wording in stage 4. Test fixture verifies that crisis phrases never produce a `userObservations` write.
6. No regression in the existing baseline test suite.
7. The migration template (single tool + array writes + lazy executor import + try/catch + items pass-through + defensive defaults) is reused **without modification**. If anything in the template needs adjustment, surface and fix.

---

## Success Metrics

- Skill loads at boot.
- 7-phrase regression set produces correct writes / replies via the v4 path (≥6/7).
- Safety-rule test: 2 crisis-shaped phrases never emit a `userObservations` write; both surface a needsClarification reply with support-resource language.
- Setting `setV4SkillsEnabled([...])` without `emotional_checkin` reverts all 7 phrases to legacy.
- All baseline tests pass.
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Capture an emotional disclosure via v4

**As a** user, **when** I say *"I'm feeling stressed about the project"*, **I want** the v4 path to acknowledge briefly and quietly capture the observation, **so that** future Sonnet calls (morning plan, weekly plan) have my emotional context.

**Acceptance Criteria:**
- [ ] Given `emotional_checkin` is enabled, *"I'm feeling stressed about the project"* produces a single write: `{ file: "userObservations", action: "add", data: { _arrayKey: "emotionalState", observation: "<verbatim or near-verbatim user text>", date: "<userToday>" } }`.
- [ ] Chat reply is 1 short sentence — warm, brief, no platitudes — with the *via emotional_checkin* badge.
- [ ] The write reaches the same `userObservations.emotionalState` array that bulk_input writes today (verified by reading the file after).
- [ ] Same phrase with `setV4SkillsEnabled([...without emotional_checkin])` produces today's legacy reply (no write — legacy doesn't write) via the legacy `emotional_checkin` path. **Note the asymmetry:** v4 writes; legacy did not. This is intentional and called out in stage 1.

### Story 2 — Acknowledge positive state without sycophancy

**As a** user, **when** I say *"had a great morning, feeling productive"*, **I want** a brief acknowledgement and the observation captured, **without** generic praise or coaching language.

**Acceptance Criteria:**
- [ ] *"had a great morning, feeling productive"* writes one `emotionalState` observation with positive valence wording captured verbatim.
- [ ] Reply is 1 short sentence — must NOT include phrases like "That's amazing!", "You're crushing it!", "Keep up the great work!". Architect-locked banned-phrase list.
- [ ] Reply length ≤ ~50 words (architect-confirmed cap, see Q4).

### Story 3 — Forbid platitudes in the prompt

**As a** developer, **I want** the skill's `prompt.md` to explicitly forbid platitudes and prescribe a default reply shape, **so that** the skill produces warm-friend tone, not coach-with-whistle tone.

**Acceptance Criteria:**
- [ ] `prompt.md` contains a "Forbidden phrasings" section with at least: *"That sounds tough!"*, *"I hear you and that's totally valid"*, *"Everything happens for a reason"*, *"You've got this!"* — generic empathy spam.
- [ ] `prompt.md` contains a "Default reply shape" section: 1 sentence, warm, specific to what the user said, no advice unless asked.
- [ ] Test fixture: for each of 3 normal-disclosure phrases, the LLM reply does not contain any banned phrasing (case-insensitive substring).

### Story 4 — Safety / crisis rule (additive)

**As a** developer, **I want** the skill's `prompt.md` to include a safety rule that triggers on suicide / self-harm / severe-crisis signals, **so that** the skill never silently logs the disclosure to `userObservations` and instead surfaces support resources.

**Note for architect:** the legacy `prompts.ts` has **no explicit crisis rule today** (closest is the generic tone-calibration block at `prompts.ts:38-44`). This Story therefore ADDS a rule, rather than preserving one verbatim — the FEAT063 analog of FEAT059's recurring guard, but additive.

**Acceptance Criteria:**
- [ ] `prompt.md` contains a "Safety" section that lists trigger signals (architect locks the list — at minimum: explicit suicidal ideation, references to self-harm, expressions of intent to harm self or others, severe hopelessness coupled with planning language).
- [ ] When a trigger signal is detected, the LLM MUST set `needsClarification: true`, MUST emit zero writes, and MUST include in `reply` a short non-clinical sentence acknowledging what the user shared plus a pointer to a support resource (architect-locked wording).
- [ ] Test fixture (out-of-scope safety phrases — generic, not real personal data): 2 crisis-shaped sentences each produce zero `userObservations` writes and a needsClarification reply containing the architect-locked support phrase.
- [ ] The skill's handler additionally validates: if `needsClarification === true` AND any write targets `userObservations`, the handler strips the write and logs a warning. (Defense in depth — the prompt is the primary control; the handler is a safety net in case the LLM misbehaves.)

### Story 5 — Migration template reuse (zero infrastructure changes)

**As an** architect, **I want** FEAT063 to ship with **zero changes** to `chat.tsx`, dispatcher resolver `SUPPORTED_KEYS` structure, or shared types, **so that** the template remains canonical after this sixth application.

**Acceptance Criteria:**
- [ ] No changes to `app/(tabs)/chat.tsx`.
- [ ] No changes to `src/types/orchestrator.ts` or `src/types/index.ts`.
- [ ] If the skill needs a new `recentEmotionalState` resolver key (last 7 days of `userObservations.emotionalState`), ONE additive resolver branch is acceptable (mirrors FEAT057's `buildTaskIndex` extension and FEAT059's `calendarEvents` extension). PM proposes YES (see Q5); architect decides.
- [ ] If the skill imports `fillObservationDefaults` from `src/skills/inbox_triage/handlers.ts`, that helper is exported (visibility-only refactor, mirrors FEAT059's `getActiveEvents` export). Alternatively the skill defines its own inline mirror (architect call, see Q3).
- [ ] If anything beyond a single resolver-branch addition + one helper export is needed, surface the divergence in stage 3/4 and update AGENTS.md.

### Story 6 — Dual-path coexistence

**Acceptance Criteria:**
- [ ] `setV4SkillsEnabled` excluding `emotional_checkin` → legacy `emotional_checkin` runs.
- [ ] Full enabled set → v4 wins.
- [ ] Headless runner / morning plan / weekly plan are unaffected by either toggle (they read `userObservations.emotionalState` regardless of which path wrote it).

### Story 7 — No regression elsewhere

**Acceptance Criteria:**
- [ ] All pre-FEAT063 baseline tests pass.
- [ ] Manual smoke check on three non-emotional phrases: *"add a task to ..."* (task_management), *"save this idea: ..."* (notes_capture), *"what should I focus on?"* (priority_planning) — each produces the same response as before FEAT063.
- [ ] *"I'm feeling stressed"* routes to `emotional_checkin`, not to `notes_capture` (the FEAT058 noun-prefix rule — emotion-noun-prefixed triggers must beat the generic "remember this" / "save this" capture triggers in embedding distance / regex precedence). Architect verifies.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **Crisis-resource UI surface.** This FEAT only emits a `reply` string when a safety signal fires. A dedicated UI surface (modal, hotline link list, "talk to a professional" call-to-action card) is a separate FEAT.
- **Recommendation engine** that suggests *"you should talk to your therapist about X"* — FEAT063 captures observations only, no follow-up suggestions.
- **Emotional trend analysis** — *"third stressed-out check-in this week — pattern detected"* commentary belongs in the morning-plan / weekly-plan Sonnet calls (which already read `userObservations.emotionalState`). Out of scope here.
- **Sentiment classification** beyond what the LLM does naturally inside the skill — no separate sentiment classifier, no valence scores stored in the write.
- **Audit log / privacy filter for emotional content** — Phase 3.
- **Legacy cleanup PR** — separate FEAT after FEAT063 parity bake-in (mirrors FEAT059's deferred cleanup).
- **Re-styling the morning plan** to surface emotional state more prominently — separate FEAT.

---

## Assumptions & Open Questions

**Assumptions:**
- `executor.applyWrites` already handles `file: "userObservations"` with `_arrayKey: "emotionalState"` correctly — verified by FEAT060 (`applyAdd` `_arrayKey` branch).
- The shape `{ observation: string; date: string }` matches `UserObservationsFile.emotionalState[]` (`src/types/index.ts:461-464`).
- The `emotional_checkin` regex router triggers (`router.ts:107-111`) can be re-expressed as a `triggerPhrases` list in `manifest.json` without coverage loss. Architect will confirm via the embedding-distance check.
- The recent emotional state for the last 7 days fits comfortably inside the token budget (`emotional_checkin = 800`). Even at 100 tokens per observation, a week's worth is manageable.

**Open Questions for the Architect:**

1. **Token budget.** Legacy is 800. Skill manifest `tokenBudget` for emotional_checkin should be — same? slightly lower (the new skill has a tighter remit and only needs to capture one observation)? PM proposes 800 for parity. Confirm.

2. **Single tool name.** PM proposes `submit_emotional_checkin` matching the canonical template (`submit_task_action`, `submit_calendar_action`, `submit_note_capture`). Confirm.

3. **`fillObservationDefaults` re-use vs. inline.** The helper exists in `src/skills/inbox_triage/handlers.ts:233-241`. Two options:
   - (a) **Export it** from inbox_triage handlers and import here. Visibility-only refactor; mirrors FEAT059's `getActiveEvents` export.
   - (b) **Inline a private mirror** in the new skill's handlers (FEAT060 precedent — defines its own version per the template). Avoids cross-skill coupling.
   PM leans (b) for skill independence; architect call.

4. **Reply length cap.** Hard cap (e.g. ≤ 50 words, enforced in handler with truncation + warning) or soft guidance (just prompt language)? PM proposes soft (prompt language only) for the first ship; revisit if drift observed. Confirm.

5. **`recentEmotionalState` context resolver key.** New key — last N days of `userObservations.emotionalState[]` filtered by `date >= today - 7`. Useful for the LLM to notice patterns ("third stressed-out check-in this week") without spending a full Sonnet call. Two options:
   - (a) **Add the key** as a resolver branch in `skillDispatcher.ts` (mirrors FEAT059's `calendarEvents` branch). Stays inside Story 5's "one additive branch" allowance.
   - (b) **Skip it for v1** — pass the full `userObservations.emotionalState` array via a generic resolver branch (verbose; sends old observations the LLM doesn't need).
   PM proposes (a). Architect call.

6. **Safety rule — exact wording.** The prompt MUST add a safety section (Story 4). PM proposes the architect lock the wording in stage 4 — at minimum:
   - Trigger signals list (architect-curated, non-exhaustive).
   - Required behavior: `needsClarification: true`, zero writes, support-resource sentence.
   - Locked support-resource phrasing — non-clinical, no diagnostic claims, no specific hotline number unless the architect verifies a stable resource. PM suggests something like *"What you're describing sounds heavy. Please consider reaching out to a mental-health professional or a crisis line — you don't have to handle this alone."* Architect refines.

7. **Forbidden-phrase list.** The "no platitudes" section needs a concrete list. PM seeds with: *"That sounds tough!"*, *"I hear you and that's totally valid"*, *"Everything happens for a reason"*, *"You've got this!"*, *"Sending positive vibes"*, *"Stay strong!"* Architect adds / removes.

---

## Migration Template Confirmation

This FEAT is the sixth application of the canonical template. The two most relevant precedents:

- **FEAT058 (notes_capture)** — *free-form capture pattern.* The user says a sentence; the skill captures it verbatim into a single-array file with minimal interpretation. Same shape as emotional_checkin, modulo the target file (`notes` vs. `userObservations.emotionalState`).
- **FEAT059 (calendar_management)** — *verbatim safety guard pattern.* FEAT059 preserved the recurring-event rule word-for-word from the legacy prompt. FEAT063 inverts this: the legacy prompt **lacks** an explicit safety rule, so the skill ADDS one (architect-locked) as best practice for emotional content. The structural pattern — a clearly-delineated safety block in the prompt with a corresponding handler-side safety net — is identical.

Plus one secondary precedent:

- **FEAT060 (inbox_triage)** — *userObservations write shape.* FEAT060 introduced `userObservations` as a write target and verified the executor's `_arrayKey` branch. FEAT063 reuses that shape unchanged — the only existing skill that writes here.

If the template needs any adjustment to absorb FEAT063, surface and fix.

---

## Architecture Notes

*Filled by Architect agent 2026-04-27. Full design review in
`FEAT063_design-review.md`.*

### Open-question resolutions

| Q | Decision |
|---|---|
| 1 — Token budget | **Lower to 600** (from PM's 800 parity). The skill's reply is one short sentence + one short observation; 600 is ample. Bump back to 800 only if Haiku truncates in fixture. |
| 2 — Tool name | `submit_emotional_checkin` — confirmed. Matches canonical template. |
| 3 — `fillObservationDefaults` | **Export from `inbox_triage/handlers.ts`, import in `emotional_checkin/handlers.ts`.** Visibility-only refactor; same pattern as FEAT059 (`getActiveEvents`) and FEAT060 (`fillNoteDefaults` / `fillCalendarEventDefaults` / `stripRecurringFields`). No `_shared/defaults.ts` (defer that refactor per FEAT060 PM rule). |
| 4 — Reply length cap | **Soft (prompt-only).** No handler truncation. Forbidden-phrase list catches the most common bloat. Revisit if regression fixture shows drift. |
| 5 — `recentEmotionalState` resolver key | **Add it.** 7-day window, capped at 5 most-recent entries. New branch in `skillDispatcher.ts` `SUPPORTED_KEYS` + `computeContextValue` (mirrors FEAT059's `calendarEvents`). Empty-array fallback when state is missing the path. |
| 6 — Safety rule wording | **Locked verbatim in design review §6 condition 5.** Narrow triggers: explicit suicide / self-harm / harm-others / severe-hopelessness-with-planning. Locked support reply with 988 + "your local emergency number" + friend/family/therapist redirect. Manifest lists `"## Safety"` in `promptLockedZones`. Handler safety net strips userObservations writes when `needsClarification: true`. |
| 7 — Forbidden-phrase list | Locked at 8 entries: *"That sounds tough!"*, *"I hear you and that's totally valid"*, *"Everything happens for a reason"*, *"You've got this!"*, *"Sending positive vibes"*, *"Stay strong!"*, *"You're crushing it!"*, *"Keep up the great work!"*. Short enough to embed in the prompt; covers the most common offenders. |

### Data model touches

**None.** `UserObservationsFile.emotionalState[]` already has the right
shape (`{ observation: string; date: string }`, `src/types/index.ts:461-464`).
`executor.applyWrites` already handles `file: "userObservations"` with
`_arrayKey: "emotionalState"` (verified in FEAT060).

### Module touches

- `src/skills/inbox_triage/handlers.ts` — bump
  `fillObservationDefaults` to `export function`. Visibility-only.
- `src/skills/emotional_checkin/` — NEW folder (manifest.json,
  prompt.md, context.ts, handlers.ts).
- `src/modules/skillDispatcher.ts` — add `recentEmotionalState` to
  `SUPPORTED_KEYS` and `computeContextValue` (one new resolver branch).
- `app/_layout.tsx` — append `"emotional_checkin"` to
  `setV4SkillsEnabled([...])` array (line 317).
- `docs/new_architecture_typescript.md` — Section 12 entry.
- `AGENTS.md` — one new template-defining entry ("ADD safety scope" pattern).

### Patterns reused

- Single-tool template (FEAT057 canonical).
- Free-form capture shape (FEAT058 — verbatim user phrase →
  single-array file).
- Lazy `executor.applyWrites` import inside try/catch (FEAT057 B1).
- Defensive defaults via `fillObservationDefaults` (FEAT060).
- Helper export pattern for cross-skill reuse (FEAT059's
  `getActiveEvents`, FEAT060's `fillNoteDefaults`).
- `promptLockedZones` to freeze safety wording (FEAT059's recurring
  guard precedent — same mechanism, different content).
- Soft reply-length constraint via prompt language only (FEAT058).
- Handler safety net pattern (FEAT060 — handler validates LLM output
  beyond schema; here, strip writes when `needsClarification: true`).

### New patterns introduced

- **ADD safety scope.** First migration where the legacy intent had
  NO explicit safety rule and the v4 skill ADDS one. Architect locks
  the wording verbatim in the design review's §6 conditions; manifest
  lists the section heading in `promptLockedZones`; handler enforces
  defense in depth. Codified for future sensitive-content migrations
  (see design review §9 Pattern Learning).

### Dependencies (all Done)

FEAT054, FEAT051, FEAT055, FEAT056, FEAT057, FEAT058, FEAT059, FEAT060.
FEAT061 / FEAT062 (in flight) are siblings with no hard dependency.

---

## UX Notes

[**To be filled after architect review.** Same UX shape as task_management / notes_capture / calendar_management: "via emotional_checkin" badge under v4 bubbles, no layout changes. Crisis-resource UI is a separate FEAT.]

---

## Testing Notes

[**To be filled by the Architect agent — workflow stage 3 / 4.**]

---

## References

- **Template precedents:** FEAT055 (Schema Registry), FEAT057 (canonical template via task_management), FEAT058 (template generalized for free-form capture), FEAT059 (verbatim safety-guard precedent), FEAT060 (`userObservations` + `_arrayKey: "emotionalState"` shape verified), FEAT061 / FEAT062 (sibling Batch-1 migrations).
- **Legacy emotional_checkin behavior:** `src/constants/prompts.ts:21` (intent rule), `src/constants/prompts.ts:34-44` (tone-calibration block), `src/constants/prompts.ts:192` (bulk_input emotional-state hint), `src/modules/router.ts:22` (token budget), `src/modules/router.ts:107-111` (regex triggers), `src/modules/assembler.ts:152-157` (assembler context), `src/types/index.ts:461-464` (`emotionalState` array shape), `src/types/index.ts:73` (IntentType).
- **Reusable patterns:** `src/skills/inbox_triage/handlers.ts:233-241` (`fillObservationDefaults`), `src/skills/notes_capture/prompt.md` (free-form capture prompt template), `src/skills/calendar_management/prompt.md` (safety-guard prompt structure).
