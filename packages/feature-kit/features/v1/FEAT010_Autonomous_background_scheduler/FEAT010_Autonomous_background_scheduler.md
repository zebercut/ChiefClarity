# F10 — Autonomous background scheduler

Headless process that generates plans, processes inbox, creates recurring tasks, and runs on a configurable schedule — even when the app is closed.

---

## What this delivers

The app works for you even when you're not looking at it. A background scheduler handles all the routine work: morning plan, evening review, inbox processing, recurring task generation.

## Capabilities (shipped)

- **Scheduled runs** — morning plan (configurable time), evening review, weekly plan, and 4-hourly check-ins. Each run type has its own LLM prompt and context.
- **Hot-reload config** — change schedule times via chat ("Move my morning plan to 7am"). The scheduler picks up changes without restart.
- **Recurring task generation** — creates task and event instances from recurring definitions. Supports daily, weekday, weekly, and custom patterns with specific times.
- **Headless execution** — runs as a separate Node process (`scripts/headless-runner.js`). No UI required. Can run in Docker, as a system service, or via cron.

## Architecture

- Scheduler reads `schedule_config.json` for run times.
- Each run calls the same assembler → LLM → executor pipeline as chat.
- Recurring tasks defined in `recurring.json`, instances written to `tasks.json` and `calendar.json`.
