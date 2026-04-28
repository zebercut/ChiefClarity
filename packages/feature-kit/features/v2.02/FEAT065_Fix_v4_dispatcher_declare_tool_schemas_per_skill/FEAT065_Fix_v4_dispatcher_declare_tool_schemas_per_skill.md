# FEAT065 — Fix v4 dispatcher: declare tool schemas per skill (production bug from FEAT064 smoke)

**Type:** bug fix
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture/Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** skill-architecture, v4, production-bug, tool-schemas, real-llm-smoke
**Created:** 2026-04-27

**Depends on:**
- FEAT054 (Done) — skill loader / dispatcher
- FEAT055 (Done) — Schema Registry / dataSchemas
- FEAT056 (Done) — chat.tsx wiring
- FEAT057 (Done) — task_management migration (canonical template)
- FEAT058 (Done) — notes_capture migration
- FEAT059 (Done) — calendar_management migration
- FEAT060 (Done) — inbox_triage migration
- FEAT061 / FEAT062 (Done) — dispatcher state forwarding + executor array fix
- FEAT063 (Done) — emotional_checkin migration
- FEAT064 (Done — smoke surfaced this bug) — build-time skill bundling for web

**Unblocks:** Phase 3 audit log + privacy filter; FEAT066 (multi-token routing matcher / web embeddings) ships after this; any future skill author can rely on schema enforcement.

---

## Status

Planned — PM has authored the spec following the FEAT064 manual smoke. Awaiting human review before the architect picks it up for stages 3–4 (design notes + design review).

---

## Problem Statement

During the FEAT064 manual smoke against the live API proxy, every v4 skill returned `"(no reply)"` to the user. Phrases like *"tell a joke"* (routed to `general_assistant`) and follow-on tests across all 7 skills produced empty handler results. Root cause: `src/modules/skillDispatcher.ts:356-371` (`buildToolSchemas`) returns a permissive empty `input_schema` for every tool the skill declares — `properties: {}, additionalProperties: true`, no `required`. Each skill's `prompt.md` describes which args the LLM should emit ("set `reply` to..."), but the tool schema does not enforce them. Haiku, given a permissive schema and no field list, calls `submit_general_response({})` with no `reply`. The handler's `args.reply ?? "(no reply)"` fallback fires and the user sees nothing useful. **All 7 skills are affected. v4 is broken end-to-end despite passing unit tests.**

The bug is latent. Unit tests at `src/modules/skillDispatcher.test.ts` and `src/skills/<id>/handlers.test.ts` use stub LLM clients that return pre-built `tool_use` blocks with hand-crafted args — they bypass the schema entirely. As soon as a real Anthropic SDK call hits the empty schema, Haiku has nothing to follow except the prompt text, and tool-use models prefer the schema. The code comment at `skillDispatcher.ts:357-361` openly acknowledged the gap: *"Minimal tool schemas — for v2.01 the dispatcher exposes each declared tool with a permissive input_schema (object with no required props). [...] The full schema-per-tool model lands when we have a tool registry (FEAT080)."* FEAT080 was dissolved into the per-skill migrations FEAT057-063. The promised tool-registry work was never picked up. The shortcut became a production bug.

---

## Goals

1. Each of the 7 v4 skills declares an explicit tool schema for every tool it exports — `properties` enumerated, `required` populated, descriptions present.
2. The dispatcher builds tool calls from `skill.toolSchemas[toolName]` rather than the empty permissive fallback.
3. A real-LLM smoke against the live proxy produces a non-empty `reply` for every skill on at least one canonical phrase. This is **binding** for marking the FEAT done — stub-LLM unit tests are insufficient for this class of bug.
4. The skill-loader contract (`LoadedSkill`) carries `toolSchemas` alongside `handlers`, both for the bundle path (`SKILL_BUNDLE`) and the live-reload fs path.
5. No regression in the 7 skills' existing behavior on the unit-test suite.
6. The latent `sha256First16` "browser-unhash" path in `skillDispatcher.ts:170-183` is cleaned up while the file is touched (bonus, not gating).

---

## Success Metrics

- Real-LLM smoke: 7/7 canonical phrases (one per skill) produce a non-empty `userMessage` on the v4 path. Documented in `FEAT065_test-results.md`.
- Each skill's `toolSchemas` export has `required` populated with at least `reply` for every tool that owns the user-facing reply.
- Dispatcher fallback to the empty permissive schema fires zero times in the smoke run (assert via console-warn count).
- All baseline tests pass.
- `npm run bundle:skills` regenerates `_generated/skillBundle.ts` with byte-equal output across two consecutive runs (determinism preserved).
- `npm run build:web` exports.

---

## User Stories

### Story 1 — Declare tool schemas in `general_assistant`

**As a** user, **when** I say *"tell me a joke"*, **I want** the v4 path to actually produce a reply, **so that** I'm not staring at "(no reply)".

**Acceptance Criteria:**
- [ ] `src/skills/general_assistant/handlers.ts` exports a `toolSchemas` const with one entry: `submit_general_response`. `properties` includes `reply: { type: "string", description: "<...>" }`. `required: ["reply"]`. `additionalProperties: false` (architect can override per Q3).
- [ ] Real-LLM smoke: *"tell me a joke"* produces a non-empty `reply` and the chat shows a joke (or a polite explanation if the model declines).
- [ ] No code change to `submit_general_response` handler signature.
- [ ] Unit test (existing `submit_general_response` test) still passes with the stub LLM.

### Story 2 — Declare tool schemas in `priority_planning`

**As a** user, **when** I say *"what should I focus on?"*, **I want** the v4 path to return a real ranking, **so that** I get the same value the legacy path delivered.

**Acceptance Criteria:**
- [ ] `src/skills/priority_planning/handlers.ts` exports `toolSchemas` with TWO entries: `submit_priority_ranking` and `request_clarification` (it has multi-tool output).
- [ ] `submit_priority_ranking` schema: `properties` covers `ranked` (array of `{ taskId, reason }`, max 5), `topPick` (`{ taskId, reason }` object), `summary` (string). `required: ["ranked", "topPick", "summary"]`.
- [ ] `request_clarification` schema: `properties.question: { type: "string", ... }`, `required: ["question"]`.
- [ ] Real-LLM smoke: a "what should I focus on?" phrase against a small fixture state produces a populated `ranked` array, a `topPick`, and a `summary` — all surfaced in `userMessage`.
- [ ] Existing handler unit test passes.

### Story 3 — Declare tool schemas in `task_management`

**Acceptance Criteria:**
- [ ] `submit_task_action` schema has `properties` enumerating: `reply` (string), `writes` (array of `{ action: "add"|"update"|"delete", id?, data? }`), `items` (array — query results), `conflictsToCheck` (string array), `suggestions` (string array), `needsClarification` (boolean).
- [ ] `required: ["reply"]` (writes and items are operation-specific).
- [ ] `data` inside writes is `type: "object"`, `additionalProperties: true` (the executor accepts arbitrary task fields and shipping a full Task subset duplicates the shape PM proposes; architect can tighten — see Q4).
- [ ] Real-LLM smoke covers one create (*"add a task to call dentist"*), one update (*"mark the dentist task done"*), and one query (*"what's overdue?"*).
- [ ] Existing handler unit test passes.

### Story 4 — Declare tool schemas in `notes_capture`

**Acceptance Criteria:**
- [ ] `submit_note_capture` schema: `properties` covers `reply`, `writes` (array of `{ action: "add", data: { text } }`), `conflictsToCheck`, `needsClarification`.
- [ ] `required: ["reply"]`.
- [ ] `writes[].data.text` is a `required` field inside the writes-element object schema (the handler already drops writes without text — this codifies it at the schema layer too).
- [ ] Real-LLM smoke: *"save this idea: experiment with morning walks"* produces a write with the verbatim text.

### Story 5 — Declare tool schemas in `calendar_management`

**Acceptance Criteria:**
- [ ] `submit_calendar_action` schema: `properties` covers `reply`, `writes` (array of `{ action, id?, data }`), `items`, `conflictsToCheck`, `suggestions`, `needsClarification`.
- [ ] `required: ["reply"]`.
- [ ] Schema explicitly does NOT list `recurring`, `recurrence`, `recurrenceDay` in the writes-element `data` shape, so the LLM has no tool-schema affordance to emit them. (The handler still strips them defensively per FEAT059.)
- [ ] Real-LLM smoke: *"schedule a meeting tomorrow at 2pm"* produces a calendar add with title + datetime + durationMinutes.

### Story 6 — Declare tool schemas in `inbox_triage`

**Acceptance Criteria:**
- [ ] `submit_inbox_triage` schema: `properties` covers `reply`, `writes` (array — multi-file shape), `items`, `conflictsToCheck`, `suggestions`, `needsClarification`.
- [ ] Each write element schema includes `file` (string, with the 6 allowed values listed via `enum`: `"tasks", "calendar", "notes", "contextMemory", "userObservations", "recurringTasks"`), `action` (`enum: ["add", "update", "delete"]`), `id?`, `data?` (`type: "object"`, `additionalProperties: true` — the LLM produces per-file shapes the handler already validates), `sourceNoteId?`.
- [ ] `required: ["reply"]`.
- [ ] Real-LLM smoke: a 3-line bulk paste (*"call dentist, dinner Friday 7pm, idea about morning routine"*) produces three writes targeting the right files.

### Story 7 — Declare tool schemas in `emotional_checkin`

**Acceptance Criteria:**
- [ ] `submit_emotional_checkin` schema: `properties` covers `reply`, `writes` (array of `{ file, action: "add", data: { observation, date } }`), `needsClarification`.
- [ ] `required: ["reply"]`.
- [ ] The schema does NOT list any field that would let the LLM bypass the FEAT063 safety net (no extra free-text fields on the write that could carry the disclosure outside `userObservations`).
- [ ] Real-LLM smoke: *"I'm feeling stressed about the project"* produces a `userObservations` write + a 1-sentence reply.

### Story 8 — Wire schemas through registry, dispatcher, and bundle

**As an** architect, **I want** `LoadedSkill.toolSchemas` to be the single source of truth that `dispatchSkill` reads, **so that** schema definition lives next to the handler that consumes the args.

**Acceptance Criteria:**
- [ ] `src/types/skills.ts` adds a `toolSchemas: Record<string, AnthropicToolSchema>` field to `LoadedSkill` (or equivalent shape — architect names the type, see Q1).
- [ ] `src/modules/skillRegistry.ts` reads `toolSchemas` from each handler module (both the bundle path `loadFromBundle` / `buildSkillFromBundle` and the live-reload `loadFromFs` / `loadOneSkill`) and stores it on `LoadedSkill`.
- [ ] `src/modules/skillDispatcher.ts` `buildToolSchemas` returns `skill.toolSchemas[toolName]` for each tool; if missing, it falls back to today's empty permissive schema AND emits a `console.warn` naming the skill + tool. (Fallback policy — PM proposes WARN; architect can flip to fail-loud per Q5.)
- [ ] No change to the codegen at `scripts/bundle-skills.ts` is required: `import * as <skill>Handlers from "../<skill>/handlers"` already surfaces every named export including `toolSchemas`. **Verify** by running `npm run bundle:skills` and confirming the regenerated `_generated/skillBundle.ts` is byte-equal modulo formatting (no schema-shaped change to the file).

### Story 9 — Real-LLM smoke is binding (process change)

**As a** developer maintaining v4 skills, **I want** the test-results doc for this FEAT to require a real-LLM smoke against the live proxy, **so that** the same class of bug (latent because stub LLMs bypass schema) cannot ship again.

**Acceptance Criteria:**
- [ ] `FEAT065_test-results.md` includes a "Real-LLM smoke" section with one phrase per skill, the phrase, the LLM's `reply`, and a pass/fail flag.
- [ ] AGENTS.md gets one new entry codifying *"For any FEAT that touches the LLM-tool-call boundary, stub-LLM tests are insufficient. A real-LLM smoke (one phrase per affected skill, against the live proxy) is required before marking Done."* — architect locks the wording.
- [ ] The 7 phrases used in the smoke are listed in the FEAT spec so the next FEAT touching this surface can re-run them.

### Story 10 — No regression

**Acceptance Criteria:**
- [ ] All pre-FEAT065 baseline tests pass (`src/modules/skillDispatcher.test.ts`, the 7 per-skill handler test files, the FEAT054 registry test).
- [ ] `setV4SkillsEnabled([])` still falls back to legacy for every skill — schema declaration must not couple v4 enablement.
- [ ] `npm run build:web` exports.
- [ ] `npm run bundle:skills` is deterministic (two consecutive runs produce byte-equal output).

### Story 11 — Bonus: clean up `sha256First16` browser-unhash path

**As a** developer reading dispatcher logs, **I want** phrase hashes to be real even on the web build, **so that** I can correlate dispatcher logs with router logs.

**Acceptance Criteria:**
- [ ] `skillDispatcher.ts:170-183` `sha256First16` is replaced with a call to the existing `src/utils/sha256.ts` `sha256Hex` helper (used by `skillRegistry.ts` for locked-zone hashing — already isomorphic). Use a sync wrapper or refactor `logDispatchDecision` to be async-friendly — architect call.
- [ ] Same change applied to `src/modules/router.ts` if it has the same fallback (architect verifies — bonus only if both branches are touched in the same PR).
- [ ] **Bonus only.** If the change risks scope creep, defer to a separate FEAT and reference it from this spec.

---

## Out of Scope

- **FEAT066 — multi-token structural-trigger matcher / web phrase embedding.** A separate routing concern surfaced in the same smoke ("add a task" routed to `general_assistant` instead of `task_management` on web because phrase embedding is unavailable in the bundle). FEAT066 owns it.
- **Full per-tool schema validation infrastructure / tool registry (legacy FEAT080).** That work was dissolved into per-skill migrations and is no longer planned as a single deliverable. This FEAT codifies schemas in handler files; any future centralization is a refactor on top.
- **JSON-schema → TypeScript-type generation.** Each skill's args are already typed via inline interfaces in `handlers.ts` (e.g. `TaskActionArgs`, `CalendarActionArgs`). Keeping the schema and the interface as parallel hand-written sources is acceptable for v1. Architect may propose a generator in a future FEAT.
- **Tool-call retry logic.** If Haiku still emits empty args even with the proper schema, that's a separate concern (likely a prompt issue or model-tier issue, not a schema issue) and a separate FEAT.
- **FEAT044 Capacitor mobile work.**
- **AGENTS.md / docs back-fill of carry-forward items unrelated to the schema bug** — only the one entry codifying the real-LLM-smoke rule lands in this FEAT.
- **Strict-mode (`additionalProperties: false`) for every nested object inside writes/items.** PM proposes strict at the top level only; nested `data` shapes stay permissive (architect Q4).

---

## Assumptions & Open Questions

**Assumptions:**
- The Anthropic SDK's `tools` parameter accepts the standard JSON-schema shape: `{ name, description, input_schema: { type: "object", properties, required, additionalProperties } }`. Confirmed by inspection of the existing fallback in `skillDispatcher.ts:362-370`.
- Each skill's `handlers.ts` is a pure module that already exports named functions (one per tool). Adding a `toolSchemas` named export is mechanical and does not change the handler signatures.
- The codegen at `scripts/bundle-skills.ts` line 93 (`import * as ${cm}Handlers from "../${f.id}/handlers"`) already surfaces ALL named exports of the handlers module via the `* as` import. Adding `toolSchemas` flows through automatically. **Verified by reading the bundler.**
- Each handler's existing TypeScript interface (e.g. `TaskActionArgs`, `CalendarActionArgs`, `EmotionalCheckinArgs`) accurately documents the shape the LLM emits. The schemas in this FEAT are derived directly from those interfaces. If any interface is out of date, that's the bug to fix in stage 4.
- Haiku follows tool schemas reliably enough that emitting `required: ["reply"]` is sufficient to fix the bug. If Haiku still drops `reply` despite the schema, that's a separate problem (FEAT066 territory or model-tier escalation).

**Open Questions for the Architect:**

1. **`toolSchemas` type definition.** Should we (a) define an internal `LifeOSToolSchema` interface in `src/types/skills.ts` mirroring the Anthropic SDK's shape, or (b) import `Anthropic.Messages.Tool` directly from `@anthropic-ai/sdk`? PM leans (b) — fewer types to maintain, schema lives next to the SDK that consumes it. Architect call.

2. **Schema location — handlers.ts vs. separate `schemas.ts`.** PM proposes co-locating `toolSchemas` in each skill's `handlers.ts` (one file change per skill, no new file). Alternative: a separate `schemas.ts` per skill, imported by handlers and registered alongside. PM leans co-location for v1; revisit if `handlers.ts` files balloon. Architect call.

3. **`additionalProperties: false` vs. `true` at the top level.** PM proposes `false` at the top level of every tool's `input_schema` to catch typos and undocumented fields. Risk: Haiku may refuse to emit fields the schema permits but doesn't list, breaking a handler that relies on the field. Mitigation: every field the handler reads MUST be declared in the schema. Architect can override per skill if needed.

4. **`additionalProperties` for nested objects (writes[].data, items[]).** Each handler currently accepts `data: Record<string, unknown>` and applies its own per-file fill-in (`fillTaskDefaults`, `fillCalendarEventDefaults`, etc.). Should the schema enumerate those nested shapes too, or stay permissive at the nested level? PM proposes permissive at nested level for v1 (stay close to the existing handler contracts; tightening nested shapes is a follow-up FEAT). Architect call.

5. **Fallback policy for skills missing `toolSchemas`.** PM proposes WARN: dispatcher falls back to today's empty permissive schema and emits a `console.warn` naming the skill + tool. Useful for adding new skills incrementally. Alternative: fail-loud (throw at dispatch). Architect call.

6. **Unknown tool names emitted by the LLM.** Today's `dispatchSkill` already returns a degraded result when the LLM picks a tool the skill doesn't export (`skillDispatcher.ts:127-129`). Should the new schema-aware build also defend against an LLM emitting a tool whose schema is missing from `toolSchemas` even if the handler exists? PM proposes YES — the handler runs, but the dispatcher logs a warning that the tool ran without an enforced schema. Architect call.

7. **Real-LLM smoke harness.** Should the smoke be a new manual checklist in `FEAT065_test-results.md` (PM proposal — fastest), or a new automated `npm run smoke:v4` script that hits the proxy and asserts non-empty replies? PM proposes manual for v1; automation is a follow-up FEAT. Architect call.

---

## Migration Template Confirmation

This FEAT does NOT introduce a new migration template — every skill already follows the FEAT057 canonical shape. The change is purely additive: each skill gains a new top-level `toolSchemas` named export in `handlers.ts`. No handler signatures change. No prompt text changes. No manifest fields change.

The PM has read all 7 handler files. The proposed approach (co-locate `toolSchemas` in `handlers.ts`) is feasible across all 7:

- **`general_assistant`** — 1 tool, 1 field (`reply`). Trivial.
- **`priority_planning`** — 2 tools (`submit_priority_ranking` + `request_clarification`), 4 fields total. Schema is straightforward; the only minor complication is the nested `ranked: Array<{ taskId, reason }>` shape, which the schema enumerates.
- **`task_management`** — 1 tool (`submit_task_action`), 6 fields including a `writes` array. Nested `writes[]` shape is declarable but `data` stays permissive (per Q4).
- **`notes_capture`** — 1 tool (`submit_note_capture`), 4 fields including `writes` (always `action: "add"`). Schema can use `enum: ["add"]` to lock action.
- **`calendar_management`** — 1 tool (`submit_calendar_action`), 6 fields. Schema deliberately omits `recurring` / `recurrence` / `recurrenceDay` from the writes-element shape so the LLM has no affordance to emit them. The handler's strip-on-LLM-misbehavior remains as defense in depth.
- **`inbox_triage`** — 1 tool (`submit_inbox_triage`), 6 fields. Most complex schema: writes carry their own `file` field with a 6-value `enum` and an optional `sourceNoteId`. Nested `data` shape stays permissive (per Q4) since it varies per file.
- **`emotional_checkin`** — 1 tool (`submit_emotional_checkin`), 3 fields. Schema is constrained: writes must target `userObservations` with `{ observation, date }`. The schema does NOT include any extra fields that would let the LLM smuggle the disclosure outside the captured observation.

No handler exposes args complex enough to be infeasible to schema. The two skills with multi-tool / multi-file shapes (`priority_planning`, `inbox_triage`) are well-defined enough to hand-write.

---

## Architecture Notes

**Reviewer:** Architect agent. **Date:** 2026-04-27. **Decision summary** for the seven open PM questions and the wiring plan. Full design rationale + per-skill schema fingerprints in `FEAT065_design-review.md`.

**Decisions on the seven open questions:**

1. **`toolSchemas` type — SDK `Anthropic.Messages.Tool`.** Re-export a thin alias `SkillTool = Anthropic.Messages.Tool` from `src/types/skills.ts` so skill files import a project-owned name. Skills do not import `@anthropic-ai/sdk` directly; the alias decouples skill code from SDK upgrade churn while giving us SDK-authoritative shape (no hand-rolled mirror to drift).

2. **Schema location — co-locate in `handlers.ts`.** One named export per skill: `export const toolSchemas: Record<string, SkillTool> = {...}`. Mirrors FEAT063's helper-export pattern (`fillObservationDefaults` exported alongside the handler). No new file per skill. Revisit only if a single `handlers.ts` exceeds ~400 lines.

3. **Top-level `additionalProperties: false`.** Catch typos and undocumented fields at the schema layer. If Haiku refuses to emit a useful field, the fix is to add the field to the schema, not to relax the schema.

4. **Nested-object `data` + `items` permissive.** `writes[].data: { type: "object", additionalProperties: true }` and `items[]` shape stays loose. Per-file shapes vary; handlers already validate via `fillXxxDefaults` + `WRITE_ALLOWLIST`. Schema-per-file-type is a future FEAT (see §5 of design review).

5. **Fallback for missing `toolSchemas` — WARN + empty schema.** Backward-compat lane during incremental migration. Once all 7 skills declare `toolSchemas` and ship, downgrade to hard-error in a follow-up FEAT (tracked in design review §10).

6. **Defense for unknown tool name from LLM.** No new code. Existing `if (!handler) return degradedAndLog(...)` at `skillDispatcher.ts:127-129` already covers it. With `tool_choice: { type: "any" }` constraining the LLM to declared tools, this should be unreachable; keep the guard as defense-in-depth.

7. **Real-LLM smoke — manual + scratch script.** Tester runs the 7 phrases against the live proxy and pastes outputs into `FEAT065_test-results.md`. A `scripts/scratch/smoke-v4.ts` (gitignored — `scripts/scratch/` is already ignored per repo policy) wraps the loop for convenience but is not gating. The manual smoke output is the binding artifact. AGENTS.md gets one line: *"Every skill-touching FEAT must include a real-LLM smoke run before Done."*

**Files touched (v4 surface only):**
- `src/types/skills.ts` — add `SkillTool` alias re-exporting `Anthropic.Messages.Tool`; add `toolSchemas: Record<string, SkillTool>` to `LoadedSkill`.
- `src/modules/skillRegistry.ts` — thread `toolSchemas` through both `buildSkillFromBundle` (line 199-246) and `loadOneSkill` (line 339-455). Default to `{}` when handlers module exports none (paired with dispatcher's WARN).
- `src/modules/skillDispatcher.ts` — `buildToolSchemas` reads `skill.toolSchemas[toolName]`; falls back to today's permissive shape with `console.warn`. Replace `sha256First16` (line 170-183) with FNV-1a sync helper per FEAT064 condition 7 pattern (or import the FNV-1a helper FEAT064 created in `router.ts`).
- 7 × `src/skills/<id>/handlers.ts` — add `toolSchemas` named export.

**Codegen flow-through:** `scripts/bundle-skills.ts:93` already does `import * as <skill>Handlers from "../<skill>/handlers"`. The `* as` syntax surfaces every named export including `toolSchemas`. No bundler change required. Verified by re-reading the bundler. Acceptance: `npm run bundle:skills` regenerates `_generated/skillBundle.ts` byte-equal across two runs after the schema additions land — the new export is captured by reference, not embedded.

**Determinism note:** Schemas are static module-level constants. They do not change at runtime. Bundle output remains deterministic.

**Dependencies on prior FEATs:** FEAT054 (loader contract), FEAT057-063 (the 7 migrations whose handler interfaces define the schema shapes), FEAT064 (bundle path that already surfaces named exports automatically; FNV-1a helper in `router.ts` already in place per FEAT064 condition 7).

**Out-of-scope (architect confirms):** schema-per-file-type validation, JSON-schema → TS-type generation, automated smoke harness (FEAT066 territory or separate), `sha256First16` cleanup *unless trivial*. The bonus story 11 lands only if the FEAT064 FNV-1a helper is already exported and importable; otherwise defer to a separate FEAT.

**Status pipeline:** Planned → Design Reviewed (this pass) → In Progress (coder picks up next).

---

## UX Notes

No UX changes. Output of every skill on every phrase becomes more reliable; chat surface is unchanged.

---

## Testing Notes

*To be filled by the Architect agent. Key points the tester must cover (carry-forward into stage 4):*

- **Real-LLM smoke is binding** (Story 9). A unit-test-only pass does not satisfy the FEAT.
- The 7 canonical smoke phrases are listed in the spec body. Tester runs each against the live proxy with `setV4SkillsEnabled([all 7])`.
- Each skill's existing handler unit test must still pass — no behavior change at the handler layer.
- Determinism check: `npm run bundle:skills` produces byte-equal output across two consecutive runs after the schema additions.

---

## References

- **Bug discovered:** FEAT064 manual smoke (test-results.md) — *"tell a joke"* → "(no reply)"; "add a task" → general_assistant fallback → "(no reply)".
- **Buggy code:** `src/modules/skillDispatcher.ts:80-152` (dispatch flow), `src/modules/skillDispatcher.ts:356-371` (`buildToolSchemas` returns empty permissive schema).
- **Self-acknowledged shortcut:** code comment at `src/modules/skillDispatcher.ts:357-361` ("for v2.01 the dispatcher exposes each declared tool with a permissive input_schema [...] The full schema-per-tool model lands when we have a tool registry (FEAT080)"). FEAT080 was dissolved into FEAT057-063 per-skill migrations and never re-formed as a single deliverable.
- **Affected skills (7):**
  - `src/skills/general_assistant/handlers.ts` — `submit_general_response`
  - `src/skills/priority_planning/handlers.ts` — `submit_priority_ranking`, `request_clarification`
  - `src/skills/task_management/handlers.ts` — `submit_task_action` (TaskActionArgs interface)
  - `src/skills/notes_capture/handlers.ts` — `submit_note_capture` (NoteCaptureArgs interface)
  - `src/skills/calendar_management/handlers.ts` — `submit_calendar_action` (CalendarActionArgs interface)
  - `src/skills/inbox_triage/handlers.ts` — `submit_inbox_triage` (InboxTriageArgs interface)
  - `src/skills/emotional_checkin/handlers.ts` — `submit_emotional_checkin` (EmotionalCheckinArgs interface)
- **Wiring touchpoints:** `src/types/skills.ts` (LoadedSkill), `src/modules/skillRegistry.ts` (loadFromBundle, loadFromFs), `src/modules/skillDispatcher.ts` (buildToolSchemas), `src/skills/_generated/skillBundle.ts` (FEAT064 codegen — surface check only).
- **Related FEATs:** FEAT054 (skill loader / dispatcher), FEAT055 (Schema Registry), FEAT056 (chat.tsx wiring), FEAT057-063 (per-skill migrations), FEAT064 (build-time bundling — smoke surfaced this bug), FEAT066 (separate — multi-token routing matcher / web phrase embedding).
- **Anthropic tool-use shape:** standard JSON-schema — `{ name, description, input_schema: { type: "object", properties: { fieldName: { type, description, ... } }, required: [...], additionalProperties: boolean } }`. Reference: `https://docs.anthropic.com/en/docs/build-with-claude/tool-use`.
