/**
 * Encryption migration script.
 *
 * Encrypts or decrypts all sensitive data files in the data folder.
 * Idempotent: skips files already in the target state.
 * Tracks progress in .migration-state.json for crash recovery.
 *
 * Usage:
 *   npx ts-node scripts/migrate-encryption.ts --encrypt --passphrase="..." --salt="hex..."
 *   npx ts-node scripts/migrate-encryption.ts --decrypt --passphrase="..." --salt="hex..."
 *
 * Or with env vars:
 *   ENCRYPTION_PASSPHRASE=... ENCRYPTION_SALT=... npx ts-node scripts/migrate-encryption.ts --encrypt
 */

import * as fs from "fs";
import * as path from "path";
import {
  deriveKey,
  encrypt,
  decrypt,
  isEncryptedBuffer,
  isSensitiveFile,
} from "../src/utils/crypto";

// --- Parse args ---
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
let direction: "encrypt" | "decrypt" | null = null;

for (const arg of args) {
  if (arg === "--encrypt") direction = "encrypt";
  else if (arg === "--decrypt") direction = "decrypt";
  else if (arg.startsWith("--")) {
    const [k, v] = arg.slice(2).split("=");
    flags[k] = v || "";
  }
}

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const passphrase = flags.passphrase || process.env.ENCRYPTION_PASSPHRASE;
const salt = flags.salt || process.env.ENCRYPTION_SALT;
const dataPath = flags.dir || process.env.DATA_FOLDER_PATH;

if (!direction) {
  console.error("Usage: migrate-encryption.ts --encrypt|--decrypt [--passphrase=... --salt=... --dir=...]");
  process.exit(1);
}
if (!passphrase) {
  console.error("ERROR: passphrase required (--passphrase=... or ENCRYPTION_PASSPHRASE env var)");
  process.exit(1);
}
if (!salt) {
  console.error("ERROR: salt required (--salt=... or ENCRYPTION_SALT env var)");
  process.exit(1);
}
if (!dataPath) {
  console.error("ERROR: data folder required (--dir=... or DATA_FOLDER_PATH env var)");
  process.exit(1);
}

const resolvedDataPath = path.resolve(dataPath);
const MIGRATION_STATE_FILE = path.join(resolvedDataPath, ".migration-state.json");

interface MigrationState {
  direction: "encrypt" | "decrypt";
  startedAt: string;
  completed: string[];
}

function loadMigrationState(): MigrationState | null {
  try {
    if (fs.existsSync(MIGRATION_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(MIGRATION_STATE_FILE, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

function saveMigrationState(state: MigrationState): void {
  fs.writeFileSync(MIGRATION_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function removeMigrationState(): void {
  try { fs.unlinkSync(MIGRATION_STATE_FILE); } catch { /* ignore */ }
}

/** Collect all sensitive files relative to dataPath. */
function collectSensitiveFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string, prefix: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (isSensitiveFile(rel)) {
        files.push(rel);
      }
    }
  }

  walk(resolvedDataPath, "");
  return files;
}

async function main() {
  console.log(`\nEncryption migration: ${direction}`);
  console.log(`Data folder: ${resolvedDataPath}\n`);

  const key = await deriveKey(passphrase!, salt!);

  // Check for interrupted migration
  const existing = loadMigrationState();
  if (existing && existing.direction !== direction) {
    console.error(`ERROR: Previous ${existing.direction} migration was interrupted. Complete it first or delete ${MIGRATION_STATE_FILE}`);
    process.exit(1);
  }

  const completedSet = new Set(existing?.completed || []);
  const state: MigrationState = {
    direction: direction!,
    startedAt: existing?.startedAt || new Date().toISOString(),
    completed: [...completedSet],
  };
  saveMigrationState(state);

  const files = collectSensitiveFiles();
  console.log(`Found ${files.length} sensitive file(s)\n`);

  let migrated = 0;
  let skipped = 0;

  for (const rel of files) {
    if (completedSet.has(rel)) {
      skipped++;
      continue;
    }

    const fullPath = path.join(resolvedDataPath, rel);
    if (!fs.existsSync(fullPath)) {
      skipped++;
      continue;
    }

    const raw = fs.readFileSync(fullPath);
    const bytes = new Uint8Array(raw);
    const isEncrypted = isEncryptedBuffer(bytes);

    if (direction === "encrypt" && isEncrypted) {
      console.log(`  SKIP (already encrypted): ${rel}`);
      skipped++;
    } else if (direction === "decrypt" && !isEncrypted) {
      console.log(`  SKIP (already plaintext): ${rel}`);
      skipped++;
    } else if (direction === "encrypt") {
      const plaintext = raw.toString("utf8");
      const encrypted = await encrypt(key, plaintext);
      // Atomic write
      const tmpPath = fullPath + ".tmp";
      fs.writeFileSync(tmpPath, Buffer.from(encrypted));
      fs.renameSync(tmpPath, fullPath);
      console.log(`  ENCRYPTED: ${rel}`);
      migrated++;
    } else {
      const plaintext = await decrypt(key, bytes);
      const tmpPath = fullPath + ".tmp";
      fs.writeFileSync(tmpPath, plaintext, "utf8");
      fs.renameSync(tmpPath, fullPath);
      console.log(`  DECRYPTED: ${rel}`);
      migrated++;
    }

    // Track progress
    state.completed.push(rel);
    saveMigrationState(state);
  }

  // Clean up migration state on success
  removeMigrationState();

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped\n`);
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
