# F04 — Smart recurring suggestions

Detect repeated manual tasks and proactively suggest converting them to recurring items.

---

## What this delivers

Users who manually create the same task every week shouldn't have to. The system detects patterns (same title or similar phrasing, regular cadence) and suggests: "You've created 'Weekly review' 4 Mondays in a row — make it recurring?"

## Key capabilities

- **Pattern detection** — scan task creation history for repeating titles, similar phrasing, or regular time intervals.
- **Proactive suggestion** — surface a nudge (not a chat message) with a one-tap "Make recurring" action.
- **Smart cadence** — suggest the right frequency (daily, weekday, weekly, monthly) based on observed intervals.
- **Dismissable** — "Don't suggest this again" option to prevent nagging.

## User stories

- As a user, I want the app to notice I create the same task every week and offer to automate it.
- As a user, I want to accept a recurring suggestion with one tap, not a conversation.

## Out of scope

- Suggesting changes to existing recurring tasks
- Cross-user pattern learning
