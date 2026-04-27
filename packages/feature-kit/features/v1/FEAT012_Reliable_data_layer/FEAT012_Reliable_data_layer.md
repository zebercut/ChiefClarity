# F12 — Reliable data layer

Crash-safe file writes and intelligent token management for consistent data and efficient LLM usage.

---

## What this delivers

Data never corrupts, even if the app crashes mid-write. LLM calls stay within token budgets with automatic estimation and retry on overflow.

## Capabilities (shipped)

- **Atomic file writes** — all data files written via temp-file-then-rename pattern. If the process dies mid-write, the original file remains intact.
- **Dynamic token estimation** — before each LLM call, estimates token count of the assembled context. Truncates low-priority data arrays to stay within budget.
- **Retry on overflow** — if the LLM returns a token limit error, automatically reduces context and retries once.

## Architecture

- All writes go through `filesystem.ts` which enforces the atomic pattern.
- Token estimation uses a character-based heuristic (chars / 3.5) validated against actual API responses.
- Per-intent token budgets defined in the assembler configuration.
