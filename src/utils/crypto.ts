/**
 * Encryption at rest — AES-256-GCM with PBKDF2 key derivation.
 *
 * Platform strategy:
 *   Node (headless/proxy): native `crypto` module (sync)
 *   Web/Electron/Capacitor: WebCrypto API (async)
 *
 * File format: [iv:12 bytes][authTag:16 bytes][ciphertext:variable]
 * Key derivation: PBKDF2-SHA512, 600,000 iterations
 * Salt: single random 16-byte value stored in AppConfig (not per-file)
 * IV: random 12 bytes per write (prepended to ciphertext)
 */

import { isNode as _isNode } from "./platform";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 600_000;
const ALGORITHM = "aes-256-gcm";

// --- Module-level state (never written to disk) ---
let _encryptionEnabled = false;
let _cachedKey: Uint8Array | null = null;
let _cachedCryptoKey: CryptoKey | null = null; // for WebCrypto platforms

/** Set the encryption-enabled flag. Called once at app startup from config. */
export function setEncryptionEnabled(enabled: boolean): void {
  _encryptionEnabled = enabled;
}

/**
 * True if encryption is *configured* for this install (regardless of whether
 * the key is currently cached). Use this when deciding "should this file be
 * encrypted at write time?" — combined with a hard check that the key is
 * actually ready, otherwise you'd silently write plaintext over encrypted data.
 */
export function isEncryptionConfigured(): boolean {
  return _encryptionEnabled;
}

/**
 * True if encryption is configured AND the key is currently cached and ready
 * to encrypt/decrypt. Use this for guards that need both conditions.
 */
export function isEncryptionReady(): boolean {
  return _encryptionEnabled && _cachedKey !== null;
}

/**
 * @deprecated Misleading name — this is the AND of "configured" and "key
 * cached", but readers assumed it was just "configured." Use
 * `isEncryptionConfigured()` or `isEncryptionReady()` explicitly.
 * Kept as an alias for `isEncryptionReady()` to preserve old behavior.
 */
export function isEncryptionEnabled(): boolean {
  return isEncryptionReady();
}

/** Cache a derived key for the current session. */
export function cacheKey(key: Uint8Array): void {
  _cachedKey = key;
  _cachedCryptoKey = null; // invalidate WebCrypto cache
}

/** Get the cached key. Throws if no key has been cached. */
export function getCachedKey(): Uint8Array {
  if (!_cachedKey) {
    throw new Error("Encryption key not available. Please enter your passphrase.");
  }
  return _cachedKey;
}

/** Returns true if a key is currently cached in memory. */
export function hasKey(): boolean {
  return _cachedKey !== null;
}

/** Clear the cached key from memory. */
export function clearKey(): void {
  if (_cachedKey) {
    _cachedKey.fill(0);
    _cachedKey = null;
  }
  _cachedCryptoKey = null;
}

/** Generate a random salt (16 bytes) returned as hex string. */
export function generateSalt(): string {
  if (_isNode()) {
    const crypto = require("crypto");
    return crypto.randomBytes(SALT_LENGTH).toString("hex");
  }
  const bytes = new Uint8Array(SALT_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- Key Derivation ---

/** Derive a 256-bit key from passphrase + salt (hex string). */
export async function deriveKey(passphrase: string, saltHex: string): Promise<Uint8Array> {
  const salt = hexToBytes(saltHex);

  if (_isNode()) {
    const crypto = require("crypto");
    const key: Buffer = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha512");
    return new Uint8Array(key);
  }

  // WebCrypto path (browser, Electron, Capacitor)
  const enc = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase).buffer as ArrayBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-512" },
    keyMaterial,
    KEY_LENGTH * 8
  );
  return new Uint8Array(bits);
}

// --- Encrypt / Decrypt ---

/** Encrypt plaintext string → binary buffer: [iv:12][authTag:16][ciphertext] */
export async function encrypt(key: Uint8Array, plaintext: string): Promise<Uint8Array> {
  if (_isNode()) {
    return encryptNode(key, plaintext);
  }
  return encryptWebCrypto(key, plaintext);
}

/** Decrypt binary buffer → plaintext string. Throws on auth failure. */
export async function decrypt(key: Uint8Array, data: Uint8Array): Promise<string> {
  if (_isNode()) {
    return decryptNode(key, data);
  }
  return decryptWebCrypto(key, data);
}

// --- Node.js crypto implementation ---

function encryptNode(key: Uint8Array, plaintext: string): Uint8Array {
  const crypto = require("crypto");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // [iv:12][authTag:16][ciphertext]
  const result = new Uint8Array(IV_LENGTH + AUTH_TAG_LENGTH + encrypted.length);
  result.set(iv, 0);
  result.set(authTag, IV_LENGTH);
  result.set(encrypted, IV_LENGTH + AUTH_TAG_LENGTH);
  return result;
}

function decryptNode(key: Uint8Array, data: Uint8Array): string {
  const crypto = require("crypto");
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted data too short");
  }

  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// --- WebCrypto implementation (browser, Electron, Capacitor) ---

async function getWebCryptoKey(key: Uint8Array): Promise<CryptoKey> {
  if (_cachedCryptoKey && _cachedKey === key) return _cachedCryptoKey;
  _cachedCryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return _cachedCryptoKey;
}

async function encryptWebCrypto(key: Uint8Array, plaintext: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await getWebCryptoKey(key);
  const enc = new TextEncoder();

  // WebCrypto AES-GCM appends authTag to ciphertext automatically
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    enc.encode(plaintext).buffer as ArrayBuffer
  );

  // WebCrypto returns [ciphertext + authTag], reformat to [iv][authTag][ciphertext]
  const encBytes = new Uint8Array(encrypted);
  const ciphertext = encBytes.slice(0, encBytes.length - AUTH_TAG_LENGTH);
  const authTag = encBytes.slice(encBytes.length - AUTH_TAG_LENGTH);

  const result = new Uint8Array(IV_LENGTH + AUTH_TAG_LENGTH + ciphertext.length);
  result.set(iv, 0);
  result.set(authTag, IV_LENGTH);
  result.set(ciphertext, IV_LENGTH + AUTH_TAG_LENGTH);
  return result;
}

async function decryptWebCrypto(key: Uint8Array, data: Uint8Array): Promise<string> {
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted data too short");
  }

  const iv = data.slice(0, IV_LENGTH);
  const authTag = data.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH + AUTH_TAG_LENGTH);

  // WebCrypto expects [ciphertext + authTag]
  const combined = new Uint8Array(ciphertext.length + AUTH_TAG_LENGTH);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const cryptoKey = await getWebCryptoKey(key);
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: AUTH_TAG_LENGTH * 8 },
    cryptoKey,
    combined.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}

// --- Detection ---

/** Check if a buffer is encrypted (not plaintext JSON/text).
 *  Plaintext JSON/text starts with { [ or optional UTF-8 BOM (EF BB BF).
 *  Encrypted data can randomly start with 0xEF — so we must check the full
 *  3-byte BOM sequence, not just the first byte. */
export function isEncryptedBuffer(buf: Uint8Array): boolean {
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return false;
  const first = buf[0];
  // Plaintext JSON starts with { (0x7B) or [ (0x5B)
  if (first === 0x7B || first === 0x5B) return false;
  // UTF-8 BOM: EF BB BF — only treat as plaintext if ALL three bytes match
  if (first === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return false;
  return true;
}

// --- Sensitive file list ---

const SENSITIVE_FILES = new Set([
  "tasks.json",
  "calendar.json",
  "user_profile.json",
  "user_lifestyle.json",
  "user_observations.json",
  "plan/plan_okr_dashboard.json",
  "focus_brief.json",
  "recurring_tasks.json",
  "chat_history.json",
  "hot_context.json",
  "summaries.json",
  "context_memory.json",
  "feedback_memory.json",
  "suggestions_log.json",
  "learning_log.json",
  "content_index.json",
  "contradiction_index.json",
  "plan/plan_narrative.json",
  "plan/plan_agenda.json",
  "plan/plan_risks.json",
  "notes.json",
]);

/** Check if a relative path refers to a sensitive data file. */
export function isSensitiveFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^data\//, "");
  return SENSITIVE_FILES.has(normalized);
}

// --- Verification ---

/**
 * Verify a derived key can decrypt data in the data folder.
 *
 * Strategy:
 *   1. If a vault file (`_vault.json`) exists in the data folder, decrypt
 *      its verifier blob. This is the canonical check on every platform.
 *   2. Fallback (legacy installs without a vault file): on Node, find a real
 *      encrypted sensitive file and try to decrypt it. On other platforms,
 *      assume true — but the loader will surface decrypt errors as empty
 *      data, which is the existing behavior.
 *   3. If no encrypted files and no vault file exist, the folder is fresh
 *      and we cannot verify anything — assume OK.
 *
 * IMPORTANT: returning `true` from this function should mean "I have a
 * positive proof the key works." Vault-based verification gives that proof.
 * Round-tripping the same key against itself does NOT — that's why the old
 * non-Node path was unsafe.
 */
export async function verifyKey(key: Uint8Array, dataRoot: string): Promise<boolean> {
  // ── Path 1: vault file (preferred, works on every platform) ───────────
  try {
    const { readVault, verifyKeyAgainstVault } = await import("./vault");
    const vault = await readVault(dataRoot);
    if (vault) {
      return await verifyKeyAgainstVault(key, vault);
    }
  } catch {
    // Vault read failed — fall through to legacy paths below
  }

  // ── Path 2: legacy node-only fallback ─────────────────────────────────
  if (_isNode()) {
    const fs = require("fs");
    const path = require("path");

    for (const file of SENSITIVE_FILES) {
      const fullPath = path.join(dataRoot, file);
      if (!fs.existsSync(fullPath)) continue;
      const raw = fs.readFileSync(fullPath);
      const bytes = new Uint8Array(raw);
      if (!isEncryptedBuffer(bytes)) continue;
      try {
        await decrypt(key, bytes);
        return true;
      } catch {
        return false; // GCM auth tag failure = wrong key
      }
    }
    // No encrypted files and no vault — fresh setup
    return true;
  }

  // ── Path 3: legacy non-Node fallback — probe a real encrypted file ────
  // No vault file present. Try to find any encrypted sensitive file in the
  // data folder and decrypt it. This catches "wrong salt after reinstall"
  // scenarios even before the vault file has been written.
  try {
    const { Filesystem } = await import("@capacitor/filesystem");
    const { getCapacitorDirectory } = await import("./capacitorDir");
    const directory = await getCapacitorDirectory();
    const root = dataRoot.replace(/\\/g, "/").replace(/\/+$/, "");

    for (const file of SENSITIVE_FILES) {
      const filePath = root + "/" + file;

      // Step 1: existence check via stat — robust, no encoding issues
      try {
        await Filesystem.stat({
          path: filePath,
          directory,
        });
      } catch {
        // File doesn't exist on this device, try next one
        continue;
      }

      // Step 2: read the file. Any error here is real (permissions etc.)
      // and means we can't verify — keep trying other files.
      let bytes: Uint8Array;
      try {
        const raw = await Filesystem.readFile({
          path: filePath,
          directory,
        });
        const b64 = raw.data as string;
        if (!b64 || typeof b64 !== "string") continue;
        const bin = typeof atob === "function"
          ? atob(b64)
          : Buffer.from(b64, "base64").toString("binary");
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch {
        continue;
      }

      if (!isEncryptedBuffer(bytes)) continue;

      // Step 3: try to decrypt. This is the actual key test.
      try {
        await decrypt(key, bytes);
        return true; // decrypted successfully
      } catch {
        return false; // wrong key — GCM auth tag failure
      }
    }
    // No encrypted files found anywhere — fresh setup, key unverifiable
    return true;
  } catch {
    // Capacitor unavailable (web/electron without vault) — assume true
    return true;
  }
}

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
