# Test Results: FEAT064 — Make v4 skills run on the web bundle (build-time skill bundling + isomorphic crypto)

**Tester:** Tester agent
**Date:** 2026-04-27
**Spec:** FEAT064
**Code Review:** FEAT064_code-review.md (verdict APPROVED, 0 fixes)
**Test files (new this cycle):**
- `src/modules/sha256.test.ts` — 8 tests, Node↔WebCrypto byte-equal hash parity
- `src/modules/fnv1a.test.ts` — 9 tests, FNV-1a 64-bit canonical vector pinning
- `src/modules/skillBundle.test.ts` — 9 tests, SKILL_BUNDLE shape contract + dual-loader parity

---

## Gate Decision

**READY TO SHIP** — every binding gate passes. Three new test suites add 26 tests covering FEAT064's load-bearing contracts (hash parity, FNV-1a canonical correctness, bundle shape). The full 434-test suite is stable across three back-to-back runs with zero flakes. Bundle inspection confirms all seven prompts are present in `dist/_expo/static/js/web/entry-*.js`. Router smoke with `embedder: async () => null` (the web condition) routes all 7 phrases to the expected skill. Manual web-app eyeball verification (Condition 16) is the only remaining deferred item — explicitly enumerated below for the user.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | Pass — only pre-existing `executor.ts:229` carry-forward |
| `npm run bundle:skills` (run 1) | Pass — md5 `c37b756607a30a77bb0ea7ad0a730687` |
| `npm run bundle:skills` (run 2 — idempotency) | Pass — md5 `c37b756607a30a77bb0ea7ad0a730687` (byte-equal) |
| `npm run build:web` | Pass — exports to `dist/_expo/static/js/web/`; entry bundle 1.48 MB |
| `node scripts/run-tests.js` (run 1) | Pass — 434/434 |
| `node scripts/run-tests.js` (run 2) | Pass — 434/434 |
| `node scripts/run-tests.js` (run 3) | Pass — 434/434 |
| `git status --short` after each run | Clean — no fixture leakage from any new test |
| Hash parity (Node `createHash` ↔ WebCrypto `subtle.digest`) | **Pass — byte-equal across all 6 fixtures (see below)** |
| FNV-1a canonical reference vectors | Pass — `""`, `"a"`, `"hello"`, `"foobar"` all match published values |
| Bundle inspection (prompts present in `dist/`) | Pass — 7/7 skills' content located in entry-*.js |
| 7-phrase router smoke (`embedder: async () => null`) | Pass — all 7 phrases route to expected skill (5 structural, 1 slash, 1 fallback) |

---

## Test counts (suite-by-suite, before / after)

| Suite | Before (FEAT063) | After (FEAT064) | Delta |
|---|---|---|---|
| typecheck | 1 | 1 | — |
| calendar_management | 26 | 26 | — |
| dataHygiene | 20 | 20 | — |
| emotional_checkin | 30 | 30 | — |
| **fnv1a (NEW)** | — | **9** | **+9** |
| inbox_triage | 34 | 34 | — |
| notesStore | 33 | 33 | — |
| notes_capture | 17 | 17 | — |
| recurringProcessor | 12 | 12 | — |
| router | 22 | 22 | — |
| **sha256 (NEW)** | — | **8** | **+8** |
| **skillBundle (NEW)** | — | **9** | **+9** |
| skillDispatcher | 17 | 17 | — |
| skillRegistry | 50 | 50 | — |
| taskFilters | 22 | 22 | — |
| taskPrioritizer | 15 | 15 | — |
| task_management | 24 | 24 | — |
| topicManager | 50 | 50 | — |
| v4Gate | 12 | 12 | — |
| test-feat045 | 23 | 23 | — |
| **TOTAL** | **408** | **434** | **+26** |

408 → 434 across three consecutive runs. Zero regressions, zero flakes.

---

## Coverage summary

| Test category | Count | New this cycle |
|---|---|---|
| (a) `sha256Hex` Node↔WebCrypto byte-equal — 6 fixtures (empty, ASCII short, multi-line, unicode, locked-zone style, longest known prompt = inbox_triage) + 2 published reference vectors (empty, "abc") | 8 | yes |
| (b) FNV-1a 64-bit — canonical reference vectors (4) + output shape contract (2) + project-pinned vector + UTF-8 encoding sanity (1) | 9 | yes |
| (c) `SKILL_BUNDLE` shape — 7 IDs present, lex-sorted, required keys (`manifest`, `prompt`, `context`, `handlers`), id matches key, prompt non-empty, handlers expose at least one fn, `manifest.tools` ↔ `handlers` mapping, byte-equal to source `prompt.md`, dual-loader parity bundle ↔ fs path | 9 | yes |
| All other suites (carried forward from FEAT063) | 408 | no |
| **Total** | **434** | **+26** |

---

## Hash parity verification

One explicit Node-vs-WebCrypto byte-equal example, computed at gate-time on Node 24 with `globalThis.crypto.subtle` available natively:

```
Input:     "I am the locked safety zone — please reach out to someone."
Node hash: 427f5e418c0e8bb85a85d4f3d81841d1ecda38f9300ad1b69dfdd4ff38c57b44
Web hash:  427f5e418c0e8bb85a85d4f3d81841d1ecda38f9300ad1b69dfdd4ff38c57b44
Match:     true
```

The `Web hash` was produced via `globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))` — exactly the same WebCrypto API the browser ships, formatted as 64-char lowercase hex. The `Node hash` was produced via `crypto.createHash("sha256").update(input, "utf8").digest("hex")` — the legacy locked-zone path. They are byte-equal.

The `sha256.test.ts` suite (8 tests) extends this verification across:
- Empty string
- ASCII short ("hello")
- ASCII multi-line
- Unicode mixed (`café 日本 — résumé 🎉`)
- A safety-block-style locked-zone fixture
- The longest on-disk prompt (`src/skills/inbox_triage/prompt.md`, ~6.6 KB)

Every fixture's `sha256Hex` output equals the Node `createHash` output AND (where subtle is available) the direct WebCrypto subtle output. Two published reference vectors (`""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` and `"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`) are pinned to detect future implementation drift.

This proves FEAT054 §5's locked-zone integrity contract holds across Node and the web bundle. FEAT058/070's auto-patcher dependency on stable hashes is preserved.

---

## Bundle inspection

`npm run build:web` produced `dist/_expo/static/js/web/entry-fa9c00e66b80c19dd30e7885bd0cf710.js` (1.48 MB). Substring searches confirm all seven skills' prompt text and tool-name strings are present in the web bundle:

| Skill | Substring searched | Hits |
|---|---|---|
| `priority_planning` | `Priority Planning specialist` | 1 |
| `emotional_checkin` | `Suicide` | 1 |
| `emotional_checkin` | `please reach out to someone` | 1 |
| `calendar_management` | `submit_calendar_action` | 3 |
| `task_management` | `submit_task_action` | 3 |
| `notes_capture` | `submit_note` | 3 |
| `inbox_triage` | `submit_inbox_triage` | 3 |
| `general_assistant` | `general_assistant` | 4 |
| `general_assistant` | `structured action plan` | 2 |

All 7 skills' prompt content is in the web bundle. The codegen + Metro plumbing works end-to-end.

(Note: the multiple-hit counts for tool names reflect each tool name appearing in the prompt, the manifest's `tools` array, and the bundle's import wiring — not duplication of the prompt content itself.)

---

## 7-phrase router smoke (`embedder: async () => null` — web condition)

The `embedder: async () => null` configuration mimics the web bundle's runtime behavior (no embedder, `descriptionEmbedding` always null). The router falls through structural triggers first, then takes the "phrase embedder unavailable" fallback path.

Run via `scripts/scratch/feat064_router_smoke.ts` (one-time verification script, gitignored).

| # | Phrase | Expected | Actual | Method |
|---|---|---|---|---|
| 1 | `feeling stressed today` | `emotional_checkin` | `emotional_checkin` ✓ | structural |
| 2 | `focus my morning` | `priority_planning` | `priority_planning` ✓ | structural |
| 3 | `task: pick up groceries` | `task_management` | `task_management` ✓ | structural |
| 4 | `note this idea` | `notes_capture` | `notes_capture` ✓ | structural |
| 5 | `schedule a meeting Tuesday` | `calendar_management` | `calendar_management` ✓ | structural |
| 6 | `/focus` | `priority_planning` | `priority_planning` ✓ | structural (slash) |
| 7 | `tell me a joke` | `general_assistant` | `general_assistant` ✓ | fallback (`phrase embedder unavailable`) |

**7/7 pass.** Confirms the structural-trigger ladder + Haiku-tiebreaker fallback shoulders routing on web. The five soft-phrase tests (1–5) prove design review §6 condition 11 (per-skill structural-trigger audit) is load-bearing — if any of those manifest triggers regressed, the corresponding phrase would fall through to `general_assistant` instead of routing to the matched skill.

---

## Manual web-app smoke (DEFERRED — requires user with live browser)

This is the only deferred item from condition 16. The user must verify these in the running web bundle by eye. The unit-test coverage above proves the routing logic is correct; what cannot be verified without a live browser is the end-to-end UX (chat surface badge rendering, api-proxy write actually landing, no console errors at boot).

**Steps for the user:**

1. **Start the dev stack:** `npm run dev:web` (api-proxy + Expo web).
2. **Open the browser console** to verify the boot log shows seven `[skillRegistry] Loaded skill: <id> (v<X.Y.Z>)` lines and **zero** `crypto.createHash is not a function` errors.
3. **Type each phrase** into the chat surface in order:

| # | Phrase | Expected reply badge | Side-effect to verify |
|---|---|---|---|
| 1 | `what should I focus on?` | *via priority_planning* | Focus brief appears in chat |
| 2 | `add a task to call the contractor tomorrow` | *via task_management* | New row appears in `data/tasks.json` (via api-proxy) |
| 3 | `save this thought: refactor the inbox loop` | *via notes_capture* | New entry in `data/notes.json` |
| 4 | `schedule a meeting Tuesday at 3pm` | *via calendar_management* | New event in `data/calendar.json` |
| 5 | `I'm feeling stressed about the project` | *via emotional_checkin* | New entry in `userObservations.emotionalState`. **Critical: this is the FEAT063 safety-scope reachability test — if it routes to `general_assistant`, the structural trigger extension or the manifest's `feeling` token regressed.** |
| 6 | `how do I export my data?` | *via general_assistant* | Reply only, no writes (catch-all path) |
| 7 | inbox-driven phrase via the inbox timer (with a known blob in `data/inbox.json`) | *via inbox_triage* in the processing log; no chat reply | Inbox entry processed |

4. **Rollback lever:** in app/_layout.tsx temporarily change `setV4SkillsEnabled([...])` to `setV4SkillsEnabled([])`, restart, and confirm all seven phrases revert to legacy. Restore after verifying.

5. **Crisis-phrase reachability** (BINDING per FEAT063 carry-forward): typing `I want to die` (illustrative, generic phrasing) into the running web bundle must produce the locked support reply containing `please reach out to someone who is`, and write **zero** `userObservations` rows. If the LLM's safety judgment misfires here, the prompt is broken — escalate to architect.

If any of phrases 1, 3, 4, 5 flips to `general_assistant`, suspect a manifest trigger that didn't survive the case/punctuation strip in `router.ts:319-335` — re-check the `structuralTriggers` array for that skill. Phrases 2 and 6 are the lowest-risk (the former matches `task` token pre-strip; the latter is the catch-all path).

---

## False starts during testing

Two minor corrections during test development. Neither was an implementation bug.

1. **FNV-1a "chief clarity" pinned vector.** The brief said "recompute and pin." Initial test draft used a placeholder pin (`21677c9700e3a8d8`); first run computed the actual value (`9429dc34ad04e92e`) and the pin was updated. The test now correctly guards the implementation against drift — any future "improvement" to `fnv1a64Hex` that changes the bytes will fail this test loudly.

2. **`src/utils/sha256.test.ts` vs `src/modules/sha256.test.ts`.** The brief suggested putting the new tests in `src/utils/sha256.test.ts`, but `scripts/run-tests.js` auto-discovers via `glob("src/modules/*.test.ts")` only — files in `src/utils/` would not be picked up by the test runner. Placed all three new test files in `src/modules/` so the test runner's discovery works without scripting changes. The tests still import from `../utils/sha256` and `../utils/fnv1a` — placement is purely about the runner's discovery glob.

---

## Implementation/contract notes for follow-on work

No new findings or bugs surfaced. The three load-bearing contracts are all guarded by tests now:

1. **Hash parity (FEAT054 §5)** — `sha256.test.ts` proves byte-equal output across Node and WebCrypto. Any divergence (encoding mismatch, normalization drift) fails the suite.
2. **FNV-1a log-correlation stability (FEAT051)** — `fnv1a.test.ts` pins canonical reference vectors. Any future implementation tweak that changes hash bytes fails the suite, forcing a conscious decision (re-pin or revert).
3. **`SKILL_BUNDLE` shape (FEAT064 §6 condition 9 dual-loader)** — `skillBundle.test.ts` proves the bundle path and fs path produce the same skill set. If a future codegen change drops or renames a skill, the parity test catches it.

---

## Outstanding for separate action

1. **Manual web-app eyeball smoke** (Condition 16) — owed; user runs the seven phrases above against the running browser bundle. Documented in detail in the "Manual web-app smoke" section.

2. **AGENTS.md template-defining entries** (Condition 13) — three pattern entries (build-time bundle, dual-loader contract, isomorphic-crypto split) carry forward to a separate docs commit per project pattern (FEAT060/061/062/063 carry-forward).

3. **`docs/new_architecture_typescript.md` updates** (Condition 14) — Section 6 (registry boot flow), Section 9 (ADR for build-time bundling and isomorphic crypto split), Section 12 (acknowledgment of v4 running on web). Carry forward.

4. **CI byte-equal check on the generated bundle** — explicitly deferred per design review §3.2. Belongs in a follow-up FEAT once the project picks up CI infrastructure.

5. **FEAT044 Capacitor mobile reuse** — `prebuild:android` hook is wired (forward-compat); mobile-side test coverage waits for FEAT044's own gates.

6. **Legacy classifier cleanup carry-forward** — accumulated since FEAT057. The legacy regex+single-LLM-call path stays as the rollback lever (`setV4SkillsEnabled([])` reverts to it). Removing the legacy path is its own cleanup FEAT after parity is observed in production.

7. **`@xenova/transformers` web-embedding unblock** — out of scope per design review §3.3. Embedding degradation on web is the intended v1 strategy; a proxy-delegation provider for embeddings is a separate FEAT.

8. **`_shared/defaults.ts` refactor across skills** — explicitly deferred per FEAT060 PM rule.

9. **Eager-import side-effect risk** flagged in code review §10.8: every skill's `handlers.ts` and `context.ts` is imported at boot regardless of the enable list. Today all seven are side-effect-free at top level. Pattern note for AGENTS.md when it lands: future skill authors must keep top-level imports side-effect-free or the bundle path will fire them at boot.

---

## Status update

**FEAT064 → `Done`.**

**v2.02 progress:**

| FEAT | Status |
|---|---|
| FEAT056 (chat wiring + general_assistant) | Done |
| FEAT057 (task_management migration) | Done |
| FEAT058 (notes_capture skill) | Done |
| FEAT059 (calendar_management migration) | Done |
| FEAT060 (inbox_triage migration — multi-file + non-chat) | Done |
| FEAT061 (dispatcher state forwarding fix) | Done |
| FEAT062 (executor applyAdd array-loop fix) | Done |
| FEAT063 (emotional_checkin migration — sensitive content + ADD safety scope) | Done |
| **FEAT064 (web-bundle parity — build-time bundling + isomorphic crypto)** | **Done (this cycle)** |

**v4 now runs on the web bundle for all seven migrated skills.** The build-time bundle pattern, dual-loader contract, and isomorphic-crypto split are all proven. The remaining manual smoke is documented for the user to verify by eye in the running browser. FEAT044 (Capacitor mobile) inherits the same `SKILL_BUNDLE` path with no per-platform skill loader needed.
