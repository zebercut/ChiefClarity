# FEAT073 — Calendar projector indexes archived and cancelled events

**Type:** bug fix
**Status:** Done
**MoSCoW:** MUST
**Category:** Bug Fix
**Priority:** 1
**Release:** v2.02
**Tags:** rag, calendar, projector, calibration
**Created:** 2026-04-29

---

## Summary

FEAT072 shipped the calendar projector with `event.status === "cancelled"` and `event.archived === true` skip filters. The user immediately reported a real failure: an old event with "Fagner" in the title didn't surface for the question *"anything about fagner?"*. Root cause: `dataHygiene` auto-archives past events to keep the active calendar UI clean — every old event gets `archived: true`, so the projector was throwing away exactly the events the user wanted searchable.

## Change

Drop both filters in `src/skills/calendar_management/projector.ts`. Index every event with a non-empty `id` and `title`. Carry `archived` and `status` along with the existing fields in metadata, so the LLM (or future query-time filters) can reason about them when answering.

## Rationale

- **Archived events are the lookup target.** "When did I last meet X?" / "what was that meeting about Y?" is the canonical free-form lookup pattern, and by definition those events are *old*, which means *archived* under existing hygiene rules.
- **Cancelled events are also plausible lookup targets.** "What was that meeting I cancelled with X?" is rarer but reasonable. Excluding cancelled events forfeits that case for almost no benefit (they're a small fraction of total events).
- **Filtering at index time is the wrong layer.** If we ever need to bias retrieval against archived/cancelled chunks, that's a query-time filter on the `RetrievalResult` set — the index should always carry the broader truth.

## One-time backfill cost

Next page reload triggers a backfill that picks up every previously-skipped (archived or cancelled) event. With ~50ms per embedding (cached pipeline) and a few hundred historical events, this is a few seconds of background work via `requestIdleCallback` — non-blocking; the user can chat during it.

## Files

| File | Change |
|------|--------|
| `src/skills/calendar_management/projector.ts` | Drop the `event.archived` + `event.status === "cancelled"` skip; add `archived` to metadata. |
| `src/modules/projectorRegistry.test.ts` | Replace the "skips archived/cancelled" assertion with two new tests confirming both ARE indexed and metadata flags carry through. |
| `src/skills/_generated/skillBundle.ts` | Auto-regenerated. |

Tests: 505 passing (was 503). +2 new (one removed, three added).
