# FEAT019 — Message Queue & Chat Pipeline

## Problem
Input is disabled while the LLM processes. User waits, can't queue follow-up messages. If they have 3 things to say, they wait for each one sequentially.

## Solution
Input always enabled. Messages queue (max 3) and execute sequentially. User can stop, edit, or remove queued messages.

## UI Design

- **Processing indicator**: current message shown with spinner + stop button (⏹)
- **Queue panel**: between chat and input bar, shows numbered queued messages with edit/remove buttons
- **Input hint**: "Enter to queue · 2/3 slots" when queue has items
- **Queue full**: input disabled with "Queue full (3/3)"

## Actions
- **Stop (⏹)**: AbortController cancels LLM call, shows "Cancelled", moves to next
- **Edit (✏)**: moves text back to input, removes from queue
- **Remove (✕)**: removes from queue silently

## Technical
- `messageQueue` state in chat.tsx
- `abortRef` for AbortController
- `llm.ts` accepts AbortSignal parameter
- Queue processed sequentially — each gets updated state from previous
- No persistence — queue is UI state only
