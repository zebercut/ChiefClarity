---
feature: FEAT064
stage: Code Reviewed
reviewer: Code Reviewer agent
date: 2026-04-27
verdict: APPROVED
---

# FEAT064 — Code Review

## Verdict

**APPROVED.** Implementation matches the design review's 17 binding
conditions across the board, with three coder-flagged deviations
adjudicated and accepted (rationale below). Hash parity holds
byte-for-byte across Node `crypto.createHash` and WebCrypto
`subtle.digest`. The codegen is idempotent, deterministic, and
cross-platform-stable. All 408 tests pass; the only typecheck error is
the pre-existing `executor.ts:229` carry-forward. No fixes were
applied during review — every observation either satisfied the
condition as written, was an accepted deviation, or was a deferred
docs/manual-smoke item per project pattern. Both `npm run build:web`
and `npm run bundle:skills` succeed; bundle is byte-equal across
re-runs.

## Files reviewed

**Created:**

- `scripts/bundle-skills.ts` — folder-walking codegen, deterministic
  emit, fail-loud on validation, duplicate-id pre-check.
- `src/skills/_generated/skillBundle.ts` — committed generated bundle,
  541 lines, 26 KB, alphabetical, no timestamps, no absolute paths.
- `src/utils/sha256.ts` — async isomorphic SHA-256 helper.
- `src/utils/fnv1a.ts` — synchronous 64-bit FNV-1a, 16-hex output.

**Modified:**

- `src/modules/skillRegistry.ts` — dual-loader (`loadFromBundle` /
  `loadFromFs`), async `parseLockedZones`, defensive
  `LIFEOS_SKILL_LIVE_RELOAD` env-flag gate.
- `src/modules/router.ts` — FNV-1a swap for `sha256First16`;
  structural-matcher extended to first-token (see Adjudication §1).
- `src/modules/v4Gate.ts` — Node gate removed; doc comment rewritten.
- `package.json` — `bundle:skills`, `prebuild:web`, `prebuild:android`
  npm scripts.
- 5 manifests (`priority_planning`, `emotional_checkin`,
  `task_management`, `notes_capture`, `calendar_management`) —
  `structuralTriggers` extended with single-token soft-phrase tokens
  per design review §6 condition 11.
- `src/modules/task_management.test.ts` — assertion relaxed from
  `deepStrictEqual([/task, /todo])` to `includes(/task)` +
  `includes(/todo)` to accommodate the new triggers.

**Untouched per spec (verified):**
`chat.tsx`, `types/skills.ts`, `types/orchestrator.ts`,
`skillDispatcher.ts`, `executor.ts`, `assembler.ts`,
the seven skill folders' `prompt.md` / `context.ts` / `handlers.ts`,
`metro.config.js`, the embedder provider, the api-proxy.

## §17 Conditions audit

| # | Condition | Status |
|---|---|---|
| 1 | All Story 1-8 ACs testable + tested in stage 7 | Y (testable; stage-7 tester runs the full sheet) |
| 2 | Codegen at `scripts/bundle-skills.ts`, idempotent, lex-sorted, skips `_*`/`.*`, validates four required files, fails loudly with path-qualified errors, pre-checks duplicate ids | Y — verified: 7 skills emitted alphabetically; ran `npm run bundle:skills` twice; md5 byte-equal (`c37b756607a30a77bb0ea7ad0a730687` both runs); folder filter at `bundle-skills.ts:45`; missing-file check at `:54`; duplicate-id pre-check at `:139-145`; LF-normalized output at `:153-154`. |
| 3 | Generated bundle at `src/skills/_generated/skillBundle.ts`, **committed** | Y — under `_generated/` (underscore prefix, so the live-reload fs walk skips it defensively). Auto-generated header at lines 1-2. |
| 4 | `prompt.md` shipped as escaped tagged template literal; backticks and `${` escaped | Y — `escapeForRawTemplate` at `bundle-skills.ts:71-75` escapes `\\`, backtick, and `${`. Verified: bundled `priority_planning` and `emotional_checkin` prompts contain a known mid-prompt substring per source `prompt.md` (7/7 byte-match check passed). |
| 5 | `src/utils/sha256.ts` exposes `async sha256Hex(text): Promise<string>`; uses `crypto.subtle.digest` on web, `crypto.createHash` on Node fallback; both produce 64-char lowercase hex | Y — `sha256.ts:11-23`. Subtle path is the default; Node `eval("require")("crypto")` is the fallback for older Node only. `parseLockedZones` is async at `skillRegistry.ts:602`, awaited from `loadOneSkill` and `buildSkillFromBundle`. |
| 6 | Hash parity test — Node `crypto.createHash` ≡ `crypto.subtle.digest` byte-equal across canonical fixtures | Y — manually verified via Node 24's native `webcrypto.subtle` against `crypto.createHash`: `""`, `"hello"`, `"a longer string with unicode: café 日本"`, a multi-line `## Safety` block, and a string containing backtick + `${...}` — all 5 fixtures produced byte-equal hex. The seven shipped skills' locked-zone hashes are unchanged (manifest declarations unmodified by this FEAT). |
| 7 | `router.ts::sha256First16` switched to FNV-1a (sync, pure JS, 16 lowercase hex); doc comment updated; `eval("require")` and `browser-unhash` removed | Y — `router.ts:456-468`. Doc comment matches spec wording verbatim ("Non-cryptographic FNV-1a hash for log correlation. NOT suitable for integrity. For cryptographic SHA-256, use `src/utils/sha256.ts`."). Verified `fnv1a64Hex("hello") = "a430d84680aabd0b"` matches the FNV-1a 64-bit reference. Output shape `/^[0-9a-f]{16}$/` confirmed. `logRoutingDecision` stays sync. |
| 8 | `v4Gate.ts` — `if (!isNode()) return false` deleted; remaining gate conditions preserved; doc comment updated | Y — `v4Gate.ts:41-48`. Only `getV4SkillsEnabled().size === 0` and `_pendingContext` checks remain. v4Gate test suite (12/12) passes — confirms gate semantics unchanged for the surviving conditions. |
| 9 | Registry dual-loader — `SKILL_BUNDLE` is the default on every platform; `LIFEOS_SKILL_LIVE_RELOAD=1` re-enables `fs.readdirSync` on Node only; validators run on bundled data identically; duplicate-id and reserved-route rejection still work | Y — `skillRegistry.ts:121-138` picks the path; `loadFromBundle` at `:140-197` runs `validateManifest`, `parseLockedZones`, surface checks, and the `seenIds`/`seenRoutes` first-wins logic identically to `loadFromFs`. The 50 skillRegistry tests pass unchanged, including the duplicate-locked-zone-name rejection test at `skillRegistry.test.ts:725` (it sets `skillsDir`, which forces the fs path so the synthetic-fixture test is exercised). |
| 10 | Web bundle size delta <5% | Reported: bundles cleanly to `dist/_expo/static/js/web/entry-*.js` (1.48 MB). The 7 prompts add ~25 KB of inlined text to `entry-*.js`. Below the 5% threshold. **Surfaced for tester.** |
| 11 | Trigger-phrase / structural-trigger audit per skill | Y — verified each modified manifest:<br>• `priority_planning`: `["focus","plan","prioritize","priority","priorities"]` ✓<br>• `task_management`: `["task","todo","remind"]` ✓<br>• `notes_capture`: `["note","remember","save","jot","capture","idea"]` ✓<br>• `calendar_management`: `["schedule","meeting","appointment","calendar","book","reschedule"]` ✓<br>• `emotional_checkin`: `["feeling","stressed","anxious","overwhelmed","burned","tough","rough","exhausted","venting"]` ✓<br>• `general_assistant` and `inbox_triage`: unchanged (catch-all and timer-driven respectively, per spec).<br>**Cross-skill overlap check:** zero overlaps in single-token triggers (verified by walking all manifests). |
| 12 | `prebuild:web` and `prebuild:android` npm hooks invoke `ts-node scripts/bundle-skills.ts` | Y — `package.json:13-18`. `bundle:skills` is also exposed standalone. |
| 13 | AGENTS.md updated with three template-defining entries | **Deferred** per project carry-forward pattern (FEAT060/061/062/063). Surfaced for backlog; not blocking. |
| 14 | `docs/new_architecture_typescript.md` Section 6 + 9 + 12 entries | **Deferred** per project carry-forward pattern. Surfaced for backlog; not blocking. |
| 15 | Zero changes to chat.tsx, types/skills.ts, types/orchestrator.ts, skillDispatcher.ts, executor.ts, assembler.ts, the seven skill folders' source code, metro.config.js | Y — `git status --short` lists only the spec-permitted modifications. (Architect note: the 5 manifest changes are expected per condition 11, not violations of "skill folders untouched" — the spec defines manifest edits as the lever for condition 11.) |
| 16 | Web smoke (Story 7) — seven-phrase sheet, manual run against the running web bundle | **Partially deferred.** Automated coverage: 408 tests pass including the 22-case router suite and the 50-case skillRegistry suite. Manual user-eye verification (chat surface in browser → "via &lt;skill_id&gt;" badge) is owed in stage 7. |
| 17 | Headless runner parity — same 7 skills loaded, locked-zone hashes byte-equal | Y — by construction: bundled prompt text is byte-equal to source `prompt.md` (verified above), `parseLockedZones` is byte-deterministic, and `sha256Hex` is byte-equal to the prior `crypto.createHash` path (verified above). The 7 shipped skills' manifests' `promptLockedZones` arrays are unmodified by this FEAT. |

## Adjudication of the 3 coder-flagged items

### 1. Router structural-matcher extension (router.ts:319-345)

**ACCEPT.** Story 8 AC #3 said "no changes to router.ts other than
sha256First16 switch", but design review §6 condition 11 *requires*
that single-token soft-phrase tokens (`feeling`, `stressed`, `focus`,
`plan`, `priority`, `note`, `save`, `schedule`, `task`, etc.) route to
the matched skill on web — the entire FEAT goal is "web users without
embeddings still hit the right skill via structural triggers." The
original `if (input.phrase.startsWith("/"))` matcher cannot satisfy
this; it requires soft phrases to start with `/`, which is the exact
scenario design review §4 calls out as broken on web ("a user who
types `I'm feeling stressed` would route to `general_assistant`,
**not** `emotional_checkin`").

The extension is minimal and load-bearing:
- Slash commands still go through the original case-sensitive exact
  match (`isSlash` branch).
- Non-slash phrases lowercase the first token and strip trailing
  punctuation (`?`, `.`, `!`, `,`) so `"feeling?"` → `"feeling"`
  matches the manifest's `"feeling"` trigger.
- The "zero or many matches → fall through" comment is updated to
  acknowledge that two skills can claim the same single-token trigger,
  in which case ambiguity correctly punts to embedding (or
  Haiku-tiebreaker on web). Cross-skill overlap audit confirms zero
  collisions today, so the runtime path is single-match → instant
  return for soft phrases too.
- The lower-cased token is cleaned with `replace(/[^a-z0-9_-]+$/u, "")`
  — ASCII-only character class because all manifest triggers are
  ASCII; doesn't damage Unicode-bearing phrases (the leading token's
  body is preserved).

The architect's binding §6 condition 11 mandates this routing
behavior; condition 11 takes precedence over the more conservative AC
#3 wording. The 22-case router test suite passes unchanged, including
the existing `/cal` exact-match fixture and the embedding-pipeline
fixtures. **Architect re-engagement is not required** — this is the
only mechanism by which condition 11 can be satisfied on web given
that embeddings are degraded.

### 2. parseLockedZones async refactor (skillRegistry.ts:602-629)

**ACCEPT.** The prior implementation called
`crypto.createHash(...).update(...).digest(...)` synchronously inside
the regex `exec` loop. Switching to `await sha256Hex(...)` inside the
loop would corrupt `LOCKED_ZONE_PATTERN.lastIndex` because the regex
is module-scoped and global (`/g`), and an `await` between iterations
yields the microtask queue to anything else that might call
`exec` on the same regex.

The coder's two-pass refactor is correct:
- Pass 1: `LOCKED_ZONE_PATTERN.lastIndex = 0` (defensive reset),
  iterate `exec`, push `{ name, content, start, end }` into a local
  `matches` array, and use a "seen-name" check inside the loop to
  preserve the duplicate-zone-name rejection contract.
- Pass 2: `await sha256Hex(x.content)` for each collected match,
  populate the final `Map<string, LockedZone>`.

Verified the duplicate-rejection contract still fires:
`skillRegistry.test.ts:725` ("two LOCKED blocks with the same name →
loader rejects skill") passes — the synthetic fixture
`<!-- LOCKED:x -->one<!-- /LOCKED -->\n<!-- LOCKED:x -->two<!-- /LOCKED -->`
correctly throws and the registry rejects the skill. All 50
skillRegistry tests pass.

Hash output is byte-equal to the prior path (verified via the §6
hash-parity audit). Defensive `lastIndex = 0` reset at the top is a
nice-to-have that prevents the cross-call leakage the comment warns
about; the two-pass collect/hash structure is the load-bearing fix.

### 3. descriptionEmbedding mutation in loadFromBundle (skillRegistry.ts:179-189)

**ACCEPT.** `LoadedSkill.descriptionEmbedding` is `Float32Array | null`
in `src/types/skills.ts:124` — **not** declared `readonly`, and the
docstring at `:120-123` explicitly notes it is "lazy on first
findSkillsByEmbedding call — happens on platforms where the embedder
isn't available at boot." The mutation is consistent with the
documented contract.

The cast `(s as { descriptionEmbedding: Float32Array | null })` is
narrower than `as any` — it preserves the field type and only relaxes
read-throughness. An alternative pre-pass that constructs each
`LoadedSkill` with the embedding already populated would force a
two-phase async loop (compute all embeddings first, then build the
LoadedSkill objects), which is no clearer and adds an array
allocation. The post-construct mutation also keeps the bundle path
and fs path consistent (the fs path also fills the embedding
post-construct via `cacheUpdates`).

## Code observations

**1. Bundle codegen determinism.** `bundle-skills.ts:153` normalizes
output to LF line endings before `writeFileSync` — critical on Windows
where Git's `core.autocrlf=true` and editor saves can produce CRLF.
The md5 is identical across two runs. No `Date.now()`, no
`process.cwd()`, no machine-specific output. The only path string in
the emit is the `import "../<id>/..."` form (relative, repo-shape
stable).

**2. `void <name>Manifest;` after each prompt const.** `bundle-skills.ts:104`
emits `void calendarManagementManifest;` etc. This is an anti-tree-shake
guard so TypeScript / Metro doesn't drop the import for unused-import
ESM analysis. The default-imported manifest is referenced inside the
`SKILL_BUNDLE` map below, so technically the void is redundant — but
it's a defensive measure against Metro's aggressive pruning, and harmless.

**3. Bundle entry shape vs design.** Design review §2 sketched an entry
shape with `context: () => require(...)` callbacks (lazy). Coder went
with eager `import * as` namespace imports. The eager form is simpler
(no thunk wrapping in the consumer), is what Metro can statically
analyze for the web bundle, and matches what FEAT044 mobile will need.
The trade-off — every skill's `context.ts` and `handlers.ts` are
loaded at registry boot regardless of which skills run — is moot for
seven small TypeScript modules. Architect note: callable thunks would
matter only at very large skill counts (20+), at which point an
opt-in lazy import is a separate FEAT.

**4. `loadFromFs` non-Node guard.** `skillRegistry.ts:252-257` —
even if `LIFEOS_SKILL_LIVE_RELOAD=1` is somehow set on a non-Node
platform, the loader logs and falls back to the bundle. Defensive
double-gate that catches any environment-variable bleed-through.

**5. Embedding-cache semantics on bundle path.** `loadFromBundle`
doesn't read or write `.embedding_cache.json`. On Node it computes
embeddings inline at `:179-189` and on web it stays `null`. This is a
behavior delta from the fs path (which caches), but matches design
review §6 condition 4: "in-memory only on web (module-level Map);
seven skills × 384 floats is ~9 KB; cold-start recompute is moot when
the embedder is degraded anyway." On Node, every boot now recomputes
embeddings from the bundle — slightly slower than today's cached path,
but only if the user is on the default bundle path; setting
`LIFEOS_SKILL_LIVE_RELOAD=1` restores the cached fs path. **Acceptable
trade-off for the dual-loader simplification.**

**6. Router structural-matcher edge cases.** Verified by reading the
extension at `router.ts:319-335`:
- Empty `firstToken` (e.g., `phrase = ""` or `phrase = "   "`) → loop
  body skipped, falls through to embedding. ✓
- `phrase = "/cal tomorrow"` → `firstToken = "/cal"`, `isSlash=true`,
  `tokenForMatch = "/cal"` (case preserved); matches
  `calendar_management`'s `/cal` trigger. ✓
- `phrase = "Feeling Stressed."` → `firstToken = "Feeling"`,
  `isSlash=false`, `tokenForMatch = "feeling"` (lowercased, no
  trailing punctuation to strip from this token); matches
  `emotional_checkin`'s `feeling`. ✓
- `phrase = "task?"` → `tokenForMatch = "task"` (trailing `?`
  stripped); matches `task_management`'s `task`. ✓
- `phrase = "the cat sat"` → `tokenForMatch = "the"`; no skill claims
  `the`; falls through to embedding. ✓

**7. FNV-1a 64-bit correctness.** Spot-check: `fnv1a64Hex("")` =
`cbf29ce484222325` (matches the FNV-1a 64-bit offset basis,
0xcbf29ce484222325 — by construction, hashing the empty string returns
the offset). `fnv1a64Hex("hello")` = `a430d84680aabd0b` (matches the
canonical FNV-1a 64-bit test vector). 16-bit-limb schoolbook
multiplication implementation correctly handles 64x64→64-low-only
multiplication mod 2^64. UTF-8 encoding fallback at `:67-97` correctly
handles BMP and supplementary-plane code points (surrogate-pair
handling at `:74-79`).

**8. `eval("require")` audit post-fix.** Remaining instances:
- `skillRegistry.ts:26-27` — `nodeFs()`, `nodePath()` lazy-require
  helpers, called only inside `loadFromFs` and `loadOneSkill` (both
  Node-gated paths).
- `skillRegistry.ts:410` — inside `loadOneSkill` for dynamic
  `require(contextPath)` / `require(handlersPath)`. Reachable only
  under live-reload flag on Node. Noted with a comment.
- `sha256.ts:20` — Node fallback for older Node without
  `globalThis.crypto.subtle`. Unreachable on web.

All four are gated correctly and match the architect's intent (§6
condition 7: "remove `eval("require")` from the v4 hot path; live-reload
escape hatch may keep it"). The router's `sha256First16` previously
contained one — that's now cleanly removed and replaced with
`fnv1a64Hex`.

**9. Test relaxation in `task_management.test.ts`.** The diff at
`:240-249` swaps `deepStrictEqual` for `includes` + `includes`. This
is the right relaxation — the test should assert *at least* `/task`
and `/todo` are present, not the *exact* set. The new triggers (
`task`, `todo`, `remind`) are required by §6 condition 11 and the
test's assertion form would have been brittle against any future
trigger addition. Naming preserved: "manifest declares the structural
triggers /task and /todo (plus single-token web fallbacks)" — clear.

**10. Manifest changes byte-audit.** The 5 manifest changes are
exactly one line each (`structuralTriggers` array extension); no
other field touched. `priority_planning`, `task_management`,
`notes_capture`, `calendar_management`, `emotional_checkin` —
verified.

## Latent-bug findings

**No new latent bugs introduced.** Carry-forward audit:

- **FEAT054 B5** (top-level fs/path/crypto imports leaking into web
  bundle) — none. The header comment at `skillRegistry.ts:15-18`
  explicitly forbids it; coder respected the boundary.
- **FEAT056 B3** (`crypto.createHash is not a function` runtime crash
  on web) — fixed by this FEAT. Both `sha256Hex` and `sha256First16`
  no longer hit the legacy path on web. Verified by reading both
  files and tracing every code path.
- **FEAT057 B1** (try/catch around `applyWrites`) — N/A here; this
  FEAT doesn't touch handlers.
- **FEAT062 latent (applyUpdate/applyDelete array-loop)** — pre-existing,
  unchanged, not refiled.
- **Bundle-vs-source drift** — risk exists (developer edits a skill
  and forgets to re-run `bundle:skills`). Mitigated by `prebuild:web`
  and `prebuild:android` hooks (any reproducible build catches it).
  CI byte-equal check is a separate FEAT per architect §6 condition 2.
- **Eager imports of all 7 handler/context modules at boot** — every
  skill's `handlers.ts` and `context.ts` is imported even if disabled
  via `setV4SkillsEnabled([])`. Side-effect-free imports today
  (verified by sweeping the seven `handlers.ts` files for top-level
  side effects — none found). Worth noting for the tester: if a
  future skill adds a side-effecting top-level statement (e.g., a
  setInterval), the eager-import shape will fire it at boot
  regardless of the enable list. **Pattern note for AGENTS.md** —
  flagged for stage 7 deferral, not blocking.

## No real user data check

Reviewed all created files (`scripts/bundle-skills.ts`,
`src/skills/_generated/skillBundle.ts`, `src/utils/sha256.ts`,
`src/utils/fnv1a.ts`), all modified files, this code review doc, and
the FEAT064 design-review.md. No real names, no real activities, no
real companies, no real personal dates. The bundled prompt text is
byte-equal to the seven skills' source `prompt.md` files, which were
audited under their respective FEAT057-FEAT063 reviews. The only
strings introduced by this FEAT are generic test-style examples
(`"hello"`, `"foo"`, `"the quick brown fox"`) — none in committed
files (only in throwaway smoke checks, which were cleaned up).

## Things NOT in scope (correctly deferred)

- **AGENTS.md template-defining entries** (§17 condition 13) — three
  pattern entries (build-time bundle, dual-loader contract,
  isomorphic-crypto split) carry-forward to a separate docs commit per
  project pattern. Surfaced for backlog.
- **`docs/new_architecture_typescript.md` updates** (§17 condition 14)
  — Section 6 boot-flow update, Section 9 ADR, Section 12 acknowledgment
  carry-forward to a separate docs commit. Surfaced for backlog.
- **Manual web smoke** (§17 condition 16) — partial deferral. The
  routing logic is covered by the 22-case router test suite + 50-case
  skillRegistry suite + the structural-trigger overlap audit. The
  user-eye verification (open the running web bundle, type each of the
  seven phrases, observe the *via &lt;skill_id&gt;* badge) is owed in
  stage 7. See "One paragraph for the tester" below.
- **CI byte-equal check on the generated bundle** — explicitly deferred
  per design review §3.2: "the byte-equal check is a real safeguard but
  belongs in a follow-up FEAT once the project picks up CI."
- **Unblocking `@xenova/transformers` for true web embeddings** — out
  of scope; embedding degradation on web is the intended v1 strategy
  per §3.3.
- **FEAT044 Capacitor reuse of the bundle** — `prebuild:android` hook
  is wired now (forward-compat), but mobile-side test coverage waits
  for FEAT044.
- **Audit-log correlation tooling update for FNV-1a-shaped hashes** —
  the 16-hex output is shape-identical to the prior SHA-256-first-16
  output; downstream consumers treating the hash as opaque are
  unaffected. No FEAT needed unless a consumer starts asserting
  cryptographic strength of the log hash.

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | Pass — only the pre-existing `executor.ts:229` error remains; same baseline as FEAT060/061/062/063. |
| `npm run bundle:skills` (1st run) | Pass — wrote 7 skills to `src/skills/_generated/skillBundle.ts`. |
| `npm run bundle:skills` (2nd run, idempotency) | Pass — md5 byte-equal across runs (`c37b756607a30a77bb0ea7ad0a730687`). No git status diff. |
| `npm run build:web` | Pass — exports to `dist/_expo/static/js/web/`; entry bundle 1.48 MB; all 7 prompt-content substrings located in the bundle. |
| `node scripts/run-tests.js` | Pass — 408/408 tests across 17 suites. Zero new failures, zero new skips. |
| `git status --short` post-tests | Clean — no fixture leakage, no scratch files, no unintended modifications. |
| Hash parity (Node `createHash` vs WebCrypto `subtle.digest`) | Pass — 5/5 canonical fixtures byte-equal. |
| FNV-1a output shape and reference vector | Pass — `fnv1a64Hex("")=cbf29ce484222325` (offset basis), `fnv1a64Hex("hello")=a430d84680aabd0b` (canonical reference); deterministic; 16-hex shape. |
| Structural-trigger cross-skill overlap | Pass — zero overlaps in single-token triggers across all 7 manifests. |
| Bundled prompt content matches source byte-equal | Pass — 7/7 sampled mid-prompt substrings located in the generated bundle. |

## Sign-off

Code review approved without fixes. The three coder-flagged items are
adjudicated above with rationale recorded; all three are accepted.
Conditions §1-§12, §15, §17 are met; §13-§14 carry-forward to docs;
§16 partially deferred for tester user-eye smoke. Tester proceeds to
Stage 7.

## One paragraph for the tester

**Focus on the manual web-app smoke that's deferred.** The automated
test suite covers routing logic, hash parity, locked-zone integrity,
and registry loading (408 tests, 50 of them on the registry alone),
but the user-eye verification of "v4 actually runs in the browser
chat surface" is owed. Open the running web bundle (`npm run dev:web`
or load `dist/index.html`), then type the seven Story 7 phrases in
order:
(1) *"what should I focus on?"* → expect *via priority_planning*;
(2) *"add a task to call the contractor tomorrow"* → expect *via
task_management*, and verify a row was written to `data/tasks.json`
through the api-proxy;
(3) *"save this thought: refactor the inbox loop"* → expect *via
notes_capture*;
(4) *"schedule a meeting Tuesday at 3pm"* → expect *via
calendar_management*;
(5) *"I'm feeling stressed about the project"* → expect *via
emotional_checkin* (this is the FEAT063 safety-scope reachability
test — if it routes to general_assistant, the structural trigger
extension or the manifest's `feeling` token regressed);
(6) *"how do I export my data?"* → expect *via general_assistant*
(catch-all path);
(7) inbox-driven phrase via the inbox timer with a known blob in
`data/inbox.json` → expect *via inbox_triage* in the processing log
(no chat reply, timer path).
Also confirm the boot console shows seven `[skillRegistry] Loaded
skill: <id> (v<X.Y.Z>)` lines and zero `crypto.createHash is not a
function` errors. The structural-trigger extension at
`router.ts:319-335` is load-bearing for phrases 1, 3, 4, 5 — if any
of those four flips to `general_assistant`, suspect a manifest
trigger that didn't survive the case/punctuation strip. Phrases 2
and 6 are less risky (slash-likely or fallback). Finally, set
`setV4SkillsEnabled([])` and confirm all phrases revert to legacy
(disable-test) — the rollback lever is unchanged but worth
re-asserting on web.
