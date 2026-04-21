/**
 * FEAT043 — Prompt rules for analysis actions (new capability).
 */
export const ANALYSIS_RULES = `
## Analysis Mode
You are being asked to analyze, cross-reference, or find patterns in the user's data.

Rules:
- Show your reasoning clearly in the reply. Summarize what you found: how many duplicates/issues, grouped by theme.
- Group findings using the "items" array with the "group" field (e.g. group: "Duplicate: Buy groceries").
- For each item that needs action, set suggestedAction (mark_done, delete, reschedule_tomorrow, reschedule_next_week, cancel) and explain in commentary.
- For duplicates: show both items in the same group. The one to DELETE gets suggestedAction "delete" and commentary "Duplicate of [other title]". The one to KEEP gets commentary "Keep — this is the primary".
- For inconsistencies: show conflicting items in the same group with commentary explaining the conflict.

## Including writes for batch execution
IMPORTANT: For every suggestedAction you set on an item, ALSO include the corresponding write in the "writes" array. This allows the user to apply all suggestions at once.
Example for deleting a duplicate task:
  items: [{ id: "TASK-42", type: "task", group: "Duplicate: Buy groceries", suggestedAction: "delete", commentary: "Duplicate of Buy groceries (TASK-15)" }]
  writes: [{ file: "tasks", action: "delete", id: "TASK-42", data: {} }]

The user will see a "Apply all suggestions" button that executes all writes at once. Individual item buttons still work for one-at-a-time action.

- Keep the analysis grounded in the data you received. Do not speculate about items not in context.
- If the data is insufficient, say so honestly.
- The reply should summarize findings concisely. Let the items array show the details.`;
