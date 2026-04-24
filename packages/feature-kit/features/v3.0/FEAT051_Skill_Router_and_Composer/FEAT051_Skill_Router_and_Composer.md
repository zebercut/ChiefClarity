# FEAT051 — Skill Router and Composer

**Type:** feature
**Status:** Planned
**MoSCoW:** MUST
**Category:** LLM Pipeline
**Priority:** 1
**Release:** v3.0
**Tags:** router, triage, composer, skill-gap, meta-llm

**Depends on:** FEAT050 (Skill Runtime)
**Supersedes / rescopes:** FEAT049 (LLM-only intent router) — the intent taxonomy is replaced by skill routing.

**Created:** 2026-04-23

---

## Summary

Turn the triage step into a skill router: given a user phrase plus conversation context plus the list of installed skills (manifest `match` blocks), it returns either the skill that fits or, if none fits well, a **proposed skill definition** the system can execute for this turn. The user is then offered the chance to save the proposed skill for reuse. This closes the open-world gap: the system keeps working on new domains without waiting for a developer to add them.

---

## Problem Statement

FEAT050 makes skills data. But if only developers can add skills, the system is still closed at the edge — every new domain still needs someone to write a manifest and persona. For a tool that a single user lives in daily, that is the same gating problem in a new shape.

At the same time, the current triage has two failure modes that will persist even with skills:

1. It will route requests to the wrong skill if the skill-match logic is weak (e.g., strategic questions misrouted to Task & Calendar Manager because both mention "tasks").
2. It will have no skill to pick for truly novel requests and will fall back to General Assistant, which is vague by design.

The skill router must handle both cases. For clear matches, pick the right skill. For novel requests, compose a one-shot skill and offer to save it.

---

## Goals

1. Replace the intent classifier with a skill router that picks from installed skills based on manifest match data.
2. When no installed skill fits, have the router synthesise a one-shot skill definition and execute it immediately for this turn, without a dev loop.
3. Let the user accept, edit, or discard the proposed skill. Accepted skills become first-class installed skills with no code change.
4. Preserve the fast path for deterministic phrases (regex or cached embedding match) so common requests skip the router LLM call.
5. Make scope-clarification a **per-skill** decision (in the skill's persona or manifest), not a global rule in the router.

---

## Success Metrics

- The regex `PATTERNS` array and the legacy `classifyIntent()` / `classifyIntentWithFallback()` functions are deleted from `router.ts`.
- Strategic/advisory requests route to the advisory skill (e.g., `portfolio_strategist`) in manual testing on a corpus of 30 phrases.
- Requests with no installed skill produce a saved proposal in at least one test scenario; after the user accepts, the same phrase next time routes directly to the newly installed skill without any code change.
- P95 router latency under 600 ms when the fast path is not hit (Haiku classification + embedding match).
- No regressions on a test corpus of 50 legacy phrases (CRUD, planning, emotional check-in, topic queries).

---

## User Stories

### Story 1 — Pick the right installed skill

**As a** user, **I want** my request to be answered by the skill with the right expertise, **so that** advisory questions get judgment and CRUD questions get actions.

**Acceptance Criteria:**
- [ ] Given the phrase *"where should I spend my time across my projects?"* and installed skills include `portfolio_strategist`, then the router returns `skillId: "portfolio_strategist"` with `confidence >= 0.7`.
- [ ] Given *"add a task: review the draft tomorrow"* and installed skills include `task_calendar_manager`, then the router returns `skillId: "task_calendar_manager"`.
- [ ] Given *"what should I focus on today?"* and installed skills include `focus_planner`, then the router returns `skillId: "focus_planner"`.
- [ ] Given *"I'm exhausted and nothing is moving"* and no emotional/coaching skill is installed, then the router either returns a proposed skill (Story 3) or falls back to `general_assistant`.
- [ ] The router passes installed skills' `match.description` and `match.examples` to the Haiku classifier as part of the prompt. Adding a new skill (via FEAT053) makes it routable on the next request with no router code change.

### Story 2 — Scope clarification is skill-local, not router-global

**As a** user asking advisory questions, **I want** the system to give me its best take without forcing me to narrow scope, **so that** the posture matches the kind of question I asked.

**Acceptance Criteria:**
- [ ] The router itself does not emit scope-clarification questions. The legacy triage rule "if data volume > 30 and request is analysis, ask for scope" is removed from the router.
- [ ] A skill that wants clarification declares it in its manifest (`clarification: { required: true, when: "..." }`) or produces a `question_with_options` payload from inside the skill.
- [ ] Given an advisory skill that does not declare clarification, then the skill answers without asking a scoping question even when the underlying data is large.
- [ ] Given a CRUD skill (e.g., `task_calendar_manager`) that declares clarification on high-volume operations, then it asks for scope on ambiguous bulk-delete-style requests — preserving today's useful behavior.

### Story 3 — Compose a skill on the fly when none fits

**As a** user with a novel request the installed skills do not cover, **I want** the system to still produce a useful answer by composing a skill for this turn, **so that** I do not hit a dead end.

**Acceptance Criteria:**
- [ ] Given a phrase for which no installed skill has `match.confidence >= 0.6`, the router returns `skillGap: true` plus a `proposedSkill` object containing: `name`, `description`, `persona` (a draft persona string), `dataNeeds` (subset of the data source menu), `outputShape` (one of the library), `modelPreference`, and `match` (description + 2-3 example phrases).
- [ ] The runtime executes the proposed skill for this turn using the same path as a registered skill (FEAT050's `runSkill`).
- [ ] The proposed skill's `dataNeeds` are validated against the data source menu; unknown names are dropped with a logged warning.
- [ ] The proposed skill's `outputShape` is validated against the library; if invalid, the router picks `plain_chat` as a safe default.
- [ ] The user is offered, in the UI, the option to **save** the proposed skill (FEAT053 provides the surface).
- [ ] If the user saves, the manifest + persona are persisted to the skills directory, and the next matching phrase routes to the new skill without re-synthesis.

### Story 4 — Fast path preserved

**As a** user with common repeated phrases, **I want** the system to respond quickly without calling the router LLM every time, **so that** simple requests feel snappy.

**Acceptance Criteria:**
- [ ] The router maintains a small cache of (phrase-hash → skillId) for phrases that resolved in recent turns. A cache hit skips the router LLM call.
- [ ] An optional embedding-similarity shortcut: if the incoming phrase is within cosine distance 0.08 of a canonical example from a skill's `match.examples`, the router returns that skill without an LLM call.
- [ ] The fast path never produces a `proposedSkill`; proposals only come from the full router LLM call.
- [ ] The fast path is disabled when the user is in "teach me a new skill" mode (FEAT053).

### Story 5 — Multi-skill intent is acknowledged (not multi-run)

**As a** user who says two things in one breath (*"add a task to review the draft, and also — what should I prioritise this week?"*), **I want** the system to acknowledge both parts rather than silently dropping one, **so that** compound phrases are safe.

**Acceptance Criteria:**
- [ ] Given a phrase the router classifies as carrying two skills' concerns, the router returns a primary skill plus a `secondaryConcerns: string[]` list of concise descriptions (not full skill payloads).
- [ ] The primary skill's persona sees the `secondaryConcerns` in context so it can either address them inline or flag them.
- [ ] Full multi-skill orchestration (running two skills sequentially and merging outputs) is out of scope for this FEAT.

### Story 6 — Transparent routing

**As a** user, **I want** to know which skill answered my message and why, **so that** I can correct misrouting or prune a skill that keeps mis-firing.

**Acceptance Criteria:**
- [ ] Every assistant message carries the selected `skillId` in metadata; the UI renders a visible badge.
- [ ] Every routed turn logs `{ phraseHash, selectedSkillId, confidence, viaFastPath, proposalGenerated }` for debugging and later pattern analysis.
- [ ] The user can tap the skill badge and see: the skill's `match.description`, the confidence score for this turn, and a "use a different skill" option that re-runs the turn with a user-picked skill.

### Story 7 — Backward compatibility and graceful degradation

**As a** user, **I want** the system to keep working even when the router misfires or the LLM is unavailable, **so that** the core app is not gated on the router being perfect.

**Acceptance Criteria:**
- [ ] Given the Haiku circuit breaker is open, the router falls back to the fast path + embedding match + `general_assistant`.
- [ ] Given the router returns an invalid `skillId` (skill not installed), the runtime falls back to `general_assistant` and logs the error.
- [ ] Given the router returns a malformed `proposedSkill`, the runtime discards the proposal and uses `general_assistant`.
- [ ] Disabling FEAT051 via config reverts the system to the FEAT050 baseline of direct skill invocation (used for debugging).

---

## Workflow

```
User sends phrase
  │
  ├─ Fast path?
  │    ├─ Phrase-hash cache hit → return cached skillId → FEAT050 runtime
  │    └─ Embedding match to skill example → return skillId → FEAT050 runtime
  │
  ├─ Haiku router call
  │    Input: phrase + conversation summary + installed skills' match blocks + data volumes
  │    Output tool: submit_skill_route
  │      { skillId | null, confidence, secondaryConcerns[], proposedSkill?, fallback? }
  │
  ├─ skillId set + confidence >= threshold?
  │    └─ FEAT050 runtime.runSkill(skillId, ...)
  │
  ├─ skillId null or low confidence?
  │    └─ Use proposedSkill (one-shot) → runtime.runProposed(proposedSkill, ...)
  │         └─ On completion, UI offers "Save as skill" (FEAT053)
  │
  └─ All paths fail?
       └─ runtime.runSkill("general_assistant", ...)
```

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Phrase in multiple languages | Router treats as normal input; Haiku is multilingual. Skill match examples are language-agnostic in intent but example phrases may need translation (out of scope for v3.0). |
| Router returns a `skillId` that does not exist | Log, fall back to `general_assistant`. |
| `proposedSkill` declares unknown data source | Drop the unknown source, proceed if other sources remain valid; if none remain, fall back to `general_assistant`. |
| `proposedSkill` declares unknown output shape | Coerce to `plain_chat`. |
| User rejects a proposed skill | Not saved. Next identical phrase generates a new proposal (possibly different). |
| User saves a proposed skill with a name that collides with an installed skill | FEAT053 handles naming conflict; router never silently overwrites. |
| Two skills both match with identical confidence | Tie-break by manifest order, log the tie. |
| Secondary concerns fill too many tokens | Truncate at 3 concerns, log truncation. |
| `match.examples` missing from a skill manifest | Router uses only `match.description`; skill still routable but lower precision. |

---

## Success Metrics

(See Goals/Success section above. Reiterated here per template.)

- Router LLM correctly routes 30/30 advisory phrases to the advisory skill on a manually curated test set.
- Regex is removed entirely from `router.ts`.
- At least one novel phrase produces a proposed skill in QA; after saving, the next identical phrase routes to the saved skill with no code change.
- No regression on the 50-phrase legacy corpus (CRUD, planning, emotional, topics).

---

## Out of Scope

- Running two skills in parallel and merging outputs.
- Fine-tuned classifier (remains Haiku few-shot for v3.0).
- Offline/on-device skill routing.
- Confidence calibration across skill packs (relies on the LLM's self-reported confidence).
- Skill-specific permissions or per-skill data-source allowlists beyond what the manifest declares.
- Translating user-authored skill personas into other languages.

---

## Architecture Notes

*To be filled by Architect Agent.*

### Signals for the Architect

- Router output schema must be stable; personas and UI both depend on it.
- Keep the fast path and LLM path clearly separated — do not interleave.
- The `proposedSkill` produced by the router must be a valid `SkillManifest` (FEAT050 schema) before execution.
- Embedding-similarity match should reuse FEAT042's vector layer rather than introducing a new embedding store.

### Router tool schema (illustrative)

```json
{
  "name": "submit_skill_route",
  "input_schema": {
    "type": "object",
    "properties": {
      "skillId": { "type": ["string", "null"] },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
      "reasoning": { "type": "string" },
      "secondaryConcerns": { "type": "array", "items": { "type": "string" } },
      "proposedSkill": {
        "type": ["object", "null"],
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "persona": { "type": "string" },
          "dataNeeds": { "type": "array", "items": { "type": "string" } },
          "outputShape": { "type": "string" },
          "modelPreference": { "type": "string", "enum": ["light", "heavy"] },
          "match": {
            "type": "object",
            "properties": {
              "description": { "type": "string" },
              "examples": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "required": ["skillId", "confidence"]
  }
}
```

### Integration points

| Module | Change |
|---|---|
| `src/modules/router.ts` | Remove regex `PATTERNS`, remove `classifyIntent`. Replace with `routeToSkill(phrase, state, conversation)`. |
| `src/modules/triage.ts` | Keep scope-clarification logic **only** for skills that declare it in their manifest. Remove the global >30-item rule. |
| `src/modules/llm.ts` | Reuse existing Haiku call path with a new tool schema. |
| `src/modules/skills/runtime.ts` | Add `runProposed(proposedSkill, phrase, state, conversation)` that validates then executes a one-shot skill. |
| `app/(tabs)/chat.tsx` | Wire router output into the runtime. Show "save as skill" offer when `proposedSkill` was used. |
| `src/types/index.ts` | Add `SkillRouteResult`, `ProposedSkill`. |

---

## Implementation Notes

| File | Change |
|---|---|
| `src/modules/router.ts` | Rewrite to return `SkillRouteResult`. |
| `src/modules/skills/runtime.ts` | Add `runProposed`. |
| `src/modules/skills/proposalValidator.ts` | New. Validates a `proposedSkill` against manifest schema before execution. |
| `src/modules/llm.ts` | Add `submit_skill_route` tool; reuse callbacks. |
| `app/(tabs)/chat.tsx` | Replace classifyIntent call with routeToSkill. Render "save as skill" CTA when proposal fired. |
| `src/modules/skills/fastPath.ts` | New. Phrase-hash cache + embedding match against skill examples. |
| `docs/new_architecture_typescript.md` | Update Section 6 to reflect router → runtime flow. Remove intent taxonomy references. |

---

## Testing Notes

- [ ] Unit tests for `routeToSkill` against a fixture set of phrases, with mocked installed skills.
- [ ] Unit tests for `runProposed`: valid proposal executes; invalid proposal is rejected.
- [ ] Unit tests for fast path: phrase-hash cache, embedding match, no LLM call in either case.
- [ ] Unit tests for tie-breaking and confidence-threshold behavior.
- [ ] Integration test: a novel phrase produces a proposal → accepting creates a manifest file → the same phrase next time hits the installed skill.
- [ ] Integration test: strategic question reaches `portfolio_strategist`, not `task_calendar_manager`.
- [ ] Regression: legacy CRUD/planning/emotional phrases continue to work via seed skills.
- [ ] Circuit-breaker test: Haiku down → fast path + general_assistant still works.

---

## Assumptions & Open Questions

- **Assumption:** Haiku can classify skills with few-shot examples better than regex or hand-tuned rules, given modest volume (~10-20 skills).
- **Assumption:** Users will want to save roughly 20-40% of proposed skills; the rest are one-offs and can stay one-off.
- **Open question:** What confidence threshold separates "use installed skill" from "propose a skill"? Recommendation: 0.6; tune post-launch.
- **Open question:** Should proposals be allowed to chain (one proposed skill invoking another)? Recommendation: no for v3.0 — deferred.
- **Open question:** Where does the user review/reject a just-fired proposal — inline after the answer, or in a separate panel? UX Notes in FEAT053 to decide.
- **Open question:** Should the router have access to recent chat history for disambiguation, or only the current phrase + a summary? Recommendation: summary + last 3 turns.
- **Open question:** Do we need an emergency "route everything to general_assistant" kill switch for debugging? Recommendation: yes, behind a settings flag.

---

## UX Notes

*Detailed in FEAT053. Minimum here:*

- If a proposal fired, the assistant message footer shows: *"Handled as a new skill: '{name}'. Save for next time?"* with actions Save / Edit / Discard.
- If routing confidence is borderline, optionally show a subtle hint ("Answered by {skill}. Not what you expected? [Use a different skill]").
- Never surface the underlying router details (JSON, confidence scores) to the user except via a debug menu.
