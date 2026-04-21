/**
 * Restore database from Google Drive backup.
 *
 * Usage: node scripts/restore-db.js
 *
 * Copies lifeos_backup.db from DATA_FOLDER_PATH (cloud) to DB_PATH (local).
 * Requires the app to be stopped first.
 */

const fs = require("fs");
const path = require("path");
const { BACKUP_FILENAME } = require("./db-backup");

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

if (!dataDir) { console.error("ERROR: DATA_FOLDER_PATH not set in .env"); process.exit(1); }
if (!dbDir) { console.error("ERROR: DB_PATH not set in .env"); process.exit(1); }

const backupPath = path.join(dataDir, BACKUP_FILENAME);
const targetPath = path.join(dbDir, "lifeos.db");

if (!fs.existsSync(backupPath)) {
  console.error(`ERROR: No backup found at ${backupPath}`);
  console.error("Make sure the backup file exists on Google Drive and the drive is synced.");
  process.exit(1);
}

const backupStat = fs.statSync(backupPath);
const sizeKb = Math.round(backupStat.size / 1024);
const backupDate = backupStat.mtime.toLocaleString();

console.log(`\nRestore Database`);
console.log(`================\n`);
console.log(`Backup:  ${backupPath}`);
console.log(`  Size:  ${sizeKb} KB`);
console.log(`  Date:  ${backupDate}`);
console.log(`Target:  ${targetPath}\n`);

// Check if target exists
if (fs.existsSync(targetPath)) {
  const targetStat = fs.statSync(targetPath);
  const targetDate = targetStat.mtime.toLocaleString();
  console.log(`WARNING: Existing database will be overwritten.`);
  console.log(`  Current DB date: ${targetDate}\n`);
}

// Ensure target directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Copy with temp file for safety
const tempPath = targetPath + ".restoring";
try {
  fs.copyFileSync(backupPath, tempPath);
  // If target exists, rename it as .old first
  if (fs.existsSync(targetPath)) {
    fs.renameSync(targetPath, targetPath + ".old");
  }
  fs.renameSync(tempPath, targetPath);
  // Remove .old if restore succeeded
  try { fs.unlinkSync(targetPath + ".old"); } catch {}

  console.log("Restore complete. Start the app or proxy to continue.");
} catch (err) {
  // Rollback: if .old exists, restore it
  try {
    if (fs.existsSync(targetPath + ".old")) {
      fs.renameSync(targetPath + ".old", targetPath);
    }
  } catch {}
  try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  console.error(`Restore failed: ${err.message}`);
  process.exit(1);
}
