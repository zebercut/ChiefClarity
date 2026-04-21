/**
 * FEAT018 — Google Calendar sync.
 *
 * Fetches events from Google Calendar API, maps them to CalendarEvent,
 * upserts into the database, and triggers FEAT045 brief patches.
 *
 * Node-only — blocked from web bundle by metro.config.js.
 */
import type { CalendarEvent, AppState } from "../../types";
import type { GoogleCalendarConfig } from "../types";
import { getAccessToken } from "./auth";
import { setGoogleCalendarConfig, setGoogleCalendarError } from "../registry";
import { getTodayFromTz } from "../../utils/dates";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SOURCE_INTEGRATION = "google_calendar";

// ── Types ──────────────────────────────────────────────────────────────

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  status?: string;
  eventType?: string;
}

export interface SyncResult {
  added: CalendarEvent[];
  updated: CalendarEvent[];
  cancelledIds: string[];
  total: number;
  durationMs: number;
}

// ── Sync function ──────────────────────────────────────────────────────

export async function syncGoogleCalendar(
  config: GoogleCalendarConfig,
  state: AppState
): Promise<SyncResult> {
  // Skip sync if a previous auth error was set (token revoked etc.)
  // User must reconnect in Settings to clear the error.
  if (config.error) {
    console.warn(`[gcal-sync] skipping — integration has error: ${config.error}`);
    return { added: [], updated: [], cancelledIds: [], total: 0, durationMs: 0 };
  }

  const startTime = Date.now();

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err: any) {
    setGoogleCalendarError(err.message);
    throw err;
  }

  // Fetch events from each calendar
  const now = new Date();
  const timeMin = new Date(now.getTime() - 86400000).toISOString(); // today - 1 day
  const timeMax = new Date(now.getTime() + config.syncWindowDays * 86400000).toISOString();

  const allGoogleEvents: GoogleEvent[] = [];
  for (const calendarId of config.calendarIds) {
    const events = await fetchGoogleEvents(accessToken, calendarId, timeMin, timeMax);
    allGoogleEvents.push(...events);
  }

  // Map to CalendarEvent
  const mapped = allGoogleEvents.map(mapToCalendarEvent);

  // Lazy-require DB modules (Node-only, blocked from Metro)
  const dbCalendar = require("../../db/queries/calendar");

  // Upsert each event
  const added: CalendarEvent[] = [];
  const updated: CalendarEvent[] = [];
  for (const event of mapped) {
    const wasUpdate = await dbCalendar.upsertBySourceId(event);
    (wasUpdate ? updated : added).push(event);
  }

  // Cancel events that disappeared from Google
  const googleIds = new Set(mapped.map((e) => e.sourceId));
  const localSourceIds: Set<string> = await dbCalendar.getSourceIds(SOURCE_INTEGRATION);
  const cancelledIds: string[] = [];

  for (const localSourceId of localSourceIds) {
    if (!googleIds.has(localSourceId)) {
      // Event was in our DB but not in Google's response → cancelled/deleted
      const db = require("../../db/index").getDb();
      const rows = await db.execute({
        sql: "SELECT id FROM calendar_events WHERE source_integration = ? AND source_id = ?",
        args: [SOURCE_INTEGRATION, localSourceId],
      });
      if (rows.rows.length > 0) {
        const localId = rows.rows[0].id as string;
        await dbCalendar.updateEvent(localId, { status: "cancelled" });
        cancelledIds.push(localId);
      }
    }
  }

  // Trigger FEAT045 brief patches for today's changes
  try {
    const todayStr = state.hotContext?.today || getTodayFromTz(state.userProfile?.timezone);
    const todayAdded = added.filter((e) => e.datetime?.startsWith(todayStr));
    const todayCancelledEvents = cancelledIds.filter((id) => {
      const ev = state.calendar?.events?.find((e) => e.id === id);
      return ev?.datetime?.startsWith(todayStr);
    });

    if (todayAdded.length > 0 || todayCancelledEvents.length > 0) {
      const { patchBrief } = require("../../modules/briefPatcher");
      const writes = [
        ...todayAdded.map((e) => ({ file: "calendar" as const, action: "add" as const, data: e as any })),
        ...todayCancelledEvents.map((id) => ({ file: "calendar" as const, action: "update" as const, id, data: { status: "cancelled" } })),
      ];
      patchBrief(state, writes);
    }
  } catch (err: any) {
    console.warn("[gcal-sync] brief patch failed:", err?.message);
  }

  // Update config with last sync time
  setGoogleCalendarConfig({ lastSyncAt: new Date().toISOString(), error: null });

  const durationMs = Date.now() - startTime;
  console.log(`[gcal-sync] done: ${added.length} added, ${updated.length} updated, ${cancelledIds.length} cancelled in ${durationMs}ms`);

  return { added, updated, cancelledIds, total: mapped.length, durationMs };
}

// ── Google API fetch ───────────────────────────────────────────────────

async function fetchGoogleEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",      // expand recurring events
    orderBy: "startTime",
    maxResults: "500",
  });

  const url = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Calendar API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.items || []) as GoogleEvent[];
}

// ── Event mapper ───────────────────────────────────────────────────────

function mapToCalendarEvent(googleEvent: GoogleEvent): CalendarEvent {
  const isAllDay = !!googleEvent.start?.date && !googleEvent.start?.dateTime;
  const startDt = isAllDay
    ? `${googleEvent.start!.date}T00:00:00`
    : googleEvent.start?.dateTime || "";

  return {
    id: `gcal_${googleEvent.id}`,
    title: googleEvent.summary || "(No title)",
    datetime: startDt,
    durationMinutes: isAllDay
      ? 1440
      : calcDuration(googleEvent.start?.dateTime, googleEvent.end?.dateTime),
    status: googleEvent.status === "cancelled" ? "cancelled" : "scheduled",
    type: isAllDay ? "all_day" : (googleEvent.eventType || ""),
    priority: "",
    notes: googleEvent.description || "",
    relatedInbox: [],
    sourceIntegration: SOURCE_INTEGRATION,
    sourceId: googleEvent.id,
  };
}

function calcDuration(start?: string, end?: string): number {
  if (!start || !end) return 60;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const mins = Math.round((endMs - startMs) / 60000);
  return mins > 0 ? mins : 60;
}
