# FEAT043 — Two-stage LLM reasoning architecture with triage-driven context loading

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Architecture
**Priority:** 1
**Release:** v4.0
**Tags:** llm, reasoning, triage, architecture, sonnet, haiku
**Created:** 2026-04-09
**Design Reviewed:** 2026-04-10

**Depends on:** FEAT041 (libSQL — Done), FEAT042 (Embeddings — Done)

---

## Summary

Replace the rigid regex → hardcoded-context → forced-tool-use pipeline with a two-stage LLM architecture:

- **Stage 1 (Triage):** Haiku reads the user's phrase + a lightweight data menu and decides: what is this about, what data does the LLM need, how complex is this, can we handle it?
- **Stage 2 (Action):** The right model (Haiku for simple, Sonnet for complex) receives only the data Stage 1 requested, plus a tailored prompt for the action type.

This removes the ceiling on what the app can handle. Today, "find duplicates in my tasks" fails because no regex pattern matches it and the assembler doesn't know to load all tasks for analysis. With triage, the LLM decides what data is needed — no new TypeScript code paths required for new capabilities.

---

## What changed since the original spec

FEAT041 and FEAT042 are now implemented. This changes the design:

| Original assumption | Current reality |
|---|---|
| Data loaded from 21 JSON files | Data loaded from libSQL via query modules |
| No semantic search | FEAT042 provides `retrieveContext(phrase, intentType)` with 456 embeddings |
| Assembler does all data loading | Assembler already has vector retrieval injected |
| `readJsonFile()` for each data source | SQL queries via `getDb().execute()` |
| No cross-domain linking | `task_calendar_links` and `task_note_links` auto-populated |

**Key simplification:** Stage 1 doesn't need to specify "load tasks.json" — it specifies SQL-level data needs ("tasks due this week", "events in the next 3 days") and the data loader runs parameterized queries. This is much more powerful than the JSON-era "load this file" model.

---

## Developer Implementation Guide

### Architecture overview

```
User sends message
       |
       v
  Stage 1: TRIAGE (Haiku, ~200 tokens output)
  Input:  phrase + conversation summary + data source menu (~100 tokens)
  Output: {
    understanding: string,
    dataSources: string[],        // which tables to query
    queryHints: Record<string, string>,  // SQL-level filter hints
    semanticQuery: string | null, // phrase for vector search (FEAT042)
    canHandle: boolean,
    complexity: "low" | "high",
    actionType: "create" | "update" | "query" | "analysis" | "plan" | "chat"
  }
       |
       v
  canHandle = false? → Return clear "I can't do that" message
       |
       v
  TypeScript: DATA LOADER (new module)
  - Reads dataSources + queryHints from triage output
  - Runs SQL queries for each requested source (filtered, not full dumps)
  - Runs vector search if semanticQuery is set (FEAT042 retriever)
  - Selects prompt sections relevant to actionType
  - Enforces token budget on assembled context
       |
       v
  Stage 2: ACTION (model chosen by complexity)
  - Low complexity: Haiku + submit_action_plan (forced tool_use)
  - High complexity: Sonnet + submit_action_plan (tool_choice: auto)
  Input:  phrase + loaded data + tailored prompt sections
  Output: ActionPlan (same shape as today — reply, writes, items, etc.)
       |
       v
  Executor applies writes (unchanged from today)
```

---

## Three sequential work packages

### WP-1: Triage module — `src/modules/triage.ts`

**Goal:** A new module that calls Haiku with a lean prompt to classify the request and decide what data to load.

#### 1.1 Triage prompt (~30 lines)

Replaces the current 420-line `SYSTEM_PROMPT` for Stage 1. Contains only:

```
You are a request classifier for a personal assistant app. The user sent a message.
Determine what they need and what data is required.

Available data sources:
- tasks: user's tasks (can filter by status, category, due date, priority)
- calendar: events (can filter by date range, status)
- okr: objectives and key results with progress
- facts: stored observations and knowledge about the user
- observations: behavioral patterns (work style, emotional state)
- notes: user's voice/text notes
- recurring: repeating task schedules
- profile: user identity, timezone, family members
- lifestyle: daily schedule, work windows, preferences
- chat_history: recent conversation messages
- topics: topic repository with notes

Use the submit_triage tool to respond.
```

#### 1.2 Triage tool schema

```typescript
const TRIAGE_TOOL = {
  name: "submit_triage",
  input_schema: {
    type: "object",
    properties: {
      understanding: { type: "string", description: "One sentence: what the user wants" },
      dataSources: {
        type: "array",
        items: { type: "string", enum: ["tasks", "calendar", "okr", "facts", "observations", "notes", "recurring", "profile", "lifestyle", "chat_history", "topics"] }
      },
      queryHints: {
        type: "object",
        description: "Per-source filter hints. e.g. { tasks: 'overdue', calendar: 'next 3 days' }"
      },
      semanticQuery: { type: "string", description: "Phrase for semantic search, or null if not needed" },
      canHandle: { type: "boolean", description: "false if this is outside app capabilities (weather, web search, etc.)" },
      cannotHandleReason: { type: "string" },
      complexity: { type: "string", enum: ["low", "high"] },
      actionType: { type: "string", enum: ["create", "update", "query", "analysis", "plan", "chat"] },
    },
    required: ["understanding", "dataSources", "canHandle", "complexity", "actionType"],
  },
};
```

#### 1.3 `callTriage()` function

```typescript
export async function callTriage(
  phrase: string,
  conversationSummary: string,
  hotContext: HotContext
): Promise<TriageResult> {
  // Call Haiku with the lean triage prompt
  // Input: { phrase, conversationSummary, today, userName, openTaskCount, overdueCount }
  // Output: TriageResult via submit_triage tool
  // Budget: max_tokens = 200 (triage is fast and cheap)
  // Fallback: if triage fails, return a safe default that loads general context
}
```

#### 1.4 Regex fast-path (keep existing)

For obvious intents (exact regex matches), skip the triage LLM call entirely. The current regex patterns (`PATTERNS` array in router.ts) become the fast-path optimizer:

```typescript
// If regex matches with high confidence → skip triage, use hardcoded data sources
const FAST_PATH: Record<string, Partial<TriageResult>> = {
  task_create: { dataSources: ["tasks", "calendar"], complexity: "low", actionType: "create" },
  task_update: { dataSources: ["tasks"], complexity: "low", actionType: "update" },
  calendar_create: { dataSources: ["calendar", "tasks"], complexity: "low", actionType: "create" },
  // ... etc for all 17 regex intents
};
```

#### 1.5 Acceptance

- [ ] `callTriage("add a task: buy groceries tomorrow")` returns `{ complexity: "low", dataSources: ["tasks"], actionType: "create" }`
- [ ] `callTriage("find duplicates in my tasks and merge them")` returns `{ complexity: "high", dataSources: ["tasks"], actionType: "analysis" }`
- [ ] `callTriage("what's the weather?")` returns `{ canHandle: false }`
- [ ] Regex fast-path skips the Haiku call for `"plan my day"` → instant triage result
- [ ] Triage call completes in < 500ms (Haiku, ~100 input tokens, ~100 output tokens)

---

### WP-2: Triage-driven data loader — `src/modules/triageLoader.ts`

**Goal:** Replace the assembler's per-intent switch/case with a data loader that reads the triage output and runs targeted SQL queries + vector search.

#### 2.1 Data source → SQL query mapping

```typescript
const SOURCE_LOADERS: Record<string, (hints: string, state: AppState) => Promise<unknown>> = {
  tasks: async (hints, state) => {
    // Parse hints: "overdue" → WHERE status != 'done' AND due < today
    //              "due this week" → WHERE due BETWEEN today AND today+7
    //              "all" → no filter (for analysis)
    // Falls back to buildTaskIndex(state) if no DB
    return loadFilteredTasks(hints, state);
  },
  calendar: async (hints, state) => {
    // "next 3 days" → WHERE datetime BETWEEN now AND now+3d
    // "this week" → WHERE datetime BETWEEN monday AND sunday
    return loadFilteredEvents(hints, state);
  },
  okr: async (hints, state) => state.planOkrDashboard,
  facts: async (hints, state) => state.contextMemory.facts,
  observations: async (hints, state) => state.userObservations,
  notes: async (hints, state) => state.notes,
  recurring: async (hints, state) => state.recurringTasks,
  profile: async (hints, state) => state.userProfile,
  lifestyle: async (hints, state) => state.userLifestyle,
  chat_history: async (hints, state) => state.hotContext, // summary, not raw
  topics: async (hints, state) => state.topicManifest,
};
```

#### 2.2 Vector search integration

If `triage.semanticQuery` is set, call the FEAT042 retriever:

```typescript
if (triage.semanticQuery && _retrieveContextFn) {
  const vectorResults = await _retrieveContextFn(
    triage.semanticQuery,
    mapActionTypeToIntent(triage.actionType),
    15
  );
  context.vectorRetrieved = vectorResults;
}
```

#### 2.3 Prompt section selection

Instead of the monolithic 420-line `SYSTEM_PROMPT`, select only the sections relevant to the `actionType`:

```typescript
const PROMPT_SECTIONS: Record<string, string[]> = {
  create: ["core_rules", "task_create_rules", "calendar_create_rules", "conflict_rules"],
  update: ["core_rules", "update_rules"],
  query: ["core_rules", "query_rules"],
  analysis: ["core_rules", "analysis_rules"],  // NEW — lean prompt for analysis
  plan: ["core_rules", "planning_rules", "companion_rules", "routine_rules"],
  chat: ["core_rules"],
};
```

The `core_rules` section (~50 lines) contains: no IDs in replies, no confabulation, honest limitations, items array format. The other sections are extracted from the current `SYSTEM_PROMPT` into composable blocks.

#### 2.4 Acceptance

- [ ] Triage requesting `["tasks"]` with hint `"overdue"` loads only overdue tasks (not all 115)
- [ ] Triage requesting `["tasks", "calendar", "facts"]` loads all three
- [ ] Vector search runs when `semanticQuery` is set
- [ ] Prompt for `actionType: "create"` is ~100 lines (not 420)
- [ ] Token budget shrinks by ≥ 30% for simple CRUD intents

---

### WP-3: Wire into processPhrase() — `app/(tabs)/chat.tsx`

**Goal:** Replace the current `classifyIntent → assembleContext → callLlm` flow with `triage → triageLoader → callLlm`.

#### 3.1 Updated pipeline in processPhrase()

```typescript
// BEFORE (current):
const intent = await classifyIntentWithFallback(phrase, s);
const context = await assembleContext(intent, phrase, s, conversation);
const plan = await callLlm(context, intent.type);

// AFTER:
const triage = await runTriage(phrase, conversationSummary, s.hotContext);
if (!triage.canHandle) {
  setMessages(m => [...m, { role: "assistant", content: triage.cannotHandleReason || "I can't help with that.", timestamp: now }]);
  return;
}
const context = await loadTriageContext(triage, phrase, s, conversation);
const model = triage.complexity === "high" ? SONNET : HAIKU;
const plan = await callLlm(context, mapActionType(triage.actionType), model);
```

#### 3.2 Backward compatibility

The old `classifyIntentWithFallback()` + `assembleContext()` functions stay in the codebase (not deleted). The triage module falls back to the old pipeline if:
- The triage Haiku call fails (API error, circuit breaker open)
- The regex fast-path returns a known intent with high confidence

This means FEAT043 is a progressive enhancement, not a breaking change.

#### 3.3 New tool: `submit_analysis` (for high-complexity requests)

For `actionType: "analysis"` with `complexity: "high"`, the LLM uses a different tool that allows free-form reasoning:

```typescript
const ANALYSIS_TOOL = {
  name: "submit_analysis",
  input_schema: {
    type: "object",
    properties: {
      analysis: { type: "string", description: "Reasoning and findings shown to user" },
      suggestedActions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            writes: { type: "array", items: { /* same WriteOperation schema */ } },
          },
        },
      },
    },
    required: ["analysis"],
  },
};
```

The `suggestedActions` are shown to the user as confirmable action groups — the user approves each one before writes execute.

#### 3.4 callLlm() update

Add a model parameter override so the triage can choose the model:

```typescript
// Current:
export async function callLlm(context, intentType): Promise<ActionPlan | null>

// Updated:
export async function callLlm(context, intentType, modelOverride?: string): Promise<ActionPlan | null>
```

If `modelOverride` is set, use it instead of `MODEL_BY_INTENT[intentType]`.

#### 3.5 Acceptance

- [ ] "Add task: buy groceries" → regex fast-path → Haiku → task created (no triage LLM call)
- [ ] "Find duplicates in my tasks" → triage → loads all tasks → Sonnet → analysis with suggested merges
- [ ] "What's the weather?" → triage → canHandle: false → clear message
- [ ] "Plan my day" → regex fast-path → full planning context → Sonnet → focus brief
- [ ] Triage failure (API down) → falls back to old regex + assembler pipeline
- [ ] Round-trip latency for simple CRUD: < 500ms added vs current pipeline
- [ ] Token cost for simple CRUD: comparable to current (triage adds ~200 tokens)

---

## Files to create

| File | Purpose |
|---|---|
| `src/modules/triage.ts` | Stage 1 triage: Haiku call + regex fast-path + fallback |
| `src/modules/triageLoader.ts` | Triage-driven data loader: SQL queries + vector search + prompt selection |
| `src/constants/prompts/core.ts` | Core rules (~50 lines, always included) |
| `src/constants/prompts/create.ts` | Task/event creation rules |
| `src/constants/prompts/planning.ts` | Full planning + companion rules |
| `src/constants/prompts/analysis.ts` | Analysis/reasoning rules (new capability) |

## Files to modify

| File | Change |
|---|---|
| `app/(tabs)/chat.tsx` | Replace `classifyIntent → assembleContext → callLlm` with `triage → triageLoader → callLlm` |
| `src/modules/llm.ts` | Add `modelOverride` parameter to `callLlm()`. Add `ANALYSIS_TOOL`. Add `callTriageLlm()` for Stage 1. |
| `src/modules/assembler.ts` | Keep as-is (fallback path). Vector retriever stays injected. |
| `src/modules/router.ts` | Keep as-is (regex patterns become fast-path for triage). |
| `src/constants/prompts.ts` | Extract `SYSTEM_PROMPT` into composable sections. Keep original as `LEGACY_SYSTEM_PROMPT` for fallback. |
| `src/modules/executor.ts` | Add `applyAnalysisActions()` for user-confirmed action groups from `submit_analysis`. |

---

## Execution order

```
WP-1 (triage module)     → standalone, no deps on WP-2/3
WP-2 (triage loader)     → needs WP-1
WP-3 (wire into chat)    → needs WP-1 + WP-2
```

Strictly sequential.

---

## WP-4: Intelligent scope clarification + learning

**Added:** 2026-04-11 (post-implementation review)
**Depends on:** WP-1 + WP-3 (triage + chat wiring must be working)

### Problem

When the user says "find duplicates in my tasks", the triage has to guess whether they mean open tasks (55) or all tasks including completed (118). Getting it wrong either wastes tokens (loads too much) or misses duplicates (loads too little). This applies broadly: "clean up my calendar" — this week or this month? "summarize my notes" — recent or everything?

Hardcoding scope rules per request type doesn't scale. The system needs to:
1. Detect when scope is ambiguous
2. Ask the user to narrow it
3. Learn the user's preference so it doesn't ask again

### Design

#### 4.1 Give the triage LLM data volumes

The triage input currently has `openTaskCount` and `overdueCount`. Expand it with volumes for all data sources so Haiku can make informed scope decisions:

```typescript
const input = {
  phrase,
  conversationSummary,
  today: hotContext?.today,
  userName: hotContext?.userName,
  // Data volumes — Haiku uses these to decide if scope clarification is needed
  dataVolumes: {
    openTasks: 55,
    completedTasks: 63,
    totalTasks: 118,
    calendarEventsThisWeek: 8,
    calendarEventsTotal: 35,
    notesCount: 39,
    factsCount: 139,
  },
  // User's learned scope preferences from feedbackMemory.rules
  scopePreferences: [
    "For task analysis, default to open tasks unless user says 'all'",
    "Calendar cleanup defaults to this week",
  ],
};
```

#### 4.2 Add `needsClarification` to TriageResult

New fields in the triage tool schema:

```typescript
{
  needsClarification: boolean,
  clarificationQuestion: string,    // "Check open tasks (55) or all tasks (118)?"
  clarificationOptions: [           // Quick-tap options shown in chat
    { label: string, hint: string } // { label: "Open tasks only", hint: "tasks:open" }
  ],
}
```

When `needsClarification` is true, the pipeline stops at Stage 1. No data is loaded, no Stage 2 LLM call is made.

#### 4.3 Chat UI flow

```
User: "find duplicates in my tasks"
  ↓
Triage: needsClarification = true
  ↓
Chat shows:
  Assistant: "Should I check your open tasks (55) or include completed ones too (118 total)?"
  [Open tasks only]  [All tasks]
  ↓
User taps "Open tasks only"
  ↓
processPhrase re-runs with:
  phrase = "find duplicates in my tasks"
  + injected hint: "scope: open tasks only"
  ↓
Triage sees the hint → resolves scope → dataSources: ["tasks"], queryHints: { tasks: "open" }
  ↓
Stage 2 runs with 55 tasks (not 118)
```

Implementation: the quick-tap buttons work exactly like the existing `SmartAction.quickActions` with `isDirect: true`. When tapped, the `hint` value is appended to the original phrase and re-submitted to `processPhrase`. No new UI components needed.

#### 4.4 Learning loop

After the user picks a scope option:
1. The LLM's Stage 2 response includes a `memorySignals` write:
   ```json
   { "signal": "scope_preference", "value": "task analysis defaults to open tasks" }
   ```
2. The executor writes it to `feedbackMemory.behavioralSignals`
3. On next triage, TypeScript extracts scope-related rules from `feedbackMemory` and passes them as `scopePreferences` in the triage input
4. Haiku sees "user prefers open tasks for analysis" → auto-resolves scope → no clarification

But we don't need to rely on the LLM to learn this. **TypeScript can do it deterministically:**

```typescript
// After user picks a clarification option:
function learnScopePreference(
  actionType: ActionType,
  dataSource: string,
  chosenHint: string,
  state: AppState
): void {
  const rule = `For ${actionType} on ${dataSource}, default to "${chosenHint}"`;
  // Check if rule already exists
  const exists = state.feedbackMemory.rules?.some(r =>
    r.rule.includes(actionType) && r.rule.includes(dataSource)
  );
  if (!exists) {
    state.feedbackMemory.rules = state.feedbackMemory.rules || [];
    state.feedbackMemory.rules.push({
      rule,
      source: "system",
      date: new Date().toISOString().slice(0, 10),
    });
    state._dirty.add("feedbackMemory");
  }
}
```

Next time, triage sees the learned rule in `scopePreferences` and auto-resolves without asking. The user teaches the system once, it remembers forever.

#### 4.5 When NOT to clarify

Haiku should NOT ask for clarification when:
- The data volume is small (< 30 total items) — just load everything
- The user explicitly said "all" or "everything" in their phrase
- A learned `scopePreferences` rule already covers this case
- The request is simple CRUD (create/update/delete) — scope doesn't apply
- The request hit the regex fast-path (already routed)

Add this to the triage prompt:

```
## Scope Clarification
If the request involves analysis/search over a large data source (> 30 items)
and the user didn't specify scope, set needsClarification = true.
DO NOT clarify if:
- Total items < 30 (just load everything)
- User said "all", "everything", "entire"
- scopePreferences already covers this case
- The request is simple CRUD (create/update/delete)
Offer 2-3 options with clear item counts.
```

#### 4.6 Files to modify

| File | Change |
|---|---|
| `src/modules/triage.ts` | Add `needsClarification`, `clarificationQuestion`, `clarificationOptions` to TriageResult + tool schema. Add `dataVolumes` and `scopePreferences` to triage input. Update triage prompt with clarification rules. |
| `app/(tabs)/chat.tsx` | Handle `needsClarification` from triage: show question + quick-tap options. On tap, re-submit with hint. Call `learnScopePreference` after selection. |
| `src/modules/triageLoader.ts` | Add helper to build `dataVolumes` from AppState. Add helper to extract `scopePreferences` from feedbackMemory.rules. |

#### 4.7 Acceptance

- [ ] "Find duplicates in my tasks" → triage asks "Open (55) or all (118)?" → user picks → loads correct scope
- [ ] "Find duplicates in all my tasks" → no clarification (user said "all") → loads 118 tasks
- [ ] "Find duplicates in my tasks" with only 20 tasks total → no clarification → loads everything
- [ ] After picking "open tasks" once, next "find duplicates" auto-resolves to open → no question
- [ ] "Clean up my calendar" → triage asks "This week (8) or all (35)?"
- [ ] Simple requests ("add task: buy groceries") → never triggers clarification
- [ ] Regex fast-path requests → never triggers clarification

---

## Execution order (updated)

```
WP-1 (triage module)     → standalone                     ✅ DONE
WP-2 (triage loader)     → needs WP-1                     ✅ DONE
WP-3 (wire into chat)    → needs WP-1 + WP-2              ✅ DONE
WP-4 (scope clarification + learning) → needs WP-1 + WP-3
```

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Keep regex fast-path? | **Yes.** Skip triage for obvious intents — saves ~200 tokens and ~300ms per request. |
| Triage model? | **Haiku.** Fast, cheap (~100 input + ~100 output tokens = ~$0.0001 per triage). |
| Analysis tool — forced or auto? | **Auto** (`tool_choice: auto`). Analysis needs free reasoning before structured output. |
| Fallback on triage failure? | **Old pipeline.** `classifyIntentWithFallback()` + `assembleContext()` + `callLlm()` — unchanged, always available. |
| Split prompts into files? | **Yes.** One file per action type. `buildSystemPrompt(actionType)` assembles the final prompt. |
| What about emotional signals? | Stage 1 triage doesn't detect emotions (too lean). Emotion detection runs in TypeScript (existing `checkEmotionalTone()`) between triage and Stage 2, same as today. |
| Who learns scope preferences? | **TypeScript**, deterministically. When user picks a clarification option, a rule is written to `feedbackMemory.rules`. The triage reads it on the next request. No LLM needed for learning. |
| When to skip clarification? | When data volume < 30, user said "all"/"everything", learned preference exists, or request is CRUD/fast-path. |
