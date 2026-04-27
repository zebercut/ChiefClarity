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

  // Model — "haiku" for simple CRUD, "sonnet" for reasoning/planning.
  // Either a string (single tier) or an object with default + deep variants
  // selected at dispatch time via a tool arg (see modelSelector).
  "model": "sonnet",
  // Optional: minimum tier the evaluator may propose. Prevents auto-downgrade
  // for safety-bearing skills. Omit for normal skills.
  "minModelTier": null,

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
  "tokenBudget": 5000,

  // Locked prompt zones — text inside <!-- LOCKED:<name> --> blocks in prompt.md
  // is invisible to the Evaluator and Pattern Learner and cannot be modified
  // via Pending Improvements. Used for safety boundaries and clinical disclaimers.
  // Validated at boot — missing zones reject the skill.
  "promptLockedZones": [],

  // Optional UI surface contributed by this skill (vision principle #13).
  // The app shell renders nav from the registry — adding a surface here gives
  // the skill its own tab without editing the shell. Omit for skills that have
  // no dedicated surface (most skills route to chat output only).
  "surface": null
  //  e.g. {
  //    "id": "topics",                  // unique surface id
  //    "label": "Topics",                // nav label
  //    "icon": "tag",                    // icon name from app icon set
  //    "route": "/topics",               // app route
  //    "component": "ui/TopicsView.tsx", // React component path inside the skill folder
  //    "order": 50                       // sort order in nav (lower = earlier)
  //  }
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
| (new in v4) | `companion` | haiku/sonnet split | Emotional support, mood/friction sensors, locked safety zone — see `08_companion.md` |
| (new in v4) | `topics` | sonnet | Topic-scoped digest and queries; declares the Topics surface; works with TopicEmergence sensor and the executor auto-tag hook — see `10_topics.md` |

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

---

## 9. Locked prompt zones

Self-improvement (Channel A feedback, nightly Evaluator, Pattern Learner) can
propose patches to a skill's `prompt.md`. Without protection, an approved patch
could strip out safety guardrails. Locked zones prevent this.

### Syntax

In `prompt.md`, wrap protected text in HTML comments:

```markdown
<!-- LOCKED:safety_boundary — DO NOT EDIT. Auto-patcher must skip this block. -->
If the user expresses signals of self-harm, harm to others, or acute crisis...
<!-- /LOCKED -->
```

Declare the zone names in the manifest's `promptLockedZones` array.

### Enforcement

| Stage | Behavior |
|---|---|
| Boot | Loader verifies every name in `promptLockedZones` matches a `<!-- LOCKED:<name> -->` block. Mismatch → skill rejected. |
| Evaluator / Pattern Learner | Receive the prompt with locked blocks elided (replaced by `<!-- LOCKED:<name> [REDACTED] -->`). They cannot see the text and cannot propose diffs touching it. |
| Pending Improvements | Patches whose target line range overlaps a locked block are rejected at queue insertion time, with reason logged. |
| Self-test on patch approval | Post-apply scan re-validates all locked zones still exist with their original content (hash compared). Drift → patch reverted, alert raised. |

### Tier floor

`minModelTier` similarly prevents the Evaluator from proposing model downgrades
(`sonnet → haiku`) for safety-bearing skills.

These mechanisms apply to any skill — not just `companion`. Future sensitive
skills (e.g., medical, financial) should declare locked zones for any prompt text
that must remain stable across self-improvement cycles.

---

## 10. Declarative UI surfaces

Per vision principle #13, surfaces are pluggable. A skill may register one UI
surface in its manifest (`surface` field, see §2). The skill loader collects all
non-null surfaces at boot and exposes them to the app shell, which renders the
navigation from the registry.

### Boot-time collection

```ts
On boot, after all skills loaded:
  surfaces = registry.getAllSkills()
    .map(s => s.manifest.surface)
    .filter(s => s !== null)
    .sort((a, b) => a.order - b.order);
  shell.registerSurfaces(surfaces);
```

### Constraints

- **One surface per skill.** Skills do not register multiple surfaces. If a domain
  needs two views (e.g., a "Topics" tab and a "Topic Insights" panel), it splits
  into two skills or one skill + an attachment surface.
- **Surface routes are namespaced.** The shell prefixes the route with the skill
  id (`/topics` becomes `/skills/topics`) to prevent collision with shell-owned
  routes (`/chat`, `/settings`, etc.).
- **Surfaces have no privileged data access.** A surface renders against the
  same Data Schema Registry as the skill itself — the surface uses the skill's
  declared `dataSchemas.read` and gets the same audit log entry per read.

### Core (shell-owned) vs. skill-contributed surfaces

| Type | Owner | Examples |
|---|---|---|
| Shell-owned | App shell, fixed | Chat, Daily Focus, Settings, Pending Improvements |
| Skill-contributed | Declared in skill manifest | Topics (from `topics` skill), Companion panel (from `companion` skill, Phase 8) |

Tasks, Notes, Calendar surfaces are currently shell-owned but should migrate to
their respective skills (`task_management`, `notes`, `calendar`) as part of the
Phase 2 skill migration. This is tracked in `09_dev_plan.md`.
