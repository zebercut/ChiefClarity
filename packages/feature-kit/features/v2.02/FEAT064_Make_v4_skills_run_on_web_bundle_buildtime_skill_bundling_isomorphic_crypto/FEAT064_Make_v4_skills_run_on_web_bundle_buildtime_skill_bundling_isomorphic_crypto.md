# FEAT064 — Make v4 skills run on the web bundle (build-time skill bundling + isomorphic crypto)

**Type:** feature
**Status:** Planned (PM stage 1 — awaiting human review before architect picks it up for stages 3–4)
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v2.02 (Phase 2 — infrastructure unblock for the migrated skill set)
**Tags:** skill-architecture, v4, web-support, build-system, isomorphic-crypto
**Created:** 2026-04-27

**Depends on:** FEAT054 (Done — registry + locked-zone hashing), FEAT051 (Done — router + embeddings), FEAT055 (Done — dispatcher + first POC skill), FEAT056 (Done — chat wiring + general_assistant), FEAT057-FEAT063 (Done — seven migrated skills)
**Unblocks:** Real user adoption of v4 (today the migrations are foundation-only); FEAT044 mobile/Capacitor (uses the same bundling shape); future skills FEAT070+ that assume v4 is live for everyone

---

## Status

Planned — PM has authored the spec. Awaiting human review before the
architect picks it up for stages 3–4 (design notes + design review).

---

## Problem Statement

The v4 skill stack is shipping migrations (FEAT055-063 = seven skills:
`priority_planning`, `general_assistant`, `task_management`,
`notes_capture`, `calendar_management`, `inbox_triage`,
`emotional_checkin`) but **none of them actually execute in the user's
running web app**. The user launches the web bundle, types a phrase,
and the chat surface routes through the legacy regex+single-LLM-call
path because `shouldTryV4` returns `false` on web. The migrations are
foundation, not running code. Every PR after FEAT054 has been merging
work that the user cannot exercise.

Two concrete blockers in `src/modules/skillRegistry.ts` and the v4
gate in `src/modules/v4Gate.ts`:

1. **Skill discovery via `fs.readdirSync`.** The registry walks
   `src/skills/<id>/` at boot to load `manifest.json`, `prompt.md`,
   `context.ts`, and `handlers.ts`. The web bundle has no `fs`. The
   `eval("require")` Node-bypass added during FEAT054 keeps Metro from
   resolving `fs`/`path`/`crypto` at bundle time, but it only works in
   a Node runtime. On web the module short-circuits at the
   `if (!isNode()) return buildRegistry([])` guard and the registry is
   empty, every skill is unknown, every dispatch is null.
2. **Locked-zone hashing via `crypto.createHash`.** Inside
   `parseLockedZones` the registry computes `sha256(content)` to
   integrity-pin LOCKED prompt blocks (FEAT054 §5 contract,
   FEAT058/070 auto-patcher dependency). Node has `crypto.createHash`;
   the browser has `crypto.subtle.digest` — different name, different
   shape, async vs sync. FEAT056 B3 already hit this once at runtime
   (`crypto.createHash is not a function`).

The v4 gate (`src/modules/v4Gate.ts:50`) currently hard-codes
`if (!isNode()) return false` to prevent confusing log spam from
bouncing every web-mode phrase off an empty registry. That gate is the
visible symptom; the bundling and crypto fixes are the root cause.

The architecture is already sound — the dispatcher, router,
locked-zone parser, defensive-defaults helpers, single-tool template,
and seven migrated skills are all isomorphic in design. **Only the
loading and hashing surfaces need to become isomorphic in
implementation.**

---

## Goals

1. The web bundle loads all seven migrated skills at boot — registry
   reports the same `loaded: [...]` set on web as on Node.
2. The web bundle computes locked-zone hashes correctly via WebCrypto
   `subtle.digest`. No runtime "createHash is not a function" errors.
3. `shouldTryV4` no longer Node-gates. The gate's other conditions
   (`getV4SkillsEnabled().size > 0`, `_pendingContext` check) keep
   working unchanged.
4. A user typing *"what should I focus on?"* into the web app's chat
   reaches the v4 path, hits `priority_planning`, and renders the
   skill's response — verifiable in the running web app, not just in
   tests.
5. The Node path (headless runner, tests, ts-node scripts) continues
   to work identically. No regression in the existing 315+ test
   baseline.
6. The build pipeline is reproducible — running `npm run build:web`
   from a clean checkout produces a bundle that loads all seven
   skills without any manual codegen step.
7. Adding a new skill (folder + four files) requires editing nothing
   beyond the skill's own folder and the boot enable-list. The
   bundling step picks up the new folder automatically on the next
   build.

---

## Success Metrics

- Web bundle boot log: `[skillRegistry] Loaded skill: <id>` lines for
  all seven migrated skills.
- Web bundle boot log: zero `crypto.createHash is not a function`
  warnings or thrown errors.
- Web bundle: pasting *"what should I focus on?"* into chat shows the
  *via priority_planning* badge in the assistant reply.
- Web bundle: pasting *"add a task to call the contractor tomorrow"*
  shows the *via task_management* badge.
- Headless runner (Node) parity: same skills loaded, same locked-zone
  hashes (byte-equal) as before this FEAT.
- `npm run build:web` exports without error from a clean checkout.
- All baseline tests pass.

---

## User Stories

### Story 1 — Build-time skill bundling

**As a** developer, **when** I run `npm run build:web`, **I want**
all seven skill folders to be aggregated into a single import-time
module that ships in the web bundle, **so that** the registry can
load skills without `fs`.

**Acceptance Criteria:**
- [ ] A bundling step runs as part of the web build (architect picks
      whether it is a `prebuild:web` script in `package.json`, an
      Expo prebuild hook, or a Metro custom resolver — see Open
      Question 1). The step takes zero arguments and is idempotent.
- [ ] The step produces a single generated module (proposed path:
      `src/skills/_generated/skillBundle.ts`; architect confirms)
      that exports a `SKILL_BUNDLE` map keyed by skill id with one
      entry per skill folder.
- [ ] Each entry includes the parsed `manifest.json`, the raw
      `prompt.md` text, the `context` module's exports, and the
      `handlers` module's exports — all available synchronously at
      module-load time.
- [ ] The generated module is committed-or-gitignored per architect
      decision (Open Question 2). If gitignored, `npm install` or a
      postinstall hook regenerates it; if committed, a CI check
      verifies it is in sync with the source folders.
- [ ] Adding a new skill folder under `src/skills/<id>/` and
      re-running the bundling step updates `SKILL_BUNDLE` to include
      the new entry without any other code edit. Folders prefixed
      `_` or `.` are skipped (matches today's `readdirSync` filter).
- [ ] Folders that fail validation at bundle time (missing one of
      the four required files, malformed `manifest.json`) cause the
      bundling step to **fail loudly** with a path-qualified error.
      The bundle is not produced. CI catches this.

### Story 2 — Registry consumes the bundle on web (and optionally on Node)

**As a** developer, **when** the registry loads on web, **I want** it
to read from `SKILL_BUNDLE` instead of touching `fs`, **so that** the
web bundle resolves skills without a Node runtime.

**Acceptance Criteria:**
- [ ] On web (`!isNode()`), `loadSkillRegistry` consumes
      `SKILL_BUNDLE` and produces the same `LoadedSkill[]` shape it
      produces on Node — same manifest, same prompt text, same
      `lockedZones` map, same `contextRequirements`, same handler
      function references. Validators (`validateManifest`,
      `parseLockedZones`, surface-route checks) run on the bundled
      data, not just the Node data.
- [ ] On Node, the registry continues to work exactly as today.
      Architect picks one of: (a) Node also reads from
      `SKILL_BUNDLE` (single code path, simpler), or (b) Node keeps
      `fs.readdirSync` for live-edit ergonomics during development
      (see Open Question 3). Either way, the LoadedSkill objects are
      structurally identical.
- [ ] The `eval("require")` and `require("fs"|"path"|"crypto")`
      calls are deleted from any code path that web reaches. (They
      may remain in the Node-only branch.)
- [ ] Duplicate-id and duplicate-route rejection still works on web
      (alphabetical first-wins, matches today's behavior).
- [ ] Reserved-route rejection still works on web (`RESERVED_ROUTES`
      check unchanged).

### Story 3 — Isomorphic SHA-256 for locked-zone hashing

**As a** developer, **when** the registry parses LOCKED zones in a
prompt, **I want** SHA-256 to work on both Node and web with no
runtime branch in the caller, **so that** the locked-zone hash
contract (FEAT054 §5) holds across platforms.

**Acceptance Criteria:**
- [ ] A new helper `src/utils/sha256.ts` (or equivalent — architect
      picks the location) exposes a single
      `async sha256Hex(text: string): Promise<string>` function. On
      Node it uses `crypto.createHash`. On web it uses
      `crypto.subtle.digest` and formats the result as a lowercase
      hex string.
- [ ] Both implementations produce the **byte-equal** hex output for
      the same UTF-8 input. A unit test asserts this against a
      handful of canonical strings (architect picks the fixture).
- [ ] `parseLockedZones` is converted to async and uses the helper.
      Its caller (`loadOneSkill`) is already async — no ripple
      beyond making the function `async` and `await`ing the regex
      loop.
- [ ] The `sha256First16` helper in `router.ts` (FEAT051 logging
      path-hash) also uses the new helper. The current "browser
      stub returns `browser-unhash`" code path is replaced with a
      real hash on web. (`sha256First16` becomes async; its single
      caller `logRoutingDecision` already runs after an `await`-able
      boundary — architect confirms there is no sync-call surface
      that breaks.)
- [ ] No new `eval("require")` or runtime-branch on `typeof` to
      detect Node. The helper picks its implementation by
      `isNode()` once.

### Story 4 — Lift the Node gate from `shouldTryV4`

**As a** user on the web bundle, **when** I type a phrase that one of
the seven migrated skills handles, **I want** the v4 path to run, **so
that** the migrations actually serve me.

**Acceptance Criteria:**
- [ ] The `if (!isNode()) return false` line in
      `src/modules/v4Gate.ts` is removed.
- [ ] The remaining gate conditions are preserved:
      `getV4SkillsEnabled().size === 0 → false`,
      `_pendingContext set → false`, otherwise `true`. Tests covering
      these conditions still pass.
- [ ] The doc comment at the top of `v4Gate.ts` is updated to
      reflect the new contract (the gate's purpose is now "v4 only
      runs when skills are enabled and the user isn't mid-
      clarification" — not "v4 only works on Node").
- [ ] On a fresh web bundle with the seven skills enabled in
      `app/_layout.tsx`, manual smoke against a phrase per skill
      shows v4 routing in the chat reply badges.

### Story 5 — Embedding cache fallback on web

**As a** developer, **when** the registry computes embeddings on
web, **I want** the cache layer to degrade cleanly, **so that** the
absence of a writable `fs` does not crash the registry or force
re-computation forever in tight loops.

**Acceptance Criteria:**
- [ ] On web, `readCache` and `writeCache` either no-op or use an
      in-memory map (architect picks; PM proposes in-memory only,
      recompute on cold start — see Open Question 4). The bge-m3
      embedder is fast enough that a cold-start recompute is
      acceptable for the seven-skill set.
- [ ] On web, no `fs` import is reached by the cache code path.
- [ ] On Node, the cache file behavior is unchanged (still
      `.embedding_cache.json` in the skills dir, atomic temp+rename
      write).
- [ ] If the embedder is unavailable on web (Open Question 5),
      `descriptionEmbedding` is `null` for every skill — the
      registry still loads, and the router falls back through its
      structural-trigger path and the Haiku tiebreaker. Embedding
      unavailability is a degraded-but-functional state, not a
      crash.

### Story 6 — Registry parity on Node

**As a** developer, **when** the bundling step ships, **I want** the
Node path's behavior to be identical to today's, **so that** the
headless runner, ts-node scripts, and tests do not regress.

**Acceptance Criteria:**
- [ ] Headless runner boot log matches today's skill-loaded set.
- [ ] All baseline tests (current 315+) pass without modification.
      Any test that asserted "registry empty on non-Node" is updated
      to assert the new contract (web loads the bundle).
- [ ] `npx ts-node` scripts that import `loadSkillRegistry` still
      work — either because Node also reads `SKILL_BUNDLE` (Open
      Question 3 option a) or because the Node `fs` path is
      preserved (option b).
- [ ] `npm run build:web` exports cleanly from a fresh checkout.

### Story 7 — Web smoke proves end-to-end execution

**As a** PM, **when** I open the web bundle after this FEAT lands, **I
want** to verify by hand that v4 is actually executing — not just that
the registry loaded — **so that** "migrations run" is provable, not
inferred.

**Acceptance Criteria:**
- [ ] Architect documents a seven-phrase smoke sheet (one phrase
      per migrated skill) in the design review.
- [ ] Each phrase, typed into the running web bundle's chat, returns
      a reply with the *via &lt;skill_id&gt;* badge.
- [ ] At least one phrase exercises a write (e.g., `task_management`
      adding a task) and the data file is updated on disk via the
      api-proxy. (This proves the chain works end-to-end on web,
      not just the routing.)
- [ ] One phrase routes to `general_assistant` (the freeform
      fallback) — proves that the embedding-similarity tiebreaker
      and the fallback skill-id resolution both work on web.

### Story 8 — No regression on existing surfaces

**Acceptance Criteria:**
- [ ] No changes to `app/(tabs)/chat.tsx` aside from what the gate
      lift implies (chat reads `shouldTryV4` and acts on it — no
      surface-level changes).
- [ ] No changes to `src/types/skills.ts` or
      `src/types/orchestrator.ts`.
- [ ] No changes to `src/modules/skillDispatcher.ts`,
      `src/modules/router.ts` (other than the `sha256First16`
      helper switch in Story 3), or `src/modules/executor.ts`.
- [ ] Setting `setV4SkillsEnabled([])` continues to revert every
      route to legacy on both Node and web — i.e., the rollback
      lever still works on web after this FEAT.
- [ ] `npm run build:web` exports.

---

## Out of Scope

- **FEAT044 Capacitor mobile.** Mobile uses Capacitor `Filesystem`
  rather than browser `fetch`, and may need a separate adapter for
  the embedder. The skill-bundling work in this FEAT *will*
  generalize to mobile (mobile and web both lack Node `fs`), but
  this FEAT only commits to **web parity**. FEAT044 ships separately.
- **Removing the legacy regex + single-LLM-call path.** Legacy stays
  as the rollback lever (`setV4SkillsEnabled([])` reverts to it) and
  the fallback when the dispatcher returns null. Removing it is a
  separate cleanup FEAT after parity is observed in production.
- **Migrating `okr_update`** (deferred — this was option D in the
  prior planning round; not part of this FEAT).
- **UI changes to chat.tsx.** FEAT056 wiring is already correct.
  This FEAT only un-gates v4 on web.
- **Topics work (FEAT083+).** Out of scope.
- **Audit log / privacy filter** (Phase 3).
- **Live-edit dev mode for skills on web.** Web's `SKILL_BUNDLE` is
  baked at build time. Editing a skill folder requires a rebuild.
  Whether to add a dev-mode hot-reload path is a future ergonomics
  FEAT (not this one).
- **Replacing `eval("require")` everywhere.** This FEAT only removes
  it from code paths that web reaches. Other Node-only modules
  using the same pattern (e.g., backups, headless runner internals)
  are untouched.

---

## Assumptions & Open Questions

**Assumptions:**

- `@xenova/transformers` is WASM-based and *can* run in the browser
  in principle (it ships with `onnxruntime-web`). However,
  `metro.config.js` currently has it in `blockList` for the web
  bundle. Whether to unblock it or to keep the embedder Node-only and
  degrade gracefully on web is Open Question 5.
- `LoadedSkill` shape (manifest + prompt + lockedZones +
  contextRequirements + handlers + descriptionEmbedding) is
  platform-agnostic. Nothing in the type forces a Node-specific
  representation.
- Metro supports importing `.json` natively via `require`/`import`.
  Importing `.md` as a string requires either a custom transformer
  or having the codegen script inline the prompt text as a string
  literal in `skillBundle.ts`. PM proposes the latter — sidesteps
  Metro config drift.
- `executor.applyWrites` and the seven migrated skills' handlers are
  already platform-neutral. Once the registry loads on web, dispatch
  works without further changes.
- `app/_layout.tsx`'s `setV4SkillsEnabled([...])` boot wiring is
  correct as-is. After the gate is lifted, those seven ids actually
  come into play on web.

**Open Questions for the Architect:**

1. **Bundling step location.** Three options: (a) a dedicated
   `scripts/bundle-skills.ts` chained into `package.json` as a
   `prebuild:web` hook (PM proposal — explicit, easy to reason
   about, runs on demand); (b) an Expo `expo prebuild` hook (more
   integrated but requires understanding Expo's config plugin
   surface); (c) a Metro custom resolver / virtual module (no extra
   files but adds a new Metro behavior to maintain). PM recommends
   (a) — small, explicit, no Metro magic, works for both
   `build:web` and any future `build:android` chain. Confirm.

2. **Generated bundle file: committed or gitignored?** PM mildly
   prefers gitignored + a `prebuild` hook that always regenerates
   (no merge-conflict risk on the generated file, no stale-bundle
   bugs). Architect picks. If committed, add a CI check that
   `bundle-skills.ts` produces a byte-equal output (so out-of-sync
   bundles get caught at PR review).

3. **Does Node also use `SKILL_BUNDLE`, or keep `fs.readdirSync`?**
   PM proposes Node also reads `SKILL_BUNDLE` (single code path —
   simpler to reason about, fewer divergence bugs). Trade-off: live
   editing a skill folder on Node now requires rerunning the
   bundling step. PM thinks that is acceptable because (a) skill
   folders change rarely once shipped, (b) the bundling step is
   fast (file IO + string concat), and (c) the headless runner
   already restarts to pick up code changes. Architect confirms.
   If the architect picks the dual-path option, surface the
   maintenance trade-off (two paths to keep in sync) in the design
   review.

4. **Embedding cache on web.** PM proposes in-memory only on web
   (a module-level `Map`). Cold start recomputes embeddings for
   the seven skills. Alternative: persist via `localStorage` /
   `AsyncStorage`. PM thinks `localStorage` is overkill for seven
   embeddings (~9 KB total at 384 floats × 4 bytes × 7 skills) but
   is fine if the embedder is slow on web. Tied to Open Question 5
   — if the embedder runs in WASM and is fast, in-memory is fine;
   if it is slow or off, the cache may need to persist.

5. **Embedder on web.** Three options: (a) unblock
   `@xenova/transformers` in `metro.config.js` and let it run via
   `onnxruntime-web` (WASM) in the browser; (b) keep it Node-only
   and degrade — `descriptionEmbedding = null` on web, router
   falls through to structural triggers + Haiku tiebreaker (the
   tiebreaker already handles this case via the
   "phrase embedder unavailable" fallback); (c) build a separate
   provider that delegates to the api-proxy for embeddings, the
   same way the proxy already brokers DB calls and embeddings on
   web. PM does not have a strong recommendation — flag as a
   stage-3 decision. **(b) is the lowest-risk path for parity** and
   is consistent with the FEAT056 B3 mitigation (graceful
   degradation). The Haiku tiebreaker already handles the
   "no embeddings" case.

6. **`prompt.md` shipping format.** PM proposes the codegen script
   reads each `prompt.md` file and emits its content as a string
   literal in `skillBundle.ts` (escaped, multi-line template
   literal). Sidesteps any Metro `.md` transformer config.
   Alternative: configure Metro to import `.md` as a string via a
   custom transformer (e.g., `metro-transformer-text`). PM
   recommends the codegen approach — fewer moving parts, no
   transformer dependency.

7. **`sha256First16` callers.** Making `sha256First16` async ripples
   to `logRoutingDecision`, which currently runs in the
   `routeToSkill` finally-style return path. PM thinks all callers
   are already on an async boundary, but the architect should
   sweep the call graph and confirm — if there is a sync caller,
   either keep a sync sha-1-hex fallback (cheap, non-cryptographic
   logging hash is fine) or refactor the caller to async. Logging
   does not need cryptographic SHA-256.

8. **Bundle ordering and determinism.** The current
   `fs.readdirSync` path sorts folder names alphabetically (line
   168: `.sort()`) so duplicate-id rejection is deterministic. The
   bundler must replicate this — emit `SKILL_BUNDLE` keys in
   alphabetical order so iteration order matches. PM proposes the
   architect call this out as a one-line comment in the codegen
   script and an assertion in the registry loader that pulls keys
   sorted.

9. **Can the seven currently-enabled skills load when the bundle
   ships?** Sanity check — none of the seven skills uses any
   Node-only API in `context.ts` or `handlers.ts`, but the
   architect should sweep them once before stage 4 to confirm.
   Anything that does (`require("fs")`, `process.env` read,
   `Buffer.from`, etc.) is a stage-3 risk to surface. PM hasn't
   audited line-by-line.

---

## Migration Template Confirmation

**N/A.** This is infrastructure work, not a skill migration. The
canonical migration template (single tool, array writes, lazy
executor import, try/catch around `applyWrites`, defensive defaults,
`setV4SkillsEnabled` boot-list addition — established by FEAT057 and
refined by FEAT058-FEAT063) is unchanged by this FEAT. The shape of
the seven existing skill folders is also unchanged — `manifest.json`,
`prompt.md`, `context.ts`, `handlers.ts` stay as the contract. The
only thing that changes is **how those four files reach the
registry** at runtime.

The new convention this FEAT introduces — *"the web/mobile bundle
loads skills from a build-time-generated `SKILL_BUNDLE` rather than
walking the filesystem"* — should be codified in `AGENTS.md` so
future skills ship correctly.

---

## References

- **Skill registry under fix:** `src/modules/skillRegistry.ts`
  (full file — `loadSkillRegistry`, `loadOneSkill`,
  `parseLockedZones`, `readCache`/`writeCache`, the `eval("require")`
  Node bypass added in FEAT054 B5).
- **Routing gate under fix:** `src/modules/v4Gate.ts:50` (the
  `if (!isNode()) return false` line).
- **Crypto-bug precedent:** FEAT056 B3 — `crypto.createHash is not a
  function` runtime error from the `sha256First16` log-hash helper in
  `src/modules/router.ts:446-462`.
- **Embedder provider:** `src/modules/embeddings/provider.ts` and the
  `metro.config.js` `blockList` (currently excludes
  `@xenova/transformers` and `onnxruntime` from the web bundle).
- **Boot wiring:** `app/_layout.tsx:317-325`
  (`setV4SkillsEnabled([...])` currently lists all seven migrated
  skills).
- **Build pipeline:** `package.json` — `build:web`, `dev`, `dev:web`,
  `build:android`, `build:ios` scripts. The bundling step needs to
  chain into `build:web` at a minimum and likely into `dev:web` for
  parity.
- **Skill folder spec:** `docs/v4/02_skill_registry.md`.
- **v4 non-negotiables:** `docs/v4/00_overview.md` (single LLM call
  per phrase, structured output only via tool use, etc.) — this FEAT
  must not introduce anything that violates those.
- **Architecture doc to update on landing:**
  `docs/new_architecture_typescript.md` (Section 6 — registry boot
  flow; Section 9 — ADR for build-time bundling and isomorphic
  crypto).
- **Filesystem abstraction (existing isomorphic precedent):**
  `src/utils/filesystem.ts` — establishes the
  `isNode()`/`isWeb()`/`isCapacitor()`/`isElectron()` branching
  pattern this FEAT follows. Note: `filesystem.ts` is data-files-only
  (`tasks.json`, `calendar.json`, etc.) and goes through the api-proxy
  on web. It is **not** a fit for skill loading — skills are part of
  the app code, not user data, and must be available before the
  proxy is reachable.

---

## Architecture Notes

**Decisions on the 9 PM open questions** (full rationale in the design
review §3 / §6):

1. **Bundling step location** — `scripts/bundle-skills.ts` chained as a
   `prebuild:web` npm hook (`"prebuild:web": "ts-node scripts/bundle-skills.ts"`).
   Also called from `prebuild:android` for FEAT044 reuse. Rejecting Expo
   plugin and Metro custom resolver — both add framework-specific
   surface area we don't need.
2. **Generated bundle is committed** to the repo at
   `src/skills/_generated/skillBundle.ts`. Solo-dev project, low PR
   noise. CI byte-equal check is deferred to a follow-up FEAT.
3. **Node uses `SKILL_BUNDLE` by default**, with an opt-in
   `LIFEOS_SKILL_LIVE_RELOAD=1` env flag that re-enables the
   `fs.readdirSync` path for live editing. Default Node + web read the
   bundle — single hot path, drift impossible. Live reload is a
   developer-ergonomics escape hatch; not exercised in CI or production.
4. **Embedding cache on web is in-memory only** (module-level `Map`).
   Seven skills × 384 floats is ~9 KB; cold-start recompute is moot
   when the embedder is degraded anyway (see #5).
5. **Embedder on web — graceful degradation.** `descriptionEmbedding`
   stays `null` on web. Router's existing `phrase embedder unavailable`
   fallback at `router.ts:343-346` carries it. Structural triggers +
   Haiku tiebreaker handle clear cases. Unblocking xenova WASM is too
   heavy for v1 web (50MB tokenizer + ONNX runtime); proxy delegation
   is a separate FEAT.
6. **`prompt.md` shipped as an inline string literal** emitted by the
   codegen (template literal, escaped backticks). No Metro `.md`
   transformer. Sidesteps Metro config drift.
7. **`sha256First16` async ripple** — split. Introduce
   `async sha256Hex(text): Promise<string>` in a new
   `src/utils/sha256.ts` module for the cryptographic use (locked-zone
   integrity). Keep `sha256First16` synchronous for log telemetry but
   re-implement it via a non-cryptographic hash (FNV-1a, 16 hex chars)
   — collision resistance doesn't matter for log correlation. No async
   ripple into `logRoutingDecision`.
8. **Bundle ordering** — codegen sorts skill folder names lexicographically
   before emission; entries appear in the same order in `SKILL_BUNDLE`.
   Loader iterates `Object.keys(SKILL_BUNDLE).sort()` defensively, so
   the duplicate-id-rejection contract (alphabetical first-wins) holds
   even if a future codegen change forgets the sort.
9. **Sanity sweep — clean.** All seven skills' `context.ts` and
   `handlers.ts` were grep'd for Node-only API usage
   (`require`, `fs.`, `path.`, `crypto`, `process.env`, `Buffer`,
   `__dirname`, `__filename`). **Zero matches.** Each handler does
   `await import("../../modules/executor")` lazily; executor itself has
   no top-level Node imports (it routes through `filesystem.ts` which
   is already isomorphic). Skills will load cleanly from the bundle.

**Files touched:**

- New: `scripts/bundle-skills.ts`, `src/skills/_generated/skillBundle.ts`
  (committed), `src/utils/sha256.ts`, tests for codegen + sha256 parity.
- Modified: `src/modules/skillRegistry.ts` (dual-loader; bundle-first
  + fs fallback under `LIFEOS_SKILL_LIVE_RELOAD`; async
  `parseLockedZones`), `src/modules/v4Gate.ts` (delete `if (!isNode())`
  line; update doc comment), `src/modules/router.ts`
  (`sha256First16` switched to FNV-1a; remains sync), `package.json`
  (`prebuild:web`, `prebuild:android` hooks), `metro.config.js`
  (untouched — the blockList still excludes `@xenova/transformers` and
  `onnxruntime`; embeddings degrade on web by design), `AGENTS.md` (new
  build-time-bundling pattern entry), `docs/new_architecture_typescript.md`
  (Section 6 + Section 9 ADR).
- Untouched: `chat.tsx`, `types/skills.ts`, `types/orchestrator.ts`,
  `skillDispatcher.ts`, `executor.ts`, `assembler.ts`, all seven skill
  folders, the embedder provider, the api-proxy.

**New patterns introduced:**

- *Build-time bundle pattern* — folder-discovery on web is replaced
  with a codegen step that emits a static map keyed by folder name.
  Reusable for any future folder-walking surface (Topics, attachments).
- *Dual-loader contract* — registries with file backing pick a backend
  based on `isNode() && process.env.LIFEOS_*_LIVE_RELOAD`; default is
  the bundle on every platform. Codified for any future registry.
- *Isomorphic crypto split* — cryptographic SHA-256 (integrity) goes
  through `sha256Hex` (async, WebCrypto on web, `crypto.createHash` on
  Node); non-cryptographic hash (logging, correlation) uses a sync
  FNV-1a. Don't mix the two; don't make logging async to satisfy
  crypto.

**Risks** — see design review §5 (≥6 entries). Top concern is
embedding-degraded routing on web for skills with sparse trigger
phrases; structural-trigger and Haiku tiebreaker carry it but each
skill's `triggerPhrases` must be tight. See design review §4 for the
specific routing-quality call-out per skill.

**Cross-FEAT alignment:** FEAT044 Capacitor reuses the same
`SKILL_BUNDLE` path (mobile = no fs either). The bundling step belongs
in `prebuild:web` AND `prebuild:android` — both targets call
`build:web` first.

---

## UX Notes

User-visible impact: zero net new UI. The only visible change is that
chat replies on web start showing the *via &lt;skill_id&gt;* badge for
the seven migrated skills, the same way they already show on Node /
the headless flow. The legacy fallback path stays intact for any
phrase that does not match a skill.

---

## Testing Notes

*Filled by Architect agent during stage 3. PM-side seeds:*

- **Bundle generation determinism.** Run the codegen script twice on
  the same source tree; the output must be byte-equal.
- **Bundle validation.** Drop a malformed `manifest.json` into a
  scratch skill folder; the codegen step must fail with a path-
  qualified error and not produce a bundle.
- **Web smoke (Story 7).** Seven-phrase sheet, one per skill, in the
  running web bundle. Each phrase shows the correct *via* badge.
- **Hash parity.** Unit test asserts `sha256Hex` produces the same
  hex string on Node and on a JSDOM/web-style WebCrypto shim for a
  small fixture set.
- **Locked-zone integrity.** Unit test asserts that for each of the
  seven skills, the LOCKED-zone hashes computed via the new helper
  match the hashes the existing Node path produces today (byte-
  equal). Guards FEAT054 §5 contract for FEAT058/070.
- **Gate test.** With `setV4SkillsEnabled([])`, web phrases revert to
  legacy. With the full set, web phrases hit v4. With
  `_pendingContext` set, v4 is skipped (existing test logic remains
  valid).
- **Headless parity.** Headless runner boot log lists the same seven
  skills before and after this FEAT.
- **Build smoke.** `npm run build:web` from a clean checkout (no
  prior bundle artifact, no node_modules cache for the embedder)
  succeeds.

---
