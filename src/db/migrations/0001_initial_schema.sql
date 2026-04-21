-- ═══════════════════════════════════════════════════════════════════════════
-- FEAT041 — Initial schema
-- Migrates 21+ encrypted JSON files to libSQL tables.
-- Source of truth: src/types/index.ts + actual data in __LO-DataV2/
-- ═══════════════════════════════════════════════════════════════════════════

-- ── tasks.json ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  due              TEXT,
  priority         TEXT NOT NULL DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'pending',
  category         TEXT NOT NULL DEFAULT '',
  subcategory      TEXT NOT NULL DEFAULT '',
  okr_link         TEXT,
  conflict_status  TEXT NOT NULL DEFAULT 'ok',
  conflict_reason  TEXT NOT NULL DEFAULT '',
  conflict_with    TEXT NOT NULL DEFAULT '[]',
  notes            TEXT NOT NULL DEFAULT '',
  time_allocated   TEXT NOT NULL DEFAULT '',
  related_calendar TEXT NOT NULL DEFAULT '[]',
  related_inbox    TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  completed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due);
CREATE INDEX IF NOT EXISTS idx_tasks_okr      ON tasks(okr_link);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);

-- ── calendar.json ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  datetime          TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL DEFAULT 60,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  type              TEXT NOT NULL DEFAULT '',
  priority          TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  related_inbox     TEXT NOT NULL DEFAULT '[]',
  archived          INTEGER NOT NULL DEFAULT 0,
  is_recurring_inst INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_datetime ON calendar_events(datetime);
CREATE INDEX IF NOT EXISTS idx_cal_status   ON calendar_events(status);

-- ── notes.json ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id                TEXT PRIMARY KEY,
  text              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL,
  processed_at      TEXT,
  write_count       INTEGER NOT NULL DEFAULT 0,
  processed_summary TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);

-- ── recurring_tasks.json ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  schedule   TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  priority   TEXT NOT NULL DEFAULT 'medium',
  okr_link   TEXT,
  duration   INTEGER,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ── plan/plan_okr_dashboard.json ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS okr_focus_period (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS okr_objectives (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active',
  activity_progress INTEGER NOT NULL DEFAULT 0,
  outcome_progress  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS okr_key_results (
  id            TEXT PRIMARY KEY,
  objective_id  TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  metric        TEXT NOT NULL DEFAULT '',
  target_type   TEXT NOT NULL DEFAULT 'numeric',
  target_value  REAL NOT NULL DEFAULT 0,
  target_unit   TEXT NOT NULL DEFAULT '',
  current_value REAL,
  current_note  TEXT,
  last_updated  TEXT,
  due_date      TEXT
);
CREATE INDEX IF NOT EXISTS idx_kr_objective ON okr_key_results(objective_id);

CREATE TABLE IF NOT EXISTS okr_decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  summary      TEXT NOT NULL
);

-- ── context_memory.json ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  text  TEXT NOT NULL,
  topic TEXT,
  date  TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_topic ON facts(topic);

CREATE TABLE IF NOT EXISTS patterns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern    TEXT NOT NULL,
  evidence   TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recent_events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL
);

-- ── user_observations.json ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  observation TEXT NOT NULL,
  pattern     TEXT,
  cat_label   TEXT,
  date        TEXT NOT NULL,
  confidence  REAL
);
CREATE INDEX IF NOT EXISTS idx_obs_category ON user_observations(category);

CREATE TABLE IF NOT EXISTS goals_context (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  primary_goal       TEXT NOT NULL DEFAULT '',
  secondary_goals    TEXT NOT NULL DEFAULT '[]',
  financial_pressure TEXT NOT NULL DEFAULT '',
  last_updated       TEXT NOT NULL DEFAULT ''
);

-- ── topics/_manifest.json ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topics (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  aliases    TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  threshold    INTEGER NOT NULL DEFAULT 3,
  status       TEXT NOT NULL DEFAULT 'accumulating',
  suggested_at TEXT
);

CREATE TABLE IF NOT EXISTS topic_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  date        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topic_signals_topic ON topic_signals(topic);

CREATE TABLE IF NOT EXISTS rejected_topics (
  name TEXT PRIMARY KEY
);

-- ── suggestions_log.json ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestions (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  shown_at     TEXT NOT NULL,
  trigger_text TEXT NOT NULL DEFAULT '',
  action_taken TEXT,
  resolved_at  TEXT
);

-- ── learning_log.json ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_items (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  next_review   TEXT NOT NULL DEFAULT '',
  review_count  INTEGER NOT NULL DEFAULT 0,
  mastery_level INTEGER NOT NULL DEFAULT 0,
  notes         TEXT NOT NULL DEFAULT ''
);

-- ── chat_history.json ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  suggestions   TEXT,
  smart_actions TEXT,
  items         TEXT,
  write_summary TEXT,
  is_question   INTEGER NOT NULL DEFAULT 0,
  timestamp     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages(timestamp);

-- ── annotations.json ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annotations (
  id           TEXT PRIMARY KEY,
  target_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL DEFAULT '',
  target_title TEXT NOT NULL DEFAULT '',
  comment      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  resolved     INTEGER NOT NULL DEFAULT 0,
  resolved_at  TEXT,
  resolved_by  TEXT
);

-- ── nudges.json ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nudges (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT '',
  message      TEXT NOT NULL DEFAULT '',
  actions      TEXT NOT NULL DEFAULT '[]',
  related_id   TEXT,
  created_at   TEXT NOT NULL,
  shown_at     TEXT,
  dismissed_at TEXT
);

-- ── proactive_state.json ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proactive_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── tips_state.json ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tips_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Key-value stores for single-object files ───────────────────────────────
CREATE TABLE IF NOT EXISTS user_profile (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_lifestyle (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── _summary fields from files that have them ──────────────────────────────
CREATE TABLE IF NOT EXISTS file_summaries (
  file_key TEXT PRIMARY KEY,
  summary  TEXT NOT NULL DEFAULT ''
);

-- ── Whole-object snapshots (files with no per-field query patterns) ────────
CREATE TABLE IF NOT EXISTS snapshots (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Cross-domain link tables (populated by FEAT042) ───────────────────────
CREATE TABLE IF NOT EXISTS task_calendar_links (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  similarity REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, event_id)
);

CREATE TABLE IF NOT EXISTS task_note_links (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  similarity REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, note_id)
);
