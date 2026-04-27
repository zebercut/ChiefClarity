# FEAT018 — Google Calendar integration (read-only sync)

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** SHOULD
**Category:** Integrations
**Priority:** 2
**Release:** v4.1
**Tags:** google-calendar, integration, sync, oauth, calendar
**Created:** 2026-04-03
**Updated:** 2026-04-13
**Design Reviewed:** 2026-04-13

**Depends on:** FEAT041 (libSQL), FEAT045 (reactive brief)

---

## Problem Statement

The LLM plans the user's day using only manually-entered events. Real commitments live in Google Calendar and must be duplicated by hand. This causes missed conflicts, stale plans, and extra friction.

Since FEAT041, all data lives in libSQL. Since FEAT045/046, the Focus Brief is a reactive living document. Google Calendar events need to flow into this new architecture — straight into the SQL database, not files.

---

## Goals

- Google Calendar events appear automatically in the Focus Brief, assembler context, and triage data loader
- The user connects once and never manually duplicates events again
- Sync failures never block planning — last-synced data is always available
- The integration pattern is reusable for future integrations (Gmail, Outlook)

---

## Success Metrics

- Plans account for 100% of Google Calendar events within the sync window
- Zero manual event duplication after setup
- Sync failures never block plan generation
- Sync completes in < 5 seconds for typical personal calendar (< 200 events / 14 days)

---

## User Stories

### Story 1: Connect Google Calendar
**As a** user, **I want** to connect my Google Calendar once in Settings, **so that** my real events automatically appear in planning.

**Acceptance Criteria:**
- [ ] Given I tap "Connect Google Calendar" in Settings, when the OAuth flow completes, then the refresh token is stored in `expo-secure-store` (Capacitor) or `.env` (proxy), and Settings shows "Connected — last sync: just now"
- [ ] Given I am connected, when I tap "Disconnect", then the refresh token is cleared, all rows in `calendar_events` with `source_integration = 'google_calendar'` are deleted, and Settings shows "Disconnected"
- [ ] Given my access token expires, when sync runs, then the token is refreshed from the stored refresh token without user interaction; if refresh fails (token revoked), Settings shows "Re-authentication required" with a "Reconnect" button

### Story 2: Events appear in plans and brief
**As a** user, **I want** my Google Calendar events included in the Focus Brief and chat, **so that** my plan respects real commitments.

**Acceptance Criteria:**
- [ ] Given sync is enabled, when the headless morning job runs, then events for [today - 1d, today + 14d] are fetched and upserted into `calendar_events` with `source_integration = 'google_calendar'` and `source_id = <Google event ID>`
- [ ] Given a Google event is cancelled, when the next sync runs, then the local row's status is set to `cancelled`
- [ ] Given a Google event is updated (time, title), when the next sync runs, then the local row is updated to match
- [ ] Given sync fails (network, API limit), then last-synced events remain in the DB, planning proceeds, and a warning is logged (not surfaced to user)

### Story 3: Brief reacts to calendar sync
**As a** user, **I want** newly synced events to appear in my Focus Brief immediately, **so that** I don't need to regenerate the plan.

**Acceptance Criteria:**
- [ ] Given a sync adds a new event for today, then FEAT045 Tier 1 briefPatcher inserts it into `days[today].additions` and recalculates freeBlocks within 1 second
- [ ] Given a sync cancels a today event, then briefPatcher marks it `_cancelled` in additions
- [ ] Given 3+ events change in one sync, then FEAT045 Tier 2 Haiku refresh fires to update the executiveSummary

---

## Developer Implementation Guide

### Four sequential work packages

---

## WP-1: Database migration + type updates

**Goal:** Add `source_integration` and `source_id` columns to `calendar_events`. Update TypeScript types.

### 1.1 Migration: `src/db/migrations/0003_calendar_source_fields.sql`

```sql
ALTER TABLE calendar_events ADD COLUMN source_integration TEXT;
ALTER TABLE calendar_events ADD COLUMN source_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cal_source ON calendar_events(source_integration, source_id);
```

**Note:** SQLite `ALTER TABLE ADD COLUMN` cannot have `IF NOT EXISTS`. The migrator's try/catch handles re-runs gracefully (FEAT041 BUG-6 fix).

### 1.2 Type update: `CalendarEvent` in `src/types/index.ts`

Add two optional fields:

```typescript
export interface CalendarEvent {
  // ... existing fields ...
  /** FEAT018: Integration source (e.g. 'google_calendar') or undefined for local */
  sourceIntegration?: string;
  /** FEAT018: External ID from the source system, for dedup on re-sync */
  sourceId?: string;
}
```

### 1.3 Query module update: `src/db/queries/calendar.ts`

Add `upsertBySourceId()`:

```typescript
export async function upsertBySourceId(event: CalendarEvent): Promise<void> {
  const db = getDb();
  // Check if exists by source_id
  const existing = await db.execute({
    sql: "SELECT id FROM calendar_events WHERE source_integration = ? AND source_id = ?",
    args: [event.sourceIntegration, event.sourceId],
  });
  if (existing.rows.length > 0) {
    // Update existing
    await updateEvent(existing.rows[0].id as string, event);
  } else {
    // Insert new
    await insertEvent(event);
  }
}
```

Also update `insertEvent()` and `rowToEvent()` to handle the two new columns.

### 1.4 Acceptance

- [ ] Migration runs cleanly on existing database
- [ ] `calendar_events` table has `source_integration` and `source_id` columns
- [ ] `insertEvent()` with `sourceIntegration: "google_calendar"` persists the field
- [ ] `loadCalendar()` returns events with `sourceIntegration` populated
- [ ] `upsertBySourceId()` inserts new, updates existing, doesn't duplicate

---

## WP-2: Integration layer + OAuth

**Goal:** Reusable OAuth2 flow for Google APIs. Token stored in secure store.

### 2.1 File structure

```
src/integrations/
  types.ts                # IntegrationConfig, GoogleCalendarConfig
  registry.ts             # isEnabled(), getConfig(), setEnabled()
  google/
    auth.ts               # OAuth2 flow, token refresh, secure storage
    calendar.ts           # fetchEvents(), mapToCalendarEvent(), syncToDb()
```

### 2.2 Integration types: `src/integrations/types.ts`

```typescript
export interface IntegrationConfig {
  enabled: boolean;
  lastSyncAt: string | null;
  error: string | null;
}

export interface GoogleCalendarConfig extends IntegrationConfig {
  calendarIds: string[];      // default: ["primary"]
  syncWindowDays: number;     // default: 14
  // refreshToken stored in secure store, NOT here
}

export interface IntegrationsConfig {
  googleCalendar?: GoogleCalendarConfig;
}
```

### 2.3 OAuth flow: `src/integrations/google/auth.ts`

Two platform paths (same pattern as DB adapter):

**Web/Proxy (Node):**
1. Proxy exposes `GET /oauth/google/start` → redirects to Google consent URL
2. Google redirects to `http://localhost:3099/oauth/google/callback?code=...`
3. Proxy exchanges code for tokens, stores refresh token in `.env` or memory
4. Returns success to browser

**Capacitor (mobile):**
1. App opens in-app browser to Google consent URL
2. Google redirects to `com.chiefclarity.app://oauth/callback?code=...`
3. App intercepts the deep link, exchanges code for tokens
4. Stores refresh token in `expo-secure-store`

**Token refresh** (shared):
```typescript
async function getAccessToken(config: GoogleCalendarConfig): Promise<string> {
  // 1. Load refresh token from secure store
  // 2. POST to https://oauth2.googleapis.com/token with grant_type=refresh_token
  // 3. Return access_token (short-lived, ~1 hour)
  // 4. If refresh fails (401) → mark integration as error, throw
}
```

### 2.4 Metro blockList

Add `googleapis` to the Metro blockList (Node-only, same pattern):

```javascript
/node_modules[/\\]googleapis[/\\].*/,
```

On web, sync is handled by the proxy. On Capacitor, use raw HTTP (`CapacitorHttp.post()`) to Google's REST API directly — no `googleapis` SDK needed.

### 2.5 Acceptance

- [ ] OAuth flow completes on web (proxy callback)
- [ ] Refresh token stored in secure store (not in DB)
- [ ] `getAccessToken()` returns a valid token
- [ ] Token auto-refreshes when expired
- [ ] Revoked token shows error state in Settings

---

## WP-3: Sync logic + brief integration

**Goal:** Fetch events from Google, upsert into DB, trigger brief patches.

### 3.1 Sync function: `src/integrations/google/calendar.ts`

```typescript
interface SyncResult {
  added: CalendarEvent[];
  updated: CalendarEvent[];
  cancelled: string[];       // IDs of locally cancelled events
  total: number;
  durationMs: number;
}

async function syncGoogleCalendar(
  accessToken: string,
  config: GoogleCalendarConfig,
  state: AppState
): Promise<SyncResult> {
  const now = new Date();
  const timeMin = addDays(now, -1).toISOString();
  const timeMax = addDays(now, config.syncWindowDays).toISOString();

  // 1. Fetch from Google Calendar API
  const googleEvents = await fetchGoogleEvents(accessToken, config.calendarIds, timeMin, timeMax);

  // 2. Map to CalendarEvent
  const mapped = googleEvents.map(mapToCalendarEvent);

  // 3. Upsert each into DB
  const added: CalendarEvent[] = [];
  const updated: CalendarEvent[] = [];
  for (const event of mapped) {
    const existed = await upsertBySourceId(event);
    (existed ? updated : added).push(event);
  }

  // 4. Cancel events that disappeared from Google
  const googleIds = new Set(mapped.map(e => e.sourceId));
  const localGcalEvents = await db.execute({
    sql: "SELECT id, source_id FROM calendar_events WHERE source_integration = 'google_calendar' AND status != 'cancelled'",
    args: [],
  });
  const cancelled: string[] = [];
  for (const row of localGcalEvents.rows) {
    if (!googleIds.has(row.source_id as string)) {
      await updateEvent(row.id as string, { status: "cancelled" } as any);
      cancelled.push(row.id as string);
    }
  }

  // 5. Trigger FEAT045 brief patches for today's changes
  const todayStr = state.hotContext?.today || new Date().toISOString().slice(0, 10);
  const todayAdded = added.filter(e => e.datetime?.startsWith(todayStr));
  const todayCancelled = cancelled.filter(id => {
    // Check if the cancelled event was for today
    const localEvent = state.calendar.events.find(e => e.id === id);
    return localEvent?.datetime?.startsWith(todayStr);
  });

  if (todayAdded.length > 0 || todayCancelled.length > 0) {
    const writes = [
      ...todayAdded.map(e => ({ file: "calendar" as any, action: "add" as const, data: e as any })),
      ...todayCancelled.map(id => ({ file: "calendar" as any, action: "update" as const, id, data: { status: "cancelled" } })),
    ];
    patchBrief(state, writes);
  }

  return { added, updated, cancelled, total: mapped.length, durationMs: Date.now() - now.getTime() };
}
```

### 3.2 Event mapper: `mapToCalendarEvent()`

```typescript
function mapToCalendarEvent(googleEvent: GoogleCalendarEvent): CalendarEvent {
  const isAllDay = !!googleEvent.start?.date && !googleEvent.start?.dateTime;
  return {
    id: `gcal_${googleEvent.id}`,
    title: googleEvent.summary || "(No title)",
    datetime: isAllDay
      ? `${googleEvent.start.date}T00:00:00`
      : googleEvent.start.dateTime,
    durationMinutes: isAllDay ? 1440 : calcDuration(googleEvent.start.dateTime, googleEvent.end.dateTime),
    status: googleEvent.status === "cancelled" ? "cancelled" : "scheduled",
    type: isAllDay ? "all_day" : (googleEvent.eventType || ""),
    priority: "",
    notes: googleEvent.description || "",
    relatedInbox: [],
    sourceIntegration: "google_calendar",
    sourceId: googleEvent.id,
  };
}
```

### 3.3 Wiring into headless + proxy

**Headless runner** — call sync in morning job + light check:
```typescript
// In morningJob(), before plan generation:
if (isGoogleCalendarEnabled()) {
  await syncGoogleCalendar(accessToken, config, state);
}
```

**Proxy** — call sync on startup after DB opens:
```typescript
// After tryOpenLibsql():
if (isGoogleCalendarEnabled()) {
  syncGoogleCalendar(accessToken, config, state).catch(err =>
    console.warn("[proxy] Google Calendar sync failed:", err.message)
  );
}
```

### 3.4 Acceptance

- [ ] Sync fetches events from Google and upserts into `calendar_events`
- [ ] Synced events have `source_integration = 'google_calendar'` and `source_id` populated
- [ ] Events cancelled in Google are marked `cancelled` locally
- [ ] Updated events (title, time) are updated locally
- [ ] Brief patcher fires for today's changes after sync
- [ ] Sync < 5 seconds for < 200 events
- [ ] Network failure doesn't throw — last-synced data preserved

---

## WP-4: Settings UI

**Goal:** Connect/disconnect Google Calendar in the Settings panel.

### 4.1 Add to Settings panel (FEAT035 or existing settings)

```
┌──────────────────────────────────────┐
│ 📅 Google Calendar                   │
│                                      │
│ Status: Connected                    │
│ Last sync: 2 minutes ago             │
│ Calendars: Primary                   │
│                                      │
│ [Sync Now]  [Disconnect]             │
└──────────────────────────────────────┘
```

States:
- **Not connected:** Shows "Connect Google Calendar" button → starts OAuth
- **Connected:** Shows status, last sync time, Sync Now + Disconnect buttons
- **Error:** Shows error message + "Reconnect" button

### 4.2 Acceptance

- [ ] "Connect" button starts OAuth flow
- [ ] After connecting, Settings shows "Connected" with last sync time
- [ ] "Sync Now" triggers immediate sync
- [ ] "Disconnect" clears token + removes synced events
- [ ] Error state shows "Reconnect" button

---

## Execution order

```
WP-1 (migration + types)    → standalone
WP-2 (OAuth + integration)  → standalone
WP-3 (sync logic + brief)   → needs WP-1 + WP-2
WP-4 (Settings UI)          → needs WP-2
```

WP-1 and WP-2 can run in parallel.

---

## Risks & Concerns

| Risk | Mitigation |
|------|-----------|
| Google OAuth verification takes weeks | Ship with "internal" OAuth (limited to 100 users) for v1. Document self-hosted credentials as alternative. |
| API quota limits (default 1M queries/day) | Personal app with 5-min polling = ~288 calls/day. Well within free tier. |
| Token stored insecurely | Refresh token in secure store only. Access token in memory only (never persisted). |
| `googleapis` bloats Metro bundle | Blocked in Metro. Proxy handles API calls. Capacitor uses raw HTTP. |
| Sync conflicts with briefPatcher | briefPatcher is idempotent — multiple patches for the same event are safe. |

---

## Testing Notes

### Unit Tests Required
- [ ] `mapToCalendarEvent()` — all-day events (date only), timed events (dateTime), cancelled events, events with no title, recurring event instances
- [ ] `upsertBySourceId()` — insert new, update existing, no duplicate on re-sync
- [ ] `calcDuration()` — same-day events, multi-hour events, overnight events
- [ ] Token refresh logic — success path, expired refresh token path

### Integration Tests Required
- [ ] Mock Google API → sync → verify `calendar_events` table has correct rows
- [ ] Sync → briefPatcher → verify today's additions updated
- [ ] Disconnect → verify all `source_integration = 'google_calendar'` rows deleted
- [ ] Token expired → auto-refresh → sync succeeds

### Failure Tests Required
- [ ] Network down during sync → last-synced data preserved, no error surfaced
- [ ] Token revoked in Google settings → integration marked as error, Settings shows reconnect
- [ ] Google API returns 500 → sync retries on next interval

### Scope Isolation Tests Required
- No — single-user app, no multi-tenancy concerns

### Agent Fixtures Required
- No — sync is pure TypeScript, no LLM calls

---

## Open Questions (resolved)

| Question | Decision |
|----------|---------|
| Ship own OAuth credentials or user's? | **Ship ours for v1** (internal, 100-user cap). Document self-hosted option. Apply for verification when user base grows. |
| Sync window configurable? | **Yes.** Default 14 days, adjustable in Settings. |
| OAuth on Capacitor? | In-app browser + custom URL scheme (`com.chiefclarity.app://oauth/callback`). |
| OAuth on web? | Proxy endpoint `GET /oauth/google/start` + `GET /oauth/google/callback`. |
| Block `googleapis` from Metro? | **Yes.** Same pattern as `@libsql`. Capacitor uses raw `CapacitorHttp` for Google REST API. |
| How to handle all-day events? | Map to `00:00`, `durationMinutes: 1440`, `type: "all_day"`. Planner treats as a blocked day. |
