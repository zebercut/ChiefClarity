# FEAT065 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT065_Fix_v4_dispatcher_declare_tool_schemas_per_skill.md`
**Refs:** FEAT054 (loader / `LoadedSkill` contract), FEAT055 (Schema
Registry / dataSchemas), FEAT057 (canonical migration template +
single-tool array writes), FEAT058 (notes_capture / free-form capture
template), FEAT059 (calendar_management + `stripRecurringFields` defense
in depth), FEAT060 (inbox_triage + `WRITE_ALLOWLIST` + `_arrayKey`),
FEAT063 (emotional_checkin + handler safety net),
FEAT064 (build-time bundling — `import * as <skill>Handlers` surfaces every
named export; FNV-1a helper already in `router.ts`).
`src/modules/skillDispatcher.ts:356-371` (the buggy
`buildToolSchemas`); `src/modules/skillDispatcher.ts:170-183` (stale
`sha256First16` browser-unhash stub); `src/modules/skillRegistry.ts:199-246`
(`buildSkillFromBundle`); `src/modules/skillRegistry.ts:339-455`
(`loadOneSkill`); `src/types/skills.ts:109-125` (`LoadedSkill`).
The seven skill folders' `handlers.ts` (audited line-by-line for the
schema fingerprint table in §4).

---

## 1. Verdict

**APPROVED for implementation** subject to §7 conditions.

Pure bug fix with a small additive contract change. No new architecture
patterns, no new modules, no new data files. The seven migrated skills
(FEAT057-063) already document their args via TypeScript interfaces
(`TaskActionArgs`, `CalendarActionArgs`, `NoteCaptureArgs`,
`InboxTriageArgs`, `EmotionalCheckinArgs`, plus the inline shape in
priority_planning and general_assistant). The schemas in this FEAT are
mechanical translations of those interfaces into JSON-schema form,
co-located in `handlers.ts` per §3.2.

The load-bearing artifact is the **real-LLM smoke** (§7 condition 14).
Stub-LLM unit tests bypass the schema entirely — that is exactly how
this bug got latent through FEAT054-063. The smoke is binding.

The bonus `sha256First16` cleanup (Story 11) is approved only if the
FEAT064-introduced FNV-1a helper in `router.ts` is exported and
importable; otherwise it's a one-line ripple to a separate FEAT and not
worth scope creep here.

---

## 2. Architecture (one screen)

```
┌─ Skill folder (per-skill, edit each of 7) ──────────────────────────┐
│ src/skills/<id>/handlers.ts                                         │
│   export const submit_<tool>: ToolHandler = async (args, ctx) ...   │
│   export const toolSchemas: Record<string, SkillTool> = {           │ NEW
│     submit_<tool>: {                                                │
│       name: "submit_<tool>",                                        │
│       description: "<...>",                                         │
│       input_schema: {                                               │
│         type: "object",                                             │
│         properties: { reply: {...}, writes: {...}, ... },           │
│         required: ["reply"],                                        │
│         additionalProperties: false,                                │
│       },                                                            │
│     },                                                              │
│   };                                                                │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ Build (FEAT064) ───────────────────────────────────────────────────┐
│ scripts/bundle-skills.ts                                            │
│   import * as <skill>Handlers from "../<skill>/handlers";           │
│   ↑ already surfaces every named export including toolSchemas       │
│ → src/skills/_generated/skillBundle.ts  (no code change to bundler) │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ Registry (one ripple per loader path) ─────────────────────────────┐
│ src/modules/skillRegistry.ts                                        │
│   buildSkillFromBundle  → reads entry.handlers.toolSchemas          │ NEW
│   loadOneSkill          → reads handlersModule.toolSchemas          │ NEW
│   stores on LoadedSkill.toolSchemas                                 │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ Dispatcher (one function rewrite) ─────────────────────────────────┐
│ src/modules/skillDispatcher.ts                                      │
│   buildToolSchemas(skill):                                          │
│     for each toolName in skill.manifest.tools:                      │
│       schema = skill.toolSchemas[toolName]                          │
│       if (!schema) {                                                │
│         console.warn("missing toolSchema: <skill>/<tool>")          │
│         schema = <today's permissive empty fallback>                │ kept
│       }                                                             │
│       yield schema                                                  │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ Anthropic API (LLM) ───────────────────────────────────────────────┐
│ messages.create({ tools: [...explicit schemas...],                  │
│                   tool_choice: { type: "any" } })                   │
│ → Haiku/Sonnet emit tool_use with required fields populated         │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ Handler ───────────────────────────────────────────────────────────┐
│ skill.handlers[toolName](args, ctx) → { userMessage, ... }          │
│ args.reply now reliably populated (was empty under old schema)      │
└─────────────────────────────────────────────────────────────────────┘
```

**Type alias:** `src/types/skills.ts` adds
`export type SkillTool = Anthropic.Messages.Tool;` so skills import
a project-owned name. The actual SDK type lives at the Anthropic
package boundary; skills never `import "@anthropic-ai/sdk"` directly.

**LoadedSkill change:** one new field —
`toolSchemas: Record<string, SkillTool>`. Default is `{}` so the
WARN path stays open during incremental migration.

---

## 3. Alternatives considered

### 3.1 `toolSchemas` type — SDK type alias vs internal mirror

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Internal `LifeOSToolSchema` interface mirroring SDK shape | Skill files don't pull SDK; clean dependency direction | Hand-rolled mirror drifts as SDK evolves. Today the SDK shape is `{ name, description, input_schema: { type: "object", properties, required, additionalProperties } }` — but the SDK ships periodic clarifications. Maintaining a parallel definition is the *exact* cost we paid in FEAT055's stub `dataSchemas` until FEAT057 unified. | Reject |
| **(b) `SkillTool = Anthropic.Messages.Tool` alias re-exported from `src/types/skills.ts` (CHOSEN)** | SDK-authoritative; skills never break on SDK upgrade because the alias just re-points. Skills import `SkillTool` from `../../types/skills` — the alias is the project-owned coupling point. `@anthropic-ai/sdk` is already a hard dep (used by `llm.ts`, `skillDispatcher.ts`); no new dep. | Skills are now structurally coupled to SDK type semantics. SDK breaking changes ripple to all 7 skill files in one go. | **CHOSEN** |
| (c) Untyped `Record<string, unknown>` with runtime validation | Maximum flexibility | Defeats the point — TypeScript is the first line of defense for schema correctness. Runtime validation costs perf for zero benefit when the SDK shape is stable. | Reject |

**Decision rationale:** the SDK type is already a transitive dep of
every skill via the `ToolHandler` it receives args for. Re-exporting
under a project name (`SkillTool`) gives us a clean, refactor-safe
indirection. This mirrors the project's existing pattern of re-exporting
SDK types under project names (e.g., `MODEL_HEAVY` / `MODEL_LIGHT` in
`llm.ts`).

### 3.2 Schema location — co-locate in `handlers.ts` vs separate `schemas.ts`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) Co-locate in `handlers.ts` (CHOSEN)** | Mirrors FEAT063 `fillObservationDefaults` export pattern. Schema sits next to the handler it describes — a future change to one is a visible diff against the other in the same file. No new file count. Coder can update both shape + handler in one PR. | `handlers.ts` for `inbox_triage` (currently ~260 lines) grows by ~80-100 lines for the multi-file schema. Approaching the soft 400-line ceiling but not breaching. | **CHOSEN** |
| (b) Separate `src/skills/<id>/schemas.ts` per skill | Clean separation of concerns | New file × 7 — extra cognitive cost for grep'ing. Risk of schema/handler drift across files (the exact bug class this FEAT fixes structurally). | Reject |
| (c) Centralized `src/skills/_shared/schemas.ts` | One file, one source of truth | Same anti-pattern FEAT060/063 explicitly rejected for `_shared/defaults.ts` — coupling all skills to one file means every schema edit touches the shared file and re-routes review. | Reject |

**Decision rationale:** this matches every prior FEAT's helper-export
pattern (FEAT059's `getActiveEvents`, FEAT063's `fillObservationDefaults`).
Co-location keeps the contract close to its consumer.

### 3.3 Strict vs permissive top-level + nested

| Level | Option | Verdict |
|---|---|---|
| Top-level `additionalProperties` | **`false` (CHOSEN)** | Catches typos and undocumented LLM emissions. If a real field is needed, declare it. |
| Top-level `additionalProperties` | `true` | Lets the LLM smuggle fields the handler ignores; defeats the whole point. Reject. |
| Nested `writes[].data` | **`additionalProperties: true` (CHOSEN)** | Per-file shapes vary; handlers already validate via `fillXxxDefaults` + `WRITE_ALLOWLIST` (`inbox_triage`). Tightening here requires schema-per-file-type which is a follow-up FEAT. |
| Nested `writes[].data` | `additionalProperties: false` with full file-shape enumeration | Today's interfaces don't enumerate every file's data shape (`task_management` uses `Record<string, unknown>`; `notes_capture` uses `Partial<Note> & { text?: string }`). Hand-rolling 6 file shapes here is scope creep into FEAT080-style work. Reject. |
| Nested `items[]` | **`type: "object"`, no enumeration (CHOSEN)** | `ActionItem` shape is loose by design. The dispatcher passes through to the chat surface; no executor consumption. |

### 3.4 Fallback when skill missing `toolSchemas`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) WARN + empty permissive schema (CHOSEN — backward compat lane)** | Migration friendly. New skill author can ship the handler first, schema second, with a visible WARN on every dispatch until they declare. | Same bug class can re-emerge if a skill ships without schema and the WARN goes unread. | **CHOSEN for v1; downgrade to hard-error in a follow-up FEAT after all 7 skills land** |
| (b) Hard-error at dispatch time | Fail-loud; impossible to ship without schema | Blocks incremental migration; if the coder lands schema for 5 of 7 skills the system breaks for the other 2 mid-rollout. | Reject for v1 |
| (c) Hard-error at registry-load time | Fail-loudest; no skill loads without schema | Same blocker as (b), surfaces at boot instead of dispatch. | Reject for v1 |

**Decision rationale:** the warn-plus-fallback policy is identical to
FEAT054's "skip skill on bad manifest" lane and FEAT060's
`WRITE_ALLOWLIST` drop-and-warn pattern. Consistency with prior
template choices wins.

### 3.5 Real-LLM smoke harness — manual vs scripted vs CI

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) Manual checklist + `scripts/scratch/smoke-v4.ts` convenience wrapper (CHOSEN)** | Tester reads a 7-row table in `FEAT065_test-results.md` and runs each phrase. Scratch script automates the loop but isn't binding. `scripts/scratch/` is gitignored per repo policy — the script is a developer tool, not a deliverable. | Manual outputs are unstructured prose. | **CHOSEN** |
| (b) Fully automated `npm run smoke:v4` script in `scripts/` proper | Re-runnable; CI-able later | LLM responses vary; assertions on "non-empty reply" are weak (the reply could be wrong but non-empty); brittle under proxy outages. Costs accumulate. | Reject — separate FEAT if we ever add CI |
| (c) No smoke; trust unit tests | Fastest | The exact failure mode that produced this bug. Reject. | Reject |

**Decision rationale:** manual is sufficient signal at FEAT-shipment
time. The convenience script is opt-in; it does not gate Done. AGENTS.md
gets a process line.

---

## 4. Per-skill schema fingerprint table

Architect-derived from a line-by-line read of each `handlers.ts`. The
coder implements these shapes directly. **All schemas use top-level
`additionalProperties: false` per §3.3.** Nested `data` permissive.

### 4.1 `general_assistant`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_general_response` | `reply: string` | — | — | — | — |

Schema: 1 field, 1 required. Trivial. Description should note
"plain-text conversational reply".

### 4.2 `priority_planning`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_priority_ranking` | `ranked: Array<{ taskId, reason }>` (max 5), `topPick: { taskId, reason }`, `summary: string` | — | — | `ranked[]` (each: `{ taskId: string, reason: string }`) | — |
| `request_clarification` | `question: string` | — | — | — | — |

Schema notes: `ranked` array gets `maxItems: 5`. `topPick` is an object,
not an array. Each `ranked[]` element has `additionalProperties: false`
locally. `request_clarification` is the second tool — Haiku picks one
or the other; `tool_choice: { type: "any" }` already allows that.

### 4.3 `task_management`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_task_action` | `reply: string` | `writes`, `items`, `conflictsToCheck`, `suggestions`, `needsClarification` | `writes[].action: "add"\|"update"\|"delete"` | `writes[]` (each: `{ action, id?, data? }`), `items[]`, `conflictsToCheck: string[]`, `suggestions: string[]` | — |

Schema notes: `writes[].data` is `type: "object", additionalProperties:
true`. `writes[].id` optional string (used for update/delete). `items[]`
left permissive (chat-surface render only).

### 4.4 `notes_capture`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_note_capture` | `reply: string` | `writes`, `conflictsToCheck`, `needsClarification` | `writes[].action: "add"` (single-value enum — locks to create-only) | `writes[]` (each: `{ action: "add", data: { text, ... } }`) | — |

Schema notes: action is a single-value enum `["add"]` — codifies
"notes_capture is create-only" at the schema layer. `writes[].data.text`
is **required** inside the writes-element schema (handler already drops
writes without text — schema enforces it pre-handler too).

### 4.5 `calendar_management`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_calendar_action` | `reply: string` | `writes`, `items`, `conflictsToCheck`, `suggestions`, `needsClarification` | `writes[].action: "add"\|"update"\|"delete"` | `writes[]`, `items[]`, `conflictsToCheck: string[]`, `suggestions: string[]` | **`writes[].data` MUST NOT list `recurring`, `recurrence`, `recurrenceDay`** (per FEAT059 — schema removes the affordance; handler still strips defensively) |

Schema notes: this is the only schema with explicit fingerprint omission.
`writes[].data` is permissive (`additionalProperties: true`) **except**
the schema description for `data` MUST state "do not include recurring/
recurrence/recurrenceDay — those are handled by recurring_tasks skill"
so Haiku has both no schema affordance AND prompt reinforcement.

### 4.6 `inbox_triage`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_inbox_triage` | `reply: string` | `writes`, `items`, `conflictsToCheck`, `suggestions`, `needsClarification` | `writes[].action: "add"\|"update"\|"delete"`, `writes[].file: "tasks"\|"calendar"\|"notes"\|"contextMemory"\|"userObservations"\|"recurringTasks"` | `writes[]` (each: `{ file, action, id?, data?, sourceNoteId? }`), `items[]` | — |

Schema notes: this is the most complex schema. `writes[].file` is the
6-value enum mirroring `WRITE_ALLOWLIST` in handlers.ts. `sourceNoteId`
is an optional string; preserved through `normalizeWrite`.
`writes[].data` permissive — per-file shapes vary; handler validates via
`applyDefaultsForFile`.

### 4.7 `emotional_checkin`

| Tool | Required | Optional | Enums | Nested arrays | Omit |
|---|---|---|---|---|---|
| `submit_emotional_checkin` | `reply: string` | `writes`, `needsClarification` | `writes[].action: "add"` (single-value), implicit `writes[].file: "userObservations"` (schema lists only this value if `file` is declarable) | `writes[]` (each: `{ action: "add", data: { observation, date, _arrayKey? } }`) | **`writes[]` MUST NOT include any extra free-text or top-level fields beyond `observation` + `date` (+ optional `_arrayKey`).** No `severity`, `mood_score`, `note`, etc. — the schema does not give the LLM a place to smuggle the disclosure outside the captured observation. |

Schema notes: this is a sensitive-content skill (FEAT063 safety scope).
The schema is **deliberately narrow** — every additional field would be
a place the LLM could put crisis-disclosure-related text that the
FEAT063 safety net wouldn't reach. `writes[].data.observation` is
**required** inside the writes-element schema. `writes[].data` itself
is `additionalProperties: false` for this skill (overriding the §3.3
permissive default — this is the one explicit override in the FEAT).
The handler's `needsClarification` safety net (FEAT063 condition 6)
remains unchanged.

---

## 5. Cross-feature concerns

**Upstream:** FEAT054 (loader contract — `LoadedSkill`), FEAT055
(dataSchemas — orthogonal, not modified), FEAT057-063 (the 7 skills
whose handler interfaces define the schema fingerprints in §4),
FEAT064 (build-time bundling — `import * as <skill>Handlers` already
surfaces every named export; no bundler change). All Done.

**FEAT064 codegen reuse.** Verified by reading the bundler:
`scripts/bundle-skills.ts:93` does `import * as ${cm}Handlers from
"../${f.id}/handlers"`. The `* as` syntax surfaces every named export.
Adding a `toolSchemas` named export flows through automatically. The
generated bundle's `BundledSkill.handlers` is typed
`Record<string, ToolHandler>` — that's currently a lossy cast for
non-handler exports. For runtime correctness this is fine (handlers
read by name in the registry; toolSchemas read by name in the registry),
but the architect notes: condition 7 below tightens the bundler's
TS type to allow `toolSchemas` first-class. Not blocking — the
runtime read-by-name path works regardless.

**FEAT044 Capacitor (in flight).** The `LoadedSkill.toolSchemas`
addition rides through the same bundle path Capacitor will use. No
Capacitor-specific concern. The FEAT044 architect can rely on the
schema-aware dispatcher being a finished surface by the time
FEAT044 lands.

**Future FEAT — schema-per-file-type validation.** This FEAT keeps
nested `data` permissive (per §3.3). A future FEAT can introduce a
`src/types/file_shapes/` module exporting per-`FileKey` JSON schemas,
and each skill's `writes[].data` schema can `oneOf` over the relevant
file shapes. Tracked as carry-forward in §10.

**Future FEAT — `toolSchemas` hard-error.** Once all 7 skills declare
schemas and ship cleanly, the WARN fallback (§3.4) downgrades to a
hard-error at registry load. Tracked as carry-forward in §10.

**Future FEAT — multi-token routing matcher (FEAT066).** Out of scope
here. The PM spec correctly separates "soft phrase routes to wrong
skill" (FEAT066) from "right skill produces empty reply" (this FEAT).

**`sha256First16` cleanup (Story 11 / bonus).** FEAT064 condition 7
already replaced `sha256First16` in `router.ts` with FNV-1a. The
duplicate copy in `skillDispatcher.ts:170-183` is an orphan. Cleanup is
**bonus only** — if FEAT064 exported the FNV-1a helper, this FEAT
imports and reuses it. If not, defer to a separate FEAT to avoid scope
creep here. The coder confirms by grep'ing `router.ts` for the helper's
export shape. **Bonus only — not gating.**

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Schema/prompt drift** — schema is added but the prompt still describes a different field set; LLM follows whichever signal is louder. | Medium | Medium | Coder reads each skill's `prompt.md` while authoring the schema; if a prompt-named field is missing from the schema, it's added. Code review checklist: "every prompt-named arg appears in schema, and vice versa". |
| **LLM emits empty `reply` despite `required: ["reply"]`** | Low | High | Anthropic's tool-use models reliably honor `required` per the SDK contract. If Haiku still drops `reply`, that's a model-tier issue (escalate to Sonnet for that skill) or a prompt issue (sharpen "set `reply` to..."). Not a schema issue. Mitigation: smoke catches it; if it fires, the response is a separate FEAT (model-tier / prompt) not a schema rollback. |
| **Nested-shape validation gaps** — `writes[].data: { additionalProperties: true }` lets the LLM emit garbage that the handler then has to filter. | Medium | Low | Already the status quo. Handlers (FEAT057-060) already have per-write filters (`fillTaskDefaults`, `WRITE_ALLOWLIST`, `stripRecurringFields`). This FEAT does not regress; it leaves nested-shape tightening for a follow-up FEAT. |
| **Backward-compat WARN policy lifetime** — WARN fallback (§3.4) becomes permanent because nobody picks up the follow-up FEAT to harden it. | Medium | Low | Tracked in §10 as a carry-forward. Add a TODO comment in `skillDispatcher.ts` referencing the future FEAT id. The 7 in-scope skills all declare `toolSchemas` here, so the WARN never fires in production once this lands — only triggers if a *new* skill ships without one. |
| **`additionalProperties: false` rejects field Haiku wants to emit** — for example a not-yet-declared `priority` on a write that the handler defaults anyway. | Medium | Medium | Code review checklist: every field the *handler reads* is declared in the schema. If Haiku wants to emit something the handler doesn't read, that's a prompt issue. The smoke catches the visible symptom (LLM declines the tool call entirely on schema rejection). Worst case: relax to `true` for that one skill. |
| **Bundle non-determinism** — adding `toolSchemas` exports changes the import shape captured by `* as <skill>Handlers`; bundler emits non-deterministic output. | Low | Medium | Bundler captures by reference, not by value, for handlers/toolSchemas. The emitted file's content is the same shape (just `<id>: { manifest, prompt, context, handlers }`). Determinism check (run twice, byte-equal) is in §8. |
| **Real-LLM smoke proxy outage during stage 7** | Medium | Medium | The smoke is binding but tester can re-run when proxy is back. The FEAT does not claim Done until the smoke passes. Process expectation is documented in AGENTS.md update (condition 13). |
| **`emotional_checkin` over-strict schema** — §4.7's `additionalProperties: false` on `writes[].data` rejects a field Haiku correctly emits per a future prompt update. | Low | Medium | The strict shape is *intentional* for safety (FEAT063 sensitive-content scope). Any future prompt change that wants new fields lands as part of a FEAT that updates the schema in lockstep — code review checklist enforces. |
| **SDK type drift** — `Anthropic.Messages.Tool` shape changes in a future SDK upgrade. | Low | Low | The `SkillTool` alias is the single re-export point. SDK upgrade: edit one alias, run typecheck, fix call sites. The alias gives us the indirection. |

---

## 7. Conditions (numbered)

1. All Story 1-11 acceptance criteria testable + tested in stage 7.
2. **`SkillTool` alias** added to `src/types/skills.ts`:
   `export type SkillTool = Anthropic.Messages.Tool;`. Skills import
   `SkillTool` from `../../types/skills`, NOT from `@anthropic-ai/sdk`.
3. **`LoadedSkill.toolSchemas` field** added to
   `src/types/skills.ts`: `toolSchemas: Record<string, SkillTool>`
   (default `{}` when absent — see condition 5).
4. **All 7 skills declare `toolSchemas`** as a top-level named export
   in their `handlers.ts`, with shapes per the §4 fingerprint table.
   Each tool listed in `manifest.tools` has a matching schema entry.
   Schemas use top-level `additionalProperties: false`. Nested
   `writes[].data` is permissive **except for `emotional_checkin`**
   which uses strict nested per §4.7.
5. **Registry threading** — both
   `skillRegistry.ts::buildSkillFromBundle` and
   `skillRegistry.ts::loadOneSkill` read `toolSchemas` from the
   handlers module (`handlersModule.toolSchemas` / `entry.handlers.toolSchemas`).
   Default to `{}` when the export is missing. No throw on missing.
6. **Dispatcher schema-aware** —
   `skillDispatcher.ts::buildToolSchemas(skill)` returns
   `skill.toolSchemas[toolName]` for each tool. If missing, fall back to
   today's permissive empty schema AND emit
   `console.warn("[skillDispatcher] missing toolSchema for <skill>/<tool>")`.
7. **Bundler typing** (light tightening) — update
   `scripts/bundle-skills.ts::BundledSkill.handlers` typing to allow
   the named export `toolSchemas` without a lossy cast. Acceptable shape:
   `handlers: Record<string, ToolHandler> & { toolSchemas?: Record<string, SkillTool> }`
   or split into two fields. Coder picks whichever yields cleanest TS.
   Output remains byte-equal across two consecutive runs.
8. **Fallback policy is WARN, not throw, for v1** (per §3.4). A `TODO`
   comment in `skillDispatcher.ts::buildToolSchemas` notes
   "Downgrade to hard-error in a follow-up FEAT once all skills carry
   toolSchemas in production for one release cycle." Carry-forward
   tracked in §10.
9. **Defense-in-depth for unknown tool name** — no new code; existing
   `if (!handler) return degradedAndLog(...)` (`skillDispatcher.ts:127-129`)
   covers it. Coder confirms the path is unchanged.
10. **Bonus — `sha256First16` cleanup**, conditional. If FEAT064's
    FNV-1a helper is exported from `router.ts` (or moved to
    `src/utils/`), import and reuse it in `skillDispatcher.ts::sha256First16`.
    Otherwise leave the orphan in place and file a separate FEAT. **Not
    gating.** Coder spends ≤30 min checking; ships either way.
11. **Bundle determinism** — `npm run bundle:skills` produces byte-equal
    output across two consecutive runs after the schema additions land.
12. **Web build still exports** — `npm run build:web` exits 0.
13. **AGENTS.md updated** with one new entry: *"Every FEAT that
    touches the LLM-tool-call boundary must include a real-LLM smoke
    against the live proxy before the FEAT is marked Done. One canonical
    phrase per affected skill, output captured in the FEAT's
    test-results.md. Stub-LLM unit tests are insufficient — they bypass
    the schema layer."*
14. **MANDATORY — Real-LLM smoke (binding)** — tester runs the 7 phrases
    in §8.5 against the live proxy (api-proxy + Haiku). For each phrase:
    `userMessage` is non-empty, the matched skill produces a sensible
    reply, no `(no reply)` fallback fires. Outputs pasted into
    `FEAT065_test-results.md` "Real-LLM smoke" section verbatim. Pass
    threshold: **7/7 strict.** If any phrase fails, do NOT mark Done;
    return to architect for prompt or schema revision.
15. **Existing handler unit tests pass unchanged** — all 7
    `src/skills/*/handlers.test.ts` files green.
16. **Existing dispatcher + registry unit tests pass unchanged** —
    `src/modules/skillDispatcher.test.ts` and
    `src/modules/skillRegistry.test.ts` green.
17. **New unit tests** (per §8) — schema-validation test, registry
    threading test, dispatcher fallback test.
18. **`docs/new_architecture_typescript.md` updated** — Section 5
    (`SkillTool` alias added; `LoadedSkill.toolSchemas` field documented),
    Section 9 (ADR for schema-per-skill pattern + WARN fallback policy
    + future hard-error follow-up), Section 12 (acknowledgment that
    v4 chat reliability is restored).
19. **No regression of `setV4SkillsEnabled([])`** — disabling all v4
    skills still falls back to legacy on every phrase.
20. **Zero changes** to `chat.tsx`, `executor.ts`, `assembler.ts`,
    `router.ts` (except possibly the bonus `sha256First16` import), the
    7 skills' `prompt.md` / `manifest.json` / `context.ts` files. Schema
    addition is purely additive in `handlers.ts`.

---

## 8. UX

**Zero changes** to existing surfaces. No new modals, no new buttons,
no new chat affordances.

**Visible delta after this FEAT lands:**
- Chat reliability for the 7 v4 skills is **restored**. *"tell a joke"*
  now produces a joke. *"what should I focus on?"* now produces a
  ranking. *"add a task to call the dentist"* now produces a write +
  confirmation. The `(no reply)` fallback that fired for every v4 skill
  in the FEAT064 smoke goes away.

That is the entire user-visible scope. The fix is invisible at the chat
surface (correct outputs replace empty outputs); no new affordances.

---

## 9. Test strategy

### 9.1 Unit tests — registry threading

- **Bundle path** (`buildSkillFromBundle`): fixture bundle entry whose
  `handlers` module exports a `toolSchemas` constant. Assert
  `LoadedSkill.toolSchemas` equals the exported value.
- **Bundle path — missing schemas**: fixture bundle entry whose
  `handlers` module does NOT export `toolSchemas`. Assert
  `LoadedSkill.toolSchemas === {}` (no throw).
- **Fs path** (`loadOneSkill`): fixture skill folder with
  `handlers.ts` exporting `toolSchemas`. Assert threading.
- **Fs path — missing schemas**: fixture skill folder without the
  export. Assert `{}` and no throw.

### 9.2 Unit tests — dispatcher fallback

- Skill with full `toolSchemas` populated: dispatcher's
  `buildToolSchemas` returns the declared schema for each tool.
- Skill with missing schema for one declared tool: dispatcher emits
  `console.warn` (capture + assert) and returns the empty permissive
  fallback for that tool. The other tool's schema is unaffected.
- Skill with empty `toolSchemas: {}`: every declared tool warns + falls
  back. Length matches `manifest.tools.length`.

### 9.3 Unit tests — schema-vs-handler-args coherence

For each of the 7 skills, validate that every field the handler reads
appears in the schema. Implementation options:

- **Preferred — TypeScript compile-time check.** Write a type-level
  assertion: `type RequiredFields = keyof <HandlerArgsType>`, then
  `assertExtends<RequiredFields, keyof typeof toolSchemas[<tool>].input_schema.properties>`.
  If the schema is missing a field the handler reads, the build fails.
- **Acceptable — runtime test.** Parse each `toolSchemas[tool].input_schema.properties`
  keys and assert they are a superset of the fields the handler
  destructures. Less precise but adequate.

The coder picks one. The compile-time check is preferable because it
catches drift at PR time.

### 9.4 Unit tests — schema-shape validity

For each of the 7 skills' `toolSchemas`:
- `name === <expected tool id>`
- `description.length > 0`
- `input_schema.type === "object"`
- `input_schema.required` includes `"reply"` (or `"question"` for
  `request_clarification`)
- `input_schema.additionalProperties === false`
- `input_schema.properties` contains every field listed in §4 for that
  skill

### 9.5 Determinism — bundle output

`npm run bundle:skills` produces byte-equal output across two runs
after the schema additions. Run via `diff` after sequential runs.

### 9.6 MANDATORY — Real-LLM manual smoke (binding per condition 14)

Run against the live proxy (`npm run dev` + api-proxy). For each of
the 7 phrases below, paste the actual `userMessage` into
`FEAT065_test-results.md`. **Pass threshold: 7/7.**

| # | Skill | Phrase | Expected outcome |
|---|---|---|---|
| 1 | `general_assistant` | *"tell me a joke"* | Reply contains a joke or polite explanation. Non-empty `reply`. |
| 2 | `priority_planning` | *"what should I focus on?"* | Reply contains a `topPick` + `summary` + at least one ranked item. (Requires fixture state with at least one task; if state is empty, `request_clarification` fires with a non-empty `question`.) |
| 3 | `task_management` | *"add a task to call the dentist tomorrow"* | One `add` write to `tasks.json` with `title` containing "dentist". Reply confirms creation. |
| 4 | `notes_capture` | *"save this idea: try a morning walk routine"* | One `add` write to `notes.json` with `text` near-verbatim. Reply confirms. |
| 5 | `calendar_management` | *"schedule a meeting tomorrow at 2pm"* | One `add` write to `calendar.json` with `title`, `datetime`, `durationMinutes`. Reply confirms. **No `recurring`/`recurrence` fields** in the persisted event. |
| 6 | `inbox_triage` | (3-line bulk paste) *"call dentist tomorrow, dinner Friday 7pm, idea about morning walks"* | Three writes targeting `tasks`, `calendar`, `notes` respectively. Reply summarizes. |
| 7 | `emotional_checkin` | *"I'm feeling stressed about the project"* | One `add` write to `userObservations.json` with `_arrayKey: "emotionalState"` and `observation` near-verbatim. Reply is a 1-sentence empathy acknowledgement (FEAT063 forbidden-phrase list still respected). |

**Tester documents in `FEAT065_test-results.md` for each row:** the
phrase, the actual `userMessage`, the file write outcome (read the data
file), and a pass/fail flag. If any row fails, the FEAT is NOT Done —
return to architect.

### 9.7 Regression — full existing suite

- All baseline tests pass unchanged.
- `setV4SkillsEnabled([])` still falls back to legacy on every phrase
  (condition 19).
- `npm run build:web` still exports.

---

## 10. Pattern Learning

**FEAT065 codifies the "schema-per-skill" template requirement** for
every skill-touching FEAT going forward.

### 10.1 Schema-per-skill is now part of the migration template

After this FEAT, the canonical migration template (the FEAT057-063
playbook) gains one new requirement:

- Every skill's `handlers.ts` exports a `toolSchemas` named constant,
  one entry per tool listed in `manifest.tools`.
- Top-level `additionalProperties: false`.
- Nested `data` permissive by default; strict for sensitive-content
  skills (per FEAT063 / FEAT065 §4.7).
- Schemas co-located with handlers; types via `SkillTool` alias.

The architect for any future skill migration FEAT must verify the
schema is present before approving design review. Code review
checklist asserts schema/handler/prompt three-way coherence.

### 10.2 Real-LLM smoke is binding for skill-touching FEATs

AGENTS.md gets a new entry per condition 13. Every FEAT that touches
the LLM-tool-call boundary (skills, dispatcher, prompts, manifests,
schemas) must include a real-LLM smoke against the live proxy before
Done. Stub-LLM tests are insufficient.

### 10.3 Carry-forward — future FEATs

- **`toolSchemas` hard-error** — once all 7 skills carry schemas in
  production for one release cycle, downgrade the dispatcher's WARN
  fallback to a hard-error at registry load. New skill = no schema =
  no boot. Tracked as a follow-up; coder leaves a TODO comment per
  condition 8.
- **Schema-per-file-type validation** — per-`FileKey` JSON schemas in
  `src/types/file_shapes/` would let `writes[].data` be validated
  per-file (not permissive). Touches all 7 skills + executor; non-trivial
  scope. Defer.
- **JSON-schema → TypeScript-type generation** — the `SkillTool` alias
  + manual `<HandlerArgsType>` interfaces are parallel hand-written
  sources today. A generator from JSON-schema to TS types eliminates
  drift but adds tooling cost. Defer until a third occurrence justifies
  the tooling.

After FEAT065:
- 7 skills declare explicit tool schemas.
- v4 chat reliability fully restored (FEAT064 smoke regression closed).
- Schema-per-skill template requirement codified.
- Real-LLM smoke is a binding process artifact for skill-touching FEATs.

---

## 11. Sign-off

Architect approves. Conditions §7 binding (20 items). Condition 14
(real-LLM smoke, 7/7 strict) is **the parity-defining artifact** —
coder must run it before declaring Done.

**Pay special attention to:**
- **Condition 14 (real-LLM smoke)** — binding, 7/7. This is the bug
  the FEAT exists to fix. Stub-LLM tests pass even when the bug is
  live; only the live proxy + Haiku catches the regression. The
  smoke output goes into `FEAT065_test-results.md` verbatim.
- **§4.7 emotional_checkin schema strictness** — overrides the §3.3
  default. The `writes[].data` shape is `additionalProperties: false`
  for this skill specifically, listing only `observation`, `date`,
  `_arrayKey?`. No new fields. This is the FEAT063 safety scope at
  the schema layer.
- **§4.5 calendar_management omission** — schema MUST NOT list
  `recurring`/`recurrence`/`recurrenceDay` in `writes[].data`. The
  description string for `data` reinforces "do not include recurring
  fields — handled by recurring_tasks skill". Handler defense
  (`stripRecurringFields`) stays as defense-in-depth.
- **Condition 8 (WARN, not throw)** — backward-compat lane. The TODO
  comment is required so the follow-up FEAT can be picked up without
  archaeology. Don't change to throw in this FEAT.
- **Condition 7 (bundler typing)** — light tightening only; the
  generated bundle is captured by reference, not by value. No new
  bundler logic; just a TS shape update.
- **§4 fingerprint table** — coder implements these directly. Every
  field listed must appear in the schema; every required field must
  be in `required`. Schema/prompt/handler three-way coherence is the
  PR review checklist.

This auto-advances to the coder. No further architect review required
unless the coder surfaces a condition-blocking finding during stage 5.
