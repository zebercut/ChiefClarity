/**
 * Test FEAT047 Tier 1 hygiene against live data.
 * Usage: node scripts/test-hygiene.js
 */
const path = require("path");
const fs = require("fs");
const envPath = path.join(__dirname, "..", ".env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true, jsx: "react" } });
const { deriveKey, cacheKey, setEncryptionEnabled } = require("../src/utils/crypto");
const { setDataRoot } = require("../src/utils/filesystem");
setDataRoot(process.env.DATA_FOLDER_PATH);

(async () => {
  const key = await deriveKey(process.env.ENCRYPTION_PASSPHRASE, process.env.ENCRYPTION_SALT);
  cacheKey(key); setEncryptionEnabled(true);
  const dbDir = process.env.DB_PATH || process.env.DATA_FOLDER_PATH;
  const dbPath = path.join(dbDir, "lifeos.db").replace(/\\/g, "/");
  await require("../src/db/index").openDatabase(dbPath, process.env.ENCRYPTION_PASSPHRASE);
  const L = require("../src/modules/loader"); L.setLibsqlMode(true);
  L.injectDbFunctions({ loadStateFromDb: require("../src/db/queries/state-bridge").loadStateFromDb, flushToDb: require("../src/db/flush").flushToDb });
  const state = await L.loadState();
  require("../src/modules/summarizer").rebuildHotContext(state);

  // DRY RUN — don't actually flush, just report what would be cleaned
  const { runDeterministicHygiene } = require("../src/modules/dataHygiene");
  const result = runDeterministicHygiene(state);
  console.log("\n=== Tier 1 Hygiene Results (dry run) ===");
  console.log("  Undated events archived:", result.undatedArchived);
  console.log("  Recurring/calendar deduped:", result.recurringCalendarDeduped);
  console.log("  Exact duplicate tasks:", result.taskExactDeduped);
  console.log("  Stale parked deferred:", result.staleParkedDeferred);
  console.log("  Past-due recurring archived:", result.pastDueRecurringArchived);
  console.log("\n  Summary:", result.summary);

  // Don't flush — this is a dry run
  console.log("\n(Dry run — no changes persisted)");
  process.exit(0);
})();
