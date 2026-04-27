# Chief Clarity v4 — Request Flow

The interactive path: one user phrase in, one response out, one reasoning LLM call.

---

## 0. As-shipped flow (v2.02)

The Phase 1 + Phase 2 implementation lives in `app/(tabs)/chat.tsx` and
`src/modules/{router,skillDispatcher,v4Gate}.ts`. The actual call order:

```
chat.tsx phrase
  → runTriage(...)                             // preserves emotional/friction detect
  → v4Gate.shouldTryV4({ state, ... })         // Node-only; gate also blocks
                                                //   when enabled set empty
                                                //   or state._pendingContext set
  → (if true) routeToSkill({ phrase })         // see §1 — pipeline below
  → dispatchSkill(routeResult, phrase, { state }) // see §3
        ├── null    → fall through to legacy intent path
        ├── degraded → fall through to legacy (warn-log)
        └── success → render reply with v4Meta badge; if state._dirty has
                       entries, chat.tsx awaits flush(s); return
  → (else)         → continue to legacy triage canHandle / needsClarification
                      then classifyIntent / dispatch to existing intent code
```

The v4 hook fires AFTER `runTriage` but BEFORE triage's
`canHandle`/`needsClarification` short-circuits, so v4 skills get first crack
at handling phrases that legacy triage would refuse or bounce for clarification
(FEAT056 post-Tester fix).

v4 is Node-only by design today: `shouldTryV4` returns `false` on web/RN
bundles via an `isNode()` check, because the registry's `fs.readdirSync` scan
isn't available. Capacitor mobile activation is FEAT044's scope (a generated
skill index, not a runtime fs scan). On web, every phrase takes the legacy
path. This means latent v4 bugs surface only via test trace + reasoning, not
real usage — see `07_operations.md §6`.

The dispatcher is gated by `getV4SkillsEnabled()` (set in `app/_layout.tsx`):
empty set → 100% legacy, full set → all listed skills route through v4. This
is the rollback knob until FEAT035 ships the settings panel.

---

## 1. Orchestrator

**File:** `src/modules/router.ts` (refactored)  
**Type:** TypeScript + optional Haiku tiebreaker  
**Cost:** $0 for high-confidence routing; ~$0.00005 for tiebreaker

The orchestrator selects a `skillId`. It does not reason. It does not detect conflicts.
It does not query the vector DB. Those concerns belong to the Assembler and the skill.

### Routing algorithm

```
Step 1 — Structural match [TypeScript, $0]
  Slash commands (/diary, /plan), button taps, system events
  → direct skillId, skip steps 2–3

Step 2 — Embedding similarity [TypeScript, $0, ~10ms]
  Embed user phrase with local bge-m3 (already running)
  Score against each skill's cached description embedding
  Get top-3 candidates with confidence scores
  Consider attachment metadata as additional signal:
    e.g., CSV attached → boost skills with supports_attachments: ["csv"]

Step 3 — Confidence gate [TypeScript, $0]
  If top1 > 0.80 AND (top1 - top2) > 0.15 → route to top1 directly

Step 4 — Haiku tiebreaker [Haiku, ~80 tokens, ~$0.00005, ~200ms]
  Only reached when gate fails (ambiguous phrase)
  Prompt: "User said: '<phrase>'. Pick the best skill:
    1. task_management — create, update, track individual tasks
    2. priority_planning — decide what to focus on, rank work
    3. calendar — schedule meetings, check availability
  Return only the number."
  → skillId
```

**Why no natural-language regex:** Regex on free-form phrases produces wrong
routing for semantically ambiguous inputs (e.g., "tell me which of my tasks is most
important" matches `task_*` patterns but should route to `priority_planning`).
Embedding similarity handles semantic intent correctly.

**Regex is kept only for:** slash commands, structured button events, internal
system phrases — never free-form natural language.

### Orchestrator output

```ts
{
  skillId: string;
  confidence: number;
  routingMethod: "structural" | "embedding" | "haiku";
  attachmentContext?: { type: string; rows?: number; headers?: string[] }[];
}
```

---

## 2. Assembler

**File:** `src/modules/assembler.ts` (generalized)  
**Type:** TypeScript, deterministic  
**Cost:** $0

The Assembler builds the context blob for the single LLM call. It is declarative:
each skill's `context.ts` declares what it needs; the Assembler resolves and enforces.

### Assembler pipeline

```
1. Load skill.context.ts requirements
   e.g., ["user_profile", "recent_tasks:10", "calendar_today", "objectives", "attachment_chunks:3"]

2. Resolve each requirement:
   - Static sources: user_profile, objectives → cached, no DB query
   - Recent data: recent_tasks, recent_notes → SQLite queries
   - Semantic memory: vector search on user phrase → top-K relevant chunks
     (threshold: similarity > 0.65, max tokens: skill-declared budget)
   - Attachment chunks: vector search across in-scope attachment store
     → top-K relevant chunks, capped at skill's attachment token budget
   - Calendar data: direct query via capability registry

3. Apply Data Schema Registry policy filter
   Remove any data the skill is not authorized to see
   Exclusion happens at retrieval time — restricted data never assembled

4. Conflict scan (TypeScript, semantic search)
   Search prior decisions/agreements for contradiction with current request
   e.g., "user previously declined meeting with [contact]"
   If conflict found: attach conflict_flag to context (skill prompt handles disclosure)

5. Enforce token budget
   Each requirement has a priority rank and max-token slice
   Low-priority items truncated first if total exceeds skill's budget
   Budget enforced deterministically — no LLM truncation

6. Assemble context blob
```

### Assembler output

```ts
{
  userPhrase: string;
  skill: SkillManifest;
  context: {
    userProfile: UserProfile;          // cached
    objectives: Objective[];           // cached
    semanticMemory: MemoryChunk[];     // vector search results
    attachmentChunks: AttachmentChunk[]; // RAG results
    skillSpecific: Record<string, unknown>; // skill-declared extras
    conflictFlags: ConflictFlag[];     // detected contradictions
  };
  tokenCount: number;
  budgetRemaining: number;
}
```

---

## 3. LLM Dispatcher

**File:** `src/llm.ts` (refactored to be skill-aware)  
**Type:** One LLM call per phrase  
**Model:** Declared in skill manifest (`haiku` or `sonnet`)

```ts
async function dispatch(input: AssemblerOutput): Promise<ToolCall> {
  const { skill, userPhrase, context } = input;
  const systemPrompt = loadPrompt(skill.id);        // reads skill/prompt.md
  const tools = loadTools(skill.tools);             // skill's declared tool schemas
  const model = resolveModel(skill.manifest.model); // "haiku" | "sonnet"

  const response = await llmClient.call({
    model,
    system: systemPrompt,
    messages: [{ role: "user", content: buildUserMessage(userPhrase, context) }],
    tools,
    tool_choice: { type: "required" }               // always returns structured tool call
  });

  return response.toolCall; // always JSON, never free text
}
```

**Key invariants:**
- Always uses `tool_choice: required` — LLM output is always structured JSON
- No free-text responses from the dispatcher (language is generated by tool handlers)
- Model selection is per-skill, not global — simple skills use Haiku, complex use Sonnet
- One call. No retry loops that call the LLM again on ambiguity — ambiguity
  resolution is handled upstream by the Orchestrator or surfaced as a clarifying question
  in the tool call output

---

## 3a. Dispatcher state-forwarding contract (FEAT061)

The dispatcher passes `options.state` into the handler's `ctx` so the handler
can call `applyWrites(state, ...)` directly:

```ts
handler(toolArgs, { phrase, skillId: skill.manifest.id, state: options.state })
```

`ToolHandler`'s ctx type (in `src/types/skills.ts`) is `{ phrase, skillId, state?: unknown }`.
`state` is intentionally typed `unknown` to keep the skill-system types
decoupled from `AppState`; handlers narrow at use site
(`const state = ctx.state as AppState | undefined`).

Pre-FEAT061 the dispatcher dropped state, so the handler's `applyWrites` block
was dead code on both the chat path and the inbox-timer path. Post-FEAT061
the handler is the **sole writer** on both paths — `processBundle` in
`src/modules/inbox.ts` only refreshes derived state (`updateSummaries`,
`rebuildHotContext`, `rebuildContradictionIndex`) after the dispatcher returns,
no second `applyWrites`. See `02_skill_registry.md §11` for the test pattern
that protects this contract.

A test pattern related to this contract: `notes`-shaped writes use a
`_loadedCounts` post-flush signal (`"notes" in state._loadedCounts`) instead
of a direct `state.notes.notes.length` assertion in some FEAT061 dispatcher
tests, because pre-FEAT062 the executor's `applyAdd` array-loop didn't include
`notes`. Post-FEAT062, those tests can be tightened to direct array-length
checks (FEAT062 already tightened the ones it owned).

---

## 4. Executor

**File:** `src/modules/executor.ts` (extended)
**Type:** TypeScript
**Cost:** $0

Receives the structured tool call from the Dispatcher and runs it.

### `applyAdd` array-shape coverage (FEAT062)

`applyAdd` finds the inner array on a file by iterating
`["tasks", "events", "items", "suggestions", "notes"]` and pushing to the first
match. `notes` was added in FEAT062 because the legacy executor only iterated
the first four keys, which silently overwrote `state.notes` with `Object.assign`
when v4 skills emitted `{ file: "notes", action: "add" }` writes. Pre-fix the
handler returned `success: true` and a confirmation message, but the note never
appeared in `notes.notes`.

**Latent gap:** the same omission still exists in `applyUpdate`
(`["tasks", "events", "items", "suggestions"]` at line ~665) and `applyDelete`
(line ~699). Latent-but-not-live today — `notes_capture` is append-only and no
shipped v4 skill emits `update`/`delete` on `file: "notes"`. The first FEAT
that introduces a notes-mutation write path takes responsibility for adding
`notes` to those loops and a regression test (FEAT062 carry-forward).

```
Executor receives:
  { tool: "schedule_event", args: { title, start, end, attendees } }

Executor:
  1. Validates args against tool schema (TypeScript)
  2. Checks write permissions (Data Schema Registry)
  3. Dispatches to skill.handlers.ts → skill.handlers.schedule_event(args)
  4. Handlers write through filesystem.ts (atomic temp-rename pattern)
  5. Audit log: { agent: skillId, tool, args_hash, timestamp, user_id }
  6. Returns structured result to response layer
  7. Generates user-facing message (natural language reply from tool result)
  8. Emits self-score signal: { interaction_id, skill, tool, timestamp }
```

**Write safety:** All writes go through `filesystem.ts`. No skill handler writes
directly to disk or DB. This ensures atomic writes, audit logging, and a single
enforcement point for the Data Schema Registry at write time.

---

## 5. Full end-to-end example

User: *"I have many tasks — tell me which one is most important"*

```
T=0ms    User phrase arrives

T=5ms    [TS] Orchestrator: embed phrase
         top scores: priority_planning=0.81, task_management=0.73, planning=0.76
         Gate: top1=0.81, gap=0.05 → gate fails (gap < 0.15)

T=205ms  [Haiku] Tiebreaker: "priority_planning"
         skillId = "priority_planning"

T=210ms  [TS] Assembler:
         requirements: [user_profile, objectives, recent_tasks:20, recent_notes:5]
         vector search: top-5 memory chunks relevant to "important tasks"
         conflict scan: none found
         token budget: 4200 / 5000 used

T=220ms  [Sonnet] Dispatcher: one call
         system = priority_planning/prompt.md
         tools = [submit_priority_ranking]
         context = assembled blob

T=1400ms [TS] Executor:
         tool = submit_priority_ranking
         args = { ranked: [...], reasoning: "...", top_item: "..." }
         writes to priority_log
         audit entry recorded
         user-facing message generated

T=1420ms Response to user
T=1421ms Self-score signal emitted (async)
```

Total: ~1.4s. One reasoning call (Sonnet). One tiebreaker (Haiku, 205ms). Zero extra
orchestration calls. Correct specialist used.

---

## 6. Clarification flow

When the skill cannot act without more information, the tool call returns a
clarifying question rather than an action:

```json
{
  "tool": "request_clarification",
  "args": {
    "question": "Which project should I focus on — the deadline tomorrow or the one your manager flagged?",
    "context_hint": "two_competing_deadlines"
  }
}
```

The Executor surfaces this to the user. The user's answer becomes a new phrase
and re-enters the flow at the Orchestrator. The Orchestrator routes to the same
skill (context_hint aids routing). The Assembler includes the prior clarification
exchange in the context. One new reasoning call.
