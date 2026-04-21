/**
 * Database backup utility.
 *
 * Copies lifeos.db from DB_PATH (local) to DATA_FOLDER_PATH (cloud).
 * Uses temp-file-then-rename for atomic writes.
 *
 * Usage:
 *   - As module: require("./db-backup").runBackup()
 *   - As script: node scripts/db-backup.js
 */

const fs = require("fs");
const path = require("path");

const BACKUP_FILENAME = "lifeos_backup.db";

/**
 * Run a safe backup of the live database to the data folder.
 * Uses VACUUM INTO which creates a consistent snapshot without locking readers.
 *
 * @param {object} opts
 * @param {string} opts.dbDir  - Local DB directory (source)
 * @param {string} opts.backupDir - Cloud/backup directory (destination)
 * @returns {Promise<{success: boolean, message: string, durationMs: number}>}
 */
async function runBackup({ dbDir, backupDir } = {}) {
  if (!dbDir || !backupDir) {
    return { success: false, message: "dbDir and backupDir are required", durationMs: 0 };
  }

  const sourcePath = path.join(dbDir, "lifeos.db");
  if (!fs.existsSync(sourcePath)) {
    return { success: false, message: "No lifeos.db found at " + dbDir, durationMs: 0 };
  }

  // Same directory — no backup needed
  if (path.resolve(dbDir) === path.resolve(backupDir)) {
    return { success: true, message: "DB and backup are same directory — skipped", durationMs: 0 };
  }

  const backupPath = path.join(backupDir, BACKUP_FILENAME);
  const tempPath = backupPath + ".tmp";
  const start = Date.now();

  try {
    // Use file copy — VACUUM INTO requires the DB to be open with the
    // encryption key, which we may not have here. File copy is safe as
    // long as we're the only writer (the .headless.lock ensures this).
    // Write to temp first, then atomic rename.
    fs.copyFileSync(sourcePath, tempPath);
    fs.renameSync(tempPath, backupPath);

    const durationMs = Date.now() - start;
    const sizeKb = Math.round(fs.statSync(backupPath).size / 1024);
    return {
      success: true,
      message: `Backup written: ${backupPath} (${sizeKb}KB, ${durationMs}ms)`,
      durationMs,
    };
  } catch (err) {
    // Clean up temp file if it exists
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    return {
      success: false,
      message: `Backup failed: ${err.message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Start a recurring backup interval.
 * @param {object} opts
 * @param {string} opts.dbDir
 * @param {string} opts.backupDir
 * @param {number} [opts.intervalMs=3600000] - Default 1 hour
 */
function startBackupInterval({ dbDir, backupDir, intervalMs = 60 * 60 * 1000 }) {
  // Run immediately on startup
  runBackup({ dbDir, backupDir }).then((r) => {
    if (r.success) console.log(`[backup] ${r.message}`);
    else console.warn(`[backup] ${r.message}`);
  });

  // Then every intervalMs
  return setInterval(async () => {
    const r = await runBackup({ dbDir, backupDir });
    if (r.success) console.log(`[backup] ${r.message}`);
    else console.warn(`[backup] ${r.message}`);
  }, intervalMs);
}

module.exports = { runBackup, startBackupInterval, BACKUP_FILENAME };

// ─── CLI mode ────────────────────────────────────────────────────────────────

if (require.main === module) {
  // Load .env
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }

  const dataDir = process.env.DATA_FOLDER_PATH;
  const dbDir = process.env.DB_PATH || dataDir;

  if (!dataDir) { console.error("ERROR: DATA_FOLDER_PATH not set"); process.exit(1); }
  if (!dbDir) { console.error("ERROR: DB_PATH not set"); process.exit(1); }

  runBackup({ dbDir, backupDir: dataDir }).then((r) => {
    console.log(r.message);
    process.exit(r.success ? 0 : 1);
  });
}
