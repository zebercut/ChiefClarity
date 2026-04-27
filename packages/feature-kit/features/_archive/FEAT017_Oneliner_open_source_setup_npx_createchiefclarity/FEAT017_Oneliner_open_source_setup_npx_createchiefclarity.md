# FEAT017 — One-liner open source setup (npx create-chief-clarity)

**Status:** Planned
**MoSCoW:** SHOULD
**Category:** Platform
**Priority:** 2  
**Created:** 2026-04-03

---

## Summary

A zero-dependency npm `create-*` package that clones the repo, installs dependencies, configures `.env`, scaffolds the data folder, and prints start instructions — all from a single command: `npx create-chief-clarity`.

---

## Problem Statement

Current setup requires 5+ manual steps (clone, install, copy .env, edit .env with API key and data path, run). This friction discourages adoption for an open-source project. Users expect a one-command setup experience like `create-react-app` or `create-next-app`.

---

## User Stories

### Story 1 — New user
**As a** new user, **I want** to run one command to set up Chief Clarity, **so that** I can start using it without reading setup docs.

**Acceptance Criteria:**
- [ ] `npx create-chief-clarity` clones repo, installs deps, prompts for config, creates `.env`, scaffolds data folder
- [ ] Works on Windows, macOS, Linux without modification

### Story 2 — Power user / CI
**As a** power user, **I want** a non-interactive mode, **so that** I can script the setup.

**Acceptance Criteria:**
- [ ] `npx create-chief-clarity --api-key=sk-... --data-path=~/data --yes` runs without prompts
- [ ] `--start` flag optionally auto-launches the app

---

## Workflow

```
npx create-chief-clarity
  |
  v
Preflight (Node >= 20, git, npm)
  |
  v
Clone repo (or detect existing)
  |
  v
npm install
  |
  v
Detect existing .env? --> Yes --> "Reconfigure? (y/N)"
  |                                    |
  No                              No: skip
  |                                    |
  v                                    v
Prompt: API key (non-empty)       Done
Prompt: Data folder path (default: ~/ChiefClarityData)
  |
  v
Write .env (forward slashes for paths)
  |
  v
Create data folder + plan/ subdirectory + empty inbox.txt
  |
  v
Print "Setup complete. Run: npm run dev"
(or auto-launch if --start flag)
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Directory already exists with valid clone | Skip clone, proceed to install/configure |
| `.env` already exists | Ask to reconfigure; in `--yes` mode, skip unless flags provided |
| User Ctrl+C during setup | Clean exit, partial state is safe (no half-written files) |
| Node < 20 | Clear error with install link |
| git not installed | Clear error with install link |
| Windows backslash paths | Normalize to forward slashes in `.env` |
| Re-run after successful setup | Idempotent — detects existing state, offers reconfigure |

---

## Success Metrics

- Setup time from zero to running app < 3 minutes
- Zero user-reported setup failures on Windows/macOS/Linux

---

## Out of Scope

- Data file scaffolding (loader.ts DEFAULTS handles this)
- API key validation (app setup wizard does this with real API call)
- Auto-installing Node.js
- Shell script wrapper (setup.sh) — dropped, adds nothing if Node is required

---

## Architecture Notes

**Package:** `packages/create-chief-clarity/` — standalone npm package, zero dependencies.

Uses only Node built-ins: `readline/promises`, `child_process`, `fs`, `path`, `os`.

**Flags:**
- `--api-key=VALUE` — Anthropic API key
- `--data-path=VALUE` — Data folder path
- `--dir=VALUE` — Install directory (default: `./ChiefClarity`)
- `--yes` / `-y` — Non-interactive mode
- `--start` — Auto-launch after setup

**Key design decisions:**
- Zero npm dependencies — fast npx download, no supply chain risk
- No API key prefix validation — Anthropic key format varies
- Default to NOT auto-launching — print instructions, `--start` for opt-in
- Forward slashes in `.env` — cross-platform safe
- `os.homedir()` for default paths — not shell variable expansion

---

## Implementation Notes

| File | Change |
|------|--------|
| `packages/create-chief-clarity/package.json` | Create — npm package manifest |
| `packages/create-chief-clarity/bin/init.mjs` | Create — core CLI logic (~250 lines) |
| `README.md` | Update Quick Start section |

**Reference files (no changes):**
- `src/modules/loader.ts` — FILE_MAP and DEFAULTS confirm app handles missing data files
- `.env.example` — current env var format
- `app/setup.tsx` — first-run wizard validates API key

---

## Testing Notes

- [ ] Run from temp directory — full clone+install+configure flow
- [ ] Run from existing clone — detect and skip to configure
- [ ] Run with `--api-key=test --data-path=./tmp --yes` — non-interactive
- [ ] Run with existing `.env` — offer reconfigure, don't overwrite
- [ ] Run with Node 18 — clear error message
- [ ] Run without git — clear error message
- [ ] After npm publish: `npx create-chief-clarity` on clean machine

---

## Open Questions

- npm account: Who publishes and maintains the `create-chief-clarity` package?
- CI publish: Add GitHub Actions workflow to auto-publish on tag/release?
