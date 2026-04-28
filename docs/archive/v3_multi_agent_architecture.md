# Chief Clarity — v3 Multi-Agent Architecture

> **Relation to [new_architecture_typescript.md](new_architecture_typescript.md):**
> That document describes the *current* implementation — a single-LLM, module-based architecture with one router, one assembler, and one executor.
> **This document describes the target architecture** — a multi-agent, multi-LLM, extensible system aligned with [vision.md](vision.md).
> Both documents are live. When a v3 component ships, its section in the current-state doc must be updated to reflect the new reality.

---

## 1. Purpose

This architecture operationalizes the 13 Core Principles in [vision.md](vision.md). Every structural choice here exists to satisfy one or more of them. Where an existing module already satisfies a principle, we keep it. Where it does not, this document specifies the replacement.

**Tech stack (unchanged):** TypeScript, React Native / Expo, Capacitor, Electron, SQLite, Anthropic SDK. Multi-provider support is added *alongside* Claude, not in place of it.

---

## 2. What Changes from v2 → v3

| Concern | v2 (today) | v3 (target) |
|---|---|---|
| LLM call shape | One call per phrase, hardcoded to Claude | Multi-agent; each agent picks its own model via gateway |
| Provider | Anthropic only | Multi-provider: Anthropic + local (Ollama) + future cloud |
| Extension model | New intent → edit router / assembler / prompts | New skill → drop a manifest; new capability → drop a tool |
| Prompts | String constants in `src/constants/prompts.ts` | Per-agent files, user-visible, editable in the app |
| User learning | Ad-hoc updates to `userObservations.json` via the main LLM turn | Dedicated Profile Learner agent, continuous, background |
| Companion | Regex-based module + companion section in focus brief | Full Companion Agent with its own prompt, memory, surface |
| Memory | JSON files + flat indexes | SQLite + fuzzy / semantic search layer |
| Feedback | Implicit via `feedback_memory.json` | Explicit feedback loop with Evaluator agent and re-injection |
| Storage | JSON files, optionally encrypted (FEAT021) | Encrypted SQLite + encrypted blobs, same key model |
| UI | Fixed tabs | Surface Shell with pluggable surfaces |

---

## 3. Core Concepts

Four concepts are orthogonal. Do not conflate them.

### Agent
A reasoning unit with a defined job. Owns a system prompt, a model tier preference, a context contract (what it needs), an output schema, and a feedback contract.

### Skill
A knowledge / judgment pack. Contains prompts, rubrics, reference knowledge, evaluation criteria. **Skills are mental.** Example: `financial-advisor`, `parenting-coach`, `strategic-advisor`.
A skill is used *by* an agent. The same agent can load different skills depending on intent.

### Capability
An action the assistant can perform against the world. Defined by a tool schema, auth configuration, rate limits, and side-effect classification. **Capabilities are physical.** Example: `read-email`, `read-calendar`, `send-slack-message`, `query-sqlite`.
A capability is called *by* an agent (via structured output).

### Surface
A UI view. Declarative. Contributed by core or by a skill/capability. Example: `chat`, `daily-focus`, `tasks`, `notes`, `calendar`, `finances` (from financial skill), `inbox-triage` (from email capability).

> Rule of thumb: **Skill = prompts + rubrics. Capability = tools + auth. Agent = prompts + tools + workflow. Surface = UI.**

---

## 4. High-Level Flow

```
                                   ┌─────────────────────────┐
  User input ─────────────────────▶│   Router                │
                                   │   (intent + agent pick) │
                                   └───────────┬─────────────┘
                                               │
                 ┌─────────────────────────────┴──────────────────────────┐
                 ▼                                                        ▼
         ┌───────────────┐                                       ┌─────────────────┐
         │  Agent        │                                       │  Agent          │
         │  (Chief)      │                                       │  (Companion)    │
         └──────┬────────┘                                       └────────┬────────┘
                │                                                         │
                ▼                                                         ▼
       Assembler ──▶ LLM Gateway ──▶ Provider ──▶ structured output ──▶ Executor
                         │               (Claude / Ollama / …)              │
                         │                                                  │
                         └─▶ Observability (routing log, cost, latency)     ▼
                                                                      Memory (SQLite + fuzzy index)
                                                                            │
                                                                            ▼
                                          ┌─────────────────────────────────┐
                                          │  Evaluator (async)              │
                                          │  scores output, writes feedback │
                                          └─────────────────────────────────┘
                                                        │
                                                        ▼
                                          Feedback Store ──▶ re-injection
                                                                  (prompt updates,
                                                                   few-shot examples,
                                                                   routing tweaks)

     Background, continuous:
     ┌──────────────────────┐      ┌──────────────────────┐
     │  Profile Learner     │      │  Scheduler / Headless│
     │  (observes → model)  │      │  (cron, nudges)      │
     └──────────────────────┘      └──────────────────────┘
```

All data read/write passes through the **Encryption Boundary** (§13). All reasoning passes through the **LLM Gateway** (§9). All writes pass through the **Executor** (§11).

---

## 5. Directory Layout (v3)

```
src/
├── agents/                       # One folder per agent — prompts, config, tests co-located
│   ├── chief/
│   │   ├── agent.ts              # Agent class: id, model tier, tool list, workflow
│   │   ├── prompt.md             # System prompt (user-visible, editable)
│   │   ├── manifest.json         # id, description, required capabilities, surfaces
│   │   └── evals/                # Evaluation rubric + golden examples
│   ├── companion/
│   ├── profile-learner/
│   ├── inbox/
│   └── evaluator/
├── skills/                       # Pluggable skills (domain expertise)
│   ├── _registry.ts              # Skill discovery
│   ├── financial-advisor/
│   │   ├── manifest.json
│   │   ├── prompt.md
│   │   ├── rubric.md
│   │   └── knowledge/            # Reference content
│   └── strategic-advisor/
├── capabilities/                 # Pluggable capabilities (tools)
│   ├── _registry.ts              # Capability discovery
│   ├── read-email/
│   │   ├── manifest.json
│   │   ├── tool.ts               # Tool schema + implementation
│   │   └── auth.ts
│   ├── read-calendar/
│   └── query-memory/
├── core/
│   ├── router.ts                 # Intent classification + agent selection
│   ├── assembler.ts              # Per-agent context builder
│   ├── executor.ts               # Structured-plan executor
│   ├── gateway/                  # LLM Gateway — provider-agnostic
│   │   ├── index.ts
│   │   ├── providers/
│   │   │   ├── anthropic.ts
│   │   │   ├── ollama.ts
│   │   │   └── base.ts
│   │   └── routing.ts            # Model tier → provider/model resolution
│   ├── memory/                   # SQLite + fuzzy search layer
│   │   ├── db.ts                 # SQLite schema + migrations
│   │   ├── search.ts             # Fuzzy / semantic search
│   │   └── embeddings.ts         # Local embedding generation
│   ├── feedback/                 # Feedback loop plumbing
│   │   ├── signals.ts            # Signal capture
│   │   ├── store.ts              # Feedback storage
│   │   └── reinjection.ts        # How feedback flows back to agents
│   ├── keystore/                 # User key + encryption boundary
│   │   ├── key.ts
│   │   └── boundary.ts           # The one place encrypt/decrypt happens
│   └── scheduler/                # In-app intervals + headless runner glue
├── surfaces/                     # UI surfaces (pluggable)
│   ├── _shell.tsx                # Surface Shell — renders registered surfaces
│   ├── chat/
│   ├── daily-focus/
│   ├── tasks/
│   ├── notes/
│   └── calendar/
├── transparency/                 # Prompt viewer/editor, routing log viewer
└── types/
    └── index.ts
```

---

## 6. Agent Runtime

Every agent implements this contract:

```typescript
export interface AgentManifest {
  id:                string;              // "chief" | "companion" | "profile-learner" | ...
  description:       string;              // One-liner for users and for the router
  modelTier:         ModelTier;           // "heavy" | "standard" | "light" | "local"
  requiredCapabilities: string[];         // Capability IDs this agent needs
  optionalSkills:    string[];            // Skills this agent can load
  contextContract:   ContextContractSpec; // What memory slices it reads
  outputSchema:      ToolSchema;          // Structured output it produces
  surfaces?:         string[];            // Surfaces this agent contributes (if any)
  feedbackContract:  FeedbackContractSpec;// Signals consumed + how better is measured
  promptFile:        string;              // Path to prompt.md — user-visible
}

export interface Agent {
  manifest: AgentManifest;

  /** Build the context payload for this turn. Pure — reads state, returns JSON. */
  assemble(input: AgentInput, state: AppState): Promise<ContextPayload>;

  /** Main LLM turn. Returns structured plan — no side effects. */
  reason(ctx: ContextPayload): Promise<ActionPlan>;

  /** Optional: post-processing hook after executor applies the plan. */
  afterExecute?(plan: ActionPlan, result: ExecutionResult): Promise<void>;
}
```

**Rules:**
- `reason()` must not write to disk, mutate state, or call external APIs directly. Side effects flow through the structured plan.
- `assemble()` is pure and idempotent.
- The **prompt lives in a markdown file**, not a string constant — it can be displayed verbatim in the app and edited by power users.
- Every agent has an `evals/` folder with rubric + golden examples. No agent ships without one (satisfies vision Principle #9).

---

## 7. Agent Registry

Agents are discovered at startup by scanning `src/agents/*/manifest.json`. The registry exposes:

```typescript
export interface AgentRegistry {
  list(): AgentManifest[];
  get(id: string): Agent;
  findByIntent(intent: IntentType): Agent;   // Router uses this
  getPrompt(id: string): string;             // Transparency layer uses this
  setPrompt(id: string, prompt: string): void; // Power-user override (persisted)
}
```

Adding a new agent = dropping a folder in `src/agents/` with a manifest and a prompt. No core edits.

---

## 8. Skill Registry and Capability Registry

Two separate registries, same discovery pattern (manifest-driven).

**Skill Registry** — what the assistant *knows*.
```typescript
export interface SkillManifest {
  id:                string;   // "financial-advisor"
  description:       string;
  promptFragment:    string;   // Prepended to agent prompt when skill is active
  rubricFile:        string;
  referenceKnowledge?: string; // Path to knowledge folder
  surfaces?:         string[]; // e.g., ["finances"]
}
```

**Capability Registry** — what the assistant *can do*.
```typescript
export interface CapabilityManifest {
  id:                string;   // "read-email"
  description:       string;
  toolSchema:        object;   // JSON Schema — passed to LLM via tool use
  requiresAuth:      boolean;
  sideEffects:       "none" | "read-external" | "write-external" | "write-local";
  rateLimit?:        { perMinute?: number; perDay?: number };
}
```

A skill declares which capabilities it needs. The runtime composes: `agent.tools = union(agent.requiredCapabilities, activeSkill.requiredCapabilities)`.

---

## 9. LLM Gateway (Multi-LLM)

The Gateway is the one place that knows about providers.

```typescript
export type ModelTier = "heavy" | "standard" | "light" | "local-light";

export interface GatewayCallSpec {
  agentId:     string;
  modelTier:   ModelTier;
  messages:    Message[];
  tools?:      ToolSchema[];
  maxTokens:   number;
}

export interface LLMProvider {
  id: "anthropic" | "ollama" | string;
  call(spec: GatewayCallSpec): Promise<LLMResponse>;
  supportsTier(tier: ModelTier): boolean;
  supportsToolUse: boolean;
}
```

**Tier → provider/model resolution** (config-driven, not hardcoded):

| Tier | Default provider | Default model | Used by |
|---|---|---|---|
| `heavy` | Anthropic | `claude-sonnet-4-6` | Chief (full planning, weekly plan), Companion (deep check-in) |
| `standard` | Anthropic | `claude-sonnet-4-6` | Default for most agents |
| `light` | Anthropic | `claude-haiku-4-5` | Router, Inbox, simple CRUD, Evaluator |
| `local-light` | Ollama | `qwen2.5:7b-instruct` | Router fallback, Evaluator (bulk) — cost-sensitive |

**Gateway responsibilities:**
- Model selection (tier → concrete model) via config file `gateway.config.json`
- Retry logic, circuit breaker (inherited from v2 `llm.ts`)
- Structured-output validation (tool-use preferred; falls back to constrained JSON for providers without tool use)
- **Routing log**: every call writes `{agentId, tier, provider, model, tokensIn, tokensOut, latency, outcome}` to observability (surfaced in Transparency layer)

**Fallback chain:** `primary provider → secondary provider → cached response`. Specified per tier in config. Enables "degrade to local" when offline or over budget.

---

## 10. Router (v3)

```typescript
export interface Router {
  route(input: UserInput, state: AppState): Promise<RouteDecision>;
}

export interface RouteDecision {
  agentId:   string;       // Which agent handles this
  skills:    string[];     // Which skills to load
  intent:    IntentType;   // For logging / context selection
  modelTier: ModelTier;    // Override if needed
  reasoning: string;       // For transparency log
}
```

**Implementation:** regex-first (fast path for known intents), `local-light` LLM classifier fallback (Qwen 7B via Ollama — cheap, private). `heavy` model only for high-ambiguity cases.

A route decision is always logged — user can inspect "why did Chief handle this and not Companion?" in the Transparency surface.

---

## 11. Assembler and Executor (v3)

**Assembler** is now per-agent, not per-intent. Each agent implements its own `assemble()` and declares a context contract. The core Assembler only composes base context (user profile summary, current time, active skills) and delegates.

**Executor** gains:
- Agent attribution on every write (which agent authored this?)
- Capability dispatch — when a structured plan contains a capability call (e.g., `read-email`), the executor routes it to the Capability Registry rather than handling it inline
- Side-effect classification gate — `write-external` capabilities require user confirmation by default

---

## 12. Memory Layer (SQLite + Fuzzy Search)

v2 stores everything in JSON files. v3 moves to SQLite with a fuzzy / semantic search layer on top — satisfies Principle #4 (Memory That Finds You).

**Schema (key tables):**

| Table | Purpose |
|---|---|
| `tasks` | Structured tasks (replaces `tasks.json`) |
| `events` | Calendar events (replaces `calendar.json`) |
| `notes` | Free-form notes (new — powers the Notes surface) |
| `observations` | User model facts with confidence + source attribution |
| `interactions` | Every user turn: input, agent, intent, route decision, output summary |
| `feedback_signals` | Explicit + implicit signals for the feedback loop |
| `embeddings` | Vector store for semantic search (sqlite-vss or local equivalent) |
| `prompts` | User overrides of agent prompts (for Transparency / editing) |
| `agent_state` | Per-agent persistent state (e.g., learner checkpoints) |

**Indexes:**
- Full-text search (FTS5) on notes, interactions, observations
- Vector index on embeddings for semantic search
- Conventional indexes on dates, status, agent_id

**Migration path:** each JSON file has a one-shot migrator. The encryption boundary is preserved — the SQLite file is encrypted at rest using the existing FEAT021 key model (SQLCipher or equivalent).

**Embeddings are generated locally** (via Ollama `bge-m3` or `nomic-embed-text`) — no cloud call per note. This is non-negotiable for privacy.

---

## 13. Encryption Boundary (Keystore)

Inherits FEAT021. Extends to:
- The SQLite database (SQLCipher or the equivalent WebCrypto-backed wrapper on mobile)
- The embeddings store (encrypted at write)
- Prompt-override store (encrypted — user's prompt customizations are personal data)
- Any capability cache (emails, calendar events cached from external systems)

**One boundary, one key.** The `core/keystore/boundary.ts` module is the only place that touches encrypt/decrypt. All other modules see plaintext only in memory, never on disk.

---

## 14. Feedback Loop and Evaluator

Operationalizes Principle #9.

**Signal capture** — the Executor and UI emit feedback signals:
- *Explicit:* thumbs-up / thumbs-down, edits to agent output, accepted/rejected suggestions, corrections
- *Implicit:* time-to-act on suggestion, ignored nudges, retry/rephrase patterns, session-level mood shifts

All signals go to `feedback_signals` table with `{agentId, interactionId, signalType, value, timestamp}`.

**Evaluator Agent** — a dedicated agent (NOT one of the reasoning agents — satisfies "agents cannot grade themselves"):
- Runs on a schedule (per-interaction for fast corrections, batch nightly for prompt tuning)
- Reads interactions + signals, scores each against the agent's rubric (in `evals/`)
- Writes structured evaluations back to `feedback_signals` with source `evaluator`
- Runs on `local-light` tier by default — cheap, high volume

**Re-injection** (how feedback changes behavior — all are explicit, none are silent):
1. **Few-shot injection** — best / worst examples surfaced in the agent's context for future turns
2. **Prompt tuning** — periodic PR-style update to an agent's `prompt.md` based on recurring signal patterns (user approves the change before it lands; visible in Transparency)
3. **Routing tweaks** — if Agent A consistently outperforms Agent B on a class of intent, the router weights shift
4. **Skill-registry changes** — if a skill's rubric is consistently failing, the skill is flagged for review

No drift. Every behavior change is a traceable change to a file the user can see.

---

## 15. Profile Learner Agent

Operationalizes Principle #11 (User Understanding is the Goal).

**Job:** continuously update the user model from observed interactions.

**Inputs:**
- `interactions` table (what did the user ask, when, how)
- `feedback_signals` (what did they accept, reject, edit)
- Capability outputs (calendar patterns, email patterns — when user grants access)
- Session timing data (when do they open the app, how long do they stay)

**Outputs (writes to `observations` table):**
- Timing observations — "user is most productive 9–11am on weekdays" (confidence 0.7, 14 data points)
- Routine observations — "user reliably reviews tasks at 7am"
- Agenda observations — "current focus areas: [A], [B], [C]"
- Mood trajectory — rolling window of emotional signals
- Preferences — "user prefers 3-bullet summaries", "user rejects suggestions framed as questions"
- Goals — inferred from recurring themes in interactions

**Every observation carries:**
```typescript
interface Observation {
  id:          string;
  category:    "timing" | "routine" | "agenda" | "mood" | "preference" | "goal";
  text:        string;
  confidence:  number;  // 0..1
  sources:     string[]; // interaction IDs
  firstSeen:   string;
  lastSeen:    string;
  supersedes?: string;  // if this observation replaces an older one
}
```

**Cadence:** runs on the headless scheduler — light passes every 30 minutes (incremental), deep pass nightly (re-consolidation, confidence re-scoring).

**Model tier:** `local-light` for most passes (cheap, high volume, privacy-preserving). Escalates to `standard` for nightly consolidation where judgment matters.

**Transparency:** the user can open the Profile surface and see every observation, its confidence, its sources, and correct it. Corrections flow back as explicit feedback signals.

---

## 16. Companion Agent

Operationalizes the "psychological support" pillar. A default, first-class agent.

**v2 had a companion *module*** (regex-based tone detection + a companion section in the focus brief). v3 makes it a **full agent** with its own prompt, its own memory, its own surface contributions, and its own feedback rubric.

**Responsibilities:**
- Emotional well-being check-ins (morning energy read, afternoon friction check, evening decompression)
- Psychological support in conversation — validates, reframes, de-catastrophizes
- Friction detection — notices stress signals (overdue pile, task overload, calendar density) and intervenes before the user hits the wall
- Celebrates wins — surfaces completed work, progress against goals, moments of momentum
- Coping strategies — offers one small, specific action when the user is stuck

**Guardrails (critical):**
- Companion is **supportive, not clinical**. It is not a therapist. Its prompt explicitly draws that line.
- Escalation path — if signals cross a defined threshold (distress language, sustained low mood), the agent surfaces a clear "this is beyond me, here are resources" message. This is a hardcoded safety behavior, not an LLM judgment.
- All companion output is run through a lightweight safety check before being shown.

**Model tier:** `heavy` for deep check-ins (empathy quality matters), `standard` for inline responses. Never `local-light` for companion responses — the quality floor is too important.

**Surface contribution:** a "Companion" panel on Daily Focus showing energy read, mood trajectory, recent wins, and the day's focus mantra.

**Memory:** reads from the same user model (observations table, mood trajectory). Writes emotional observations back via the Profile Learner contract.

---

## 17. Surface Shell

A **Surface Shell** renders registered surfaces (Principle #13).

```typescript
export interface SurfaceManifest {
  id:            string;                      // "chat" | "tasks" | "finances" | ...
  title:         string;
  icon?:         string;
  source:        "core" | "skill" | "capability";
  component:     React.ComponentType<SurfaceProps>;
  order?:        number;                      // nav ordering hint
}

export interface SurfaceRegistry {
  list(): SurfaceManifest[];
  register(m: SurfaceManifest): void;
}
```

**Core surfaces:** chat, daily-focus, tasks, notes, calendar, profile (new — shows learned user model), transparency (new — shows prompts, routing log, feedback effects).

**Extension surfaces** are declared in skill/capability manifests and registered at startup. The navigation bar is generated from the registry — never hand-edited.

---

## 18. Transparency Layer

Operationalizes Principle #12.

A dedicated surface (`surfaces/transparency/`) exposes:

**Prompt viewer/editor**
- Lists every agent with its current prompt (rendered from `prompt.md` + any user override)
- User can view verbatim, or edit (writes to `prompts` table with version history)
- Changes take effect on next turn
- "Reset to default" always available

**Routing log**
- Last N interactions: which agent, which model, which provider, latency, cost estimate
- Filter by agent, intent, outcome
- Click-through to see the full context payload sent to the LLM (sensitive data redacted based on encryption policy)

**Feedback effects**
- Timeline of prompt changes, routing weight changes, skill-registry changes
- For each change: what signal drove it, what was changed, by whom (user / evaluator / manual)

**User model browser** (linked to Profile Learner)
- Every observation with confidence, sources, last-seen
- User can correct, delete, or confirm observations

---

## 19. Default Agents Catalog

| Agent | Model Tier | Invoked when | Key responsibility |
|---|---|---|---|
| **Chief** | heavy (planning) / standard (general) | Main conversation, planning intents | Primary voice, orchestrates other agents |
| **Companion** | heavy (check-ins) / standard (inline) | Emotional signals detected, daily check-ins | Psychological support, well-being |
| **Profile Learner** | local-light (incremental) / standard (nightly) | Continuously on schedule | Maintains the user model |
| **Inbox** | light | Bulk input detected | Parses unstructured dumps into structured writes |
| **Evaluator** | local-light | After each interaction + nightly | Scores agent outputs, closes feedback loop |

Every default agent has a complete `manifest.json`, `prompt.md`, and `evals/` folder. Users can view all prompts, edit them, add new agents, or disable defaults.

---

## 20. Scheduler

Inherits v2 headless runner. Extended to schedule:
- Profile Learner incremental passes (every 30m)
- Profile Learner nightly consolidation
- Evaluator batch runs (nightly)
- Companion proactive check-ins (morning wake, afternoon friction, evening decompression)

All intervals are config-driven, visible in the Transparency surface.

---

## 21. Migration from v2

Not a big-bang rewrite. Per-component, in this order:

1. **Gateway first** — wrap existing Claude calls in the Gateway abstraction. No behavior change, just indirection. Unlocks multi-provider.
2. **Memory layer** — stand up SQLite alongside JSON. Dual-write for one release. Then read from SQLite. Then retire the JSON files. Encryption boundary ported via SQLCipher.
3. **Agents** — refactor the existing monolith (router → assembler → llm → executor) into the Chief Agent. Everything else stays.
4. **Skill + Capability registries** — extract existing capabilities (email integration, calendar sync if/when added) into the Capability Registry shape. Start with zero third-party skills.
5. **Profile Learner** — split user-observation updates out of the main turn into a dedicated background agent. Formalize the observations schema.
6. **Companion Agent** — promote the companion module to a full agent.
7. **Feedback loop + Evaluator** — add signal capture. Then the Evaluator. Then re-injection.
8. **Transparency surface** — promote prompts to `.md` files. Build the viewer. Then the editor.
9. **Surface Shell** — refactor the navigation layer to be registry-driven. Existing tabs become core surfaces.

Each step ships behind a flag, is fully reversible, and does not require the others to land first (except as noted).

---

## 22. Architecture Decisions (new)

### Why multi-agent instead of one smart prompt
One prompt that does everything becomes a ball of instructions nobody (user or model) can reason about. Separate agents have separate prompts, separate evals, and separate feedback loops. Each can improve independently. Debugging a single-prompt monolith is guessing; debugging an agent is reading one file.

### Why skills and capabilities are separate registries
A skill is knowledge; a capability is a tool. Mixing them forces every "I want to know about finance" change to touch the same code as "I want to read email". Separating them lets domain experts contribute skills without touching integrations, and lets integration engineers contribute capabilities without touching prompts.

### Why prompts live in markdown files, not string constants
Strings in code are invisible to users. Files are visible, diffable, overridable, and version-controllable. Moving prompts to `prompt.md` costs nothing at runtime and enables the Transparency surface without extra work.

### Why the Profile Learner is a separate agent, not a side effect of the main turn
Running user-model updates on the critical path of every user interaction couples learning to user latency and to the model tier of whichever agent was active. A separate agent runs on its own schedule, its own model tier (local-light is enough for most passes), and can do consolidation work the main turn cannot afford.

### Why the Evaluator cannot be one of the reasoning agents
An agent grading its own output cannot fail — it will rationalize. Separate evaluator means grading and doing are independent concerns, with independent prompts, independent models, and independent rubrics. This is a hard architectural line; violating it breaks the feedback loop.

### Why SQLite replaces JSON files
JSON files were a good v1 — zero infrastructure, easy to inspect. As the data grows (notes, interactions, observations, embeddings), JSON becomes a performance and search liability. SQLite gives us FTS, vector search, transactions, and a single encryption boundary. We keep the "local-only, no server" principle — SQLite is still a file on the user's device.

### Why local-light is a first-class tier, not a fallback
Some jobs (routing classification, incremental profile learning, evaluator scoring) are high-volume, low-stakes-per-call, and deeply personal. Routing them to the cloud is wasteful on cost and on privacy. A local model (Qwen 7B via Ollama) is good enough for these jobs. Making it a first-class tier keeps the architecture honest about where cloud is truly needed.

### Why the Companion is a full agent, not a module
A regex module cannot provide real psychological support. A full agent with its own prompt, its own memory, its own surface, and its own evals can. Companion is core to the product, not a bolt-on.

### Why observations are append-only with confidence + sources
User models that overwrite facts lose the audit trail. Append-only with `supersedes` links lets us show the user *why* we believe something and *how* that belief has evolved. Confidence scores make uncertainty explicit instead of pretending the model is binary.

### Why every agent ships with an evals folder
An agent without an evaluation rubric cannot improve — there is no ground truth to score against. Making `evals/` mandatory forces us to define "better" up front, before the agent ships. This is a governance control, not a nice-to-have.

---

## 23. Storage Model

> Resolves Design Review Blocker 3.1.

Every artifact in the system belongs to exactly one of two storage zones. The rule is based on **who produces the artifact**, not on file format.

### Bundle (ships with the app, read-only at runtime)

| Artifact | Path |
|---|---|
| Agent manifests | `src/agents/<id>/manifest.json` |
| Agent default prompts | `src/agents/<id>/prompt.md` |
| Agent evaluation rubrics + fixtures | `src/agents/<id>/evals/` |
| Skill manifests + prompts + rubrics + knowledge | `src/skills/<id>/` |
| Capability manifests + schemas + implementations | `src/capabilities/<id>/` |
| Gateway tier-to-model config | `config/gateway.json` |
| Scheduler defaults | `config/scheduler.json` |
| Surface default registration | `src/surfaces/_defaults.ts` |

**Property:** these are code artifacts. They evolve via git. They ship with releases. Never mutated at runtime.

### SQLite (user-specific, mutable, encrypted at rest)

| Table | Holds |
|---|---|
| `tasks`, `events`, `notes` | User's structured data |
| `observations` | User model (Profile Learner writes) |
| `interactions` | Every user turn (input, agent, intent, output summary) |
| `feedback_signals` | Feedback from every channel |
| `evaluations` | Evaluator scores per interaction |
| `tuning_proposals` | Proposed behavior changes (pending user approval) |
| `tuning_applied` | Log of approved changes |
| `prompt_overrides` | User edits to default prompts |
| `prompt_versions` | History of prompt changes (bundle + override snapshots) |
| `agent_state` | Per-agent checkpoints (e.g., learner consolidation pointer) |
| `capability_grants` | User-granted capability permissions + scopes |
| `embeddings` | Vector index (when mobile tier supports it; see §30) |
| `routing_log` | Every Gateway call attributed to agent/tier/provider |

**Property:** user-specific state. Generated or modified at runtime. Always encrypted (see §13).

### Effective-Value Rule

For any artifact that has both a bundled default and a user override (currently: prompts, scheduler intervals, gateway tier overrides), the **effective value** is computed at read time:

```
effective = user_override (if exists and active) ELSE bundled_default
```

- "Reset to default" = delete the override row (or set `active = false`)
- Transparency surface shows the effective value with a badge indicating override-in-effect
- Prompt versioning: each edit appends a new row to `prompt_versions`; `prompt_overrides` holds the active override
- Release upgrades: if a bundled default changes, the user's override is not touched — the Transparency surface shows a "default updated since your override" notice so the user can merge or reset

**No third zone.** There is no "local preference file." Every user-mutable value lives in SQLite.

---

## 24. Inter-Agent Communication Protocol

> Resolves Design Review Blocker 3.2.

### Decision: agents do not call each other during a user turn.

This preserves the root `CLAUDE.md` rule (*"Single LLM call: One call per user phrase. No multi-agent pipelines."*) and keeps the cost, latency, and debugging model predictable.

### The Three Communication Modes

**Mode 1 — Shared Memory (async, eventually consistent)**

The only channel for inter-agent communication. Agents publish facts to memory; other agents consume them on their next turn.

| Writer | Table | Readers |
|---|---|---|
| Profile Learner | `observations` | All agents (via Assembler base context) |
| Companion | `observations` (emotional category) | Chief, Inbox, Profile Learner |
| Evaluator | `evaluations`, `tuning_proposals` | Tuner phase of Evaluator, user (via Transparency) |
| Executor | `interactions`, `feedback_signals` | Evaluator |
| Any agent | `nudges` | UI (Chat + Surfaces) |

**Mode 2 — Scheduled Invocation (Scheduler → Agent)**

Background agents run on defined cadences, not on user turns:

| Agent | Cadence | Reads | Writes |
|---|---|---|---|
| Profile Learner (incremental) | Every 30 min | `interactions`, `feedback_signals` since last checkpoint | `observations` |
| Profile Learner (nightly) | 02:00 local | Last 24h of observations | Consolidated observations |
| Companion (proactive) | Morning wake, afternoon, evening | `observations` (emotional), `tasks`, `events` | `nudges`, `observations` |
| Evaluator (per-interaction) | Within 60s of each interaction | New `interactions` + `feedback_signals` | `evaluations` |
| Evaluator (nightly synthesis) | 03:00 local | Last 7d `evaluations` + `feedback_signals` | `tuning_proposals` |

**Mode 3 — User-Facing Turn (Router → Single Agent → Executor)**

One user turn produces exactly one agent invocation. The Router chooses which agent. That agent produces a single structured plan. The Executor applies it. Done.

If an agent needs information owned by another agent (e.g., Chief wants current mood), it reads the latest observation from memory — it does **not** invoke the other agent.

### What "Chief Orchestrates" Means

Chief orchestrates **skills and capabilities within its own turn**. It does not orchestrate other agents.

Examples:
- Chief loads `financial-advisor` skill for a finance question → one agent call, one skill prompt fragment appended → one LLM call.
- Chief invokes `read-calendar` capability via structured tool call → Executor dispatches capability → result returns → Chief's plan is applied.
- Chief wants to know the user's current mood → reads latest row from `observations` where category = `mood` → uses it in its prompt context. Companion is not called.

### When an Agent Needs Information Another Agent Owns

The **freshness rule**: observations carry `lastSeen` timestamps. The Assembler applies a freshness policy per observation category:

| Category | Max staleness | If stale |
|---|---|---|
| `mood` | 4 hours | Fall back to default neutral; flag Scheduler to run Companion |
| `timing` | 7 days | Use cached value with reduced confidence |
| `routine` | 14 days | Use cached value |
| `agenda` | 24 hours | Use cached value; flag Scheduler to run Profile Learner |

This keeps agents decoupled while providing a self-healing mechanism when data goes stale.

### Explicitly Rejected Patterns

- **Synchronous agent-to-agent LLM calls** during a user turn — rejected (cost, latency, debuggability)
- **Agent "conversations" / debate loops** — rejected (unbounded cost, no quality evidence for our use case)
- **Multi-agent planners** (LangGraph-style) — rejected (see ADR in §22)
- **Event bus with agent subscribers** — rejected (a shared memory table with timestamps gives us the same thing with less complexity)

### Event Type Reference

All inter-agent communication passes through one of these typed records in memory:

```typescript
type InterAgentEvent =
  | Observation         // Profile Learner / Companion → all
  | FeedbackSignal      // User → Evaluator
  | Evaluation          // Evaluator → Tuner / user
  | TuningProposal      // Tuner → user
  | Nudge               // Any agent → UI
  | CapabilityResult    // Capability execution → Executor → agent's next context
```

---

## 25. Feedback Pipeline Architecture

> Expands §14. Defines how feedback flows end-to-end.

The feedback pipeline has five stages. Each stage is a distinct responsibility and can fail independently.

```
  ┌─────────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────┐   ┌─────────────┐
  │ 1. Ingest   │──▶│ 2. Classify  │──▶│ 3. Evaluate│──▶│ 4. Tune  │──▶│ 5. Apply    │
  │ (channels)  │   │ (normalize)  │   │ (score)   │   │ (propose)│   │ (user approves)│
  └─────────────┘   └──────────────┘   └───────────┘   └──────────┘   └─────────────┘
        │                 │                  │              │               │
        ▼                 ▼                  ▼              ▼               ▼
     user UI        feedback_signals    evaluations   tuning_proposals  prompt_overrides,
                       table              table          table         routing config, etc.
```

### Stage 1 — Ingestion (Channels)

Feedback arrives through four channels. All channels feed into the same `feedback_signals` table with a `source` discriminator.

| Channel | How it arrives | Example |
|---|---|---|
| **Chat** | User says something evaluative in conversation | "That was wrong — I never work Sundays" / "Perfect, keep doing that" |
| **Direct UI action** | Buttons on agent output | Thumbs up/down, Edit, Reject suggestion, Dismiss nudge |
| **Note** | User writes a note tagged `#feedback` or explicitly about assistant behavior | A note titled "Chief keeps over-scheduling Mondays" |
| **Bulk / Inbox** | User dumps feedback into `inbox.txt` from any device | Multi-line dump of corrections parsed by Inbox Agent |
| **Implicit** | Behavioral signals captured by Executor + UI | Ignored nudge, time-to-act on suggestion, retry/rephrase within N seconds, user-edited agent output |

**Ingestion contract:** every channel produces a raw signal with `{source, timestamp, raw_content, interaction_id?}`. `interaction_id` links the signal to the specific turn it's about (when known).

### Stage 2 — Classification

A dedicated **Feedback Classifier** (part of the Evaluator agent, run on `light` tier) normalizes raw signals into structured form:

```typescript
interface FeedbackSignal {
  id:             string;
  source:         "chat" | "ui_action" | "note" | "bulk" | "implicit";
  agentId:        string;           // which agent is this feedback about
  interactionId?: string;           // specific turn, if linkable
  signalType:     SignalType;
  polarity:       "positive" | "negative" | "neutral" | "correction";
  target:         FeedbackTarget;   // what specifically
  confidence:     number;           // 0..1 — how sure the classifier is
  rawText?:       string;
  structuredValue?: any;            // for UI actions with known shape
  createdAt:      string;
}

type SignalType =
  | "correction"      // "that's wrong", factual fix
  | "preference"      // "I prefer X over Y"
  | "style"           // tone, format, length
  | "safety"          // inappropriate output
  | "bug"             // system misbehavior (not agent quality)
  | "celebration";    // positive reinforcement

type FeedbackTarget =
  | { kind: "output";    dimension?: RubricDimension }  // quality of a specific response
  | { kind: "behavior";  pattern: string }              // recurring behavior
  | { kind: "prompt";    suggestion: string }           // explicit prompt suggestion
  | { kind: "routing";   from: string; to: string }     // "use Chief, not Inbox"
  | { kind: "capability";capabilityId: string };        // capability mis-use
```

**Rules:**
- Implicit signals are auto-classified (edit = correction, thumb-down = style/quality, ignored nudge = preference)
- Chat / note / bulk signals go through the Classifier LLM call (one `light`-tier call per signal)
- Low-confidence classifications (`confidence < 0.6`) are flagged for user review on the Transparency surface — never silently acted upon
- Safety signals (`signalType = "safety"`) bypass classification and go straight to an alert queue

### Stage 3 — Evaluation (Grading)

For each interaction, the Evaluator produces a structured grade against the agent's rubric (see §26).

**When it runs:**
- **Per-interaction:** within 60 seconds of each completed turn — `local-light` triage
- **Nightly synthesis:** 03:00 local — re-evaluates "unsure" triage buckets and aggregates trends — tier matches the gradee (see evaluator-tier rule, §26)

**What it writes:**
```typescript
interface Evaluation {
  id:             string;
  interactionId:  string;
  agentId:        string;
  rubricVersion:  string;
  scores:         RubricScore[];   // per dimension
  overall:        number;          // 0..1, weighted
  bucket:         "good" | "bad" | "unsure";
  signalsConsidered: string[];     // feedback_signal IDs folded into this grade
  evaluatorTier:  ModelTier;
  evaluatorModel: string;
  rationale:      string;          // short — why this score
  createdAt:      string;
}
```

### Stage 4 — Tuning (Proposal Generation)

Runs nightly. The **Tuner** phase of the Evaluator aggregates a rolling window of evaluations + signals per agent and generates behavior-change proposals:

```typescript
interface TuningProposal {
  id:             string;
  agentId:        string;
  kind:           "prompt_edit" | "few_shot_add" | "few_shot_remove"
                | "routing_tweak" | "skill_adjust" | "capability_revoke";
  rationale:      string;          // narrative explanation
  diff:           ProposalDiff;    // concrete change
  evidence:       {
    signalIds:    string[];        // which signals drove this
    evaluationIds: string[];       // which evaluations
    sampleSize:   number;
    effectEstimate: number;        // projected score improvement
  };
  status:         "pending" | "approved" | "rejected" | "superseded";
  createdAt:      string;
}
```

**Generation rules:**
- Minimum evidence threshold: a `prompt_edit` proposal needs at least 5 corroborating signals from at least 3 distinct interactions
- No proposal if the effect estimate is below a configured threshold (default: 0.05 improvement on overall score) — tuning must be worth reading
- Proposals that would modify locked prompt zones (§32) are blocked at generation time

### Stage 5 — Application (User Approval)

The default is **quiet batch approval**, not ambient live tuning:

- The Transparency surface shows a weekly "Tuning Review" card — `N proposals` with short rationale each
- User can approve per-proposal, approve-all, reject, or defer
- One approval = one new `prompt_versions` row (or `routing_config` change, etc.) + one `tuning_applied` log row
- Rollback: any applied change can be reverted one-click from the Transparency timeline
- Safety proposals (e.g., tighten a guardrail after a distress miss) are surfaced immediately, not batched

**Explicit non-goals:**
- No silent prompt edits. Ever.
- No A/B testing of prompts without user knowledge.
- No "confidence-above-X means auto-apply." Approval is always user-driven for prompts. Few-shot example injection (lower blast radius) MAY auto-apply if the effect estimate is above a higher threshold — TBD based on early user tolerance.

### Feedback Pipeline — Who Does What

| Component | Stage | Tier | Cadence |
|---|---|---|---|
| UI layer | Ingest (explicit) | — | per user action |
| Executor | Ingest (implicit) | — | per turn |
| Inbox Agent | Ingest (bulk, note) | light | per inbox process |
| Feedback Classifier (Evaluator phase) | Classify | light | per signal |
| Evaluator (per-interaction) | Evaluate (triage) | local-light | per turn |
| Evaluator (nightly) | Evaluate (deep) | matches gradee | daily |
| Tuner (Evaluator phase) | Propose | standard | weekly |
| Transparency surface | Approve / reject | — | user-initiated |
| Config writer | Apply | — | on approval |

---

## 26. Grading Rubric Framework

> Resolves Design Review Blocker 3.3 (evaluator tier rule) and HIGH concern on rubric format.

### Rubric Structure

Every agent ships a `rubric.yaml` in its `evals/` folder. Format:

```yaml
version: 1
agent: chief
dimensions:
  - id: accuracy
    weight: 0.30
    description: Does the output correctly address the user's request?
    scoring:
      1.0: Fully correct and addresses the full request
      0.75: Correct on the main point, misses a minor aspect
      0.50: Partially correct or addresses only part of the request
      0.25: Mostly incorrect but contains some relevant content
      0.0: Wrong, hallucinated, or unrelated

  - id: completeness
    weight: 0.20
    description: Does the structured output include all required fields correctly?
    scoring:
      1.0: All required fields present, valid types, valid references
      0.50: Required fields present but with value errors
      0.0: Required fields missing or schema violation

  - id: tone
    weight: 0.15
    description: Does the tone match the user's preferred communication style (from observations)?
    scoring:
      1.0: Matches preferred style exactly
      0.50: Neutral — neither matches nor violates
      0.0: Contradicts known preference

  - id: format
    weight: 0.15
    description: Is the chat reply within length target? Are actions / suggestions concise?

  - id: safety
    weight: 0.20
    description: Does the output respect guardrails (no clinical overreach, no exposure of redacted data, no instruction to user to bypass safety)?
    scoring:
      1.0: Fully within guardrails
      0.0: Guardrail violation (hard-fail — caps overall at 0.0)

hard_constraints:
  - dimension: safety
    minimum: 1.0
    on_fail: overall_zero
```

**Rules:**
- Weights must sum to 1.0
- At least one dimension must be marked a **hard constraint** for safety-bearing agents (Companion, anything touching external writes)
- Hard-constraint failure caps the overall score at 0.0 and triggers an immediate safety surface — nightly Tuner proposes the matching corrective action

### Computing the Overall Score

```
overall = Σ (weight_i × score_i)        when no hard-constraint fails
overall = 0                              when any hard-constraint fails
```

Recorded in the `evaluations` table with per-dimension breakdown so trends can be tracked.

### Evaluator Tier Rule

**The evaluator's model tier must be at least as strong as the agent tier being graded.**

| Gradee tier | Evaluator tier (per-interaction triage) | Evaluator tier (nightly deep pass) |
|---|---|---|
| local-light | local-light | local-light |
| light | local-light | light |
| standard | local-light | standard |
| heavy | local-light | heavy |

**Two-stage triage:**
1. The per-interaction triage uses `local-light` regardless of gradee. It outputs one of: `clearly_good`, `clearly_bad`, `unsure`.
2. Only the `unsure` bucket and a 5% random sample of `clearly_good`/`clearly_bad` are re-evaluated at the matched tier in the nightly pass.

Outcome: cost stays bounded, but quality judgments on `heavy` outputs are ultimately made by a `heavy` evaluator, not a 7B local model.

**Statistical quality gate:** the 5% random sample verifies the triage itself. If `clearly_good`-triaged items consistently score < 0.6 on deep pass (or vice versa), the triage thresholds are tuned — logged as a `tuning_proposal` on the Evaluator itself (yes, the Evaluator has evals too).

### Chief Agent — Default Rubric (sketch)

Dimensions: accuracy 0.30, completeness 0.20, tone 0.15, format 0.15, safety 0.20.
Hard constraints: safety.

### Companion Agent — Default Rubric (sketch)

Dimensions: empathy 0.25, clinical-boundary 0.30 (hard), specificity 0.15, tone 0.15, wins-recognition 0.15.
Hard constraints: clinical-boundary (never gives clinical advice; always escalates at defined threshold).

### Profile Learner — Default Rubric (sketch)

Dimensions: observation-accuracy 0.40 (validated against user corrections), confidence-calibration 0.30, source-attribution 0.15, non-redundancy 0.15.
Hard constraints: none (read-only agent).

### Inbox Agent — Default Rubric (sketch)

Dimensions: parse-completeness 0.35 (no items lost), correctness 0.30, dedup-quality 0.20, format 0.15.
Hard constraints: none.

---

## 27. Key Recovery Model

> Resolves Design Review Blocker 3.4.

Three key paths, exactly one is active for any user at any time. The choice is made once at setup and can be upgraded later but never downgraded silently.

### Path A — Passphrase Only (maximum security, worst UX)

- User-provided passphrase is the only input to key derivation
- No recovery. Forgotten passphrase = data loss, stated prominently at setup
- Suitable for users with password managers and high privacy requirements

### Path B — Passphrase + Recovery Code (default)

- Setup generates a 24-word recovery code (BIP-39 or equivalent). User stores it outside the device
- The user's encryption key is encrypted by the passphrase AND by a key derived from the recovery code, stored as two sealed envelopes
- Forgotten passphrase: user enters recovery code, unlocks the sealed envelope, sets new passphrase
- Lost recovery code AND forgotten passphrase: data loss

### Path C — Secure-Store Auto-Unlock + Recovery Code (recommended)

- Extends Path B
- The passphrase-derived key is additionally stored in the platform secure store (iOS Keychain / Android Keystore), gated by biometric or device PIN
- Day-to-day: app auto-unlocks via biometric, no passphrase typed
- New device / device reset: user enters passphrase, if forgotten enters recovery code
- Inherits FEAT021 `passphraseInSecureStore` pattern, extended with recovery code

### What Is NOT Allowed

- Cloud-escrowed keys where the escrow key is controlled by anyone other than the user
- Silent key backup to iCloud / Google Drive without user-visible envelope encryption
- "Skip encryption" at setup (Principle #10 — no plaintext user data on disk)

### Multi-Device Sync Implications

When multi-device sync lands (currently §33 open question):
- The encrypted DB blob syncs via the user's cloud drive
- Each device derives the same key from the same passphrase (or the same recovery code)
- Devices do NOT share the secure-store entry — each enrolls independently

---

## 28. Base Context Contract

> Resolves Design Review HIGH 4.4.

Every agent invocation receives a **base context payload** composed by the core Assembler before the agent's own `assemble()` runs. The payload is deterministic, auditable, and budget-capped.

### Base Context Shape

```typescript
interface BaseContext {
  // Identity + time
  userName:       string;                       // from profile
  timezone:       string;
  nowISO:         string;                       // user-local
  weekday:        string;
  daySegment:     "earlyMorning" | "morning" | "midday" | "afternoon" | "evening" | "night";

  // User model summary (from observations, confidence-filtered)
  userSummary: {
    timings:      string[];                     // top 3 timing observations, confidence >= 0.6
    routines:     string[];                     // top 3 routines
    agenda:       string[];                     // current focus areas
    moodRecent:   string | null;                // latest mood, if fresh per §24 freshness rule
    preferences:  string[];                     // top 5 preferences
  };

  // Active skills
  activeSkills:   { id: string; promptFragment: string }[];

  // Recent activity window
  recentTurns: {
    interactionId: string;
    intent:        string;
    summary:       string;
    timestamp:     string;
  }[];                                          // last 5, summarized

  // Routing context
  routeDecision: RouteDecision;                 // why this agent got this turn
}
```

### Token Budget

- Base context target: **600 tokens** (excluding the agent's own per-intent additions)
- Hard cap: **900 tokens**
- Overflow policy: truncate in priority order — `recentTurns` first, then `preferences`, then `routines`, keeping timings and agenda + moodRecent until the cap is met
- Logged per turn as `routing_log.baseContextTokens`

### Freshness Policy (per §24)

- `moodRecent` is null if the latest mood observation is older than 4h — Assembler flags the Scheduler to run Companion
- Other observation categories fall back to cached values with a flag when stale

### Determinism

The Assembler is pure and side-effect-free. Same inputs → same base context. This makes replay (for feedback-loop debugging) reliable and makes evaluations reproducible.

---

## 29. Skill Activation Rules

> Resolves Design Review HIGH 4.2.

### Skill Manifest Extension

```typescript
export interface SkillManifest {
  id:                   string;
  description:          string;
  promptFragment:       string;
  rubricFile:           string;
  referenceKnowledge?:  string;
  surfaces?:            string[];

  // NEW — activation
  activationIntents:    IntentType[];           // e.g., ["finance_query", "general"]
  activationKeywords?:  string[];               // case-insensitive substring match
  activationObservations?: string[];            // matches against user observation categories
  defaultEnabled:       boolean;                // whether user has to opt in
  conflictsWith?:       string[];               // skill IDs that cannot co-activate
}
```

### Router-Side Selection

1. Router resolves intent (regex-first, light-tier LLM classifier fallback)
2. Router queries the Skill Registry for skills whose `activationIntents` includes the resolved intent
3. Keyword and observation matching narrow further
4. Conflicting skills are resolved by confidence: the highest-scoring skill wins; the others are suppressed for this turn
5. Maximum active skills per turn: **3** (hard cap to keep prompt size bounded)
6. The resulting `skills: string[]` appears in `RouteDecision` and is logged

### Prompt Composition

```
effective_prompt = agent.prompt
                 + "\n\n## Active skills:\n"
                 + activeSkills.map(s => s.promptFragment).join("\n\n")
```

Skill prompt fragments are capped at 200 tokens each to prevent any single skill from dominating the prompt budget.

### User Override

Users can, via the Transparency surface:
- Disable a skill globally
- Force-enable a skill for a specific intent
- Edit a skill's prompt fragment (respecting locked zones per §32)

---

## 30. Mobile Fallback Tiers

> Resolves Design Review HIGH 4.5.

Not every device can run local embeddings or a vector index. The architecture declares three hardware tiers and a declared capability set for each.

| Tier | Target hardware | Embedding inference | Vector search | Semantic search available |
|---|---|---|---|---|
| **A — Full** | Desktop (Electron), high-end mobile, Mac Silicon | Local via Ollama (`bge-m3` / `nomic-embed-text`) | sqlite-vss or equivalent | Yes |
| **B — Lexical** | Mid-range mobile, older Macs, Android mid-tier | None | None | FTS5 only — fuzzy == lexical match |
| **C — Minimal** | Low-end Android, constrained environments | None | None | FTS5 only, smaller index retention |

### Tier Detection

At first launch, the app runs a **capability probe**:
- Is Ollama installed (desktop) or is a bundled model available?
- Device RAM / CPU class from platform APIs
- Free storage for the vector index
- A 10-second benchmark (generate one embedding, measure)

Result stored in `app_config.hardwareTier`. User can override (e.g., "I want lexical even though I can run vector — saves battery").

### Graceful Degradation

- Tier B/C devices see a "Semantic search unavailable on this device" notice on the Notes / Memory search surface
- Agents still use observations and interactions by structured query (SQLite) — user-model behavior is unchanged
- Cloud-embedding-with-plaintext-user-data is **never** a fallback — violates Principle #10

### Implication for Development

- All memory-layer code paths must work in Tier B/C (pure SQLite + FTS5) without a vector store
- Vector search is a progressive enhancement, not a dependency

---

## 31. In-App vs Headless Runtime

> Resolves Design Review HIGH 4.6.

The Scheduler serves two runtimes with **identical schedule config** but different lifecycles.

### Shared Schedule Source

Single config at `config/scheduler.json` (bundle default) + `scheduler_overrides` table (user):

```json
{
  "profileLearnerIncremental": { "intervalMinutes": 30 },
  "profileLearnerNightly":     { "cron": "0 2 * * *" },
  "evaluatorPerInteraction":   { "intervalSeconds": 60 },
  "evaluatorNightly":          { "cron": "0 3 * * *" },
  "tunerWeekly":               { "cron": "0 18 * * 0" },
  "inboxCheck":                { "intervalMinutes": 2 },
  "stateRefresh":              { "intervalMinutes": 5 },
  "companionMorning":          { "cronRelative": "wake+15m" },
  "companionAfternoon":        { "cron": "0 14 * * *" },
  "companionEvening":          { "cronRelative": "sleep-60m" }
}
```

### Runtime Lifecycle

**In-app runtime (foreground):**
- Starts on app foreground
- Uses `setInterval` for interval-based jobs
- Uses a lightweight cron scheduler (`node-cron` or web equivalent) for cron jobs
- Pauses on blur, resumes on focus
- Respects `loadingRef` / `inboxProcessingRef` guards inherited from v2

**Headless runtime (background):**
- Long-running Node process (`scripts/headless-runner.js`, inherits v2 architecture)
- Runs when the app is closed or in background
- Handles the same schedule config
- Hot-reload: re-reads schedule every hour (inherits v2 behavior)

### Deduplication Between Runtimes

Both runtimes can be alive simultaneously (app open AND headless running). Jobs must not double-execute:

- Every scheduled job acquires a **run lock** via a row in `scheduler_locks` table: `(job_id, acquired_at, acquired_by)`
- Lock holder wins; other runtime skips the run
- Locks expire after 2× the job's expected duration to prevent zombie locks on crash
- Lock acquisition is via SQLite `INSERT OR IGNORE` — no extra infrastructure

### No Load-Gated Jobs

Per root `CLAUDE.md` rule: **no feature may be triggered only on app load**. This is a review-gate rule. Any "run on startup" pattern must be expressed as an interval job with a sensible cadence and a first-run flag.

---

## 32. Prompt Override Safety Zones

> Resolves Design Review HIGH 4.7.

### Two-Zone Prompt Structure

Every agent prompt file uses explicit zone markers:

```markdown
# Chief Agent

## [LOCKED] — Output Schema and Safety
You must always return a structured plan via the `submit_action_plan` tool.
Never recommend clinical, medical, legal, or financial-advisor actions that bind the user.
If the user appears to be in distress (sustained negative mood, explicit self-harm language), escalate with the standard resource message.

## [EDITABLE] — Persona
You are a calm, concise chief of staff. You prefer bullet points over prose.
[...user may edit this block...]

## [EDITABLE] — Style Preferences
Keep chat replies under 2 sentences. Details go in structured output.
[...user may edit this block...]

## [LOCKED] — Tool Use Format
[...schema instructions...]
```

### Enforcement

- The Transparency surface renders LOCKED blocks in a different color and disables the edit action on them
- The prompt-override write path in the Config layer **rejects** any diff that mutates content inside `[LOCKED]` markers — error returned to the UI
- Locked content versioning follows bundle releases; users see a "safety defaults updated in release X" notice when locked zones change
- The Tuner can never propose changes to locked zones (§25, stage 4)

### Companion Agent — Locked Zones

- Clinical-boundary rule (not a therapist)
- Distress-escalation trigger + message
- Safety-check output wrapper
- Tool-use format

Mandatory for every agent that has safety guardrails.

### Skill Prompt Fragments

Skill fragments are **entirely editable** but capped at 200 tokens (§29) and cannot inject tool-use schema changes or safety-behavior overrides. The composer strips any `[LOCKED]` markers from skill fragments before concatenation — skills cannot add locked zones to the agent's effective prompt.

---

## 33. Open Questions (updated)

Resolved since the initial draft:

- ~~Storage model ambiguity~~ → resolved in §23
- ~~Agent-to-agent protocol~~ → resolved in §24
- ~~Evaluator tier rule~~ → resolved in §26
- ~~Key recovery flow~~ → resolved in §27
- ~~Base context contract~~ → resolved in §28
- ~~Skill activation logic~~ → resolved in §29
- ~~Mobile vector fallback~~ → resolved in §30
- ~~In-app interval policy~~ → resolved in §31
- ~~Prompt safety zones~~ → resolved in §32

Still open, to resolve during implementation:

- **Prompt editing granularity within EDITABLE zones** — whole-block vs structured per-field. Default: whole-block, with a Tuner diff viewer.
- **Third-party skill distribution** — signed skill packages, trust model, scope approval. Deferred past v3 initial release.
- **Multi-device sync conflict resolution** — last-write-wins vs CRDT. TBD based on use patterns.
- **Evaluator self-improvement** — can the Evaluator propose rubric changes based on user override patterns? Worth exploring once we have 90 days of real signal data.
- **Hardware-tier benchmark thresholds** — the Tier A/B/C classifier numbers need field data to calibrate.

---

## 34. Alignment Checklist

Before merging any feature, confirm it:

- [ ] Maps to at least one Core Principle in `vision.md`
- [ ] Lives in the right layer (agent / skill / capability / surface / core)
- [ ] Goes through the LLM Gateway (no direct provider calls)
- [ ] Goes through the Encryption Boundary (no plaintext user data on disk)
- [ ] Has a defined feedback contract if it is an agent
- [ ] Has an `evals/rubric.yaml` if it is an agent (§26)
- [ ] Exposes its prompts via markdown files with explicit LOCKED / EDITABLE zones (§32)
- [ ] Has an entry in the Transparency surface if it changes routing or writes observations
- [ ] Runs via the Scheduler (in-app + headless) if it is recurring — no load-gated triggers (§31)
- [ ] Does not conflate skills with capabilities
- [ ] Does not bypass the Router / Executor / Memory layers
- [ ] Writes only to SQLite for user data (§23 — no "local preference file")
- [ ] Respects the evaluator-tier rule if it introduces evaluation (§26)
- [ ] Specifies Tier A / B / C behavior if it touches memory search (§30)
- [ ] Does not invoke other agents mid-turn (§24)

If a feature cannot check these boxes, the feature changes — or the architecture does, explicitly, here, first.

---

## 35. Re-Evaluation (post-update)

**Date:** 2026-04-24
**Reviewer role:** Architect (second pass)
**Delta since design review:** sections 23–32 added; 34 updated.

### Blocker resolution

| Blocker (from Design Review) | Status |
|---|---|
| 3.1 Storage-model ambiguity | **Resolved** — §23 Storage Model defines Bundle vs SQLite zones with the effective-value rule |
| 3.2 Agent-to-agent protocol undefined | **Resolved** — §24 commits to Option (a): agents do not call each other mid-turn; communication is via shared memory + scheduled invocation |
| 3.3 Evaluator weaker than gradee | **Resolved** — §26 defines the evaluator-tier rule and two-stage triage |
| 3.4 Key recovery unspecified | **Resolved** — §27 defines Paths A / B / C with Path C (secure-store + recovery code) as default |

### High-severity resolution

| Concern | Status |
|---|---|
| 4.1 AppState reference stale | **Partially resolved** — §28 replaces AppState with base context + repository reads; Agent interface still references AppState in §6 and needs a follow-up edit |
| 4.2 Skill selection logic absent | **Resolved** — §29 |
| 4.3 Intent taxonomy undefined | **Still open** — needs concrete v3 intent list; tracked as implementation ticket |
| 4.4 Base context empty | **Resolved** — §28 |
| 4.5 Mobile vector fallback missing | **Resolved** — §30 |
| 4.6 In-app polling policy missing | **Resolved** — §31 |
| 4.7 Transparency is attack surface | **Resolved** — §32 |

### Medium-severity resolution

| Concern | Status |
|---|---|
| 5.1 Agent discovery via scan on mobile | **Open** — needs ADR + codegen step (implementation) |
| 5.2 Observation retention | **Open** — tracked in §33 Open Questions (explicit policy to be written into §15) |
| 5.3 Prompt override schema | **Resolved** — defined implicitly in §23 `prompt_overrides` + `prompt_versions` tables; DDL in implementation ticket |
| 5.4 Capability consent flow | **Partially resolved** — §23 adds `capability_grants` table; consent UX flow to be detailed in surface implementation |
| 5.5 Circuit breaker under multi-provider | **Open** — needs explicit §9 addition |
| 5.6 Feedback approval UX | **Resolved** — §25 stage 5 defines weekly batch + immediate safety surface |
| 5.7 Dual-write migration risk | **Open** — §21 migration plan should be revised to one-way read-through |

### New open items created by this update

- **§6 Agent interface still references `AppState`** — needs edit to use repository injection (tracked above as 4.1 follow-up)
- **Intent enum for v3** — needs explicit listing; carries over from v2's 14 intents minus any subsumed by agent routing

### Verdict

- **4 of 4 blockers resolved.**
- **6 of 7 high-severity resolved.** Remaining (4.3 intent taxonomy, 4.1 AppState signature) are low-effort follow-ups.
- **3 of 7 medium-severity resolved; 4 remain** — all are implementation-phase concerns, not architectural gates.

**Recommendation:** the architecture is now ready for implementation to begin at Migration Step 1 (Gateway). The remaining HIGH and MEDIUM items should be turned into tickets in the feature backlog and resolved alongside their component implementations. Re-review after Step 3 (agents landing) to validate the design held up under code.
