/**
 * Vault file — stores encryption parameters alongside the data folder.
 *
 * The vault file (`_vault.json`) lives at the root of the data folder and
 * contains the salt and a verifier blob. This makes the data folder portable:
 * any device pointed at the folder can derive the same key from the same
 * passphrase, because the salt travels with the data instead of living
 * device-locally in secure store.
 *
 * Format (plaintext JSON — salt is public-by-design in PBKDF2):
 * {
 *   "version": 1,
 *   "kdf": "PBKDF2-SHA512",
 *   "iterations": 600000,
 *   "salt": "<hex>",
 *   "verifier": "<base64 of encrypted probe>"
 * }
 *
 * On unlock, the app decrypts `verifier`. If decryption succeeds and the
 * plaintext matches VERIFIER_PROBE, the passphrase is correct. This is
 * cryptographically authenticated by AES-GCM's auth tag — there is no false
 * positive risk.
 */

import {
  isNode as _isNode,
  isCapacitor as _isCapacitor,
  isElectron as _isElectron,
  isWeb as _isWeb,
} from "./platform";
import { encrypt, decrypt } from "./crypto";
import { getCapacitorDirectory } from "./capacitorDir";

const _g = globalThis as any;

export const VAULT_FILENAME = "_vault.json";
export const VERIFIER_PROBE = "chief-clarity-vault-v1";
export const VAULT_VERSION = 1;
export const VAULT_KDF = "PBKDF2-SHA512";
export const VAULT_ITERATIONS = 600_000;

export interface VaultFile {
  version: number;
  kdf: string;
  iterations: number;
  salt: string;
  verifier: string; // base64 of encrypted VERIFIER_PROBE
}

// ─── Path helpers ────────────────────────────────────────────────────────
// We bypass filesystem.ts here because that module is encryption-aware and
// would try to decrypt the vault. The vault must be readable BEFORE the key
// exists. We talk directly to the platform-native FS APIs.

function vaultPath(dataRoot: string): string {
  const normalized = dataRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized + "/" + VAULT_FILENAME;
}

// ─── Read ─────────────────────────────────────────────────────────────────

/**
 * Read the vault file from the given data folder.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function readVault(dataRoot: string): Promise<VaultFile | null> {
  const fullPath = vaultPath(dataRoot);

  try {
    if (_isNode()) {
      const fs = require("fs");
      if (!fs.existsSync(fullPath)) return null;
      const content = fs.readFileSync(fullPath, "utf8");
      return parseVault(content);
    }

    if (_isElectron()) {
      const exists = await _g.window.electron.fileExists(fullPath);
      if (!exists) return null;
      const content = await _g.window.electron.readFile(fullPath);
      return parseVault(content);
    }

    if (_isWeb()) {
      const res = await fetch(`http://localhost:3099/files/text?path=${encodeURIComponent(fullPath)}`);
      if (!res.ok) return null;
      const content = await res.text();
      return parseVault(content);
    }

    // Capacitor — stat first, then base64 read.
    // We deliberately do NOT use encoding=utf8 here. On some Android storage
    // backends (Capacitor 8 + scoped storage) the utf8 path silently returns
    // empty data for valid files, while the base64 path works. Base64 is
    // also fine for text content — decode the bytes back to UTF-8.
    const { Filesystem } = await import("@capacitor/filesystem");
    const directory = await getCapacitorDirectory();

    // Step 1: existence
    try {
      await Filesystem.stat({
        path: fullPath,
        directory,
      });
    } catch {
      return null; // file truly doesn't exist
    }

    // Step 2: base64 read + utf8 decode
    try {
      const result = await Filesystem.readFile({
        path: fullPath,
        directory,
      });
      const data = result.data;
      if (typeof data !== "string" || data.length === 0) {
        console.warn("[vault] readFile returned empty/non-string data");
        return null;
      }
      let text: string;
      if (typeof atob === "function") {
        const bin = atob(data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        text = new TextDecoder().decode(bytes);
      } else {
        text = Buffer.from(data, "base64").toString("utf8");
      }
      const parsed = parseVault(text);
      if (!parsed) {
        console.warn("[vault] decoded content failed to parse:", text.slice(0, 100));
      }
      return parsed;
    } catch (err: any) {
      console.warn("[vault] base64 read failed:", err?.message);
      return null;
    }
  } catch (err: any) {
    console.warn("[vault] readVault outer failure:", err?.message);
    return null;
  }
}

function parseVault(content: string): VaultFile | null {
  try {
    const parsed = JSON.parse(content) as Partial<VaultFile>;
    if (
      typeof parsed.version === "number" &&
      typeof parsed.salt === "string" &&
      typeof parsed.verifier === "string" &&
      typeof parsed.iterations === "number" &&
      typeof parsed.kdf === "string"
    ) {
      return parsed as VaultFile;
    }
    console.warn("[vault] parsed JSON missing required fields:", Object.keys(parsed || {}));
    return null;
  } catch (err: any) {
    console.warn("[vault] JSON.parse failed:", err?.message, "content prefix:", content.slice(0, 60));
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────

/**
 * Write a new vault file using the given key + salt.
 * Encrypts VERIFIER_PROBE so future unlocks can validate the passphrase.
 */
export async function writeVault(
  dataRoot: string,
  key: Uint8Array,
  salt: string
): Promise<void> {
  const verifierBytes = await encrypt(key, VERIFIER_PROBE);
  const vault: VaultFile = {
    version: VAULT_VERSION,
    kdf: VAULT_KDF,
    iterations: VAULT_ITERATIONS,
    salt,
    verifier: bytesToBase64(verifierBytes),
  };
  const content = JSON.stringify(vault, null, 2);
  const fullPath = vaultPath(dataRoot);

  if (_isNode()) {
    const fs = require("fs");
    const path = require("path");
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    return;
  }

  if (_isElectron()) {
    await _g.window.electron.writeFile(fullPath, content);
    return;
  }

  if (_isWeb()) {
    const res = await fetch(`http://localhost:3099/files/text?path=${encodeURIComponent(fullPath)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!res.ok) throw new Error(`vault write failed: ${res.status}`);
    return;
  }

  // Capacitor
  const { Filesystem } = await import("@capacitor/filesystem");
  const directory = await getCapacitorDirectory();
  await Filesystem.writeFile({
    path: fullPath,
    data: content,
    directory,
    encoding: "utf8" as any,
    recursive: true,
  });
}

// ─── Verify ───────────────────────────────────────────────────────────────

/**
 * Verify a key against a vault file by decrypting the verifier blob.
 * Returns true only if the AES-GCM auth tag passes AND the plaintext
 * matches VERIFIER_PROBE.
 */
export async function verifyKeyAgainstVault(
  key: Uint8Array,
  vault: VaultFile
): Promise<boolean> {
  try {
    const verifierBytes = base64ToBytes(vault.verifier);
    const plaintext = await decrypt(key, verifierBytes);
    return plaintext === VERIFIER_PROBE;
  } catch {
    return false;
  }
}

// ─── Base64 helpers (vault-local copy to avoid filesystem.ts dependency) ──

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
