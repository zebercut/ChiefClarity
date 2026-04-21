# FEAT027 — App Authentication Gate with Local PIN and Optional Biometrics

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Security
**Priority:** 2  
**Release:** v2.1  
**Tags:** auth, security, pin, biometrics  
**Created:** 2026-04-06

---

## Summary

Add a local authentication gate that requires a PIN or passphrase to access the app, with optional biometric unlock (fingerprint/face). This is a zero-dependency, offline-first authentication mechanism that leverages the existing secure storage infrastructure (expo-secure-store / Keychain / Keystore). No third-party auth services, no backend, no internet required.

---

## Problem Statement

Currently, anyone who picks up the device can open Chief Clarity and access all personal life data — tasks, goals, chat history, focus plans, and sensitive information. The existing encryption passphrase mechanism only protects data files at rest but does not gate app access on every open/resume. The app needs a front door.

---

## User Stories

### Story 1 — PIN Setup
**As a** user setting up Chief Clarity, **I want** to create a PIN or passphrase during the setup wizard, **so that** my app is protected from unauthorized access.

**Acceptance Criteria:**
- [ ] Given the user is in the setup wizard, when they reach the auth step, then they can set a 4-6 digit PIN or a text passphrase
- [ ] Given the user sets a PIN, when they confirm it by entering it twice, then it is stored securely via expo-secure-store
- [ ] Given the user already has an encryption passphrase configured, when they reach the auth step, then they are offered the option to reuse it as the app lock passphrase (single credential)

### Story 2 — App Lock on Open/Resume
**As a** user, **I want** the app to require my PIN when I open it or return to it after a timeout, **so that** no one else can see my data if they pick up my device.

**Acceptance Criteria:**
- [ ] Given the app is opened (cold start), when the root layout mounts, then the auth gate screen is shown before any content
- [ ] Given the app returns from background after the lock timeout (default: 2 minutes), when the app regains focus, then the auth gate is shown
- [ ] Given the user enters the correct PIN, when they submit, then the app unlocks and shows the last screen
- [ ] Given the user enters an incorrect PIN 5 times, then a 30-second cooldown is enforced before they can retry

### Story 3 — Biometric Unlock (Optional)
**As a** user, **I want** to optionally enable fingerprint or face unlock, **so that** I can access my app quickly without typing my PIN every time.

**Acceptance Criteria:**
- [ ] Given the device supports biometrics, when the user enables biometric unlock in settings, then the app offers biometric prompt on lock screen
- [ ] Given biometric auth fails or is cancelled, when the user dismisses the biometric prompt, then they fall back to PIN entry
- [ ] Given the device does not support biometrics, then the biometric option is hidden

### Story 4 — Change/Disable Auth
**As a** user, **I want** to change my PIN or disable the auth gate, **so that** I can manage my security preferences.

**Acceptance Criteria:**
- [ ] Given the user wants to change their PIN, when they go to settings and enter their current PIN, then they can set a new one
- [ ] Given the user wants to disable auth, when they confirm with their current PIN, then the auth gate is removed

---

## Workflow

### Setup Flow
```
Setup Wizard Step 4 (Encryption) → Step 5 (App Lock)
    → Choose: PIN (4-6 digits) or Passphrase
    → Confirm credential
    → Optional: Enable biometric unlock
    → Optional: Reuse encryption passphrase (if already set)
    → Store hashed credential in expo-secure-store
```

### Unlock Flow
```
App Open / Resume from Background
    → Check: has lock timeout expired?
        → No: show app directly
        → Yes: show Auth Gate screen
            → If biometrics enabled: show biometric prompt
                → Success: unlock
                → Fail/Cancel: show PIN input
            → PIN input
                → Correct: unlock, reset attempt counter
                → Wrong: increment counter, show error
                    → 5 failures: 30s cooldown
```

### Credential Storage
```
PIN → SHA-256 hash → expo-secure-store (key: "auth_pin_hash")
Biometric enabled flag → expo-secure-store (key: "auth_biometric_enabled")
Last unlock timestamp → in-memory (not persisted, resets on cold start)
Lock timeout setting → config (default: 2 minutes)
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User force-kills app and reopens | Auth gate shown (cold start always requires auth) |
| User switches away for < timeout | App unlocks without auth gate |
| User switches away for > timeout | Auth gate shown on return |
| Device has no biometrics | Biometric option hidden, PIN-only |
| User forgets PIN | "Reset PIN" option that requires re-entering the data folder path as verification, then allows PIN reset |
| Encryption passphrase and PIN are the same | Single credential entry unlocks both encryption and app |
| Headless runner background execution | Headless runner bypasses auth gate (it runs as a Node.js process, not in the app UI) |
| Web platform | PIN-only (no biometric API on web), use sessionStorage for lock timeout |

---

## Success Metrics

- App is gated on every cold start and resume-after-timeout
- Zero third-party dependencies added
- Unlock adds < 200ms latency to app resume
- Works fully offline

---

## Out of Scope

- Multi-user support / user accounts
- Server-side authentication or session management
- Google OAuth or any third-party identity provider
- Password recovery via email/SMS
- Cloud-synced credentials

---

## Architecture Notes

### New Files
| File | Purpose |
|------|---------|
| `src/utils/auth.ts` | Auth logic: hash PIN, verify PIN, check biometric availability, manage lock state |
| `app/auth-gate.tsx` | Full-screen auth gate UI component (PIN input + biometric button) |

### Modified Files
| File | Change |
|------|--------|
| `app/_layout.tsx` | Add auth gate check before rendering app content; manage AppState listener for background/foreground transitions |
| `app/setup.tsx` | Add Step 5 for PIN/passphrase setup after encryption step |
| `src/utils/config.ts` | Add `authEnabled`, `lockTimeoutMinutes`, `biometricEnabled` to config type |
| `src/types/index.ts` | Add auth-related type definitions |

### Dependencies
- **No new npm packages required**
- `expo-secure-store` — already installed, used for PIN hash storage
- `expo-local-authentication` — already part of Expo SDK, provides biometric APIs (may need explicit install: `npx expo install expo-local-authentication`)
- `react-native` AppState API — already available, used for background/foreground detection

### Security Design
- PIN is never stored in plaintext — only SHA-256 hash stored in secure store
- Biometric unlock uses OS-level biometric APIs (Keychain/Keystore) — no credential leaves the secure enclave
- Lock timeout tracked in-memory only — resets on app kill (safe default: always lock on cold start)
- Failed attempt counter resets after successful auth or app restart
- If encryption passphrase is also the app PIN, derive both keys from the same credential entry

---

## Implementation Notes

### Phase 1: Core PIN Auth (MVP)
| File | Change |
|------|--------|
| `src/utils/auth.ts` | `hashPin()`, `verifyPin()`, `setPin()`, `isAuthEnabled()`, `checkLockTimeout()` |
| `app/auth-gate.tsx` | PIN input UI with numpad, error display, cooldown timer |
| `app/_layout.tsx` | Wrap content in auth gate; AppState listener for lock timeout |
| `app/setup.tsx` | Add PIN setup step to wizard |
| `src/utils/config.ts` | Add auth config fields |

### Phase 2: Biometric Unlock (Enhancement)
| File | Change |
|------|--------|
| `src/utils/auth.ts` | `checkBiometricAvailability()`, `authenticateWithBiometric()` |
| `app/auth-gate.tsx` | Add fingerprint/face icon button, biometric prompt flow |

### Phase 3: Settings Management
| File | Change |
|------|--------|
| Settings screen (new or existing) | Change PIN, toggle biometrics, adjust lock timeout, disable auth |

---

## Testing Notes

- [ ] Unit tests for `auth.ts`: PIN hashing, verification, timeout logic
- [ ] Manual test: cold start shows auth gate
- [ ] Manual test: resume after timeout shows auth gate
- [ ] Manual test: resume before timeout skips auth gate
- [ ] Manual test: wrong PIN shows error, 5 failures triggers cooldown
- [ ] Manual test: biometric unlock works on supported device
- [ ] Manual test: biometric fallback to PIN works
- [ ] Manual test: setup wizard PIN step works
- [ ] Manual test: headless runner is not affected by auth gate
- [ ] Manual test: web platform PIN-only flow works

---

## Open Questions

- Should the lock timeout be configurable by the user? (Recommended: yes, with options 1min / 2min / 5min / 15min / never)
- Should the PIN be limited to numeric digits or allow alphanumeric passphrase? (Recommended: support both, let user choose)
- Should we unify the encryption passphrase and app PIN into a single credential? (Recommended: yes, offer this as an option during setup to reduce friction)
