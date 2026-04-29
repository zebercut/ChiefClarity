/**
 * FEAT072 — RAG projector for `calendar_management`.
 *
 * Walks `state.calendar.events[]` and emits one chunk per event so
 * `info_lookup` can answer free-form questions about past or future
 * meetings ("when was my meeting with Rick?"). Calendar events have
 * stable `id`s, so `sourceId` is the event id and edits / reschedules
 * upsert in place.
 *
 * Calls baked in (FEAT072 + FEAT073 calibration):
 *   - No date window. Every event is indexed regardless of date. The
 *     retriever returns top-K so query-time cost stays flat as the
 *     calendar grows.
 *   - Index archived and cancelled events too. dataHygiene sets
 *     `archived: true` on past events to keep the active calendar UI
 *     clean — but free-form lookup ("when did I meet Fagner?") is
 *     EXACTLY the use case where archived events should resurface.
 *     Cancelled events are kept for the same reason ("what was that
 *     meeting I cancelled with X?"). Status and archived flags ride
 *     along in metadata so the LLM (or future query-time filters)
 *     can reason about them when answering.
 *   - All recurring instances indexed. Each instance is already its
 *     own row in `state.calendar.events`; the `isRecurringInstance`
 *     flag rides along in metadata so the LLM can collapse duplicate
 *     near-identical citations when answering.
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
        archived: event.archived ?? false,
        isRecurringInstance: event.isRecurringInstance ?? false,
      },
    };
  },
};
