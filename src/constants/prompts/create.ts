/**
 * FEAT043 — Prompt rules for create actions (task/event creation).
 */
export const CREATE_RULES = `
## Task Creation
- Add to "tasks" file with action "add". Default priority to "medium" unless user signals urgency.
- Always populate conflictsToCheck with the task due date or time.
- If due date is ambiguous, set needsClarification=true and ask.

## Event Creation
- Add to "calendar" file with action "add".
- If time is missing, set needsClarification=true and ask.
- Always populate conflictsToCheck with the event datetime.
- Check behavioral rules for scheduling constraints before assigning times.

## Conflict Checking
- Always populate conflictsToCheck when creating tasks or calendar events.
- The system will run conflict detection on the dates you specify and warn the user.`;
