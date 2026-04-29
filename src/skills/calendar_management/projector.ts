/**
 * FEAT072 — RAG projector for `calendar_management`.
 *
 * Walks `state.calendar.events[]` and emits one chunk per event so
 * `info_lookup` can answer free-form questions about past or future
 * meetings ("when was my meeting with Rick?"). Calendar events have
 * stable `id`s, so `sourceId` is the event id and edits / reschedules
 * upsert in place.
 *
 * Calls baked in (see FEAT072 spec for rationale):
 *   - No date window. Every non-cancelled, non-archived event is
 *     indexed. The retriever returns top-K so query-time cost stays
 *     flat as the calendar grows.
 *   - All recurring instances indexed. Each instance is already its
 *     own row in `state.calendar.events`; the `isRecurringInstance`
 *     flag rides along in metadata so the LLM can collapse duplicate
 *     near-identical citations when answering.
 *   - Skip `status === "cancelled"` and `archived === true`. The user
 *     doesn't want killed meetings surfaced.
 *
 * Embedding text composition: `title` + `notes` joined with " — ".
 * Person names tend to live in the title; the optional notes field
 * often carries grounding context the embedding picks up.
 */

import type { RagProjector } from "../../types/rag";
import type { AppState, CalendarEvent } from "../../types";

const MIN_TEXT_CHARS = 5;

export const projector: RagProjector<CalendarEvent> = {
  schema: "calendar",
  source: "event",
  iterate: (state) => {
    const s = state as AppState | null;
    return s?.calendar?.events ?? [];
  },
  project: (event) => {
    if (!event?.id || !event.title) return null;
    if (event.status === "cancelled" || event.archived) return null;

    const text = [event.title, event.notes]
      .filter((s) => typeof s === "string" && s.trim().length > 0)
      .join(" — ")
      .trim();
    if (text.length < MIN_TEXT_CHARS) return null;

    return {
      sourceId: String(event.id),
      text,
      metadata: {
        datetime: event.datetime,
        durationMinutes: event.durationMinutes,
        status: event.status,
        isRecurringInstance: event.isRecurringInstance ?? false,
      },
    };
  },
};
