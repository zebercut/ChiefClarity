# FEAT038 — Multi-intent router with primary and secondary intents

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** LLM Pipeline
**Priority:** 2
**Release:** v2.2
**Tags:** router, intent, assembler, accuracy
**Created:** 2026-04-07

**Independent of:** FEAT037, FEAT039, FEAT040 — can ship standalone, but ships best paired with FEAT037 (core context floor) since both attack assembler accuracy.

---

## Summary

Today `router.ts` returns exactly one `IntentType` per user phrase. The assembler then slices state based on that single decision. This breaks down whenever a user phrase contains two or more intentions in one breath — e.g. *"move my dentist to Thursday and remind me to bring the form."* That phrase contains both `calendar_update` and `task_create`, but only one wins, and the LLM never sees the context for the other half.

This feature changes the router to return `{ primary, secondary[] }`. The assembler then **unions** the context slices for the primary and secondary intents, capped by the largest applicable token budget. The LLM still produces a single `ActionPlan`, so the executor and prompt schema are unchanged.

---

## Problem Statement

Examples of phrases that fail today:

| Phrase | Today's intent | Missing context |
|---|---|---|
| "Move dentist to Thursday and remind me to bring the form." | `calendar_update` | task creation context, task_index |
| "Mark the report done and book a follow-up next week." | `task_update` | calendar context |
| "Snooze that nudge and add a note to the kitchen reno topic." | `general` | topic context, topic file |
| "What's on my calendar Friday and what tasks are due that day?" | `calendar_query` | task index, dueBucket |

In each case, the user gets either a partial answer or a wrong answer because the assembler shipped only half of what the LLM needed.

---

## User Stories

### Story 1 — Compound commands work
**As a** user, **I want** to say two things in one phrase **so that** I don't have to break my thought into two messages.

**Acceptance Criteria:**
- [ ] Given a phrase with two intentions, when routed, then `secondary` includes the second intent.
- [ ] Given a compound phrase, when context is assembled, then it includes data needed by both intents.
- [ ] Given a compound phrase, when LLM produces writes, then both intentions appear in `writes[]`.

### Story 2 — No regression on simple phrases
**As a** user, **I want** simple single-intent phrases to behave exactly as today **so that** the change doesn't introduce latency or cost regressions.

**Acceptance Criteria:**
- [ ] Given a simple phrase, when routed, then `secondary: []` and behavior is identical to current.

---

## Workflow

```
User phrase
    ↓
router.classifyIntent()
    ├── regex pass (multi-match allowed)
    ├── if 0 matches → Haiku LLM fallback
    ├── if 1 match  → { primary: X, secondary: [] }
    └── if 2+ matches → { primary: highest-confidence, secondary: [others] }
    ↓
assembler.assembleContext({ primary, secondary })
    ├── slice = sliceFor(primary)
    ├── for each s in secondary: slice = union(slice, sliceFor(s))
    ├── budget = max(budgets[primary], ...budgets[secondary])
    └── enforce budget by truncating low-priority arrays
    ↓
llm.callLlm()                        [unchanged schema]
    ↓
executor.applyWrites()               [unchanged]
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Simple single-intent phrase | `secondary: []`, no behavioral change |
| Three or more intentions in one phrase | Cap at 2 secondary; warn in logs if more detected |
| Conflicting intents (e.g., `task_create` + `task_update`) | Both pass through; LLM disambiguates via clarification if needed |
| Secondary intent budget would blow context | Truncate secondary's low-priority arrays first, then primary's |
| Regex fires for 2 intents but they're really the same intent | De-duplicate by intent type |
| Haiku fallback can't classify | Default to `general`, `secondary: []` (current behavior) |

---

## Success Metrics

- Compound phrases produce both writes in 90%+ of manual test cases.
- 0 regressions on existing single-intent test suite.
- No measurable cost increase for simple phrases.

---

## Out of Scope

- Core context floor → FEAT037
- Day/Week/Month objectives → FEAT039
- Calendar admission control → FEAT040
- Adding new intent types (the existing 14 intents are sufficient)
- Changing the LLM tool schema or `ActionPlan` shape

---

## Architecture Notes

### Type changes

```typescript
// src/types/index.ts
export interface IntentResult {
  primary:    IntentType;
  secondary:  IntentType[];   // NEW — empty for single-intent phrases
  confidence: number;
  source:     "regex" | "llm";
}
```

### Router behavior

- Regex matching becomes **non-exclusive** — collect every pattern that matches.
- Confidence is implicit: regex matches are confidence 1.0, LLM fallback uses Haiku's choice.
- If 2+ regex matches, the first one in declaration order becomes primary; others become secondary.
- LLM fallback continues to return a single intent; that becomes `primary` with empty `secondary`.

### Assembler behavior

- Add `mergeContextSlices(a, b)` helper that unions arrays, prefers larger arrays on key conflict.
- Token budget = max of all involved intents' budgets, **not sum** (to avoid blowups).
- Truncation order respects intent priority: secondary's low-priority arrays first, then primary's.

### Sacred boundary check

- TypeScript still owns intent classification and context shaping.
- LLM still owns judgment within the unioned context.
- No new LLM calls.

---

## Implementation Notes

| File | Change |
|------|--------|
| [src/types/index.ts](../../../../src/types/index.ts) | Add `secondary: IntentType[]` to `IntentResult`. |
| [src/modules/router.ts](../../../../src/modules/router.ts) | Collect all regex matches; return `{ primary, secondary }`. |
| [src/modules/assembler.ts](../../../../src/modules/assembler.ts) | New `mergeContextSlices`; iterate primary + secondary; enforce max budget. |
| [src/modules/llm.ts](../../../../src/modules/llm.ts) | Model selection: if any intent in `{primary, ...secondary}` is a heavy intent, use Sonnet. |
| `docs/new_architecture_typescript.md` | Update Section 6 (router) and the Intent table to document the new shape. |

---

## Testing Notes

- [ ] Unit test: `router.classifyIntent("Move dentist to Thursday and remind me to bring the form")` → `primary: calendar_update`, `secondary: [task_create]`.
- [ ] Unit test: simple phrase still returns `secondary: []`.
- [ ] Unit test: `mergeContextSlices` unions arrays correctly.
- [ ] Integration test: compound phrase produces 2+ writes.
- [ ] Regression: full existing router test suite passes unchanged.

---

## Open Questions

- Should we cap at 2 secondary intents, or allow unbounded? Recommendation: cap at 2 for v1, revisit after data.
- For Haiku fallback, should we ask the LLM to detect compound intents too? Recommendation: defer — most compound phrases hit regex.
