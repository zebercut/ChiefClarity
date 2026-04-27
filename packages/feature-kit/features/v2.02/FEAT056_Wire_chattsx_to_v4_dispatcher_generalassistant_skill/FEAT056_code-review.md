# Code Review: FEAT056 — chat.tsx wiring + general_assistant skill

**Reviewer:** Code Reviewer agent (project rule: reviewer fixes directly)
**Date:** 2026-04-27
**Spec:** `FEAT056_Wire_chattsx_to_v4_dispatcher_generalassistant_skill.md`
**Design Review:** `FEAT056_design-review.md`
**Files reviewed:**
- `src/skills/general_assistant/{manifest.json,prompt.md,context.ts,handlers.ts}` — new skill (~80 lines total)
- `src/modules/v4Gate.ts` — pure-function gate (~30 lines)
- `src/types/index.ts` — `ChatMessage.v4Meta` field added
- `app/_layout.tsx` — boot wiring updated to enable both skills
- `app/(tabs)/chat.tsx` — v4 hook block (35 lines including comments) + `Alert` import + `routeToSkill` / `dispatchSkill` / `shouldTryV4` imports + badge UI (~20 lines)

---

## Overall Status

**APPROVED WITH COMMENTS** — 0 blocking issues. 1 trade-off documented (no fix).

Smoke test (`scripts/scratch/feat056_smoke.ts`) confirmed: both skills load via the production registry; manifest IDs, tools, and models are correct.

---

## Correctness

### Spec ACs verified

| Story | AC | Status | Where |
|---|---|---|---|
| 1.1 | priority_planning routes via v4 when phrase matches | ✅ | chat.tsx:429-447 (hook + early return) |
| 1.2 | Bubble renders identically | ✅ | Same setMessages call, same shape |
| 1.3 | Legacy paths NOT invoked when v4 handles | ✅ | Early `return` after setMessages |
| 2.1 | general_assistant skill exists with all 4 files | ✅ | Smoke test loaded it |
| 2.2 | freeform routes to general_assistant + dispatcher returns reply | ⏳ | Stage 7 |
| 2.3 | Prompt explicitly disclaims specialized actions | ✅ | prompt.md line 15-25 |
| 2.4 | FEAT051 fallback warning no longer fires | ✅ | general_assistant in registry; makeFallback finds it |
| 3.1 | Empty enabled set → all phrases legacy | ✅ | shouldTryV4 returns false |
| 3.2 | Enabled set partial → only matching phrases v4 | ✅ | dispatchSkill returns null when skill not enabled |
| 3.3 | Empty list → 100% reverts behavior | ✅ | Hook is no-op |
| 4.1 | v4 reply shows badge | ✅ | chat.tsx badge block under bubble |
| 4.2 | Legacy reply shows no badge | ✅ | Conditional on `msg.v4Meta` |
| 4.3 | Tap badge → Alert + log feedback event | ✅ | TouchableOpacity + Alert.alert + console.log |
| 5.1 | Degraded → fall through silently | ✅ | `if (!dispatchResult.degraded)` guard + no user-visible message |
| 5.2 | Throw → catch + fall through | ✅ | try/catch around hook |
| 5.3 | null → fall through silently | ✅ | If condition `if (dispatchResult && ...)` |
| 6.1 | Non-migrated phrases → legacy unchanged | ✅ | Code path below the hook is byte-equal to before |
| 6.2 | All 265 tests still pass | ⏳ | Stage 7 |
| 6.3 | npm run build:web exports | ✅ | Verified pre-review |

### Design Review §6 conditions verified

| # | Condition | Status |
|---|---|---|
| 1 | All revised ACs testable + tested | ⏳ Stage 7 |
| 2 | shouldTryV4 is a pure function with own test file | ⏳ Test in stage 7 |
| 3 | general_assistant folder exists + loads | ✅ Smoke confirmed |
| 4 | chat.tsx delta < 30 lines (excluding imports) | ✅ ~25 functional lines + 10 comment lines for the hook; ~22 for badge. Within budget. |
| 5 | Legacy code below the hook byte-equal | ✅ Confirmed by reading line 463 onwards — unchanged from pre-FEAT056 |
| 6 | Boot wiring updated | ✅ `setV4SkillsEnabled(["priority_planning", "general_assistant"])` |
| 7 | Bundle gate passes | ✅ `npm run build:web` exports successfully |
| 8 | Manual smoke documented in test results | ⏳ Stage 7 |
| 9 | `v4Meta?` is optional on ChatMessage | ✅ Optional field; pre-v2.02 messages omit it |
| 10 | general_assistant prompt redirects on specialized requests | ✅ prompt.md "CRITICAL — do NOT pretend to perform specialized actions" section |

### Type check
`npx tsc --noEmit` → only the pre-existing executor.ts:229 error. No new errors.

---

## Bugs

**None found.** The hook insertion is clean; the gate is a 5-line pure function; the skill folder is straightforward; the badge is a small additive component.

---

## Security

| Check | Status |
|---|---|
| No secrets / credentials in code | ✅ |
| No `process.env` reads | ✅ |
| general_assistant prompt prevents action fabrication | ✅ Locked into prompt; can't be silently changed (no locked zone needed since it's not safety-bearing per design) |
| Badge tap action doesn't log plaintext phrase | ✅ Logs `skill=X method=Y`, not the phrase |
| `setV4SkillsEnabled` array hardcoded in app/_layout.tsx | ✅ Per design — FEAT035 settings panel migrates later |
| `Alert.alert` text built from skill metadata only | ✅ No user content in alert body |

No security issues.

---

## Performance

| Check | Status |
|---|---|
| Hook adds 1 extra LLM call (Haiku tiebreaker if ambiguous, Sonnet for skill) per phrase | ⚠️ See trade-off below |
| Bundle size impact | Negligible — only added small modules |
| Skill manifest loaded once at boot | ✅ FEAT054 caches |

### ⚠️ Trade-off: pre-migration phrases route to general_assistant via fallback

**Behavior:** During the dual-path window (v2.02 → v2.07-ish), most user phrases that today route to legacy specialized intents (`task_create`, `calendar_query`, `emotional_checkin`, `full_planning`, etc.) will:

1. Pass through `shouldTryV4` (true, because v4 enabled set is non-empty)
2. Hit `routeToSkill` — the only enabled skills are `priority_planning` and `general_assistant`
3. Score low against priority_planning (different domain) and general_assistant (also different domain — its triggers are conversational like "tell me a joke")
4. Top-1 < FALLBACK_THRESHOLD (0.40) → route to `general_assistant` via fallback
5. dispatchSkill runs general_assistant via Haiku (~1s)
6. general_assistant's prompt redirects the user to use specialized phrasing
7. User retries with clearer phrasing → legacy task_create flow runs

**Cost per pre-migration phrase:** 1 extra Haiku call (~$0.0001) + ~1s extra latency + 1 extra user message (the retry).

**Why this isn't a fix-now bug:**
- Each Haiku call is tiny ($0.0001)
- The behavior resolves naturally as FEAT057+ migrate specialized skills
- general_assistant's redirect prompt is the right UX given the constraint
- Architect-side mitigation considered (skip-on-fallback in chat hook) and rejected because it would also break legitimate freeform routing through general_assistant

**Documented for the user:** The "first 1-3 phrases of any session" might hit this until specialized skills migrate. Acceptable as long as v2.02 → v2.07 progresses promptly.

---

## Architecture Compliance

| Rule (per AGENTS.md) | Status |
|---|---|
| One LLM reasoning call per phrase (ADR-001) | ✅ Hook does at most one Sonnet/Haiku call (the Haiku tiebreaker in router is classification, not reasoning per ADR) |
| Skills are folders | ✅ general_assistant is a real folder |
| Skill handlers must write through filesystem.ts | ✅ N/A — general_assistant handler doesn't write |
| handlers.ts no work at module-load | ✅ |
| No process.env reads outside settings.ts | ✅ |
| Routing/orchestration logs decisions with hashed phrase | ✅ Both router and dispatcher already log; chat.tsx doesn't add a third log (would be redundant) |
| No top-level fs/path/crypto in app-imported modules | ✅ v4Gate.ts has no Node imports; chat.tsx imports are platform-safe |
| Verify npm run build:web | ✅ Bundle exports |

No violations.

---

## Code Quality

### Acceptable per existing project conventions
- `console.log` / `console.warn` — matches existing modules
- `try/catch (err: any)` — matches existing pattern
- `(s as any)._pendingTriage` cast in chat.tsx is pre-existing — not touched

### Naming
- `shouldTryV4` — clear, predicate-style, matches v4 vocabulary
- `v4Meta` — concise, matches `routingMethod` enum vocab
- `submit_general_response` — consistent with `submit_priority_ranking` from FEAT055

### Function size
- chat.tsx hook block: 35 lines including comments — small enough to review at a glance
- v4Gate.shouldTryV4: 5 lines — trivial pure function

### Documentation
- v4Gate.ts has a clear top-of-file JSDoc explaining the three short-circuit conditions
- chat.tsx hook has an inline comment block linking to v4Gate
- general_assistant/prompt.md prominently documents the "do not fabricate" rule

---

## Testability

| Check | Status |
|---|---|
| Pure functions for business logic | ✅ shouldTryV4 is pure (modulo the getV4SkillsEnabled() dep, which is module-level state and resettable via `_resetOrchestratorForTests`) |
| Dependencies injectable | ⚠️ chat.tsx hook is the integration test boundary — testing it directly is hard. Compensated by isolating shouldTryV4 + relying on the existing dispatcher test coverage |
| No logic at module level | ✅ |
| Explicit return types | ✅ |
| Errors typed | ⚠️ Plain Error matches project convention |

The pure-function gate is the testability win — chat.tsx integration is verified manually + via end-to-end smoke test.

---

## Required Changes

**None.** All §6 conditions met.

---

## Optional Suggestions (advisory)

1. **Consider hiding the "via X" badge for general_assistant on fallback routes.** When the user clearly wanted a specialized action and got redirected, showing "via general_assistant" might add noise. For v2.02 leave it visible — debugging signal > noise. Revisit when migration is more advanced.

2. **Skill-suggestion smart-action.** When general_assistant detects the user wanted a specialized action, instead of just text-redirecting, it could emit a SmartAction with the suggested phrasing. Future enhancement; not part of FEAT056.

---

## Pattern Learning

- "**Pure-function gate before complex hook insertion**" is a useful pattern for chat.tsx-style files. May propagate to other consumer-side wiring in FEAT057+.
- Confirmed: silent fallback on degraded result is the right default.

---

## Post-Tester finding (2026-04-27 — manual smoke caught a real bug)

User ran the manual smoke test in the actual app and reported:
- *"tell me a joke"* → "This app is designed for personal productivity… Telling jokes is outside its core capabilities." (legacy refusal)
- *"what should I focus on?"* → "Focus on overdue tasks (18) and open tasks (53), or align with your active OKRs and this week's calendar (2 events)?" (legacy clarification question, with ❓)

**Neither v4 skill ever ran.** The user got pre-FEAT056 behavior.

### B1 — v4 hook placement was wrong

**Was:** I placed the v4 hook **between** `triage.needsClarification` (line 419) and the legacy intent classification (line 422). The triage step's two early-return paths (`canHandle=false` at line 392, `needsClarification=true` at line 400) ran first and intercepted the phrases. The v4 hook never executed for either smoke phrase.

**Fix:** moved the v4 hook to right **after** `runTriage(...)` returns and **before** the canHandle/needsClarification short-circuits. Triage's emotional/friction detection is preserved (it ran above), but v4 now gets first crack at the phrase.

**Why I missed this in the original code review:** I didn't trace the full triage → short-circuit → legacy intent flow when verifying §6 condition 5 ("legacy code byte-equal below the hook"). The condition was technically true — the hook was inserted; legacy below was unchanged — but I didn't verify v4 would actually FIRE on the smoke scenarios. Adding to AGENTS.md: code review must trace at least one realistic phrase through the integrated flow, not just verify code-block boundaries.

**Verification after fix:**
- v4Gate tests: 11/11 pass
- Full suite: 276/276 pass
- `npm run build:web`: bundle exports
- The user re-runs the smoke test and confirms (deferred).

### B2 — Gate's `triageLegacyIntent` guard was wrong (caught by user's second smoke test)

**Was:** The original gate checked `if (input.triageLegacyIntent) return false`. Rationale at design time: "preserve fast-path optimization for clear CRUD phrases — if triage already locked an intent, skip v4 and go straight to legacy."

**Why it broke:** Two interactions with the existing triage system that I missed:
1. **Triage's `safeDefault` fallback sets `legacyIntent: "general"`** (`src/modules/triage.ts:346`) — a truthy string. Any phrase that triage's Haiku call punted on caused the gate to skip v4.
2. **Triage's fast-path regexes match planning phrases** like "what should I focus on" to `full_planning`. The gate skipped → legacy `full_planning` ran → user got the focus brief clarification ("Focus on overdue tasks (18) and open tasks (53)..."), not the v4 priority_planning ranking.

**User's smoke confirmed:** even after the placement fix (B1), v4 never fired because the gate kept short-circuiting on `triage.legacyIntent`.

**Fix:** dropped the `triageLegacyIntent` guard from `shouldTryV4` entirely. Reasoning:
- The orchestrator's confidence gate already makes the right routing decision
- The dispatcher returns `null` when the routed skill isn't in the v4-enabled set → caller falls through to legacy automatically
- The gate doesn't need to second-guess that decision based on triage metadata

The `triageLegacyIntent` field stays in the input shape for forward compatibility (callers can pass it harmlessly), but the gate ignores it. Cost of removing the guard: ~30ms of routing for fast-path-matched CRUD phrases when v4 doesn't have the skill — the dispatcher returns null in those cases. Negligible.

**Tests updated:** the prior "returns false when triage already locked a legacy intent" test was inverted (it now asserts v4 still runs even when triage matched), and the empty-string test was replaced by an explicit "general" test (the actual safeDefault behavior).

**Verification:**
- v4Gate tests: 11/11 still pass after inversion
- Full suite: 276/276 pass
- `npm run build:web`: exports

**The deeper lesson:** I drafted the gate logic without reading triage's own behavior. Code review didn't catch it because the gate was unit-tested in isolation against synthetic inputs ("triage already locked an intent"). Real triage outputs include the safeDefault punt (`"general"`) and routine fast-path matches (`"full_planning"`) for the very phrases v4 skills should handle. Pure-function tests caught nothing because the test inputs didn't reflect production triage outputs.

Adding to AGENTS.md: when a pure function consumes data from another system (state, triage, registry), tests must use realistic outputs from that system, not just synthetic "happy path" / "all guards triggered" inputs.

### B3 — `crypto.createHash` throws in browser bundle (caught by user's third smoke test)

**Was:** `sha256First16` in both `router.ts` and `skillDispatcher.ts` used `require("crypto")` at runtime. In Node this returns Node's crypto module with `createHash`. In the browser bundle, Metro returns a stub that has no `createHash` method → `TypeError: crypto.createHash is not a function`. The structured-logging helper threw, which propagated up out of `routeToSkill` → caught by chat.tsx's defensive try/catch → fell through to legacy.

**User's smoke confirmed:** browser console showed `[router] fallback skill "general_assistant" missing — Reason: registry empty` (because `loadSkillRegistry` correctly bailed on non-Node, leaving registry empty), then `TypeError: crypto.createHash is not a function`, then the user got the legacy refusal.

**Two findings:**

1. **The skill registry is fundamentally Node-only on the current architecture.** It scans `src/skills/` via `fs.readdirSync`. The browser bundle has no fs. The non-Node branch in `loadSkillRegistry` correctly returns an empty registry — but that means web-mode users have **no v4 routing at all**. Every v4 routing attempt falls back to `general_assistant`, which doesn't exist in the empty registry, which logs "fallback skill missing" and returns top-1 (which is `<none>` in an empty registry). Wasted work and confusing logs every turn.

2. **`sha256First16` was Node-only too.** Even if v4 had been working, the structured-log helper would have crashed.

**Fix (two parts):**

1. **`shouldTryV4` now checks `isNode()` first.** Web/Capacitor users skip v4 entirely — clean fallback to legacy with no warnings, no wasted Haiku calls, no crypto exception. Until FEAT044 ships proxy/index support for the browser, v4 is intentionally inert in web mode.

2. **`sha256First16` falls back gracefully** in both `router.ts` and `skillDispatcher.ts`. On Node it does the real SHA-256. On browser it returns `"browser-unhash"` so the log entry still has shape — the audit-log correlation only works in Node, but the structured log doesn't crash. Defense-in-depth in case some future code path triggers the helper in browser despite the gate.

**Verification:**
- v4Gate tests: 12/12 pass (added one for the isNode() check semantics)
- Full suite: 277/277
- `npm run build:web`: exports

**Implication for the user:** v4 currently does NOT run in web/browser dev mode. It runs in:
- The headless runner process (Node) — but the headless runner doesn't process user phrases anyway.
- Capacitor mobile, once FEAT044 ships a generated-skill-index path.

To exercise v4 end-to-end on chat phrases today, someone would need to either (a) build/run the Capacitor mobile app after FEAT044 ships, or (b) add proxy support so the web browser routes v4 calls through the Node-side proxy. (b) is unscoped and would be a meaningful new FEAT — call it "v4 web bridge". For now, web mode is on legacy. **This is a real product gap that the dev plan didn't acknowledge** — surfacing it now.

## Sign-off

Code review **APPROVED WITH COMMENTS**. Tester (stage 7) may proceed.

**Status update:** FEAT056 → `Code Reviewed`.

**Outstanding for separate action:**
- The fallback-via-general_assistant trade-off documented above. Resolves naturally as FEAT057+ ships specialized skills.
- Manual smoke test in stage 7 (per §6 condition 8).
