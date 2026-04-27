# Chief Clarity v4 — Operations, Cost, Migration & ADR

---

## 1. Background scheduling

All background work runs via the existing headless runner (`scripts/headless-runner.js`).
New jobs are registered in its job table. The app also runs each job on an internal
`setInterval` while open (per CLAUDE.md: the app is open for days, not just on mount).

### Job schedule

| Job | Interval (app open) | Headless schedule | File |
|---|---|---|---|
| Signal Sensors | Per-sensor interval (default 15min) | Same | `src/sensors/*.ts` |
| Signal Synthesizer | Every 4h | 08:00, 13:00, 19:00 | `src/modules/proactiveSynthesizer.ts` |
| Live Attachment Sync | Every 1h | Hourly | `src/modules/attachments/liveSync.ts` |
| Nightly Evaluator | — | 02:00 | `src/modules/evaluatorAgent.ts` |
| Weekly Diary Agent | — | Sunday 23:30 (covers week ending 7 days ago) | `src/modules/diaryAgent.ts` |
| Pattern Learner | — | Sunday 03:00 | `src/modules/patternLearner.ts` |
| Mood/Friction Sensors | 30min | Same | `src/sensors/moodSignal.ts`, `src/sensors/frictionSignal.ts` |
| DB Backup | Every 1h | Hourly | `scripts/db-backup.js` |
| Session Attachment Cleanup | Every 30min | — | `src/modules/attachments/attachmentStore.ts` |

### Race condition guards

All jobs must check the `isJobRunning(jobId)` guard before executing, consistent
with the existing `loadingRef` / `inboxProcessingRef` pattern. No two instances of
the same job may run concurrently.

---

## 2. Cost model

### Interactive path (per user phrase)

| Scenario | Calls | Approx. cost |
|---|---|---|
| Simple phrase, high-confidence routing | 1 Haiku | $0.0001 |
| Simple phrase, ambiguous routing | 1 Haiku classifier + 1 Haiku reasoning | $0.0002 |
| Complex phrase, unambiguous routing | 1 Sonnet | $0.010 |
| Complex phrase, ambiguous routing | 1 Haiku classifier + 1 Sonnet | $0.010 |
| Instant feedback + auto-redo | 1 Haiku (evaluator) + 1 Sonnet (redo) | $0.011 |

### Background (per month, 1 user)

| Job | Frequency | Tokens/run | Cost/month |
|---|---|---|---|
| Signal Synthesizer | ~90 runs | ~2500 | $0.018 |
| Nightly Evaluator | ~30 runs | ~4000 | $0.015 |
| Weekly Diary Agent | ~4 runs | ~5000 | $0.003 |
| Pattern Learner | ~4 runs | ~3000 | $0.004 |
| Companion deep check-ins (Sonnet) | ~12 runs | ~3000 | $0.120 |
| Ingestion Summarizer | Occasional | ~varies | $0.002 est. |
| **Background total** | | | **~$0.16/month** (was ~$0.05 before companion; companion deep check-ins dominate the new total) |

### Total monthly cost estimate

| Usage level | Interactive phrases/day | Total/month |
|---|---|---|
| Light (5/day) | 5 | $0.05 + $0.05 bg = **$0.10** |
| Moderate (20/day) | 20 | $0.20 + $0.05 bg = **$0.25** |
| Heavy (50/day) | 50 | $0.50 + $0.05 bg = **$0.55** |
| Power user (100/day) | 100 | $1.00 + $0.05 bg = **$1.05** |

Background cost is essentially fixed regardless of usage level. Interactive cost
scales linearly at ~$0.01/phrase (Sonnet-weighted average).

---

## 3. Latency model

| Scenario | Breakdown | Total |
|---|---|---|
| High-confidence Haiku skill | TS routing 5ms + Assembler 15ms + Haiku 400ms | ~420ms |
| High-confidence Sonnet skill | TS routing 5ms + Assembler 20ms + Sonnet 1200ms | ~1225ms |
| Ambiguous → Haiku tiebreaker → Haiku skill | 5ms + Haiku 200ms + 15ms + Haiku 400ms | ~620ms |
| Ambiguous → Haiku tiebreaker → Sonnet skill | 5ms + Haiku 200ms + 20ms + Sonnet 1200ms | ~1425ms |

All latencies are for the interactive path. Background jobs are latency-insensitive.
Streaming responses begin as soon as the first tokens arrive from the Dispatcher.

---

## 4. Migration phases

Each phase ships independently. No big-bang cutover. Existing behavior is preserved
until the migration for that intent is complete and tested.

### Phase 1 — Skill Registry foundation (2 weeks)
- Implement `src/skills/` loader and SkillRegistry
- Implement embedding-based orchestrator (replace regex for NL routing)
- Implement Haiku tiebreaker
- Migrate ONE skill as proof of concept: `priority_planning`
- Existing intents still handled by old code for everything else

### Phase 2 — Full skill migration (3 weeks)
- Migrate remaining intents to skill folders one at a time (see §7 of 02_skill_registry.md)
- Each migration: create folder, test, delete old intent branch
- Generalize Assembler to declarative context requirements
- Remove old hardcoded intent branches from `llm.ts` as each skill is proven

### Phase 3 — Data Schema Registry + privacy enforcement (2 weeks)
- Implement `src/config/data_schemas.json`
- Update Assembler to apply policy filter at retrieval time
- Update Executor to check write permissions
- Implement audit log
- Add Settings UI for user policy overrides

### Phase 4 — Attachments & RAG (3 weeks)
- Implement attachment type detector + parsers (PDF, XLSX, CSV, URL-article)
- Implement chunker, embedder, attachment store
- Implement lifetime classifier + session expiry
- Update Assembler to query attachment store
- Update skill manifests with `supportsAttachments`
- Add live attachment sync for Google Sheets (Notion in Phase 5)

### Phase 5 — Proactive Intelligence (3 weeks)
- Replace hardcoded `proactiveEngine.ts` with pluggable sensor folder
- Implement 5 initial sensors (RecencyWatcher, ObjectiveProgress, LoadDensity,
  DeadlineApproach, CommitmentTracker)
- Implement Signal Synthesizer (scheduled Haiku)
- Implement Nudge Filter
- Implement Nudge Memory + response tracking
- Morning brief integration

### Phase 6 — Feedback & Self-Improvement (3 weeks)
- Implement `feedback` skill (Channel A — instant feedback)
- Implement Channel B behavioral scoring
- Implement nightly Evaluator
- Implement Weekly Diary Agent (7-day lag, weekly schedule)
- Implement locked prompt zones in skill loader + Evaluator/Pattern Learner elision
- Implement Pending Improvements UI (with locked-zone rejection at queue insertion)
- Implement self-test on patch approval (with locked-zone post-apply scan)

### Phase 7 — Pattern Learner + remaining sensors (2 weeks)
- Implement Pattern Learner (weekly Haiku)
- Add remaining sensors (FrequencyDrift, RepetitionDetector, ConflictPredictor,
  TopicDrift, EnergyPattern)
- Add Notion live sync
- Implement image attachment parsing (Phase 6 deferred item)

### Phase 8 — Companion (2 weeks)
- Implement `companion` skill with locked safety_boundary + non_clinical_disclaimer zones
- Implement `mood_signal` and `friction_signal` sensors
- Implement `safetyCheck.ts` escalation handler + `crisis_resources.json`
- Wire Synthesizer to surface companion-typed nudges with separate per-day cap
- Add `/checkin` and `/resume` structural triggers

---

## 5. What's reused vs. new

### Reused with minimal changes
- `src/modules/router.ts` — refactored (embedding-based, no NL regex)
- `src/modules/assembler.ts` — generalized (declarative requirements)
- `src/llm.ts` — refactored (skill-aware dispatch)
- `src/modules/executor.ts` — extended (permission checks, audit log)
- `src/integrations/registry.ts` — kept (Google Calendar, Sheets, etc.)
- `src/modules/embeddings/` — expanded role (skill matching, conflict scan)
- `scripts/headless-runner.js` — extended (new job registrations)
- `scripts/db-backup.js` — kept

### Net new
- `src/skills/` (all skill folders)
- `src/sensors/` (all sensor files)
- `src/config/data_schemas.json`
- `src/modules/proactiveSynthesizer.ts`
- `src/modules/nudgeFilter.ts`
- `src/modules/patternLearner.ts`
- `src/modules/evaluatorAgent.ts`
- `src/modules/selfScorer.ts`
- `src/modules/diaryAgent.ts`
- `src/modules/attachments/` (full pipeline)
- `app/pending-improvements.tsx`
- `src/skills/companion/` (manifest + locked-zone prompt + sensors + safety handler)
- `src/sensors/moodSignal.ts`, `src/sensors/frictionSignal.ts`
- `src/modules/safetyCheck.ts`, `src/config/crisis_resources.json`
- New DB tables: `attachment_chunks`, `nudges`, `sensor_signals`, `pending_improvements`, `narratives` (with `period_type` + `period_start` + `period_end` columns for weekly diary)

---

## 6. Architecture Decision Record

### ADR-001: Single reasoning LLM call per user phrase

**Decision:** One reasoning LLM call per interactive user phrase.  
**Rationale:** Cost predictability (2.5× inflation with multi-hop), latency (3×
slower with chained calls), debuggability (single failure point), and enforcement of
the TypeScript/LLM boundary. Background jobs are exempt.  
**Alternatives rejected:** Multi-agent orchestration (Orchestrator → Synthesizer →
Specialist). Reviewed and rejected in `docs/design_review_v3_architecture.md`.

### ADR-002: Skills are folders, not code

**Decision:** Each skill is a directory containing manifest, prompt, context
declaration, and handlers. No code changes needed to add a skill.  
**Rationale:** Extensibility without coupling. Prompt changes are file edits, not
deployments. The self-improvement system can propose prompt patches as file diffs.

### ADR-003: Embedding-based routing, no NL regex

**Decision:** Natural-language phrases are routed via embedding similarity + optional
Haiku tiebreaker. Regex is retained only for structural triggers (slash commands,
button events).  
**Rationale:** Regex on natural language produces wrong routing for semantically
ambiguous phrases. Embedding similarity handles intent correctly. The Haiku
tiebreaker (~$0.00005) resolves genuinely ambiguous cases.

### ADR-004: Attachment lifetimes default to ephemeral

**Decision:** Attachments are RAM-only by default. Persistence requires explicit user
opt-in.  
**Rationale:** Avoids silent vector DB growth. Users understand what they've saved.
Privacy: sensitive documents do not persist unless the user actively chooses to store
them.

### ADR-005: Self-improvement requires human approval

**Decision:** The system may propose prompt patches, sensor tuning, and new skill
stubs, but may never modify its own prompts or configuration at runtime without
developer approval via Pending Improvements.  
**Rationale:** Preserves the developer's ability to understand, audit, and reverse
any change to the system's behavior. Auto-deployment of LLM-proposed changes creates
unpredictable drift.

### ADR-006: Proactive intelligence is a separate loop

**Decision:** The proactive system (sensors, synthesizer, nudge filter) runs on its
own schedule, entirely outside the interactive request-response path.  
**Rationale:** User-phrase latency must not be affected by background reasoning.
Separating the loops allows the proactive system to be more thorough (more Haiku
calls, longer context) without impacting interactive response time.

### ADR-007: Data Schema Registry enforces at retrieval, not at output

**Decision:** The Assembler excludes restricted data before it reaches the LLM.
Restricted data is not assembled, not passed, not present.  
**Rationale:** Post-hoc filtering (strip from output) is unreliable — the model may
have reasoned on the restricted data even if it does not quote it. Exclusion at
retrieval time is the only reliable privacy guarantee.

### ADR-008: Diary is weekly with a 7-day lag, not nightly

**Decision:** The Diary Agent runs weekly (Sunday 23:30) and summarizes the week
that ended 7 days ago, not the week just past. Raw activity for the trailing 14
days remains uncompressed and fully searchable.  
**Rationale:** Users backfill notes for past days — sometimes 2, 3, or 6 days late.
A nightly diary on day N has not yet seen the notes that will be written on days
N+1..N+6 *about* day N. Compressing prematurely loses those late notes. A 7-day
lag gives a full week to backfill before the week is sealed.  
**Alternatives rejected:**
- *Nightly diary (v3 design):* loses backfilled notes, generates 7× more LLM calls.
- *Two-week lag:* discussed; 7 days judged sufficient for typical backfill behavior.
  The lag is configurable if real usage shows 7 days is too short.

### ADR-009: Companion is a skill + sensors, not an agent

**Decision:** The Companion is implemented as a single `companion` skill plus two
sensors (`mood_signal`, `friction_signal`) that feed the existing Synthesizer. No
dedicated Companion agent loop.  
**Rationale:** v3 specified Companion as a full agent with its own loop. This
duplicated the orchestrator/synthesizer machinery without quality gain — proactive
check-ins are just another sensor type, and interactive check-ins are just another
skill route. Two safety extensions (locked prompt zones, `minModelTier` floor) give
the companion the safety properties of a v3 agent within v4's plumbing.  
**Alternatives rejected:**
- *Standalone Companion agent (v3):* second loop, second cost center, no quality gain.
- *Module-only (v2 regex):* cannot mirror language or hold a heavy moment; quality floor too low.

### ADR-010: Locked prompt zones for safety-bearing skills

**Decision:** Skill prompts may declare `<!-- LOCKED:<name> -->` blocks that are
invisible to the Evaluator and Pattern Learner and cannot be modified via Pending
Improvements. Skills must declare the zone names in their manifest.  
**Rationale:** The self-improvement loop can propose prompt patches, and an
approved patch could (accidentally or under social engineering) strip out safety
guardrails from skills like `companion`. Locked zones make this structurally
impossible: the auto-patcher never sees the protected text, and patches that
overlap a locked range are rejected at queue insertion.  
**Alternatives rejected:**
- *Trust the human reviewer:* a tired developer might approve a "small cleanup" diff
  that quietly drops the safety block.
- *Re-inject safety text after every patch:* fragile, depends on the prompt staying
  parseable. Locking at the source is simpler.
