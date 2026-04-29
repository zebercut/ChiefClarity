# FEAT074 — Widen info_lookup retrievalHook to event/task/observation sources

**Type:** bug fix
**Status:** Done
**MoSCoW:** MUST
**Category:** Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** rag, info_lookup, retrieval, calendar
**Created:** 2026-04-29

---

## Summary

FEAT072 wired calendar events into the RAG index via the projector contract, but `info_lookup`'s `retrievalHook.sources` was still capped at `["note", "topic", "contextMemory"]` from FEAT068. Calendar chunks were getting indexed correctly — the dispatcher was filtering them out at query time before retrieval ever saw them. The user reported the failure: *"tell me about fagner"* returned only the AP-interview *note*, never the calendar event with Fagner in the title, despite that event being in the index.

The architectural seam I missed in FEAT072: indexing and retrieval are separately gated. Adding a projector makes data flow INTO the index; widening `retrievalHook.sources` is what makes a skill actually QUERY against it.

## Change

`src/skills/info_lookup/manifest.json` — extend `retrievalHook.sources` to:

```json
["note", "topic", "contextMemory", "event", "task", "observation"]
```

`event` is the load-bearing addition (FEAT072 calendar projector). `task` and `observation` are forward-compat — no projector ships for them yet, so they're dead config until those projectors land. The widened allowlist is still a strict subset of `ChunkSource`.

## Out of scope

- A `task` projector or `observation` projector. Each = a separate one-file FEAT when needed.
- The `info_lookup` Mode A / Mode B prompt contradiction (the assistant emits the "no personal notes about X, but in general" disclaimer and then cites personal notes anyway). That's a separate small fix in `src/skills/info_lookup/prompt.md` once we confirm calendar retrieval works end-to-end.

## Verification

After this lands plus a fresh page reload (so the bundle ships the updated manifest), *"tell me about fagner"* should retrieve both the note AND the calendar event chunks. The `[skillDispatcher] retrieved=N topScore=...` line should show `N >= 2` instead of the previous `N=1`.

## Files

| File | Change |
|------|--------|
| `src/skills/info_lookup/manifest.json` | Extend `retrievalHook.sources`. |
| `src/skills/_generated/skillBundle.ts` | Auto-regenerated. |
| `src/modules/rag.test.ts` | Update the strict equality assertion on `retrievalHook.sources` to match the new list. |

Tests: 505/505 still passing (deepStrictEqual updated, no test count change).
