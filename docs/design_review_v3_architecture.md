# Design Review — v3 Multi-Agent Architecture

**Reviewer role:** Architect
**Spec under review:** [architecture_v3_multi_agent.md](architecture_v3_multi_agent.md)
**Source of truth:** [vision.md](vision.md)
**Current implementation reference:** [new_architecture_typescript.md](new_architecture_typescript.md)
**Date:** 2026-04-24

---

## 1. Scope of Review

This review validates the v3 architecture against the 13 Core Principles in the vision document and against the constraints of the current v2 codebase. It flags gaps, ambiguities, and risks. It does not rewrite the architecture — the designer applies the fixes.

Severity key:
- **BLOCKER** — resolve before any v3 code lands
- **HIGH** — resolve before the related component ships
- **MEDIUM** — resolve during implementation of the related component
- **LOW** — worth fixing opportunistically; does not gate work

---

## 2. Alignment Summary

Principle-by-principle check of whether the architecture operationalizes the vision.

| # | Principle | Coverage | Notes |
|---|---|---|---|
| 1 | AI-First | **Full** | Agent runtime §6 + reason() contract enforces LLM as the reasoner |
| 2 | Agent-Based Architecture | **Partial** | Agents defined; **agent-to-agent orchestration protocol missing** (see §3.1) |
| 3 | Extensible by Skills and Capabilities | **Partial** | Two registries present; **skill-selection logic undefined** (see §4.2) |
| 4 | Memory That Finds You | **Partial** | SQLite + FTS5 + vector search specified; **mobile vector-store fallback missing** (see §4.5) |
| 5 | Context-Aware Response | **Partial** | Per-agent assembler; **base context contract is empty**, no time-of-day / recent-activity injection specified |
| 6 | Multi-LLM | **Full** | Gateway design is clean |
| 7 | Structured Output, Deterministic Execution | **Full** | reason() rule + Executor |
| 8 | App Runs Continuously | **Partial** | Headless scheduler specified; **in-app interval policy (per root CLAUDE.md) not called out** (see §4.6) |
| 9 | Agents Learn From Feedback | **Partial** | Loop present; **evaluator-weaker-than-agent problem** (see §3.3) |
| 10 | Secure by Default | **Partial** | Encryption boundary specified; **key recovery flow missing** (see §3.4) |
| 11 | User Understanding is the Goal | **Full** | Profile Learner agent well-specified |
| 12 | Transparent by Default | **Partial** | Surface defined; **prompt override safety boundary missing** (see §3.5) |
| 13 | Modular UI Surfaces | **Full** | Surface Shell + registry |

**Aggregate:** 5 full, 8 partial, 0 miss. Architecture is directionally correct and internally consistent. The partials are addressable without structural changes.

---

## 3. Blockers

### 3.1 Storage-model ambiguity: prompts live in both files AND database

**Severity:** BLOCKER
**Section:** §5 (directory layout), §12 (memory schema), §18 (transparency)

The architecture says `prompt.md` files ship with the app (§5) *and* that there's a `prompts` table in SQLite (§12) holding "user overrides." The relationship between the two is described in chat between designer and reviewer but not in the document itself. A future implementer will not know:

- Is the file the source of truth and the table an overlay?
- What happens when the file changes in a new release but the user has an override?
- How is "reset to default" implemented — delete the row or bump a version?
- Is the "effective prompt" composed at read time or at agent init?

**Required resolution:** add a dedicated **§Storage Model** section that explicitly maps every artifact to one of:
- **Bundle** (ships with the app, read-only at runtime): agent manifests, default prompts, skill packs, capability schemas, gateway tier-to-model config, evals
- **SQLite** (user-specific, mutable): user edits to prompts, all user data (tasks/events/notes/observations/interactions/feedback), routing log, embeddings, agent state

And a rule: **effective prompt = bundled default overlaid with user override (DB row). Transparency surface shows the effective prompt. "Reset to default" = delete the override row.**

### 3.2 Agent-to-agent orchestration protocol is undefined

**Severity:** BLOCKER
**Section:** §4 (flow diagram), §19 (default agents table mentions "Chief orchestrates other agents")

The default-agents table says Chief "orchestrates other agents." The flow diagram shows two agents in parallel. But:

- Can Chief invoke Companion mid-turn to get a mood read before answering?
- If yes, is that a synchronous sub-call, a structured tool-use call, or a second trip through the Router?
- Does the Gateway count a sub-invocation as one call or two for cost / circuit-breaker purposes?
- What is the turn boundary for the Evaluator — one Chief turn with N sub-invocations, or N separate turns?

The root `CLAUDE.md` rule says *"Single LLM call: One call per user phrase. No multi-agent pipelines."* This is a deliberate rule. The architecture must either:

(a) **Honor it explicitly** — agents do not call each other during a user turn. Inter-agent communication happens only via the shared memory layer. Chief "orchestrating" means Chief picks skills and capabilities, not other agents. Background agents (Profile Learner, Evaluator, Companion proactive check-ins) run on separate turns via the Scheduler.

(b) **Revise the rule in vision/CLAUDE.md first** — if v3 genuinely needs mid-turn agent-to-agent calls, amend the vision and define the protocol (turn boundary, cost accounting, circuit breaker, transparency logging).

**Required resolution:** pick (a) or (b) explicitly. My recommendation is (a) — it preserves the single-call guarantee and avoids reinventing orchestration frameworks we already decided against.

### 3.3 Evaluator can be weaker than the agent it grades

**Severity:** BLOCKER
**Section:** §14 (Evaluator tier is `local-light`), §19 (default agents catalog)

The Evaluator runs on `local-light` (Qwen 7B via Ollama). Chief runs on `heavy` (Sonnet) for planning. A 7B local model grading Sonnet's full-planning output will systematically miss subtle quality issues — the grader lacks the reasoning depth of the gradee.

Principle #9 says "agents cannot grade themselves" but does not say "the grader must be at least as strong as the gradee." That omission is load-bearing. Without it, the feedback loop is theater.

**Required resolution:** add a rule: **evaluator tier must be >= agent tier being graded.** Implication:
- Simple CRUD agents graded by `local-light` evaluator (fine)
- Chief on `standard` graded by `standard` evaluator
- Chief on `heavy` (full planning) graded by `heavy` evaluator — accept the cost, or stop claiming we grade planning quality

An acceptable alternative: a two-stage evaluator. `local-light` does bulk triage for "definitely good" / "definitely bad" / "unsure"; `heavy` evaluates the "unsure" bucket. This caps cost while preserving grading fidelity. Document the escalation threshold.

### 3.4 Key recovery flow is unspecified

**Severity:** BLOCKER
**Section:** §13 (encryption boundary)

Principle #10 says "the key is under the user's control." If the user forgets the passphrase:
- Is all data lost?
- Is there a recovery code generated at setup?
- Is there a biometric fallback (iOS Keychain / Android Keystore per FEAT021)?
- What is the UX when someone buys a new device?

This is a product-shaping decision, not an implementation detail. The answer determines the setup flow, the recovery surface, the multi-device sync strategy (§23 open question), and the trust model. Cannot defer past v3 scaffolding.

**Required resolution:** explicit §13 subsection: **Key Recovery Model**. Options:
- **No recovery** (maximally secure, worst UX) — forgotten passphrase = data loss, documented prominently
- **Recovery code at setup** — printed once, user stores it
- **Secure-store auto-unlock + recovery code** (likely answer — extends FEAT021)
- **Cloud-escrowed key** — rejected by Principle #10 unless escrow is itself encrypted with a user-held secret

---

## 4. High-Severity Concerns

### 4.1 AppState reference is stale

**Severity:** HIGH
**Section:** §6 (Agent.assemble signature)

`assemble(input, state: AppState)` references `AppState` from the v2 doc, which is a JSON-file-composite. In v3, state lives in SQLite. `AppState` as-defined does not exist. Either:
- Redefine `AppState` as a query facade over SQLite (lazy-loaded, per-turn snapshot), or
- Drop the parameter — agents query memory via injected repositories

Recommend the second option. It makes agents explicitly declare their reads (better for context-contract validation) and avoids loading the entire state into memory per turn.

### 4.2 Skill selection logic is absent

**Severity:** HIGH
**Section:** §10 (Router.RouteDecision has `skills: string[]` but no selection logic)

How does the Router decide which skills apply to a given intent? Heuristic? LLM classification? User-declared via profile? The document treats it as a solved primitive.

**Required:** specify the skill-selection mechanism. Suggested answer — **skills declare an `activationIntents` or `activationSignals` field in their manifest**, and the Router matches deterministically. LLM classification is a fallback only.

### 4.3 Intent taxonomy for v3 is undefined

**Severity:** HIGH
**Section:** §10 (Router)

v2 has 14 intent types listed in the current-state doc. v3 Router references `IntentType` with no definition. Do they carry over? Are they revised? Reduced (because agent selection subsumes some intents)?

**Required:** either explicitly import the v2 enum or define the v3 set. Cannot leave the router's input shape ambiguous.

### 4.4 Base context contract is empty

**Severity:** HIGH
**Section:** §11 (assembler)

"The core Assembler only composes base context (user profile summary, current time, active skills) and delegates." This is one sentence for what is arguably the most-used piece of the system. What's in the base context payload? Token budget? Redaction policy?

**Required:** specify the base context shape. At minimum:
- Effective user profile summary (from observations table, confidence-filtered)
- Current time + timezone
- Weekday + day segment (morning / midday / evening)
- Recent interaction window (last N turns, summarized)
- Active skills with their prompt fragments
- Base token budget (suggest 500–800)

Principle #5 (Context-Aware Response) hinges on this being deterministic and well-defined.

### 4.5 Mobile vector-store fallback is missing

**Severity:** HIGH
**Section:** §12 (memory layer)

`sqlite-vss` does not have clean React Native / Capacitor support on all platforms. Local embedding inference on low-end Android devices may be infeasible. The document says "non-negotiable for privacy" without addressing the capability gap.

**Required:** tiered fallback:
- Tier A (desktop / high-end mobile): sqlite-vss + local embeddings via Ollama
- Tier B (mid-range mobile): FTS5 only, no vector search, "fuzzy" degrades to lexical
- Tier C (low-end): FTS5 only, explicit UX messaging that semantic search is unavailable

Cloud-embedding-with-plaintext-user-data is NOT a fallback — it violates Principle #10.

### 4.6 In-app polling intervals not specified

**Severity:** HIGH
**Section:** §20 (Scheduler), vision Principle #8

Root `CLAUDE.md` rule: *"Every periodic check ... must run on a recurring interval inside the app, not just on mount or tab focus."* The v3 Scheduler section only describes the headless runner. The in-app interval policy is missing.

**Required:** §20 must cover both:
- Headless runner (long-running node process)
- In-app intervals (while the app is open) — driven by the same scheduler config but scoped to foreground runtime, with cancellation on blur and restart on focus

### 4.7 Transparency Layer is itself an attack / foot-gun surface

**Severity:** HIGH
**Section:** §18 (prompt editing), §16 (Companion guardrails)

If any prompt is user-editable, a user can (accidentally or maliciously) remove the Companion's clinical-boundary guardrails, or override safety behavior, or remove tool-use instructions and break the agent.

**Required:** two-zone prompt structure:
- **Editable zone** — persona, tone, style, preferences, few-shot examples
- **Locked zone** — safety behaviors, output schema instructions, tool-use format, escalation rules

Locked sections are rendered in the viewer but not editable. The UI must make the zoning obvious. Without this, the editing feature undermines Companion's hardcoded safety escalation (§16).

---

## 5. Medium-Severity Concerns

### 5.1 Agent discovery "at startup by scanning manifests" is misleading on mobile

**Severity:** MEDIUM
**Section:** §7

React Native and Capacitor do not support dynamic filesystem directory scans of app-bundle assets in a uniform way. In practice this has to be a **build-time generated registry** (a codegen step that emits `src/agents/_generated-registry.ts` from the folder layout). Call this out explicitly.

### 5.2 Observation-store growth is unbounded

**Severity:** MEDIUM
**Section:** §15 (Profile Learner)

Observations are append-only with `supersedes` links. Consolidation is mentioned (nightly pass) but retention policy is absent. Over years, this table grows without bound.

**Required:** explicit retention policy. Suggest: observations with `supersedes` set are archived after 90 days; confidence < 0.3 observations not referenced in 30 days are pruned; all prunes logged.

### 5.3 Prompt-override versioning schema undefined

**Severity:** MEDIUM
**Section:** §18

"Writes to `prompts` table with version history" — schema not in §12. How much history is retained? One row per version? CRDT? Just a JSON array in a single row?

**Required:** define the `prompts` table schema explicitly in §12. Suggest: `(agent_id, version, prompt_text, created_at, active)` with one active row per agent.

### 5.4 Capability permission / consent flow missing

**Severity:** MEDIUM
**Section:** §8 (capability manifest)

A capability has `requiresAuth` and `sideEffects` classification, but there's no user-consent flow for installing a new capability or granting it access. "Read email" is very different from "query local memory" and users should consent explicitly.

**Required:** capability install flow: manifest review, scope display, explicit allow/deny, revocable at any time from Transparency surface.

### 5.5 Circuit breaker behavior under multi-provider is unclear

**Severity:** MEDIUM
**Section:** §9

Gateway "inherits circuit breaker from v2 `llm.ts`." Per-provider? Per-tier? Per-agent? If Anthropic trips, does the system fall over to local-light silently, or surface the degradation?

**Required:** one sentence per dimension: circuit breaker is **per-provider**; tripping routes to the next provider in the fallback chain; user sees a status indicator when running on degraded tier.

### 5.6 Feedback re-injection requires user approval — UX not specified

**Severity:** MEDIUM
**Section:** §14

"Prompt tuning — periodic PR-style update ... user approves the change before it lands." How is this surfaced? How often? Approving a subtle prompt diff requires reading the diff — realistic expectation for most users?

**Required:** define the UX — batch-approval, summary view, easy rollback — and define a quiet default (no silent changes, but bundled weekly review). Otherwise the loop will be ignored.

### 5.7 Migration step 2 (dual-write) is a bug magnet

**Severity:** MEDIUM
**Section:** §21

Dual-writing to JSON and SQLite for a release doubles write code paths, and consistency bugs between the two are notoriously hard to catch. Consider one-way read-through migration instead: read JSON on first boot, write SQLite thereafter, archive JSON files. Simpler, safer, one-time cost.

---

## 6. Low-Severity / Nits

### 6.1 No explicit rejection of orchestration frameworks

**Severity:** LOW
**Section:** §22 (ADRs)

The decision to not use LangChain / LangGraph / CrewAI was discussed with the reviewer but is not captured as an ADR. Future readers will ask and find no answer.

**Suggest:** add ADR "Why no orchestration framework." Points: single-call-per-turn rule, lock-in cost, already-have-orchestration argument.

### 6.2 `LLMProvider.id` typed as `"anthropic" | "ollama" | string` defeats the discriminated union

**Severity:** LOW
**Section:** §9

Widening to `string` with named literals gives no type safety. Either keep it as a finite literal union (update it when adding providers) or drop the literals and accept it's a string.

### 6.3 `sideEffects: "none" | "read-external" | "write-external" | "write-local"` conflates external and local writes

**Severity:** LOW
**Section:** §8

`"write-local"` should arguably not require confirmation (it's our own memory). `"write-external"` should. Today this is captured by §11's "write-external requires user confirmation by default." Fine, but `"none"` and `"read-external"` should explicitly state no confirmation.

### 6.4 Default agents table uses "heavy (planning) / standard (general)" for Chief

**Severity:** LOW
**Section:** §19

Needs a rule for when Chief is heavy vs standard. v2 has this (full_planning / bulk_input / emotional_checkin / suggestion_request → Sonnet; others → Haiku). Port the rule or reference it.

### 6.5 No testing / fixtures / evaluation infrastructure in the doc

**Severity:** LOW (but see §7)

Each agent has an `evals/` folder (good) but the evaluation harness, fixture format, and CI integration are not described.

---

## 7. Testing Notes

Per the architect role, the v3 design must carry an explicit test strategy. The current document has none. Required additions:

### Unit Tests Required
- Skill-activation logic (matches intent → skills correctly, deterministic)
- Router decision (regex fast path + LLM fallback path)
- Capability manifest validation (schema correctness)
- Agent-manifest validation (required fields, tier enum)
- Observation upsert rules (supersedes logic, confidence decay)
- Prompt-effective-value computation (bundle + override merge)
- Base context assembly (time-of-day classification, token budget enforcement)
- Feedback-signal classification (explicit vs implicit, source attribution)

### Component Tests Required (mocked dependencies)
- Agent.reason() with mocked Gateway — verify it never mutates state
- Executor capability dispatch (routes to correct capability handler)
- Evaluator scoring against a fixed rubric (deterministic output for fixed inputs)
- Gateway provider fallback chain (primary fails → secondary called)
- Memory-layer encryption boundary (plaintext never escapes)
- Profile-Learner incremental pass (given fixture interactions, produces expected observation deltas)

### Integration Tests Required
- Full turn: user input → Router → Chief → Gateway → Executor → Memory → response (happy path)
- Full turn with skill activation (financial-advisor skill loads, contributes prompt fragment)
- Full turn with capability invocation (e.g., read-email → cached result → Executor ingests)
- Companion proactive check-in end-to-end (scheduler → Companion → surface update)
- Profile Learner nightly consolidation end-to-end
- Feedback loop closure: signal → Evaluator → re-injection → next turn observes change
- Encryption boundary: DB-at-rest bytes unreadable without the key (not just "the app can't read it" — the bytes themselves)
- Key recovery flow (when decided per §3.4)

### Scope Isolation Tests
Not applicable in the single-user / single-device sense. Applies if multi-device sync ships (§23 open question) — then per-device write isolation + conflict resolution need tests.

### Agent Fixtures Required
Each default agent needs a golden-example fixture set in `src/agents/<id>/evals/`:
- **Chief** — 20+ interaction examples spanning planning, CRUD, general chat, across tiers
- **Companion** — 15+ interactions covering: energy check, friction detection, celebration, escalation trigger, escalation avoidance, edge cases near distress boundary
- **Profile Learner** — 10+ input sequences → expected observation outputs
- **Inbox** — 10+ bulk-input blobs → expected structured writes
- **Evaluator** — 10+ (agent output, signal, expected score) tuples

Fixtures are recorded, not generated live — tests must be deterministic without live LLM calls. Re-record only when prompts change intentionally.

---

## 8. Recommended ADR Additions

The document has 9 ADRs. The following gaps should be filled, either in this review cycle or during implementation:

1. **Why no orchestration framework** (LangChain / LangGraph / CrewAI) — see §6.1
2. **Why effective-prompt = bundle + override** — see §3.1
3. **Why agents do not call each other during a user turn** — see §3.2
4. **Why evaluator tier >= gradee tier** — see §3.3
5. **Why key recovery is [X]** — once §3.4 is decided
6. **Why build-time agent registry generation** — see §5.1

---

## 9. Verdict

**Direction:** sound. The architecture correctly operationalizes the 13 Core Principles and is internally consistent. The separation of Agent / Skill / Capability / Surface is the right spine.

**Readiness for implementation:** not yet. The four BLOCKERs (§3) each represent decisions that will be expensive to reverse once code lands. Resolve them before migration step 1.

**Recommendation:**
1. Designer updates the architecture document to resolve the four BLOCKERs.
2. Designer adds a §Storage Model section and a §Key Recovery Model subsection.
3. Designer picks (a) or (b) for §3.2 and amends accordingly.
4. Designer adds the evaluator-tier rule to §14.
5. Reviewer re-reviews the delta.
6. Implementation begins at Migration Step 1 (Gateway).

The HIGH and MEDIUM items can be resolved during implementation of their related components — they should become tickets, not gates.

---

## 10. Pattern Learnings for AGENTS.md

Recurring patterns from this review that should be captured for future feature / architecture reviews:

- **Every "user overrides default" feature must answer: where does the default live, where does the override live, how is the effective value computed, and how is reset implemented.** Applies to prompts, preferences, skill enablement, capability permissions.
- **Any feedback loop must answer: is the grader at least as strong as the gradee.** Cost-saving via weaker graders is a false economy.
- **Any editable-by-user behavior must have a locked-zone / editable-zone split** if any portion of it carries safety or correctness implications.
- **"Local-only" memory claims must state the mobile-device fallback.** Otherwise the claim silently weakens on low-end hardware.
- **"At startup" in a mobile app means "at build time" for static assets.** Dynamic scanning of bundled assets is not portable.
- **"Append-only" storage needs an explicit retention policy.** Unbounded growth is a latent failure.
