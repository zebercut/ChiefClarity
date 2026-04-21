# Code Review: FEAT035 — In-App Settings Panel

**Reviewer:** Code Reviewer Agent  
**Date:** 2026-04-14  
**Spec:** FEAT035_InApp_Settings_Panel.md  
**Design Review:** NOT FOUND (feature has no design review document)

## Overall Status

**CHANGES REQUIRED** — The feature is effectively unimplemented. No Coder output exists to review. The feature status in both the spec and the manifest is "Planned" with 0% progress, which matches the code state: none of the planned artifacts exist.

Before this review can be meaningful, the feature must be:
1. Architected (design review) — currently skipped
2. Implemented by the Coder — currently not done

## Implementation Inventory

| Planned Artifact | Status | Notes |
|------------------|--------|-------|
| `src/modules/settings.ts` | MISSING | Core load/save/validate/event bus module |
| `src/types/settings.ts` | MISSING | Settings interface |
| `app/(tabs)/settings.tsx` | MISSING | No Settings tab in `NAV_ITEMS` |
| `app/components/settings/*` | MISSING | Section components |
| `app/components/SetupWizard.tsx` | MISSING | Setup flow exists at `app/setup.tsx` but is a full page, not a reusable component |
| `data/settings.json` | MISSING | |
| `data/settings.json.example` | MISSING | |
| `src/modules/llm.ts` updates | MISSING | Still reads directly from `process.env` (lines 81-83) |
| `scripts/headless-runner.js` updates | MISSING | Still reads directly from `process.env` |

## Correctness

- [ ] Story 1 (First-run setup) — NOT MET. A setup flow exists at `app/setup.tsx` but it's not a wizard component per the spec, and it's not invoked by a settings-absent check.
- [ ] Story 2 (Edit settings later) — NOT MET. No Settings icon in nav, no Settings panel.
- [ ] Story 3 (Mobile parity) — NOT MET. Capacitor build still cannot function because no `settings.json` runtime source of truth exists.
- [ ] Story 4 (Replace a secret safely) — NOT MET. No secret masking UI exists.

## Bugs

No new code to evaluate for bugs. The existing adjacent code has issues that block this feature (see Architecture Compliance).

## Security

- **Secrets still in `.env` plaintext:** Spec requires secrets to move out of `.env` and into masked/secure storage. Not done. On mobile builds, `.env` is unavailable at runtime — this feature is a prerequisite for mobile to function.
- **No write-only secret input pattern:** Spec requires replace-key flow with masked dots + last 4 chars. No UI exists.

## Performance

N/A — no code to review.

## Architecture Compliance

Issues found in adjacent code that block or undermine this feature:

### Issue 1 — `llm.ts` reads configuration directly from `process.env`
**File:** `src/modules/llm.ts:81-83`  
**Problem:** Model IDs are read from `process.env` at module-load time:
```typescript
const HAIKU = _env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
const SONNET = _env.LLM_MODEL_HEAVY || "claude-sonnet-4-6";
```
This makes live-update of model choice (FEAT035 Story 2 AC: "Live-updateable settings apply without restart") impossible without a settings module that can be re-read at call time.

**Required change:** Wrap model resolution in a function that consults the settings module first, then falls back to `process.env`. Do not capture the model ID at module-load time.

### Issue 2 — `headless-runner.js` reads directly from `process.env`
**File:** `scripts/headless-runner.js:30-32`  
**Problem:** Data path and API key are read from `process.env`, breaking mobile parity and preventing runtime reconfiguration.

**Required change:** Add a settings.json read with `.env` fallback. The spec explicitly calls this out in Implementation Notes.

### Issue 3 — `app/setup.tsx` is not reusable
**Problem:** The existing first-run setup is a full page (~950 LOC) with hardcoded step order. The spec requires a reusable `SetupWizard.tsx` component that can be mounted from a settings-missing check and also from a "re-run setup" Settings entry point.

**Required change:** Extract the step logic and UI into `app/components/SetupWizard.tsx`. The standalone page can then be a thin wrapper that mounts the wizard.

### Issue 4 — `GoogleCalendarSettings.tsx` orphaned
**File:** `src/components/GoogleCalendarSettings.tsx`  
**Problem:** The component's header comment says "Can be embedded in the Settings panel (FEAT035) or used standalone" — but it is not imported anywhere. It was built speculatively for this feature.

**Not a required change for this feature,** but the orphan should be wired into the Settings panel during implementation.

## Code Quality

N/A — no new code.

## Testability

- [ ] No `src/modules/settings.test.ts` for load/save/validate
- [ ] No migration test for `.env` → `settings.json`
- [ ] No corrupted-settings-file recovery test
- [ ] No masked-secret-leak test

All items listed in the spec's Testing Notes are not satisfied because the code doesn't exist.

## Required Changes

This feature cannot be approved by Code Review until the Coder agent produces the implementation. Specifically:

1. **MUST — Implement core module:** Create `src/types/settings.ts` with the `Settings` interface covering all spec categories (Profile, AI & Model, Data & Storage, Security, Sync & Background, Notifications & Nudges, Appearance, Advanced).
2. **MUST — Implement settings module:** Create `src/modules/settings.ts` with load/save/validate and an event bus so modules can subscribe to changes.
3. **MUST — Implement UI:** Create `app/(tabs)/settings.tsx` and section components. Add Settings entry to `NAV_ITEMS` in `_layout.tsx`.
4. **MUST — Refactor setup flow:** Extract `app/components/SetupWizard.tsx` from `app/setup.tsx` so it can be reused.
5. **MUST — Rewire `llm.ts`:** Replace module-load-time `process.env` reads with a function that consults settings first.
6. **MUST — Rewire `headless-runner.js`:** Same — prefer settings.json, fall back to `.env`.
7. **MUST — Implement migration:** On first app start with an existing `.env` and no `settings.json`, seed `settings.json` from `process.env`.
8. **MUST — Add tests:** Per the spec's Testing Notes — load/save/validate unit tests, migration test, corrupted-file recovery, masked-secret-leak.
9. **SHOULD — Get a design review first:** FEAT023 went through a design review that caught three concrete defects before code review. FEAT035 is more complex (secrets, mobile parity, event bus, migration) and would benefit from the same rigor before the Coder starts.

## Optional Suggestions

- Consider whether temperature/max-tokens exposure (listed as an open question in the spec) should be resolved in design review before coding begins — changing this after the UI is built is wasteful.
- The `GoogleCalendarSettings.tsx` component was built for this feature but is currently orphaned. Either integrate it during implementation or delete it to avoid dead code accumulation.

---

## Reviewer Note on Scope

The user asked the Code Reviewer to "review the related code and fix the issues." Code Reviewer does not implement features or rewrite missing code — that is the Coder agent's job. This review documents the gap; the next step is to invoke either:

- The **Architect agent** to produce a design review for FEAT035, or
- The **Coder agent** to implement the feature against the existing spec

If the intent was specifically to fix the adjacent-code issues (llm.ts env reads, headless-runner env reads, setup.tsx reusability, GoogleCalendarSettings orphan), those are tracked in the Architecture Compliance section above as REQUIRED CHANGES but are part of the Coder's implementation of FEAT035, not standalone cleanup.
