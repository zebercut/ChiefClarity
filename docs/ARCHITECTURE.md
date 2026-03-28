# Chief Clarity — System Architecture

version: 4.0.0-draft
updated: 2026-03-28

---

## 1. System Overview

Chief Clarity is an agent-driven personal operating system. A thin Python execution layer (`run_chiefclarity.py`) orchestrates AI agents that read, reason about, and update a set of data files representing the user's life context.

```
User (CLI chat)
    |
    v
main() — chat loop, session cache, greeting
    |
    v
process_request() — agent chain executor
    |
    v
execute_agent() — calls Claude API per agent, reads/writes files
    |
    v
Agents (markdown definitions → Claude interprets and outputs JSON)
    |
    v
Data files (JSON + Markdown in data/)
```

**Core principle:** The Python code is a thin execution layer. All decision-making, routing, analysis, and content generation lives in agent markdown definitions. The script only handles I/O, caching, and orchestration plumbing.

---

## 2. Execution Modes

Every user request is classified into a mode by the orchestrator agent. The mode determines which agents run and which files get updated.

### Mode Map

| Mode | Agent Chain | API Calls | Purpose |
|------|------------|-----------|---------|
| `direct_answer` | orchestrator only | 1 | Simple data lookups ("what do I have today?") |
| `quick_update` | orchestrator → intake | 2 | Add/update/cancel data ("add note...", "cancel meeting") |
| `answer_one_question` | orchestrator → planning → writer | 3-4 | Questions needing analysis |
| `answer_input_questions` | orchestrator → planning → writer | 3-4 | Answer questions from input.txt |
| `prepare_today` | orchestrator → intake → planning → writer | 4 | Daily planning |
| `prepare_tomorrow` | orchestrator → intake → planning → writer | 4 | Next-day planning |
| `prepare_week` | orchestrator → intake → planning → writer | 4 | Weekly planning |
| `full_analysis` | orchestrator → intake → planning → writer | 4 | Deep 30-day analysis |
| `feedback_query` | orchestrator → feedback | 2 | Ask about learned preferences |
| `feedback_update` | orchestrator → feedback | 2 | Process new feedback |

---

## 3. Agent Roles

### 3.1 Orchestrator (`cc_chiefclarity_agent`)

**Purpose:** Understand user intent, decide mode, route to agents.

**Reads:** `user_profile.md`, `content_index.json`, `calendar.json`, `tasks.json`, `OKR.md`
**Writes:** `run_manifest.json`
**Special:** In `direct_answer` mode, answers directly via `console_output` (no further agents).

### 3.2 Intake (`cc_intake_agent`)

**Purpose:** Parse raw input into structured data. Update calendar and tasks.

**Reads:** `input.txt`, `calendar.json`, `tasks.json`, `run_manifest.json`, `user_profile.md`, `structured_input.md`, `topic_registry.json`
**Writes (full mode):** `calendar.json`, `tasks.json`, `structured_input.md`, `intake_data.json`, `content_index.json`, `input_archive_YYYY-MM.md`
**Writes (quick_update):** Only `calendar.json` and/or `tasks.json` (whichever changed)

### 3.3 Planning (`cc_planning_agent`)

**Purpose:** Analyze situation, build priorities, risks, agenda, answer questions.

**Reads:** `run_manifest.json`, `user_profile.md`, `structured_input.md`, `intake_data.json`, `calendar.json`, `tasks.json`, `OKR.md`, `feedback_memory.json`, `history_digest.md`, `topic_registry.json`
**Writes:** `plan_data.md`, `plan_data.json`, optionally `OKR.md`, `user_profile.md`

### 3.4 Writer (`cc_writer_agent`)

**Purpose:** Render final outputs (focus.md, clean input.txt, update topics).

**Reads:** `run_manifest.json`, `plan_data.json`, `plan_data.md`, `calendar.json`, `tasks.json`, `user_profile.md`, `OKR.md`, `feedback_memory.json`, `topic_registry.json`, `input.txt`
**Writes (planning modes):** `focus.md`, `input.txt`, `topic_registry.json`, `topics.md`, `topics/*.md`, `focus_log.md`
**Writes (answer modes):** `console_output` only (no file writes)

### 3.5 Companion (`cc_companion_agent`)

**Purpose:** Emotional support, behavioral patterns, reflection.

**Reads:** `user_profile.md`, `structured_input.md`, `history_digest.md`, `context_digest.md`
**Writes:** `companion_data.json`

### 3.6 Feedback (`cc_feedback_agent`)

**Purpose:** Track and apply learned preferences.

**Reads:** `input.txt`, `chat_history.md`, `feedback_memory.json`, `user_profile.md`
**Writes:** `feedback_memory.json`

---

## 4. Data Model

### 4.1 File Ownership Matrix

| File | Created By | Updated By | Read By |
|------|-----------|-----------|---------|
| `run_manifest.json` | orchestrator | — | all agents |
| `calendar.json` | intake | intake | orchestrator, planning, writer |
| `tasks.json` | intake | intake | orchestrator, planning, writer |
| `structured_input.md` | intake | intake | planning, companion |
| `intake_data.json` | intake | intake | planning |
| `content_index.json` | intake | intake | orchestrator |
| `plan_data.json` | planning | planning | writer |
| `plan_data.md` | planning | planning | writer |
| `OKR.md` | user (initial) | planning | orchestrator, planning, writer |
| `user_profile.md` | user (initial) | planning | all agents |
| `focus.md` | writer | writer | — (user reads) |
| `input.txt` | writer (reset) | user (edits) | intake, feedback |
| `topic_registry.json` | writer | writer | intake, planning |
| `topics.md` | writer | writer | — (user reads) |
| `topics/*.md` | writer | writer | — (user reads) |
| `feedback_memory.json` | feedback | feedback | planning, writer |
| `companion_data.json` | companion | companion | — |
| `chat_history.md` | main() | main() | feedback |
| `focus_log.md` | writer | writer (append) | — |
| `input_archive_YYYY-MM.md` | intake | intake (append) | — |
| `index.json` | data_manager | data_manager | — |

### 4.2 File Categories

**Authoritative data** (source of truth for current state):
- `calendar.json` — events and schedule
- `tasks.json` — task list with priorities
- `OKR.md` — objectives and key results
- `user_profile.md` — user identity, timezone, preferences

**Derived data** (generated from authoritative data):
- `focus.md` — rendered daily plan
- `plan_data.json` / `plan_data.md` — planning analysis
- `structured_input.md` — classified inbox items
- `intake_data.json` — structured intake output
- `topic_registry.json` — topic metadata
- `topics.md` / `topics/*.md` — topic summaries

**Indices** (accelerate lookups):
- `content_index.json` — entity-to-file mapping
- `index.json` — file metadata

**Logs** (append-only):
- `chat_history.md` — conversation log
- `focus_log.md` — run summaries
- `input_archive_YYYY-MM.md` — raw input archive

---

## 5. File Update Matrix by Mode

This is the critical table. It shows exactly which files get written in each mode.

```
                          direct  quick   answer  planning
File                      answer  update  modes   modes
─────────────────────────────────────────────────────────
run_manifest.json          ✓       ✓       ✓       ✓
calendar.json              -       ✓       -       ✓
tasks.json                 -       ✓       -       ✓
structured_input.md        -       -       -       ✓
intake_data.json           -       -       -       ✓
content_index.json         -       -       -       ✓
input_archive_YYYY-MM.md   -       -       -       ✓
plan_data.json             -       -       ✓       ✓
plan_data.md               -       -       ✓       ✓
OKR.md                     -       -       maybe   maybe
focus.md                   -       -       -       ✓
input.txt (reset)          -       -       -       ✓
topic_registry.json        -       -       -       ✓
topics.md                  -       -       -       ✓
topics/*.md                -       -       -       full_analysis
focus_log.md               -       -       -       ✓
chat_history.md            ✓*      ✓*      ✓*      ✓*
console_output             ✓       ✓       ✓       -
```

`✓*` = written by main(), not by agents

### THE GAP: quick_update Skips Indices and Topics

When the user says "add note, [some update]", `quick_update` runs only intake in lightweight mode. This means:

- `structured_input.md` — NOT updated (the note is not classified)
- `content_index.json` — NOT updated (entities not indexed)
- `topic_registry.json` — NOT updated (topic not linked)
- `topics/[topic].md` — NOT updated (topic file stale)
- `intake_data.json` — NOT updated (no structured items)

**The data is captured** (calendar.json and tasks.json are updated), but **the indices and topic files are stale** until the next planning mode run.

---

## 6. Session Cache Architecture

```
┌─────────────────────────────────────────────┐
│ main()                                       │
│                                              │
│  session_cache = load_session_data()         │
│  ┌──────────────────────────────────────┐    │
│  │ session_cache (dict)                 │    │
│  │  "user_profile.md" → content         │    │
│  │  "calendar.json"   → content         │    │
│  │  "tasks.json"      → content         │    │
│  │  "OKR.md"          → content         │    │
│  │  ... 16 files total (~47 KB)         │    │
│  └──────────────────────────────────────┘    │
│       │                                      │
│       │  passed as context["file_cache"]     │
│       v                                      │
│  process_request()                           │
│       │                                      │
│       v                                      │
│  execute_agent()                             │
│    read:  cache hit → serve from memory      │
│           cache miss → disk read, cache it   │
│    write: disk write + cache update          │
│                                              │
│  Turn 2, 3, 4...                             │
│    same session_cache, accumulated content   │
│    files updated by agents → fresh in cache  │
└─────────────────────────────────────────────┘
```

**Cache is never flushed** during a session. At ~47 KB total, memory is not a concern. Files are refreshed in cache only when an agent writes a new version.

---

## 7. Current CLI Chat Flow

```
┌─ Startup ────────────────────────────────┐
│ 1. Print greeting (name, time, timezone) │
│ 2. Load all data files into session_cache│
│ 3. Print examples                        │
└──────────────────────────────────────────┘
            │
            v
┌─ Chat Loop ──────────────────────────────┐
│ while True:                              │
│   user_request = input("You: ")          │
│   │                                      │
│   ├─ "exit" → break                      │
│   ├─ "show tasks" → show_tasks()         │
│   ├─ "show calendar" → show_calendar()   │
│   └─ else → process_request()            │
│              │                           │
│              v                           │
│   print("Chief Clarity: {response}")     │
│   append_chat_history()                  │
└──────────────────────────────────────────┘
            │
            v
┌─ Cleanup ────────────────────────────────┐
│ print("Goodbye!")                        │
│ data_manager.close()                     │
└──────────────────────────────────────────┘
```

---

## 8. Request Processing Flow

```
process_request(user_request, session_cache)
│
├─ Generate run_id
├─ data_manager.start_run()
├─ Build context = {user_request, run_id, file_cache: session_cache}
│
├─ AGENT LOOP (max 10 iterations):
│   │
│   ├─ execute_agent(current_agent, context)
│   │   ├─ Read agent definition (agents/*.md)
│   │   ├─ Build system prompt
│   │   ├─ Collect files for this agent (from cache or disk)
│   │   ├─ Build user prompt with file contents
│   │   ├─ Call Claude API (streaming)
│   │   ├─ Parse JSON response
│   │   ├─ Write output files (disk + cache)
│   │   ├─ Display steps to user
│   │   └─ Return result
│   │
│   ├─ Store result in context["{agent}_result"]
│   │
│   ├─ If iteration 1 (orchestrator):
│   │   ├─ Read mode from run_manifest.json
│   │   └─ Create backup if planning mode
│   │
│   ├─ If status is error/blocked/needs_clarification → break
│   │
│   └─ current_agent = result["next_agent"]
│       (null → loop exits)
│
├─ data_manager.end_run()
├─ If failed + backup exists → restore
├─ If planning mode + success → generate focus.html
├─ format_chat_response() → extract human-friendly text
└─ Return (response, success, run_id)
```

---

## 9. Problem Analysis — Why quick_update Breaks Topic Files

### The Dependency Chain

In planning modes, the full pipeline maintains consistency:

```
intake writes:
  calendar.json      ← events updated
  tasks.json         ← tasks updated
  structured_input.md ← items classified with INBOX-IDs
  intake_data.json   ← topic analysis, OKR links
  content_index.json ← entity-to-file search index

planning reads intake's outputs, writes:
  plan_data.json     ← priorities, risks, topic updates

writer reads planning's outputs, writes:
  topic_registry.json ← topic metadata updated
  topics.md          ← summaries refreshed
  topics/*.md        ← detail files updated
```

In `quick_update`, only intake runs and only updates calendar/tasks:

```
intake writes (quick_update):
  calendar.json      ← events updated    ��
  tasks.json         ← tasks updated     ✓
  structured_input.md ← SKIPPED          ✗ stale
  intake_data.json   ← SKIPPED          ✗ stale
  content_index.json ← SKIPPED          ✗ stale
  topic_registry.json ← SKIPPED (writer) ✗ stale
  topics/*.md        ← SKIPPED (writer)  ✗ stale
```

### The Real Cost of Skipping

The calendar/tasks data IS correct. But:
- Next `direct_answer` query may miss the new entity in content_index.json
- Topic files show stale summaries
- structured_input.md doesn't include the new item

This is acceptable IF the next planning run fixes everything. But in a chat-first workflow where the user might add 5 notes and then ask a question, the indices are 5 updates behind.

---

## 10. CLI Architecture Plan — Proposed Changes

### 10.1 Goal

Transform the system so that:
1. Every data mutation (quick_update) keeps indices consistent
2. Simple questions (direct_answer) use up-to-date indices
3. The full planning pipeline remains unchanged
4. No logic moves from agents into Python

### 10.2 Proposed: Intake Always Updates Indices

Instead of two intake behaviors (full vs. lightweight), intake should ALWAYS update the minimum set of indices regardless of mode:

**quick_update intake must write:**
- `calendar.json` and/or `tasks.json` (as now)
- `content_index.json` (add/update entities mentioned in the note)
- `structured_input.md` (append the new item with an INBOX-ID)

**quick_update intake should NOT write:**
- `intake_data.json` (full classification not needed)
- `input_archive_YYYY-MM.md` (no raw archival for chat notes)
- `topic_registry.json` (still writer's job, updated on next planning run)
- `topics/*.md` (still writer's job)

This is a change to `cc_intake_agent.md` only — the Python code stays the same.

### 10.3 Proposed: Orchestrator Token Budget Increase

The orchestrator now receives `calendar.json` (~3.5 KB), `tasks.json` (~4.6 KB), and `OKR.md` (~12.7 KB) for direct_answer mode. Its current token cap of 8000 may be tight for answering questions about this data.

**Change:** Raise orchestrator cap from 8000 to 12000 in `choose_max_tokens()`.

### 10.4 Mode Decision Flowchart (for CLI)

```
User message arrives
        │
        v
   ┌─────────────┐
   │ Orchestrator │ (1 API call, always runs)
   └──────┬──────┘
          │
          ├─ Can answer from data alone?
          │   YES → direct_answer (console_output, done)
          │
          ├─ User adding/updating/cancelling data?
          │   YES → quick_update
          │         │
          │         v
          │   ┌─────────┐
          │   │ Intake   │ (1 API call)
          │   │ updates: │
          │   │  calendar│
          │   │  tasks   │
          │   │  index   │
          │   │  struct. │
          │   └────┬────┘
          │        │
          │        v done (console_output)
          │
          ├─ User asking complex question?
          │   YES → answer_one_question
          │         │
          │         v
          │   planning → writer (2-3 API calls)
          │                │
          │                v done (console_output)
          │
          └─ User wants planning/analysis?
              YES → prepare_today/tomorrow/week/full_analysis
                    │
                    v
              intake → planning → writer (3 API calls)
                                    │
                                    v done (focus.md)
```

### 10.5 What Each Mode Costs the User

| Action | Mode | API Calls | Time | Files Updated |
|--------|------|-----------|------|---------------|
| "What do I have today?" | direct_answer | 1 | ~3s | none (read-only) |
| "Add note: [event update]" | quick_update | 2 | ~8s | calendar, tasks, index, structured_input |
| "Mark [task] done" | quick_update | 2 | ~8s | tasks, index |
| "How should I prioritize?" | answer_one_question | 3-4 | ~20s | console_output only |
| "Plan tomorrow" | prepare_tomorrow | 4 | ~30s | all files (full pipeline) |

### 10.6 Implementation Steps

1. **Update `cc_intake_agent.md`** — In quick_update mode, also write `content_index.json` and append to `structured_input.md`
2. **Raise orchestrator token cap** — 8000 → 12000 in `choose_max_tokens()`
3. **No Python logic changes** — all routing stays in agent definitions
4. **Test each mode** — verify file update matrix matches the table above

---

## 11. Data Flow Diagrams by Mode

### direct_answer

```
User: "what do I have today?"
  │
  v
Orchestrator
  reads: user_profile.md, calendar.json, tasks.json (from cache)
  writes: run_manifest.json (mode: direct_answer)
  returns: console_output with answer
  next_agent: null
  │
  v
main() prints response, appends chat_history.md
```

### quick_update (proposed)

```
User: "add note, visited Example Corp, rescheduled delivery to Monday 4pm"
  │
  v
Orchestrator
  reads: user_profile.md
  writes: run_manifest.json (mode: quick_update, user_note: "...")
  next_agent: cc_intake_agent
  │
  v
Intake
  reads: run_manifest.json, calendar.json, tasks.json, structured_input.md, content_index.json
  writes: calendar.json (add/update event)
          tasks.json (if task changes)
          content_index.json (add new entity)
          structured_input.md (append INBOX item)
  returns: console_output confirming what was done
  next_agent: null
  │
  v
main() prints response, appends chat_history.md
```

### prepare_today (full pipeline)

```
User: "plan my day"
  │
  v
Orchestrator
  reads: user_profile.md
  writes: run_manifest.json (mode: prepare_today)
  next_agent: cc_intake_agent
  │
  v
Intake
  reads: input.txt, calendar.json, tasks.json, structured_input.md, ...
  writes: calendar.json, tasks.json, structured_input.md,
          intake_data.json, content_index.json, input_archive
  next_agent: cc_planning_agent
  │
  v
Planning
  reads: structured_input.md, calendar.json, tasks.json, OKR.md, ...
  writes: plan_data.json, plan_data.md, maybe OKR.md
  next_agent: cc_writer_agent
  │
  v
Writer
  reads: plan_data.json, run_manifest.json, calendar.json, ...
  writes: focus.md, input.txt (reset), topic_registry.json,
          topics.md, topics/*.md, focus_log.md
  next_agent: null
  │
  v
main() generates focus.html, appends chat_history.md
```
