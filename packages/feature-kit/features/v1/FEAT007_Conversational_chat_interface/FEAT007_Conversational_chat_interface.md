# F07 — Conversational chat interface

Rich chat experience with markdown, smart suggestions, history management, and processing feedback.

---

## What this delivers

The primary way users interact with the app. A polished chat that feels responsive, remembers context, and helps users discover what they can do.

## Capabilities (shipped)

- **Markdown rendering** — bold, italic, lists, code blocks rendered in chat bubbles.
- **Suggestion chips** — contextual quick-action buttons below the assistant's response (e.g., "Plan my day", "Show overdue tasks", "Add a task").
- **Auto-send on chip tap** — tapping a suggestion immediately sends it as a message.
- **Paginated history** — shows the last 5 messages on load, with a "Load more" button to scroll back. Full history persists (200 messages).
- **Input history** — arrow keys cycle through previously sent messages (like a terminal).
- **Thinking indicator** — animated status with rotating messages ("Analyzing your schedule...", "Checking priorities...") while the LLM processes.

## Architecture

- Single LLM call per user message. No multi-agent chains.
- LLM returns structured JSON via tool use (`submit_action_plan`). TypeScript renders the response.
- History stored in app state, persisted to disk on change.
