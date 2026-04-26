# Chief Clarity v4 — Skill Registry

A skill is a folder. The system discovers and loads all skills at boot. Adding a new
skill requires no changes to the router, assembler, dispatcher, or executor.

---

## 1. Skill folder structure

```
src/skills/
  <skill-id>/
    manifest.json     # identity, routing hints, data policy, tools, model
    prompt.md         # specialist system prompt (the skill's "brain")
    context.ts        # declares what context this skill needs
    handlers.ts       # TypeScript functions that execute tool calls
```

Every file is required. The registry loader validates all four on boot and rejects
malformed skills with a startup warning (non-fatal — other skills still load).

---

## 2. manifest.json spec

```jsonc
{
  // Identity
  "id": "priority_planning",
  "version": "1.0.0",
  "description": "Helps the user decide what to focus on. Analyzes workload, objectives, and priorities and returns a ranked action plan.",

  // Routing hints — used by orchestrator embedding scorer
  // Write these as natural-language phrases users would actually say
  "triggerPhrases": [
    "what should I focus on",
    "help me prioritize",
    "which task is most important",
    "what should I do today",
    "I have too much on my plate"
  ],

  // Structural triggers — slash commands or button events that directly activate this skill
  "structuralTriggers": ["/plan", "/prioritize"],

  // Model — "haiku" for simple CRUD, "sonnet" for reasoning/planning
  "model": "sonnet",

  // Data access policy — references categories defined in data_schemas.json
  // Assembler enforces: skill only receives data from categories listed here
  "dataSchemas": {
    "read": ["tasks", "calendar", "objectives", "notes:work", "observations"],
    "write": ["priority_log", "tasks"]
  },

  // Attachment support
  "supportsAttachments": false,

  // Tools this skill can invoke — must match handler exports in handlers.ts
  "tools": [
    "submit_priority_ranking",
    "request_clarification",
    "create_task",
    "update_task_priority"
  ],

  // Self-evaluation
  "autoEvaluate": true,   // false to freeze this skill from the evaluator

  // Token budget (tokens allocated to this skill's context blob)
  "tokenBudget": 5000
}
```

---

## 3. prompt.md

Plain markdown. The system prompt for this specialist. Written as if briefing a
focused human expert. No boilerplate — every line earns its place.

```markdown
You are the Priority Planning specialist. Your job is to help the user decide
what to focus on given their current workload, objectives, and constraints.

You will receive:
- The user's request
- Their active tasks with deadlines and project associations
- Their stated objectives and priorities
- Relevant past notes and observations
- Any detected conflicts or flags

Rules:
- Always anchor recommendations to the user's stated objectives
- Family and health commitments take precedence over work unless explicitly overridden
- Surface trade-offs clearly — help the user decide, do not decide for them
- Keep output actionable: a ranked list with a one-line reason per item
- If data is insufficient, call request_clarification

Always respond using the submit_priority_ranking tool.
```

Guidelines for writing skill prompts:
- Under 300 words
- State the job, the inputs, the rules, and the expected tool call
- No example outputs (they anchor the model to specific formats)
- No mention of internal system names or file paths

---

## 4. context.ts spec

Declares what the Assembler should fetch. The Assembler resolves declarations
into actual data — the skill never fetches data directly.

```ts
import type { ContextRequirements } from "../../types";

export const contextRequirements: ContextRequirements = {
  // Always included (cached, $0)
  userProfile: true,
  objectives: true,

  // Recency-bounded queries
  recentTasks: { limit: 20, includeCompleted: false },
  recentNotes: { limit: 5, categories: ["work"] },
  calendarToday: true,
  calendarNextSevenDays: true,

  // Semantic memory — vector search against user phrase
  semanticMemory: { limit: 5, minSimilarity: 0.65 },

  // Conflict scan
  conflictScan: true,

  // Attachments — null if skill doesn't support them
  attachmentChunks: null,
};
```

The Assembler reads this file, fetches each declared source, applies the data schema
policy filter, and enforces the token budget. The skill's context.ts is never called
at runtime — it is read once at boot and cached.

---

## 5. handlers.ts spec

Exports one function per declared tool. Receives the LLM's structured args, performs
the action, returns a result. Writes go through `filesystem.ts` — never directly.

```ts
import { filesystem } from "../../modules/filesystem";
import type { ToolHandler } from "../../types";

export const submit_priority_ranking: ToolHandler = async (args, ctx) => {
  const { ranked, reasoning, topItem } = args;

  await filesystem.write("priority_log", {
    timestamp: new Date().toISOString(),
    ranked,
    reasoning,
    requestPhrase: ctx.userPhrase,
  });

  return {
    success: true,
    userMessage: `Your top priority is: ${topItem}. Here's the full ranking...`,
    data: { ranked },
  };
};

export const request_clarification: ToolHandler = async (args) => {
  return {
    success: true,
    clarificationRequired: true,
    userMessage: args.question,
  };
};
```

---

## 6. Adding a new skill — workflow

```
1. Create the folder
   src/skills/<new-skill-id>/

2. Write manifest.json
   - Choose a descriptive id (snake_case)
   - Write 5–10 triggerPhrases in natural language
   - Declare dataSchemas.read only for what the skill genuinely needs
   - List tools (match exports in handlers.ts)
   - Set model: "haiku" for simple, "sonnet" for reasoning

3. Write prompt.md
   - Job description, inputs, rules, tool instruction
   - Under 300 words

4. Write context.ts
   - Declare only what the prompt needs — no over-fetching

5. Write handlers.ts
   - One export per tool in manifest.json
   - All writes via filesystem.ts

6. Restart the app
   Registry auto-loads, orchestrator can now route to the new skill.
   No changes to router.ts, assembler.ts, llm.ts, or executor.ts.
```

---

## 7. Existing skills (migration targets)

Current intents in `src/llm.ts` that become skills in v4:

| Current intent | Skill id | Model | Notes |
|---|---|---|---|
| `full_planning` | `daily_planning` | sonnet | Morning plan, Focus Brief |
| `task_create` | `task_management` | haiku | CRUD, bulk input |
| `task_update` | `task_management` | haiku | Merged with task_create skill |
| `priority_ranking` | `priority_planning` | sonnet | Replaces inline priority logic |
| `emotional_checkin` | `emotional_checkin` | haiku | Low-stakes, Haiku sufficient |
| `inbox_triage` | `inbox_triage` | haiku | Structured triage |
| `calendar_schedule` | `calendar` | haiku | Scheduling + conflict check |
| `weekly_plan` | `weekly_planning` | sonnet | Once/week Sonnet call |
| `research_query` | `research` | sonnet | Web + internal sources |
| `notes_capture` | `notes` | haiku | Capture + tag |

Each migration is independent and non-breaking. Old intent code runs until the
corresponding skill folder is added, tested, and the old branch deleted.

---

## 8. Skill registry loader (boot sequence)

```
On app boot:
  1. Scan src/skills/ for directories
  2. For each: validate manifest.json schema, load context.ts, verify handlers.ts exports
  3. Embed each skill's description using bge-m3 → cache embedding
  4. Register in SkillRegistry (in-memory map: skillId → { manifest, contextReqs, handlers })
  5. Log: "Loaded N skills: [list of ids]"
  6. Any skill that fails validation → warning log, skill skipped (non-fatal)
```

Embedding happens once at boot per skill. Re-embedded only if manifest.json or
description changes (mtime check). Cache stored in `src/skills/.embedding_cache.json`
(gitignored).
