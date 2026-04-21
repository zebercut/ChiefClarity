/**
 * One-shot: generate today's plan and update the brief.
 * Usage: node scripts/run-plan.js
 */
const path = require("path");
const fs = require("fs");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true, jsx: "react" } });

const { deriveKey, cacheKey, setEncryptionEnabled } = require("../src/utils/crypto");
const { setDataRoot } = require("../src/utils/filesystem");
const { initLlmClient, callLlm } = require("../src/modules/llm");

setDataRoot(process.env.DATA_FOLDER_PATH);
initLlmClient(process.env.ANTHROPIC_API_KEY);

(async () => {
  // Encryption + DB
  const key = await deriveKey(process.env.ENCRYPTION_PASSPHRASE, process.env.ENCRYPTION_SALT);
  cacheKey(key);
  setEncryptionEnabled(true);

  const dbDir = process.env.DB_PATH || process.env.DATA_FOLDER_PATH;
  const dbPath = path.join(dbDir, "lifeos.db").replace(/\\/g, "/");
  await require("../src/db/index").openDatabase(dbPath, process.env.ENCRYPTION_PASSPHRASE);

  const L = require("../src/modules/loader");
  L.setLibsqlMode(true);
  L.injectDbFunctions({
    loadStateFromDb: require("../src/db/queries/state-bridge").loadStateFromDb,
    flushToDb: require("../src/db/flush").flushToDb,
  });

  const state = await L.loadState();
  const { rebuildHotContext, updateSummaries, rebuildContradictionIndex } = require("../src/modules/summarizer");
  rebuildHotContext(state);
  rebuildContradictionIndex(state);
  updateSummaries(state);

  // Assemble + call LLM
  const { assembleContext } = require("../src/modules/assembler");
  const { TOKEN_BUDGETS } = require("../src/modules/router");
  const intent = { type: "full_planning", tokenBudget: TOKEN_BUDGETS.full_planning, phrase: "Plan my day" };

  console.log("Assembling context...");
  const context = await assembleContext(intent, "Plan my day", state, []);
  console.log("  Events:", (context.calendarEvents || []).length);
  console.log("  Tasks:", (context.tasksFull || []).length);
  console.log("  Replan:", !!context.replanMode);

  console.log("Calling Sonnet...");
  const plan = await callLlm(context, "full_planning");
  if (!plan) { console.error("LLM returned no plan"); process.exit(1); }
  console.log("Plan received. Writes:", plan.writes.length);
  console.log("Reply:", plan.reply);

  // Apply
  const { applyWrites } = require("../src/modules/executor");
  if (plan.writes.length > 0) {
    await applyWrites(plan, state);
    updateSummaries(state);
    rebuildHotContext(state);
  }

  // Render HTML
  if (state.focusBrief && state.focusBrief.id) {
    const { renderBriefToHtml } = require("../src/modules/briefRenderer");
    await renderBriefToHtml(state.focusBrief, state.userProfile?.timezone);
    console.log("focus_brief.html updated");
  }

  // Log to chat
  const { loadChatHistory, saveChatHistory } = require("../src/modules/chatHistory");
  const msgs = await loadChatHistory();
  const { nowTimeStr, setDefaultTimezone } = require("../src/utils/dates");
  const tz = state.userProfile?.timezone;
  if (tz) setDefaultTimezone(tz);
  msgs.push({ role: "assistant", content: plan.reply || "Day plan updated.", timestamp: nowTimeStr(tz) });
  await saveChatHistory(msgs);

  console.log("Done!");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
