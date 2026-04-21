# F06 — Data portability & integrations

Export your data and sync with external calendars.

---

## What this delivers

Users own their data and can get it out in standard formats. Google Calendar events flow in automatically so the app has a complete picture of the user's schedule.

## Key capabilities

- **Data export** — export tasks, calendar events, and OKRs to CSV or PDF. One-tap from a settings screen or via chat command ("export my tasks").
- **Google Calendar sync (read-only)** — OAuth connection to pull events from one or more Google Calendars. 14-day rolling sync window. Conflict handling when external events overlap with local ones.
- **Sync status** — visual indicator showing last sync time and any errors. Manual "sync now" button.

## User stories

- As a user, I want to export my tasks to a spreadsheet for reporting.
- As a user, I want my Google Calendar events to appear in the app's agenda automatically.
- As a user, I want to know when the last sync happened and if anything failed.

## Out of scope

- Two-way calendar sync (write-back to Google)
- Outlook / Apple Calendar integration
- Real-time webhook sync (polling-based only)
