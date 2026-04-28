# AI Personal Organizer — TypeScript/Expo Specification

> **Scope:** this document describes the *current* implementation (v2 — single-agent, JSON-file-based).
> **Target architecture:** see [architecture_v3_multi_agent.md](architecture_v3_multi_agent.md) for the multi-agent, multi-LLM, SQLite-backed evolution aligned with [vision.md](vision.md). As v3 components ship, update both files.
>
> **Platform**: iOS + Android (primary) via Expo + Capacitor. Desktop via Electron (Phase 5).
> **No backend. No server. No database. All state lives in JSON files on the device.**

---

## 1. Guiding Philosophy

This is a **native AI app** — not a script that calls an API.

- **TypeScript owns**: routing, state, file I/O, conflict detection, writes, summarizing, token budget enforcement
- **LLM owns**: language understanding, judgment, semantic reasoning, suggestions, natural language reply
- Neither trespasses into the other's domain
- The LLM always returns **structured JSON via tool use** — TypeScript executes the plan
- All data lives locally on the device — Capacitor Filesystem for mobile, Node `fs` for desktop

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| UI framework | React Native via Expo (managed workflow) |
| Language | TypeScript (strict mode) |
| Mobile packaging | Capacitor |
| File storage | Capacitor Filesystem plugin (mobile) / Node fs (Electron) |
| LLM | Anthropic TypeScript SDK — tool use |
| Desktop | Electron (Phase 5 — wraps the same Expo app) |
| Navigation | Expo Router |
| State | React hooks only — no Redux, no Zustand |

---

## 3. Project Structure

```
organizer/
├── app/
│   ├── index.tsx              # Main chat screen
│   ├── (tabs)/                # Tab-based navigation (chat, focus, tasks)
│   │   ├── tasks.tsx          # Tasks tab — full backlog with search, group, filter (FEAT028)
│   │   ├── topics.tsx         # Topics list page — search, pagination, topic cards (FEAT023)
│   │   └── topic-detail.tsx   # Topic detail page — tasks, events, OKR links, insights, notes (FEAT023)
│   └── _layout.tsx            # Expo Router root layout
├── src/
│   ├── modules/
│   │   ├── router.ts          # Intent classification (regex-first, LLM fallback)
│   │   ├── assembler.ts       # Context builder — slices state by intent, enforces token budget
│   │   ├── llm.ts             # Anthropic SDK call via tool use
│   │   ├── executor.ts        # Validates + applies writes to in-memory state
│   │   ├── conflict.ts        # Rule-based conflict/duplicate detection
│   │   ├── summarizer.ts      # Rebuilds summaries, hot_context, contradiction_index, OKR rollup
│   │   ├── companion.ts       # Emotional tone detection + behavioral support
│   │   ├── taskPrioritizer.ts # Pure deterministic task sort — shared by Focus Brief and Tasks tab (FEAT028)
│   │   ├── taskFilters.ts     # Pure helpers: filterTasks, groupTasks, searchTasks, dueBucketOf (FEAT028)
│   │   └── loader.ts          # Reads all JSON files into RAM at startup
│   ├── components/
│   │   ├── TaskListItem.tsx   # Tasks tab row component (FEAT028)
│   │   ├── TaskFilterBar.tsx  # Tasks tab active-filter chip bar (FEAT028)
│   │   └── topics/
│   │       ├── TopicCard.tsx          # Topic list card component (FEAT023)
│   │       └── TopicSuggestionCard.tsx # Topic suggestion card (FEAT023)
│   ├── types/
│   │   └── index.ts           # All shared TypeScript interfaces
│   ├── constants/
│   │   └── prompts.ts         # LLM system prompt string
│   └── utils/
│       ├── filesystem.ts      # Capacitor/Node filesystem abstraction
│       ├── crypto.ts          # AES-256-GCM encryption at rest (FEAT021)
│       └── config.ts          # AppConfig helpers + secure store passphrase management
├── data/                      # JSON files — created by initData() on first run
│   ├── hot_context.json
│   ├── summaries.json
│   ├── tasks.json
│   ├── calendar.json
│   ├── user_profile.json
│   ├── user_lifestyle.json
│   ├── user_observations.json
│   ├── context_memory.json
│   ├── feedback_memory.json
│   ├── content_index.json
│   ├── contradiction_index.json
│   ├── suggestions_log.json
│   ├── learning_log.json
│   └── plan/
│       ├── plan_narrative.json
│       ├── plan_agenda.json
│       ├── plan_risks.json
│       ├── plan_okr_dashboard.json
│       └── focus_brief.json
├── scripts/
│   ├── headless-runner.js     # Long-running Node cron scheduler
│   ├── api-proxy.js           # Local API proxy for mobile
│   └── migrate-encryption.ts  # CLI: --encrypt / --decrypt existing data files (FEAT021)
├── topics/
│       ├── _manifest.json
│       └── {topic-slug}.md
└── package.json
```

---

## 4. Data File Architecture

### User Data (3-file split)

User data is split by volatility and purpose:

| File | Purpose | Updated by | Frequency |
|---|---|---|---|
| `user_profile.json` | Identity: name, timezone, location, family members | LLM (rare) | Rarely |
| `user_lifestyle.json` | Schedule, routines, work windows, preferences | LLM when user states new routines | Occasionally |
| `user_observations.json` | Learned patterns: work style, communication style, task completion patterns, emotional state, goals | LLM + companion module | Accumulates over time |

### OKR Dashboard

`plan/plan_okr_dashboard.json` is the **single source of truth** for objectives and key results.

- Each objective contains nested key results with progress (0-100), metrics, and targets
- Each objective holds up to 5 recent decisions (older ones pushed to `contextMemory`)
- Tasks link to KRs via the `okrLink` field in `tasks.json` (referencing a KR id like `kr_2_4`)
- **LLM** sets KR `progress` and `current` values when tasks are completed or user reports status
- **Summarizer** auto-rolls up KR averages into objective-level `progress` each turn

### Operational Files

| File | Purpose |
|---|---|
| `hot_context.json` | Quick-access snapshot: top 3 tasks, next event, OKR snapshot, counts |
| `summaries.json` | One-line summaries of each data file for token-efficient context |
| `tasks.json` | All tasks with priority, status, due dates, OKR links |
| `calendar.json` | All calendar events |
| `context_memory.json` | Long-term patterns, facts, recent events |
| `feedback_memory.json` | User preferences, behavioral signals, corrections |
| `content_index.json` | Entity index for info lookups |
| `contradiction_index.json` | Date/topic/OKR cross-reference for conflict detection |
| `suggestions_log.json` | Suggestion history with action tracking |
| `learning_log.json` | Learning items with spaced repetition |
| `focus_brief.json` | Structured daily/weekly focus brief for the dashboard (includes companion section) |
| `focus_brief.html` | Styled HTML render of the focus brief for Google Drive / mobile reading |
| `topics/_manifest.json` | Topic registry — active topics, pending suggestions, rejected topics, cross-source signals |
| `topics/{slug}.md` | Per-topic markdown file — notes, knowledge, references, decisions |
| `chat_history.json` | Persisted chat messages (last 200) |
| `inbox.txt` | Bulk input file — user dumps text from any device, app processes on next launch/focus |
| `nudges.json` | Proactive nudge queue — written by headless runner, read by app |
| `proactive_state.json` | Cooldown tracking for proactive checks (per-task, per-KR nudge dates) |
| `recurring_tasks.json` | Recurring task rules — daily, weekly, weekday schedules with optional times |
| `annotations.json` | User annotations on Focus Brief cards — comments, quick actions, resolved state |

---

## 5. TypeScript Interfaces — `src/types/index.ts`

### Core State

```typescript
export interface AppState {
  hotContext:         HotContext;
  summaries:          Summaries;
  tasks:              TasksFile;
  calendar:           CalendarFile;
  contextMemory:      ContextMemory;
  feedbackMemory:     FeedbackMemory;
  contentIndex:       ContentIndex;
  contradictionIndex: ContradictionIndex;
  suggestionsLog:     SuggestionsLog;
  learningLog:        LearningLog;
  userProfile:        UserProfile;
  userLifestyle:      UserLifestyle;
  userObservations:   UserObservations;
  planNarrative:      PlanNarrative;
  planAgenda:         PlanAgenda;
  planRisks:          PlanRisks;
  planOkrDashboard:   PlanOkrDashboard;
  focusBrief:         FocusBrief;
  _dirty:             Set<FileKey>;
  _pendingContext:    IntentResult | null;
}

export type FileKey =
  | "hotContext" | "summaries" | "tasks" | "calendar"
  | "contextMemory" | "feedbackMemory" | "contentIndex"
  | "contradictionIndex" | "suggestionsLog" | "learningLog"
  | "userProfile" | "userLifestyle" | "userObservations"
  | "planNarrative" | "planAgenda" | "planRisks"
  | "planOkrDashboard" | "focusBrief";
```

### User Data Types

```typescript
export interface UserProfile {
  name:         string;
  timezone:     string;
  location:     string;
  language:     string;
  familyMembers: { abbreviation: string; name?: string; relation: string }[];
}

export interface UserLifestyle {
  sleepWake: { wake: string; sleep: string };
  weekdaySchedule: {
    time: string;
    activity: string;
    type: "fixed" | "flexible" | "preferred";
    days?: string[];
  }[];
  weekendSchedule: {
    capacity: string;
    saturday: string;
    sunday: string;
    notes: string;
  };
  weekStartsOn: string;
  availableWorkWindows: { label: string; time: string; notes: string }[];
  preferences: Record<string, unknown>;
}

export interface UserObservations {
  workStyle:              { observation: string; firstSeen: string; confidence?: number }[];
  communicationStyle:     { observation: string; firstSeen: string }[];
  taskCompletionPatterns: { category: string; pattern: string; firstSeen: string }[];
  emotionalState:         { observation: string; date: string }[];
  goalsContext: {
    primaryGoal: string;
    secondaryGoals: string[];
    financialPressure: string;
    lastUpdated: string;
  };
}
```

### OKR Types

```typescript
export interface OkrKeyResult {
  id:       string;
  title:    string;
  metric:   string;
  target:   string;
  current:  string | number | null;
  progress: number; // 0-100
}

export interface OkrDecision {
  date:    string;
  summary: string;
}

export interface OkrObjective {
  id:         string;
  title:      string;
  status:     "active" | "parked" | "completed";
  progress:   number; // 0-100, auto-rolled up from KR averages
  keyResults: OkrKeyResult[];
  decisions:  OkrDecision[]; // last 5 kept, older pushed to contextMemory
}

export interface PlanOkrDashboard {
  focusPeriod: { start: string; end: string };
  objectives:  OkrObjective[];
}
```

### Companion Brief (in FocusBrief)

```typescript
export interface CompanionBrief {
  energyRead: "low" | "medium" | "high";
  mood: string;
  motivationNote: string;
  patternsToWatch: PatternWarning[];
  copingSuggestion: string;
  wins: string[];
  focusMantra: string;
}

export interface PatternWarning {
  pattern: string;
  risk: "high" | "medium" | "low";
  suggestion: string;
}
```

### AppConfig (encryption settings)

```typescript
export interface AppConfig {
  // ... existing fields ...
  encryptionEnabled?:      boolean;   // FEAT021: enable encryption at rest
  encryptionSalt?:         string;    // FEAT021: PBKDF2 salt (base64), one per install
  passphraseInSecureStore?: boolean;  // FEAT021: auto-unlock via platform secure store
}
```

### Topic-Aware Planning Types (FEAT023)

```typescript
/** Assembler builds this for full_planning — cross-references topics to tasks/events/OKRs */
export interface TopicCrossRef {
  topic:     string;   // slug
  name:      string;   // display name
  taskIds:   string[];
  eventIds:  string[];
  okrLinks:  string[]; // KR ids linked via tasks
}

/** LLM emits these in focus brief — per-topic digest for the dashboard */
export interface TopicDigestItem {
  topic:         string;   // slug
  name:          string;
  items:         string[]; // human-readable bullet points
  okrConnection?: string;  // which OKR this topic relates to
  newInsights?:  string;   // new insight surfaced during planning
}

// Added to FocusBrief:
// topicDigest?: TopicDigestItem[]  — optional, populated when topics exist
```

### Intent & Action Plan

```typescript
export type IntentType =
  | "task_create" | "task_update" | "task_query"
  | "calendar_create" | "calendar_update" | "calendar_query"
  | "okr_update" | "full_planning" | "info_lookup"
  | "learning" | "emotional_checkin" | "feedback"
  | "suggestion_request" | "general";

export interface ActionPlan {
  reply:               string;
  writes:              WriteOperation[];
  conflictsToCheck:    string[];
  suggestions:         string[];
  memorySignals:       MemorySignal[];
  needsClarification:  boolean;
}

export interface WriteOperation {
  file:    FileKey;
  action:  "add" | "update" | "delete";
  id?:     string;
  data:    Record<string, unknown>;
}
```

---

## 6. Module Responsibilities

### Data Flow (per user turn)

```
User Input
    |
router.classifyIntent()       [regex patterns + Haiku fallback]
    |
companion.checkEmotionalTone() [detect stress/energy/friction]
    |
assembler.assembleContext()    [slice AppState by intent, enforce token budget]
    |
llm.callLlm()                 [sends JSON context + system prompt + tool schema]
    |
executor.applyWrites()        [validates conflicts, applies add/update/delete, flushes to disk]
    |
summarizer.updateSummaries()  [rebuild summaries, OKR rollup]
summarizer.rebuildHotContext() [rebuild hot snapshot, OKR snapshot string]
summarizer.rebuildContradictionIndex() [rebuild date/topic/OKR index]
```

### Module Details

| Module | Reads | Writes | Special handling |
|---|---|---|---|
| **loader.ts** | All JSON files from disk | In-memory AppState | Parallel file reads at startup |
| **router.ts** | User phrase | IntentResult | Regex-first, Haiku LLM fallback |
| **assembler.ts** | AppState (filtered by intent) | JSON context for LLM | Token budget enforcement, intent-specific slicing |
| **llm.ts** | Context JSON | ActionPlan | Tool use with file enum constraint, model selection by intent |
| **executor.ts** | ActionPlan + AppState | Modified AppState + JSON files | Nested OKR writes, user data file handling, conflict checking |
| **conflict.ts** | AppState + WriteOperations | Conflict strings | Time overlap + duplicate title detection |
| **summarizer.ts** | AppState | Updated summaries + hotContext + contradictionIndex | KR-to-objective progress rollup |
| **companion.ts** | User phrase + AppState | CompanionOutput + CompanionContext | Regex emotional detection, friction signals, companion context builder for planning |
| **agendaMerger.ts** | FocusBrief | CalendarSlot[] | Merges routineTemplate + day exceptions into full agenda, recalculates free blocks |
| **briefPatcher.ts** | WriteOperation[] + AppState | Patched FocusBrief | FEAT045 Tier 1: instant TypeScript patches — mark done, add event, recalc freeBlocks, track _changelog. No LLM. |
| **briefRefresher.ts** | AppState + _changelog | Updated narrative fields | FEAT045 Tier 2: Haiku mini-refresh of executiveSummary, priorities, risks, companion. Triggered after 3+ patches. |
| **briefDelta.ts** | AppState | BriefDelta / replan context | FEAT045 Tier 3: builds delta for delta-aware replanning. `needsFullReplan()` guards structural calendar changes. |
| **briefRenderer.ts** | FocusBrief | focus_brief.html | Renders brief to styled HTML for Google Drive / mobile reading |
| **chatHistory.ts** | ChatMessage[] | chat_history.json | Persists and loads chat messages across sessions |
| **inbox.ts** | inbox.txt (raw text) | ActionPlan writes via LLM | Detects, chunks, processes bulk input. Stability check for cloud sync. Clears after processing. |
| **proactiveEngine.ts** | AppState | Nudge[] | Pure condition checks: overdue, stalled, OKR pace, events, learning, suggestions, plan staleness. No LLM. |
| **nudges.ts** | nudges.json | nudges.json | Read/write/dedup nudges. Cooldown tracking. Max 3 per session. |
| **annotations.ts** | annotations.json | annotations.json + tasks/calendar (direct actions) | Card-level comments/actions. Immediate execution for "done"/"cancel"/"delete". Batch processing via LLM. |
| **smartActions.ts** | LLM suggestions + AppState | SmartAction[] + WriteSummary[] | Type-detects suggestions, builds write summaries, executes direct actions (mark done, reschedule, delete). |
| **recurringProcessor.ts** | recurringTasks + tasks + calendar | tasks.json + calendar.json | Creates daily task/event instances from recurring rules. Dedup by ID+date. |
| **calendarHygiene.ts** | AppState (calendar) | calendar.json | Daily: archives past events, cleans recurring instances. Weekly: removes old cancelled/archived, deduplicates. |
| **topicManager.ts** | TopicManifest, Fact[], AppState | topics/_manifest.json, topics/{slug}.md | Slugify topic names, read/write topic files, extract hints, count suggestions, migrate facts to topics. `buildTopicCrossRef()` builds TopicCrossRef[] for planning (cross-references topics to tasks/events/OKRs via signals + name matching). `updateTopicPagesFromBrief()` updates topic markdown Dashboard section after planning with digest items. |
| **taskPrioritizer.ts** | Task[] + today (YYYY-MM-DD) | Sorted Task[] | Pure deterministic sort: overdue first → priority enum → due date asc. Filters out done. Shared by Focus Brief (`assembler.buildTaskIndex`) and Tasks tab. (FEAT028) |
| **taskFilters.ts** | Task[] + filters/groupBy/query + today | Filtered/grouped Task[] | Pure helpers for the Tasks tab: `filterTasks` (AND logic), `searchTasks` (case-insensitive substring), `groupTasks` (status / dueBucket / category / none), `dueBucketOf`. (FEAT028) |
| **crypto.ts** | File bytes, cached key | Encrypted/decrypted bytes | AES-256-GCM, PBKDF2 SHA-512 (600k iter). Platform-aware: Node `crypto` or WebCrypto. Key cached in memory, never on disk. |
| **config.ts** | AppConfig, secure store | AppConfig, secure store | `loadPassphrase`/`savePassphrase`/`clearPassphrase` for platform secure store. |

### Executor Write Patterns

The executor handles different file types with specific strategies:

| File type | Add behavior | Update behavior |
|---|---|---|
| **Array-based** (tasks, calendar, suggestions, learning) | Auto-generate `id` + `createdAt`, push to array | Find by `id` in array, merge fields |
| **userProfile** | Merge fields (no id/createdAt) | Merge fields |
| **userLifestyle** | Merge sections | Deep merge for preferences, shallow merge for rest |
| **userObservations** | `_arrayKey` specifies target array; `goalsContext` merges as object | `_arrayKey` + id match for arrays; `goalsContext` merges directly |
| **planOkrDashboard** | `_targetObjective` adds KR; `_addDecision` adds decision (capped at 5); default adds objective | Find by id across objectives and KRs |
| **focusBrief** | Whole-file replace | N/A |

### Assembler Context by Intent

| Intent | Base context | Additional data |
|---|---|---|
| All intents | phrase, intent, today, weekday, userName, okrSnapshot, summaries, userPreferences, userProfile, userLifestyle (summary), conversationSummary | |
| `task_*` | | Task index, contradiction dates |
| `calendar_*` | | Calendar events, contradiction dates |
| `full_planning` | | Full tasks, calendar, OKR dashboard + linked tasks, context memory, observations, full schedule, previous brief, topicCrossRef (topic-to-task/event/OKR mapping via signals + name matching) |
| `okr_update` | | OKR dashboard, linked tasks, goals context |
| `suggestion_request` | | Suggestions log, task index, OKR dashboard, work style, task completion patterns |
| `emotional_checkin` | | Recent events, behavioral signals, emotional state history, communication style |
| `general` | | Goals context, communication style |
| `feedback` | | Full feedback memory |
| `info_lookup` | | Content index |
| `learning` | | Learning log |
| `bulk_input` | | Task index, calendar events, OKR dashboard, goals context, contradiction dates, lifestyle summary |
| `topic_query` | | Topic file content, topic facts, task index |
| `topic_note` | | Topic manifest, pending suggestions |

**All intents** also receive `topicList` (existing topic names + aliases) and `existingTopicHints` (topic hints from facts) in base context.

---

## 7. OKR System Design

### Data Model

```
PlanOkrDashboard
  └── focusPeriod: { start, end }
  └── objectives[]
        ├── id, title, status, progress (auto-calculated)
        ├── keyResults[]
        │     └── id, title, metric, target, current, progress (LLM-set)
        └── decisions[] (last 5)
              └── date, summary
```

### Progress Flow

1. User completes a task linked to a KR (via `okrLink` in tasks.json)
2. LLM detects the completion and updates the KR's `current` and `progress` fields
3. Summarizer recalculates objective `progress` as the average of its KR progress values
4. Summarizer generates OKR snapshot string for hotContext
5. If progress values changed, `planOkrDashboard` is marked dirty and flushed to disk

### Write Operations

```
Add objective:    { file: "planOkrDashboard", action: "add", data: { id, title, status, keyResults: [], decisions: [] } }
Add KR:           { file: "planOkrDashboard", action: "add", data: { _targetObjective: "obj_1", id, title, metric, target, current, progress } }
Add decision:     { file: "planOkrDashboard", action: "add", data: { _addDecision: "obj_1", date, summary } }
Update KR:        { file: "planOkrDashboard", action: "update", id: "kr_2_4", data: { current: "...", progress: 30 } }
Update objective: { file: "planOkrDashboard", action: "update", id: "obj_5", data: { status: "parked" } }
Delete:           { file: "planOkrDashboard", action: "delete", id: "obj_4" }
```

---

## 8. LLM Integration

### Tool Schema

The LLM is constrained to respond via the `submit_action_plan` tool. The `file` field is restricted to a strict enum of valid FileKey values to prevent hallucinated file names.

### Model Selection (FEAT022)

Two-tier routing: Sonnet for complex intents that need judgment and large structured output, Haiku for simple CRUD. If Haiku's output fails validation, the system automatically retries once with Sonnet before giving up. Model IDs are configurable via env vars (`LLM_MODEL_HEAVY`, `LLM_MODEL_LIGHT`) — update `.env` when models are deprecated, no code change needed.

| Intent | Model | Rationale |
|---|---|---|
| `full_planning` | Sonnet (heavy) | Complex nested focusBrief, companion section, overlap/travel rules |
| `suggestion_request` | Sonnet (heavy) | Nuanced judgment, checks suggestionsLog history |
| `emotional_checkin` | Sonnet (heavy) | Empathy quality matters, cost difference negligible |
| `bulk_input` | Sonnet (heavy) | Parses freeform multi-item input, must not miss items |
| All others (13 intents) | Haiku (light) | Simple CRUD writes, short replies. Sonnet fallback on validation failure |

### Token Budget Reference

| Intent | Budget | Key data included |
|---|---|---|
| `task_*` | 800 | Task index + contradiction dates |
| `calendar_*` | 800 | Calendar events + contradiction dates |
| `emotional_checkin` | 800 | Recent events + behavioral signals + emotional state + communication style |
| `feedback` | 600 | Full feedback memory |
| `general` | 1000 | Goals context + communication style |
| `okr_update` | 1200 | OKR dashboard + linked tasks + goals context |
| `learning` | 1200 | Learning log |
| `info_lookup` | 1500 | Content index |
| `suggestion_request` | 1500 | Suggestions log + task index + OKR dashboard + work style + task patterns |
| `full_planning` | 4000 | Full tasks + calendar + OKR + observations + schedule + context memory |
| `bulk_input` | 4500 | Task index + calendar + OKR + goals + contradiction dates + lifestyle summary |
| `topic_query` | 3000 | Topic file content + topic facts + task index |
| `topic_note` | 800 | Topic manifest + pending suggestions |

---

## 9. Architecture Decision Record

### Why TypeScript instead of Python
Python cannot run on iOS or Android. Mobile is the primary channel. TypeScript runs natively in Expo/React Native on both platforms and compiles to a desktop app via Electron.

### Why user data is split into 3 files
Identity (profile) rarely changes. Lifestyle (schedule, preferences) changes occasionally. Observations (patterns, goals) accumulate over time. Mixing them in one file causes data loss during migrations and makes updates fragile.

### Why OKR lives in planOkrDashboard (not a separate file)
A separate `okrs.json` would create a sync problem with the existing dashboard. One file = one source of truth. The summarizer computes progress rollups in place.

### Why tasks are not embedded in OKRs
V1 embedded tasks inside OKR markdown, causing duplication. V2 links tasks to KRs via `okrLink` — the assembler joins them at query time.

### Why decisions are capped at 5 per objective
Decision history is useful context for planning but grows unbounded. Capping at 5 keeps the OKR file lean. Older decisions naturally flow into `contextMemory`.

### Why the executor clones data before mutation
The LLM's ActionPlan data objects must not be mutated in place. Different file types need different field injection (e.g., `id`/`createdAt` for array items but not for profile merges). Cloning prevents cross-contamination.

### Why no backend, no server, no database
The app is personal and local. Every phrase, task, and calendar event is private. A server adds infrastructure cost, latency, and a privacy surface. The only outbound call is to the Anthropic API per phrase.

### Why tool use instead of raw JSON prompting
Tool use guarantees the LLM response matches the defined schema. Raw JSON prompting is unreliable. The `file` enum constraint further prevents hallucinated file names.

### Why summaries at write time not read time
Summaries are rebuilt once per write. Every subsequent read is instant and cheap. Raw files are the audit log — they are never passed whole into the LLM context.

### Why companion is regex-based not a second LLM call
Emotional detection runs after every phrase. A second LLM call per phrase would double cost and latency. Regex patterns catch 90% of emotional signals correctly in <1ms.

### Why bulk input uses a plain .txt file, not JSON or a chat command
The inbox is edited from other devices (phone, laptop) via Google Drive. `.txt` is the simplest format to type on any device — no brackets, no schema, no formatting. The LLM is best-in-class at parsing unstructured text, so we let it handle structure extraction. The file is cleared (not archived) after processing because the writes themselves are the archive.

### Why bulk_input is a separate intent, not routed through general
Bulk input needs a different context assembly (task index + calendar + OKR for duplicate detection), a different token budget (4500 vs 1000), and different prompt instructions (parse everything, don't ask clarifications). Routing it through `general` would either starve it of context or require special-casing in the assembler that's cleaner as a dedicated intent.

### Why Haiku for simple intents with Sonnet fallback (FEAT022)
Simple CRUD intents (task_create, task_update, feedback, etc.) produce 1-2 writes and a short reply. Haiku 4.5 handles this reliably at 67% lower cost ($1/$5 vs $3/$15 per MTok). If Haiku's output fails `validateActionPlan`, the system retries once with Sonnet — a planned escalation that does not count toward the circuit breaker. `emotional_checkin` stays on Sonnet despite small output because empathy quality directly impacts user trust and the cost saving is negligible (~$0.00075/call).

### Why the circuit breaker exists
API failures (auth, rate limit, zero credit) previously caused infinite retry loops — 98 consecutive "Plan my day" calls in one session, each burning input tokens. The circuit breaker trips after 3 consecutive failures, pauses all LLM calls for 30 minutes, and shows the user a "Resume" button. The Haiku→Sonnet fallback is exempt because it is a quality escalation, not a failure.

### Why encryption at rest with AES-256-GCM and PBKDF2 (FEAT021)
All user data is highly personal (tasks, calendar, observations, goals). On shared or lost devices, plaintext JSON files are a liability. AES-256-GCM provides authenticated encryption (integrity + confidentiality). PBKDF2 with SHA-512 and 600,000 iterations makes brute-force impractical. A single salt per install lives in AppConfig; a random 12-byte IV per file write prevents ciphertext analysis across files.

### Why encrypted files keep the .json extension (FEAT021)
Changing extensions would break every import, path constant, and tool that references data files. Instead, `isEncryptedBuffer()` detects the format by inspecting the first byte — JSON always starts with `{` or `[`, encrypted files start with a random IV byte. This makes encryption fully transparent to all modules above `filesystem.ts`.

### Why the encryption key is cached in memory, never written to disk (FEAT021)
Writing the derived key to disk would defeat the purpose of encryption. The key is derived from the passphrase once per session via `deriveKey()` and held in a module-scoped variable. On app close or `clearKey()`, it is gone. The optional secure-store path (`passphraseInSecureStore`) uses the platform keychain (iOS Keychain / Android Keystore) for auto-unlock — the OS protects it with biometrics or device PIN, which is a different trust model than plaintext on the filesystem.

### Why filesystem.ts wraps encrypt/decrypt transparently (FEAT021)
Encryption must be invisible to every module that reads or writes data. Putting the gate (`isEncryptionEnabled() && isSensitiveFile(path)`) inside `readJsonFile`/`writeJsonFile`/`readTextFile`/`writeTextFile` means no other module needs to know encryption exists. This preserves the sacred boundary: only `filesystem.ts` and `crypto.ts` touch bytes.

### Why migration is a separate CLI script (FEAT021)
Encrypting or decrypting all files is a one-time bulk operation that should not run inside the app's normal flow. `scripts/migrate-encryption.ts` handles `--encrypt` and `--decrypt`, tracks progress in `.migration-state.json` for crash recovery, and uses atomic per-file writes. Passphrase change is deferred to post-MVP.

---

## 10. Extension Points

**New intent**: Add pattern to `router.ts` PATTERNS, budget to TOKEN_BUDGETS, assembly case to `assembler.ts` switch, instructions to `prompts.ts`, optional model override in `llm.ts`.

**New data file**: Add interface to `types/index.ts`, key to `AppState` + `FileKey`, default to `loader.ts` DEFAULTS, path to FILE_MAP, file enum entry in `llm.ts` tool schema, flush case in `executor.ts`, summary field in `summarizer.ts`.

**Multi-turn clarification**: Built-in. `needsClarification: true` stashes current intent in `state._pendingContext`. Next phrase inherits that intent.

**Companion upgrade**: For high-severity emotional signals, `companion.ts` can escalate to a full LLM call. The default path stays regex-only.

**Cloud sync (future)**: Swap `filesystem.ts` read/write to call a sync API. All modules remain unchanged.

---

## 11. Build Order

| Phase | Module | Dependencies | Test |
|---|---|---|---|
| 1 | `router.ts` | None | Unit test: classify sample phrases |
| 2 | `summarizer.ts` | Types only | Unit test: feed mock state, verify output |
| 3 | `conflict.ts` | Types only | Unit test: overlapping dates return conflicts |
| 4 | `executor.ts` | conflict, filesystem | Integration test: add task, OKR write, verify files |
| 5 | `assembler.ts` | router, types | Unit test: each intent returns correct context keys |
| 6 | `llm.ts` | assembler, prompts | Integration test: send phrase, receive valid ActionPlan |
| 7 | `loader.ts` | filesystem | Integration test: load all files, verify state shape |
| 8 | `companion.ts` | types | Unit test: emotional phrases return correct signals |
| 9 | `app/index.tsx` | all modules | E2E test on device: full conversation loop |
| 10 | Electron wrap | all modules | Smoke test: desktop app opens and responds |

---

## 12. Feature Catalog

### Task Management
- Create tasks with priority, due date, category, and OKR links
- Update task status, priority, due date, or notes
- Delete tasks
- Query tasks by status, priority, or category
- Automatic conflict detection (time overlap, duplicate titles)
- Task index sorted by overdue → priority → due date (shared `taskPrioritizer` module)
- **Tasks tab (FEAT028)** — dedicated tab surfacing every task in `tasks.json` with case-insensitive search across title/notes/category/subcategory, AND-logic filters (status, priority, category, due bucket, include-done), grouping (none / status / due bucket / category), and a read-only detail sheet. Group + filter prefs persist via AsyncStorage. Same prioritization as Focus Brief.

### Calendar Management
- Create calendar events with date, time, duration, and type
- Update events (reschedule, cancel, modify)
- Query schedule by date range
- Time overlap detection with existing events and tasks

### OKR / Goal Tracking
- Create and manage objectives with status (active, parked, completed)
- Add key results to objectives with metrics, targets, and progress
- Track KR progress (0-100) updated by LLM when tasks complete
- Automatic objective progress rollup from KR averages
- Decision logging per objective (capped at 5, older to context memory)
- Link tasks to key results via `okrLink`
- OKR snapshot in hot context for quick reference

### Focus Planning
- Generate daily, weekly, or tomorrow focus briefs
- Structured output: executive summary, calendar slots, ranked priorities, risks, OKR snapshot
- Plan variant detection from natural language
- Previous brief context for continuity

### User Profile & Lifestyle
- Store identity (name, timezone, location, family)
- Define weekday/weekend schedules with fixed/flexible/preferred time slots
- Track available work windows
- Store preferences (exercise time, deep work windows, admin hours, etc.)
- Week start day configuration
- Weekend capacity rules

### Behavioral Observations
- Track work style patterns with confidence scores
- Record communication style preferences
- Log task completion patterns by category
- Monitor emotional state over time
- Maintain goals context (primary/secondary goals, financial context)

### Emotional Support (Companion)
- Regex-based emotional tone detection (stressed, frustrated, low energy, positive, anxious, venting)
- Friction signal detection (overdue pile, task overload)
- Energy level estimation
- Contextual support notes based on detected state
- **Companion Brief** in Focus Dashboard (generated by LLM during planning):
  - Energy read + mood assessment based on behavioral observations
  - Personalized motivation note referencing real context (wins, challenges, goals)
  - Behavioral patterns to watch with risk levels and suggestions
  - One actionable coping/focus strategy
  - Recent wins celebration (from completed tasks)
  - Focus mantra for the day/week
- Companion context builder (`buildCompanionContext`) gathers: emotional history, work patterns, task completion patterns, goals, recent wins, overdue pressure, communication style
- TypeScript gathers data; LLM generates the psychological support content

### Chat History
- Chat messages persisted to `chat_history.json` (last 200 messages)
- Previous messages loaded on app startup
- Up/Down arrow key navigation through input history (web)
- Conversation context rebuilt from history for multi-turn continuity

### Bulk Input (Inbox)
- `inbox.txt` in data folder — plain text, editable from any device via Google Drive
- Detected on app launch, tab focus, and after each chat turn
- Stability check (two reads, 500ms apart) handles Google Drive sync
- Large text auto-chunked at paragraph boundaries (~3000 tokens per chunk)
- LLM parses raw text into structured writes: tasks, events, profile updates, OKR progress, observations
- File cleared after processing; new content added during processing is preserved
- Summary injected as chat message ("Processed inbox: created N tasks...")
- "Inbox ready" status chip shown when content detected but not yet processed

### Proactive Engine & Nudges
- **proactiveEngine.ts**: Pure TypeScript condition checks — no LLM calls, zero API cost
  - 8 check types: overdue follow-up, pre-event prep, stalled tasks, OKR pace, learning reviews, suggestion follow-ups, plan staleness, daily check-in, weekly reflection
  - Returns prioritized Nudge objects with quick-action buttons
  - Cooldown system tracked in `proactive_state.json` (per-task, per-KR, per-type)
- **nudges.ts**: Read/write `nudges.json`, deduplication, cooldown tracking, max 3 per session
- **Nudge UI in chat**: Distinct card style with action buttons ("Done", "Reschedule", "Drop", "Snooze")
  - Urgent (red border): overdue high-priority, events in 2 hours
  - Important (amber border): OKR behind, stalled, weekly reflection
  - Helpful (default border): learning review, suggestion follow-up, plan stale

### Recurring Tasks
- Rules stored in `recurring_tasks.json` — created via chat ("Remind me every weekday at 8:30am")
- Schedule types: daily, weekdays, weekly (specific days), custom
- Optional time field — creates both a task AND calendar event
- Processed by headless runner morning job (creates instances for today)
- Dedup by recurring ID + date (won't create duplicates)
- Manageable via chat: create, update schedule, pause (active: false), delete
- Exclude specific dates via `excludeDates` array

### Structured Item Lists (Interactive Chat Cards)
- LLM returns `items[]` in `submit_action_plan` — structured array of tasks/events/OKRs to display
- Each item has: real ID, type, group header, LLM commentary, suggested action
- **ItemListCard component** renders grouped cards with real data from state (title, due, priority, status)
- Every card has direct-action buttons: Done, Tomorrow, Next week, Drop (tasks) / Done, Cancel, Tomorrow (events)
- LLM's suggested action is highlighted as the primary button
- Actions execute instantly via `executeDirectAction` — no LLM roundtrip
- Pagination: shows first 8, "Show more" loads 10 at a time
- Acted-on cards fade to confirmation message ("✓ Task marked done")
- Falls back to smart action chips when LLM doesn't return items

### Annotations & Card Actions
- **annotations.ts**: Separate `annotations.json` file (not inside focusBrief — survives plan refreshes)
- **CardActions component**: Type-specific action menus on every Focus Brief card
  - Priority cards: Mark done (instant), Reschedule (chat), Ask (chat), Comment
  - Risk cards: Dismiss (instant), Ask (chat), Comment
  - Calendar cards: Mark done (instant), Cancel (instant), Reschedule (chat), Comment
  - OKR cards: Update progress (chat), Ask (chat), Comment
- **Immediate actions**: "done", "cancel", "delete", "skip", "dismiss" → execute via executor directly, no LLM
- **Comments**: saved to `annotations.json` with targetId/type/title → processed by LLM on next plan generation
- **Process button**: "Process N annotations" button on Focus page → sends all to chat as batch
- **Headless integration**: morning job loads annotations into planning context, marks them resolved after plan
- Annotation badges on cards show unresolved count

### Calendar Hygiene
- **calendarHygiene.ts**: Keeps calendar.json lean and accurate
- **Daily hygiene** (headless morning job, before plan generation):
  - Archives past `scheduled` events (sets `archived: true`, doesn't assume "completed")
  - Aggressively archives recurring event instances from yesterday
  - All date comparisons use user timezone from `state.hotContext.today`
- **Weekly hygiene** (headless weekly job, before week plan):
  - Removes `cancelled` events older than 7 days (deleted, not just archived)
  - Removes `archived` events older than 30 days
  - Deduplicates events with same title + datetime within 30-minute window
- **Event dedup on creation** (`findDuplicateEvent` in executor):
  - Before adding a new calendar event, checks for title similarity + time proximity
  - Skips duplicate silently with console log
- **Focus brief addition dedup** (`deduplicateDayAdditions` in executor):
  - After calendar event injection, deduplicates each day's additions by title+time
  - Prevents duplicates when LLM and `injectMissingCalendarEvents` both add the same event with different IDs
- **Time normalization** (`normalizeTime` in executor):
  - Validates all event times are in HH:MM format
  - Maps known time words ("morning" → "08:00", "afternoon" → "13:00", etc.) with console warning
  - Strips invalid time values to prevent sort/display issues in agendaMerger
- **Assembler/summarizer/contradiction index** all filter out `archived` and `cancelled` events
- **Conflict detection nudge**: proactive engine checks all upcoming event pairs for time overlaps, creates nudge with "Keep A" / "Keep B" / "Keep both" actions

### Headless Runner
- **headless-runner.js**: Long-running Node process with `node-cron` scheduler
  - Morning job (wake time): process inbox + generate day plan (ONE Sonnet call/day) + proactive nudges
  - Half-day job (12:00): Tier 2 Haiku narrative refresh (if patches accumulated) + nudges — NO Sonnet replan (FEAT045)
  - Light check (every 4h): inbox + notes + Tier 2 refresh if 3+ patches — NO Sonnet (FEAT045)
  - Weekly job (weekStartsOn day, 20:00): generate week plan (Sonnet, 1x/week)
  - Light check (every 4h): inbox + overdue detection
  - Morning also processes recurring tasks (creates today's instances)
  - Data hygiene migrates orphaned `recurring` calendar events → RecurringTask entries
  - Executor safety net: calendar events with `recurring: true` auto-convert to RecurringTask writes
- Reads schedule from `user_lifestyle.json` (wake time, week start day)
- **Hot-reload**: re-reads schedule config every hour, reschedules if changed
  - User says "Change my wake time to 7am" → LLM updates userLifestyle → runner picks it up within 1 hour
- Reuses ALL existing business modules — no code duplication
- Runs via: `npm run headless`, `docker compose up headless -d`, or PM2
- Cross-platform: Windows, Mac, Linux, Docker

### Topic Repository & Topic-Aware Planning (FEAT023)
- **Topic Repository**: organize notes and knowledge by topic. Facts auto-tag with topic hints, and when a theme repeats 3+ times the system suggests creating a dedicated topic
- **Topic-aware daily planning**: assembler calls `buildTopicCrossRef()` to map topics to tasks/events/OKRs via signals and name matching, injects `topicCrossRef` into `full_planning` context. LLM emits `topicDigest` items in the focus brief. Executor calls `updateTopicPagesFromBrief()` to write digest back to topic markdown files
- **Topics UI page**: sidebar/tab entry, list view with search and pagination (`TopicCard` components), detail view showing linked tasks, events, OKR connections, new insights, and notes. Topic suggestions shown via `TopicSuggestionCard`

### Memory & Learning
- Context memory: long-term patterns, facts, recent events
- Feedback memory: user preferences, behavioral signals, corrections
- Learning log: items with spaced repetition tracking
- Content index: entity-based information lookup
- Suggestions log: track what was suggested and whether acted upon

### Conversation
- Multi-turn conversation with context carry-over
- Intent-aware follow-up (clarification stashes current intent)
- Conversation summary for pronoun resolution
- 14 intent types with regex classification and LLM fallback

### Conflict Detection
- Time overlap detection for tasks and calendar events
- Duplicate title detection across open items
- Contradiction index by date, topic, and OKR for cross-referencing

### Data Integrity
- Token budget enforcement per intent (truncates low-priority data to fit)
- File enum constraint on LLM writes (prevents hallucinated file names)
- Data cloning before mutation in executor
- Warn logging on silent write failures
- Dirty flag tracking — only flush changed files

### Encryption at Rest (FEAT021)
- **crypto.ts**: AES-256-GCM encryption with PBKDF2 key derivation (SHA-512, 600,000 iterations)
- **Platform-aware**: Node.js `crypto` module for headless runner, WebCrypto API for browser/mobile
- **File format**: `[iv:12 bytes][authTag:16 bytes][ciphertext]` — detected by `isEncryptedBuffer()` (first byte is never `{` or `[`)
- **Key management**: Single salt stored in AppConfig, random IV per write, derived key cached in memory per session, never written to disk
- **Transparent integration**: `filesystem.ts` wraps all read/write functions — encrypts on write, decrypts on read, gated on `isEncryptionEnabled() && isSensitiveFile(path)`
- **Sensitive files**: tasks.json, calendar.json, user_profile.json, user_lifestyle.json, user_observations.json, plan/*.json, focus_brief.json, recurring_tasks.json, inbox.txt, chat_history.json, hot_context.json, summaries.json, context_memory.json, feedback_memory.json, suggestions_log.json, learning_log.json, content_index.json, contradiction_index.json
- **Setup flow**: New encryption step in `app/setup.tsx` after data folder selection — optional passphrase, confirm, secure store toggle
- **Launch gate**: `app/_layout.tsx` prompts for passphrase on launch if encryption is enabled and not auto-unlocked via secure store
- **Headless/proxy support**: `scripts/headless-runner.js` and `scripts/api-proxy.js` read `ENCRYPTION_PASSPHRASE` + `ENCRYPTION_SALT` from environment variables, derive key before `loadState`
- **Migration CLI**: `scripts/migrate-encryption.ts` — run with `--encrypt` or `--decrypt`, reads passphrase/salt from args or env, idempotent with `.migration-state.json` progress tracking, atomic per-file writes
- **Exports from crypto.ts**: `deriveKey`, `encrypt`, `decrypt`, `cacheKey`, `clearKey`, `hasKey`, `generateSalt`, `isEncryptedBuffer`, `isSensitiveFile`, `setEncryptionEnabled`, `isEncryptionEnabled`
