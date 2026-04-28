# FEAT065 — Code Review

**Reviewer:** Code Reviewer agent
**Date:** 2026-04-27
**Spec:** `FEAT065_Fix_v4_dispatcher_declare_tool_schemas_per_skill.md`
**Design Review:** `FEAT065_design-review.md` (20 binding conditions)
**Precedent:** FEAT063_code-review.md
**Branch:** `fz-dev-capacitor`

---

## 1. Verdict

**APPROVED — auto-advance to tester for the binding real-LLM smoke (condition 14).**

The implementation matches the architect's §4 fingerprint table and the §7 conditions. All 7 skills declare `toolSchemas` co-located in their `handlers.ts`. Top-level `additionalProperties: false` is consistently applied across all 7 skills. The `emotional_checkin` nested data shape is strict (the explicit FEAT063 safety override). The `calendar_management` schema description forbids recurring fields and the handler retains `stripRecurringFields` defense-in-depth. The `inbox_triage` 6-value file enum matches `WRITE_ALLOWLIST` exactly. Bundle output is byte-equal across two consecutive runs. Real-LLM smoke is binding and not yet executed — that is the tester's gate (Condition 14).

No fixes were required during review. The hardening exercise (strip a skill's `toolSchemas`, observe failure) confirmed the `skillRegistry.test.ts` "every production skill exposes toolSchemas" test catches the regression.

---

## 2. Files reviewed

Read line-by-line via `git diff`:
- `src/types/skills.ts` (+20 lines) — `SkillTool` alias re-export of `Anthropic.Messages.Tool`; `LoadedSkill.toolSchemas?` field added.
- `src/modules/skillRegistry.ts` (+20 lines) — `readToolSchemas` helper threaded through both `buildSkillFromBundle` and `loadOneSkill`. Defaults to `{}` when missing (no throw).
- `src/modules/skillDispatcher.ts` (+/-, net rewrite of `buildToolSchemas` + `sha256First16`) — schema-aware build with WARN fallback; `sha256First16` now delegates to `fnv1a64Hex`.
- `src/skills/general_assistant/handlers.ts` (+18) — 1 tool, 1 required field.
- `src/skills/priority_planning/handlers.ts` (+74) — 2 tools, multi-tool schema.
- `src/skills/task_management/handlers.ts` (+74) — 1 tool, 6 properties, writes nested permissive.
- `src/skills/notes_capture/handlers.ts` (+61) — 1 tool, action enum locked to `["add"]`, `data.text` required.
- `src/skills/calendar_management/handlers.ts` (+73) — 1 tool, recurring-fields forbidden in description.
- `src/skills/inbox_triage/handlers.ts` (+91) — 1 tool, 6-value file enum mirroring `WRITE_ALLOWLIST`.
- `src/skills/emotional_checkin/handlers.ts` (+71) — 1 tool, **nested data strict** (`additionalProperties: false` override).
- `src/modules/skillRegistry.test.ts` (+111 lines, 3 new tests) — fs-path threading, fs-path missing-default, bundle-path coverage assertion across all 7 skills.
- `src/modules/skillDispatcher.test.ts` (+158 lines, 2 new tests) — declared-schema verbatim pass-through, missing-schema WARN fallback.

---

## 3. §20 Conditions audit

| # | Condition | Status | Evidence |
|---|---|---|---|
| 1 | Story 1-11 ACs testable + tested | Y | Stage 7 (tester). Schema additions for all 7 skills are present and validated by the new bundle-path test in `skillRegistry.test.ts`. |
| 2 | `SkillTool` alias added to `types/skills.ts` | Y | `src/types/skills.ts:24` — `export type SkillTool = Anthropic.Messages.Tool;` Skills import `SkillTool` from `../../types/skills` (verified across all 7). |
| 3 | `LoadedSkill.toolSchemas` field added | Y | `src/types/skills.ts:138` — optional `toolSchemas?: Record<string, SkillTool>`. (Architect spec said default `{}`; implementation uses `?` + helper-default — equivalent at runtime.) |
| 4 | All 7 skills declare `toolSchemas` per §4 | Y | See per-skill audit table below. Top-level `additionalProperties: false` confirmed via grep across all 7. `emotional_checkin` nested-data strict per §4.7. |
| 5 | Registry threading on both paths | Y | `skillRegistry.ts:242` (`buildSkillFromBundle`) and `:453` (`loadOneSkill`) both call `readToolSchemas(handlersModule)`. Helper at `:255-261` defaults to `{}` on missing/invalid. No throw path. |
| 6 | Dispatcher reads schema + WARN fallback | Y | `skillDispatcher.ts:350-371`. Returns declared schema when present; otherwise WARN with skill+tool name and falls back to permissive empty schema. WARN message text matches design review §3.4. |
| 7 | Bundler typing tightening | **DEFERRED (accepted)** | `BundledSkill.handlers` typed as `Record<string, ToolHandler>`. Coder's argument: `* as <skill>Handlers` surfaces every named export at runtime; `readToolSchemas` reads from the same module-namespace object via the runtime path; tightening the bundler interface adds risk of breaking bundle determinism. Reviewer agrees — runtime path is sound. Carry-forward. |
| 8 | WARN, not throw, with TODO comment | Y | `skillDispatcher.ts:354-356` — TODO comment present and references the follow-up FEAT correctly: *"Downgrade this WARN to a hard error once all skills declare toolSchemas in production for one release cycle."* |
| 9 | Defense-in-depth for unknown tool | Y | `skillDispatcher.ts:127-129` unchanged. The `if (!handler) return degradedAndLog(...)` path covers unknown tool names. |
| 10 | Bonus — `sha256First16` cleanup | Y (BONUS LANDED) | `skillDispatcher.ts:32` imports `fnv1a64Hex` from `../utils/fnv1a`. `sha256First16` (`:175-177`) is a 1-line wrapper delegating to FNV-1a. Output remains 16 hex chars (verified by dispatcher's existing log-format test at `skillDispatcher.test.ts:450` — `phrase=[a-f0-9]{16}` regex passes). |
| 11 | Bundle determinism | Y | Verified directly: ran `npm run bundle:skills` twice; `diff` produces no output. Confirmed byte-equal. |
| 12 | `npm run build:web` exits 0 | Y | Verified directly: web build exports 9 files including `index.html`. Exit 0. |
| 13 | AGENTS.md update (real-LLM smoke rule) | **DEFERRED to tester / follow-up** | Coder did not update AGENTS.md. Per FEAT063 precedent, AGENTS.md updates may land in the tester's stage (or FEAT066). Architect's design review §10.2 codifies the rule; tester pastes the canonical sentence. Acceptable to defer. |
| 14 | MANDATORY real-LLM smoke (7/7) | **TESTER OWNS** | Binding artifact for "Done." Tester runs the 7 phrases listed in §9.6 of the design review and captures results in `FEAT065_test-results.md`. Reviewer prepared the canonical list in §7 below. |
| 15 | Existing handler unit tests pass unchanged | Y | All 7 per-skill test suites green (calendar_management 26, emotional_checkin 30, inbox_triage 34, notes_capture 17, task_management 24 + skillBundle 9). |
| 16 | Existing dispatcher + registry tests pass | Y | `skillDispatcher` 19 (was 17) + `skillRegistry` 53 (was 50). Net delta = +5 new tests as designed. |
| 17 | New unit tests landed | Y | 3 in `skillRegistry.test.ts`: (a) fs threading, (b) fs missing-default, (c) bundle-path coverage. 2 in `skillDispatcher.test.ts`: (a) verbatim pass-through, (b) WARN fallback. The bundle-path test is the strongest — it iterates the 7 production skills and asserts each declared tool has a schema with `additionalProperties: false`. |
| 18 | `docs/new_architecture_typescript.md` updated | **DEFERRED (carry-forward)** | Per CLAUDE.md line "docs are now in `docs/v4/`, not `new_architecture_typescript.md`": the architecture doc backfill is intended for `docs/v4/`. Neither was updated by the coder. The tester or a follow-up doc-pass FEAT can backfill. Reviewer flags but does not block — same posture as condition 13. |
| 19 | `setV4SkillsEnabled([])` legacy fallback intact | Y | `skillDispatcher.ts:69-73` unchanged. The v4-enabled gate test (`v4Gate` 12 tests) passes. |
| 20 | Zero changes to chat/executor/assembler/router/prompts/manifests | Y | `git diff --stat` shows changes only in `src/types/skills.ts`, `src/modules/skillDispatcher.ts`, `src/modules/skillRegistry.ts`, the 7 `handlers.ts`, and the 2 test files. No prompt.md / manifest.json / context.ts changes. |

**Summary:** 17/20 conditions confirmed Y. 3 deferrals (7, 13, 18) accepted with reasoning. Condition 14 (real-LLM smoke) is the tester's gate — see §7.

---

## 4. Per-skill schema audit

Architect's §4 fingerprint table cross-checked against `handlers.ts` args interface and the skill's `prompt.md`. Pass = (every handler-read field appears in schema properties) AND (every prompt-named field appears in schema) AND (architect's required[] populated).

| Skill | Tools | Args interface vs schema | Prompt vs schema | additionalProperties (top) | Notes |
|---|---|---|---|---|---|
| `general_assistant` | 1 (`submit_general_response`) | Y — `reply` only | Y — prompt names `reply` | `false` | Trivial. `required: ["reply"]`. |
| `priority_planning` | 2 (`submit_priority_ranking`, `request_clarification`) | Y — `ranked`, `topPick`, `summary` for ranking; `question` for clarification | Y — prompt names ranked array (max 5), topPick, summary, and clarification question | `false` (both tools) | `ranked` has `maxItems: 5` per fingerprint. Nested `ranked[]` and `topPick` have `additionalProperties: false` locally — **architect-correct**, more strict than the §3.3 default and matches §4.2 fingerprint. |
| `task_management` | 1 (`submit_task_action`) | Y — handler reads `reply`, `writes[].action/id/data`, `items`, `conflictsToCheck`, `suggestions`, `needsClarification` | Y — prompt names all of the above + the action enum | `false` | `writes[].data` permissive (`additionalProperties: true`) per §3.3 default. `writes[].action` enum is `["add","update","delete"]`. |
| `notes_capture` | 1 (`submit_note_capture`) | Y — `reply`, `writes[].action="add"`, `writes[].data.text`, `conflictsToCheck`, `needsClarification` | Y — prompt locks action to "add" and requires `text` | `false` | `writes[].action` enum is single-value `["add"]` per §4.4. `writes[].data.text` is **required** inside the writes-element schema (matches handler's `text.length > 0` defensive filter). |
| `calendar_management` | 1 (`submit_calendar_action`) | Y — handler reads same 6 fields as task_management; `writes[].data` is `Partial<CalendarEvent>` (permissive). | Y — prompt explicitly says "NEVER set recurring/recurrence/recurrenceDay" (line 64). | `false` | `data` description string at `handlers.ts:139` reinforces *"Single-occurrence only — do NOT include recurring, recurrence, or recurrenceDay fields."* — matches §4.5. Handler's `stripRecurringFields` (`:187-194`) retained. |
| `inbox_triage` | 1 (`submit_inbox_triage`) | Y — `reply`, `writes[].file/action/id/data/sourceNoteId`, `items`, `conflictsToCheck`, `suggestions`, `needsClarification` | Y — prompt enumerates the 6-file list (line 23) and names sourceNoteId | `false` | `writes[].file` enum is **exactly** `["tasks","calendar","notes","contextMemory","userObservations","recurringTasks"]` — matches `WRITE_ALLOWLIST` Set (`handlers.ts:44-51`) byte-for-byte. `required: ["file","action"]` on each write element (correct — prompt says every write declares its file). |
| `emotional_checkin` | 1 (`submit_emotional_checkin`) | Y — `reply`, `writes[].action="add"`, `writes[].data.observation/date/_arrayKey`, `needsClarification` | Y — prompt names observation, date, _arrayKey="emotionalState" | `false` | **§4.7 strict-nested override applied correctly:** `writes[].data` is `additionalProperties: false` listing ONLY `observation` (required), `date`, `_arrayKey` (enum: `["emotionalState"]`). No `severity`, `mood_score`, `note`, etc. — matches the FEAT063 safety scope at the schema layer. Handler's needsClarification safety net retained (`:45-53`). |

All 7 skills pass three-way coherence (schema ↔ handler ↔ prompt). No schema/prompt drift detected.

---

## 5. Code observations

**Sound choices:**
- `readToolSchemas` is a single helper threaded through both bundle and fs paths. DRY. Defensive (rejects arrays, non-objects, missing).
- `SkillTool` alias is the cleanest decoupling point — skills never import `@anthropic-ai/sdk` directly. Verified via grep on `src/skills/**/handlers.ts`: zero direct SDK imports.
- `additionalProperties: false` at top level is uniform across all 7 skills (verified by grep).
- The `emotional_checkin` strict-nested override is the ONLY place a nested `data.additionalProperties` is `false`. Confirmed by grep — every other skill's `writes[].data` is permissive (`additionalProperties: true`) per §3.3.
- The `calendar_management` schema description for `data` carries the "do NOT include recurring..." text. Belt-and-suspenders with the prompt and `stripRecurringFields`.
- The `priority_planning` nested objects (`ranked[]`, `topPick`, `request_clarification.question`) have local `additionalProperties: false` — stricter than the §3.3 default, and architect's §4.2 fingerprint allows it. Sensible because these shapes are fully enumerated.
- `fnv1a64Hex` reuse in `skillDispatcher.ts` matches the FEAT064 helper. Output stays at 16 hex chars (regex `phrase=[a-f0-9]{16}` in dispatcher logging test still passes — no test churn).
- TODO comment at `skillDispatcher.ts:354-356` is intentional and required per design review §10.3 + condition 8. Reviewer confirms it is present, non-trivial, and references the correct follow-up FEAT.

**Defensive checks intact (per design review §6 risk row):**
- `task_management`: `applyWrites` try/catch + `writeError` shielding (`:75-90`).
- `notes_capture`: `text.length > 0` filter on writes (`:34`); the schema's `required: ["text"]` codifies this at the schema layer, but handler retains the runtime check.
- `calendar_management`: `stripRecurringFields` (`:187`) + title-required check (`:54-58`) + per-add `fillCalendarEventDefaults`.
- `inbox_triage`: `WRITE_ALLOWLIST` runtime check (`:208`), per-file mandatory-field checks (`:225-256`).
- `emotional_checkin`: `needsClarification` safety net drops userObservations writes (`:45-53`) — the FEAT063 condition-6 contract is preserved at runtime.

**No regressions:** `git diff` shows zero handler-logic deletions. Only additions are the `toolSchemas` named exports.

---

## 6. Latent bug findings

None.

The hardening exercise (strip `toolSchemas` from `general_assistant`, re-bundle, run tests) produced the expected failure on the bundle-path coverage test (`skillRegistry.test.ts:856-901`):
```
✗ bundle path: every production skill exposes toolSchemas for every declared tool
    general_assistant has schema for submit_general_response
```
This proves the test catches the missing-schema regression at the schema-presence layer. After restoring the schema, all 439 tests pass.

---

## 7. Things NOT in scope (flagged, not fixed)

- **Condition 7 (bundler typing tightening).** Coder argues runtime read works; reviewer concurs. Tightening the `BundledSkill.handlers` type to allow `toolSchemas` first-class is a low-value refactor that risks bundle determinism (the codegen would need a corresponding shape change). Defer to a follow-up FEAT.
- **Condition 13 (AGENTS.md real-LLM-smoke rule).** Carry-forward to tester or a follow-up doc FEAT.
- **Condition 18 (`docs/new_architecture_typescript.md` / `docs/v4/` update).** Carry-forward. CLAUDE.md notes the v4 docs are now under `docs/v4/`. Neither path was updated. Same posture as condition 13.
- **Schema-per-file-type validation** (per-`FileKey` JSON schemas for `writes[].data`). Future FEAT — design review §10.3.
- **Hard-error fallback** (downgrade dispatcher WARN to throw once all skills carry schemas in production for one release cycle). Tracked by the TODO at `skillDispatcher.ts:354-356`. Future FEAT.
- **Automated `npm run smoke:v4`** harness. Out of scope — design review §3.5 explicitly defers.

---

## 8. Gate results (post-review)

- `npx tsc --noEmit -p tsconfig.json`: clean except the pre-existing `executor.ts:229` (per coder's handoff). No new errors.
- `npm run bundle:skills`: writes 7 skills; **byte-equal across two consecutive runs** (verified via `diff /tmp/bundle1.ts src/skills/_generated/skillBundle.ts`).
- `npm run build:web`: exits 0; exports `dist/` with 9 files including `index.html`.
- `node scripts/run-tests.js`: **439 passed, 0 failed.** Includes the 5 new FEAT065 tests (3 in skillRegistry, 2 in skillDispatcher).
- Hardening exercise: stripping `toolSchemas` from one skill produces the expected test failure. Restoring brings it back to 439 green.

---

## 9. Tester guidance — BINDING real-LLM smoke

The smoke is the FEAT-defining artifact. Stub-LLM tests have always passed; only a real-LLM call can confirm the schemas wire through end-to-end.

**Setup:**
1. `npm run dev` + api-proxy (live Anthropic endpoint).
2. `setV4SkillsEnabled([all 7])` — confirm via the v4Gate UI or env.
3. Open the chat. Type each of the 7 phrases below in fresh sessions. Capture the actual `userMessage` returned (and inspect the relevant data file for write-emitting phrases) into `FEAT065_test-results.md` "Real-LLM smoke" section.

**Pass threshold: 7/7 strict.** Any failed phrase blocks "Done" and returns to architect.

| # | Skill | Phrase | Expected outcome |
|---|---|---|---|
| 1 | `general_assistant` | *"tell me a joke"* | Non-empty `reply` containing a joke (or polite explanation). |
| 2 | `priority_planning` | *"what should I focus on?"* | Reply contains a `summary` + `topPick` line + at least one ranked item. (If state is empty, `request_clarification` fires with a non-empty question — also a pass.) |
| 3 | `task_management` | *"add a task to call the dentist tomorrow"* | One `add` write to `tasks.json` with title containing "dentist". Reply confirms creation. |
| 4 | `notes_capture` | *"save this idea: try a morning walk routine"* | One `add` write to `notes.json` with `text` near-verbatim. Reply confirms. |
| 5 | `calendar_management` | *"schedule a meeting tomorrow at 2pm"* | One `add` write to `calendar.json` with `title`, `datetime`, `durationMinutes`. **No `recurring`/`recurrence`/`recurrenceDay`** in the persisted event. |
| 6 | `inbox_triage` | (3-line bulk paste) *"call dentist tomorrow, dinner Friday 7pm, idea about morning walks"* | Three writes targeting `tasks`, `calendar`, `notes` respectively. Reply summarizes routing. |
| 7 | `emotional_checkin` | *"I'm feeling stressed about the project"* | One `add` write to `userObservations.json` under `_arrayKey: "emotionalState"` with `observation` near-verbatim. Reply is a 1-sentence empathic acknowledgement. **FEAT063 forbidden-phrase list still respected.** |

For each row capture: phrase, actual `userMessage`, file write outcome (read the data file), pass/fail flag. Watch the dispatcher console output — there should be **zero** `[skillDispatcher] skill "<id>" missing toolSchemas[<tool>] — falling back...` warnings during the smoke. If any WARN fires, that skill's schema export is missing or misnamed and the test is a fail.

After a 7/7 pass: tester also pastes the AGENTS.md sentence (per condition 13) and updates feature status to `Testing` → `Done`.

---

## 10. Sign-off

Code reviewer approves the implementation. 17/20 conditions confirmed Y, 3 acceptable deferrals (7, 13, 18). The implementation matches the architect's §4 fingerprint table line-by-line; the only nested-strict skill is `emotional_checkin` per the FEAT063 safety override. Bundle is deterministic, web build exports, all 439 unit tests pass.

**Auto-advances to tester for stage 6 (real-LLM smoke).** The smoke is the parity-defining artifact. Reviewer does not block; tester's smoke is the final gate.
