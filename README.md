# Chief Clarity

A mobile-first AI personal organizer. One chat interface, one LLM call per turn, everything stays on your device.

Built with TypeScript, Expo (React Native), and the Anthropic SDK.

## What It Does

You talk to Chief Clarity in natural language. It manages your tasks, calendar, OKRs, and daily plans — all stored as JSON files in a cloud-synced folder you control.

- **Chat** — create tasks, schedule events, ask questions, get suggestions
- **Focus Dashboard** — daily/weekly plan with time-blocked agenda, priorities, risks, OKR progress, and a companion section for motivation
- **Tasks Tab** — full backlog view with case-insensitive search, AND-logic filters (status, priority, category, due bucket), grouping (status / due / category), and a read-only detail sheet. Same priority order as the Focus Brief: overdue first, then priority, then due date.
- **Inbox** — dump notes from any device via `inbox.txt`, processed automatically
- **Proactive Nudges** — overdue follow-ups, event prep, stalled task detection, OKR pace checks
- **Recurring Tasks** — "Remind me every weekday at 8:30am" — creates task/event instances automatically each day
- **Topic Repository** — organize notes and knowledge by topic. Facts auto-tag with topic hints, and when a theme repeats 3+ times the system suggests creating a dedicated topic. Topics UI page with search, pagination, and detail view showing linked tasks, events, OKR connections, and insights. Daily planning is topic-aware: the assembler cross-references topics to items and the LLM emits a per-topic digest in the focus brief
- **Autonomous Runner** — headless scheduler generates plans, processes inbox, creates recurring tasks, and writes nudges — works even when the app is closed. Hot-reloads schedule changes from chat.
- **Encryption at Rest** — optional AES-256-GCM encryption for all sensitive data files. Set a passphrase during setup; data is encrypted before writing to disk. Cloud providers and device compromise cannot read your data.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/zebercut/ChiefClarity.git
cd ChiefClarity
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your paths:
```
DATA_FOLDER_PATH=/path/to/your/cloud/synced/data/folder
DB_PATH=C:/Users/you/Documents/.lifeos
```

- **DATA_FOLDER_PATH** — cloud-synced folder (Google Drive, OneDrive, Dropbox) for backup storage
- **DB_PATH** — local folder for the SQLite database (must NOT be cloud-synced — SQLite and cloud sync cause lock conflicts). A backup copy is automatically saved to DATA_FOLDER_PATH every hour.

The API key is entered in the app's setup wizard on first launch — it's saved to `.env` automatically. You don't need to add it manually.

### 3. Run

**Everything (app + proxy + headless scheduler):**
```bash
npm run dev
```

**App only (no autonomous scheduler):**
```bash
npm run dev:web
```

**Headless scheduler only (no UI):**
```bash
npm run headless
```

**With Docker:**
```bash
docker compose up --build
```

**Feature backlog viewer (featmap):**
```bash
npm run featmap
```
Opens a live web viewer at http://localhost:3456 for the features in [packages/feature-kit/features/](packages/feature-kit/features/) — inline editing, live reload, sortable/filterable table. Pin a port with `npm run featmap -- --port=4000`.

Open http://localhost:8081 in your browser. On first launch, the setup wizard walks you through API key validation and data folder selection.

## How It Works

```
User phrase
  -> router (regex + Haiku fallback)
  -> companion (emotional tone detection)
  -> assembler (context builder with token budgets)
  -> LLM (structured JSON via tool use)
  -> executor (applies writes, conflict checks)
  -> summarizer (rebuilds indexes)
```

One LLM call per phrase. TypeScript handles all deterministic logic. The LLM handles language understanding and judgment. Neither trespasses into the other's domain.

## Architecture

### Modules

| Module | What it does |
|--------|-------------|
| `router.ts` | Intent classification (14 types) — regex first, Haiku LLM fallback |
| `assembler.ts` | Context builder with per-intent token budgets |
| `llm.ts` | Anthropic SDK, tool use, model selection, dynamic token estimation with retry |
| `executor.ts` | Applies writes to state, conflict checks, atomic file flush |
| `summarizer.ts` | Rebuilds summaries, hot_context, contradiction index, OKR rollup |
| `companion.ts` | Emotional tone detection + companion context for planning |
| `conflict.ts` | Time overlap and duplicate detection |
| `loader.ts` | Loads all JSON data files at startup |
| `agendaMerger.ts` | Merges routine template + daily exceptions into full agenda |
| `briefRenderer.ts` | Renders focus brief to styled HTML |
| `chatHistory.ts` | Persists chat messages across sessions |
| `inbox.ts` | Detects, chunks, and processes bulk input from inbox.txt |
| `proactiveEngine.ts` | Pure condition checks for nudges — no LLM, zero cost |
| `nudges.ts` | Read/write/dedup nudge queue with cooldowns |
| `recurringProcessor.ts` | Creates daily task/event instances from recurring rules |
| `calendarHygiene.ts` | Archives past events, removes old data, deduplicates |
| `smartActions.ts` | Type-detects suggestions, direct action execution (done/reschedule/delete) |
| `annotations.ts` | Card-level comments/actions on Focus Brief items |
| `topicManager.ts` | Topic file read/write, slug generation, hint extraction, suggestion counting, cross-ref builder for planning, topic page updates from brief |

### Data Files

All data lives in your configured folder as plain JSON:

| File | Purpose |
|------|---------|
| `tasks.json` | Tasks with priority, status, OKR links |
| `calendar.json` | Events with datetime, duration, type |
| `user_profile.json` | Name, timezone, location, family |
| `user_lifestyle.json` | Schedule, routines, work windows, preferences |
| `user_observations.json` | Learned patterns: work style, emotional state, goals |
| `plan/plan_okr_dashboard.json` | Objectives and key results with progress tracking |
| `focus_brief.json` | Structured daily/weekly plan (compressed format) |
| `focus_brief.html` | Styled HTML version — readable on any device via Google Drive |
| `inbox.txt` | Bulk input — edit from any device, processed automatically |
| `nudges.json` | Proactive nudge queue from the headless runner |
| `recurring_tasks.json` | Recurring task rules (daily, weekly, custom schedules) |
| `chat_history.json` | Persisted chat messages |
| `feedback_memory.json` | User preferences and behavioral signals |
| `context_memory.json` | Long-term patterns, facts (with topic hints), recent events |
| `topics/_manifest.json` | Topic registry — active topics, pending suggestions, rejected topics |
| `topics/{slug}.md` | Per-topic knowledge file — notes, references, decisions |

### Focus Brief (Compressed Format)

The LLM sends a routine template once, and each day only has additions, removals, and overrides. TypeScript merges them at render time. This reduces token usage by ~70% for weekly plans.

```
routineTemplate (sent once)
  + day.additions (calendar events, slotted tasks)
  - day.removals (routine items skipped)
  ~ day.overrides (modified times)
  = full daily agenda (merged by agendaMerger.ts)
```

### Headless Runner

A long-running Node process that works autonomously:

| Schedule | What it does |
|----------|-------------|
| Daily (wake time) | Process inbox, generate day plan, proactive nudges |
| Daily (12:00) | Half-day brief refresh (Tier 2 Haiku), midday nudges |
| Weekly (weekStartsOn day, 20:00) | Generate week plan with companion section |
| Every 4 hours | Inbox check, overdue detection |

Reads schedule from `user_lifestyle.json`. Reuses all existing modules — no code duplication.

### Proactive Nudges

TypeScript detects conditions (no LLM cost), writes nudges to a file. The app shows them as action cards.

| Check | Trigger | Cooldown |
|-------|---------|----------|
| Overdue tasks | Due date passed + 1 day | 3 days per task |
| Pre-event prep | Event in next 4 hours | Once per event |
| Stalled tasks | Pending 7+ days | 7 days per task |
| OKR pace | KR behind expected progress | 7 days per KR |
| Learning reviews | nextReview date reached | 1 day per item |
| Plan stale | Brief older than 1 day (day) / 7 days (week) | 1 day |

## Scripts

| Command | What it runs |
|---------|-------------|
| `npm run dev` | App + proxy + headless scheduler (all-in-one) |
| `npx kill-port 3099 8081` | Kill ports 3099 and 8081 |
| `npm run featmap` | Start featmap live feature board at http://localhost:3456 |
| `npm run dev:web` | App + proxy only (no scheduler) |
| `npm run headless` | Headless scheduler only (no UI) |
| `npm run migrate` | Migrate v1 data to v2 schema |
| `npm run typecheck` | TypeScript type checking |
| `npx ts-node scripts/migrate-encryption.ts --encrypt` | Encrypt all sensitive data files |
| `npx ts-node scripts/migrate-encryption.ts --decrypt` | Decrypt all sensitive data files |
| `node scripts/discover-topics.js` | One-time: tag existing facts with topic hints via Haiku |
| `node scripts/db-backup.js` | Manual DB backup to cloud folder |
| `node scripts/restore-db.js` | Restore DB from cloud backup |
| `node scripts/google-auth.js` | One-time Google Calendar OAuth setup |
| `docker compose up` | Run everything via Docker |

## Project Structure

```
app/
  _layout.tsx           Root layout, config + theme context
  index.tsx             Entry — setup wizard or tabs
  setup.tsx             First-run setup (API key + data folder)
  (tabs)/
    _layout.tsx         Tab navigator (Chat + Focus + Tasks)
    chat.tsx            Chat interface with nudges
    focus.tsx           Focus Dashboard
    tasks.tsx           Tasks tab — backlog with search, group, filter (FEAT028)
    topics.tsx          Topics list page — search, pagination, topic cards (FEAT023)
    topic-detail.tsx    Topic detail page — tasks, events, OKR links, insights, notes (FEAT023)

src/
  modules/              Core engine
    taskPrioritizer.ts  Pure deterministic task sort (shared by Focus Brief and Tasks tab)
    taskFilters.ts      Pure helpers: filter, group, search for the Tasks tab
  types/index.ts        All TypeScript interfaces
  constants/
    prompts.ts          LLM system prompt
    themes.ts           Dark/light theme definitions
  utils/
    filesystem.ts       Platform-agnostic file I/O (Node, web, mobile)
    crypto.ts           AES-256-GCM encryption at rest (PBKDF2 key derivation)
    config.ts           AsyncStorage config persistence
    dates.ts            Timezone-aware date helpers (getUserToday, isOverdue, dateOffset)
  components/
    MarkdownText.tsx          Lightweight markdown renderer
    TaskListItem.tsx          Tasks tab row component (FEAT028)
    TaskFilterBar.tsx         Tasks tab active-filter chip bar (FEAT028)
    TaskDetailSlideOver.tsx   Shared task detail panel (used by Focus + Tasks tabs)
    topics/
      TopicCard.tsx           Topic list card component (FEAT023)
      TopicSuggestionCard.tsx Topic suggestion card (FEAT023)
    focus/                    Focus Dashboard section components
      SnapshotCard.tsx        Greeting + executive summary
      MindsetCards.tsx        Horizontal mindset tip cards
      FocusLayers.tsx         Daily/weekly/monthly focus columns
      TaskList.tsx            Today's tasks (interactive, collapsible)
      AgendaTimeline.tsx      Today's calendar timeline + free blocks
      WeekPreview.tsx         Next 7 days (fixed events + recurring tasks)
      CompanionCard.tsx       Emotional support + patterns
      RisksCard.tsx           Risks & blockers
      OkrCard.tsx             OKR progress snapshots

scripts/
  api-proxy.js          Dev server (API proxy + file API)
  headless-runner.js    Autonomous scheduler
  db-backup.js          Hourly DB backup to cloud folder
  restore-db.js         Restore DB from cloud backup
  google-auth.js        One-time Google Calendar OAuth helper
  generate-html.js      Standalone HTML generator
  migrate-v1-data.ts    v1 -> v2 data migration
  migrate-encryption.ts Encrypt/decrypt sensitive data files
  discover-topics.js    One-time topic hint discovery for existing facts

docs/
  new_architecture_typescript.md   Full architecture spec

packages/
  feature-kit/                     Standalone feature backlog system
    src/                           CLI, loader, validator, UI component
    features/                      One folder per feature (F01/, F02/, ...)
    schema/                        JSON Schema for validation
```

## Design Principles

- **Sacred boundary** — TypeScript owns deterministic logic, LLM owns judgment
- **Single LLM call** — one call per phrase, no agent chains
- **Structured output** — LLM returns JSON via tool use, never prose
- **Local-only** — your data stays on your device (Anthropic API call aside)
- **Cloud-synced** — user picks the folder, works across devices
- **No database** — plain JSON files, human-readable
- **Proactive, not reactive** — headless runner works while you sleep

## License

MIT License. See [LICENSE](LICENSE) for details.

Created and maintained by [Farzin](https://github.com/zebercut).
