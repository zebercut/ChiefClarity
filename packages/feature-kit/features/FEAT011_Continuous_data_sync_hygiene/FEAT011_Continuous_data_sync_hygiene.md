# F11 — Continuous data sync & hygiene

Automatic polling, inbox processing, and calendar cleanup that keep data fresh and organized.

---

## What this delivers

Data stays current without user intervention. The inbox processes automatically, stale calendar entries get archived, and the app state refreshes on a regular cadence.

## Capabilities (shipped)

- **2-minute polling** — while the app is open, polls for new inbox items, evaluates nudge conditions, and refreshes state. Guards prevent overlapping runs.
- **Inbox processing** — monitors `inbox.txt` for new entries. Auto-detects content type (task, event, note, question), chunks multi-item entries, and processes each through the LLM.
- **Calendar hygiene** — archives past events older than 30 days, deduplicates entries with matching titles and times, cleans up orphaned recurring instances.

## Architecture

- Polling runs via `setInterval` in the app (not just on mount — the app stays open for days).
- Inbox processing uses `inboxProcessingRef` guard to prevent concurrent runs.
- Calendar hygiene runs as part of the headless scheduler's 4-hourly check.
