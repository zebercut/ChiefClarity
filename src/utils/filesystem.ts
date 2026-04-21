/**
 * Filesystem abstraction — all file reads/writes go through here.
 *
 * Resolves paths against a configurable data folder root.
 * On Node (headless): native fs module.
 * On mobile: Capacitor Filesystem (Documents directory).
 * On desktop: Node fs via Electron bridge.
 * On web: HTTP calls to the local dev server file API.
 *
 * The data folder path is set once at app startup via setDataRoot().
 */

import {
  isNode as _isNode,
  isElectron as _isElectron,
  isCapacitor as _isCapacitor,
  isWeb as _isWeb,
} from "./platform";
import {
  isEncryptionConfigured,
  isEncryptionReady,
  isSensitiveFile,
  isEncryptedBuffer,
  encrypt,
  decrypt,
  getCachedKey,
  hasKey,
} from "./crypto";

// ─── Typed errors ──────────────────────────────────────────────────────────
//
// `readJsonFile` / `readTextFile` previously collapsed every failure into
// `null`, which made it impossible for callers to distinguish "file does not
// exist" from "file exists but I could not read/decrypt/parse it". The
// loader's silent fallback to defaults plus the executor's blind flush turned
// any transient read failure into permanent data loss (the v2.x tasks wipe
// incident). Typed errors below let the loader react correctly: missing →
// use default, throw → abort load and surface to UI.

export class FileReadError extends Error {
  readonly path: string;
  readonly cause?: unknown;
  constructor(path: string, message: string, cause?: unknown) {
    super(`[fs:read] ${path}: ${message}`);
    this.name = "FileReadError";
    this.path = path;
    this.cause = cause;
  }
}

export class DecryptError extends Error {
  readonly path: string;
  readonly cause?: unknown;
  constructor(path: string, cause?: unknown) {
    super(`[fs:decrypt] ${path}: decryption failed (wrong key, corrupt file, or auth-tag mismatch)`);
    this.name = "DecryptError";
    this.path = path;
    this.cause = cause;
  }
}

export class ParseError extends Error {
  readonly path: string;
  readonly cause?: unknown;
  constructor(path: string, cause?: unknown) {
    super(`[fs:parse] ${path}: JSON parse failed`);
    this.name = "ParseError";
    this.path = path;
    this.cause = cause;
  }
}

export class EncryptionNotReadyError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`[fs:write] ${path}: encryption is configured but key is not ready — refusing to write plaintext over encrypted data`);
    this.name = "EncryptionNotReadyError";
    this.path = path;
  }
}
import {
  setCapacitorDirectoryName,
  getCapacitorDirectoryName as _getCapDirName,
  getCapacitorDirectory as _getCapDir,
} from "./capacitorDir";

const _g = globalThis as any;

let dataRoot = "";

const DEV_SERVER = "http://localhost:3099";

// On Capacitor, the file API needs both a path AND a Directory enum value.
// Most folders go through Directory.Documents (app-private). Folders that
// live under /storage/emulated/0/ require Directory.ExternalStorage AND the
// MANAGE_EXTERNAL_STORAGE permission granted at runtime.
// The directory choice is stored in capacitorDir.ts (a small standalone
// module) so vault.ts and other consumers can read it without creating a
// circular import on filesystem.ts.

/**
 * Set the root path for all data file operations.
 * Called once during setup — the path comes from user config.
 *
 * Path semantics by platform:
 *   Node / Electron: absolute filesystem path
 *   Web: absolute filesystem path (passed to the proxy)
 *   Capacitor:
 *     - Absolute /storage/emulated/<X>/<rest> → ExternalStorage + <rest>
 *       (X is typically "0" but we accept any non-slash token to handle
 *       multi-user device IDs and "0" vs "O" input typos)
 *     - Relative path (no leading /storage/emulated/) → Documents + path
 */
export function setDataRoot(path: string): void {
  // Normalize: forward slashes
  let normalized = path.replace(/\\/g, "/");

  if (_isCapacitor()) {
    const externalMatch = normalized.match(/^\/?storage\/emulated\/[^\/]+\/(.*)$/i);
    if (externalMatch) {
      setCapacitorDirectoryName("ExternalStorage");
      normalized = externalMatch[1] || "";
    } else {
      setCapacitorDirectoryName("Documents");
      normalized = normalized.replace(/^\/+/, "");
    }
  }

  dataRoot = normalized.endsWith("/") ? normalized : normalized + "/";
}

export function getDataRoot(): string {
  return dataRoot;
}

// Re-export for callers that already import from filesystem.ts
export const getCapacitorDirectoryName = _getCapDirName;
export const getCapacitorDirectory = _getCapDir;

/**
 * Number of rolling backups kept per file. Each write rotates:
 *   <file>.bak.1 → <file>.bak.2 → ... → <file>.bak.N (oldest dropped)
 *   current file → <file>.bak.1
 *
 * Why N>1: a single .bak only protects against a single bad write. If a
 * bug causes two consecutive bad writes (e.g., the periodic 5-min reload
 * fired twice with corrupt state before anyone noticed), the second bad
 * write rolls the FIRST bad write into .bak, destroying the only known
 * good copy. With N=5, you get 5 writes of history before the oldest good
 * copy falls off the back. Combined with the shrinkage guard (which should
 * prevent the bad write from happening at all in the common case), this
 * gives belt + suspenders.
 *
 * The trade-off is N× more files in the data folder. For 21 sensitive
 * files, that's 105 .bak files cluttering the data folder. Acceptable for
 * the safety benefit; can be moved to a subfolder later if it becomes a
 * problem.
 */
const BACKUP_COUNT = 5;

/**
 * Roll backup files for a single path on Node.
 *
 *   <path>.bak.1 → <path>.bak.2 → ... → <path>.bak.N
 *   <path>      → <path>.bak.1
 *
 * Operations are wrapped in individual try/catch — backup failure is
 * non-fatal but loud. We always want the new write to proceed even if
 * the rolling fails for some reason.
 */
function rollBackupsNode(fullPath: string, fs: any): void {
  try {
    // Drop the oldest, then shift all numbered backups up by one
    const oldestPath = `${fullPath}.bak.${BACKUP_COUNT}`;
    if (fs.existsSync(oldestPath)) {
      try { fs.unlinkSync(oldestPath); } catch { /* best-effort */ }
    }
    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      const src = `${fullPath}.bak.${i}`;
      const dst = `${fullPath}.bak.${i + 1}`;
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, dst); } catch { /* best-effort */ }
      }
    }
    // Copy current file → .bak.1
    if (fs.existsSync(fullPath)) {
      fs.copyFileSync(fullPath, `${fullPath}.bak.1`);
    }
  } catch (err: any) {
    console.warn(`[fs] rollBackups failed for ${fullPath}:`, err?.message);
  }
}

/**
 * Fetch a URL from the local proxy with automatic retry on rate-limit (429)
 * and transient network errors. The api-proxy on /files has a sliding-window
 * rate limit; bursts of parallel reads (e.g., loadState reading 21 files) can
 * trip it. The OLD client behavior was to swallow these as null, which caused
 * silent data loss. The NEW behavior throws — but transient 429s should be
 * retried before throwing, otherwise normal app usage trips the recovery
 * screen on every burst.
 *
 * Strategy:
 *   - Up to 4 attempts (1 + 3 retries)
 *   - Exponential backoff: 50ms, 150ms, 350ms (total ~550ms worst case)
 *   - Retry on: network failure, 429, 5xx
 *   - Honor Retry-After header if the server provides one
 */
async function fetchWithRetry(
  url: string,
  contextPath: string,
  init?: RequestInit
): Promise<Response> {
  const MAX_ATTEMPTS = 4;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      // Retry on rate-limit and transient server errors
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < MAX_ATTEMPTS - 1) {
          const retryAfter = parseInt(res.headers.get("Retry-After") || "", 10);
          const backoff = !isNaN(retryAfter)
            ? Math.min(retryAfter * 1000, 2000)
            : 50 * Math.pow(3, attempt); // 50ms, 150ms, 450ms
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        const backoff = 50 * Math.pow(3, attempt);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
    }
  }
  throw new FileReadError(
    contextPath,
    `proxy fetch failed after ${MAX_ATTEMPTS} attempts`,
    lastError
  );
}

function resolvePath(relativePath: string): string {
  const cleaned = relativePath.replace(/^data\//, "");
  // Normalize to prevent path traversal (../ sequences)
  const joined = dataRoot + cleaned;
  // Use forward-slash normalization since dataRoot uses forward slashes
  const segments: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "..") { segments.pop(); }
    else if (seg !== "." && seg !== "") { segments.push(seg); }
  }
  const resolved = segments.join("/");
  // Ensure the resolved path stays within dataRoot
  const normalizedRoot = dataRoot.replace(/\/+$/, "");
  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error("[filesystem] path traversal blocked");
  }
  return resolved;
}

/**
 * Read and parse a JSON file from the data folder.
 *
 * Return semantics (post-incident contract):
 *   - `null`        → file does not exist (legitimate first-run state)
 *   - throws        → file exists but could not be read/decrypted/parsed
 *
 * Callers (notably loader.ts) MUST treat null and throw differently:
 *   null → use default
 *   throw → abort the load, surface to UI, do NOT silently fall through
 *
 * The previous catch-all `return null` swallowed decrypt failures, JSON parse
 * errors, and I/O errors as if they were missing files. Combined with the
 * loader's silent default fallback and the executor's blind flush, that
 * pattern destroyed user data on any transient read failure.
 */
export async function readJsonFile<T>(
  relativePath: string
): Promise<T | null> {
  const fullPath = resolvePath(relativePath);
  const shouldDecrypt = isSensitiveFile(relativePath);

  // Node (headless): native fs
  if (_isNode()) {
    const fs = require("fs");
    if (!fs.existsSync(fullPath)) return null;

    let raw: Buffer;
    try {
      raw = fs.readFileSync(fullPath);
    } catch (err) {
      throw new FileReadError(relativePath, "could not read bytes from disk", err);
    }

    const bytes = new Uint8Array(raw);
    if (shouldDecrypt && isEncryptedBuffer(bytes)) {
      if (!hasKey()) {
        throw new FileReadError(
          relativePath,
          "file is encrypted but no key is cached — caller must unlock first"
        );
      }
      let plaintext: string;
      try {
        plaintext = await decrypt(getCachedKey(), bytes);
      } catch (err) {
        throw new DecryptError(relativePath, err);
      }
      try {
        return JSON.parse(plaintext) as T;
      } catch (err) {
        throw new ParseError(relativePath, err);
      }
    }
    // Plaintext path
    try {
      return JSON.parse(raw.toString("utf8")) as T;
    } catch (err) {
      throw new ParseError(relativePath, err);
    }
  }

  // Web: proxy handles decryption (Phase 4)
  if (_isWeb()) {
    const res = await fetchWithRetry(
      `${DEV_SERVER}/files?path=${encodeURIComponent(fullPath)}`,
      relativePath
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new FileReadError(relativePath, `proxy returned ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new ParseError(relativePath, err);
    }
  }

  // Electron: use bridge
  if (_isElectron()) {
    if (shouldDecrypt) {
      let raw: Uint8Array | undefined;
      try {
        raw = await _g.window.electron.readFileRaw?.(fullPath);
      } catch (err) {
        throw new FileReadError(relativePath, "electron readFileRaw failed", err);
      }
      if (!raw) return null;
      const bytes = new Uint8Array(raw);
      if (isEncryptedBuffer(bytes)) {
        if (!hasKey()) {
          throw new FileReadError(
            relativePath,
            "file is encrypted but no key is cached — caller must unlock first"
          );
        }
        let plaintext: string;
        try {
          plaintext = await decrypt(getCachedKey(), bytes);
        } catch (err) {
          throw new DecryptError(relativePath, err);
        }
        try {
          return JSON.parse(plaintext) as T;
        } catch (err) {
          throw new ParseError(relativePath, err);
        }
      }
    }
    let content: string | null;
    try {
      content = await _g.window.electron.readFile(fullPath);
    } catch (err) {
      throw new FileReadError(relativePath, "electron readFile failed", err);
    }
    if (content === null || content === undefined) return null;
    try {
      return JSON.parse(content) as T;
    } catch (err) {
      throw new ParseError(relativePath, err);
    }
  }

  // Mobile: Capacitor
  const bytes = await capacitorReadFileBytes(fullPath);
  if (bytes === null) return null;
  if (shouldDecrypt && isEncryptedBuffer(bytes)) {
    if (!hasKey()) {
      throw new FileReadError(
        relativePath,
        "file is encrypted but no key is cached — caller must unlock first"
      );
    }
    let plaintext: string;
    try {
      plaintext = await decrypt(getCachedKey(), bytes);
    } catch (err) {
      throw new DecryptError(relativePath, err);
    }
    try {
      return JSON.parse(plaintext) as T;
    } catch (err) {
      throw new ParseError(relativePath, err);
    }
  }
  // Plaintext path: decode bytes as UTF-8 and parse
  let text: string;
  try {
    text = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new FileReadError(relativePath, "utf-8 decode failed", err);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ParseError(relativePath, err);
  }
}

/**
 * Read a raw text file. Same throw-vs-null contract as `readJsonFile`.
 */
export async function readTextFile(
  relativePath: string
): Promise<string | null> {
  const fullPath = resolvePath(relativePath);
  const shouldDecrypt = isSensitiveFile(relativePath);

  if (_isNode()) {
    const fs = require("fs");
    if (!fs.existsSync(fullPath)) return null;
    let raw: Buffer;
    try {
      raw = fs.readFileSync(fullPath);
    } catch (err) {
      throw new FileReadError(relativePath, "could not read bytes from disk", err);
    }
    const bytes = new Uint8Array(raw);
    if (shouldDecrypt && isEncryptedBuffer(bytes)) {
      if (!hasKey()) {
        throw new FileReadError(
          relativePath,
          "file is encrypted but no key is cached — caller must unlock first"
        );
      }
      try {
        return await decrypt(getCachedKey(), bytes);
      } catch (err) {
        throw new DecryptError(relativePath, err);
      }
    }
    return raw.toString("utf8");
  }

  // Web: proxy handles decryption
  if (_isWeb()) {
    const res = await fetchWithRetry(
      `${DEV_SERVER}/files/text?path=${encodeURIComponent(fullPath)}`,
      relativePath
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new FileReadError(relativePath, `proxy returned ${res.status}`);
    }
    return await res.text();
  }

  if (_isElectron()) {
    if (shouldDecrypt) {
      let raw: Uint8Array | undefined;
      try {
        raw = await _g.window.electron.readFileRaw?.(fullPath);
      } catch (err) {
        throw new FileReadError(relativePath, "electron readFileRaw failed", err);
      }
      if (!raw) return null;
      const bytes = new Uint8Array(raw);
      if (isEncryptedBuffer(bytes)) {
        if (!hasKey()) {
          throw new FileReadError(
            relativePath,
            "file is encrypted but no key is cached — caller must unlock first"
          );
        }
        try {
          return await decrypt(getCachedKey(), bytes);
        } catch (err) {
          throw new DecryptError(relativePath, err);
        }
      }
    }
    try {
      const content = await _g.window.electron.readFile(fullPath);
      return content ?? null;
    } catch (err) {
      throw new FileReadError(relativePath, "electron readFile failed", err);
    }
  }

  // Mobile: Capacitor
  const bytes = await capacitorReadFileBytes(fullPath);
  if (bytes === null) return null;
  if (shouldDecrypt && isEncryptedBuffer(bytes)) {
    if (!hasKey()) {
      throw new FileReadError(
        relativePath,
        "file is encrypted but no key is cached — caller must unlock first"
      );
    }
    try {
      return await decrypt(getCachedKey(), bytes);
    } catch (err) {
      throw new DecryptError(relativePath, err);
    }
  }
  try {
    return new TextDecoder().decode(bytes);
  } catch (err) {
    throw new FileReadError(relativePath, "utf-8 decode failed", err);
  }
}

/**
 * Write a JSON file atomically (temp + rename) with a rolling .bak.
 *
 * Encryption guard (Bug 5): if encryption is *configured* for this install
 * but the key is not currently cached, this throws `EncryptionNotReadyError`
 * instead of writing plaintext. The previous version would silently downgrade
 * the write to plaintext, mixing formats on disk.
 *
 * Rolling backup (Bug 7): if the destination file exists, it is copied to
 * `<path>.bak` before the new content is written. We keep one rolling backup
 * — enough to recover from a single bad write without doubling storage.
 */
export async function writeJsonFile(
  relativePath: string,
  data: unknown
): Promise<void> {
  const fullPath = resolvePath(relativePath);
  const sensitive = isSensitiveFile(relativePath);
  // Encryption is only handled by THIS process on Node / Electron / Capacitor.
  // On Web mode, the local process is the browser — the api-proxy does the
  // actual encryption. So the "is encryption configured/ready" guards must
  // not fire on Web (the browser doesn't have a key, doesn't need one, and
  // sends plaintext to the proxy which encrypts on disk).
  const localProcessHandlesCrypto = !_isWeb();
  const configuredToEncrypt = localProcessHandlesCrypto && isEncryptionConfigured() && sensitive;

  // Bug 5 guard: never silently write plaintext over encrypted data —
  // but only on platforms where this process is the one doing the encrypting.
  if (configuredToEncrypt && !isEncryptionReady()) {
    throw new EncryptionNotReadyError(relativePath);
  }

  const shouldEncrypt = configuredToEncrypt && isEncryptionReady();

  // Node (headless): atomic write
  if (_isNode()) {
    const fs = require("fs");
    const path = require("path");
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Rolling backups only in legacy JSON mode — in DB mode the database
    // is the source of truth and db-backup.js handles DB-level backups.
    const { isLibsqlMode } = require("../modules/loader");
    if (!isLibsqlMode()) {
      rollBackupsNode(fullPath, fs);
    }

    const tmpPath = fullPath + ".tmp";
    if (shouldEncrypt) {
      const encrypted = await encrypt(getCachedKey(), JSON.stringify(data, null, 2));
      fs.writeFileSync(tmpPath, Buffer.from(encrypted));
    } else {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    }
    fs.renameSync(tmpPath, fullPath);
    return;
  }

  // Web: proxy handles encryption + backup
  if (_isWeb()) {
    const res = await fetch(`${DEV_SERVER}/files?path=${encodeURIComponent(fullPath)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      throw new Error(`[filesystem] write failed: ${res.status} ${err}`);
    }
    return;
  }

  // Electron: atomic write via bridge
  if (_isElectron()) {
    // Best-effort backup via bridge if it supports copyFile
    try {
      if (_g.window.electron.copyFile) {
        await _g.window.electron.copyFile(fullPath, fullPath + ".bak");
      }
    } catch (err) {
      console.warn(`[fs] electron .bak roll failed for ${relativePath}:`, (err as any)?.message);
    }
    const tmpPath = fullPath + ".tmp";
    if (shouldEncrypt) {
      const encrypted = await encrypt(getCachedKey(), JSON.stringify(data, null, 2));
      await _g.window.electron.writeFileRaw(tmpPath, encrypted);
    } else {
      const content = JSON.stringify(data, null, 2);
      await _g.window.electron.writeFile(tmpPath, content);
    }
    await _g.window.electron.renameFile(tmpPath, fullPath);
    return;
  }

  // Mobile: Capacitor with atomic write
  const { Filesystem } = await import("@capacitor/filesystem");
  const directory = await getCapacitorDirectory();
  // Best-effort N rolling backups (Capacitor has no copyFile/rename for
  // sibling-paths in some versions, so we read+write each step).
  try {
    // Drop oldest by attempting to delete it
    try {
      await Filesystem.deleteFile({ path: `${fullPath}.bak.${BACKUP_COUNT}`, directory });
    } catch { /* doesn't exist, fine */ }
    // Shift .bak.{i} → .bak.{i+1} from oldest-1 down to 1
    for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
      try {
        const bytes = await capacitorReadFileBytes(`${fullPath}.bak.${i}`);
        if (bytes && bytes.length > 0) {
          await Filesystem.writeFile({
            path: `${fullPath}.bak.${i + 1}`,
            data: bytesToBase64(bytes),
            directory,
            recursive: true,
          });
          await Filesystem.deleteFile({ path: `${fullPath}.bak.${i}`, directory });
        }
      } catch { /* best-effort */ }
    }
    // Copy current → .bak.1
    const existing = await capacitorReadFileBytes(fullPath);
    if (existing !== null && existing.length > 0) {
      await Filesystem.writeFile({
        path: `${fullPath}.bak.1`,
        data: bytesToBase64(existing),
        directory,
        recursive: true,
      });
    }
  } catch (err) {
    console.warn(`[fs] capacitor .bak roll failed for ${relativePath}:`, (err as any)?.message);
  }

  const tmpPath = fullPath + ".tmp";
  const jsonStr = JSON.stringify(data, null, 2);
  const writeData = shouldEncrypt ? bytesToBase64(await encrypt(getCachedKey(), jsonStr)) : jsonStr;
  const writeOpts = shouldEncrypt
    ? { path: "", data: writeData, directory, recursive: true }
    : { path: "", data: writeData, directory, encoding: "utf8" as any, recursive: true };

  await Filesystem.writeFile({ ...writeOpts, path: tmpPath });

  try {
    await Filesystem.rename({
      from: tmpPath,
      to: fullPath,
      directory,
      toDirectory: directory,
    });
  } catch {
    // Fallback: direct write if rename fails (reuse same data)
    await Filesystem.writeFile({ ...writeOpts, path: fullPath });
    try {
      await Filesystem.deleteFile({ path: tmpPath, directory });
    } catch { /* ignore */ }
  }
}

/**
 * Check whether a file exists at the given relative path.
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  const fullPath = resolvePath(relativePath);

  try {
    if (_isNode()) {
      return require("fs").existsSync(fullPath);
    }

    if (_isWeb()) {
      const res = await fetch(`${DEV_SERVER}/files?path=${encodeURIComponent(fullPath)}`, {
        method: "HEAD",
      });
      return res.ok;
    }

    if (_isElectron()) {
      return await _g.window.electron.fileExists(fullPath);
    }

    const { Filesystem } = await import("@capacitor/filesystem");
    const directory = await getCapacitorDirectory();
    await Filesystem.stat({
      path: fullPath,
      directory,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a raw text file (not JSON) at the given relative path.
 * Used for HTML/MD exports.
 */
export async function writeTextFile(
  relativePath: string,
  content: string
): Promise<void> {
  const fullPath = resolvePath(relativePath);
  const sensitive = isSensitiveFile(relativePath);
  // Same logic as writeJsonFile: skip the encryption guard on web (proxy handles it).
  const localProcessHandlesCrypto = !_isWeb();
  const configuredToEncrypt = localProcessHandlesCrypto && isEncryptionConfigured() && sensitive;
  if (configuredToEncrypt && !isEncryptionReady()) {
    throw new EncryptionNotReadyError(relativePath);
  }
  const shouldEncrypt = configuredToEncrypt && isEncryptionReady();

  if (_isNode()) {
    const fs = require("fs");
    const path = require("path");
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = fullPath + ".tmp";
    if (shouldEncrypt) {
      const encrypted = await encrypt(getCachedKey(), content);
      fs.writeFileSync(tmpPath, Buffer.from(encrypted));
    } else {
      fs.writeFileSync(tmpPath, content, "utf8");
    }
    fs.renameSync(tmpPath, fullPath);
    return;
  }

  // Web: proxy handles encryption
  if (_isWeb()) {
    const res = await fetch(`${DEV_SERVER}/files/text?path=${encodeURIComponent(fullPath)}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: content,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      throw new Error(`[filesystem] text write failed: ${res.status} ${err}`);
    }
    return;
  }

  if (_isElectron()) {
    if (shouldEncrypt) {
      const encrypted = await encrypt(getCachedKey(), content);
      await _g.window.electron.writeFileRaw(fullPath, encrypted);
    } else {
      await _g.window.electron.writeFile(fullPath, content);
    }
    return;
  }

  const { Filesystem } = await import("@capacitor/filesystem");
  const directory = await getCapacitorDirectory();
  if (shouldEncrypt) {
    const encrypted = await encrypt(getCachedKey(), content);
    await Filesystem.writeFile({
      path: fullPath,
      data: bytesToBase64(encrypted),
      directory,
      recursive: true,
    });
  } else {
    await Filesystem.writeFile({
      path: fullPath,
      data: content,
      directory,
      encoding: "utf8" as any,
      recursive: true,
    });
  }
}

/**
 * Validate that the data folder is writable by writing and removing a probe file.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function validateDataFolder(): Promise<{ ok: boolean; error?: string }> {
  try {
    const probe = ".chief_clarity_probe_" + Date.now();
    await writeJsonFile(probe, { test: true });

    // Verify it was written
    const readBack = await readJsonFile<{ test: boolean }>(probe);
    if (!readBack?.test) {
      return { ok: false, error: "Folder exists but data could not be read back." };
    }

    // Clean up probe file
    if (_isCapacitor()) {
      const { Filesystem } = await import("@capacitor/filesystem");
      const directory = await getCapacitorDirectory();
      try {
        await Filesystem.deleteFile({
          path: resolvePath(probe),
          directory,
        });
      } catch { /* best-effort cleanup */ }
    } else if (_isNode()) {
      const fs = require("fs");
      try { fs.unlinkSync(resolvePath(probe)); } catch { /* best-effort */ }
    } else if (_isWeb()) {
      // Proxy doesn't have a delete endpoint — leave probe (harmless)
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not write to this folder." };
  }
}

// --- Capacitor robust reader ---
//
// Reads a file via Capacitor Filesystem in two reliable steps:
//   1. Filesystem.stat to confirm existence (rules out missing-file errors)
//   2. Filesystem.readFile with no encoding (returns base64) → decode to bytes
//
// Why base64-only: utf8 mode silently mangles encrypted/binary files, AND on
// some Android storage backends silently returns empty data for non-trivial
// JSON files. The base64 path always returns the raw bytes correctly. Once
// we have bytes, callers can decide whether to decode as UTF-8 (plaintext)
// or hand to the decryption layer (encrypted).
//
// Returns null on missing file. Logs warnings via console.warn so issues
// surface in logcat / device console.
async function capacitorReadFileBytes(fullPath: string): Promise<Uint8Array | null> {
  if (!_isCapacitor()) return null;
  const { Filesystem } = await import("@capacitor/filesystem");
  const directory = await getCapacitorDirectory();

  // Step 1: existence check
  try {
    await Filesystem.stat({
      path: fullPath,
      directory,
    });
  } catch {
    return null;
  }

  // Step 2: base64 read
  try {
    const result = await Filesystem.readFile({
      path: fullPath,
      directory,
    });
    const data = result.data;
    if (typeof data !== "string") {
      console.warn("[fs] readFile returned non-string for", fullPath, "type:", typeof data);
      return null;
    }
    if (data.length === 0) {
      console.warn("[fs] readFile returned empty data for", fullPath);
      return new Uint8Array(0);
    }
    return base64ToBytes(data);
  } catch (err: any) {
    console.warn("[fs] base64 read failed for", fullPath, "-", err?.message);
    return null;
  }
}

// --- Base64 helpers for Capacitor binary I/O ---

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
