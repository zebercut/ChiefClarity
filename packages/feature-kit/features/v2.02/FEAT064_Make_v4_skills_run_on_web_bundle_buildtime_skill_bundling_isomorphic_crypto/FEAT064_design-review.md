# FEAT064 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT064_Make_v4_skills_run_on_web_bundle_buildtime_skill_bundling_isomorphic_crypto.md`
**Refs:** FEAT054 (registry + locked-zone hashing), FEAT051 (router +
embeddings), FEAT055 (dispatcher + first POC), FEAT056 (chat wiring +
general_assistant; B3 — `crypto.createHash is not a function`),
FEAT057-FEAT063 (seven migrated skills),
`src/modules/skillRegistry.ts` (full file — `loadSkillRegistry`,
`loadOneSkill`, `parseLockedZones`, `nodeFs`/`nodePath`/`nodeCrypto`
lazy requires, `eval("require")` Node bypass at line 292),
`src/modules/v4Gate.ts:50` (`if (!isNode()) return false`),
`src/modules/router.ts:336-346` (embedder-unavailable fallback),
`src/modules/router.ts:446-462` (`sha256First16` browser stub),
`metro.config.js:8-16` (`blockList`), `src/utils/filesystem.ts`
(isomorphic precedent — but data-files-only, not a fit for skills),
`app/_layout.tsx:317-325` (boot wiring — already lists all seven).

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

This is the infrastructure FEAT that makes the seven migrated skills
actually run for the user. The migrations themselves are sound — the
gap is purely in the loader and crypto surfaces being Node-implemented.
Architecture stays inside the existing isomorphic-by-design contract;
the only new surface is a build-time codegen step plus an isomorphic
SHA-256 helper. No type changes, no executor changes, no chat surface
changes, no manifest schema changes.

The primary trade-off is **routing quality on web**: by choosing
graceful embedding degradation over WASM unblock or proxy delegation,
the web router relies on structural triggers + the Haiku tiebreaker.
That is acceptable for v1 web — see §4 for the per-skill trigger-phrase
audit and §6 condition 11 for the trigger-phrase-tightness gate.

---

## 2. Architecture (one screen)

```
┌─ Build time ─────────────────────────────────────────────────────────┐
│ npm run build:web                                                    │
│   ↓                                                                  │
│ prebuild:web → ts-node scripts/bundle-skills.ts                      │
│   ├─ readdirSync src/skills/                                         │
│   ├─ filter folders (skip "_*", ".*")                                │
│   ├─ sort lexicographically                                          │
│   ├─ for each folder:                                                │
│   │    ├─ read manifest.json (parse + structural validate)           │
│   │    ├─ read prompt.md (raw text)                                  │
│   │    ├─ resolve relative paths to ./context, ./handlers            │
│   │    └─ duplicate-id pre-check (fail loudly)                       │
│   └─ emit src/skills/_generated/skillBundle.ts:                      │
│        export const SKILL_BUNDLE: Record<string, BundleEntry> = {    │
│          calendar_management: {                                      │
│            manifest: {...JSON...},                                   │
│            promptText: `...prompt.md content...`,                    │
│            context: () => require("../calendar_management/context"), │
│            handlers: () => require("../calendar_management/handlers")│
│          },                                                          │
│          emotional_checkin: {...},                                   │
│          ... (alphabetical)                                          │
│        };                                                            │
│   ↓                                                                  │
│ expo export --platform web (Metro bundles SKILL_BUNDLE statically)   │
└──────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Web bundle ───────────────────────────────────────────────┐
│ app/_layout.tsx → loadSkillRegistry()                                │
│   ↓                                                                  │
│ skillRegistry.doLoad():                                              │
│   ├─ if (!isNode()):                                                 │
│   │    ├─ import { SKILL_BUNDLE } from "../skills/_generated/..."    │
│   │    ├─ for each id in Object.keys(SKILL_BUNDLE).sort():           │
│   │    │    ├─ validateManifest(entry.manifest)                      │
│   │    │    ├─ parseLockedZones(entry.promptText)  ← async, sha256Hex│
│   │    │    ├─ entry.context()  → contextRequirements                │
│   │    │    ├─ entry.handlers() → ToolHandler map                    │
│   │    │    └─ descriptionEmbedding = null (web; embedder degraded)  │
│   │    └─ buildRegistry(loaded)                                      │
│   └─ shouldTryV4 returns true (Node-gate removed)                    │
└──────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Node (default) ───────────────────────────────────────────┐
│ Same path as web — reads SKILL_BUNDLE.                               │
│ descriptionEmbedding computed via xenova provider (Node-only).       │
│ Embedding cache file unchanged (Node-only branch).                   │
└──────────────────────────────────────────────────────────────────────┘

┌─ Runtime — Node (live-reload escape hatch) ──────────────────────────┐
│ LIFEOS_SKILL_LIVE_RELOAD=1 (dev-only env flag):                      │
│ skillRegistry.doLoad():                                              │
│   ├─ if (isNode() && process.env.LIFEOS_SKILL_LIVE_RELOAD):          │
│   │    └─ existing fs.readdirSync path (eval("require") for context  │
│   │       and handlers; same algorithm as today)                     │
│   └─ otherwise: bundle path (default)                                │
└──────────────────────────────────────────────────────────────────────┘
```

**Crypto surface:**

- `src/utils/sha256.ts` exports `async sha256Hex(text): Promise<string>`.
  Node: `crypto.createHash("sha256").update(text, "utf8").digest("hex")`.
  Web: `await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))`
  → format as 64-char lowercase hex. Both produce byte-equal output.
- `parseLockedZones` becomes async and `await`s `sha256Hex` per zone.
  Caller `loadOneSkill` is already async — single-line ripple.
- `router.ts::sha256First16` switched to a synchronous FNV-1a hash
  (16 hex chars). Not cryptographic. Logging only. The audit-log
  correlation contract from FEAT051 stays intact; the hash format is
  documented as "16-char hex, non-cryptographic" — auditing tooling
  that consumes these logs already treats them as opaque correlators.

---

## 3. Alternatives considered

### 3.1 Skill discovery — build-time bundling vs runtime glob vs Metro virtual module

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Metro custom resolver / virtual module — Metro intercepts a synthetic module name and synthesizes the skill list at bundle time | No extra script, no committed file, "automatic" | Metro-specific, opaque, hard to debug, doesn't help the headless runner. Needs separate handling for ts-node consumers. New Metro behavior to maintain. | Reject |
| (b) Expo prebuild plugin — Expo config plugin generates the bundle as part of its prebuild pass | Fits Expo's idiom | Requires understanding the Expo plugin API; ties our build to Expo internals; doesn't help non-Expo consumers (headless runner) | Reject |
| **(c) `scripts/bundle-skills.ts` + `prebuild:web` hook (CHOSEN)** | Explicit, debuggable, ts-node-runnable from any consumer. Same script also ships in `prebuild:android` for FEAT044. Drops cleanly out if we ever leave Expo. | Generated file in repo. Fresh-checkout developers must run the script (or `npm install` postinstall) before live-edit on Node — mitigated by committing the bundle. | **CHOSEN** |
| (d) Runtime glob via webpack/Metro `require.context` | Used in some RN projects | Metro's support for `require.context` is partial; doesn't cover dynamic paths cleanly; we'd still need a build step to capture `prompt.md` as text | Reject |

**Decision rationale:** option (c) keeps the build step out of Metro
internals and gives us a single artifact we can grep, commit, diff, and
test. The codegen script is ~80 lines, has no dependencies beyond
`fs`/`path`, and runs in <1 second.

### 3.2 Generated bundle — committed vs gitignored

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Gitignored + postinstall hook | No PR diff noise. No staleness in branches. Forces "single source of truth = source folders". | Fresh checkouts can't run anything until the postinstall fires. CI complexity. ts-node consumers (tests, scripts) all need the bundle to exist before they import the registry. | Reject for v1 |
| **(b) Committed (CHOSEN)** | Fresh checkout works immediately. Bundle visible in PRs (any drift between source and bundle is a review-time anomaly). Solo-dev project, low PR-noise concern. | PR diffs include the generated file. Out-of-sync bundle is possible (developer edits a skill but forgets to re-run the bundler). | **CHOSEN** |
| (c) Committed + CI byte-equal check | Catches drift automatically | CI infrastructure not yet stood up for this project; adding a byte-equal check is a separate FEAT | **Defer** to follow-up FEAT |

**Decision rationale:** committed is the right call for a solo-dev
project at v2.02 maturity. The byte-equal check is a real safeguard
but belongs in a follow-up FEAT once the project picks up CI.

### 3.3 Embedder on web — unblock vs degrade vs proxy

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Unblock `@xenova/transformers` in `metro.config.js` and ship `onnxruntime-web` to the browser | True embedding fidelity on web; routing quality matches Node | ~50MB WASM + tokenizer load on first chat; first-paint cost; battery cost on the user's device; bundle size budget breach | Reject for v1 web |
| **(b) Graceful degradation — `descriptionEmbedding = null` on web (CHOSEN)** | Zero new bundle weight. Router's existing `phrase embedder unavailable` fallback at `router.ts:343-346` already handles this case. Structural triggers + Haiku tiebreaker carry routing for clear phrases. | Routing quality dips for "soft" phrases — anything that doesn't structurally match. `general_assistant` will catch more soft phrases. Skill-specific risk: see §4. | **CHOSEN** |
| (c) Proxy embedder — delegate `embed()` to the api-proxy via HTTP | Server-side embedding; client stays light | Adds proxy round-trip latency on every routing decision (currently zero LLM calls before tiebreaker for high-confidence routes). Proxy doesn't currently host the model. Separate infra FEAT. | Reject — separate FEAT |

**Decision rationale:** (b) is the lowest-risk path consistent with
FEAT056 B3 mitigation. The Haiku tiebreaker already handles the
no-embeddings case. The proxy-delegation option is real value but it's
its own FEAT with its own risk profile (model loading on the proxy,
embedding cache invalidation, HTTP failure modes).

### 3.4 Hash function for log correlation — sync FNV-1a vs async SHA-256

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Make `sha256First16` async, ripple `await` into `logRoutingDecision` and the caller chain | Single hash function across the codebase | Logging is on the hot path; turning it async means every router call awaits the log helper. `routeToSkill` already returns a Promise so this is plausible, but it adds a `await` for a non-critical path (logging). | Reject — over-engineered |
| (b) Stub `sha256First16` to return a constant on web (status quo) | No code change | Audit correlation broken on web; future correlation-based debugging fails | Reject — already known broken (FEAT056 B3) |
| **(c) FNV-1a 16-hex synchronous (CHOSEN)** | Fast, deterministic, isomorphic by construction (pure JS, no platform calls). 16 hex chars of FNV-1a is enough for log correlation (collision probability irrelevant for this use case). Replaces the `eval("require")` + `browser-unhash` stub with a real value on web. | Not cryptographic. Documentation must state this clearly so nobody assumes it's collision-resistant. | **CHOSEN** |

**Decision rationale:** the cryptographic strength of SHA-256 is
load-bearing for the locked-zone integrity contract (FEAT054 §5,
FEAT058/070 auto-patcher dependency). It is **not** load-bearing for
log correlation. Splitting the two uses cleanly avoids forcing the
logging hot path into async territory.

---

## 4. Cross-feature concerns

**Upstream:** FEAT054, FEAT051, FEAT055, FEAT056, FEAT057-FEAT063 — all
Done. The seven migrated skills are foundation work that this FEAT
unlocks.

**FEAT044 Capacitor mobile (in flight on `fz-dev-capacitor`).** Mobile
has no Node `fs` either — same blocker as web. The `SKILL_BUNDLE` path
introduced here is the *exact* solution mobile needs. FEAT044 reuses
this bundle without modification: the registry's `!isNode()` branch
covers Capacitor, web, and any future React Native target uniformly.
**No per-platform skill loader is needed.** This is the strongest
reason to pick option 3.1(c) over Metro virtual modules — the script
runs equally well in `prebuild:android`. Architect note: when FEAT044
lands, add `prebuild:android` as a chained hook so capacitor builds
also regenerate the bundle.

**Embedding-degradation impact on routing quality.** With
`descriptionEmbedding = null`, the router's pipeline becomes:

```
0. directSkillId (programmatic invocations)
1. Structural trigger (slash commands, exact prefix tokens)
2. Embedding pipeline → SKIPPED (no embedding)
3. → falls through to fallback ("phrase embedder unavailable")
   → general_assistant
```

This means **on web, every non-slash-prefixed phrase that doesn't
exactly match a structural trigger lands on `general_assistant`**.
That's a correctness issue for routing quality. Mitigations:

- `general_assistant` is the freeform-fallback skill — by design it
  handles arbitrary phrases reasonably (FEAT056). So the user gets
  *a* response, not an error.
- The structural-trigger ladder catches CRUD commands ("/task",
  "/note", recognized prefix tokens).
- For sensitive surfaces — `emotional_checkin` (FEAT063 safety scope)
  — the routing miss matters. A user who types *"I'm feeling
  stressed"* on web would route to `general_assistant`, **not**
  `emotional_checkin`. The safety scope in `emotional_checkin` would
  not fire. This is a real degradation for web.

**Architect decision:** for FEAT063's safety scope to be reachable on
web, `emotional_checkin` needs structural triggers that catch the
common phrasings ("feeling", "I'm stressed", "tough day", "burned
out"). This means the manifest's `structuralTriggers` need to be
populated beyond slash commands. Verify in §6 condition 11.

For other skills (`task_management`, `notes_capture`,
`calendar_management`), the user is more likely to use slash commands
or recognized prefixes. Routing miss risk is medium, not high.

For `priority_planning` ("what should I focus on", "plan my day"),
embedding miss is high probability — these are soft phrases. Same
mitigation: rich `structuralTriggers`.

For `inbox_triage` and `bulk_input` paths, they're invoked via
`directSkillId` from the inbox timer (FEAT060) — embedding-routing
isn't reached. Web parity is preserved here automatically.

**Metro `blockList` (FEAT041/042) stays untouched.** The blockList
already excludes `@xenova/transformers` and `onnxruntime` from web.
That is what makes graceful degradation work — we are *not* unblocking
those. The seven skill folders themselves are not in the blockList and
will bundle normally.

**`executor.ts` and `assembler.ts` are NOT in scope.** They have other
Node imports (e.g., the legacy `src/db/` path through `loader.ts`),
but those imports are already gated by web-vs-Node branches in
`filesystem.ts` and `loader.ts`. The v4 web hot path (registry → router
→ dispatcher → handler → executor.applyWrites → filesystem.writeJsonFile)
is fully isomorphic. We verified by sweeping the seven skills' handlers
and `executor.ts`'s top-level imports — no Node-only API leaks.

**`eval("require")` residue.** This FEAT removes the residue from the
**v4 hot path** (the registry's bundle path doesn't need it; locked-zone
hashing uses `sha256Hex`; `sha256First16` switches to FNV-1a). The
`eval("require")` pattern *remains* in the live-reload escape hatch
inside `skillRegistry.ts` (Node-only by gate). Other modules that use
`eval("require")` for Node-only branches (backups, headless runner
internals) are out of scope — this FEAT does not chase the pattern
codebase-wide.

**FEAT083 Topics / future folder-walking surfaces.** When Topics ships
its own folder layout, it can reuse the same build-time bundling
pattern: a codegen script emits a static map at build time. Codified
in §9.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Bundle drift** — developer edits a skill folder but forgets to re-run the bundler; CI/PR shows out-of-date generated file | Medium | Medium | Bundle is committed; PR review catches drift visually. Follow-up FEAT adds a CI byte-equal check. Codegen runs in <1s so re-running is cheap. The `prebuild:web` hook fires on every `npm run build:web` so any reproducible build catches drift. |
| **Embedding-degraded routing quality on web** — soft phrases ("feeling", "what should I focus on") miss embedding, fall to general_assistant, skip the matched skill's prompt — including emotional_checkin's safety scope | High | Medium-High | §6 condition 11 — each skill's `manifest.structuralTriggers` MUST include enough common phrasings to catch the typical prefix-token. emotional_checkin specifically must catch "feeling", "stressed", "tough day", "anxious", "overwhelmed", "burned out" via structural match. Coder verifies by running the seven-phrase smoke against a web build before declaring Done. |
| **Locked-zone hash transition** — async `parseLockedZones` produces hashes that don't byte-match the existing Node hashes (e.g., line-ending normalization, encoding mismatch between WebCrypto and `crypto.createHash`) | Medium | High | §6 condition 6 — unit test fixture with canonical strings asserts byte-equal hash output between Node and a JSDOM/web-style WebCrypto shim. UTF-8 input strictly. No trim, no normalization. The legacy zone hashes that FEAT058/070 auto-patcher relies on must match exactly. |
| **Codegen breaking on skill folder edits** — adding a new skill folder, malformed `manifest.json`, missing prompt.md | Medium | Medium | §6 condition 4 — codegen fails loudly with path-qualified errors. Bundle is not produced on validation failure. CI / `npm run build:web` exits non-zero. |
| **Metro/Expo build hook timing** — `prebuild:web` runs but Expo doesn't pick up the regenerated `_generated/skillBundle.ts` because Metro's cache is stale | Low | Medium | npm `prebuild:*` runs before `*` in the same shell, so the regenerated file is on disk before `expo export` starts. Metro's transform cache is keyed by file mtime; mtime updates on every codegen run (unless byte-equal). To be safe, document a `--clear-cache` flag in the script's README entry. |
| **`eval("require")` residue elsewhere** — coder removes it from the registry's hot path but a future contributor reintroduces it | Low | Medium | §6 condition 7 — comment in registry header explicitly forbids re-adding `eval("require")` to any non-live-reload code path. AGENTS.md gets a learned-pattern entry. |
| **FNV-1a hash log-format change** — log-consuming tooling expecting SHA-256-shaped 16-hex input breaks because FNV-1a output looks the same shape but a different byte distribution | Low | Low | The 16-hex output is the same shape (`/^[0-9a-f]{16}$/`). Any consumer treating it as opaque correlator works unchanged. Document the change in `router.ts` comment. |
| **Routing quality regression for `priority_planning`** — without embeddings, "what should I focus on?" falls to general_assistant. This is the primary FEAT goal phrase. | High | High | §6 condition 11 — `priority_planning`'s `structuralTriggers` MUST include "focus", "what should i focus", "plan my", "priority", "priorities". Coder verifies via the Story 7 seven-phrase smoke before declaring Done. Acceptance criterion: typing "what should I focus on?" into the running web bundle produces the *via priority_planning* badge. |
| **Cold-start embedding compute on Node consumers (test path)** — Node also reads the bundle now; tests that previously relied on `fs.readdirSync` semantics or a specific cache path may shift | Medium | Low | §6 condition 9 — full test suite runs unchanged. Tests using `_resetSkillRegistryForTests()` continue to work. The `LIFEOS_SKILL_LIVE_RELOAD` flag preserves the legacy fs path for any test that explicitly needs it. |
| **Web bundle size balloon** — embedding seven full prompt strings + manifests + handler module references inflates the web JS bundle | Low | Low | §6 condition 10 — coder runs `npm run build:web` before/after and reports the bundle size delta. Expected: <100KB increase (seven prompts ~5-10KB each + manifests). If the increase exceeds 5%, surface in test results before declaring Done. |
| **Emerging Capacitor reuse** — FEAT044 lands and `prebuild:android` isn't wired, mobile builds ship a stale bundle | Medium | Medium | §6 condition 12 — `prebuild:android` hook added at the same time as `prebuild:web`. Even though FEAT044 isn't merged yet, wiring the hook now means FEAT044 just needs to delete the `!isNode()` short-circuit on Capacitor (already returns the same code path as web). |

---

## 6. Conditions (numbered)

1. All Story 1-8 acceptance criteria testable + tested in stage 7.
2. **Codegen script** at `scripts/bundle-skills.ts`. Idempotent
   (running twice on the same source produces byte-equal output).
   Sorts skill folder names lexicographically. Skips folders prefixed
   `_` or `.`. Validates each folder has all four required files
   (`manifest.json`, `prompt.md`, `context.ts`, `handlers.ts`); fails
   loudly with path-qualified error on missing/malformed input.
   Pre-checks duplicate ids and fails the build on collision (don't
   defer to runtime — the loader's runtime check stays as
   defense-in-depth).
3. **Generated bundle** at `src/skills/_generated/skillBundle.ts`,
   **committed**. The folder `_generated` starts with `_` so the
   existing `readdirSync` filter ignores it (defensive — even though
   the loader no longer walks the dir on web, the live-reload Node
   path still does).
4. **`prompt.md` shipping format** — codegen reads each file as UTF-8
   text and emits as a tagged template literal. Backticks and
   `${` sequences inside prompts are escaped. Test asserts a known
   substring from each of the seven skills' prompt.md is present in the
   generated bundle (string match against the on-disk source).
5. **`src/utils/sha256.ts`** exposes `async sha256Hex(text: string): Promise<string>`.
   Node uses `crypto.createHash`. Web uses `crypto.subtle.digest` +
   `Uint8Array → hex` formatting. Both produce 64-char lowercase hex
   for the same UTF-8 input. `parseLockedZones` becomes async and uses
   the helper. `loadOneSkill` (already async) awaits it.
6. **Hash parity test** — fixture set of canonical strings (`""`,
   `"hello"`, `"a longer string with unicode: café 日本"`, the actual
   content of the LOCKED zones from each of the seven shipped skills)
   produces byte-equal hex output across Node `crypto.createHash` and
   a web-style `crypto.subtle.digest` test path (use a JSDOM-backed
   shim or run the assertion in Node by calling
   `globalThis.crypto.subtle` — Node 20+ has it natively). The locked-
   zone hashes embedded in the seven shipped skills' manifests today
   must match the new helper's output byte-for-byte.
7. **`router.ts::sha256First16` switched to FNV-1a** (synchronous, pure
   JS, 16 lowercase hex chars). The function's comment is rewritten to
   state: "Non-cryptographic FNV-1a hash for log correlation. NOT
   suitable for integrity. For cryptographic SHA-256, use
   `src/utils/sha256.ts`." Remove the `eval("require")` and the
   `browser-unhash` stub. The function stays sync; `logRoutingDecision`
   stays sync.
8. **`v4Gate.ts`** — delete `if (!isNode()) return false`. Update doc
   comment: "v4 only runs when skills are enabled and the user isn't
   mid-clarification." Update `getV4SkillsEnabled().size === 0` and
   `_pendingContext` checks unchanged. Existing tests for the gate's
   other conditions still pass.
9. **Registry dual-loader** — `loadSkillRegistry` reads `SKILL_BUNDLE`
   by default on every platform. Node opts into the legacy
   `fs.readdirSync` path only when
   `process.env.LIFEOS_SKILL_LIVE_RELOAD === "1"`. The web/non-Node
   branch removes the `eval("require")` calls entirely from the
   non-live-reload path. Validators (`validateManifest`,
   `parseLockedZones`, surface-route checks) run on bundled data
   identically to fs-loaded data. Duplicate-id and reserved-route
   rejection still works on web (alphabetical first-wins).
10. **Web bundle size budget** — coder runs `npm run build:web`
    before this FEAT lands and after, captures the resulting
    `dist/_expo/static/js/web/*.js` total bytes, and reports the
    delta. Pass/flag threshold: <5% increase. If the increase exceeds
    5%, flag in stage 7 results before declaring Done; the budget
    breach itself is not blocking, but the coder must surface it.
11. **Trigger-phrase / structural-trigger audit per skill** — for each
    of the seven skills, the manifest's `triggerPhrases` and
    `structuralTriggers` are tightened to ensure the primary
    user-intent phrasings reach the skill via the structural ladder
    (since web routing has no embeddings):
    - `priority_planning`: structuralTriggers MUST include "focus",
      "plan", "priorities", "priority". triggerPhrases include
      "what should I focus on", "plan my day", "plan my week".
    - `general_assistant`: catch-all; no change required.
    - `task_management`: "task", "todo", "remind", "/task" already
      present (verify).
    - `notes_capture`: "save", "remember", "note", "/note" (verify).
    - `calendar_management`: "schedule", "meeting", "appointment",
      "calendar", "/cal" (verify).
    - `inbox_triage`: invoked via directSkillId by the timer; no
      web routing concern.
    - `emotional_checkin`: structuralTriggers MUST include "feeling",
      "stressed", "anxious", "overwhelmed", "burned", "tough", "rough"
      (single-word prefix matches against the structural-trigger
      ladder, which compares the first whitespace-delimited token).
      This is the safety-scope-reachability requirement called out in
      §4. Coder verifies by typing "I'm feeling stressed" into the
      running web bundle and asserting *via emotional_checkin*.
12. **`prebuild:web` and `prebuild:android` npm hooks** added to
    `package.json`. Both invoke `ts-node scripts/bundle-skills.ts`.
    The android hook is a forward-compat measure for FEAT044.
13. **AGENTS.md updated** with three new template-defining entries:
    - "Build-time bundle pattern — folder-discovery on web/mobile is
      replaced by a codegen step that emits a static map. Reusable for
      Topics, attachments, any future folder-walking surface."
    - "Dual-loader contract — registries with file backing pick a
      backend by `isNode() && process.env.LIFEOS_*_LIVE_RELOAD`.
      Default is the bundle on every platform."
    - "Isomorphic crypto split — cryptographic SHA-256 (integrity)
      uses `src/utils/sha256.ts` (async, isomorphic). Non-cryptographic
      hash for logging uses sync FNV-1a. Don't make logging async to
      satisfy crypto."
14. **`docs/new_architecture_typescript.md` updated** — Section 6
    (registry boot flow now reads from `SKILL_BUNDLE` by default;
    live-reload escape hatch documented), Section 9 (ADR for
    build-time bundling and isomorphic crypto split), Section 12
    (acknowledgment that v4 now runs on web for all seven migrated
    skills).
15. **Zero changes** to `chat.tsx`, `types/skills.ts`,
    `types/orchestrator.ts`, `skillDispatcher.ts`, `executor.ts`,
    `assembler.ts`, the seven skill folders' source code,
    `metro.config.js` (the blockList stays as-is — embedding
    degradation is by design).
16. **Web smoke (Story 7)** — seven-phrase sheet, one phrase per
    skill, run against the running web bundle. Each phrase produces
    the correct *via &lt;skill_id&gt;* badge. At least one phrase
    exercises a write through the api-proxy (e.g., task_management
    adds a task; the data file is updated). One phrase routes to
    `general_assistant` (fallback path). Coder ships the seven-phrase
    sheet as a markdown file inline in the test-results doc.
17. **Headless runner parity** — boot log lists the same seven skills
    before and after (id + version match). Locked-zone hashes are
    byte-equal to today's hashes (per condition 6).

---

## 7. UX

**Zero changes** to existing surfaces. No new modals. No new buttons.
No new chat affordances. The user opens the web bundle, types a
phrase, and the *via &lt;skill_id&gt;* badge — already present in the
chat surface for Node — appears under the assistant reply for the
seven migrated skills.

**Explicit user-visible deltas after this FEAT lands:**
- Web bundle: chat replies for the seven migrated skills show the
  *via* badge.
- Web bundle: writes (task_management, calendar_management,
  notes_capture, inbox_triage's chat-driven path) hit the api-proxy
  and update the data files visibly in the data folder.
- Web bundle: `emotional_checkin`'s safety scope (FEAT063) fires for
  crisis phrases (assuming structural triggers are tightened per
  condition 11).
- Web bundle: `priority_planning`'s focus-brief reply appears on
  "what should I focus on?" (assuming structural triggers are
  tightened per condition 11).

Nothing else is user-visible. The legacy fallback path remains intact
for any phrase not matched by a v4 skill.

---

## 8. Test strategy

### 8.1 Unit tests — `sha256Hex` isomorphism

- Fixture: `["", "hello", "a longer string with unicode: café 日本",
  "<full content of one LOCKED zone from each of the seven skills>"]`.
- Assert: Node `crypto.createHash` output === web-style
  `crypto.subtle.digest` output, byte-equal, for every fixture.
- Assert: legacy `parseLockedZones` Node-only output matches new
  async `parseLockedZones` output for each of the seven shipped
  skills' prompts.

### 8.2 Unit tests — codegen script

- Fixture skill folders under a tmp dir; running the codegen twice
  produces byte-equal output.
- Folders prefixed `_` and `.` are skipped.
- Output keys are sorted lexicographically.
- All seven currently-shipped skills appear in the output (run
  against the real `src/skills/`).
- Malformed manifest causes the codegen to exit non-zero with a
  path-qualified error. No bundle file is written/overwritten.

### 8.3 Smoke — `npm run build:web`

- From a clean checkout (no prior bundle artifact), `npm run build:web`
  exits 0.
- Grep the resulting `dist/_expo/static/js/web/*.js` for a known
  string substring from each of the seven skills' prompt.md (e.g.,
  the section heading `## Safety` from emotional_checkin's locked
  block, or the `## Bulk-Input` heading from inbox_triage). All
  seven substrings are present in the dist bundle.

### 8.4 Web integration test

If feasible without standing up a full Expo web runtime in CI: load
the registry from `SKILL_BUNDLE` directly (import the generated module
in a Node test, with `isNode()` mocked to `false`), run a phrase
through `routeToSkill` with a stubbed LLM client, assert the dispatch
returns the expected skill id and the handler is called.

If full web runtime testing isn't feasible, the manual smoke (§8.5)
covers it.

### 8.5 Manual web smoke (Story 7) — seven-phrase sheet

Run against the running web bundle (`npm run dev:web`):

1. *"what should I focus on?"* → *via priority_planning*.
2. *"add a task to call the contractor tomorrow"* → *via task_management*.
   Verify the task appears in `tasks.json` via the api-proxy.
3. *"save this thought: refactor the inbox loop"* → *via notes_capture*.
4. *"schedule a meeting Tuesday at 3pm"* → *via calendar_management*.
5. *"I'm feeling stressed about the project"* → *via emotional_checkin*.
   (Reachability of FEAT063 safety scope — verify trigger.)
6. *"how do I export my data?"* (informational, no skill matches) →
   *via general_assistant*.
7. Inbox phrase fired by the inbox timer (with a known inbox blob in
   `data/inbox.json`) — *via inbox_triage* (badge appears in the
   processing log; no chat reply for timer path).

### 8.6 Regression — full existing test suite

- All baseline tests pass without modification.
- Tests that asserted "registry empty on non-Node" are updated (or
  removed if they were placeholder assertions).
- FEAT054/055/056/057-063 tests pass unchanged.

### 8.7 Headless parity

- `npm run headless` boot log lists the same seven skills as before
  this FEAT.
- Locked-zone hashes (computed via the new async helper) are
  byte-equal to today's hashes (per condition 6 — verified against
  the seven shipped skills' prompts).

### 8.8 Live-reload escape hatch

- `LIFEOS_SKILL_LIVE_RELOAD=1 npm run headless` falls into the
  `fs.readdirSync` path. Editing a skill folder's prompt.md and
  re-importing the registry shows the edit (without re-running the
  codegen). This is a developer-ergonomics test, optional.

---

## 9. Pattern Learning

**FEAT064 codifies three patterns** that any future folder-walking,
build-time-discovery, or isomorphic-crypto FEAT will reuse:

### 9.1 Build-time bundle pattern

When a runtime needs to discover a folder of files (skill folders,
topic templates, attachment renderers, etc.) but the target platform
has no `fs`, the canonical solution is a build-time codegen step:

- A `scripts/bundle-<thing>.ts` walks the source folders.
- Emits a static `<THING>_BUNDLE` map keyed by folder name to a small
  module shape (parsed metadata + raw text + dynamic-import callbacks
  for code modules).
- Committed at `src/<thing>/_generated/<thing>Bundle.ts`.
- Wired into the build via npm `prebuild:web` / `prebuild:android`
  hooks.
- The runtime loader reads the bundle on web/mobile; reads the live
  filesystem on Node *only* under an opt-in env flag for live-edit
  ergonomics.

### 9.2 Dual-loader contract

Registries that need filesystem access pick a backend at runtime:

- Default on every platform: read the build-time bundle.
- Node + `LIFEOS_*_LIVE_RELOAD=1`: read the live filesystem (legacy
  walk path preserved as escape hatch only).

This avoids drift between Node and web/mobile in production while
keeping developer velocity for skill authoring.

### 9.3 Isomorphic crypto split

When isomorphic crypto is needed, split by use case:

- **Integrity / cryptographic** uses go through `src/utils/sha256.ts`
  (async; `crypto.createHash` on Node, `crypto.subtle.digest` on web).
  Both produce byte-equal output.
- **Logging / correlation** uses a synchronous, non-cryptographic
  hash (FNV-1a). Don't force logging async to satisfy crypto needs;
  the cost is real and the cryptographic strength is not load-bearing
  for this use case.

### 9.4 Future Capacitor (FEAT044) reuse

Once FEAT044 lands, mobile uses the same `SKILL_BUNDLE` path that web
uses. **No per-platform skill loader.** The dual-loader contract
covers all three platforms (web, mobile, Node) with one default and
one Node-only escape hatch.

After FEAT064:
- Seven migrated skills run on web (and on mobile, once FEAT044
  lands).
- Build-time bundling pattern proven for one folder type (skills);
  reusable for Topics, attachments, etc.
- Isomorphic crypto split codified (`src/utils/sha256.ts` + sync
  FNV-1a for logging).
- Embedder-degradation contract documented; the structural-trigger
  ladder + Haiku tiebreaker is the v1 web routing strategy until a
  proxy embedder ships.

---

## 10. Sign-off

Architect approves. Conditions §6 binding (17 items). The §6 conditions
6 (hash parity), 11 (per-skill structural-trigger audit), and 16 (web
smoke) are **the parity-defining artifacts** — coder must run all
three before declaring Done.

**Pay special attention to:**
- Condition 6 (hash parity test) — locked-zone hashes must be
  byte-equal across Node and web. Any normalization, encoding mismatch,
  or trim breaks the FEAT054 §5 contract that FEAT058/070 depend on.
- Condition 11 (per-skill trigger audit) — without embeddings on web,
  the structural-trigger ladder is the only route to the matched
  skill for soft phrases. `emotional_checkin`'s safety scope and
  `priority_planning`'s focus reply are at risk if their triggers
  aren't tightened. The coder verifies via the seven-phrase smoke
  before declaring Done.
- Condition 16 (manual web smoke) — this is the user-visible parity
  test. If any of the seven phrases doesn't produce its expected
  badge, the FEAT is not Done.
- Condition 7 (FNV-1a switch) — small but load-bearing. Don't keep
  the `eval("require")` stub. Remove cleanly.
- Condition 9 (registry dual-loader) — the live-reload escape hatch
  is opt-in. Default behavior on Node must be the bundle. Tests must
  pass without setting the env flag.

This auto-advances to the coder. No further architect review required
unless the coder surfaces a condition-blocking finding during stage 7.
