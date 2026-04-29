# FEAT072 — Calendar projector for RAG

**Type:** feature
**Status:** In Progress
**MoSCoW:** MUST
**Category:** Feature
**Priority:** 1
**Release:** v2.02
**Tags:** rag, calendar, projector, info_lookup
**Created:** 2026-04-29

---

## Summary

Make calendar events discoverable via `info_lookup` so user phrases like *"when was my meeting with Rick?"* land on real chunks instead of `general_assistant`'s redirect-to-calendar-handler.

This is the first consumer of the FEAT071 projector contract. Implementation is a single-file change inside `src/skills/calendar_management/`.

## Problem Statement

Today, `info_lookup`'s RAG index covers `notes` and `contextMemory` only. Calendar events are missing entirely, so any past-event question routes to `general_assistant`, which can only redirect the user to the calendar handler — which itself doesn't answer free-form historical questions either. The user reported the failure directly: *"i have a calendar database and it still does not look for info: when was my meeting with Rick?"*

## Design

Single new file: `src/skills/calendar_management/projector.ts`. Walks `state.calendar.events`, projects title + notes into a chunk per event, carries datetime / status / recurring flag in metadata.

Three deliberate calls:

1. **No window.** Index every event regardless of date. Storage is cheap (~1.5 KB / chunk × ~5000 events = ~7.5 MB). The retriever returns top-K so query-time cost is constant in corpus size.
2. **Index all recurring instances.** Each instance is already its own row in `state.calendar.events`. Multiple chunks for the same recurring title is a known source of duplicate top-K hits; metadata carries `isRecurringInstance` so the LLM prompt can collapse them when citing.
3. **Skip `cancelled` + `archived`.** No reason to surface meetings the user explicitly killed.

## Implementation Notes

| File | Change |
|------|--------|
| `src/skills/calendar_management/projector.ts` | NEW — `RagProjector<CalendarEvent>`. |
| `src/skills/_generated/skillBundle.ts` | Auto-regenerated via `npm run bundle:skills`. |
| `docs/v4/02_skill_registry.md` | Add `calendar` row to the shipped projectors table in §11. |
| `docs/v4/04_attachments_rag.md` | Drop the "calendar deferred" caveat; the projector ships now. |

## Out of Scope

- New `attendees` field on `CalendarEvent`. The current schema doesn't have one and adding it touches every write path. Person names live in `title` (and sometimes `notes`); embedding-based search picks them up either way.
- Tasks, observations, learning items, OKRs. Each is a separate FEAT — same one-file pattern when the time comes.
- Topic pages. They flow through `topicManager` + `indexTopicPage` paragraph chunking; different shape than the projector contract.

## Success Metrics

After this lands, "when was my meeting with Rick?" routes through `info_lookup`, retrieves matching event chunks, and the assistant cites the date(s). The previous failure mode (route to `general_assistant`, redirect to calendar handler) goes away.
