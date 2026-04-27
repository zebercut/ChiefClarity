# Chief Clarity v4 — Architecture Overview

**Status:** Proposed  
**Replaces:** `docs/architecture_v3_multi_agent.md` (rejected — see ADR in `07_operations.md`)  
**Source of truth:** This folder (`docs/v4/`) until implementation is complete, then merged into `docs/new_architecture_typescript.md`

---

## Thesis

One reasoning LLM call per user phrase. Specialists are prompts, not pipelines.
Everything else — routing, retrieval, context assembly, scoring, ingestion, sync — is
TypeScript or scheduled background work. The system extends by dropping folders,
improves by proposing patches the user approves, and stays cheap by keeping all
heavy lifting deterministic.

---

## Six Non-Negotiables

1. **Single reasoning call per user phrase.**  
   A tiny Haiku classifier for ambiguous routing is allowed (it is not reasoning — it
   is classification, ~80 tokens). Every other LLM call is either background (async,
   scheduled) or explicitly triggered by the user.

2. **TypeScript owns the boundary.**  
   Routing, context selection, retrieval, execution, file I/O, scoring, ingestion, and
   live sync are all TypeScript. The LLM only reasons, judges, and generates language.
   Neither side trespasses.

3. **Skills are plug-ins.**  
   A skill is a folder — manifest + prompt + context builder + handlers. Adding a new
   skill means dropping a folder and restarting. Zero changes to the router, assembler,
   or dispatcher.

4. **Background work is unconstrained.**  
   Diary, evaluator, self-scoring synthesis, live sync, proactive intelligence — all
   scheduled, latency-insensitive. They may use multiple LLM calls because they are
   never blocking the user.

5. **The user approves all permanent changes.**  
   Prompt patches, new skill stubs, policy edits, sensor tuning — all queued in
   Pending Improvements for one-tap review. Nothing modifies the system's own prompts
   at runtime without human approval.

6. **Skills only see what their manifest declares.**  
   The Data Schema Registry binds each skill to a finite list of data categories it
   may read and write. The Assembler enforces this at retrieval time — restricted
   data is never fetched, never assembled, never passed to the LLM. Sensitive
   categories (medical, financial) require explicit user grant. Safety-bearing
   skills protect critical prompt sections via locked zones the auto-patcher
   cannot touch. See `03_memory_privacy.md` and `02_skill_registry.md §9`.

---

## Component Catalog

### Interactive Path (per user phrase)

| Component | Type | Status | File |
|---|---|---|---|
| **Orchestrator** | TypeScript + optional Haiku tiebreaker | Refactor | `src/modules/router.ts` |
| **Skill Registry** | Folder-based config, auto-loaded on boot | New | `src/skills/` |
| **Assembler** | TypeScript, declarative, token-budgeted | Generalize | `src/modules/assembler.ts` |
| **LLM Dispatcher** | One call, skill-aware | Refactor | `src/llm.ts` |
| **Executor** | TypeScript, runs tool calls, audit log | Extend | `src/modules/executor.ts` |

### Registry & Config

| Component | Type | Status | File |
|---|---|---|---|
| **Data Schema Registry** | JSON config, privacy policy per data category | New | `src/config/data_schemas.json` |
| **Capability Registry** | Integration manifests (Google, Slack, etc.) | Keep | `src/integrations/registry.ts` |

### Memory

| Component | Type | Status | File |
|---|---|---|---|
| **Vector DB** | SQLite + local bge-m3 embeddings | Expand role | `src/modules/embeddings/` |
| **Attachment Store** | Vector DB extension for ingested files/links | New | `src/modules/attachments/` |
| **Nudge Memory** | Vector DB table for surfaced nudges + outcomes | New | `src/db/queries/nudges.ts` |

### Companion (well-being layer)

| Component | Type | Status | File |
|---|---|---|---|
| **Companion Skill** | Interactive skill with locked safety zones, Haiku/Sonnet tier split | New | `src/skills/companion/` |
| **Mood Signal Sensor** | Embedding-based mood detection, feeds Synthesizer | New | `src/sensors/moodSignal.ts` |
| **Friction Signal Sensor** | Behavioral stuck/avoidance detection | New | `src/sensors/frictionSignal.ts` |
| **Safety Check** | Crisis keyword + classifier escalation handler | New | `src/modules/safetyCheck.ts` |

See `08_companion.md` for the full spec.

### Topics (theme aggregation layer)

| Component | Type | Status | File |
|---|---|---|---|
| **Topics Skill** | Interactive skill, declares Topics UI surface, topic-scoped digest | New | `src/skills/topics/` |
| **TopicEmergence Sensor** | Embedding clustering of recent unTagged items, proposes new topics | New | `src/sensors/topicEmergence.ts` |
| **Executor auto-tag hook** | Cross-skill — confirm-and-learn auto-tagging on every item write | Extension | `src/modules/executor.ts` |
| **`topics` data category** | Flat category in Data Schema Registry | New | `src/config/data_schemas.json` |

Topics gets the same shape as Companion: skill + sensor + executor hook + UI
surface. The v3 `topicManager.ts` shrinks to a data-access library; routing
and decisions move into the skill. See `10_topics.md` for the full spec.

### Background & Async

| Component | Type | Status | File |
|---|---|---|---|
| **Diary Agent** | Weekly Haiku narrative (7-day lag), archives raw data | New | `src/modules/diaryAgent.ts` |
| **Signal Sensors** | TypeScript watchers, pluggable folder | New (replaces hardcoded engine) | `src/sensors/` |
| **Signal Synthesizer** | Scheduled Haiku, ~3x/day | New | `src/modules/proactiveSynthesizer.ts` |
| **Nudge Filter** | TypeScript, quiet hours + caps + mute rules | New | `src/modules/nudgeFilter.ts` |
| **Pattern Learner** | Weekly Haiku, proposes sensor/prompt tuning | New | `src/modules/patternLearner.ts` |
| **Feedback Evaluator** | Instant (sync Haiku) + nightly batch | New | `src/modules/evaluatorAgent.ts` |
| **Self-Scorer** | TypeScript signals + nightly coherence audit | New | `src/modules/selfScorer.ts` |
| **Live Sync** | Scheduled re-fetch + re-embed for live attachments | New | `src/modules/attachments/liveSync.ts` |

### UI

| Component | Type | Status | File |
|---|---|---|---|
| **Pending Improvements** | Diff review + approve/reject | New | `app/pending-improvements.tsx` |

---

## System Diagram

```
═══════════════════════════════════════════════════
  INTERACTIVE PATH  (one reasoning call per phrase)
═══════════════════════════════════════════════════

  User phrase + optional attachments
          │
          ▼
  ┌─────────────────┐
  │  Orchestrator   │  TypeScript: embed phrase → score skills
  │                 │  → confidence gate → Haiku tiebreaker if needed
  └────────┬────────┘
           │ skillId
           ▼
  ┌─────────────────┐
  │    Assembler    │  TypeScript: load skill context requirements
  │                 │  → vector search memory + attachments
  └────────┬────────┘
           │ candidate data
           ▼
  ┌─────────────────┐
  │  Policy Filter  │  Data Schema Registry — drops every category
  │  (privacy gate) │  the skill manifest does NOT declare. Sensitive
  │                 │  categories require explicit user grant. Restricted
  │                 │  data is not fetched, not truncated, not present.
  └────────┬────────┘
           │ authorized data only
           ▼
  ┌─────────────────┐
  │  Token Budget   │  TypeScript: enforces per-skill budget,
  │                 │  truncates low-priority slices first.
  └────────┬────────┘
           │ context blob
           ▼
  ┌─────────────────┐
  │ LLM Dispatcher  │  ONE reasoning call
  │                 │  skill.prompt + skill.tools + context + phrase
  └────────┬────────┘
           │ structured tool call (JSON)
           ▼
  ┌─────────────────┐
  │    Executor     │  TypeScript: runs tool call, atomic writes,
  │                 │  audit log, response to user
  └────────┬────────┘
           │
           ▼
       Response + async self-score signal logged

═══════════════════════════════════════════════
  BACKGROUND  (scheduled, unconstrained)
═══════════════════════════════════════════════

  Signal Sensors (continuous, TypeScript, $0)
          │ raw signals
          ▼
  Signal Synthesizer (~3x/day, one Haiku call)
          │ ranked nudge proposals
          ▼
  Nudge Filter (TypeScript)
          │
          ▼
  User surface → Nudge Memory tracks response

  Self-Scorer (continuous TypeScript + nightly coherence audit)
          │ flagged interactions
          ▼
  Feedback Evaluator (nightly Haiku batch)
          │ proposed patches
          ▼
  Pending Improvements → user approves → patch committed

  Diary Agent (weekly Haiku, runs Sunday 23:30, covers
                week ending 7 days ago — gives user time to backfill notes)
          │ weekly narrative
          ▼
  narratives table + raw data >14d archived
```

---

## Document Index

| File | Contents |
|---|---|
| `00_overview.md` | This file — thesis, rules, catalog, diagram |
| `01_request_flow.md` | Orchestrator, Assembler, Dispatcher, Executor detail |
| `02_skill_registry.md` | Skill manifest, folder spec, plug-in workflow |
| `03_memory_privacy.md` | Vector DB roles, Data Schema Registry, access control |
| `04_attachments_rag.md` | Attachment lifetimes, ingestion, RAG retrieval, live sync |
| `05_proactive_intelligence.md` | Sensors, synthesizer, nudge filter, memory, pattern learner |
| `06_feedback_improvement.md` | Feedback tiers, self-scoring, diary agent, pending improvements |
| `07_operations.md` | Scheduling, cost model, latency, migration phases, ADR |
| `08_companion.md` | Companion skill, mood/friction sensors, locked safety zones, proactive check-ins |
| `09_dev_plan.md` | Inventory vs. v4, FEAT mapping, dependency graph, phased build plan, risk register |
| `10_topics.md` | Topics skill, TopicEmergence sensor, executor auto-tag hook, Topics surface |
| `11_v2_design_review.md` | Portfolio-level design review across all v2 FEATs — verdicts on existing FEATs, phase-grouped architecture notes for new FEATs, cross-cutting risks, testing strategy |
