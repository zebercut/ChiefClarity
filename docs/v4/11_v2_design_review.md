# Chief Clarity v2 — Portfolio Design Review

**Reviewer:** Architect agent (per `ADLC/agents/architect-agent.md`)
**Date:** 2026-04-26
**Scope:** All 13 existing FEATs + 31 new FEATs scheduled for v2.01–v2.09 per `09_dev_plan.md`
**Inputs:** Each FEAT's spec markdown, current `src/` codebase, `00_overview.md`–`10_topics.md`

This is a portfolio-level review — not 44 individual design reviews. It does what
matters for the next two months of work: **resolves architectural conflicts
between v3-era specs and v4 architecture**, gives architecture notes for the
new (FEAT054–084) features grouped by phase, surfaces cross-cutting risks, and
sets the testing strategy per phase. Per-feature design reviews still happen at
PM hand-off time — this review unblocks them by deciding the contested calls.

---

## 1. Verdicts on existing FEATs

The existing FEATs were written before v4 architecture was finalized. Several
conflict directly. This table is the binding decision; per-feature design
reviews must follow it.

| FEAT | v3 spec assumption | v4 verdict | Action for PM |
|---|---|---|---|
| **FEAT020** Capability Registry Plugin System | Plugin hooks (`enrichContext`, `promptFragment`, `validatePlan`, `postExecute`) implemented in TypeScript per capability folder | **RESCOPE.** Capabilities = external integrations only (Google Cal, Slack, future email). Hooks are NOT skills. Skills are folders per `02_skill_registry.md`. | Rewrite spec to scope capabilities to integrations. Drop the `enrichContext` / `promptFragment` hooks — those concerns live in the per-skill `context.ts` and `prompt.md`. Keep only `register`, `auth`, `read`, `write` capability surface. |
| **FEAT050** Skill Runtime — declarative skills as data | Flat JSON manifest + markdown persona; runtime executes skills described as data | **SUBSUME.** Concept is correct; v4 implementation differs. Skills are folders (`manifest.json` + `prompt.md` + `context.ts` + `handlers.ts`), not flat files. The runtime that loads them is **FEAT054**. | Close FEAT050 as "implemented by FEAT054" and migrate the seed-skills idea to the Phase 2 skill migration FEATs (FEAT080, FEAT081, FEAT083). Delete the flat-JSON model from the spec. |
| **FEAT051** Skill Router and Composer | Two responsibilities: (a) embedding/Haiku route to installed skill; (b) **compose a brand-new skill on the fly** when none fits | **SPLIT.** (a) routing logic is the v4 Orchestrator — FEAT054+FEAT051 covers it. (b) **on-the-fly composition is REJECTED** — it's a second LLM call per phrase, violates ADR-001. | Drop the composer entirely. The "no skill fits" case routes to a `general_assistant` skill (handles freeform), and FEAT053 lets users author new skills from chat with explicit user intent — *not* silently. |
| **FEAT052** Context Cache with Generation Tokens | Cache key = (intent, dataNeeds), invalidated by per-source generation tokens | **KEEP.** Adapt cache key from `(intent, ...)` to `(skillId, contextRequirementsHash, ...)`. Same generation-token model. | Update spec to key by skill id + context requirements declared in `context.ts`. Otherwise design stands. |
| **FEAT023** Topic Repository core | Stories 1-4 done (CRUD, suggest, signals); Stories 5-8 planned (planning integration + UI) | **SPLIT** what's done from what isn't. Audit the existing implementation against v4 first. Stories 5-8 become part of **FEAT083 (topics skill)** + **FEAT084 (executor auto-tag hook)**. | Run an implementation audit (see §4). Mark FEAT023 stories 1-4 as Done (they are). Reroute stories 5-8 into FEAT083/084 specs and close FEAT023 once the audit confirms no regressions in v4. |
| **FEAT024** Topic auto-promotion | Periodic background re-evaluation in TS, only 2 stories, hand-wavy | **REPLACE.** Full content becomes the **TopicEmergence sensor** in FEAT060. The "periodic background scan" pattern is exactly the v4 sensor pattern. | Close FEAT024 as "rewritten as FEAT060 TopicEmergence sensor". |
| **FEAT039** Day/Week/Month objective layers | New `objectives.json` data file, weekly review ritual, daily projection job | **KEEP** as written. Folds into the `weekly_planning` skill in Phase 2. The `objectives.json` becomes a data category in `data_schemas.json` (`objectives`, already present). | Spec stays. Add architecture note that the weekly review ritual is implemented as the `weekly_planning` skill, not as a separate intent. |
| **FEAT040** Calendar admission control | Admission impact analysis sits in front of executor, single LLM call for high-severity translation | **SPLIT.** (a) admission rule lives in the `calendar` skill (Phase 2). (b) "load is too dense" detection becomes the **LoadDensity sensor** (Phase 5, FEAT060). | Update spec to split into two artifacts: skill-side rule (Phase 2) + sensor-side detection (Phase 5). Both reuse the impact math from this spec. |
| **FEAT049** Weekly retrospective | Multi-step chat flow for retro; spec architecture notes are EMPTY | **RESCOPE** as a tool inside the `weekly_planning` skill, not a standalone intent. Multi-step chat = multiple tool calls within one skill prompt; user replies feed back as new phrases routing to the same skill. | Architect must fill in the architecture section. The retro flow is `weekly_planning` skill, depth=`retro`. Single skill, multiple turns over the conversation. |
| **FEAT035** In-App Settings Panel | Centralized settings UI; replaces .env at runtime; mobile parity | **KEEP** + raise priority. **Hard prerequisite for FEAT057** (privacy overrides UI lives here). Code review found adjacent code is broken (llm.ts reads env at module load, headless-runner.js too). Fix those as part of FEAT035, not separately. | Spec stays. Add a §Migration step: rip out `process.env` reads from `llm.ts` and `headless-runner.js`, replace with `settings.get()`. Live-updateable. |
| **FEAT044** Capacitor native DB and embeddings | Mostly done; needs Metro split | **KEEP** as-is. Hold per ADR §8.6 until after Phase 3 (privacy) ships, so we don't port code that's about to be refactored. | Spec stays. Add §Hold note pointing to `09_dev_plan.md §8.6`. |
| **FEAT053** Skill Library UX | Browse/author/edit skills as flat JSON | **KEEP** for v2.09. Adjust data model from "flat skill files + override files" → "skill folder + override folder". Same UX. | Update spec data model to v4 folder structure. UX flows unchanged. |
| **FEAT027** App Auth Gate (PIN + biometrics) | Local PIN + optional biometrics, app-open and resume gate | **KEEP** as independent track. Can ship parallel to any phase. | Spec stays. |

**Net rejection / rescope count:** 5 of 13 (FEAT020, FEAT050 subsumed, FEAT051
half-rejected, FEAT024 replaced, FEAT049 rescoped). 8 of 13 keep as-is or with
small adjustments.

---

## 2. New FEATs (FEAT054–FEAT084) — phase-grouped architecture notes

The new FEATs are one-line entries in `09_dev_plan.md §3`. Per-feature spec
docs do not exist yet — the PM creates them after this design review. For each
phase, here is what the architect needs the PM to lock in before spec creation.

### Phase 1 (v2.01) — Skill Registry foundation

**FEAT054 Skill folder loader and validator** (the v2.01 anchor)

- **Data models:** `SkillManifest` (TypeScript interface in `src/types/skills.ts`); `SkillRegistry` (in-memory map). Manifest fields per `02_skill_registry.md §2`.
- **Boot sequence:** scan `src/skills/`, validate each manifest against the schema, load `prompt.md`, dynamic-import `context.ts` and `handlers.ts`, embed the description with bge-m3, register in the in-memory map. **Atomic boot:** any skill that fails validation logs a warning and is skipped; the app boots regardless.
- **API contract:** `getSkill(id): Skill`, `findSkillsByEmbedding(phraseEmbedding, topK): Array<{ skillId, score }>`, `getAllSurfaces(): Surface[]`.
- **Hot-reload:** out of scope for v2.01. Restart required after editing a skill folder.
- **Locked-zone enforcement** per `02 §9` ships in this FEAT (the loader is the validator). The Evaluator/Pattern Learner elision logic ships with FEAT068 in Phase 6, but the loader-side validation is here.
- **Surface field** per `02 §10` ships here. The loader collects surfaces; the app shell consumes the registry. New tab will be needed in `app/_layout.tsx` to render dynamic surfaces.
- **Testing required:** unit tests for manifest validation (good + 5 bad cases), boot test that loads N skills cleanly, locked-zone validation rejection test.

**FEAT051 Skill Router and Composer (rescoped to Orchestrator only)**

- Embedding-based skill match per `01_request_flow.md §1`. Haiku tiebreaker only when top-1 confidence < 0.80 or gap to top-2 < 0.15.
- Output = `{ skillId, confidence, routingMethod }`. **No** "proposedSkill" field — the composer is dropped.
- Reuse `src/modules/embeddings/` (already exists). Skill description embeddings cached at boot in `.embedding_cache.json`.
- **Testing required:** routing accuracy test on a labeled phrase set (target ≥85% top-1); tiebreaker triggers on intentionally ambiguous phrases.

**FEAT079 priority_planning POC**

- Migrate the existing `priority_ranking` intent to a skill folder.
- Run dual-path with feature flag `V4_SKILLS_ENABLED=priority_planning` — legacy intent still handled in `router.ts` when flag is off.
- **Acceptance:** A "what should I focus on" phrase routes through new path, produces equivalent output to legacy path within ±1 ranking position on 5 sample phrases.

### Phase 2 (v2.02) — Skill migration + Topics + objective layers

**FEAT080 / FEAT081 — Skill migration batches**

- Migration template (mandatory for every skill):
  1. Create `src/skills/<id>/` per `02 §6`
  2. Add to `V4_SKILLS_ENABLED`
  3. Run dual-path for 48h, log every divergence to `audit_log` table (FEAT056)
  4. Once parity ≥95% on a labeled phrase set, delete legacy intent branch
- **Order is fixed** by `09_dev_plan.md §5`: CRUD before reasoning.
- **Risk:** legacy `assembler.ts` `switch (intent.type)` has cross-cuts (e.g., `companion` context built from same code path as `daily_planning`). Each migration must verify no legacy intent silently relied on shared code.

**FEAT083 Topics skill + FEAT084 Executor auto-tag hook + Topics surface**

- **Data model:** Reuse existing `topics`, `topic_signals`, `topic_suggestions`, `rejected_topics` tables. Add columns per `10_topics.md §2`: `topic_signals.confidence`, `topic_signals.source`. Migration: backfill existing rows with `source='user'`, `confidence=1.0`.
- **API contract (auto-tag hook):** `executor.beforeWrite(item: Task | Note | Event | Fact, context): Promise<TopicTagDecision>` where decision is `{ action: "auto_confirm" | "propose" | "skip", topicId?: string, similarity: number }`. Tiered thresholds per `10 §4`.
- **Confirm-and-learn UX:** chat-side toast or inline banner after the write succeeds. Toast tap → undo (removes topic_signal row, records negative example in `user_profile.topicAutoTag.negatives`). The threshold tuning runs in FEAT064 (Phase 7).
- **Surface** per `02 §10`: `surface = { id: "topics", route: "/topics", component: "ui/TopicsView.tsx", order: 50 }`. The existing `app/topics.tsx` migrates inside `src/skills/topics/ui/TopicsView.tsx`.
- **Risk:** the existing `topicManager.ts` is consumed by ~12 places in v3 code (per code-review-recurring-bugs.md). All callers must move to either (a) the topics skill via the orchestrator, or (b) the executor auto-tag hook. No direct callers should remain after Phase 2.

**FEAT039 + FEAT040 (existing) — folded into Phase 2 skill migration**

- FEAT039 ships as part of `weekly_planning` skill (one of FEAT081's targets). The `objectives.json` writes go through the skill's handlers, not direct file I/O.
- FEAT040 admission rule lives in the `calendar` skill prompt with a deterministic `check_admission` tool the LLM must call before `schedule_event`. The LoadDensity-sensor portion ships in Phase 5.

**FEAT020 (rescoped) Capability Registry**

- Now scoped to **integrations only** (Google Cal, Slack future, etc.). Each integration has `manifest.json` + `auth.ts` + `client.ts`. No per-integration prompt fragments — those concerns live in the consuming skill.
- Reuse existing `src/integrations/registry.ts` with structural changes per `02 §6` (folder-per-integration).

**FEAT052 Context Cache**

- Cache key = `(skillId, contextHash, generationTokens)` where `contextHash` is a stable hash of the resolved `contextRequirements` declaration.
- Per-source generation tokens (`tasks.token`, `calendar.token`, `notes.token`, etc.) bumped atomically inside `executor.flush()`.
- mtime polling for external writes (headless runner) per FEAT052 spec.
- **No persistence across restarts.**

**FEAT049 Weekly retrospective (rescoped)**

- Becomes a tool inside the `weekly_planning` skill. The skill prompt has two depth modes: `plan` (Monday morning) and `retro` (Sunday evening). Same skill, different tool path.
- Multi-step chat flow = multiple user phrases over the conversation, each one routing back to `weekly_planning` skill with the prior turn in the context.
- `retro_history.json` writes go through skill handlers.

### Phase 3 (v2.03) — Privacy + locked zones

**FEAT055 Data Schema Registry + per-skill access policy**

- File: `src/config/data_schemas.json` per `03_memory_privacy.md §2`. Schema includes the `topics` category (added in `10 §1`).
- **Liberal defaults week 1:** every existing skill gets `read` for every category it touches today (audit log shows this). After 1 week, tighten based on actual usage.
- **Enforcement** in Assembler: drop categories not in `skill.manifest.dataSchemas.read` before any DB query. **Restricted data is not fetched, not truncated, not present.** Per ADR-007.
- **API:** `policy.canRead(skillId, category): boolean`, `policy.canWrite(skillId, category): boolean`, `policy.filterContext(skillId, contextBlob): contextBlob`.
- **Migration risk:** if liberal defaults aren't actually liberal enough, a skill silently gets less data and produces worse output. Mitigation: every skill reply in week 1 is logged with the categories it received; manual eyeball for week 1 outputs.

**FEAT056 Audit log**

- Append-only `audit_log` table: `{ id, ts, skill_id, op, category, row_count, tokens_used, phrase_hash }`.
- Phrase is **hashed** before storage (SHA-256), never plaintext.
- Writes go through `src/modules/auditLog.ts` (single entry point). Skills cannot call audit directly — the Assembler logs reads, the Executor logs writes.
- Encryption: lives in the same SQLCipher DB as everything else.

**FEAT057 User policy overrides UI**

- **Hosts inside FEAT035 settings panel.** Hard dependency. If FEAT035 isn't ready, FEAT057 cannot ship.
- File: `src/config/user_policy_overrides.json` (gitignored, user-specific).
- UX: per-skill row, per-category checkbox grid; "grant" and "revoke" actions write to overrides file; resolution order is overrides > defaults.
- **Sensitive categories** (`medical`, `financial`, marked `requiresExplicitGrant: true`) start excluded from every skill. User must explicitly opt in.

**FEAT058 Locked prompt zones (full enforcement)**

- The loader-side validation ships in FEAT054. **This FEAT** adds the Evaluator/Pattern Learner elision (Phase 6 ingredients) + the Pending Improvements queue-insertion rejection.
- Sequencing: ships in v2.03 before Phase 6 even though the Evaluator doesn't exist yet — that way when Phase 6 builds the Evaluator, the elision contract is already defined and tested with mock data.

### Phase 4 (v2.04) — Attachments

**FEAT076 Attachment ingestion + FEAT077 lifetime classifier + FEAT078 live sync**

- Per `04_attachments_rag.md`. Architecture is in that doc; PM specs need to flesh out per-parser detail.
- New table `attachment_chunks` per `03 §1`.
- **Privacy enforcement:** every chunk has `schema_category` column. Filtered by the same policy gate as everything else (Phase 3 prerequisite).
- **Default lifetime:** `ephemeral` per ADR-004. User opts in to persistence.

### Phase 5 (v2.05) — Proactive

**FEAT059 sensor folder + FEAT060 initial sensor pack (incl. TopicEmergence) + FEAT061–063 synthesizer/filter/memory + FEAT082 decommission**

- Per `05_proactive_intelligence.md` and `10_topics.md §5`.
- **Critical sequencing:** sensor pack must reach functional parity with v3 `proactiveEngine.ts` before FEAT082 deletes the v3 engine. Run both in parallel for 7+ days, with a `source` column on the `nudges` table comparing v3 vs v4 output quality.
- **TopicEmergence sensor** specifically: must read the `rejected_topics` table to avoid re-proposing the same cluster. The TF-IDF noun-phrase generator should fall back to "no name proposed — user names it" when confidence is low.

### Phase 6 (v2.06) — Self-improvement

**FEAT066–071** per `06_feedback_improvement.md` (rewritten weekly diary per ADR-008).

- **Critical:** Channel B (FEAT067 behavioral signals) ships first — pure TS, $0, generates the data Channel C needs. Then Channel A (FEAT066 feedback skill). Then Channel C (FEAT068 Evaluator). Pending Improvements UI starts read-only and turns on approval after one week of clean proposals.
- **Locked-zone elision** (set up in FEAT058 Phase 3) becomes load-bearing here. Test with mock skills that have locked zones.

### Phase 7 (v2.07) — Pattern Learner + sensor pack 2

**FEAT064 Pattern Learner + FEAT065 sensor pack 2**

- Pattern Learner runs **report-only for 2 weeks** (per §8.4 — still pending user confirmation in `09 §8`). Approve button disabled.
- Sensor pack 2 ships incrementally — one sensor per day with manual signal validation.

### Phase 8 (v2.08) — Companion

**FEAT072–075** per `08_companion.md`. Hard prereq: FEAT058 locked-zone enforcement is live and tested.

- Order: **FEAT074 first** (safety check + crisis resources, before any companion code can ship), then FEAT073 (sensors with no user-facing output yet), then FEAT072 (skill with both locked zones), then FEAT075 (proactive check-in surfacing).
- v3 `companion.ts` deleted only after parity check on companion-typed phrases.

### Phase 9 (v2.09) — Skill Library UX

**FEAT053** spec adapted to v4 folder structure per §1 verdict.

- Authoring writes go to a new folder under `src/skills/<new-id>/`. Override files are folder overrides (`.override.md` for prompt, `.override.json` for manifest).
- **Cannot disable safety-bearing skills** (companion, anything with `promptLockedZones`). Disable button hidden.

---

## 3. Cross-cutting concerns

### 3.1 Data flow integrity (sacred boundary)

Every skill respects the boundary: **TS owns routing, retrieval, conflict
detection, writes, summarizing, token budgets. LLM owns language understanding,
judgment, suggestions, natural-language reply.** Per `CLAUDE.md` and ADR-001.

Specific risks across this portfolio:

- **FEAT040 admission control:** spec is correct that the LLM only translates impact to language. Verify in the skill prompt that no math is delegated to the model.
- **FEAT083 topics digest:** the Sonnet call must not be asked to compute topic membership — that's the executor auto-tag hook's job, deterministic. The skill is given pre-tagged items.
- **FEAT060 TopicEmergence sensor:** clustering is TS (DBSCAN). The proposed-name-via-TF-IDF is TS. The LLM is **not** in this loop — Synthesizer translates the signal to a nudge in language (one Haiku call), but the cluster math is deterministic.
- **FEAT084 auto-tag:** confidence comparisons are TS. Chat-side confirmation is UX, not LLM-driven.
- **FEAT052 cache key:** must include enough state that two different inputs never collide. Including `today` (date-as-string) per FEAT052 spec is the right call.

### 3.2 Privacy filter is upstream of every other concern

Once FEAT055 ships, **every** new feature must declare its `dataSchemas.read/write`
in the skill manifest. PR review will reject skills that declare overly broad
access. This applies to every Phase 4–9 FEAT.

The TopicEmergence sensor (Phase 5) reads notes / tasks / events to cluster.
The skills providing those items have their own data category memberships. The
sensor declares its own policy: it reads `tasks`, `calendar`, `notes:work`,
`notes:personal`, `topics`, **but not** `medical` or `financial`. Cluster
results never accidentally include sensitive data.

### 3.3 Locked-zone contract must be proven before Phase 8

Companion (Phase 8) ships `escalate_safety` inside a locked zone. If the locked-
zone enforcement has any hole, the auto-patcher could strip the escalation logic.
The three independent enforcement points in `02 §9` (loader / Evaluator elision
/ Pending Improvements rejection) plus FEAT070 self-test post-apply hash check
must all be live and tested by end of Phase 6 — Phase 8 cannot start otherwise.

### 3.4 Headless runner ↔ app coexistence

The headless runner and the app share the same DB and the same skill registry.
Any new module added to the UI must be checked against the runner per
`AGENTS.md` rule "When wiring a new module into the UI, always check whether
background/scheduler processes also need the same wiring." This applies to
every Phase 5+ sensor and every Phase 6+ background job.

The cache (FEAT052) needs explicit attention: app-side cache and runner-side
cache are independent in-memory instances. mtime polling per FEAT052 spec is
the agreed coordination — verify it covers all the new tables (sensor_signals,
attachment_chunks, narratives v2, audit_log, pending_improvements).

### 3.5 Migration order risk: 6 new data files in v3 + 5 in v4

The v3 specs introduce: `objectives.json`, `retro_history.json`, topic
markdown dashboards, skill manifests, generation tokens, `settings.json`. The
v4 architecture adds: `data_schemas.json`, `user_policy_overrides.json`,
`crisis_resources.json`, plus DB tables (`audit_log`, `attachment_chunks`,
`sensor_signals`, `pending_improvements`, `narratives` v2, `topic_signals`
columns).

**Mitigation:** every new file gets:
1. A migration script in `src/db/migrations/` (for tables) or `src/migrations/`
   (for files)
2. A documented backfill default value
3. A test that the migration is idempotent

No PR ships a new data file without all three.

### 3.6 Skill system creates user-visible lock-in

Once FEAT054 + FEAT051 + FEAT080–081 ship, the skill system is the primary way
the user interacts with the app. Changing the skill model later means a
deprecation cycle. **This is the right tradeoff** — the v4 architecture is
designed to be stable. But every spec change to the skill manifest fields must
go through architecture review before merge, not after.

---

## 4. Implementation audit needed before Phase 2

FEAT023 spec says stories 1-4 are done. Three code review docs exist
(`code-review.md`, `code-review-recurring-bugs.md`, `code-review-recurring-v2.md`).
Before reusing this work in v4, audit:

| Check | How |
|---|---|
| What topic CRUD operations are actually wired in `src/modules/topicManager.ts`? | Read the file, list exports, find callers via grep |
| Which UI screens exist? | `Glob app/topics*.tsx app/topic-*.tsx` |
| What outstanding code-review issues are unresolved? | Read each `code-review*.md`, list issues, grep for fixes |
| Are the existing topic_signals rows compatible with the v4 confidence/source columns? | Inspect a sample of rows; write the migration |

The audit output goes into the FEAT083 spec's "current state" section so the
Coder doesn't redo work that's already done.

---

## 5. Per-phase testing strategy

Per architect-agent.md responsibilities, every feature needs unit / component /
integration tests. The testing patterns below apply to **every** spec written
for that phase — the PM should copy them into each FEAT spec's Testing Notes
section.

### Phase 1 testing strategy

- **Unit:** manifest validator (good + 5 bad cases per field), embedding cache hit/miss, locked-zone block parsing (well-formed + 3 malformed)
- **Component:** skill loader boots N skills cleanly, including 1 deliberately invalid (skipped with warning)
- **Integration:** end-to-end phrase → embedding → tiebreaker → skill dispatch → executor write → response. Two-path test: legacy intent + new skill on the same phrase, output diffed.
- **Regression:** 50-phrase labeled set for routing accuracy (target ≥85% top-1)
- **No agent fixtures yet** — POC skill (FEAT079) runs against live LLM in CI gated by token budget

### Phase 2 testing strategy

- **Unit:** every migrated skill's `context.ts` resolves correctly against fixture data
- **Component:** every skill's `handlers.ts` performs writes through `filesystem.ts` (no direct disk writes — verify via mock filesystem)
- **Integration:** dual-path divergence test on the labeled phrase set per skill — must pass before legacy intent code is deleted
- **Topics-specific:** auto-tag confirm-and-learn flow (high-sim → toast → undo → negative example recorded), topics surface renders against fixture topics
- **Agent fixtures required:** every migrated skill records a Sonnet/Haiku output fixture for each AC; tests run against fixtures (deterministic) and live LLM (nightly)

### Phase 3 testing strategy

- **Unit:** policy filter (10 cases: each category × allowed/denied/sensitive)
- **Component:** Assembler with policy filter — verify restricted data never reaches the context blob
- **Integration:** **negative tests** are mandatory. Calendar skill cannot read `medical` (must produce a query that excludes medical rows); attempt to grant medical to calendar skill via overrides must succeed; subsequent query must include medical.
- **Audit log integration:** every read/write produces an audit row; verify schema, hashed phrase, append-only enforcement.
- **Locked-zone tests:** patch attempt that overlaps a locked zone is rejected at queue insertion; loader rejects skill with declared zone missing from prompt.
- **Scope isolation tests required: Yes** — every new privacy gate is a scope isolation test by definition.

### Phase 4 testing strategy

- **Unit:** each parser (CSV, PDF, XLSX, URL article) on 3 sample files
- **Component:** chunker produces deterministic chunks for the same input
- **Integration:** drop CSV in chat → ask question → answer cites attachment chunks; chunk lifetime expiry (ephemeral after session timeout, persistent across restart)
- **Privacy:** attachment chunks tagged with schema_category respect the policy filter

### Phase 5 testing strategy

- **Unit:** each sensor emits zero signals on empty DB (mandatory per `09 §7`); each sensor emits expected signals on fixture state
- **Component:** Synthesizer ranking / filter rules / nudge memory recording
- **Integration:** end-to-end sensor → synthesizer → filter → user surface → response tracking → memory update. Mock clock for quiet-hours tests.
- **Parity tests:** run v3 proactiveEngine and v4 pipeline side-by-side for 7 days; compare nudge dismissal rates manually before FEAT082 deletes v3.

### Phase 6 testing strategy

- **Unit:** behavioral signal scoring (positive + negative cases per signal type)
- **Component:** Channel A feedback skill → patch proposal → in-memory apply → session-scoped revert
- **Integration:** complaint phrase → instant feedback path → Pending Improvement row created within 5s; nightly Evaluator runs against fixture flagged interactions and produces ≥0 grouped proposals.
- **Self-test on patch approval:** mock approval → replay produces equivalent output → patch marked approved.
- **Diary-specific:** 7-day lag verified — diary run on Sunday 2026-04-26 covers exactly 2026-04-13 to 2026-04-19.

### Phase 7 testing strategy

- **Unit:** each new sensor (FrequencyDrift, RepetitionDetector, ConflictPredictor, TopicDrift, EnergyPattern, DependencyChain) per Phase 5 pattern
- **Component:** Pattern Learner emits proposals; in report-only mode, approve action is disabled
- **Integration:** 2-week report-only window — at end, manually validate ≥1 proposal/week was useful

### Phase 8 testing strategy

- **Locked-zone tests:** synthetic crisis phrase triggers `escalate_safety` → crisis resources surfaced → `safety_pause` row written → fixed non-LLM message until `/resume`. Patch that overlaps `safety_boundary` rejected at queue.
- **Companion-specific:** mood/friction sensors emit signals on fixture state; companion-typed nudge bypasses per-type weekly cap but respects per-day cap of 2.
- **v3 decommission:** companion.ts deleted only after assembler-side companion section removed from daily_planning skill prompt and parity confirmed.

### Phase 9 testing strategy

- **Unit:** skill override merge logic (override file overrides seed)
- **Component:** authoring flow generates a valid manifest that loads cleanly
- **Integration:** save proposed skill from chat → it loads at next restart → it routes correctly → user can edit it
- **Guardrails:** cannot disable general_assistant; cannot disable any skill with `promptLockedZones`; empty persona blocks save.

---

## 6. Risk register (additions to `09 §6`)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FEAT023 already-built code conflicts with v4 topics skill | High | Medium | Do the implementation audit (§4) before writing FEAT083 spec |
| FEAT020 rescope is misunderstood and capability hooks creep back into skill manifests | Medium | High | Architect reviews every skill manifest PR for hook-shaped fields |
| FEAT051's composer ("propose a new skill on the fly") gets reintroduced under a different name | Medium | High | ADR-001 cited in skill router PR template; PR review checks for any code that issues a second LLM call within one phrase |
| FEAT035 settings panel slips, blocking FEAT044 mobile + FEAT057 privacy UI | High | High | Treat FEAT035 as a Phase 0 (parallel to v2.01); architect to write its design review next, not wait for v2.03 |
| Skill migration dual-path log noise drowns out divergence signal | Medium | Medium | Logger writes only divergence (not parity) cases to a `migration_log` table with 7-day retention |
| Phase 2 introduces 5 new data tables / file changes simultaneously (Topics columns, executor-hook signals, weekly_planning skill, calendar admission, settings panel hookup) | Medium | High | Each PR ships exactly one migration; PR description must list it; CI check rejects PRs with multiple migrations |
| Phase 5 v3 → v4 proactive engine cutover hides a regression for users who rely on a specific nudge type | Low | Medium | Per-nudge-type accept-rate dashboard during the 7-day parallel run; manual sign-off before FEAT082 |
| Audit log table grows unbounded | Medium | Low | Add a 90-day retention policy + archival job, mirror the existing data archival pattern |

---

## 7. Patterns extracted (to add to AGENTS.md)

These are patterns I want every future PM/Architect/Coder to apply on this project. They will be appended to `AGENTS.md` (project-specific rules) — not duplicated in `ADLC/AGENTS.md`.

### To add to AGENTS.md → Architecture section

- **Skills are folders, not flat data.** Manifest + prompt + context + handlers per `docs/v4/02_skill_registry.md`. PR review rejects flat-file skill specs.
- **One LLM reasoning call per user phrase.** ADR-001 is binding. Any feature that introduces a second reasoning call within one phrase needs an ADR override before merge.
- **No on-the-fly skill composition.** A skill that doesn't fit either: (a) routes to `general_assistant`, or (b) prompts the user to author one via FEAT053 — never silently composed.
- **Capabilities are integrations, skills are domain expertise.** Don't merge them. `src/integrations/` is for external systems (Google, Slack); `src/skills/` is for LLM-facing behaviors.
- **Privacy filter is upstream.** Every new skill PR includes its `dataSchemas.read/write` declaration; PRs without are rejected. Restricted data is excluded at retrieval, not stripped from output.
- **Locked prompt zones for any safety-bearing skill.** Companion is the first; future medical/financial/legal skills follow the same pattern with explicit `promptLockedZones` in the manifest.
- **Sensors emit signals, never call the LLM, never notify the user directly.** Pluggable folder pattern per `05 §1`.
- **One migration per PR.** No PR ships two new data tables or file additions simultaneously.

### To add to AGENTS.md → Testing section

- **Every sensor unit test must include the empty-database case** (sensor returns zero signals when nothing to detect). Per `09 §7`.
- **Every skill PR records a fixture** for the LLM output of each AC, used for deterministic CI runs; a nightly job re-runs against live LLM.
- **Negative privacy tests are mandatory in Phase 3+.** For every new skill, add a test that proves it cannot read a sensitive category not in its manifest.
- **Dual-path divergence tests** required for every legacy-intent → v4-skill migration. Legacy code cannot be deleted until divergence is < 5% on a 50-phrase labeled set.

### To add to AGENTS.md → Coding section

- **Skill handlers must write through `filesystem.ts`**, never direct disk writes. Per existing rule, restated for skill-folder context.
- **Executor writes go through the topic auto-tag hook** (FEAT084) once Phase 2 ships. Skill handlers do not call `topicManager.recordSignal` directly.
- **No `process.env` reads outside `src/config/settings.ts`** (after FEAT035 ships). Every other module reads through `settings.get()` for live-update support.

---

## 8. Recommended next steps for the PM

In order:

1. **Write FEAT054 spec first** (Phase 1 anchor; everything depends on it). Use `02_skill_registry.md` as the architecture reference.
2. **Write FEAT051 spec rescoped** (drop composer; orchestrator only).
3. **Write FEAT079 spec** (POC skill — straightforward).
4. **Run the FEAT023 implementation audit** (§4) — output goes into FEAT083 spec.
5. **Write FEAT083 + FEAT084 specs** with audit findings.
6. **Schedule FEAT035 design review next** — it's a hard prerequisite for Phase 3 and mobile, currently 0% with adjacent code broken.
7. **Update FEAT020 spec to rescope to integrations only.** Delete the hook-based plugin model.
8. **Update FEAT049 to fold into `weekly_planning` skill spec.**
9. **Close FEAT050 + FEAT024** as superseded (FEAT054 and FEAT060 respectively).
10. **Per-FEAT design reviews** for everything else proceed normally — this portfolio review unblocks them.

---

**Sign-off:** This portfolio review is binding for v2.01–v2.09. Per-feature
architecture sections and testing notes will inherit from this document. If any
binding decision in §1 is contested, raise it as an ADR amendment in
`07_operations.md` before the per-feature design review starts.
