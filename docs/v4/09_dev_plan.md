# Chief Clarity v4 — Development Plan

**Author:** Architect agent (per `ADLC/agents/architect-agent.md`)
**Status:** Proposed
**Inputs:** `docs/vision.md`, `docs/v4/00_overview.md`–`08_companion.md`, current `src/` codebase, `packages/feature-kit/features/_manifest.json`
**Sibling docs:** `07_operations.md` (cost / latency / phase summary), `02_skill_registry.md` (skill folder spec)

This is the bridge from the v4 architecture to the issue tracker. It does three things:

1. **Inventory** — what exists, what needs refactor, what is net-new
2. **Feature list** — every v4 feature mapped to a `FEAT` ID (existing or proposed), grouped by component
3. **Build plan** — dependency-ordered phases, with the migration strategy for each refactor

Once approved, the proposed FEATs in §3 should be created via `npx ts-node packages/feature-kit/src/cli.ts add ...` and linked to the relevant phase below.

---

## 1. Codebase inventory (vs. v4)

### 1.1 Already exists (keep / extend)

| v4 component | Current file(s) | State | Action |
|---|---|---|---|
| Router | `src/modules/router.ts` | Regex-based intent classifier with Haiku fallback | **Refactor** — embedding-based skill matcher |
| Assembler | `src/modules/assembler.ts` | Per-intent switch statement | **Refactor** — declarative requirements + policy filter |
| LLM Dispatcher | `src/modules/llm.ts` | `MODEL_BY_INTENT` + `SONNET_FALLBACK_INTENTS` | **Refactor** — skill-aware dispatch |
| Executor | `src/modules/executor.ts` | Applies writes, semantic dedup | **Extend** — permission checks + audit log |
| Embeddings stack | `src/modules/embeddings/` (retriever, indexer, provider, background-indexer, linker) | Functional (FEAT042 Done) | **Reuse** — add skill-description embeddings + attachment chunks |
| DB layer | `src/db/` (libSQL + SQLCipher per FEAT041) | Functional | **Reuse** — add new tables only |
| Headless runner | `scripts/headless-runner.js` | Runs proactive engine + indexer | **Extend** — register new jobs |
| DB backup | `scripts/db-backup.js` | Hourly | **Reuse** as-is |
| Capability registry | `src/integrations/registry.ts` | Google Calendar only, no plug-in pattern | **Generalize** (existing FEAT020) |
| Companion (v3 module) | `src/modules/companion.ts` | Regex emotion + friction in TS, brief in LLM | **Decompose** — sensors out, skill out, locked zones in |
| Proactive engine | `src/modules/proactiveEngine.ts` (~20KB, ~11 hardcoded nudge types) | Functional but monolithic | **Replace** — sensors + synthesizer pipeline |
| Tips | `src/modules/tips.ts` | v3 insights generator | **Archive** — superseded by Synthesizer |

### 1.2 Net-new (build)

| v4 component | Target path | Driving doc |
|---|---|---|
| Skill Registry + folder loader (incl. declarative `surface` field, see `02 §10`) | `src/skills/` + `src/modules/skillRegistry.ts` | `02_skill_registry.md §2, §10` |
| Each skill folder (manifest + prompt + context + handlers) | `src/skills/<id>/` (one per migrated intent + companion) | `02_skill_registry.md §6`, `08_companion.md` |
| Data Schema Registry | `src/config/data_schemas.json` | `03_memory_privacy.md §2` |
| User policy overrides | `src/config/user_policy_overrides.json` (gitignored) | `03_memory_privacy.md §2` |
| Audit log | `src/modules/auditLog.ts` + `audit_log` table | `03_memory_privacy.md §3` |
| Locked prompt zone enforcement | extension to `src/modules/skillRegistry.ts` + Pending Improvements writer | `02_skill_registry.md §9`, `08_companion.md §5` |
| Sensor folder + loader | `src/sensors/` + `src/modules/sensorRegistry.ts` | `05_proactive_intelligence.md §1` |
| Sensors (initial 5) | `src/sensors/{recencyWatcher,objectiveProgress,loadDensity,deadlineApproach,commitmentTracker}.ts` | `05_proactive_intelligence.md §1` |
| Sensors (companion) | `src/sensors/{moodSignal,frictionSignal}.ts` | `08_companion.md §3` |
| Sensors (remaining) | `src/sensors/{frequencyDrift,repetitionDetector,conflictPredictor,topicDrift,energyPattern,dependencyChain}.ts` | `05_proactive_intelligence.md §1` |
| Signal Synthesizer | `src/modules/proactiveSynthesizer.ts` | `05_proactive_intelligence.md §2` |
| Nudge Filter | `src/modules/nudgeFilter.ts` | `05_proactive_intelligence.md §3` |
| Pattern Learner | `src/modules/patternLearner.ts` | `05_proactive_intelligence.md §6` |
| Feedback skill (Channel A) | `src/skills/feedback/` | `06_feedback_improvement.md §2` |
| Behavioral self-scorer (Channel B) | `src/modules/selfScorer.ts` | `06_feedback_improvement.md §3` |
| Nightly Evaluator (Channel C) | `src/modules/evaluatorAgent.ts` | `06_feedback_improvement.md §4` |
| Pending Improvements UI | `app/pending-improvements.tsx` + `pending_improvements` table | `06_feedback_improvement.md §5` |
| Self-test on patch approval | `src/modules/patchSelfTest.ts` | `06_feedback_improvement.md §6` |
| Weekly Diary Agent | `src/modules/diaryAgent.ts` + `narratives` table changes | `06_feedback_improvement.md §7` |
| Companion skill | `src/skills/companion/` | `08_companion.md §2` |
| Topics skill (declares Topics surface) | `src/skills/topics/` | `10_topics.md §3, §6` |
| Executor topic auto-tag hook (confirm-and-learn) | `src/modules/executor.ts` extension | `10_topics.md §4` |
| TopicEmergence sensor | `src/sensors/topicEmergence.ts` | `10_topics.md §5` |
| Safety check + crisis resources | `src/modules/safetyCheck.ts` + `src/config/crisis_resources.json` | `08_companion.md §2` |
| Attachment store | `src/modules/attachments/{detector,parsers,chunker,store}.ts` + `attachment_chunks` table | `04_attachments_rag.md` |
| Live attachment sync | `src/modules/attachments/liveSync.ts` | `04_attachments_rag.md` |

### 1.3 New DB tables

| Table | Migration owner | Spec source |
|---|---|---|
| `attachment_chunks` | Phase 4 | `03_memory_privacy.md §1` |
| `sensor_signals` | Phase 5 | `03_memory_privacy.md §1` |
| `nudges` (extend existing) | Phase 5 | `03_memory_privacy.md §1` (response columns) |
| `pending_improvements` | Phase 6 | `03_memory_privacy.md §1` |
| `audit_log` | Phase 3 | `03_memory_privacy.md §3` |
| `narratives` (period_type, period_start, period_end) | Phase 6 | `06_feedback_improvement.md §7` |

---

## 2. Existing FEATs aligned to v4

These already exist in the backlog; v4 work folds into them. Status from `_manifest.json`:

| FEAT | Title | v4 component | Current status | v4 action |
|---|---|---|---|---|
| FEAT020 | Capability Registry Plugin System | Capability Registry generalization | Planned | Pull into Phase 2 |
| FEAT025 | Multi-LLM provider support | LLM gateway abstraction | Planned (COULD) | Defer to post-v4 |
| FEAT027 | App Authentication Gate (PIN + biometrics) | Sits below privacy layer | Planned | Independent track — keep |
| FEAT039 | Day/Week/Month objective layers | Used by Synthesizer (`userObjectives`) | Planned | Prerequisite for Phase 5 |
| FEAT040 | Calendar admission control | Becomes a sensor + a skill rule | Planned | Fold into Phase 5 + calendar skill |
| FEAT044 | Capacitor native DB + embeddings | Platform foundation | Planned | Independent track — must hold v4 invariants |
| FEAT049 | Weekly retrospective | Becomes a `weekly_planning` skill output | Planned | Fold into Phase 2 (skill migration) |
| FEAT050 | Skill Runtime — declarative skills as data | Skill Registry foundation | Planned | **Phase 1 anchor** |
| FEAT051 | Skill Router and Composer | Embedding-based Orchestrator | Planned | **Phase 1 anchor** |
| FEAT052 | Context Cache with Generation Tokens | Assembler optimization | Planned | Phase 2 |
| FEAT053 | Skill Library UX | Skill author/edit UI | Planned (SHOULD) | Defer to Phase 9 |
| FEAT023 | Topic Repository core system | **Topics first-class in v4** — basis for `topics` skill, sensor, surface, executor hook | Design Reviewed | Anchor for Phase 2 Topics work — promote to In Progress |
| FEAT024 | Topic auto-promotion | Becomes the `TopicEmergence` sensor | Planned | Refactored into Phase 5 sensor pack |
| FEAT035 | In-App Settings Panel | Hosts user policy overrides UI (FEAT057) | Planned | Phase 3 |
| FEAT027 | App Auth Gate (PIN + biometrics) | Independent track | Planned | Any phase, parallel |

Already done (no v4 work needed): FEAT021 encryption, FEAT028 tasks tab, FEAT041 libSQL/SQLCipher, FEAT042 semantic retrieval, FEAT043 two-stage reasoning, FEAT045 reactive focus brief, FEAT046 brief UI, FEAT047 data hygiene, FEAT022 per-intent routing, FEAT018 Google Calendar, FEAT016 OKR, MVP set FEAT007–FEAT014.

Rejected — confirm still rejected under v4: FEAT033 (two-phase entity retrieval — superseded by per-skill semantic memory), FEAT037 (core context floor — replaced by per-skill `contextRequirements`), FEAT038 (multi-intent router — v4 keeps single-skill routing), FEAT026 (bulk note batch — superseded by attachment ingestion).

---

## 3. New FEATs to create

These are the v4 features without an existing FEAT. Each row is a one-line spec; create with the feature-kit CLI per `CLAUDE.md`.

| Proposed | Title | Category | MoSCoW | Priority | Release | Tags | Doc |
|---|---|---|---|---|---|---|---|
| FEAT054 | Skill folder loader + validator (incl. declarative `surface` field for skill-contributed UI tabs) | Architecture | MUST | 1 | v2.01 | skills, registry, loader, validator, surfaces | 02 §2, §8, §10 |
| FEAT079 | Skill migration: priority_planning (proof-of-concept skill folder) | Architecture | MUST | 1 | v2.01 | skill-migration, poc, priority | 02 §7 |
| FEAT080 | Skill migration batch 1: task_management, notes, calendar, inbox_triage, emotional_checkin | Architecture | MUST | 1 | v2.02 | skill-migration, batch-1 | 02 §7 |
| FEAT081 | Skill migration batch 2: daily_planning, weekly_planning, research, info_lookup | Architecture | MUST | 1 | v2.02 | skill-migration, batch-2 | 02 §7 |
| FEAT083 | Topics skill — topic-scoped digest, declares Topics surface | Topics | MUST | 1 | v2.02 | topics, skill, surface, digest | 10 §3, §6 |
| FEAT084 | Executor topic auto-tag hook (confirm-and-learn, tiered thresholds) | Topics | MUST | 1 | v2.02 | topics, executor, auto-tag, learn | 10 §4 |
| FEAT055 | Data Schema Registry and per-skill access policy | Security | MUST | 1 | v2.03 | privacy, schema-registry, policy, assembler-filter | 03 §2–3 |
| FEAT056 | Audit log for all skill reads and writes | Security | MUST | 1 | v2.03 | audit, security, append-only | 03 §3 |
| FEAT057 | User policy overrides UI (per-skill grant/revoke, hosted in FEAT035 settings panel) | UX | SHOULD | 2 | v2.03 | settings, privacy, grants | 03 §2 |
| FEAT058 | Locked prompt zones — manifest field, loader validation, Evaluator elision | Security | MUST | 1 | v2.03 | safety, prompt-locked-zones, evaluator | 02 §9, 08 §5 |
| FEAT076 | Attachment ingestion pipeline (detector + parsers + chunker + store) | Memory | MUST | 1 | v2.04 | attachments, ingestion, rag, parsers | 04 |
| FEAT077 | Attachment lifetime classifier (ephemeral / session / persistent / live) | Memory | MUST | 1 | v2.04 | attachments, lifetime, ttl | 04 |
| FEAT078 | Live attachment sync (Google Sheets first, Notion later) | Memory | SHOULD | 2 | v2.04 | live-sync, sheets, notion, hourly | 04 |
| FEAT059 | Sensor folder + loader (pluggable signal sensors) | Architecture | MUST | 1 | v2.05 | sensors, registry, loader | 05 §1 |
| FEAT060 | Initial sensor pack: RecencyWatcher, ObjectiveProgress, LoadDensity, DeadlineApproach, CommitmentTracker, **TopicEmergence** | Proactive | MUST | 1 | v2.05 | sensors, initial-pack, proactive, topics | 05 §1, 10 §5 |
| FEAT061 | Signal Synthesizer (3x/day, ranked nudge proposals) | Proactive | MUST | 1 | v2.05 | synthesizer, haiku, ranking, scheduled | 05 §2 |
| FEAT062 | Nudge Filter (quiet hours, caps, mute, dedup, channel routing) | Proactive | MUST | 1 | v2.05 | filter, channel-routing, quiet-hours | 05 §3 |
| FEAT063 | Nudge memory and personalization loop | Proactive | MUST | 2 | v2.05 | memory, response-tracking, personalization | 05 §4 |
| FEAT082 | Decommission proactiveEngine.ts and tips.ts after sensor parity | Architecture | MUST | 2 | v2.05 | cleanup, deprecation, parity-check | inventory §1.1 |
| FEAT066 | Feedback skill (Channel A — instant in-chat feedback + auto-redo) | Self-Improvement | MUST | 1 | v2.06 | feedback, skill, instant, redo | 06 §2 |
| FEAT067 | Behavioral Self-Scorer (Channel B — implicit signals) | Self-Improvement | MUST | 1 | v2.06 | self-scorer, behavioral, signals | 06 §3 |
| FEAT068 | Nightly Feedback Evaluator (Channel C — batch synthesis) | Self-Improvement | MUST | 1 | v2.06 | evaluator, nightly, haiku-batch | 06 §4 |
| FEAT069 | Pending Improvements UI (review queue, diff view, approve/reject) | UX | MUST | 1 | v2.06 | ui, diff, approve, reject, audit | 06 §5 |
| FEAT070 | Self-test on patch approval (replay flagged interactions) | Self-Improvement | MUST | 2 | v2.06 | self-test, replay, validation | 06 §6 |
| FEAT071 | Weekly Diary Agent (7-day lag, weekly narrative, narratives table v2) | Self-Improvement | MUST | 1 | v2.06 | diary, weekly, lag, narratives | 06 §7 |
| FEAT064 | Pattern Learner (weekly tuning proposals; tunes Topics auto-tag thresholds too) | Proactive | SHOULD | 2 | v2.07 | pattern-learner, weekly, sensor-tuning, topics-thresholds | 05 §6, 10 §4 |
| FEAT065 | Sensor pack 2: FrequencyDrift, RepetitionDetector, ConflictPredictor, TopicDrift, EnergyPattern, DependencyChain | Proactive | SHOULD | 2 | v2.07 | sensors, expansion-pack | 05 §1 |
| FEAT072 | Companion skill (interactive emotional support, tier split, locked zones, Companion surface) | Companion | MUST | 1 | v2.08 | companion, skill, sonnet-haiku, locked, surface | 08 §2 |
| FEAT073 | Companion sensors (mood_signal + friction_signal) | Companion | MUST | 1 | v2.08 | sensors, mood, friction, companion | 08 §3 |
| FEAT074 | Safety check + crisis resources + escalate_safety tool | Companion | MUST | 1 | v2.08 | safety, crisis, escalation, locale | 08 §2 |
| FEAT075 | Companion proactive check-ins (Synthesizer surfacing + per-day cap = 2) | Companion | MUST | 2 | v2.08 | proactive, check-ins, nudge-filter-rule | 08 §4 |

**31 new FEATs total** (FEAT054–FEAT084, plus FEAT053 already exists for v2.09). Releases `v2.01`–`v2.09` correspond directly to phase numbers below.

---

## 4. Dependency graph

```
                            ┌─────────────────────────────┐
                            │ FEAT054  Skill folder loader │ ←── Phase 1 anchor
                            └────────────┬────────────────┘
                                         │
                ┌────────────────────────┼─────────────────────────┐
                ▼                        ▼                         ▼
      FEAT051 Skill Router       FEAT050 Skill Runtime     FEAT079 priority_planning POC
      (embedding orchestrator)   (declarative skills)      (proof-of-concept skill)
                │                        │                         │
                └─────────────┬──────────┴─────────┬───────────────┘
                              ▼                    ▼
                     FEAT080 Skill batch 1    FEAT020 Capability Registry plug-in
                     FEAT081 Skill batch 2    FEAT052 Context Cache
                     FEAT083 Topics skill     FEAT023 Topic Repository (existing)
                     FEAT084 Topic auto-tag   FEAT039 Day/Week/Month layers
                     FEAT040 Calendar admission  FEAT049 Weekly retro
                              │
                              ▼
        ┌──────────────── Phase 3: Privacy ────────────────┐
        │   FEAT055 Data Schema Registry                    │
        │   FEAT056 Audit log                               │
        │   FEAT057 User policy overrides UI                │
        │   FEAT058 Locked prompt zones                     │
        └────────────┬──────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  Phase 4: Attachments     Phase 5: Proactive
  FEAT076 ingestion        FEAT059 Sensor loader
  FEAT077 lifetimes        FEAT060 Initial sensor pack ──┐
  FEAT078 live sync        FEAT061 Synthesizer           │
                           FEAT062 Nudge Filter          │
                           FEAT063 Nudge memory          │
                           FEAT065 Sensor pack 2         │
                           FEAT082 Decommission v3 engine ◄┘ (after parity)
                                          │
                                          ▼
                          ┌───────── Phase 6: Self-Improvement ─────────┐
                          │  FEAT066 Feedback skill (Channel A)         │
                          │  FEAT067 Behavioral Self-Scorer (B)         │
                          │  FEAT068 Nightly Evaluator (C)              │
                          │  FEAT069 Pending Improvements UI            │
                          │  FEAT070 Self-test on patch approval        │
                          │  FEAT071 Weekly Diary Agent (7-day lag)     │
                          └────────────────┬────────────────────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │      Phase 7: Pattern Learner    │
                          │      FEAT064 Pattern Learner     │
                          └────────────────┬─────────────────┘
                                           ▼
                          ┌──────── Phase 8: Companion ─────────┐
                          │  FEAT074 Safety check (locked zones │
                          │          required → blocks on F58)  │
                          │  FEAT073 Mood + friction sensors    │
                          │  FEAT072 Companion skill            │
                          │  FEAT075 Proactive check-ins        │
                          └─────────────────────────────────────┘
                                           │
                                           ▼
                                   FEAT053 Skill Library UX (Phase 9, optional)
```

**Hard dependencies (must finish before next can start):**

| Feature | Depends on | Why |
|---|---|---|
| FEAT051 | FEAT054 | Router needs the registry to embed against |
| FEAT079 | FEAT054 + FEAT051 | First skill needs loader + router |
| FEAT080–081 | FEAT079 | Migrate after POC validates the pattern |
| FEAT055 | FEAT054 | Schema policy attaches to skill manifest |
| FEAT058 | FEAT054 + FEAT055 | Locked-zone validation runs in skill loader |
| FEAT072 (companion skill) | FEAT058 + FEAT074 | Safety zones must be enforceable before companion ships |
| FEAT061 | FEAT059 + FEAT060 | Synthesizer needs sensors to consume |
| FEAT062 | FEAT061 | Filter sits after Synthesizer |
| FEAT063 | FEAT062 | Memory tracks filtered nudges |
| FEAT082 | FEAT060 + FEAT061 + FEAT062 | Don't decommission v3 engine until v4 sensor pack ≥ functional parity |
| FEAT083 | FEAT054 + FEAT023 | Topics skill needs registry + existing Topic Repository data layer |
| FEAT084 | FEAT083 + executor refactor | Auto-tag hook needs topics skill in place to invoke its create flow |
| FEAT060 (TopicEmergence portion) | FEAT083 + FEAT084 | Sensor needs the skill to route accept-nudge actions through, and the auto-tag hook to avoid re-proposing already-tagged items |
| FEAT068 | FEAT067 | Evaluator reads scored interactions |
| FEAT069 | FEAT066 + FEAT068 | UI surfaces both feedback channels |
| FEAT070 | FEAT069 | Self-test runs on approval action |
| FEAT071 | FEAT054 + FEAT067 | Diary uses skill-tagged activity |
| FEAT075 | FEAT072 + FEAT062 | Check-ins are filtered nudges that route to companion skill |
| FEAT064 | FEAT063 + FEAT069 | Learns from response data, surfaces via Pending Improvements |
| FEAT076 | FEAT055 | Attachment chunks must respect schema policy |
| FEAT078 | FEAT076 | Live sync rebuilds chunks |

**Soft dependencies (recommended order, not blocking):**
- FEAT039 (Day/Week/Month objective layers) before Phase 5 — Synthesizer's `userObjectives` input works better with explicit period layering.
- FEAT040 (Calendar admission control) folds into the calendar skill in Phase 2 and into a `LoadDensity` sensor in Phase 5 — split work between both phases.
- FEAT044 (Capacitor native DB + embeddings) is **on hold until Phase 3 completes** (per user decision §8.6). Porting before the privacy filter and skill registry land would mean re-porting code that's about to be refactored. Resume mobile work after Phase 3 exit criteria pass.
- FEAT027 (PIN + biometrics) is independent and can run in parallel any time.

---

## 5. Phased build plan

Aligned with `07_operations.md §4`, refined with concrete FEAT IDs, exit criteria, and migration strategy.

### Phase 1 — Skill Registry foundation (2 weeks → release v2.01)

**Deliverables:** FEAT054 (incl. declarative `surface` field), FEAT051, FEAT050, FEAT079
**Goal:** One skill (`priority_planning`) routes through the new pipeline end-to-end alongside the existing intent system.

**Migration strategy — feature-flagged dual path:**
- New env `V4_SKILLS_ENABLED=priority_planning` (comma list)
- Router checks: if user phrase routes to a v4-enabled skill via embedding similarity, take the new path; otherwise fall through to legacy `MODEL_BY_INTENT`.
- Legacy router code stays untouched — zero risk to existing intents.

**Exit criteria:**
- `src/skills/priority_planning/` loads at boot with a startup log line
- A "what should I focus on" request takes the new path (visible in audit log even before the audit feature is built — interim console log)
- Legacy `priority_ranking` intent still works when flag is off
- Unit test: skill loader rejects malformed manifests
- Integration test: end-to-end phrase → skill → tool call → executor write → response

### Phase 2 — Full skill migration + Topics (3 weeks → v2.02)

**Deliverables:** FEAT080, FEAT081, FEAT083 (Topics skill + surface), FEAT084 (executor topic auto-tag), FEAT020 (Capability Registry generalization), FEAT052 (Context Cache), FEAT039 (Day/Week/Month layers), partial FEAT040 (calendar admission rule), FEAT049 (Weekly retro folded into `weekly_planning` skill)

**Topics in Phase 2:** FEAT023's existing data layer (`topics`, `topic_signals`, etc.) is reused. The skill (FEAT083) wraps it with v4 routing and declares the Topics surface. The executor hook (FEAT084) replaces per-intent topic-recording with a universal hook. The TopicEmergence sensor lands in Phase 5 — until then, topic creation is user-initiated only.

**Migration strategy — one skill at a time:**
1. Pick an intent from the legacy router
2. Create skill folder per `02_skill_registry.md §6`
3. Add to `V4_SKILLS_ENABLED`
4. Run both paths side-by-side for 48h, log divergence (audit on legacy intent path → new skill output for the same phrase, where possible)
5. Once parity confirmed, delete the legacy intent branch from `router.ts` + `assembler.ts`

Order (lowest risk first — CRUD before reasoning):
`task_management` → `notes` → `calendar` → `inbox_triage` → `emotional_checkin` → `info_lookup` → `daily_planning` → `weekly_planning` → `research` → `priority_planning` already done

**Exit criteria:**
- All 17 legacy intents migrated; legacy intent code deleted
- Router file is < 100 lines (just embedding match + tiebreaker + structural triggers)
- Assembler is fully declarative — no `switch (intent.type)` left

### Phase 3 — Data Schema Registry + privacy (2 weeks → v2.03)

**Deliverables:** FEAT055, FEAT056, FEAT057, FEAT058
**Goal:** Privacy enforcement is structural — restricted data never reaches the LLM.

**Migration strategy — additive enforcement:**
- Land `data_schemas.json` with **liberal defaults first** (no skill loses access on day 1)
- Audit log starts capturing every read
- After 1 week of audit data, tighten the defaults to least-privilege based on what skills actually used
- `requiresExplicitGrant` categories (medical, financial) start excluded — user must opt in via FEAT057 UI
- Locked prompt zones (FEAT058) wired into Evaluator + Pending Improvements before either feature is built — establishes the contract early

**Exit criteria:**
- Audit log row for every skill read in the last 24h
- Calendar skill cannot read `medical` category (negative test)
- A patch attempt that overlaps a locked zone is rejected at queue insertion
- Skill loader fails fast if a declared `promptLockedZones` name is missing from `prompt.md`

### Phase 4 — Attachments & RAG (3 weeks → v2.04)

> *Runs serially before Phase 5 (per user decision §8.7 — safer, single-engineer path).*

**Deliverables:** FEAT076, FEAT077, FEAT078

**Migration strategy:**
- Detector + parsers behind `V4_ATTACHMENTS_ENABLED` flag
- Per-attachment `lifetime` defaults to `ephemeral` (ADR-004)
- Sheets live sync ships first (single integration); Notion in Phase 7

**Exit criteria:**
- A user can drop a CSV in chat, ask a question about it, get an answer with attachment chunks visible in the response trace
- Ephemeral attachment is gone from RAM after session timeout
- Persistent attachment survives restart and remains query-able
- Live Sheet edit reflects in next attachment query within sync interval

### Phase 5 — Proactive Intelligence (3 weeks → v2.05)

**Deliverables:** FEAT059, FEAT060 (incl. **TopicEmergence** per `10_topics.md §5`), FEAT061, FEAT062, FEAT063, FEAT082, partial FEAT040 (LoadDensity sensor), FEAT024 superseded by TopicEmergence sensor

**Migration strategy — parity then cutover:**
1. Build sensor folder + initial 5 sensors → write to `sensor_signals` table
2. Build Synthesizer → reads signals, emits `nudge_proposals`
3. Build Nudge Filter → reads proposals, writes filtered nudges to existing `nudges` table (extended with response columns)
4. **Run v3 `proactiveEngine.ts` and v4 pipeline in parallel for 7 days.** Both write to `nudges` with a `source` column added (`v3-engine` | `v4-synth`). Compare output quality manually.
5. Once v4 dominates by quality + the user dismisses fewer v4 nudges, flip a flag to silence v3 engine.
6. After 7 more days with no regressions, FEAT082 deletes `proactiveEngine.ts` and `tips.ts`.

**Exit criteria:**
- All 5 initial sensors emit signals visible in `sensor_signals`
- Synthesizer produces ≤3 ranked nudges per run
- Nudge Filter respects quiet hours + daily caps (verified with mock clock)
- v3 proactiveEngine.ts deleted, no orphan callers
- Background cost stays under target (`07_operations.md §2`)

### Phase 6 — Feedback & Self-Improvement (3 weeks → v2.06)

**Deliverables:** FEAT066, FEAT067, FEAT068, FEAT069, FEAT070, FEAT071

**Migration strategy:**
- Channel B (FEAT067) ships first — pure TS, $0, no risk, generates the data the rest needs
- Channel A (FEAT066) ships next as a normal skill
- Channel C (FEAT068) needs ≥1 week of Channel B data before its first useful run
- Pending Improvements UI (FEAT069) is read-only at first (view, no approve) — turn on approval after one week of clean proposals
- Self-test (FEAT070) gates approval — no approve button until self-test passes
- Diary Agent (FEAT071) is independent of all the above; can ship anytime in this phase

**Migration plan for `narratives` table:**
```sql
ALTER TABLE narratives ADD COLUMN period_type TEXT NOT NULL DEFAULT 'week';
ALTER TABLE narratives ADD COLUMN period_start TEXT NOT NULL DEFAULT '';
ALTER TABLE narratives ADD COLUMN period_end TEXT NOT NULL DEFAULT '';
-- Backfill: any existing daily entries get period_type='day', period_start=period_end=their date
```

Run weekly diary first time on the second Sunday after launch (gives 7+7 days of buffer + a full target week of data).

**Exit criteria:**
- A "that was wrong" message produces a visible Pending Improvement within 5s
- Nightly Evaluator runs at 02:00 and produces ≥0 grouped proposals (zero is fine on a quiet night)
- Approving a patch runs self-test and either marks `approved` or warns "patch may be incomplete"
- Weekly Diary covers exactly the week ending 7 days before the run

### Phase 7 — Pattern Learner + remaining sensors (2 weeks → v2.07)

**Deliverables:** FEAT064 (also tunes Topics auto-tag thresholds per `10_topics.md §4`), FEAT065, FEAT078 follow-up (Notion live sync)

**Migration strategy:**
- Pattern Learner runs in *report-only* mode for two weeks — proposals visible in Pending Improvements but the "approve" action is disabled. This validates that proposals are coherent before they can change behavior.
- Sensor pack 2 ships incrementally — one sensor per day with its own validation that signals are reasonable.

**Exit criteria:**
- Pattern Learner produces at least one proposal per week that the user finds useful (manual judgment)
- All 11 sensors active, all visible in `sensor_signals`

### Phase 8 — Companion (2 weeks → v2.08)

> *Hard prerequisite: FEAT058 locked zones must be live and tested. Companion ships only after.*

**Deliverables:** FEAT074, FEAT073, FEAT072, FEAT075

**Migration strategy:**
1. **Safety first:** FEAT074 ships before FEAT072 even exists. The `escalate_safety` tool is wired through `safetyCheck.ts` and tested with synthetic crisis phrases. `crisis_resources.json` is locale-aware.
2. **Sensors next:** FEAT073 mood + friction sensors emit signals into the existing pipeline. They produce no user-facing output until the skill ships — useful as a calibration period.
3. **Skill ships:** FEAT072 with both locked zones (`safety_boundary`, `non_clinical_disclaimer`). Skill loader rejects on missing zones (test).
4. **Old `companion.ts` decommissioned:** the v3 module is read by the assembler today. Once the v4 skill is live and the assembler-side companion section is removed from the daily_planning skill prompt, delete `src/modules/companion.ts`.
5. **Proactive check-ins last:** FEAT075 turns on Synthesizer surfacing of companion-typed nudges with the per-day cap of 2.

**Exit criteria:**
- A test phrase containing a crisis keyword triggers `escalate_safety`, surfaces crisis resources, sets `safety_pause` in observations, and the skill returns the fixed non-LLM message until `/resume`
- A patch that touches text inside `<!-- LOCKED:safety_boundary -->` is rejected at queue insertion
- Mood-signal nudge bypasses per-type weekly cap but respects per-day cap of 2
- v3 `companion.ts` deleted

### Phase 9 — Skill Library UX (1–2 weeks, optional, → v2.09)

**Deliverables:** FEAT053
**Goal:** User-facing skill browse / author / edit. Optional — not required for v5 release. See `02_skill_registry.md` for the data model FEAT053 should expose.

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Skill migration introduces silent regressions in legacy intents | Medium | High | Dual-path period in Phase 2 (legacy + v4 side-by-side, log divergence) before deleting legacy code |
| Embedding-based router misclassifies edge cases that regex caught | Medium | Medium | Haiku tiebreaker + Phase 1 POC on the hardest intent (`priority_planning`) before fanning out |
| Privacy filter blocks data a skill genuinely needs and it fails silently | Medium | High | Phase 3 starts with liberal defaults; tighten only after audit data shows actual usage |
| v4 sensors produce more noise than v3 engine | Medium | Medium | 7-day parity period in Phase 5 with `source` column on nudges; user comparison before v3 deletion |
| Locked-zone enforcement has a hole the auto-patcher exploits | Low | Critical | Three independent enforcement points (loader, Evaluator elision, Pending Improvements queue); plus post-apply hash check (FEAT070) |
| Companion deep check-ins run away on Sonnet cost | Low | Medium | Per-day cap of 2 (FEAT075) + accept-rate monitoring; if accepted nudges stay above projection, raise alarm |
| Capacitor port (FEAT044) ships in parallel and breaks v4 invariants | Medium | High | Cross-team review checkpoint at end of each v4 phase to ensure mobile path uses skill registry, not a forked router |
| Diary 7-day lag is too short and still loses backfilled notes | Low | Low | ADR-008 notes the lag is configurable; extend to 14 days if real usage shows it |
| Nightly Evaluator over-proposes patches and overwhelms reviewer | Medium | Medium | Phase 6 launches Pending Improvements as read-only for one week first |

---

## 7. Working agreements

These apply across all v4 phases:

1. **Every new skill ships with its `dataSchemas.read/write` declaration** — no exceptions. PR review rejects skills with overly broad declarations.
2. **Every new sensor ships with its `intervalMs`** and a unit test that verifies it emits zero signals on an empty database.
3. **Every locked zone is documented in the skill's manifest** AND has a test that proves the loader rejects the skill if the zone is removed.
4. **Each phase exit criterion must be observable in the audit log** — no "trust me, it works."
5. **No phase deletes legacy code** until a parallel-run comparison period has shown the v4 path matches or exceeds v3 quality.
6. **Architecture doc sync:** every PR that adds a new skill, sensor, or DB table updates `docs/new_architecture_typescript.md` per `CLAUDE.md` rules.
7. **Feature backlog sync:** every PR that completes a FEAT updates its status via the feature-kit CLI per `CLAUDE.md` rules.

---

## 8. Resolved decisions and remaining open questions

### Resolved (2026-04-26)

1. **Companion model split** — ✅ **Keep Haiku/Sonnet split** per `08_companion.md §2`. Haiku for inline replies, Sonnet for deep check-ins. Skill prompt selects via `depth` tool arg.
2. **Diary lag** — ✅ **7 days confirmed.** Weekly diary covers the week ending 7 days before the run. Codified in FEAT071 spec.
3. **Companion per-day cap** — ✅ **Cap = 2** companion-typed nudges per day. Bypasses per-type weekly cap. Codified in FEAT062 + FEAT075.
5. **Skill migration order** — ✅ **CRUD-first confirmed.** Order: `task_management` → `notes` → `calendar` → `inbox_triage` → `emotional_checkin` → `info_lookup` → `daily_planning` → `weekly_planning` → `research`. (`priority_planning` already done as Phase 1 POC.)
6. **Mobile parallelization** — ✅ **FEAT044 holds until Phase 3 completes.** Avoids porting code that's about to be refactored for privacy filter and skill registry. Resume after Phase 3 exit criteria pass.
7. **Phase 4 vs 5 parallelization** — ✅ **Serial.** Phase 4 (Attachments) ships before Phase 5 (Proactive). Single-engineer path; safer.

### Still open — decide before FEAT spec creation

4. **Pattern Learner approve gate** — Phase 7 plan runs PL in report-only mode for 2 weeks before the approve button is enabled. Two weeks delays the first behavior-changing proposal but validates that PL output is coherent before it can edit the system. **Need: confirm 2-week delay, shorten to 1 week, or skip and approve from day 1?**
8. **Feedback skill prompt patches scope** — Two options:
   - **(a) Approval-required for all skills** — current design, honors ADR-005 (every permanent change reviewed).
   - **(b) Auto-applied for non-locked skills with 24h undo** — ships faster, less reviewer fatigue, but bypasses ADR-005 for the 24h window.
   **Recommendation:** stay with (a). The cost of one missed bad patch outweighs the cost of slower approval. ADR-005 was specifically chosen for this reason. **Need: confirm (a), or override to (b)?**

---

## 9. Out of scope for v2

Carried into v3 backlog:

- Multi-LLM provider gateway (FEAT025) — defer; v5 stays Claude-only
- User-installable third-party skills (vision §232) — needs sandboxing layer not designed yet
- Cross-skill reasoning (skill A consults skill B) — explicitly violates ADR-001; needs separate ADR if revisited
- Mobile-native experience (FEAT005 / FEAT044) — independent platform track; v5 architecture must support it but does not deliver it

---

## 10. Estimated total

- **New FEATs to create:** 31 (FEAT054–FEAT084)
- **Existing FEATs to advance:** 9 (FEAT020, FEAT023, FEAT024, FEAT027, FEAT035, FEAT039, FEAT040, FEAT044, FEAT049, FEAT050, FEAT051, FEAT052, FEAT053)
- **Calendar duration:** 9 phases × ~2.5 weeks average = **~22 weeks** sequentially (Phase 4/5 confirmed serial per §8.7). Phase 9 is optional; without it ~20 weeks.
- **Background cost at end-state:** ~$0.16/month per user + ~$0.20/month for Topics skill = **~$0.36/month** (`07_operations.md §2` + `10_topics.md §9`)

This plan is the bridge from architecture to backlog. Once §8 questions are answered, the PM agent can run `feature-kit add` for each row in §3 and the program-manager agent can sequence the work per §5.
