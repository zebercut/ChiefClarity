# FEAT035 — In-App Settings Panel

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** UX
**Priority:** 2  
**Release:** v2.2  
**Tags:** settings, configuration, ux, onboarding, mobile  
**Created:** 2026-04-07

---

## Summary

A unified in-app Settings panel that lets the user view, edit, validate, and persist all app configuration — including profile, AI model selection, data paths, security keys, sync schedule, notifications, and appearance — without needing to manually edit `.env` or any source files. Critical for mobile (Capacitor) builds where editing `.env` is impossible, and for any non-technical user.

---

## Problem Statement

Today, configuration is scattered and only editable by hand:
- `.env` holds the API key, encryption keys, data folder path, and model IDs — invisible to the user, requires a text editor
- `userProfile` (name, timezone) lives in JSON files with no UI to edit
- Polling intervals, model choices, and feature flags are hardcoded
- The Capacitor mobile build cannot read `.env` the same way as desktop, so a runtime settings store is required for mobile to work at all
- New users have no onboarding path to enter their API key — the app simply fails

This is a foundational gap that blocks mobile usability, non-technical adoption, and any future "share with another user" scenario.

---

## User Stories

### Story 1 — First-run setup
**As a** new user opening the app for the first time, **I want** a guided setup screen, **so that** I can enter my API key, pick a data folder, and start using the app without opening any files.

**Acceptance Criteria:**
- [ ] On first launch (no `settings.json`), show a setup wizard
- [ ] Wizard collects: name, timezone, API key, data folder, encryption passphrase
- [ ] "Test connection" button validates the API key before saving
- [ ] "Test folder" button validates the data path is readable/writable
- [ ] On finish, writes `settings.json` and proceeds to the main app

### Story 2 — Edit settings later
**As an** existing user, **I want** a Settings screen accessible from the main UI, **so that** I can change my model, update my key, or adjust intervals without restarting or editing files.

**Acceptance Criteria:**
- [ ] Settings icon visible in main nav
- [ ] Settings panel organized into clear sections (see Categories below)
- [ ] Changes save to `settings.json` atomically
- [ ] Live-updateable settings (theme, polling intervals) apply without restart
- [ ] Restart-required settings (data path) show a clear warning + "Restart now" button

### Story 3 — Mobile parity
**As a** mobile user (Capacitor build), **I want** the same settings panel as desktop, **so that** I can fully configure the app from my phone.

**Acceptance Criteria:**
- [ ] All settings work on iOS/Android Capacitor build
- [ ] No reliance on `.env` at runtime — `settings.json` is the source of truth
- [ ] Secure storage (Capacitor Secure Storage / Keychain) used for secrets on mobile

### Story 4 — Replace a secret safely
**As a** security-conscious user, **I want** secrets to be masked and never displayed, **so that** my API key and encryption keys cannot leak from the UI.

**Acceptance Criteria:**
- [ ] API key field shows masked dots + last 4 chars only
- [ ] "Replace key" button reveals a write-only input
- [ ] Encryption passphrase has the same treatment
- [ ] Settings export (FEAT034) excludes secrets by default

---

## Settings Categories

| Section | Settings | Notes |
|---------|----------|-------|
| **Profile** | Name, timezone, working hours, daily start/end time | Already in `userProfile.json`, surface in UI |
| **AI & Model** | Heavy model (Sonnet), Light model (Haiku), temperature, max tokens override | Maps to `LLM_MODEL_HEAVY`, `LLM_MODEL_LIGHT` |
| **Data & Storage** | Data folder path, export location | Maps to `DATA_FOLDER_PATH`. Restart required on change |
| **Security** | Anthropic API key, encryption passphrase, encryption salt | Masked, write-only. Maps to `ANTHROPIC_API_KEY`, `ENCRYPTION_PASSPHRASE`, `ENCRYPTION_SALT` |
| **Sync & Background** | Headless runner enabled, runner schedule (cron), inbox poll interval, state refresh interval | New runtime config |
| **Notifications & Nudges** | Enable nudges, quiet hours start/end, nudge channels | New runtime config |
| **Appearance** | Theme (light/dark/auto), density (compact/comfortable), font size | New runtime config |
| **Advanced / Developer** | Debug logging, show raw JSON viewer, "Open settings.json" button | Power-user controls |

---

## Workflow

```
First run:    App start -> no settings.json -> Setup Wizard -> write settings.json -> Main app
Later edit:   Main app -> Settings icon -> choose section -> edit field -> validate -> save -> toast confirmation
Restart req:  Edit data path -> warning shown -> "Save & Restart" -> app restarts (desktop) or reload (mobile)
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| User enters invalid API key | "Test" fails with clear error, save blocked |
| Data folder doesn't exist or is read-only | "Test folder" fails, suggest alternatives |
| User clears API key entirely | Confirm dialog: "App will stop working without a key" |
| Settings file corrupted on read | Fall back to defaults, show banner: "Settings reset, please reconfigure" |
| Two windows open simultaneously edit settings | Last-write-wins; show "Settings updated externally" toast on the other |
| User changes encryption passphrase | Trigger re-encryption flow (or block + explain) |
| `.env` and `settings.json` both exist | `settings.json` wins; `.env` becomes one-time seed for migration |
| Mobile: secure storage unavailable | Fall back to encrypted JSON, warn user |

---

## Success Metrics

- 100% of configuration that previously required `.env` editing is doable in-app
- New user can go from "fresh install" to "first task created" without opening any file
- Mobile build works end-to-end with no developer assistance
- Zero secrets ever appear in plain text in the UI after initial entry

---

## Out of Scope (v1)

- Multi-profile / multi-user support
- Cloud sync of settings across devices
- Settings versioning / undo history
- Importing settings from another LifeOS install (covered by FEAT034 export + future re-import)
- Per-device override settings

---

## Architecture Notes

- **New file:** `data/settings.json` — runtime source of truth, atomic write via `filesystem.ts`
- **New module:** `src/modules/settings.ts` — load/save/validate, exposes typed `Settings` interface
- **Migration:** On first run with existing `.env`, seed `settings.json` from `process.env` values, then `.env` is no longer read at runtime
- **Secrets on desktop:** Stored in `settings.json` (already in encrypted data folder)
- **Secrets on mobile:** Use Capacitor `@capacitor/preferences` + secure storage plugin
- **Live config bus:** Settings changes emit events; modules subscribe (e.g., `llm.ts` re-reads model on change)
- **Type safety:** All settings strongly typed in `src/types/settings.ts`
- **Sacred boundary:** Settings UI is pure TypeScript/React. No LLM involvement.

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/modules/settings.ts` | NEW — load, save, validate, event bus |
| `src/types/settings.ts` | NEW — `Settings` interface |
| `app/(tabs)/settings.tsx` (or modal) | NEW — Settings UI shell with section navigation |
| `app/components/settings/*` | NEW — one component per section |
| `app/components/SetupWizard.tsx` | NEW — first-run flow |
| `src/modules/llm.ts` | Read model from settings module instead of `process.env` directly |
| `scripts/headless-runner.js` | Read schedule + paths from `settings.json` (with `.env` fallback) |
| `data/settings.json.example` | NEW — documented example |
| `docs/new_architecture_typescript.md` | Document settings module + new data file |
| `README.md` | Update setup instructions to point to in-app wizard |

---

## Testing Notes

- [ ] Unit tests for settings load/save/validate
- [ ] Unit tests for `.env` -> `settings.json` migration
- [ ] Integration test: first-run wizard end-to-end
- [ ] Test masked secret display does not leak the value to the DOM
- [ ] Test live update of polling interval without restart
- [ ] Test on Capacitor iOS and Android builds
- [ ] Test corrupted `settings.json` recovery

---

## Open Questions

- Should the API key live in `settings.json` or in OS keychain (desktop) + Capacitor secure storage (mobile)? Keychain is more secure but adds complexity
- Do we want a "Reset to defaults" button? Risky but useful for support
- Should we expose temperature / max tokens to users, or keep them developer-only in Advanced?
- For the first-run wizard, do we let users skip the API key (browse-only mode) or hard-block?
- How do we handle the existing `.env` after migration — delete it, leave it, or rename to `.env.migrated`?
