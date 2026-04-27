# FEAT050 — Skill Runtime (declarative skills as data)

**Type:** feature
**Status:** Planned
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v3.0
**Tags:** skills, runtime, architecture, extensibility, composition
**Created:** 2026-04-23

**Supersedes:** FEAT020 (Capability Registry Plugin System) — the hook-based plugin model is replaced by the skill runtime described here.

---

## Summary

Replace the closed-world intent system (17 hardcoded intents, each bound to a hardcoded assembler branch, prompt section, and `submit_action_plan` tool) with a minimal runtime that executes skills defined as data. A skill is a JSON manifest plus a markdown persona file — no TypeScript per skill. The runtime loads requested data views, builds a system prompt from persona + core rules, calls the LLM with the output shape declared by the skill, and hands the result to the existing renderers and executor. Adding a new reasoning domain becomes a file-drop, not a release.

---

## Problem Statement

The chat pipeline today cannot grow without engineering work. Every new domain — financial analysis, decision coaching, writing coaching, spreadsheet help, fitness coaching — would require a new intent, a new assembler branch, a new prompt section, a new output schema, and a release cycle. This is the same trap at a higher abstraction level.

Concrete failure today: when the user asks a strategic question like *"with several projects running, where should I spend my time?"*, the system routes to a CRUD-shaped pipeline, loads a large task index, sees a large collection, triggers scope clarification, and asks the user to narrow the request. The user wanted expert judgment; they got a filter prompt. The architecture has no way to represent "this needs advisory reasoning, not data filtering" because the reasoning posture is baked into TypeScript.

The root cause is that intents, data slices, system prompts, and output schemas are **code**, not **data**. They are not composable by the system, cannot be authored by the user, and cannot be added without a dev loop.

---

## Goals

1. Make *skill* (persona + data needs + output shape + tool shape + model preference) a first-class runtime object represented as JSON + markdown, not code.
2. Provide a minimal, stable TypeScript runtime that executes any valid skill definition without changes.
3. Separate the things that must stay code (data access, integrations, LLM client, writes) from the things that should be data (reasoning posture, output form, prompt framing).
4. Enable zero-code addition of new skills. Adding a new reasoning domain to the app must not require a code commit, an architecture change, or a new feature spec.

---

## Success Metrics

- A new skill is added to the system using only a JSON file and a markdown persona file. No TypeScript file is modified. No release is cut. This is the acceptance test for the whole FEAT — if it does not pass, the FEAT is not done.
- The runtime supports at least five seed skills shipped as data (General Assistant, Task & Calendar Manager, Focus Planner, Portfolio Strategist, Decision Coach).
- At least two seed skills use a non-CRUD output shape (e.g., free-form recommendation, analysis with citations, draft with critique).
- When the user asks a strategic or advisory question covered by a seed skill, the response is recognisably from that skill (persona, structure, reasoning style) and does not pass through the legacy scope-clarification path.
- Adding a sixth skill (any domain the team chooses) takes less than one hour from decision to running end-to-end.

---

## User Stories

### Story 1 — Skill is defined as data, not code

**As a** developer extending the assistant, **I want** to define a new skill by writing a JSON manifest and a markdown persona file, **so that** I do not have to modify the assembler, router, prompts, or executor.

**Acceptance Criteria:**
- [ ] Given a folder containing `manifest.json` and `persona.md` in the configured skills directory, when the app starts, then the runtime discovers, validates, and registers the skill.
- [ ] Given the manifest declares `dataNeeds: ["projects.summary", "okrs.active"]`, when the skill runs, then the runtime loads exactly those views from the data source menu and passes them to the LLM.
- [ ] Given the manifest declares `outputShape: "free_form_recommendation"`, when the LLM is called, then the tool schema matches that shape and the UI renders it correctly.
- [ ] Given an invalid manifest (missing required field, unknown `dataNeeds` entry, unknown `outputShape`), when the app starts, then the skill is rejected with a logged error and the rest of the system continues to load.
- [ ] Adding a new skill does not require any change to files under `src/modules/`, `src/constants/prompts.ts`, or the executor.

### Story 2 — Runtime executes a skill end-to-end

**As a** user, **I want** a selected skill to run over my existing data without any skill-specific TypeScript being written, **so that** adding domains does not regress the system.

**Acceptance Criteria:**
- [ ] Given the skill router selects `portfolio_strategist`, when the runtime runs the skill, then the data source menu returns a pre-summarized projects view (not raw task rows).
- [ ] Given the skill declares `modelPreference: "heavy"`, when the LLM is called, then Sonnet is used; given `modelPreference: "light"`, then Haiku is used.
- [ ] Given the skill declares `persona.md` as its system prompt, when the LLM is called, then the persona plus the runtime's `CORE_RULES` block is the system prompt (the legacy 420-line prompt is not used).
- [ ] Given the skill declares `outputShape: "free_form_recommendation"`, when the LLM returns a response, then the response is validated against the matching tool schema; invalid responses are retried once, then fall back to a plain-text reply surfaced to the user.
- [ ] A skill that declares `outputShape: "confirmation_with_writes"` produces writes that the existing executor applies without any change to executor code.

### Story 3 — Output shape library covers common answer forms

**As a** user, **I want** different kinds of answers for different kinds of questions, **so that** advisory questions get recommendations and CRUD questions get confirmations.

**Acceptance Criteria:**
- [ ] The output shape library includes at minimum: `plain_chat`, `free_form_recommendation`, `structured_plan`, `analysis_with_citations`, `draft_with_critique`, `recommendation_with_allocation`, `question_with_options`, `confirmation_with_writes`.
- [ ] Each output shape has a matching tool schema registered in the LLM module.
- [ ] Each output shape has a matching UI renderer in the chat view.
- [ ] Given a skill uses `free_form_recommendation`, the response contains a narrative analysis and an optional list of follow-up actions, and contains no `writes[]` array.
- [ ] Given a skill uses `confirmation_with_writes`, the response is compatible with the existing executor path used by legacy intents (backward compatibility).
- [ ] A skill cannot invent a new output shape; it must pick one from the library or be rejected at registration.

### Story 4 — Data source menu decouples skills from storage

**As a** developer, **I want** skills to reference data by logical view name, **so that** storage or schema changes do not require rewriting every skill.

**Acceptance Criteria:**
- [ ] The runtime exposes a data source menu: a declared catalog of named views over user state. Initial views: `tasks.open`, `tasks.all`, `tasks.overdue`, `tasks.completed_recent`, `calendar.today`, `calendar.week`, `calendar.all`, `okrs.active`, `okrs.all`, `projects.summary`, `facts.search`, `observations.recent`, `notes.recent`, `topics.list`, `lifestyle`, `profile`, `chat_history.recent`, `decisions_log`.
- [ ] Adding a new view to the menu is a single-file change; once added, all future skills can consume it without further changes.
- [ ] A skill that references an unknown view name is rejected at registration time with a logged error.
- [ ] The data source menu reads from existing AppState and libSQL — it does not introduce a new storage layer.
- [ ] Views return pre-summarised data suitable for an LLM prompt (bounded size, no raw dumps unless the view name explicitly says so — e.g., `tasks.all`).

### Story 5 — Seed skills ship as data

**As a** product owner, **I want** the runtime proven by shipping five seed skills as JSON + markdown, **so that** the same architecture the user sees is the one the team uses internally.

**Acceptance Criteria:**
- [ ] Seed skills shipped: `general_assistant`, `task_calendar_manager`, `focus_planner`, `portfolio_strategist`, `decision_coach`.
- [ ] Each seed skill is a folder in the skills directory containing `manifest.json` + `persona.md`.
- [ ] None of the seed skills contain TypeScript code specific to that skill.
- [ ] Deleting a seed skill folder does not break the app; the runtime reports that skill as unavailable and the rest continues to work.
- [ ] `portfolio_strategist` uses `recommendation_with_allocation` (not `confirmation_with_writes`); asking *"where should I spend my time across my projects?"* produces a narrative + allocation, not a filter prompt.
- [ ] `general_assistant` uses `plain_chat` and acts as a fallback when no other skill matches.

### Story 6 — Runtime limits are explicit and enforced

**As a** developer, **I want** clear limits on what a skill can do, **so that** the runtime stays small and safe.

**Acceptance Criteria:**
- [ ] A skill cannot execute arbitrary code; it can only declare persona, data needs, output shape, tool shape, and model preference.
- [ ] A skill cannot access data sources outside the declared menu.
- [ ] A skill cannot define new output shapes or tool schemas; it must pick from the runtime library.
- [ ] A skill cannot override safety guarantees (conflict detection, write validation, encryption, shrinkage guard).
- [ ] The persona is treated as untrusted text for prompt-injection purposes: it is placed inside an explicit system-prompt section delimited from user input, and the core rules are appended after the persona so they take precedence.
- [ ] If a skill needs a capability the runtime does not expose (new integration, new data shape, new output form), that capability is added via a normal FEAT — a single FEAT unlocks the capability for all future skills.

---

## Workflow

```
App startup
  └─ Skill loader scans skills directory
       └─ validates each manifest against schema
            └─ registers valid skills, logs invalid

User turn (invoked by FEAT051 router)
  └─ runtime.runSkill(skillId, phrase, state, conversation)
       ├─ resolveDataNeeds(skill.dataNeeds) → context object
       ├─ buildSystemPrompt(skill.persona + CORE_RULES)
       ├─ selectTool(skill.outputShape) → tool schema
       ├─ selectModel(skill.modelPreference) → haiku | sonnet
       ├─ llm.callWithTool(prompt, context, tool, model)
       ├─ validate response against tool schema
       └─ return SkillResult { shape, payload, skillId }

Chat UI
  └─ render(SkillResult)
       ├─ select renderer by shape
       ├─ show skill badge
       └─ if payload includes writes, hand to executor
```

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Manifest references unknown `dataNeeds` entry | Skill rejected at registration with logged error. App continues. |
| Manifest references unknown `outputShape` | Skill rejected at registration with logged error. |
| Persona file missing or unreadable | Skill rejected at registration. |
| Data source view returns empty (e.g., no projects defined) | View returns empty structure with a `hasData: false` flag. Skill can still run; persona should instruct the LLM how to respond when empty. |
| LLM returns malformed output against tool schema | Retry once. If still malformed, surface a plain-text fallback reply and log a validation error. |
| Persona attempts prompt injection ("ignore previous instructions") | Core rules are appended after persona and take precedence. System prompt delimiters isolate persona text. |
| Seed skill folder deleted by user | Skill becomes unavailable. Router falls back to `general_assistant`. |
| Two skills have the same `id` | First loaded wins; duplicates logged and rejected. |
| Skill declares both legacy and new output shape | Schema disallows; rejected at registration. |
| Runtime receives a skill with no persona text (empty file) | Rejected at registration. |

---

## Out of Scope

- **Skill authoring by the end user through chat.** Covered by FEAT051 (composer) and FEAT053 (library UX).
- **Dynamic skill proposals at turn time.** Covered by FEAT051.
- **Context caching across turns.** Covered by FEAT052.
- **Skill marketplace or sharing between users.** Deferred.
- **Replacing the executor or write pipeline.** Skills that produce writes use the existing executor.
- **Replacing the triage module.** The runtime is invoked by the router/triage; it does not replace them.
- **New integrations (Gmail, Notion, Google Sheets).** Those remain TypeScript capabilities and are separate FEATs. The runtime consumes them via the data source menu once added.
- **Per-skill private storage.** All skills share the same user data in v3.0.
- **Multi-skill composition in a single turn.** Deferred to a later FEAT.

---

## Architecture Notes

*To be filled by Architect Agent.*

### Signal for the Architect

The runtime has three responsibilities and must not grow beyond them:

1. **Load** a skill manifest, validate it against a schema, register it.
2. **Resolve** a skill's `dataNeeds` against the data source menu, producing a context object.
3. **Execute** the skill: build a system prompt from persona + core safety rules, call the LLM with the output shape's tool schema, validate the response, return a result the chat UI can render.

Everything else — intent classification, write execution, summarization, disk I/O, encryption, conflict detection — stays unchanged.

### Integration points with existing modules

| Module | Change |
|---|---|
| `src/modules/router.ts` / `triage.ts` | Returns a `skillId`. Extended by FEAT051; the runtime is the consumer. |
| `src/modules/llm.ts` | Gains `callSkill(skill, context)` that wraps the existing LLM call with persona + tool schema. |
| `src/modules/executor.ts` | Unchanged. Skills producing `confirmation_with_writes` or `structured_plan` hand the same `WriteOperation[]` the executor already handles. |
| `src/modules/assembler.ts` | Legacy path preserved. New skills go through the data source menu instead. |
| `src/constants/prompts.ts` | Core safety rules extracted into a reusable `CORE_RULES` block. Persona is prepended to `CORE_RULES` at runtime. |
| `src/types/index.ts` | New types: `Skill`, `SkillManifest`, `DataViewName`, `OutputShape`. |
| New: `src/modules/skills/runtime.ts` | Skill loader, resolver, executor. |
| New: `src/modules/skills/dataViews.ts` | Data source menu implementation (logical views over AppState/libSQL). |
| New: `src/modules/skills/outputShapes.ts` | Output shape library: tool schemas + renderer hints. |

### Manifest shape (illustrative)

```json
{
  "id": "portfolio_strategist",
  "name": "Portfolio Strategist",
  "version": "1.0.0",
  "description": "Advises on where to spend time across multiple concurrent projects.",
  "personaFile": "persona.md",
  "dataNeeds": ["projects.summary", "okrs.active", "decisions_log", "observations.recent"],
  "outputShape": "recommendation_with_allocation",
  "modelPreference": "heavy",
  "tokenBudget": 6000,
  "match": {
    "description": "Strategic questions about where to focus time/energy across projects or initiatives.",
    "examples": [
      "where should I spend my time across my projects?",
      "am I overcommitted?",
      "which of my bets should I double down on?"
    ]
  }
}
```

The `match` block is used by FEAT051 (Skill Router) to decide when this skill applies. It is data, not code.

---

## Implementation Notes

| File | Change |
|---|---|
| `src/modules/skills/runtime.ts` | New. Loader, resolver, executor. |
| `src/modules/skills/dataViews.ts` | New. Implements `tasks.open`, `projects.summary`, etc., reading from AppState and libSQL. |
| `src/modules/skills/outputShapes.ts` | New. Maps shape name → tool schema + renderer hint. |
| `src/modules/skills/validate.ts` | New. JSON schema validation for manifest. |
| `src/modules/llm.ts` | Add `callSkill(skill, context)`. Reuse circuit breaker + fallback logic. |
| `src/constants/prompts/core.ts` | Extract `CORE_RULES` from legacy `SYSTEM_PROMPT`. |
| `src/types/index.ts` | Add `Skill`, `SkillManifest`, `OutputShape`, `DataViewName`, `SkillResult`. |
| `app/(tabs)/chat.tsx` | Add renderer switch over `SkillResult.shape`. Show skill badge. |
| `data/skills/general_assistant/` | Seed (JSON + MD). |
| `data/skills/task_calendar_manager/` | Seed. |
| `data/skills/focus_planner/` | Seed. |
| `data/skills/portfolio_strategist/` | Seed. |
| `data/skills/decision_coach/` | Seed. |
| `docs/new_architecture_typescript.md` | New section: Skill Runtime. Update Section 6 data flow diagram. |
| `README.md` | Add Skills section. |

---

## Testing Notes

- [ ] Unit tests for manifest validation (valid + every invalid case).
- [ ] Unit tests for `resolveDataNeeds` (each view returns expected shape).
- [ ] Unit tests for `buildSystemPrompt` (persona + core rules ordering, delimiters).
- [ ] Unit tests for each output shape's tool schema (structure, required fields).
- [ ] Integration test: register a fake skill from a fixture directory, run it end-to-end, verify renderer output.
- [ ] Integration test: delete a seed skill directory, verify app still boots and router falls back.
- [ ] Integration test: strategic-question phrase routes to `portfolio_strategist` and produces a `recommendation_with_allocation` payload (not a `confirmation_with_writes`).
- [ ] Regression test: legacy CRUD phrases still work through a seed skill bound to the legacy output shape.

---

## Assumptions & Open Questions

- **Assumption:** A small output shape library (~8 shapes) covers the large majority of useful answer forms. New shapes are rare; when needed, a new FEAT adds one.
- **Assumption:** Skills share the same user data; there is no per-skill private storage in v3.0.
- **Assumption:** Persona files are trusted-enough content (developer-authored seed skills, or user-authored via FEAT051 composer). They are not executed as code. Prompt-injection hardening is via delimiter placement + core rules precedence.
- **Open question:** Where do skill files live physically? Recommendation: `data/skills/` for user state so they travel with the user's data; `packages/skills-seed/` for shipped seeds that get copied on first run. Architect to decide.
- **Open question:** Should skills declare composition with other skills, or is multi-skill chaining deferred?
- **Open question:** Should the manifest allow forbidden data sources for privacy-sensitive personas? Recommendation: defer until a concrete need arises.
- **Open question:** Token budget per skill — manifest-declared, runtime-computed, or both? Recommendation: runtime computes a default, manifest can override.

---

## UX Notes

*To be filled after UX design review. FEAT053 covers skill library and authoring UX in detail.*

Minimal UX obligations for this FEAT:
- Chat message metadata shows the skill that produced the response (e.g., a small badge "via Portfolio Strategist").
- Renderers for each output shape are visually distinct: a recommendation is not rendered like a task list is not rendered like a plan.
- When the runtime falls back to plain text after a validation failure, the UI shows a subtle "degraded response" hint so the user is aware.
