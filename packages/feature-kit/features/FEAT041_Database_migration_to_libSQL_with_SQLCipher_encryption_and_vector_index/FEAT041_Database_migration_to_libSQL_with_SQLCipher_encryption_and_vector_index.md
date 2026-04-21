# FEAT041 — Database migration to libSQL with SQLCipher encryption and vector index

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Data Layer
**Priority:** 1
**Release:** v4.0
**Tags:** database, libsql, sqlcipher, encryption, migration, vector-index, foundation
**Created:** 2026-04-08
**Design Reviewed:** 2026-04-10

**Blocks:** FEAT042 (Semantic retrieval layer), FEAT043 (Two-stage LLM reasoning)
**Independent of:** Nothing — this is the foundation

---

## Summary

Migrate the application's data layer from 21 encrypted JSON files to a single encrypted libSQL database. Preserves the user's existing passphrase, encryption strength (AES-256 / PBKDF2-SHA512 / 600,000 iterations), and unlock UX exactly. Replaces hand-rolled per-file encryption with SQLCipher's page-level encryption and unlocks vector search for FEAT042.

---

## Developer Implementation Guide

### Phase 0: Foundation (this feature)

Five sequential work packages. Each is independently testable and committable.

---

## WP-1: Install dependencies + connection module

**Goal:** `openDatabase()` / `getDb()` / `closeDatabase()` work on Node. No app changes yet.

### 1.1 Install

```bash
npm install @libsql/client
```

> **Platform note:** `@libsql/client` works on Node (native binding), and provides a HTTP client for the web proxy. Capacitor uses a community SQLite plugin with SQLCipher — that's WP-5 (out of scope for Phase 0; Capacitor keeps JSON layer for now).

### 1.2 Create `src/db/index.ts`

```typescript
import { createClient, type Client, type InStatement } from "@libsql/client";

let _client: Client | null = null;

/**
 * Open the database, set encryption, run pending migrations.
 * Call once at app start after passphrase is available.
 */
export async function openDatabase(dbPath: string, passphrase: string): Promise<Client> {
  _client = createClient({ url: `file:${dbPath}` });
  // Match current threat model exactly
  await _client.execute("PRAGMA cipher_kdf_iter = 600000");
  await _client.execute({ sql: "PRAGMA key = ?", args: [passphrase] });
  // Smoke-test: if the key is wrong, any query will fail
  try {
    await _client.execute("SELECT 1");
  } catch {
    _client = null;
    throw new Error("Wrong passphrase or corrupt database");
  }
  // WAL mode for better concurrency + crash recovery
  await _client.execute("PRAGMA journal_mode = WAL");
  await _client.execute("PRAGMA foreign_keys = ON");
  await runPendingMigrations(_client);
  return _client;
}

/** Get the open connection. Throws if not opened. */
export function getDb(): Client {
  if (!_client) throw new Error("Database not opened — call openDatabase() first");
  return _client;
}

export async function closeDatabase(): Promise<void> {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/** Change passphrase atomically. */
export async function rekeyDatabase(newPassphrase: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "PRAGMA rekey = ?", args: [newPassphrase] });
}
```

### 1.3 Create `src/db/migrator.ts`

```typescript
import type { Client } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function runPendingMigrations(db: Client): Promise<void> {
  // Ensure tracking table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      filename TEXT NOT NULL
    )
  `);

  // Get already-applied versions
  const applied = await db.execute("SELECT version FROM _migrations ORDER BY version");
  const appliedSet = new Set(applied.rows.map((r) => Number(r.version)));

  // Read migration files: 0001_initial_schema.sql, 0002_xxx.sql, ...
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split("_")[0], 10);
    if (appliedSet.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    // Execute each statement (split on semicolons, skip empty)
    const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.execute(stmt);
    }
    await db.execute({
      sql: "INSERT INTO _migrations (version, applied_at, filename) VALUES (?, ?, ?)",
      args: [version, new Date().toISOString(), file],
    });
  }
}
```

### 1.4 Acceptance

- [ ] `openDatabase("test.db", "test-pass")` creates an encrypted file
- [ ] `openDatabase("test.db", "wrong-pass")` throws "Wrong passphrase"
- [ ] `getDb()` before `openDatabase()` throws
- [ ] `rekeyDatabase("new-pass")` works and old pass fails afterward
- [ ] Migration runner applies `.sql` files in order and records them in `_migrations`

---

## WP-2: Schema migration `0001_initial_schema.sql`

**Goal:** One SQL file that creates every table needed to hold the current 21-file state.

### File: `src/db/migrations/0001_initial_schema.sql`

The schema below is derived from the **actual TypeScript interfaces** in `src/types/index.ts`. Each table maps to one JSON file (or one sub-collection within a file). Column comments show the source.

```sql
-- ═══════════════════════════════════════════════════════════════════
-- FEAT041 — Initial schema
-- Source of truth: src/types/index.ts interfaces
-- ═══════════════════════════════════════════════════════════════════

-- ── tasks.json → Task[] ────────────────────────────────────────────
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,              -- Task.id
  title             TEXT NOT NULL,                 -- Task.title
  due               TEXT,                          -- Task.due (YYYY-MM-DD)
  priority          TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),   -- Task.priority
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done','overdue')), -- Task.status
  category          TEXT NOT NULL DEFAULT '',       -- Task.category
  subcategory       TEXT NOT NULL DEFAULT '',       -- Task.subcategory
  okr_link          TEXT,                          -- Task.okrLink → okr_key_results.id
  conflict_status   TEXT NOT NULL DEFAULT 'ok'
    CHECK (conflict_status IN ('ok','flagged')),   -- Task.conflictStatus
  conflict_reason   TEXT NOT NULL DEFAULT '',       -- Task.conflictReason
  conflict_with     TEXT NOT NULL DEFAULT '[]',    -- Task.conflictWith (JSON array)
  notes             TEXT NOT NULL DEFAULT '',       -- Task.notes
  time_allocated    TEXT NOT NULL DEFAULT '',       -- Task.timeAllocated
  related_calendar  TEXT NOT NULL DEFAULT '[]',    -- Task.relatedCalendar (JSON array)
  related_inbox     TEXT NOT NULL DEFAULT '[]',    -- Task.relatedInbox (JSON array)
  created_at        TEXT NOT NULL,                 -- Task.createdAt
  completed_at      TEXT                           -- Task.completedAt
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due);
CREATE INDEX idx_tasks_okr ON tasks(okr_link);
CREATE INDEX idx_tasks_category ON tasks(category);

-- tasks.json._summary → stored separately
CREATE TABLE file_summaries (
  file_key TEXT PRIMARY KEY,                       -- e.g. "tasks", "calendar", "notes"
  summary  TEXT NOT NULL DEFAULT ''
);

-- ── calendar.json → CalendarEvent[] ────────────────────────────────
CREATE TABLE calendar_events (
  id                  TEXT PRIMARY KEY,            -- CalendarEvent.id
  title               TEXT NOT NULL,               -- CalendarEvent.title
  datetime            TEXT NOT NULL,               -- CalendarEvent.datetime (ISO)
  duration_minutes    INTEGER NOT NULL DEFAULT 60, -- CalendarEvent.durationMinutes
  status              TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','completed','cancelled')),
  type                TEXT NOT NULL DEFAULT '',     -- CalendarEvent.type
  priority            TEXT NOT NULL DEFAULT '',     -- CalendarEvent.priority
  notes               TEXT NOT NULL DEFAULT '',     -- CalendarEvent.notes
  related_inbox       TEXT NOT NULL DEFAULT '[]',  -- CalendarEvent.relatedInbox (JSON array)
  archived            INTEGER NOT NULL DEFAULT 0,  -- CalendarEvent.archived
  is_recurring_inst   INTEGER NOT NULL DEFAULT 0,  -- CalendarEvent.isRecurringInstance
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_cal_datetime ON calendar_events(datetime);
CREATE INDEX idx_cal_status ON calendar_events(status);

-- ── notes.json → Note[] ───────────────────────────────────────────
CREATE TABLE notes (
  id                TEXT PRIMARY KEY,              -- Note.id
  text              TEXT NOT NULL,                 -- Note.text
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','processed','failed')),
  created_at        TEXT NOT NULL,                 -- Note.createdAt
  processed_at      TEXT,                          -- Note.processedAt
  write_count       INTEGER NOT NULL DEFAULT 0,    -- Note.writeCount
  processed_summary TEXT,                          -- Note.processedSummary
  attempt_count     INTEGER NOT NULL DEFAULT 0,    -- Note.attemptCount
  last_error        TEXT                           -- Note.lastError
);
CREATE INDEX idx_notes_status ON notes(status);

-- ── recurring_tasks.json → RecurringTask[] ────────────────────────
CREATE TABLE recurring_tasks (
  id          TEXT PRIMARY KEY,                    -- RecurringTask.id
  title       TEXT NOT NULL,                       -- RecurringTask.title
  schedule    TEXT NOT NULL,                       -- RecurringSchedule (JSON object)
  category    TEXT NOT NULL DEFAULT '',             -- RecurringTask.category
  priority    TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high','medium','low')),
  okr_link    TEXT,                                -- RecurringTask.okrLink
  duration    INTEGER,                             -- RecurringTask.duration (minutes)
  notes       TEXT,                                -- RecurringTask.notes
  active      INTEGER NOT NULL DEFAULT 1,          -- RecurringTask.active
  created_at  TEXT NOT NULL                        -- RecurringTask.createdAt
);

-- ── plan/plan_okr_dashboard.json → OkrObjective[] ─────────────────
CREATE TABLE okr_objectives (
  id                TEXT PRIMARY KEY,              -- OkrObjective.id
  title             TEXT NOT NULL,                 -- OkrObjective.title
  status            TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','parked','completed')),
  activity_progress INTEGER NOT NULL DEFAULT 0,    -- OkrObjective.activityProgress (cached)
  outcome_progress  INTEGER NOT NULL DEFAULT 0,    -- OkrObjective.outcomeProgress (cached)
  created_at        TEXT NOT NULL
);

CREATE TABLE okr_key_results (
  id              TEXT PRIMARY KEY,                -- OkrKeyResult.id
  objective_id    TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,                   -- OkrKeyResult.title
  metric          TEXT NOT NULL DEFAULT '',         -- OkrKeyResult.metric
  target_type     TEXT NOT NULL DEFAULT 'numeric'
    CHECK (target_type IN ('numeric','percentage','milestone')),
  target_value    REAL NOT NULL DEFAULT 0,         -- OkrKeyResult.targetValue
  target_unit     TEXT NOT NULL DEFAULT '',         -- OkrKeyResult.targetUnit
  current_value   REAL,                            -- OkrKeyResult.currentValue
  current_note    TEXT,                            -- OkrKeyResult.currentNote
  last_updated    TEXT,                            -- OkrKeyResult.lastUpdated
  due_date        TEXT                             -- OkrKeyResult.dueDate
);
CREATE INDEX idx_kr_objective ON okr_key_results(objective_id);

CREATE TABLE okr_decisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id  TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,                     -- OkrDecision.date
  summary       TEXT NOT NULL                      -- OkrDecision.summary
);

-- plan_okr_dashboard.focusPeriod
CREATE TABLE okr_focus_period (
  id    INTEGER PRIMARY KEY CHECK (id = 1),        -- singleton
  start TEXT NOT NULL,
  end   TEXT NOT NULL
);

-- ── context_memory.json ───────────────────────────────────────────
CREATE TABLE facts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  text  TEXT NOT NULL,                             -- Fact.text
  topic TEXT,                                      -- Fact.topic
  date  TEXT                                       -- Fact.date
);
CREATE INDEX idx_facts_topic ON facts(topic);

CREATE TABLE patterns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,                       -- ContextMemory.patterns[].pattern
  evidence    TEXT NOT NULL DEFAULT '',             -- .evidence
  first_seen  TEXT NOT NULL,                       -- .firstSeen
  last_seen   TEXT NOT NULL,                       -- .lastSeen
  confidence  REAL NOT NULL DEFAULT 0              -- .confidence
);

CREATE TABLE recent_events (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  text  TEXT NOT NULL                              -- ContextMemory.recentEvents[]
);

-- ── feedback_memory.json ──────────────────────────────────────────
CREATE TABLE feedback_preferences (
  key   TEXT PRIMARY KEY,                          -- e.g. "reminderFormat", "responseLength"
  value TEXT NOT NULL                              -- JSON-encoded
);

CREATE TABLE behavioral_signals (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  signal    TEXT NOT NULL,
  observed  INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL
);

CREATE TABLE corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  original      TEXT NOT NULL,
  corrected_to  TEXT NOT NULL,
  date          TEXT NOT NULL
);

CREATE TABLE behavioral_rules (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  rule   TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user','system')),
  date   TEXT NOT NULL
);

-- ── user_observations.json ────────────────────────────────────────
CREATE TABLE user_observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL
    CHECK (category IN ('workStyle','communicationStyle','taskCompletionPatterns','emotionalState')),
  observation TEXT NOT NULL,                       -- .observation
  pattern     TEXT,                                -- taskCompletionPatterns: .pattern
  cat_label   TEXT,                                -- taskCompletionPatterns: .category
  date        TEXT NOT NULL,                       -- .firstSeen or .date
  confidence  REAL                                 -- workStyle: .confidence
);
CREATE INDEX idx_obs_category ON user_observations(category);

-- user_observations.goalsContext (singleton JSON)
CREATE TABLE goals_context (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  primary_goal        TEXT NOT NULL DEFAULT '',
  secondary_goals     TEXT NOT NULL DEFAULT '[]',   -- JSON array
  financial_pressure  TEXT NOT NULL DEFAULT '',
  last_updated        TEXT NOT NULL
);

-- ── topics/_manifest.json ─────────────────────────────────────────
CREATE TABLE topics (
  id          TEXT PRIMARY KEY,                    -- TopicEntry.id
  name        TEXT NOT NULL,                       -- TopicEntry.name
  aliases     TEXT NOT NULL DEFAULT '[]',           -- TopicEntry.aliases (JSON array)
  created_at  TEXT NOT NULL                        -- TopicEntry.createdAt
);

CREATE TABLE topic_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT NOT NULL,                      -- TopicSuggestion.topic
  count        INTEGER NOT NULL DEFAULT 0,
  threshold    INTEGER NOT NULL DEFAULT 3,
  status       TEXT NOT NULL DEFAULT 'accumulating'
    CHECK (status IN ('accumulating','pending','deferred')),
  suggested_at TEXT
);

CREATE TABLE topic_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,                       -- TopicSignal.topic
  source_type TEXT NOT NULL,                       -- TopicSignal.sourceType
  source_id   TEXT NOT NULL,                       -- TopicSignal.sourceId
  date        TEXT NOT NULL                        -- TopicSignal.date
);
CREATE INDEX idx_topic_signals_topic ON topic_signals(topic);

CREATE TABLE rejected_topics (
  name TEXT PRIMARY KEY
);

-- ── suggestions_log.json → Suggestion[] ───────────────────────────
CREATE TABLE suggestions (
  id           TEXT PRIMARY KEY,                   -- Suggestion.id
  text         TEXT NOT NULL,
  shown_at     TEXT NOT NULL,
  trigger      TEXT NOT NULL DEFAULT '',
  action_taken TEXT,                               -- 'acted_on'|'ignored'|'pending'|null
  resolved_at  TEXT
);

-- ── learning_log.json → LearningItem[] ────────────────────────────
CREATE TABLE learning_items (
  id            TEXT PRIMARY KEY,                  -- LearningItem.id
  topic         TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','mastered','paused')),
  created_at    TEXT NOT NULL,
  next_review   TEXT NOT NULL,
  review_count  INTEGER NOT NULL DEFAULT 0,
  mastery_level INTEGER NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT ''
);

-- ── chat_history.json → ChatMessage[] ─────────────────────────────
CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content     TEXT NOT NULL,
  suggestions TEXT,                                -- JSON array (nullable)
  smart_actions TEXT,                              -- JSON array (nullable)
  items       TEXT,                                -- JSON array (nullable)
  write_summary TEXT,                              -- JSON array (nullable)
  is_question INTEGER NOT NULL DEFAULT 0,
  timestamp   TEXT NOT NULL
);
CREATE INDEX idx_chat_ts ON chat_messages(timestamp);

-- ── Key-value stores for single-object files ──────────────────────
-- These files are single JSON objects, not arrays.
-- Stored as key-value pairs for easy partial updates.

CREATE TABLE user_profile (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                              -- JSON-encoded
);
-- Seeded keys: name, timezone, location, language, familyMembers

CREATE TABLE user_lifestyle (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                              -- JSON-encoded
);
-- Seeded keys: sleepWake, weekdaySchedule, weekendSchedule,
--              weekStartsOn, availableWorkWindows, preferences

-- ── Snapshot/artifact files ───────────────────────────────────────
-- These are whole-object stores: the app writes the complete object
-- and reads it back whole. No relational queries needed.

CREATE TABLE snapshots (
  key   TEXT PRIMARY KEY,                          -- e.g. "hotContext", "summaries", "planNarrative",
                                                   --      "planAgenda", "planRisks", "focusBrief",
                                                   --      "contentIndex", "contradictionIndex"
  value TEXT NOT NULL,                             -- full JSON blob
  updated_at TEXT NOT NULL
);

-- ── Cross-domain link tables (populated by FEAT042) ───────────────
CREATE TABLE task_calendar_links (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  similarity REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, event_id)
);

CREATE TABLE task_note_links (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  similarity REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, note_id)
);

-- ── Embeddings (created empty; FEAT042 populates) ─────────────────
CREATE TABLE embeddings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,                       -- 'task','event','note','fact','topic'
  source_id   TEXT NOT NULL,
  vector      F32_BLOB(384),                       -- 384-dim (all-MiniLM-L6-v2)
  metadata    TEXT,                                -- JSON
  created_at  TEXT NOT NULL,
  UNIQUE (source_type, source_id)
);
CREATE INDEX idx_embed_vector ON embeddings(libsql_vector_idx(vector));
CREATE INDEX idx_embed_source ON embeddings(source_type, source_id);
```

### JSON file → SQL table mapping

| JSON File | Table(s) | Strategy |
|---|---|---|
| `tasks.json` | `tasks` + `file_summaries` | Row per task. `_summary` → `file_summaries` row. Arrays (`conflictWith`, `relatedCalendar`, `relatedInbox`) stored as JSON strings. |
| `calendar.json` | `calendar_events` + `file_summaries` | Row per event. |
| `notes.json` | `notes` + `file_summaries` | Row per note. |
| `recurring_tasks.json` | `recurring_tasks` | Row per rule. `schedule` stored as JSON string. |
| `plan/plan_okr_dashboard.json` | `okr_objectives` + `okr_key_results` + `okr_decisions` + `okr_focus_period` | Normalized. One row per objective, one per KR, one per decision. |
| `context_memory.json` | `facts` + `patterns` + `recent_events` | Split into three tables. Legacy string facts normalized during migration. |
| `feedback_memory.json` | `feedback_preferences` + `behavioral_signals` + `corrections` + `behavioral_rules` | Split into four tables. `preferences` object flattened to key-value rows. |
| `user_observations.json` | `user_observations` + `goals_context` | Category-tagged rows + singleton goals. |
| `topics/_manifest.json` | `topics` + `topic_suggestions` + `rejected_topics` + `topic_signals` | Split into four tables. |
| `suggestions_log.json` | `suggestions` | Row per suggestion. |
| `learning_log.json` | `learning_items` | Row per item. |
| `chat_history.json` | `chat_messages` | Row per message. Complex fields (`suggestions`, `smartActions`, `items`, `writeSummary`) stored as JSON strings. |
| `user_profile.json` | `user_profile` | Key-value pairs. `familyMembers` stored as JSON string. |
| `user_lifestyle.json` | `user_lifestyle` | Key-value pairs. Each top-level field is one row. |
| `hot_context.json` | `snapshots` (key="hotContext") | Whole-object blob. |
| `summaries.json` | `snapshots` (key="summaries") | Whole-object blob. |
| `plan/plan_narrative.json` | `snapshots` (key="planNarrative") | Whole-object blob. |
| `plan/plan_agenda.json` | `snapshots` (key="planAgenda") | Whole-object blob. |
| `plan/plan_risks.json` | `snapshots` (key="planRisks") | Whole-object blob. |
| `focus_brief.json` | `snapshots` (key="focusBrief") | Whole-object blob. |
| `content_index.json` | `snapshots` (key="contentIndex") | Whole-object blob. |
| `contradiction_index.json` | `snapshots` (key="contradictionIndex") | Whole-object blob. |

### Design decision: `snapshots` table

Eight of the 21 files are whole-object artifacts that are written and read as a single unit (no per-field queries). Normalizing them into dozens of tables yields zero query benefit and creates massive migration complexity. The `snapshots` table stores them as JSON blobs with the same read/write semantics as the JSON files, but inside the encrypted database. They can be normalized later if query patterns justify it.

### Acceptance

- [ ] `0001_initial_schema.sql` applies cleanly on a fresh database
- [ ] All tables exist with correct columns and constraints
- [ ] Indexes are created
- [ ] `_migrations` records version 1

---

## WP-3: Query modules + AppState bridge

**Goal:** Query modules that can read from / write to the database AND reconstruct the exact `AppState` shape the rest of the app expects. This is the compatibility bridge — existing code sees the same `AppState`, but it's backed by SQL.

### 3.1 File structure

```
src/db/
  index.ts          ← WP-1
  migrator.ts       ← WP-1
  migrations/
    0001_initial_schema.sql  ← WP-2
  queries/
    tasks.ts         ← reads/writes tasks table, returns Task[]
    calendar.ts      ← reads/writes calendar_events, returns CalendarEvent[]
    notes.ts         ← reads/writes notes table, returns Note[]
    recurring.ts     ← reads/writes recurring_tasks, returns RecurringTask[]
    okr.ts           ← reads/writes okr_* tables, returns PlanOkrDashboard
    context-memory.ts ← reads/writes facts + patterns + recent_events
    feedback.ts      ← reads/writes feedback_* tables
    observations.ts  ← reads/writes user_observations + goals_context
    topics.ts        ← reads/writes topics + topic_suggestions + signals
    suggestions.ts   ← reads/writes suggestions table
    learning.ts      ← reads/writes learning_items table
    chat.ts          ← reads/writes chat_messages table
    kv.ts            ← reads/writes user_profile, user_lifestyle (key-value)
    snapshots.ts     ← reads/writes snapshots table (whole-object blobs)
    summaries.ts     ← reads/writes file_summaries table
    state-bridge.ts  ← loadStateFromDb(): reads all tables, returns AppState
```

### 3.2 Query module pattern

Every query module follows the same contract:

```typescript
// Example: src/db/queries/tasks.ts
import { getDb } from "../index";
import type { Task, TasksFile } from "../../types";

/** Load all tasks + summary as a TasksFile. */
export async function loadTasks(): Promise<TasksFile> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM tasks ORDER BY created_at DESC");
  const summaryRow = await db.execute(
    "SELECT summary FROM file_summaries WHERE file_key = 'tasks'"
  );
  return {
    _summary: summaryRow.rows[0]?.summary as string ?? "",
    tasks: rows.rows.map(rowToTask),
  };
}

/** Insert one task. */
export async function insertTask(task: Task): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO tasks (id, title, due, priority, status, category, subcategory,
            okr_link, conflict_status, conflict_reason, conflict_with, notes,
            time_allocated, related_calendar, related_inbox, created_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      task.id, task.title, task.due || null, task.priority, task.status,
      task.category, task.subcategory, task.okrLink,
      task.conflictStatus, task.conflictReason,
      JSON.stringify(task.conflictWith), task.notes,
      task.timeAllocated, JSON.stringify(task.relatedCalendar),
      JSON.stringify(task.relatedInbox), task.createdAt, task.completedAt,
    ],
  });
}

/** Update one task (partial). */
export async function updateTask(id: string, fields: Partial<Task>): Promise<void> {
  // Build SET clause dynamically from provided fields
  // ...
}

/** Delete one task. */
export async function deleteTask(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "DELETE FROM tasks WHERE id = ?", args: [id] });
}

// ── Row mapper ─────────────────────────────────────────────────
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    title: row.title as string,
    due: row.due as string ?? "",
    priority: row.priority as Task["priority"],
    status: row.status as Task["status"],
    category: row.category as string,
    subcategory: row.subcategory as string,
    okrLink: row.okr_link as string | null,
    conflictStatus: row.conflict_status as Task["conflictStatus"],
    conflictReason: row.conflict_reason as string,
    conflictWith: JSON.parse(row.conflict_with as string),
    notes: row.notes as string,
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | null,
    timeAllocated: row.time_allocated as string,
    relatedCalendar: JSON.parse(row.related_calendar as string),
    relatedInbox: JSON.parse(row.related_inbox as string),
  };
}
```

### 3.3 State bridge: `src/db/queries/state-bridge.ts`

The most critical module. Loads ALL tables and reconstructs the exact `AppState` shape:

```typescript
export async function loadStateFromDb(): Promise<AppState> {
  const [
    tasks, calendar, notes, recurringTasks, okrDashboard,
    contextMemory, feedbackMemory, observations, topics,
    suggestions, learning, chat, profile, lifestyle,
    hotContext, summaries, narrative, agenda, risks,
    focusBrief, contentIndex, contradictionIndex,
  ] = await Promise.all([
    loadTasks(), loadCalendar(), loadNotes(), loadRecurring(),
    loadOkrDashboard(), loadContextMemory(), loadFeedback(),
    loadObservations(), loadTopics(), loadSuggestions(),
    loadLearning(), loadChat(), loadProfile(), loadLifestyle(),
    loadSnapshot("hotContext"), loadSnapshot("summaries"),
    loadSnapshot("planNarrative"), loadSnapshot("planAgenda"),
    loadSnapshot("planRisks"), loadSnapshot("focusBrief"),
    loadSnapshot("contentIndex"), loadSnapshot("contradictionIndex"),
  ]);

  return {
    tasks, calendar, notes, recurringTasks,
    planOkrDashboard: okrDashboard,
    contextMemory, feedbackMemory,
    userObservations: observations,
    topicManifest: topics,
    suggestionsLog: suggestions,
    learningLog: learning,
    // Chat is loaded separately by the chat module
    userProfile: profile,
    userLifestyle: lifestyle,
    hotContext: hotContext ?? DEFAULT_HOT_CONTEXT,
    summaries: summaries ?? DEFAULT_SUMMARIES,
    planNarrative: narrative ?? { summary: "" },
    planAgenda: agenda ?? { agenda: [] },
    planRisks: risks ?? { risks: [] },
    focusBrief: focusBrief ?? DEFAULT_FOCUS_BRIEF,
    contentIndex: contentIndex ?? DEFAULT_CONTENT_INDEX,
    contradictionIndex: contradictionIndex ?? DEFAULT_CONTRADICTION_INDEX,
    _dirty: new Set(),
    _pendingContext: null,
    _loadedCounts: {}, // Not needed with DB — shrinkage guard replaced by SQL constraints
  };
}
```

### 3.4 Acceptance

- [ ] `loadStateFromDb()` returns an `AppState` with the exact same shape as `loadState()` from JSON
- [ ] Each query module round-trips data: insert → load → compare === identical
- [ ] OKR normalization: objectives → key results → decisions all load correctly as nested objects
- [ ] JSON array fields (`conflictWith`, `relatedCalendar`, etc.) deserialize correctly

---

## WP-4: Migration script

**Goal:** `scripts/migrate-to-libsql.ts` reads all encrypted JSON files and populates the new database.

### 4.1 File: `scripts/migrate-to-libsql.ts`

```
Usage:
  npx ts-node scripts/migrate-to-libsql.ts --dry-run
  npx ts-node scripts/migrate-to-libsql.ts --commit
```

### 4.2 Migration flow

```
1. Read CLI args: --dry-run or --commit
2. Load .env (DATA_FOLDER_PATH, ENCRYPTION_PASSPHRASE, ENCRYPTION_SALT)
3. Derive encryption key using existing crypto.ts deriveKey()
4. Verify key against existing _vault.json
5. Set up filesystem with existing setDataRoot() + cacheKey()
6. Choose target:
   --dry-run  → data/.migration-staging.db
   --commit   → data/lifeos.db
7. openDatabase(target, passphrase)     ← creates encrypted db
8. For each of the 21 JSON files:
   a. Read via existing readJsonFile() (decrypts in memory)
   b. If null (file doesn't exist): skip with warning
   c. Insert all rows into corresponding table(s)
   d. Verify: SELECT COUNT(*) matches expected
9. Report per-table counts
10. Spot-check: 10 random records per table, compare against JSON source
11. If --dry-run: stop here, report success, leave staging db
12. If --commit:
    a. Rename data folder: __LO-DataV2/ → __LO-DataV2-frozen-pre-libsql/
    b. Create new data folder with just lifeos.db
    c. Copy non-database files: inbox.txt, focus_brief.html, topics/*.md
    d. Report success
```

### 4.3 JSON → SQL insertion mapping (per file)

| JSON File | Read Call | Insert Logic |
|---|---|---|
| `tasks.json` | `readJsonFile("tasks.json")` as `TasksFile` | `INSERT INTO tasks` per task + `INSERT INTO file_summaries` for `_summary` |
| `calendar.json` | `readJsonFile("calendar.json")` as `CalendarFile` | `INSERT INTO calendar_events` per event + file_summaries |
| `notes.json` | `readJsonFile("notes.json")` as `NotesFile` | `INSERT INTO notes` per note + file_summaries |
| `recurring_tasks.json` | `readJsonFile(...)` as `RecurringTasksFile` | `INSERT INTO recurring_tasks` per rule; `schedule` → `JSON.stringify()` |
| `plan/plan_okr_dashboard.json` | `readJsonFile(...)` as `PlanOkrDashboard` | For each objective: INSERT objective → INSERT each KR → INSERT each decision. INSERT `okr_focus_period` singleton. |
| `context_memory.json` | `readJsonFile(...)` as `ContextMemory` | `facts[]` → `INSERT INTO facts` (normalize string facts to `{text, topic:null, date:""}`). `patterns[]` → `INSERT INTO patterns`. `recentEvents[]` → `INSERT INTO recent_events`. |
| `feedback_memory.json` | `readJsonFile(...)` as `FeedbackMemory` | `preferences` → one row per key in `feedback_preferences`. `behavioralSignals[]` → `INSERT INTO behavioral_signals`. `corrections[]` → `INSERT INTO corrections`. `rules[]` → `INSERT INTO behavioral_rules`. |
| `user_observations.json` | `readJsonFile(...)` as `UserObservations` | `workStyle[]` → rows with category='workStyle'. `communicationStyle[]` → category='communicationStyle'. `taskCompletionPatterns[]` → category='taskCompletionPatterns' (also saves `.category` as `cat_label`, `.pattern` as `pattern`). `emotionalState[]` → category='emotionalState'. `goalsContext` → `INSERT INTO goals_context` singleton. |
| `topics/_manifest.json` | `readJsonFile(...)` as `TopicManifest` | `topics[]` → `INSERT INTO topics`. `pendingSuggestions[]` → `INSERT INTO topic_suggestions`. `rejectedTopics[]` → `INSERT INTO rejected_topics`. `signals[]` → `INSERT INTO topic_signals`. |
| `suggestions_log.json` | `readJsonFile(...)` as `SuggestionsLog` | `suggestions[]` → `INSERT INTO suggestions` |
| `learning_log.json` | `readJsonFile(...)` as `LearningLog` | `items[]` → `INSERT INTO learning_items` + file_summaries for `_summary` |
| `chat_history.json` | `readJsonFile(...)` as `ChatHistory` | `messages[]` → `INSERT INTO chat_messages`; `suggestions`, `smartActions`, `items`, `writeSummary` → `JSON.stringify()` |
| `user_profile.json` | `readJsonFile(...)` as `UserProfile` | One row per top-level key: `name`, `timezone`, `location`, `language`, `familyMembers` (JSON.stringify for array) |
| `user_lifestyle.json` | `readJsonFile(...)` as `UserLifestyle` | One row per top-level key: `sleepWake`, `weekdaySchedule`, `weekendSchedule`, `weekStartsOn`, `availableWorkWindows`, `preferences` (all JSON.stringify) |
| `hot_context.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="hotContext", value=JSON.stringify(whole object) |
| `summaries.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="summaries" |
| `plan/plan_narrative.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="planNarrative" |
| `plan/plan_agenda.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="planAgenda" |
| `plan/plan_risks.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="planRisks" |
| `focus_brief.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="focusBrief" |
| `content_index.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="contentIndex" |
| `contradiction_index.json` | `readJsonFile(...)` | `INSERT INTO snapshots` key="contradictionIndex" |

### 4.4 Acceptance

- [ ] `--dry-run` creates staging db without touching original files
- [ ] `--commit` migrates and renames the original data folder
- [ ] Row counts match for every table
- [ ] Spot-check passes for 10 random records per table
- [ ] If passphrase is wrong, script aborts before any changes
- [ ] If migration fails midway, JSON files are still intact
- [ ] Second `--commit` invocation refuses to run (db already exists)

---

## WP-5: Wire into the app

**Goal:** Replace `loadState()` → `loadStateFromDb()` and `flush()` → SQL writes. The app runs on libSQL.

### 5.1 Changes to existing files

| File | Current | After | Lines Affected |
|---|---|---|---|
| `src/modules/loader.ts` (262 lines) | Reads 21 JSON files sequentially | Calls `loadStateFromDb()` from `state-bridge.ts` | **Full rewrite** to ~30 lines |
| `src/modules/executor.ts` (1182 lines) | `applyAdd/Update/Delete` mutates in-memory state, `flush()` writes JSON | `applyAdd/Update/Delete` calls query module SQL writes **directly**. No more `_dirty` set. No more `flush()` as a separate step. Each write is an immediate SQL transaction. | **Major refactor** of write methods (~400 lines). `flush()` becomes a no-op or is removed. Shrinkage guard is replaced by SQL constraints. |
| `src/modules/assembler.ts` (600+ lines) | `state.tasks.tasks.filter(...)` in-memory | Can stay as-is initially (reads from the `AppState` object which was loaded from DB). Optimize to direct SQL queries in a follow-up. | **No changes in WP-5** — the state bridge provides the same AppState shape. |
| `app/_layout.tsx` (361 lines) | `deriveKey()` + `cacheKey()` + `setEncryptionEnabled()` + `loadState()` | `openDatabase(dbPath, passphrase)` + `loadStateFromDb()` | Lines 199-227 (unlock flow), lines 50-67 (auto-unlock) |
| `scripts/api-proxy.js` (420 lines) | File read/write endpoints (`/files`) | Opens libSQL directly. Replace `/files` endpoints with `/query` endpoint that accepts SQL. Or: keep `/files` for `inbox.txt` / `focus_brief.html` only, add `/db/query` for SQL. | Lines 240-357 (file endpoints) |
| `scripts/headless-runner.js` (460 lines) | `loadState()` at start of each job | `openDatabase()` + `loadStateFromDb()` at start of each job | Lines 50-86 (init), lines 135-196 (job start) |
| `src/utils/filesystem.ts` (909 lines) | Used for all reads/writes | **Keep** for `inbox.txt`, `focus_brief.html`, topic `.md` files. The JSON-specific functions (`readJsonFile`, `writeJsonFile` for encrypted JSON) become unused. Don't delete yet — keep for the migration window rollback path. | No changes; just stops being called for JSON state files. |
| `src/utils/crypto.ts` (418 lines) | Key derivation, encrypt/decrypt, vault verification | **Keep `deriveKey()`** — still used for vault verification during migration. Keep `verifyKey()` for the migration script. The encrypt/decrypt functions become unused (SQLCipher handles it). Don't delete yet. | No changes; just stops being called. |

### 5.2 Executor refactor strategy

The executor currently does:
1. Mutate `state.X.Y.push(item)` (in-memory)
2. `state._dirty.add("fileKey")`
3. At the end: `flush(state)` → `writeJsonFile()` for each dirty file

After migration:
1. Call `insertTask(task)` / `updateTask(id, fields)` / `deleteTask(id)` (SQL write)
2. Also mutate `state.X.Y.push(item)` (keep in-memory state in sync for the current request)
3. No flush needed — writes are already persisted

This dual-write approach means the in-memory `AppState` stays consistent within a request without reloading from DB after every write. The next `loadStateFromDb()` call (next request) picks up the committed SQL state.

### 5.3 Rollback plan

If something goes wrong after shipping WP-5:

1. Revert the WP-5 commit
2. Rename `__LO-DataV2-frozen-pre-libsql/` back to `__LO-DataV2/`
3. Delete `lifeos.db`
4. App starts on JSON layer again

The frozen JSON folder is preserved for **2 weeks** after stable operation. Only then does a cleanup PR remove it and the unused JSON code paths.

### 5.4 Acceptance

- [ ] App starts, unlocks, loads state from libSQL — all tabs render correctly
- [ ] Create task via chat → task appears in tasks tab → persists across restart
- [ ] Create event via chat → event appears in calendar → persists
- [ ] Plan my day → focus brief generated → renders correctly
- [ ] Headless runner cron jobs execute against the database
- [ ] Web proxy serves the app correctly (Expo web)
- [ ] Passphrase change works (PRAGMA rekey)
- [ ] Wrong passphrase shows unlock screen, not crash

---

## Files NOT migrated to the database

These stay as files on disk:

| File | Reason |
|---|---|
| `inbox.txt` | User-editable plaintext input surface. Users can edit from Google Drive. |
| `focus_brief.html` | Generated HTML artifact for display. Not a queryable record. |
| `topics/{slug}.md` | Long markdown content. Browsable outside the app. Only topic metadata is in the `topics` table. |
| `_vault.json` | Encryption verification artifact. Used during migration. Stays for cross-device portability. |
| `.bak.*` files | Rolling backups. Irrelevant after migration — the `.db` file is its own backup unit. |

---

## Testing Strategy

### Unit tests (per query module)

For each of the ~15 query modules:
1. Open an in-memory libSQL database
2. Run the migration
3. Insert sample data
4. Load and compare: output must match the TypeScript interface exactly
5. Update and delete: verify changes persist

### Integration tests

1. **Migration round-trip:** Run `migrate-to-libsql.ts --dry-run` against test fixture JSON files → verify row counts and sample records
2. **State equivalence:** Load the same data from JSON (old path) and from DB (new path) → deep-compare the two `AppState` objects
3. **Full chat turn:** Router → assembler → LLM → executor → verify writes in DB
4. **Passphrase lifecycle:** Open → rekey → close → reopen with new passphrase → verify data intact

### Encryption verification

1. `hexdump lifeos.db | head` → no readable strings
2. `strings lifeos.db | grep "<known task title>"` → returns nothing
3. Open with wrong passphrase → error
4. `PRAGMA cipher_kdf_iter` returns 600000

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Should `inbox.txt` move into the database? | **No.** Keep as file — user-editable from Google Drive. |
| Should `topics/{slug}.md` move? | **No.** Keep as files — browsable outside the app. |
| Should embeddings table be created in Phase 0? | **Yes.** Avoids a separate migration in FEAT042. |
| Should `focus_brief.json` move? | **Yes, into `snapshots` table.** It's still read/written as a blob, but encrypted with everything else. |
| What library for embeddings? | `@xenova/transformers` with `all-MiniLM-L6-v2` (384-dim). Doesn't affect Phase 0 schema. |
| Platform strategy for Capacitor? | **Phase 0 ships Node + web proxy only.** Capacitor keeps JSON layer until a community SQLCipher plugin is validated. |

---

## Estimated Work Breakdown

| WP | Description | Size |
|---|---|---|
| WP-1 | Dependencies + connection module | Small |
| WP-2 | Schema migration SQL file | Medium (careful mapping) |
| WP-3 | Query modules + state bridge | Large (15 query modules + bridge) |
| WP-4 | Migration script | Medium |
| WP-5 | Wire into app (loader, executor, proxy, headless, layout) | Large (most risk) |

**Dependency chain:** WP-1 → WP-2 → WP-3 → WP-4 → WP-5 (strictly sequential)
