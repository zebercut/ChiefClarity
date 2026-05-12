# FEAT076 — inbox_triage userObservations write coercion — fix undefined DB arg

**Type:** feature
**Status:** Done
**MoSCoW:** MUST
**Category:** Bug Fix
**Priority:** 1  
**Release:** v2.02  
**Tags:** inbox_triage, userObservations, db  
**Created:** 2026-05-11

---

## Summary

Notes processing failed with "LLM unavailable or rejected the chunk." The real error in the console was `[flush] write failed for userObservations: [filesystem] write failed: 500 {"error":"undefined cannot be passed as argument to the database"}`. Root cause: the inbox_triage prompt told the LLM to emit `text` for userObservations entries, but the DB schema and TS type expect `observation`. When the LLM followed the prompt, the executor pushed `{ text, date }` into `emotionalState[]`, then `saveObservations` read `o.observation` → `undefined` → libSQL threw.

---

## Problem Statement

The inbox_triage handler did not normalize the userObservations payload shape, and the prompt used a field name (`text`) that did not match the persistence layer (`observation`). Once the chunk failed to flush, the notes batch surfaced a generic "LLM unavailable or rejected the chunk." message that misled diagnosis.

---

## Fix

1. **Prompt** ([src/skills/inbox_triage/prompt.md](src/skills/inbox_triage/prompt.md)): document the correct field name (`observation`) and date format for userObservations writes.
2. **Handler defaults** ([src/skills/inbox_triage/handlers.ts](src/skills/inbox_triage/handlers.ts) — `fillObservationDefaults`): coerce `text` → `observation`, coerce `firstSeen` → `date`, and guarantee both are non-undefined strings so libSQL never receives `undefined`.
3. **Normalize guard** ([src/skills/inbox_triage/handlers.ts](src/skills/inbox_triage/handlers.ts) — `normalizeWrite`): drop userObservations adds whose observation text is empty, matching the existing tasks/calendar/notes pattern.

---

## Implementation Notes

| File | Change |
|------|--------|
| src/skills/inbox_triage/prompt.md | Replace `text` with `observation` in userObservations write schema |
| src/skills/inbox_triage/handlers.ts | `fillObservationDefaults` coerces `text`/`firstSeen`, defaults both to "" |
| src/skills/inbox_triage/handlers.ts | `normalizeWrite` drops empty-observation userObservations adds |

---

## Testing Notes

- [x] Reproduced: trigger "Process Notes" with mood/emotional content. Without fix, batch fails and `[flush] write failed for userObservations` appears.
- [ ] Manual verify: same flow now writes a row to `user_observations` (category = emotionalState) without error.

---

## Out of Scope

- workStyle / communicationStyle / taskCompletionPatterns writes — the prompt does not currently document those, and they are not produced by the inbox_triage skill today. The coercion in `fillObservationDefaults` does protect emotionalState writes, which is where the regression was hit.
