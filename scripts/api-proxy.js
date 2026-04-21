/**
 * Local dev server for web development.
 *
 * 1. CORS proxy: forwards /v1/messages to Anthropic's API
 * 2. File API: reads/writes JSON files from the user's data folder
 *
 * Usage: node scripts/api-proxy.js
 */

// Load .env from project root
const envPath = require("path").join(__dirname, "..", ".env");
const envContent = require("fs").existsSync(envPath) ? require("fs").readFileSync(envPath, "utf8") : "";
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

// Register ts-node for TypeScript imports (crypto module)
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true, jsx: "react" },
});

const { deriveKey, cacheKey, encrypt, decrypt, isEncryptedBuffer, isSensitiveFile, setEncryptionEnabled } = require("../src/utils/crypto");
const { readVault, writeVault } = require("../src/utils/vault");

const app = express();
const PORT = 3099;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─── Rate limiting (in-memory sliding window) ──────────────────────────────

const rateLimits = {
  // endpoint -> { windowMs, maxRequests }
  "/v1/messages": { windowMs: 60_000, maxRequests: 20 },
  // /files is a LOCAL helper for the browser app — it serves a small set of
  // sensitive JSON files to a single user on localhost. The previous limit
  // of 120/min was artificially low and could trip during normal app usage
  // (one full loadState = 21 reads × multiple tabs × periodic reloads).
  // The OLD behavior swallowed 429s as null in the client, which caused
  // silent data wipes. The NEW behavior throws on 429 (correctly), so the
  // limit must accommodate legitimate bursts. 2000/min gives ~33/sec — plenty
  // of headroom for any burst the app can produce, while still rate-limiting
  // a runaway client.
  "/files":       { windowMs: 60_000, maxRequests: 2000 },
  "/write-env":   { windowMs: 60_000, maxRequests: 5 },
};
const requestLog = new Map(); // key -> timestamp[]

function rateLimit(endpoint) {
  const config = rateLimits[endpoint];
  if (!config) return (_req, _res, next) => next();

  return (_req, res, next) => {
    const now = Date.now();
    const key = endpoint;
    let timestamps = requestLog.get(key) || [];
    // Slide the window
    timestamps = timestamps.filter((t) => now - t < config.windowMs);
    if (timestamps.length >= config.maxRequests) {
      const retryAfter = Math.ceil((timestamps[0] + config.windowMs - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "Too many requests. Try again later." });
    }
    timestamps.push(now);
    requestLog.set(key, timestamps);
    next();
  };
}

// ─── Anthropic API proxy ────────────────────────────────────────────────────

app.post("/v1/messages", rateLimit("/v1/messages"), async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(400).json({ error: "Missing x-api-key header" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("[proxy] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── File API (for web dev) ─────────────────────────────────────────────────

// Data root from environment — MUST be set, never from client
// All config comes from .env (setup wizard writes it via /write-env)
let DATA_ROOT = process.env.DATA_FOLDER_PATH
  ? path.resolve(process.env.DATA_FOLDER_PATH.replace(/\\/g, "/"))
  : null;

if (!DATA_ROOT) {
  console.error("[proxy] ERROR: DATA_FOLDER_PATH not set in .env — file API disabled");
}

// Encryption initialization
const ENCRYPTION_PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;
let _encryptionReady = false;

// Derive key synchronously at startup — must complete before any requests
if (ENCRYPTION_PASSPHRASE && ENCRYPTION_SALT) {
  const crypto = require("crypto");
  const salt = Buffer.from(ENCRYPTION_SALT, "hex");
  const key = crypto.pbkdf2Sync(ENCRYPTION_PASSPHRASE, salt, 600000, 32, "sha512");
  const keyBytes = new Uint8Array(key);
  cacheKey(keyBytes);
  setEncryptionEnabled(true);
  _encryptionReady = true;
  console.log("[proxy] Encryption enabled");

  // Self-describe the data folder: write _vault.json so any device pointed
  // at this folder + the right passphrase can derive the same key. Without
  // this, the salt only lives in .env on the machine running the proxy and
  // mobile/other-device installs can't decrypt the files.
  if (DATA_ROOT) {
    (async () => {
      try {
        const existing = await readVault(DATA_ROOT);
        if (existing) {
          // Sanity check: vault salt must match .env salt, otherwise we'd
          // overwrite a vault someone else wrote with different parameters.
          if (existing.salt !== ENCRYPTION_SALT) {
            console.warn(
              "[proxy] WARNING: vault file salt does not match .env ENCRYPTION_SALT. " +
              "Leaving the existing vault file alone. If this is unexpected, " +
              "delete _vault.json from the data folder and restart the proxy."
            );
          } else {
            console.log("[proxy] Vault file already present, skipping write");
          }
        } else {
          await writeVault(DATA_ROOT, keyBytes, ENCRYPTION_SALT);
          console.log("[proxy] Wrote _vault.json to data folder (data is now portable)");
        }
      } catch (err) {
        console.warn("[proxy] Could not write vault file:", err.message);
      }
    })();
  }
}

// FEAT041: DB open is deferred to the startup sequence (see bottom of file)
// so it completes before app.listen(). Defined here, called there.
async function tryOpenLibsql() {
  if (!DATA_ROOT || !ENCRYPTION_PASSPHRASE) return;
  // DB_PATH: local folder for lifeos.db (avoids Google Drive / cloud sync lock conflicts)
  const DB_DIR = process.env.DB_PATH || DATA_ROOT;
  if (DB_DIR !== DATA_ROOT) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    // Migrate: if DB exists on DATA_ROOT but not on DB_DIR, copy it
    const oldDb = path.join(DATA_ROOT, "lifeos.db");
    const newDb = path.join(DB_DIR, "lifeos.db");
    if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
      console.log(`[proxy] Migrating lifeos.db from ${DATA_ROOT} to ${DB_DIR}`);
      fs.copyFileSync(oldDb, newDb);
    }
  }
  const dbPath = path.join(DB_DIR, "lifeos.db");
  if (!fs.existsSync(dbPath)) return;
  try {
    const { openDatabase } = require("../src/db/index");
    const { setLibsqlMode } = require("../src/modules/loader");
    await openDatabase(dbPath.replace(/\\/g, "/"), ENCRYPTION_PASSPHRASE);
    setLibsqlMode(true);
    _libsqlReady = true;
    // Inject DB functions for the headless-runner-style Node code paths
    const { injectDbFunctions } = require("../src/modules/loader");
    const { loadStateFromDb } = require("../src/db/queries/state-bridge");
    const { flushToDb } = require("../src/db/flush");
    injectDbFunctions({ loadStateFromDb, flushToDb });

    // FEAT042+043: inject vector retriever into assembler + triage loader
    const { injectRetriever } = require("../src/modules/assembler");
    const { injectTriageRetriever } = require("../src/modules/triageLoader");
    const { retrieveContext } = require("../src/modules/embeddings/retriever");
    injectRetriever(retrieveContext);
    injectTriageRetriever(retrieveContext);

    // FEAT042: run background indexer (async, non-blocking)
    const { runBackgroundIndex } = require("../src/modules/embeddings/background-indexer");
    runBackgroundIndex().catch((err) =>
      console.warn("[proxy] background indexer error:", err.message)
    );

    // FEAT045: inject Tier 2 brief refresh function
    const { injectRefreshLlm, createRefreshLlmFn } = require("../src/modules/briefRefresher");
    const Anthropic = require("@anthropic-ai/sdk");
    const refreshClient = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const HAIKU_MODEL = process.env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
    injectRefreshLlm(createRefreshLlmFn(refreshClient, HAIKU_MODEL));

    // FEAT047: inject semantic dedup for executor
    const { injectSemanticDedup } = require("../src/modules/executor");
    const { embed } = require("../src/modules/embeddings/provider");
    const embedSearch = require("../src/db/queries/embeddings").searchSimilar;
    injectSemanticDedup(async (title, sourceType, limit, maxDist) => {
      const vec = await embed(title);
      if (!vec) return null;
      const matches = await embedSearch(vec, [sourceType], limit, maxDist);
      if (matches.length === 0) return null;
      const db = require("../src/db/index").getDb();
      const tableMap = { task: "tasks", event: "calendar_events" };
      const table = tableMap[sourceType] || sourceType;
      const results = [];
      for (const m of matches) {
        try {
          const rows = await db.execute({ sql: `SELECT * FROM "${table}" WHERE id = ?`, args: [m.sourceId] });
          if (rows.rows.length > 0) results.push({ sourceId: m.sourceId, distance: m.distance, data: rows.rows[0] });
        } catch {}
      }
      return results;
    });

    // FEAT018: Google Calendar sync on startup
    const GCAL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GCAL_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
    const GCAL_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
    if (GCAL_CLIENT_ID && GCAL_CLIENT_SECRET && GCAL_REFRESH_TOKEN) {
      const { setGoogleOAuthCredentials, setRefreshToken } = require("../src/integrations/google/auth");
      const { setGoogleCalendarConfig } = require("../src/integrations/registry");
      setGoogleOAuthCredentials(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET);
      setRefreshToken(GCAL_REFRESH_TOKEN);
      setGoogleCalendarConfig({ enabled: true });
      // Async sync — don't block startup
      const { syncGoogleCalendar } = require("../src/integrations/google/calendar");
      const { getGoogleCalendarConfig } = require("../src/integrations/registry");
      // Need state for brief patching — load it lazily on first sync
      setTimeout(async () => {
        try {
          const { loadStateFromDb } = require("../src/db/queries/state-bridge");
          const state = await loadStateFromDb();
          await syncGoogleCalendar(getGoogleCalendarConfig(), state);
        } catch (err) {
          console.warn("[proxy] Google Calendar sync failed:", err.message);
        }
      }, 5000); // delay 5s to let everything initialize
      console.log("[proxy] Google Calendar integration enabled");
    }

    console.log("[proxy] libSQL database opened");

    // Clean up stale JSON files — DB is the source of truth now
    cleanupStaleJsonFiles(DATA_ROOT);
  } catch (err) {
    console.warn("[proxy] libSQL open failed, using JSON layer:", err.message);
  }
}

/** Remove JSON data files that are superseded by the database. */
function cleanupStaleJsonFiles(dataRoot) {
  if (!dataRoot) return;
  // Safety: verify DB actually has data before deleting JSON backups
  try {
    const { getDb } = require("../src/db/index");
    const db = getDb();
    const result = db.execute("SELECT COUNT(*) as c FROM tasks");
    if (!result.rows.length || result.rows[0].c === 0) {
      console.warn("[proxy] DB appears empty — skipping JSON cleanup to preserve data");
      return;
    }
  } catch {
    console.warn("[proxy] Could not verify DB data — skipping JSON cleanup");
    return;
  }
  const STALE_FILES = [
    "tasks.json", "calendar.json", "context_memory.json", "feedback_memory.json",
    "suggestions_log.json", "learning_log.json", "user_profile.json",
    "user_lifestyle.json", "user_observations.json", "focus_brief.json",
    "recurring_tasks.json", "notes.json", "hot_context.json", "summaries.json",
    "content_index.json", "contradiction_index.json",
    "plan/plan_narrative.json", "plan/plan_agenda.json", "plan/plan_risks.json",
    "plan/plan_okr_dashboard.json",
    // Now also migrated to DB:
    "chat_history.json", "nudges.json", "annotations.json",
    "proactive_state.json", "tips_state.json",
  ];
  let cleaned = 0;
  for (const file of STALE_FILES) {
    const fullPath = path.join(dataRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        cleaned++;
      } catch {}
    }
  }
  if (cleaned > 0) {
    console.log(`[proxy] Cleaned up ${cleaned} stale JSON file(s) from data folder`);
  }
}

function normalizeSep(p) {
  return p.replace(/\\/g, "/").toLowerCase();
}

// ─── Rolling backups ────────────────────────────────────────────────────────
//
// Each write rotates:
//   <file>.bak.1 → <file>.bak.2 → ... → <file>.bak.N (oldest dropped)
//   <file>      → <file>.bak.1
//
// Why N>1: a single .bak only protects against ONE bad write. If a wipe
// happens twice in a row (e.g., a periodic reload fired twice with corrupt
// state), the second bad write overwrites the .bak that held the only good
// copy. With N=5 we get 5 writes of history before the oldest good copy
// falls off the back. The shrinkage guard in the client should prevent the
// bad write from happening at all in the common case; this is the backstop.
const BACKUP_COUNT = 5;

function rollBackups(filePath) {
  try {
    // Drop oldest
    const oldest = `${filePath}.bak.${BACKUP_COUNT}`;
    if (fs.existsSync(oldest)) {
      try { fs.unlinkSync(oldest); } catch { /* best-effort */ }
    }
    // Shift .bak.{i} → .bak.{i+1}
    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const src = `${filePath}.bak.${i}`;
      const dst = `${filePath}.bak.${i + 1}`;
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, dst); } catch { /* best-effort */ }
      }
    }
    // Copy current → .bak.1
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak.1`);
    }
  } catch (err) {
    console.warn("[files] backup roll failed for", filePath, "-", err.message);
  }
}

/** Extract relative path from absolute (for isSensitiveFile checks). */
function toRelative(filePath) {
  if (!DATA_ROOT) return filePath;
  const abs = normalizeSep(path.resolve(filePath));
  const root = normalizeSep(DATA_ROOT.endsWith("/") ? DATA_ROOT : DATA_ROOT + "/");
  if (abs.startsWith(root)) return abs.slice(root.length);
  return path.basename(filePath);
}

function validatePath(filePath) {
  if (!filePath || !DATA_ROOT) {
    console.warn("[files] path rejected: DATA_ROOT not set");
    return false;
  }
  const resolved = normalizeSep(path.resolve(filePath.replace(/\\/g, "/")));
  const root = normalizeSep(DATA_ROOT);
  const ok = resolved === root || resolved.startsWith(root + "/");
  if (!ok) {
    console.warn(`[files] path rejected: "${resolved}" not inside "${root}"`);
  }
  return ok;
}

// Check if file exists: HEAD /files?path=... (MUST be before GET /files)
app.head("/files", rateLimit("/files"), (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !validatePath(filePath)) {
    return res.status(403).end();
  }
  // FEAT041: if DB mode, state files always "exist"
  if (_libsqlReady && getDbLoader(toRelative(filePath))) {
    return res.status(200).end();
  }
  res.status(fs.existsSync(filePath) ? 200 : 404).end();
});

// FEAT041: Map relative file names to DB loader functions.
// When in libSQL mode, serve state data from the database instead of JSON files.
function getDbLoader(relPath) {
  if (!_libsqlReady) return null;
  const map = {
    "tasks.json":              () => require("../src/db/queries/tasks").loadTasks(),
    "calendar.json":           () => require("../src/db/queries/calendar").loadCalendar(),
    "notes.json":              () => require("../src/db/queries/notes").loadNotes(),
    "recurring_tasks.json":    () => require("../src/db/queries/recurring").loadRecurring(),
    "context_memory.json":     () => require("../src/db/queries/context-memory").loadContextMemory(),
    "user_observations.json":  () => require("../src/db/queries/observations").loadObservations(),
    "suggestions_log.json":    () => require("../src/db/queries/suggestions").loadSuggestions(),
    "learning_log.json":       () => require("../src/db/queries/learning").loadLearning(),
    "chat_history.json":       () => require("../src/db/queries/chat").loadChat(),
    "user_profile.json":       () => require("../src/db/queries/kv").loadProfile(),
    "user_lifestyle.json":     () => require("../src/db/queries/kv").loadLifestyle(),
    "topics/_manifest.json":   () => require("../src/db/queries/topics").loadTopics(),
    "hot_context.json":        () => require("../src/db/queries/snapshots").loadSnapshot("hotContext"),
    "summaries.json":          () => require("../src/db/queries/snapshots").loadSnapshot("summaries"),
    "plan/plan_narrative.json": () => require("../src/db/queries/snapshots").loadSnapshot("planNarrative"),
    "plan/plan_agenda.json":   () => require("../src/db/queries/snapshots").loadSnapshot("planAgenda"),
    "plan/plan_risks.json":    () => require("../src/db/queries/snapshots").loadSnapshot("planRisks"),
    "focus_brief.json":        () => require("../src/db/queries/snapshots").loadSnapshot("focusBrief"),
    "content_index.json":      () => require("../src/db/queries/snapshots").loadSnapshot("contentIndex"),
    "contradiction_index.json": () => require("../src/db/queries/snapshots").loadSnapshot("contradictionIndex"),
    "feedback_memory.json":    () => require("../src/db/queries/snapshots").loadSnapshot("feedbackMemory"),
    "plan/plan_okr_dashboard.json": () => require("../src/db/queries/okr").loadOkrDashboard(),
    "annotations.json":        async () => ({ annotations: await require("../src/db/queries/annotations").loadAnnotations() }),
    "nudges.json":             async () => ({ nudges: await require("../src/db/queries/nudges").loadNudges() }),
    "proactive_state.json":    async () => {
      const { getDb } = require("../src/db/index");
      const rows = await getDb().execute("SELECT key, value FROM proactive_state");
      const obj = {};
      for (const r of rows.rows) { try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; } }
      return obj;
    },
    "tips_state.json":         async () => {
      const { getDb } = require("../src/db/index");
      const rows = await getDb().execute("SELECT key, value FROM tips_state");
      const obj = {};
      for (const r of rows.rows) { try { obj[r.key] = JSON.parse(r.value); } catch { obj[r.key] = r.value; } }
      return obj;
    },
  };
  const norm = relPath.replace(/\\/g, "/");
  return map[norm] || null;
}

let _libsqlReady = false;

// Read a JSON file: GET /files?path=/absolute/path/to/file.json
app.get("/files", rateLimit("/files"), async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !validatePath(filePath)) {
    return res.status(403).json({ error: "Path not allowed" });
  }

  try {
    // FEAT041: serve from DB when in libSQL mode
    const relPath = toRelative(filePath);
    const dbLoader = getDbLoader(relPath);
    if (dbLoader) {
      const data = await dbLoader();
      return res.json(data ?? null);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const raw = fs.readFileSync(filePath);
    const bytes = new Uint8Array(raw);
    if (_encryptionReady && isSensitiveFile(relPath) && isEncryptedBuffer(bytes)) {
      const { getCachedKey } = require("../src/utils/crypto");
      const plaintext = await decrypt(getCachedKey(), bytes);
      res.json(JSON.parse(plaintext));
    } else {
      res.json(JSON.parse(raw.toString("utf8")));
    }
  } catch (err) {
    console.error("[files] read error:", filePath, err.message);
    res.status(500).json({ error: err.message });
  }
});

// FEAT041: Map relative file names to DB writer functions.
function getDbWriter(relPath) {
  if (!_libsqlReady) return null;
  const map = {
    "tasks.json":              (d) => { const m = require("../src/db/queries/tasks"); const { getDb } = require("../src/db/index"); return (async () => { const db = getDb(); await db.execute("BEGIN"); try { await db.execute("DELETE FROM tasks"); for (const t of d.tasks||[]) await m.insertTask(t); if (d._summary) await require("../src/db/queries/summaries").saveFileSummary("tasks", d._summary); await db.execute("COMMIT"); } catch(e) { await db.execute("ROLLBACK"); throw e; } })(); },
    "calendar.json":           (d) => { const m = require("../src/db/queries/calendar"); const { getDb } = require("../src/db/index"); return (async () => { const db = getDb(); await db.execute("BEGIN"); try { await db.execute("DELETE FROM calendar_events"); for (const e of d.events||[]) await m.insertEvent(e); if (d._summary) await require("../src/db/queries/summaries").saveFileSummary("calendar", d._summary); await db.execute("COMMIT"); } catch(e) { await db.execute("ROLLBACK"); throw e; } })(); },
    "notes.json":              (d) => { const m = require("../src/db/queries/notes"); const { getDb } = require("../src/db/index"); return (async () => { const db = getDb(); await db.execute("BEGIN"); try { await db.execute("DELETE FROM notes"); for (const n of d.notes||[]) await m.insertNote(n); if (d._summary) await require("../src/db/queries/summaries").saveFileSummary("notes", d._summary); await db.execute("COMMIT"); } catch(e) { await db.execute("ROLLBACK"); throw e; } })(); },
    "recurring_tasks.json":    (d) => { const m = require("../src/db/queries/recurring"); const { getDb } = require("../src/db/index"); return (async () => { const db = getDb(); await db.execute("BEGIN"); try { await db.execute("DELETE FROM recurring_tasks"); for (const r of d.recurring||[]) await m.insertRecurring(r); await db.execute("COMMIT"); } catch(e) { await db.execute("ROLLBACK"); throw e; } })(); },
    "plan/plan_okr_dashboard.json": (d) => require("../src/db/queries/okr").saveOkrDashboard(d),
    "context_memory.json":     (d) => require("../src/db/queries/context-memory").saveContextMemory(d),
    "user_observations.json":  (d) => require("../src/db/queries/observations").saveObservations(d),
    "suggestions_log.json":    (d) => require("../src/db/queries/suggestions").saveSuggestions(d),
    "learning_log.json":       (d) => require("../src/db/queries/learning").saveLearning(d),
    "user_profile.json":       (d) => require("../src/db/queries/kv").saveProfile(d),
    "user_lifestyle.json":     (d) => require("../src/db/queries/kv").saveLifestyle(d),
    "topics/_manifest.json":   (d) => require("../src/db/queries/topics").saveTopics(d),
    "chat_history.json":       (d) => { const m = require("../src/db/queries/chat"); return (async () => { await m.clearChat(); for (const msg of d.messages||[]) await m.insertMessage(msg); })(); },
    "annotations.json":        (d) => require("../src/db/queries/annotations").saveAnnotations(d.annotations||[]),
    "nudges.json":             (d) => require("../src/db/queries/nudges").saveNudges(d.nudges||[]),
    "hot_context.json":        (d) => require("../src/db/queries/snapshots").saveSnapshot("hotContext", d),
    "summaries.json":          (d) => require("../src/db/queries/snapshots").saveSnapshot("summaries", d),
    "plan/plan_narrative.json": (d) => require("../src/db/queries/snapshots").saveSnapshot("planNarrative", d),
    "plan/plan_agenda.json":   (d) => require("../src/db/queries/snapshots").saveSnapshot("planAgenda", d),
    "plan/plan_risks.json":    (d) => require("../src/db/queries/snapshots").saveSnapshot("planRisks", d),
    "focus_brief.json":        (d) => require("../src/db/queries/snapshots").saveSnapshot("focusBrief", d),
    "content_index.json":      (d) => require("../src/db/queries/snapshots").saveSnapshot("contentIndex", d),
    "contradiction_index.json": (d) => require("../src/db/queries/snapshots").saveSnapshot("contradictionIndex", d),
    "feedback_memory.json":    (d) => require("../src/db/queries/snapshots").saveSnapshot("feedbackMemory", d),
    "proactive_state.json":    (d) => require("../src/db/queries/kv").saveKvGeneric("proactive_state", d),
    "tips_state.json":         (d) => require("../src/db/queries/kv").saveKvGeneric("tips_state", d),
  };
  const norm = relPath.replace(/\\/g, "/");
  return map[norm] || null;
}

// Write a JSON file: POST /files?path=/absolute/path/to/file.json
app.post("/files", rateLimit("/files"), async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !validatePath(filePath)) {
    return res.status(403).json({ error: "Path not allowed" });
  }

  try {
    // FEAT041: write to DB when in libSQL mode
    const relPath = toRelative(filePath);
    const dbWriter = getDbWriter(relPath);
    if (dbWriter) {
      await dbWriter(req.body);
      return res.json({ ok: true });
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Only roll backups in legacy JSON mode — in DB mode the database is the source of truth
    if (!_libsqlReady) {
      rollBackups(filePath);
    }

    const tmpPath = filePath + ".tmp";
    const content = JSON.stringify(req.body, null, 2);

    if (_encryptionReady && isSensitiveFile(relPath)) {
      const { getCachedKey } = require("../src/utils/crypto");
      const encrypted = await encrypt(getCachedKey(), content);
      fs.writeFileSync(tmpPath, Buffer.from(encrypted));
    } else {
      fs.writeFileSync(tmpPath, content, "utf8");
    }
    fs.renameSync(tmpPath, filePath);

    console.log("[files] wrote:", filePath);
    res.json({ ok: true });
  } catch (err) {
    console.error("[files] write error:", filePath, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Read a raw text file: GET /files/text?path=/absolute/path/to/file.txt
app.get("/files/text", async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !validatePath(filePath)) {
    return res.status(403).send("Path not allowed");
  }
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }
    const raw = fs.readFileSync(filePath);
    const bytes = new Uint8Array(raw);
    if (_encryptionReady && isSensitiveFile(toRelative(filePath)) && isEncryptedBuffer(bytes)) {
      const { getCachedKey } = require("../src/utils/crypto");
      const plaintext = await decrypt(getCachedKey(), bytes);
      res.type("text/plain").send(plaintext);
    } else {
      res.type("text/plain").send(raw.toString("utf8"));
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Write a raw text file: POST /files/text?path=/absolute/path/to/file.md
app.post("/files/text", express.text({ limit: "1mb" }), async (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !validatePath(filePath)) {
    return res.status(403).json({ error: "Path not allowed" });
  }

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = filePath + ".tmp";
    if (_encryptionReady && isSensitiveFile(toRelative(filePath))) {
      const { getCachedKey } = require("../src/utils/crypto");
      const encrypted = await encrypt(getCachedKey(), req.body);
      fs.writeFileSync(tmpPath, Buffer.from(encrypted));
    } else {
      fs.writeFileSync(tmpPath, req.body, "utf8");
    }
    fs.renameSync(tmpPath, filePath);

    console.log("[files] wrote text:", filePath);
    res.json({ ok: true });
  } catch (err) {
    console.error("[files] text write error:", filePath, err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── Write .env (called by setup wizard) ────────────────────────────────────

app.post("/write-env", rateLimit("/write-env"), (req, res) => {
  try {
    const envPath = path.join(__dirname, "..", ".env");

    // Read existing .env and parse into a map (preserve manually-added vars)
    const existing = new Map();
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) existing.set(m[1].trim(), m[2].trim());
      }
    }

    // Merge incoming vars (sanitize: strip newlines, #, quotes)
    const vars = req.body;
    for (const [key, value] of Object.entries(vars)) {
      if (!key || !value) continue;
      const safeKey = String(key).replace(/[\n\r#=]/g, "").trim();
      const safeValue = String(value).replace(/[\n\r]/g, "").trim();
      if (safeKey) existing.set(safeKey, safeValue);
    }

    // Write back
    const lines = [];
    for (const [k, v] of existing) {
      lines.push(`${k}=${v}`);
    }
    fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf8");

    // Update in-memory process.env + DATA_ROOT so proxy works immediately
    for (const [k, v] of existing) {
      process.env[k] = v;
    }
    if (process.env.DATA_FOLDER_PATH) {
      DATA_ROOT = path.resolve(process.env.DATA_FOLDER_PATH.replace(/\\/g, "/"));
      console.log("[proxy] DATA_ROOT updated to:", DATA_ROOT);
    }

    console.log("[proxy] .env updated by setup wizard");
    res.json({ ok: true });
  } catch (err) {
    console.error("[proxy] .env write failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

(async () => {
  // FEAT041: open DB before accepting requests so isLibsqlMode() is set
  await tryOpenLibsql();

  // Start DB backup to cloud folder (every 6 hours)
  const _DB_DIR = process.env.DB_PATH || DATA_ROOT;
  if (_DB_DIR && DATA_ROOT && _DB_DIR !== DATA_ROOT) {
    const { startBackupInterval } = require("./db-backup");
    startBackupInterval({ dbDir: _DB_DIR, backupDir: DATA_ROOT });
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Dev server running at http://127.0.0.1:${PORT} (localhost only)`);
    console.log("  /v1/messages  -> Anthropic API proxy");
    console.log("  /files        -> Local file read/write");
    if (DATA_ROOT) {
      console.log("  Data root:", DATA_ROOT);
      if (_DB_DIR !== DATA_ROOT) console.log("  DB path:", _DB_DIR);
    } else {
      console.log("  WARNING: File API disabled — set DATA_FOLDER_PATH in .env");
    }
  });
})();
