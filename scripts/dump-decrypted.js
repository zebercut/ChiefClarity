#!/usr/bin/env node
/**
 * Decrypt all LifeOS JSON data files and dump them as plaintext JSON
 * to a local folder for inspection.
 *
 * Usage:  node scripts/dump-decrypted.js
 * Output: ./decrypted-dump/ (gitignored)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Load .env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DATA_PATH = process.env.DATA_FOLDER_PATH;
const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
const SALT_HEX = process.env.ENCRYPTION_SALT;

if (!DATA_PATH || !PASSPHRASE || !SALT_HEX) {
  console.error("Missing DATA_FOLDER_PATH, ENCRYPTION_PASSPHRASE, or ENCRYPTION_SALT in .env");
  process.exit(1);
}

const OUTPUT_DIR = path.join(__dirname, "..", "decrypted-dump");

// Crypto constants (match crypto.ts)
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 600_000;

// Derive key
console.log("Deriving key (600k PBKDF2 iterations)...");
const salt = Buffer.from(SALT_HEX, "hex");
const key = crypto.pbkdf2Sync(PASSPHRASE, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
console.log("Key derived.");

function isEncryptedBuffer(buf) {
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return false;
  const first = buf[0];
  if (first === 0x7b || first === 0x5b) return false; // { or [
  if (first === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return false; // UTF-8 BOM
  return true;
}

function decryptBuffer(buf) {
  const iv = buf.slice(0, IV_LENGTH);
  const authTag = buf.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.slice(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// All files to dump (no .bak files)
const FILES = [
  "tasks.json",
  "calendar.json",
  "notes.json",
  "recurring_tasks.json",
  "context_memory.json",
  "feedback_memory.json",
  "user_profile.json",
  "user_lifestyle.json",
  "user_observations.json",
  "suggestions_log.json",
  "learning_log.json",
  "chat_history.json",
  "hot_context.json",
  "summaries.json",
  "content_index.json",
  "contradiction_index.json",
  "focus_brief.json",
  "annotations.json",
  "nudges.json",
  "proactive_state.json",
  "tips_state.json",
  "_vault.json",
  "plan/plan_narrative.json",
  "plan/plan_agenda.json",
  "plan/plan_risks.json",
  "plan/plan_okr_dashboard.json",
  "topics/_manifest.json",
];

// Create output dir
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, "plan"), { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, "topics"), { recursive: true });

let success = 0;
let skipped = 0;
let failed = 0;

for (const file of FILES) {
  const src = path.join(DATA_PATH, file);
  const dst = path.join(OUTPUT_DIR, file);

  if (!fs.existsSync(src)) {
    console.log(`  SKIP  ${file} (not found)`);
    skipped++;
    continue;
  }

  try {
    const raw = fs.readFileSync(src);
    let content;

    if (isEncryptedBuffer(raw)) {
      content = decryptBuffer(raw);
      // Pretty-print JSON
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        // Not JSON, keep as-is
      }
      console.log(`  OK    ${file} (decrypted)`);
    } else {
      // Already plaintext
      try {
        const parsed = JSON.parse(raw.toString("utf8"));
        content = JSON.stringify(parsed, null, 2);
      } catch {
        content = raw.toString("utf8");
      }
      console.log(`  OK    ${file} (plaintext)`);
    }

    fs.writeFileSync(dst, content, "utf8");
    success++;
  } catch (err) {
    console.log(`  FAIL  ${file}: ${err.message}`);
    failed++;
  }
}

// Also dump topic .md files
const topicsDir = path.join(DATA_PATH, "topics");
if (fs.existsSync(topicsDir)) {
  const topicFiles = fs.readdirSync(topicsDir).filter(f => f.endsWith(".md"));
  for (const tf of topicFiles) {
    const src = path.join(topicsDir, tf);
    const dst = path.join(OUTPUT_DIR, "topics", tf);
    fs.copyFileSync(src, dst);
    console.log(`  OK    topics/${tf} (copied)`);
    success++;
  }
}

// Dump inbox.txt if exists
const inboxSrc = path.join(DATA_PATH, "inbox.txt");
if (fs.existsSync(inboxSrc)) {
  fs.copyFileSync(inboxSrc, path.join(OUTPUT_DIR, "inbox.txt"));
  console.log(`  OK    inbox.txt (copied)`);
  success++;
}

console.log(`\nDone: ${success} dumped, ${skipped} skipped, ${failed} failed`);
console.log(`Output: ${OUTPUT_DIR}`);
