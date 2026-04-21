# FEAT021 — Data encryption at rest for sensitive JSON files

**Status:** Ready  
**MoSCoW:** MUST  
**Category:** Data  
**Priority:** 1  
**Release:** MVP  
**Created:** 2026-04-04  
**Reviewed:** 2026-04-05 (architecture review)

---

## Summary

Encrypt sensitive user data files (tasks, calendar, profile, observations, lifestyle, OKRs) at rest using AES-256-GCM, so that data stored in cloud-synced folders (Google Drive, OneDrive, Dropbox) or on local disk cannot be read by unauthorized parties, cloud providers, or in the event of device compromise.

---

## Problem Statement

All user data is currently stored as plaintext JSON in a cloud-synced folder. This means:
- The cloud storage provider can read all personal data (tasks, calendar, emotional observations, goals)
- If the device is compromised, all life-planning data is immediately readable
- If the cloud account is breached, all data is exposed
- No application-level privacy guarantee exists

---

## User Stories

### Story 1 — First-time setup
**As a** new user, **I want** to set an encryption passphrase during setup, **so that** my data is protected from the start.

**Acceptance Criteria:**
- [ ] Given the setup wizard, when the user reaches the data folder step, then they are prompted to create an encryption passphrase
- [ ] Given a passphrase, when setup completes, then all data files are written encrypted
- [ ] Given no passphrase (opt-out), when setup completes, then data files remain plaintext (backward compatible)

### Story 2 — Transparent read/write
**As a** user, **I want** encryption to be transparent during normal use, **so that** I don't notice any difference in app behavior.

**Acceptance Criteria:**
- [ ] Given an encrypted data folder, when the app reads a file, then it decrypts automatically using the cached key
- [ ] Given an encrypted data folder, when the app writes a file, then it encrypts automatically before writing
- [ ] Given the passphrase is entered once per session, when using the app, then no further passphrase prompts appear

### Story 3 — Existing user migration
**As an** existing user with plaintext data, **I want** to enable encryption on my existing data, **so that** I can protect data I've already created.

**Acceptance Criteria:**
- [ ] Given an existing plaintext data folder, when the user enables encryption in settings, then all files are migrated to encrypted format
- [ ] Given migration completes, when reading files, then decrypted content matches original plaintext exactly

---

## Workflow

```
First launch (new user):
  Setup wizard -> Set passphrase -> Derive key (PBKDF2) -> Cache in memory -> Write encrypted files

App open (returning user):
  Launch -> Prompt passphrase -> Derive key -> Cache in memory -> Read/write transparently

Enable encryption (existing user):
  Settings -> Set passphrase -> Derive key -> Migrate all files -> Confirm

Headless runner:
  Start -> Read ENCRYPTION_PASSPHRASE from env -> Derive key -> Cache in memory -> Run jobs
```

---

## Architectural Decisions (resolved)

### AD-1: Crypto library for cross-platform

**Decision:** Use `react-native-quick-crypto` (JSI-based native module) for mobile + Capacitor, Node.js `crypto` for headless runner and api-proxy.

**Rationale:** The app runs on React Native via Expo/Capacitor. Node.js `crypto` is not available in the RN runtime. `react-native-quick-crypto` provides a drop-in polyfill for the Node.js `crypto` API via JSI (no bridge overhead), supporting `pbkdf2`, `createCipheriv`, `createDecipheriv` with AES-256-GCM. It is the most mature and performant option for RN crypto.

**Fallback:** If `react-native-quick-crypto` causes Expo compatibility issues, fall back to `expo-crypto` for key derivation + a pure-JS AES-GCM implementation (`@noble/ciphers`). Both are audited and well-maintained.

**Implementation:**
```typescript
// src/utils/crypto.ts — platform-aware import
import { Platform } from 'react-native';

// For mobile: react-native-quick-crypto (installed as global polyfill)
// For Node.js (headless, proxy): native crypto module
// Detect at runtime: if globalThis.crypto.subtle exists, use WebCrypto; else use node crypto
```

### AD-2: File extension

**Decision:** Keep `.json` extension for encrypted files.

**Rationale:** Changing to `.enc` would require updating every path reference in `loader.ts`, `FILE_MAP`, and all scripts. The `readJsonFile` function can detect encrypted vs plaintext by inspecting the first bytes (encrypted files won't start with `{` or `[`). This also means a user can disable encryption and files revert to normal `.json` without path changes.

### AD-3: Passphrase storage

**Decision:** Store passphrase in `expo-secure-store` (already in the stack) with an option to require re-entry each session.

**Rationale:** `expo-secure-store` already secures the API key. Storing the passphrase there gives convenience (no prompt on every launch) while maintaining hardware-backed encryption (Keychain on iOS, Keystore on Android). Users who want maximum security can toggle "require passphrase on launch" in settings.

**Config fields added to `AppConfig`:**
```typescript
encryptionEnabled: boolean;   // false by default
encryptionSalt: string;       // hex-encoded 16-byte salt (stored in config, NOT in data files)
passphraseInSecureStore: boolean; // true = auto-unlock, false = prompt each launch
```

### AD-4: Passphrase change

**Decision:** Defer to post-MVP. Not in scope for initial release.

**Rationale:** Passphrase change requires re-encrypting every file atomically. The migration path is complex (partial re-encryption on crash). For MVP, if a user needs to change their passphrase, they can disable encryption, then re-enable with a new passphrase.

### AD-5: api-proxy.js encryption handling

**Decision:** Refactor api-proxy.js file endpoints to use the shared `crypto.ts` module rather than raw `fs`.

**Rationale:** The proxy currently bypasses `filesystem.ts` and reads/writes files with raw Node.js `fs`. If encryption wraps only `filesystem.ts`, the proxy would serve plaintext to the browser which then can't distinguish encrypted from not. Instead, the proxy must decrypt on read and encrypt on write, using the same `crypto.ts` functions. The passphrase is provided via the `ENCRYPTION_PASSPHRASE` env var (same as headless runner).

### AD-6: Salt storage strategy

**Decision:** Store a single salt in config (not per-file). Each file gets a unique random IV.

**Rationale:** The original spec had salt embedded in each file's binary format. This complicates detection of encrypted vs plaintext files and adds 16 bytes overhead per file. Since we use a single passphrase, a single salt is sufficient — the per-file IV provides uniqueness for each encryption operation. The salt is stored in `AppConfig.encryptionSalt`.

**Updated file format:** `[iv:12][authTag:16][ciphertext:...]`

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Wrong passphrase entered | Decryption fails (GCM auth tag mismatch); prompt to retry; no data corruption |
| User forgets passphrase | No recovery possible (by design); warn clearly during setup |
| App crash mid-migration | Atomic writes ensure each file is either fully encrypted or fully plaintext; migration tracks progress in a `.migration-state.json` temp file |
| Headless runner needs access | Passphrase read from `ENCRYPTION_PASSPHRASE` env var |
| Cloud sync conflict on encrypted file | Same as current: last-write-wins; encrypted payload is opaque binary |
| Mixed encrypted/plaintext files | `readJsonFile` auto-detects by checking if content starts with `{`/`[` (plaintext) or not (encrypted). Graceful fallback during partial migration. |
| Very large data files | Current data files are all <1MB; stream encryption not needed for MVP |
| Encryption disabled after being enabled | All files decrypted back to plaintext via reverse migration; salt and config fields cleared |

---

## Success Metrics

- All sensitive data files encrypted at rest when feature is enabled
- Zero plaintext data leakage in cloud-synced folder
- Read/write latency increase < 50ms per file operation
- Passphrase entered at most once per app session (or zero if stored in secure store)
- Encryption/decryption is invisible to user during normal operation

---

## Out of Scope

- End-to-end encryption between devices (each device decrypts independently)
- Encrypting non-sensitive files (e.g., feature backlog, config structure)
- Key escrow or passphrase recovery (user is responsible for their passphrase)
- Encrypting data in transit (already HTTPS to Anthropic API)
- Multi-user key management (single-user app)
- Passphrase change / re-keying (deferred to post-MVP)
- Settings screen UI (FEAT021 delivers the encryption layer; settings toggle can be added when a settings screen exists)

---

## Architecture

### Encryption scheme
- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** PBKDF2 with SHA-512, 600,000 iterations
- **Salt:** Single random 16-byte salt stored in `AppConfig.encryptionSalt` (hex)
- **IV:** Random 12 bytes per file, per write (prepended to ciphertext)
- **File format:** `[iv:12 bytes][authTag:16 bytes][ciphertext:variable]`
- **Key lifecycle:** Derived from passphrase + salt once per session; cached in module-level variable in `crypto.ts`; never written to disk (except via expo-secure-store if user opts in)

### Files to encrypt (sensitive)
- `tasks.json`, `calendar.json`, `user_profile.json`, `user_lifestyle.json`
- `user_observations.json`, `plan_okr_dashboard.json`, `focus_brief.json`
- `recurring_tasks.json`, `inbox.txt`, `chat_history.json`
- `hot_context.json`, `summaries.json`, `context_memory.json`
- `feedback_memory.json`, `suggestions_log.json`, `learning_log.json`
- `content_index.json`, `contradiction_index.json`
- `plan/plan_narrative.json`, `plan/plan_agenda.json`, `plan/plan_risks.json`

### Files NOT encrypted (non-sensitive / coordination)
- `config` in secure store (separate from data folder)
- `.headless.lock` (process coordination, no user data)
- `topics/` folder (user-created, but markdown — not JSON pipeline)

### Encrypted vs plaintext detection
```
function isEncryptedBuffer(buf: Buffer): boolean {
  // Plaintext JSON always starts with { or [ (possibly with BOM/whitespace)
  // Encrypted data starts with random IV bytes — statistically never 0x7B or 0x5B
  const first = buf[0];
  return first !== 0x7B && first !== 0x5B && first !== 0xEF && first !== 0x20 && first !== 0x0A;
}
```

### Integration point
`src/utils/filesystem.ts` — wrap `readJsonFile`/`writeJsonFile`/`readTextFile`/`writeTextFile` with encrypt/decrypt. The encryption check is gated on `isEncryptionEnabled()` which reads the cached config flag.

### Data flow (encrypted mode)

```
Write path:
  writeJsonFile(path, data)
    → JSON.stringify(data)
    → if encryptionEnabled && isSensitiveFile(path):
        encrypt(buffer) → [iv][authTag][ciphertext]
    → atomic write to disk (.tmp → rename)

Read path:
  readJsonFile(path)
    → read raw bytes from disk
    → if isEncryptedBuffer(bytes):
        decrypt(bytes) → plaintext JSON string
    → JSON.parse(plaintext)
```

---

## Implementation Phases

### Phase 1: Core crypto module (no UI, no migration)
**Goal:** Encrypt/decrypt functions that work cross-platform.

| Task | File | Details |
|------|------|---------|
| 1.1 | `src/utils/crypto.ts` | New module: `deriveKey(passphrase, salt)`, `encrypt(key, plaintext)`, `decrypt(key, ciphertext)`, `generateSalt()`, `isEncryptionEnabled()`, `cacheKey(key)`, `clearKey()` |
| 1.2 | `package.json` | Add `react-native-quick-crypto` dependency |
| 1.3 | `src/utils/crypto.test.ts` | Unit tests: round-trip, wrong passphrase, known test vectors, empty input, large input |

**Exit criteria:** `encrypt(key, decrypt(key, data)) === data` passes on Node.js. Wrong passphrase throws.

### Phase 2: Filesystem integration
**Goal:** Transparent encryption in read/write pipeline.

| Task | File | Details |
|------|------|---------|
| 2.1 | `src/utils/filesystem.ts` | Import crypto module; wrap `readJsonFile`, `writeJsonFile`, `readTextFile`, `writeTextFile` with encrypt/decrypt gated on `isEncryptionEnabled()` + `isSensitiveFile(path)` |
| 2.2 | `src/utils/config.ts` | Add `encryptionEnabled`, `encryptionSalt`, `passphraseInSecureStore` to `AppConfig` interface and `loadConfig`/`saveConfig` |
| 2.3 | `src/utils/filesystem.ts` | Add `isEncryptedBuffer()` detection for graceful mixed-mode reading |
| 2.4 | Integration test | Write encrypted file → read back → verify content matches. Test mixed encrypted/plaintext reads. |

**Exit criteria:** With encryption enabled and key cached, `loadState()` succeeds with encrypted files. With encryption disabled, plaintext files still work unchanged.

### Phase 3: Setup wizard + passphrase prompt
**Goal:** Users can set a passphrase during setup and are prompted on launch.

| Task | File | Details |
|------|------|---------|
| 3.1 | `app/setup.tsx` | Add optional passphrase step after data folder selection. Two inputs (passphrase + confirm). Skip button. Warning about non-recovery. |
| 3.2 | `app/(tabs)/_layout.tsx` or root layout | On app launch, if `encryptionEnabled && !passphraseInSecureStore`, show passphrase prompt modal before loading state |
| 3.3 | `app/setup.tsx` | In `handleFinish()`: if passphrase provided, call `deriveKey()`, `cacheKey()`, save salt + flag to config, optionally store passphrase in secure store |

**Exit criteria:** New user can set passphrase in setup; returning user is prompted (or auto-unlocked) on launch; app loads and operates normally with encrypted data.

### Phase 4: Headless runner + api-proxy
**Goal:** Background processes can read/write encrypted files.

| Task | File | Details |
|------|------|---------|
| 4.1 | `scripts/headless-runner.js` | On startup: read `ENCRYPTION_PASSPHRASE` env var, call `deriveKey()` + `cacheKey()` before `loadState()`. Error with clear message if env var missing and encryption is enabled. |
| 4.2 | `scripts/api-proxy.js` | Import crypto module. In file read/write endpoints, detect encrypted files and decrypt/encrypt using key derived from `ENCRYPTION_PASSPHRASE` env var. |
| 4.3 | `.env.example` | Add `ENCRYPTION_PASSPHRASE=` placeholder with comment |

**Exit criteria:** Headless runner and api-proxy can read/write encrypted files. Clear error message if passphrase env var is missing.

### Phase 5: Migration
**Goal:** Existing users can encrypt their plaintext data.

| Task | File | Details |
|------|------|---------|
| 5.1 | `scripts/migrate-encryption.ts` | New script: reads all sensitive files, encrypts each one atomically. Tracks progress in `.migration-state.json`. Idempotent (skips already-encrypted files). Supports `--decrypt` flag for reverse migration. |
| 5.2 | `src/utils/crypto.ts` | Add `migrateFiles(direction: 'encrypt' | 'decrypt')` function that can be called from UI or script |
| 5.3 | App UI (future) | When a settings screen exists, add "Enable encryption" toggle that triggers in-app migration. For now, migration is CLI-only via the script. |

**Exit criteria:** Running `npx ts-node scripts/migrate-encryption.ts --encrypt` converts all plaintext sensitive files to encrypted. `--decrypt` reverses it. Idempotent.

---

## Files Changed (summary)

| File | Change | Phase |
|------|--------|-------|
| `src/utils/crypto.ts` | **NEW** — key derivation, encrypt, decrypt, key cache, platform detection | 1 |
| `package.json` | Add `react-native-quick-crypto` | 1 |
| `src/utils/filesystem.ts` | Wrap read/write with encrypt/decrypt layer | 2 |
| `src/utils/config.ts` | Add `encryptionEnabled`, `encryptionSalt`, `passphraseInSecureStore` to AppConfig | 2 |
| `app/setup.tsx` | Add optional passphrase step | 3 |
| `app/(tabs)/_layout.tsx` | Add passphrase prompt on launch if needed | 3 |
| `scripts/headless-runner.js` | Derive key from env var before loadState | 4 |
| `scripts/api-proxy.js` | Decrypt/encrypt in file endpoints using shared crypto | 4 |
| `.env.example` | Add `ENCRYPTION_PASSPHRASE` placeholder | 4 |
| `scripts/migrate-encryption.ts` | **NEW** — plaintext ↔ encrypted migration script | 5 |

---

## Testing Plan

### Unit tests (Phase 1)
- [ ] Encrypt/decrypt round-trip with known test vectors (NIST AES-GCM)
- [ ] Wrong passphrase → GCM auth tag verification fails, throws specific error
- [ ] Empty plaintext encryption/decryption
- [ ] Large plaintext (>1MB) encryption/decryption
- [ ] `deriveKey` produces deterministic output for same passphrase + salt
- [ ] `generateSalt` produces 16 random bytes, different each call

### Integration tests (Phase 2)
- [ ] `writeJsonFile` → `readJsonFile` round-trip with encryption enabled
- [ ] `writeTextFile` → `readTextFile` round-trip with encryption enabled
- [ ] Mixed mode: read plaintext file when encryption enabled (graceful fallback)
- [ ] Mixed mode: read encrypted file when encryption disabled (error with clear message)
- [ ] Non-sensitive file written as plaintext even when encryption enabled
- [ ] `isEncryptedBuffer` correctly identifies encrypted vs plaintext for all data files

### E2E tests (Phase 3-5)
- [ ] Full app cycle: setup with passphrase → create tasks → restart → prompt passphrase → tasks visible
- [ ] Headless runner: encrypted files read/written correctly with env var passphrase
- [ ] Migration: plaintext → encrypted → verify all files → decrypt → verify matches original
- [ ] Performance: file read/write overhead < 50ms on target devices

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `react-native-quick-crypto` incompatible with Expo/Capacitor | Medium | High | Fallback to `@noble/ciphers` (pure JS, audited). Test early in Phase 1. |
| Performance regression on low-end Android | Low | Medium | PBKDF2 runs once per session (cached). AES-GCM is fast for small files (<1MB). Benchmark in Phase 1. |
| User loses passphrase, loses all data | Medium | Critical | Clear, prominent warning during setup. Recommend writing passphrase down. No recovery by design. |
| Partial migration on crash | Low | High | Atomic per-file writes + `.migration-state.json` progress tracking. Idempotent re-run. |
| Cloud sync conflicts on encrypted files | Low | Medium | Same behavior as current (last-write-wins). No change in conflict semantics. |

---

## Dependencies

- `react-native-quick-crypto` (or `@noble/ciphers` as fallback) — must be validated with Expo/Capacitor before Phase 2
- Setup wizard (exists, `app/setup.tsx`) — modification only
- Settings screen — does NOT exist yet; migration toggle deferred to when it's built
- Filesystem abstraction (`src/utils/filesystem.ts`) — stable, well-structured, ready for wrapping

---

## Open Questions (resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| OS keyring vs always prompt? | Store in `expo-secure-store` by default; option to require prompt each session | Balances convenience with security; uses existing infrastructure |
| Support passphrase change? | Deferred to post-MVP | Complex re-keying; workaround exists (disable → re-enable) |
| File extension `.json` or `.enc`? | Keep `.json` | Less disruption; auto-detection via first-byte check |
| Salt per-file or global? | Global salt in config; per-file IV | Simpler format; per-file IV ensures uniqueness |
| api-proxy encryption? | Proxy uses shared `crypto.ts` module | Proxy bypasses `filesystem.ts`; must handle encryption directly |
