/**
 * Chief Clarity — Headless Runner
 *
 * A long-running Node process that autonomously:
 * - Processes inbox.txt on schedule
 * - Generates daily/weekly plans
 * - Runs proactive checks and writes nudges
 * - Renders focus_brief.html
 *
 * Usage: node scripts/headless-runner.js
 * Or:    npm run headless
 *
 * All business logic modules are reused from src/ — same code as the app.
 * Only filesystem.ts and llm.ts needed adaptation for Node (no React Native).
 */

const cron = require("node-cron");
const path = require("path");
const fs = require("fs");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

// All config comes from .env (setup wizard writes it via the proxy)
const DATA_PATH = process.env.DATA_FOLDER_PATH;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!DATA_PATH) { console.error("ERROR: DATA_FOLDER_PATH not set in .env or config.json"); process.exit(1); }
if (!API_KEY || API_KEY === "your_key_here") { console.error("ERROR: ANTHROPIC_API_KEY not set. Run the app setup wizard first, or add it to .env"); process.exit(1); }

// ─── Bootstrap modules ────────────────────────────────────────────────────

// Register ts-node for TypeScript imports
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    target: "ES2020",
    esModuleInterop: true,
    jsx: "react",
  },
});

const { setDataRoot } = require("../src/utils/filesystem");
const { initLlmClient, callLlm, isCircuitOpen, getCircuitBreakerStatus } = require("../src/modules/llm");
const { loadState } = require("../src/modules/loader");
const { updateSummaries, rebuildHotContext, rebuildContradictionIndex } = require("../src/modules/summarizer");
const { checkInbox, processInbox } = require("../src/modules/inbox");
const { runNotesBatch } = require("../src/modules/notesProcessor");
const { runProactiveChecks } = require("../src/modules/proactiveEngine");
const { writeNudges } = require("../src/modules/nudges");
const { assembleContext } = require("../src/modules/assembler");
const { applyWrites, flush } = require("../src/modules/executor");
const { renderBriefToHtml } = require("../src/modules/briefRenderer");
const { getUnresolvedAnnotations, resolveAnnotations } = require("../src/modules/annotations");
const { processRecurringTasks } = require("../src/modules/recurringProcessor");
const { runDailyHygiene, runWeeklyHygiene } = require("../src/modules/calendarHygiene");

const { loadChatHistory, saveChatHistory } = require("../src/modules/chatHistory");
const { deriveKey, cacheKey, setEncryptionEnabled } = require("../src/utils/crypto");
const { nowTimeStr, setDefaultTimezone, getUserHour } = require("../src/utils/dates");

// Cached user timezone — set after first loadState()
let _userTz;

/** Append a system message to chat history so the user sees what the headless runner did. */
async function logToChat(message) {
  try {
    const messages = await loadChatHistory();
    messages.push({
      role: "assistant",
      content: message,
      timestamp: nowTimeStr(_userTz),
    });
    await saveChatHistory(messages);
  } catch (err) {
    console.warn(`[${ts()}] Failed to log to chat:`, err.message);
  }
}

// FEAT045: Tier 1 + Tier 2 brief reactivity
const { getChangelogCount } = require("../src/modules/briefPatcher");
const { shouldRefresh, refreshBriefNarrative, injectRefreshLlm, createRefreshLlmFn } = require("../src/modules/briefRefresher");
const { runDeterministicHygiene, runLlmAudit, injectHygieneAudit, createHygieneAuditFn } = require("../src/modules/dataHygiene");
const { injectSemanticDedup } = require("../src/modules/executor");

// Initialize
setDataRoot(DATA_PATH);
initLlmClient(API_KEY);

// FEAT045: inject Tier 2 Haiku refresh function
const Anthropic = require("@anthropic-ai/sdk");
const _refreshClient = new Anthropic.default({ apiKey: API_KEY });
const _HAIKU_MODEL = process.env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
injectRefreshLlm(createRefreshLlmFn(_refreshClient, _HAIKU_MODEL));

// FEAT047: inject Haiku hygiene audit function
injectHygieneAudit(createHygieneAuditFn(_refreshClient, _HAIKU_MODEL));

// Encryption: derive key from env var if encryption is enabled
// Config is in secure store (not accessible from Node), so we check for the env var
const ENCRYPTION_PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

async function initEncryption() {
  if (ENCRYPTION_PASSPHRASE && ENCRYPTION_SALT) {
    const key = await deriveKey(ENCRYPTION_PASSPHRASE, ENCRYPTION_SALT);
    cacheKey(key);
    setEncryptionEnabled(true);
    console.log("  Encryption: enabled (key derived from ENCRYPTION_PASSPHRASE)");
  } else if (ENCRYPTION_PASSPHRASE && !ENCRYPTION_SALT) {
    console.error("ERROR: ENCRYPTION_PASSPHRASE set but ENCRYPTION_SALT missing in .env");
    process.exit(1);
  }

  // FEAT041: Open libSQL database if lifeos.db exists
  // DB_PATH: local folder for lifeos.db (avoids Google Drive lock conflicts)
  const DB_DIR = process.env.DB_PATH || DATA_PATH;
  if (ENCRYPTION_PASSPHRASE) {
    if (DB_DIR !== DATA_PATH && !fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    // Migrate: if DB exists on DATA_PATH but not on DB_DIR, copy it
    if (DB_DIR !== DATA_PATH) {
      const oldDb = path.join(DATA_PATH, "lifeos.db");
      const newDb = path.join(DB_DIR, "lifeos.db");
      if (fs.existsSync(oldDb) && !fs.existsSync(newDb)) {
        console.log(`  Migrating lifeos.db from ${DATA_PATH} to ${DB_DIR}`);
        fs.copyFileSync(oldDb, newDb);
      }
    }
    const dbPath = path.join(DB_DIR, "lifeos.db");
    if (fs.existsSync(dbPath)) {
      try {
        const { openDatabase } = require("../src/db/index");
        const { setLibsqlMode } = require("../src/modules/loader");
        await openDatabase(dbPath.replace(/\\/g, "/"), ENCRYPTION_PASSPHRASE);
        setLibsqlMode(true);
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
        const { runBackgroundIndex } = require("../src/modules/embeddings/background-indexer");
        runBackgroundIndex().catch((err) =>
          console.warn("  Background indexer error:", err.message)
        );

        // FEAT047: inject semantic dedup for executor
        const { embed } = require("../src/modules/embeddings/provider");
        const { searchSimilar } = require("../src/db/queries/embeddings");
        injectSemanticDedup(async (title, sourceType, limit, maxDist) => {
          const vec = await embed(title);
          if (!vec) return null;
          const matches = await searchSimilar(vec, [sourceType], limit, maxDist);
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

        // FEAT018: Google Calendar integration
        const GCAL_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
        const GCAL_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
        const GCAL_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
        if (GCAL_CLIENT_ID && GCAL_CLIENT_SECRET && GCAL_REFRESH_TOKEN) {
          const { setGoogleOAuthCredentials, setRefreshToken } = require("../src/integrations/google/auth");
          const { setGoogleCalendarConfig } = require("../src/integrations/registry");
          setGoogleOAuthCredentials(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET);
          setRefreshToken(GCAL_REFRESH_TOKEN);
          setGoogleCalendarConfig({ enabled: true });
          console.log("  Google Calendar: enabled");
        }

        console.log("  Database: libSQL mode enabled");
      } catch (err) {
        console.warn("  Database: libSQL open failed, using JSON layer:", err.message);
      }
    }
  }
}

console.log("\n  Chief Clarity — Headless Runner");
console.log(`  Data: ${DATA_PATH}`);
console.log("  Starting scheduler...\n");

// ─── File lock to prevent concurrent writes with the app ──────────────────

const LOCK_FILE = path.join(DATA_PATH, ".headless.lock");

function acquireLock() {
  try {
    // Check if stale lock exists (older than 10 minutes = job crashed)
    if (fs.existsSync(LOCK_FILE)) {
      const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (age > 600000) {
        console.log(`[${ts()}] Removing stale lock (${Math.round(age / 1000)}s old)`);
        fs.unlinkSync(LOCK_FILE);
      } else {
        return false; // another job is running
      }
    }
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n${new Date().toISOString()}`, "utf8");
    return true;
  } catch { return false; }
}

function releaseLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch {}
}

async function withJobLock(name, fn) {
  if (!acquireLock()) {
    console.log(`[${ts()}] Skipping ${name} — another job is running`);
    return;
  }
  try {
    await fn();
  } finally {
    releaseLock();
  }
}

// ─── Job Functions ────────────────────────────────────────────────────────

async function morningJob() {
  return withJobLock("morning", async () => {
  console.log(`[${ts()}] Running morning job...`);
  try {
    const state = await loadState();
    rebuildHotContext(state);
    rebuildContradictionIndex(state);
    updateSummaries(state);
    const today = state.hotContext.today;

    // FEAT018: Google Calendar sync before planning
    if (require("../src/integrations/registry").isGoogleCalendarEnabled()) {
      try {
        const { syncGoogleCalendar } = require("../src/integrations/google/calendar");
        const { getGoogleCalendarConfig } = require("../src/integrations/registry");
        await syncGoogleCalendar(getGoogleCalendarConfig(), state);
      } catch (err) { console.warn(`[${ts()}]   Google Calendar sync failed:`, err.message); }
    }

    // 1. Process inbox (requires LLM — skip if circuit breaker open)
    if (!isCircuitOpen()) {
      const inboxText = await checkInbox();
      if (inboxText) {
        console.log(`[${ts()}]   Processing inbox (${inboxText.length} chars)...`);
        const result = await processInbox(inboxText, state);
        console.log(`[${ts()}]   Inbox: ${result.reply}`);
      }
    }

    // 1b. Process notes batch (FEAT026)
    if (!isCircuitOpen()) {
      const notesResult = await runNotesBatch(state);
      if (notesResult.ran && notesResult.noteCount > 0) {
        console.log(`[${ts()}]   Notes: ${notesResult.reply}`);
      }
    }

    // 2. Calendar hygiene (archive past events, clean up)
    const calHygieneResult = runDailyHygiene(state);
    if (calHygieneResult.archived > 0) {
      console.log(`[${ts()}]   Calendar hygiene: archived ${calHygieneResult.archived} event(s)`);
      await flush(state);
    }

    // 3. Process recurring tasks
    const recurringCreated = processRecurringTasks(state, today);
    if (recurringCreated > 0) {
      console.log(`[${ts()}]   Created ${recurringCreated} recurring task instance(s)`);
      // Flush the new tasks/events to disk
      await flush(state);
    }

    // 3. FEAT047: Data hygiene before plan generation — clean data = better plan
    const hygieneResult = runDeterministicHygiene(state);
    if (hygieneResult.undatedArchived + hygieneResult.recurringCalendarDeduped + hygieneResult.taskExactDeduped + hygieneResult.staleParkedDeferred + hygieneResult.pastDueRecurringArchived > 0) {
      await flush(state);
      console.log(`[${ts()}]   ${hygieneResult.summary}`);
    }

    // 4. Generate day plan
    console.log(`[${ts()}]   Generating day plan...`);
    await generatePlan("day", state);

    // 3. Proactive checks
    console.log(`[${ts()}]   Running proactive checks...`);
    const nowHour = getUserHour(_userTz);
    const nudges = await runProactiveChecks(state, today, nowHour);
    await writeNudges(nudges);
    console.log(`[${ts()}]   Created ${nudges.length} nudge(s)`);

    // Log summary to chat
    const parts = [`Generated your day plan for ${today}.`];
    if (recurringCreated > 0) parts.push(`Created ${recurringCreated} recurring task(s).`);
    if (calHygieneResult.archived > 0) parts.push(`Archived ${calHygieneResult.archived} past event(s).`);
    if (hygieneResult.summary !== "Data hygiene: all clean.") parts.push(hygieneResult.summary);
    if (nudges.length > 0) parts.push(`${nudges.length} new nudge(s) for you.`);
    await logToChat(parts.join(" "));

    console.log(`[${ts()}] Morning job complete.\n`);
  } catch (err) {
    console.error(`[${ts()}] Morning job failed:`, err.message);
    await logToChat(`Morning job failed: ${err.message}`);
  }
  }); // withJobLock
}

async function halfDayJob() {
  return withJobLock("halfday", async () => {
  console.log(`[${ts()}] Running half-day job...`);
  try {
    const state = await loadState();
    rebuildHotContext(state);
    updateSummaries(state);

    // Tier 2 narrative refresh — not a Sonnet replan.
    // Picks up patches accumulated since the morning Sonnet plan.
    if (shouldRefresh(state) && !isCircuitOpen()) {
      const patchCount = getChangelogCount(state);
      console.log(`[${ts()}]   Running Tier 2 narrative refresh (${patchCount} patches)...`);
      const ok = await refreshBriefNarrative(state);
      if (ok) {
        await flush(state);
        if (state.focusBrief?.id) {
          try {
            await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
            console.log(`[${ts()}]   focus_brief.html updated`);
          } catch (err) { console.warn(`[${ts()}]   HTML render failed:`, err.message); }
        }
        console.log(`[${ts()}]   Tier 2 refresh applied`);
      } else {
        console.log(`[${ts()}]   Tier 2 refresh skipped (no LLM function or no brief)`);
      }
    } else {
      console.log(`[${ts()}]   No patches to refresh`);
    }

    // Proactive checks
    const today = state.hotContext.today;
    const nudges = await runProactiveChecks(state, today, 12);
    await writeNudges(nudges);
    if (nudges.length > 0) console.log(`[${ts()}]   Created ${nudges.length} nudge(s)`);

    // Log summary to chat
    const parts = ["Half-day check completed."];
    if (shouldRefresh(state) && !isCircuitOpen()) parts.push("Refreshed the focus brief narrative.");
    if (nudges.length > 0) parts.push(`${nudges.length} new nudge(s).`);
    await logToChat(parts.join(" "));

    console.log(`[${ts()}] Half-day job complete.\n`);
  } catch (err) {
    console.error(`[${ts()}] Half-day job failed:`, err.message);
    await logToChat(`Half-day job failed: ${err.message}`);
  }
  }); // withJobLock
}

async function weeklyJob() {
  return withJobLock("weekly", async () => {
  console.log(`[${ts()}] Running weekly job...`);
  try {
    const state = await loadState();
    rebuildHotContext(state);
    rebuildContradictionIndex(state);
    updateSummaries(state);

    // Weekly calendar deep cleanup
    const weeklyHygiene = runWeeklyHygiene(state);
    if (weeklyHygiene.archived > 0 || weeklyHygiene.duplicatesRemoved > 0) {
      console.log(`[${ts()}]   Weekly hygiene: archived ${weeklyHygiene.archived}, removed ${weeklyHygiene.duplicatesRemoved} duplicates`);
      await flush(state);
      rebuildContradictionIndex(state);
    }

    // FEAT047: Full data hygiene (Tier 1 + Tier 2 Haiku audit) before week plan
    console.log(`[${ts()}]   Running data hygiene (Tier 1 + 2)...`);
    const weeklyHygieneData = await runLlmAudit(state);
    if (weeklyHygieneData.summary !== "Data hygiene: all clean.") {
      await flush(state);
      console.log(`[${ts()}]   ${weeklyHygieneData.summary}`);
      if (weeklyHygieneData.llmSuggestions.length > 0) {
        await logToChat(`Weekly data audit suggestions:\n${weeklyHygieneData.llmSuggestions.map(s => "- " + s).join("\n")}`);
      }
    }

    // Process recurring tasks for each day in the week range so instances exist
    // as actual tasks/events before the LLM sees them. Without this, only today's
    // recurring instances exist and the week plan ignores Tue/Thu/Fri commitments.
    {
      const today = state.hotContext.today;
      const base = new Date(today + "T12:00:00");
      let weekRecCreated = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        weekRecCreated += processRecurringTasks(state, dateStr);
      }
      if (weekRecCreated > 0) {
        console.log(`[${ts()}]   Created ${weekRecCreated} recurring instance(s) for the week`);
        await flush(state);
      }
    }

    // Generate week plan
    console.log(`[${ts()}]   Generating week plan...`);
    await generatePlan("week", state);

    await logToChat(`Generated your week plan. Cleaned up ${weeklyHygiene.archived} archived event(s), ${weeklyHygiene.duplicatesRemoved} duplicate(s).`);

    console.log(`[${ts()}] Weekly job complete.\n`);
  } catch (err) {
    console.error(`[${ts()}] Weekly job failed:`, err.message);
    await logToChat(`Weekly job failed: ${err.message}`);
  }
  }); // withJobLock
}

async function lightCheck() {
  return withJobLock("light-check", async () => {
  console.log(`[${ts()}] Running light check...`);
  try {
    const state = await loadState();
    rebuildHotContext(state);
    updateSummaries(state);

    // FEAT018: Google Calendar sync
    if (require("../src/integrations/registry").isGoogleCalendarEnabled()) {
      try {
        const { syncGoogleCalendar } = require("../src/integrations/google/calendar");
        const { getGoogleCalendarConfig } = require("../src/integrations/registry");
        await syncGoogleCalendar(getGoogleCalendarConfig(), state);
      } catch (err) { console.warn(`[${ts()}]   Google Calendar sync failed:`, err.message); }
    }

    // Process inbox (requires LLM — skip if circuit breaker open)
    if (!isCircuitOpen()) {
      const inboxText = await checkInbox();
      if (inboxText) {
        console.log(`[${ts()}]   Processing inbox...`);
        const result = await processInbox(inboxText, state);
        console.log(`[${ts()}]   Inbox: ${result.reply}`);
      }
    }

    // Process notes batch (FEAT026) — every 4h alongside inbox
    if (!isCircuitOpen()) {
      const notesResult = await runNotesBatch(state);
      if (notesResult.ran && notesResult.noteCount > 0) {
        console.log(`[${ts()}]   Notes: ${notesResult.reply}`);
      }
    }

    // FEAT045: Tier 2 narrative refresh if patches accumulated from inbox/notes
    if (shouldRefresh(state) && !isCircuitOpen()) {
      const patchCount = getChangelogCount(state);
      console.log(`[${ts()}]   Tier 2 narrative refresh (${patchCount} patches)...`);
      const ok = await refreshBriefNarrative(state);
      if (ok) {
        await flush(state);
        if (state.focusBrief?.id) {
          try {
            await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
          } catch {}
        }
        console.log(`[${ts()}]   Tier 2 refresh applied`);
      }
    }

    // Proactive checks
    const today = state.hotContext.today;
    const nowHour = getUserHour(_userTz);
    const nudges = await runProactiveChecks(state, today, nowHour);
    await writeNudges(nudges);
    if (nudges.length > 0) console.log(`[${ts()}]   ${nudges.length} new nudge(s)`);

    // Only log to chat if something meaningful happened
    const didSomething = nudges.length > 0;
    if (didSomething) {
      await logToChat(`Light check: ${nudges.length} new nudge(s).`);
    }

    console.log(`[${ts()}] Light check complete.\n`);
  } catch (err) {
    console.error(`[${ts()}] Light check failed:`, err.message);
  }
  }); // withJobLock
}

async function generatePlan(variant, state) {
  if (isCircuitOpen()) {
    const status = getCircuitBreakerStatus();
    console.warn(`[${ts()}]   Circuit breaker OPEN — skipping plan generation. ${status.failures} failures, resets in ${status.cooldownMinutes}m. Last: ${status.lastError}`);
    return;
  }
  const { TOKEN_BUDGETS } = require("../src/modules/router");

  // Load unresolved annotations into state for the assembler
  const anns = await getUnresolvedAnnotations();
  state._annotations = anns;

  const intent = {
    type: "full_planning",
    tokenBudget: TOKEN_BUDGETS.full_planning,
    phrase: variant === "week" ? "Plan my week" : variant === "tomorrow" ? "Prepare tomorrow" : "Plan my day",
  };

  const context = await assembleContext(intent, intent.phrase, state, []);
  const plan = await callLlm(context, "full_planning");

  if (!plan) {
    console.log(`[${ts()}]   Plan generation returned no result`);
    return;
  }

  if (plan.writes.length > 0) {
    await applyWrites(plan, state);
    updateSummaries(state);
    rebuildHotContext(state);
    rebuildContradictionIndex(state);
  }

  // Render HTML
  if (state.focusBrief?.id) {
    try {
      await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
      console.log(`[${ts()}]   focus_brief.html written`);
    } catch (err) {
      console.error(`[${ts()}]   HTML render failed:`, err.message);
    }
  }

  // Only resolve annotations if LLM produced a focusBrief write (proof it processed planning)
  if (anns.length > 0 && plan.writes.some((w) => w.file === "focusBrief")) {
    await resolveAnnotations(anns.map((a) => a.id), "llm");
    console.log(`[${ts()}]   Resolved ${anns.length} annotation(s)`);
  }
}

// ─── Schedule ─────────────────────────────────────────────────────────────

// Read wake time from user lifestyle (default 05:30)
async function getScheduleConfig() {
  const state = await loadState();
  _userTz = state.userProfile?.timezone || undefined;
  if (_userTz) setDefaultTimezone(_userTz);
  const wake = state.userLifestyle?.sleepWake?.wake || "05:30";
  const [wakeH, wakeM] = wake.split(":").map(Number);
  const weekStart = (state.userLifestyle?.weekStartsOn || "sunday").toLowerCase();
  const weekDay = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }[weekStart] ?? 0;
  return { wakeH, wakeM, weekDay };
}

// Track active cron tasks so we can stop them on reload
let activeCronTasks = [];
let lastScheduleHash = "";

function scheduleHash(config) {
  return `${config.wakeH}:${config.wakeM}:${config.weekDay}`;
}

async function setupSchedule() {
  const config = await getScheduleConfig();
  const hash = scheduleHash(config);

  // Skip if schedule hasn't changed
  if (hash === lastScheduleHash && activeCronTasks.length > 0) return;

  // Stop existing cron tasks
  for (const task of activeCronTasks) task.stop();
  activeCronTasks = [];

  if (lastScheduleHash) {
    console.log(`\n[${ts()}] Schedule changed (${lastScheduleHash} -> ${hash}), rescheduling...`);
  }
  lastScheduleHash = hash;

  const { wakeH, wakeM, weekDay } = config;

  const cronOpts = _userTz ? { timezone: _userTz } : {};

  // Morning job: daily at wake time
  activeCronTasks.push(cron.schedule(`${wakeM} ${wakeH} * * *`, morningJob, cronOpts));
  console.log(`  Morning job: ${pad(wakeH)}:${pad(wakeM)} daily (${_userTz || "system tz"})`);

  // Half-day job: daily at 12:00
  activeCronTasks.push(cron.schedule("0 12 * * *", halfDayJob, cronOpts));
  console.log("  Half-day job: 12:00 daily");

  // Weekly job: on weekStartsOn day at 20:00 (evening before the week begins)
  activeCronTasks.push(cron.schedule(`0 20 * * ${weekDay}`, weeklyJob, cronOpts));
  console.log(`  Weekly job: 20:00 on ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekDay]}`);

  // Light check: every 4 hours (6, 10, 14, 18)
  activeCronTasks.push(cron.schedule("0 6,10,14,18 * * *", lightCheck, cronOpts));
  console.log("  Light check: every 4 hours (06, 10, 14, 18)");
}

async function startScheduler() {
  await initEncryption();
  await setupSchedule();

  // Hot-reload + missed job recovery: every hour
  setInterval(async () => {
    try {
      await setupSchedule();

      // Safety net: if today's plan was missed (cron didn't fire), run it now
      if (isCircuitOpen()) {
        const status = getCircuitBreakerStatus();
        console.warn(`[${ts()}] Circuit breaker OPEN — skipping missed job recovery. Resets in ${status.cooldownMinutes}m.`);
      } else {
        const state = await loadState();
        rebuildHotContext(state);
        const today = state.hotContext.today;
        const briefDate = state.focusBrief?.generatedAt?.slice(0, 10) || "";
        if (briefDate !== today) {
          console.log(`[${ts()}] Missed morning job detected (brief: ${briefDate}, today: ${today}) — running now`);
          await morningJob();
        }
      }
    } catch (err) {
      console.error(`[${ts()}] Hourly check failed:`, err.message);
    }
  }, 1800000); // 30 minutes

  // Start DB backup to cloud folder (every 6 hours)
  const _DB_BACKUP_DIR = process.env.DB_PATH || DATA_PATH;
  if (_DB_BACKUP_DIR && DATA_PATH && _DB_BACKUP_DIR !== DATA_PATH) {
    const { startBackupInterval } = require("./db-backup");
    startBackupInterval({ dbDir: _DB_BACKUP_DIR, backupDir: DATA_PATH });
  }

  console.log("\n  Scheduler running. Hot-reload every hour. Press Ctrl+C to stop.\n");

  // On startup: run light check + generate today's plan if stale
  console.log("  Running initial check...\n");
  await lightCheck();

  // If today's plan is missing or stale, generate it now (we may have missed the morning cron)
  try {
    const state = await loadState();
    rebuildHotContext(state);
    const today = state.hotContext.today;
    const briefDate = state.focusBrief?.generatedAt?.slice(0, 10) || "";
    if (briefDate !== today) {
      console.log(`\n  Brief is stale (${briefDate || "none"} vs ${today}) — generating day plan...\n`);
      await morningJob();
    } else {
      console.log(`  Brief is current (${today}). No plan needed.\n`);
    }
  } catch (err) {
    console.error("  Initial plan check failed:", err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: _userTz || undefined });
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// ─── Start ────────────────────────────────────────────────────────────────

startScheduler().catch((err) => {
  console.error("Failed to start scheduler:", err);
  process.exit(1);
});
