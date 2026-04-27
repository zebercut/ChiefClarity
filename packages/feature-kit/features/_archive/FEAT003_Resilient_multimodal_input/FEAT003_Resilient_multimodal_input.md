# F03 — Resilient multi-modal input

Accept input while processing, queue messages, and support voice for hands-free use.

---

## What this delivers

The app never feels unresponsive. Users can keep typing (or talking) while the LLM processes their previous message. Input queues up and processes sequentially, so nothing is lost.

## Key capabilities

- **Message queue** — accept up to 3 pending messages while the current one is processing. Each processes in order once the previous response completes.
- **Voice input** — speech-to-text button in the chat bar. Tap to dictate, release to send. Works for task creation, questions, and planning requests.
- **Graceful degradation** — if the queue is full, show a subtle "processing..." indicator. Never block the input field.

## User stories

- As a user, I want to dump three quick tasks in succession without waiting for each response.
- As a user, I want to dictate my morning plan while my hands are busy.
- As a user, I want the app to never feel frozen or unresponsive.

## Out of scope

- Voice output / text-to-speech
- Multi-language speech recognition
- Real-time transcription display
