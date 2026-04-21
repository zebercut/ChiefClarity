#!/usr/bin/env ts-node
/**
 * FEAT041 — One-shot migration: encrypted JSON files → libSQL database.
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-libsql.ts --dry-run
 *   npx ts-node scripts/migrate-to-libsql.ts --commit
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ── Env ────────────────────────────────────────────────────────────────
const DATA_PATH = process.env.DATA_FOLDER_PATH!;
const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE!;
const SALT_HEX = process.env.ENCRYPTION_SALT!;

if (!DATA_PATH || !PASSPHRASE || !SALT_HEX) {
  console.error("Missing DATA_FOLDER_PATH, ENCRYPTION_PASSPHRASE, or ENCRYPTION_SALT in .env");
  process.exit(1);
}

// ── Crypto (reuse existing module) ─────────────────────────────────────
import { deriveKey, cacheKey, setEncryptionEnabled } from "../src/utils/crypto";
import { setDataRoot, readJsonFile } from "../src/utils/filesystem";

// ── DB ─────────────────────────────────────────────────────────────────
import { openDatabase, getDb, closeDatabase } from "../src/db/index";

// ── Query modules (for insertion) ──────────────────────────────────────
import { insertTask, saveTasksSummary } from "../src/db/queries/tasks";
import { insertEvent, saveCalendarSummary } from "../src/db/queries/calendar";
import { insertNote, saveNotesSummary } from "../src/db/queries/notes";
import { insertRecurring } from "../src/db/queries/recurring";
import { saveOkrDashboard } from "../src/db/queries/okr";
import { saveContextMemory } from "../src/db/queries/context-memory";
import { saveObservations } from "../src/db/queries/observations";
import { saveTopics } from "../src/db/queries/topics";
import { saveSuggestions } from "../src/db/queries/suggestions";
import { saveLearning } from "../src/db/queries/learning";
import { insertMessage } from "../src/db/queries/chat";
import { saveProfile, saveLifestyle } from "../src/db/queries/kv";
import { saveSnapshot } from "../src/db/queries/snapshots";
import { saveAnnotations } from "../src/db/queries/annotations";
import { saveNudges } from "../src/db/queries/nudges";
import { saveFileSummary } from "../src/db/queries/summaries";

// ── Types ──────────────────────────────────────────────────────────────
import type {
  TasksFile,
  CalendarFile,
  NotesFile,
  RecurringTasksFile,
  PlanOkrDashboard,
  ContextMemory,
  UserObservations,
  TopicManifest,
  SuggestionsLog,
  LearningLog,
  ChatHistory,
  UserProfile,
  UserLifestyle,
  Fact,
} from "../src/types";

// ── CLI args ───────────────────────────────────────────────────────────
const mode = process.argv.includes("--commit") ? "commit" : "dry-run";
console.log(`\n  FEAT041 — JSON → libSQL migration (${mode})\n`);

async function main() {
  // 1. Derive key + set up filesystem
  console.log("  Deriving encryption key (600k PBKDF2 iterations)...");
  const key = await deriveKey(PASSPHRASE, SALT_HEX);
  cacheKey(key);
  setEncryptionEnabled(true);
  setDataRoot(DATA_PATH);
  console.log("  Key derived. Filesystem ready.\n");

  // 2. Choose database path
  const dbDir = mode === "dry-run"
    ? path.join(__dirname, "..", ".migration-staging")
    : DATA_PATH;
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "lifeos.db");

  if (mode === "commit" && fs.existsSync(dbPath)) {
    console.error("  ERROR: lifeos.db already exists. Refusing to overwrite.");
    console.error("  Delete it first if you want to re-run the migration.");
    process.exit(1);
  }
  // Remove staging db if re-running dry-run
  if (mode === "dry-run" && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  // 3. Open database (creates it, sets encryption, runs schema migration)
  console.log(`  Opening database at ${dbPath}`);
  await openDatabase(dbPath, PASSPHRASE);
  console.log("  Database opened + schema created.\n");

  const counts: Record<string, number> = {};

  // 4. Migrate each file
  // ── tasks.json ─────────────────────────────────────────────────────
  await migrateFile<TasksFile>("tasks.json", async (data) => {
    if (data._summary) await saveTasksSummary(data._summary);
    for (const task of data.tasks || []) {
      await insertTask(task);
    }
    counts["tasks"] = (data.tasks || []).length;
  });

  // ── calendar.json ──────────────────────────────────────────────────
  await migrateFile<CalendarFile>("calendar.json", async (data) => {
    if (data._summary) await saveCalendarSummary(data._summary);
    for (const event of data.events || []) {
      await insertEvent(event);
    }
    counts["calendar_events"] = (data.events || []).length;
  });

  // ── notes.json ─────────────────────────────────────────────────────
  await migrateFile<NotesFile>("notes.json", async (data) => {
    if (data._summary) await saveNotesSummary(data._summary);
    for (const note of data.notes || []) {
      await insertNote(note);
    }
    counts["notes"] = (data.notes || []).length;
  });

  // ── recurring_tasks.json ───────────────────────────────────────────
  await migrateFile<RecurringTasksFile>("recurring_tasks.json", async (data) => {
    for (const task of data.recurring || []) {
      await insertRecurring(task);
    }
    counts["recurring_tasks"] = (data.recurring || []).length;
  });

  // ── plan/plan_okr_dashboard.json ───────────────────────────────────
  await migrateFile<PlanOkrDashboard>("plan/plan_okr_dashboard.json", async (data) => {
    await saveOkrDashboard(data);
    counts["okr_objectives"] = (data.objectives || []).length;
    let krCount = 0;
    for (const obj of data.objectives || []) krCount += (obj.keyResults || []).length;
    counts["okr_key_results"] = krCount;
  });

  // ── context_memory.json ────────────────────────────────────────────
  await migrateFile<ContextMemory>("context_memory.json", async (data) => {
    // Normalize legacy string facts before saving
    const normalized: ContextMemory = {
      ...data,
      facts: (data.facts || []).map((f) =>
        typeof f === "string" ? { text: f, topic: null, date: "" } : f
      ),
    };
    await saveContextMemory(normalized);
    counts["facts"] = normalized.facts.length;
    counts["patterns"] = (data.patterns || []).length;
    counts["recent_events"] = (data.recentEvents || []).length;
  });

  // ── user_observations.json ─────────────────────────────────────────
  await migrateFile<UserObservations>("user_observations.json", async (data) => {
    await saveObservations(data);
    counts["user_observations"] =
      (data.workStyle || []).length +
      (data.communicationStyle || []).length +
      (data.taskCompletionPatterns || []).length +
      (data.emotionalState || []).length;
  });

  // ── topics/_manifest.json ──────────────────────────────────────────
  await migrateFile<TopicManifest>("topics/_manifest.json", async (data) => {
    await saveTopics(data);
    counts["topics"] = (data.topics || []).length;
    counts["topic_suggestions"] = (data.pendingSuggestions || []).length;
    counts["topic_signals"] = (data.signals || []).length;
  });

  // ── suggestions_log.json ───────────────────────────────────────────
  await migrateFile<SuggestionsLog>("suggestions_log.json", async (data) => {
    await saveSuggestions(data);
    counts["suggestions"] = (data.suggestions || []).length;
  });

  // ── learning_log.json ──────────────────────────────────────────────
  await migrateFile<LearningLog>("learning_log.json", async (data) => {
    await saveLearning(data);
    counts["learning_items"] = (data.items || []).length;
  });

  // ── chat_history.json ──────────────────────────────────────────────
  await migrateFile<ChatHistory>("chat_history.json", async (data) => {
    for (const msg of data.messages || []) {
      await insertMessage(msg);
    }
    counts["chat_messages"] = (data.messages || []).length;
  });

  // ── user_profile.json ──────────────────────────────────────────────
  await migrateFile<UserProfile>("user_profile.json", async (data) => {
    await saveProfile(data);
    counts["user_profile"] = Object.keys(data).length;
  });

  // ── user_lifestyle.json ────────────────────────────────────────────
  await migrateFile<UserLifestyle>("user_lifestyle.json", async (data) => {
    await saveLifestyle(data);
    counts["user_lifestyle"] = Object.keys(data).length;
  });

  // ── Snapshot files (whole-object blobs) ────────────────────────────
  const snapshotFiles: Record<string, string> = {
    hotContext: "hot_context.json",
    summaries: "summaries.json",
    planNarrative: "plan/plan_narrative.json",
    planAgenda: "plan/plan_agenda.json",
    planRisks: "plan/plan_risks.json",
    focusBrief: "focus_brief.json",
    contentIndex: "content_index.json",
    contradictionIndex: "contradiction_index.json",
    feedbackMemory: "feedback_memory.json",
  };

  for (const [key, file] of Object.entries(snapshotFiles)) {
    await migrateFile<unknown>(file, async (data) => {
      await saveSnapshot(key, data);
      counts[`snapshot:${key}`] = 1;
    });
  }

  // ── Side-managed files (annotations, nudges, proactive_state, tips_state) ──
  await migrateFile<{ annotations?: unknown[] }>("annotations.json", async (data) => {
    if (Array.isArray(data.annotations)) {
      await saveAnnotations(data.annotations as any);
      counts["annotations"] = data.annotations.length;
    }
  });

  await migrateFile<{ nudges?: unknown[] }>("nudges.json", async (data) => {
    if (Array.isArray(data.nudges)) {
      await saveNudges(data.nudges as any);
      counts["nudges"] = data.nudges.length;
    }
  });

  await migrateFile<Record<string, unknown>>("proactive_state.json", async (data) => {
    const db = getDb();
    for (const [k, v] of Object.entries(data)) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO proactive_state (key, value) VALUES (?, ?)",
        args: [k, JSON.stringify(v)],
      });
    }
    counts["proactive_state"] = Object.keys(data).length;
  });

  await migrateFile<Record<string, unknown>>("tips_state.json", async (data) => {
    const db = getDb();
    for (const [k, v] of Object.entries(data)) {
      await db.execute({
        sql: "INSERT OR REPLACE INTO tips_state (key, value) VALUES (?, ?)",
        args: [k, JSON.stringify(v)],
      });
    }
    counts["tips_state"] = Object.keys(data).length;
  });

  // 5. Verify row counts
  console.log("\n  ── Row counts ──────────────────────────────────────\n");
  const db = getDb();
  const tables = [
    "tasks", "calendar_events", "notes", "recurring_tasks",
    "okr_objectives", "okr_key_results", "facts", "patterns", "recent_events",
    "user_observations", "topics", "topic_suggestions", "topic_signals",
    "suggestions", "learning_items", "chat_messages", "annotations", "nudges",
  ];
  let allMatch = true;
  for (const table of tables) {
    const res = await db.execute(`SELECT COUNT(*) as c FROM ${table}`);
    const dbCount = Number(res.rows[0].c);
    const expected = counts[table];
    const match = expected === undefined || dbCount === expected;
    const icon = match ? "  OK  " : " FAIL ";
    if (!match) allMatch = false;
    console.log(`  ${icon} ${table.padEnd(22)} DB: ${String(dbCount).padStart(5)}  Expected: ${String(expected ?? "?").padStart(5)}`);
  }

  // Snapshots
  const snapRes = await db.execute("SELECT COUNT(*) as c FROM snapshots");
  console.log(`    OK   snapshots              DB: ${String(Number(snapRes.rows[0].c)).padStart(5)}`);

  console.log("");

  if (!allMatch) {
    console.error("  WARNING: Some counts don't match. Inspect the database.\n");
  } else {
    console.log("  All counts match.\n");
  }

  // 6. Close
  await closeDatabase();

  if (mode === "dry-run") {
    console.log(`  Dry run complete. Staging database: ${dbPath}`);
    console.log("  Inspect it, then run with --commit when ready.\n");
  } else {
    console.log("  Migration committed successfully.");
    console.log(`  Database: ${dbPath}`);
    console.log("  Original JSON files are untouched — rename/archive them manually when ready.\n");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function migrateFile<T>(
  file: string,
  handler: (data: T) => Promise<void>
): Promise<void> {
  try {
    const data = await readJsonFile(file) as T;
    if (data === null) {
      console.log(`  SKIP  ${file} (not found)`);
      return;
    }
    await handler(data);
    console.log(`  OK    ${file}`);
  } catch (err: any) {
    console.error(`  FAIL  ${file}: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("\n  FATAL:", err.message || err);
  process.exit(1);
});
