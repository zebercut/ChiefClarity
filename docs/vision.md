# Chief Clarity — Vision

## One-Line Vision

**Chief Clarity is an AI-first personal assistant that thinks in agents, learns new skills on demand, remembers what matters, and acts on context — built on a multi-LLM architecture with Claude at its core.**

## Why This Exists

Personal productivity tools today are file cabinets with chat layered on top. They store data, they surface data, but they do not *understand* the person using them. Chief Clarity inverts that: the intelligence is the product. The database, the UI, and the files exist to serve the agent — not the other way around.

The assistant should feel like a chief of staff who:
- Knows your life well enough to make judgment calls
- Learns new responsibilities when you teach them
- Remembers context without being reminded
- Picks the right tool (and the right model) for the job

## Core Principles

These are non-negotiable. Every feature, module, and architectural decision must align with these principles. If a proposed feature violates one of them, the feature changes — not the principle.

### 1. AI-First, Not AI-Assisted

The LLM is not a helper bolted onto a traditional app. It is the primary interface and the primary reasoner. The UI, the database, the file system — all exist to give the agent better inputs and cleaner outputs.

**Implication:** When designing a feature, ask "what does the agent need to do this well?" before asking "what screen does the user click?"

### 2. Agent-Based Architecture

The system is composed of agents with clear responsibilities, not monolithic handlers. Each agent owns a domain (planning, inbox, retrospection, etc.), has a defined context budget, and returns structured output.

**Default agents (out of the box):**
- **Chief Agent** — routing, planning, orchestration; the primary voice the user hears
- **Companion Agent** — psychological support, emotional well-being, friction detection, motivation
- **Profile Learner** — observes every interaction and updates the user model in the background
- **Inbox Agent** — processes bulk / unstructured input into structured actions
- **Evaluator** — grades agent outputs against intent, closes the feedback loop

**Implication:** New capabilities are added as new agents or as new skills for existing agents — not as new `if/else` branches inside a giant handler.

### 3. Extensible by Skills *and* Capabilities

Chief Clarity extends along two orthogonal axes. Both are first-class, both are pluggable, and they must not be conflated.

**Skills = what the assistant knows.** Domain expertise, judgment, advisory behavior.
Examples: financial planning, strategic advisory, career coaching, health coaching, parenting guidance. A skill is defined by its prompts, its reasoning patterns, its reference knowledge, and its evaluation rubric. A skill is mostly *mental*.

**Capabilities = what the assistant can do.** Concrete actions against the world.
Examples: read emails, connect to a calendar, send a Slack message, query a database, fetch a webpage, write a file, make an API call. A capability is defined by its tool schema, its auth, its rate limits, and its side effects. A capability is mostly *physical*.

A skill *uses* capabilities. A "financial advisor" skill might use the "read email" capability (to find bills), the "read calendar" capability (to find a renewal date), and the "create task" capability (to remind you). The skill brings the judgment; capabilities bring the reach.

**Implication:**
- Two registries, not one: a **Skill Registry** and a **Capability Registry**
- Skills declare which capabilities they require; capabilities do not know about skills
- Adding a new skill is a knowledge / prompt / rubric change
- Adding a new capability is an integration / tool-schema / auth change
- Core code hardcodes neither — both are discovered at runtime

### 4. Memory That Finds You

Data is stored for retrieval, not just for the record. The assistant maintains a searchable memory — structured (SQLite) and fuzzy (embeddings / semantic search) — so it can surface the right context even when the user does not name it precisely.

**Implication:** Every piece of user data written to disk is indexed for search at the same time. "Save" and "make findable" are the same operation.

### 5. Context-Aware Response

The assistant responds to the *context* of a request, not just its literal text. "What's on my plate?" means different things at 7am, at noon, and at 10pm. The agent pulls the right context (recent activity, time of day, active projects, prior conversation) before responding.

**Implication:** The assembler — not the LLM — is responsible for deciding what context is relevant. Context selection is deterministic; judgment on that context is the LLM's job.

### 6. Multi-LLM Architecture

The system is provider-aware and model-aware. Today we use Claude (Opus, Sonnet, Haiku) with each tier picked for its job: Opus for deep reasoning, Sonnet for structured planning, Haiku for fast classification and validation. Tomorrow we may add other providers. The core must not assume a single model.

**Implication:**
- Model selection is a routing decision, not a hardcoded constant
- Prompts are portable — no Claude-specific tricks that cannot be adapted
- Today: Claude-only (Opus / Sonnet / Haiku)
- Future: additional providers behind the same interface

### 7. Structured Output, Deterministic Execution

LLMs reason. TypeScript executes. The LLM returns a plan as structured JSON (via tool use); TypeScript runs the plan. This boundary is sacred. The LLM never writes files, never mutates state, never calls external APIs directly.

**Implication:** Every LLM capability is expressed as a tool schema. Every side effect lives in TypeScript.

### 8. The App Runs Continuously

Chief Clarity is not a tool you open to complete a task. It is a presence that runs for days. Periodic checks, proactive nudges, and background reasoning happen on intervals — not on mount, not on focus.

**Implication:** No feature may be triggered only on app load. Every recurring behavior has a defined interval.

### 9. Agents Learn From Feedback

Agents are not static. Every agent must get measurably better over time through a defined feedback loop. "Better" is not a vibe — it is a signal captured, evaluated, and fed back into the agent's behavior. An agent that cannot improve is a bug in the architecture, not a finished component.

Feedback is a first-class concern, not an afterthought. The loop must answer, for every agent:

- **What signal?** — explicit (user thumbs up/down, edits, corrections, rejections) *and* implicit (did the user act on the suggestion, ignore it, override it, rephrase and retry)
- **Who captures it?** — the executor and the UI layer are responsible for emitting feedback events; agents do not capture their own feedback
- **Who evaluates it?** — a dedicated evaluator (separate from the agent being evaluated — agents cannot grade themselves) scores outcomes against the original intent
- **When does it close the loop?** — feedback is aggregated on a defined cadence (per-interaction for fast corrections, periodic batch for prompt / routing / model-selection tuning) and re-injected into the agent's context, system prompt, skill definition, or routing rules
- **How is it stored?** — feedback is written to the memory layer with enough context (intent, input, agent output, user reaction, outcome) that it can be replayed, audited, and used as few-shot examples later

**Implication:**
- Every agent ships with its feedback contract defined: what signals it consumes, what it does with them, and how "better" is measured
- No agent is "done" without an evaluation path — evaluation is part of the build, not a phase-2 add-on
- Feedback changes behavior through explicit mechanisms (prompt updates, few-shot injection, routing tweaks, skill-registry changes) — never through opaque drift
- The evaluator is a separate component with its own model selection; grading and doing are different jobs

### 10. Secure by Default

The assistant's value comes from knowing a lot about the user — which makes the data it holds uniquely sensitive. Security is not a later-phase concern; it is a product property from day one.

**User data is encrypted at rest with a user-held key.** Plaintext user data never sits on disk. The SQLite database, the memory store, the embedding index, the cached LLM inputs / outputs, and the backups are all encrypted. The key is under the user's control — not hardcoded, not silently derived, not stored next to the data it protects.

**Implication:**
- Every writer (filesystem layer, database layer, embedding store, backup job) goes through the same encryption boundary — no direct plaintext writes
- Key management is an explicit component (keystore / key derivation / recovery flow), not ad-hoc
- Cloud sync, backups, and third-party integrations must respect the same guarantee — data leaving the device stays encrypted
- Telemetry and logs are scrubbed of user content by construction, not by policy
- "Can we ship this feature without weakening the encryption boundary?" is a question every review must answer

### 11. User Understanding is the Goal

The assistant's primary job — above scheduling, answering, reminding, or advising — is to *understand the user*. Everything else gets better as this understanding gets better. This is not a side effect; it is the objective function of the system.

The assistant builds and maintains a living model of the user:
- **Timings** — when they work, sleep, focus, get tired, peak
- **Routines** — daily and weekly rhythms, recurring patterns
- **Agenda** — what they are working on, what matters to them this week / month / quarter
- **Mood** — energy trends, stress signals, motivation, emotional patterns
- **Preferences** — communication style, decision style, what resonates, what doesn't
- **Goals** — stated and inferred, short-term and long-term

This model is continuously updated from observation, not captured once during onboarding. Every interaction — every accepted suggestion, every edit, every ignored nudge, every time of day the user opens the app — is a data point.

**Implication:**
- A dedicated **Profile Learner** agent runs in the background, updating the user model from observed behavior
- All agents read from the same user model — no siloed snapshots, no duplicate learning
- New observations carry confidence scores and source attribution; the model is auditable, not opaque
- The accuracy of the user model is a first-class success metric, measured via the feedback loop (Principle #9)
- Onboarding is a *starting point*, not the source of truth — the system expects to know the user better in three months than on day one

### 12. Transparent by Default

Nothing about how the assistant works is hidden from the user. System prompts are visible. Agent definitions are visible. Routing decisions are inspectable. Feedback-loop effects are auditable. Learned observations are readable.

This is not a nicety — it is a trust requirement. A user who can see *why* the assistant did something can correct it. A user who cannot, cannot.

**Implication:**
- System prompts for every agent are readable in the app (and editable for power users)
- Routing decisions are logged and inspectable: "this request went to Chief Agent on Sonnet because intent=full_planning"
- The feedback loop's effects are visible: when a prompt was tuned, what changed, why
- The user model (observations, confidence scores, source attribution) is browsable and correctable
- No magic — every behavior traces back to configuration the user can see

### 13. Modular UI Surfaces

Chief Clarity is one assistant with many surfaces. Each surface is a view into the same agent, the same memory, and the same skill set — not a separate app. Surfaces are modular: we ship the core set, and new skills or capabilities can contribute new surfaces without a core rewrite.

**Core surfaces (initial set):**
- **Chat** — conversational interface, the primary way to reach the agent
- **Daily Focus** — the "what matters today" surface, driven by the planning agent
- **Tasks** — structured view of commitments, deadlines, and follow-ups
- **Notes** — free-form capture surface, searchable via the memory layer
- **Calendar** — time-based view of events, blocks, and schedule

**Extension surfaces (emerge as skills / capabilities are added):**
- A financial skill might contribute a "Finances" surface
- A health skill might contribute a "Health" surface
- A capability like "email" might contribute an "Inbox triage" panel

**Implication:**
- Surfaces are declarative — a skill or capability can register one as part of its manifest
- All surfaces read from the same memory and talk to the same agent — no siloed data
- The core UI is a shell; specific views are plugins
- A new skill never requires editing the navigation bar by hand

## Architectural Pillars

1. **Router** — classifies intent and selects the right skill / agent / model
2. **Skill Registry** — pluggable domain expertise (financial, strategic, coaching, etc.) discovered at runtime
3. **Capability Registry** — pluggable integrations and tools (email, calendar, web, file I/O, etc.) with defined schemas and auth
4. **Assembler** — per-intent context builder with enforced token budgets
5. **LLM Gateway** — provider-agnostic layer that picks the model and handles retries, caching, and fallbacks
6. **Executor** — runs the structured plan returned by the LLM, performs all writes, mutations, and side effects
7. **Memory** — structured store (SQLite) plus fuzzy/semantic search index
8. **Scheduler** — in-app intervals and headless background runner for continuous operation
9. **Feedback Loop** — signal capture, evaluator, aggregation store, and re-injection mechanism that makes every agent improvable over time
10. **Keystore & Encryption Boundary** — user-held key, at-rest encryption for all user data, scrubbed telemetry
11. **Surface Shell** — modular UI host that renders core surfaces (Chat, Daily Focus, Tasks, Notes, Calendar) and any surface contributed by a skill or capability
12. **Profile Learner** — background agent that observes interactions and maintains the user model (timings, routines, agenda, mood, preferences, goals)
13. **Transparency Layer** — surfaces every prompt, routing decision, and learned observation to the user, and allows editing where appropriate

## What Success Looks Like

- A user can add a new skill (a new domain the assistant handles) without a core code change
- A user can add a new capability (a new integration the assistant can use) without touching any skill
- The assistant surfaces the right context 80%+ of the time without being told where to look
- Model selection is invisible to the user — they never think about which LLM is running
- A day of heavy use stays within token budgets; no intent exceeds its allotted context
- The system keeps working when the app is closed (headless runner) and when the app is open (in-app intervals)
- User data on disk is unreadable without the user's key — verified, not assumed
- New skills and capabilities can contribute their own UI surfaces without forking the shell
- The user model becomes measurably more accurate over weeks of use — not frozen from onboarding
- Any user can read the system prompt for any agent without inspecting the code

## What Success Does NOT Look Like

- A chatbot that wraps the database
- A feature tree where every new capability requires router changes
- A system that only works with one specific LLM
- An assistant that only acts when the user asks
- Storage without retrieval — data saved and never found again
- Agents that never improve — feedback captured but never closed back into behavior
- Plaintext user data on disk, or keys stored next to the data they protect
- Conflating skills with capabilities — a single registry where "read email" and "financial advisor" live as the same kind of thing
- A fixed UI where new skills require editing the shell to get a seat at the table
- A black-box assistant where prompts, routing, and learning are hidden from the user
- A user model that is captured once at onboarding and never updates from observation

## Alignment Rule

Every new feature, every architecture decision, every review must be checked against this document. If a proposed change does not fit one of the Core Principles, one of two things is true:

1. The change is wrong and should be reshaped to fit the vision, or
2. The vision is wrong and should be updated here first — explicitly, with reasoning — before the change lands

Drift happens silently. Alignment is enforced by making the check explicit.

## Scope Today vs. Tomorrow

**Today (v3.x):**
- Claude-only multi-model routing (Opus / Sonnet / Haiku)
- Skill-based architecture with a core set of skills
- SQLite-backed memory with structured queries
- Per-intent context assembly with token budgets
- Continuous operation via in-app intervals + headless runner

**Tomorrow (roadmap):**
- Additional LLM providers behind the same gateway
- Fuzzy / semantic search layer over the memory store
- User-installable skills (third-party or user-authored)
- Cross-skill reasoning (agents consulting other agents)

## Living Document

This vision is authoritative but not frozen. When reality teaches us something the vision missed, we update the vision first, then the code. Update this file whenever a Core Principle changes or a new pillar is added.
