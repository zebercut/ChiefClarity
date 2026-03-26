# Chief Clarity

Chief Clarity is a ChiefClarity-driven multi-agent system for turning messy daily notes into a structured execution plan. The user talks to ChiefClarity, ChiefClarity decides what needs to happen, worker agents do the analysis, and the writer produces the final markdown files.

## 🚀 Version 3.0: Agent-Driven Architecture + Hybrid Data System

**NEW:** Chief Clarity now uses an **agent-driven architecture** with a **hybrid data system** for scalability.

### What Changed

- **Before (v2.x):** Python script had hardcoded logic for file I/O, execution order, and prompts
- **After (v3.0):** Agents read their markdown definitions and decide what to do
- **NEW:** Three-layer data system (Markdown + Index + Database) for performance and scalability

### Key Benefits

- ✅ **No hardcoded logic** - All logic lives in agent markdown files
- ✅ **Flexible workflows** - Agents decide execution order
- ✅ **Easy to extend** - Add new agents by creating markdown files
- ✅ **Easy to modify** - Change agent behavior by editing markdown
- ✅ **True agent autonomy** - Agents control their own execution
- ✅ **Scalable data** - Supports 100+ agents with hybrid architecture
- ✅ **Fast performance** - Change detection skips unchanged files
- ✅ **Queryable history** - SQLite database for analytics

### Hybrid Data Architecture

Chief Clarity uses a three-layer data system:

**Layer 1: Markdown Files** (Human-readable)
- `focus.md`, `calendar.md`, `tasks.md`, `OKR.md`
- You can read and edit these files
- Version control friendly (Git)

**Layer 2: index.json** (Fast Metadata & Caching)
- File metadata (size, last_modified, generated_by)
- Change detection (skip unchanged files)
- Search result caching (24-hour TTL)
- Learned patterns storage

**Layer 3: chiefclarity.db** (Queryable History)
- Workflow execution logs
- Agent performance tracking
- Search history
- Learned patterns evolution
- Behavior metrics

**Benefits:**
- 2-3x faster on subsequent runs (change detection)
- Foundation for future Learning Agent
- Historical analytics and insights
- No data loss (automatic backups)

### Migration Status

- **Current:** Hybrid approach - both legacy and new scripts available
- **Legacy script:** `run_chiefclarity_legacy.py` (v2.x - menu-based)
- **New script:** `run_chiefclarity.py` (v3.0 - natural language)
- **Documentation:** See `MIGRATION_GUIDE.md` for details

### Natural Language Interface

Instead of selecting from a menu, just tell Chief Clarity what you want:

```
$ python run_chiefclarity.py

What would you like Chief Clarity to do?
Your request: Help me plan tomorrow

[Orchestration agent interprets → executes prepare_tomorrow mode]
✓ Check data/focus.md for your plan!
```

**Examples:**
- "Help me plan tomorrow"
- "Plan my day"
- "Answer my questions"
- "Should I prioritize task A or B?"

See `docs/natural_language_interface.md` for full guide.

## Core Idea

Chief Clarity is not a fixed pipeline first. It is a ChiefClarity-first system.

The intended interaction is:

1. The user asks for something
2. ChiefClarity interprets the request
3. ChiefClarity asks live clarification questions if needed
4. ChiefClarity decides which worker agents should run
5. The workers produce structured outputs
6. The Writer Agent renders the final user-facing files

This keeps orchestration in one place instead of duplicating workflow logic across command files.

## Main Agents

- `cc_chiefclarity_agent.md`
  - Main agent and orchestration brain
  - Infers intent
  - Asks live clarification questions
  - Selects workers
  - Writes `run_manifest.json`
- `cc_intake_agent.md`
  - Archives raw input before processing (prevents data loss)
  - Normalizes inbox content with topic indexing
  - Performs 7-day and 30-day archival rotation
  - Writes `structured_input.md`, `intake_data.json`, and archive files
- `cc_planning_agent.md`
  - Handles planning, priorities, OKR reasoning, agenda guidance, and operational answers
  - Writes `plan_data.json`
- `cc_companion_agent.md`
  - Handles emotional and behavioral support
  - Writes `companion_data.json`
- `cc_writer_agent.md`
  - Renders `focus.md`
  - Appends `focus_log.md`
  - Rewrites `input.txt`
  - Appends `answer.md`

## Predefined ChiefClarity Modes

ChiefClarity currently uses these predefined modes:

1. `prepare_today`
   - Fast daily planning pass for today
   - Best for everyday use
2. `prepare_tomorrow`
   - Prepare tomorrow's focus, agenda, risks, and must-win items
   - Narrow and time-bound
3. `prepare_week`
   - Build or refresh the weekly view inside `focus.md`
   - Includes weekly priorities and weekly calendar
4. `full_analysis`
   - Rebuild the system's current understanding of what matters now
   - Broad current-state analysis
   - Better as a weekly deep refresh than a daily run
5. `answer_input_questions`
   - Answer the questions in `input.txt -> QUESTIONS FOR CHIEF CLARITY`
6. `answer_one_question`
   - Answer one specific user question coming directly from the conversation

If the user directly invokes ChiefClarity without a concrete task, ChiefClarity should offer these options and ask what to do.

## Clarification Model

Chief Clarity uses two different question channels.

### Live clarification

These happen in the conversation with the user.

Use live clarification when:

- the request is ambiguous
- the request is under-specified
- multiple interpretations are plausible
- task prioritization needs constraints

These questions are not written to `input.txt`.

### Persistent system follow-up questions

These are questions discovered during planning or companion analysis that require later user input.

Write them to:

- `data/input.txt` -> `QUESTIONS FROM CHIEF CLARITY`

## Task Prioritization Rule

Task prioritization is not a standalone predefined mode.

If the user asks to prioritize, clean up, or review tasks, ChiefClarity must ask live clarification questions first. At minimum, it should clarify:

- the horizon: today, tomorrow, or this week
- the optimization goal: deadlines, impact, or stress reduction

After that, ChiefClarity chooses the closest mode and routes the work to the Planning Agent.

## Files You Usually Touch

The user should only edit one file:

```text
data/input.txt
```

Everything the user wants to communicate must go through `data/input.txt`, including:

- profile information
- objectives
- habits
- corrections
- questions
- task updates
- agenda changes
- anything else the user wants Chief Clarity to know

The main outputs go here:

```text
data/focus.md
data/answer.md
```

These are output and history files. The user can read them, but should not edit them directly.

All other files are system-managed and should be treated as internal state unless you are deliberately maintaining the system itself:

- `data/user_profile.md`
- `data/objectives.md`
- `data/OKR.md`
- files inside `data/context/`

## Main Data Files

### User-facing files

- `data/input.txt`
  - the only user input channel
  - raw notes, requests, answers, corrections, profile updates, objective updates, and questions
- `data/focus.md`
  - main dashboard and agenda output
  - read-only for the user in normal operation
- `data/answer.md`
  - append-only answer/history log
  - read-only for the user in normal operation

### System state files

- `data/structured_input.md`
- `data/intake_data.json`
- `data/plan_data.json`
- `data/companion_data.json`
- `data/run_manifest.json`

### Architecture files (v3.0)

- `data/index.json`
  - Fast metadata and caching layer
  - File change detection
  - Search result cache
  - Learned patterns
- `data/chiefclarity.db`
  - SQLite database for history
  - Workflow execution logs
  - Agent performance tracking
  - Analytics and insights
- `data/logs/`
  - Debug files (`_debug_*_response.txt`)
  - Error diagnostics
  - API response logs

### Topic Registry (NEW)

- `data/topics.md`
  - Executive summaries of all tracked topics
  - Quick-scan overview with status and recent activity
  - Links to detailed topic files
- `data/topics/[topic-name].md`
  - Complete historical context for each topic
  - Timeline of all related inbox items
  - Ideas, decisions, completed work, and OKR tasks
- `data/topic_registry.json`
  - Metadata store for all topics
  - Topic-to-KR linkages
  - INBOX reference tracking

### Archival & Indexing System (NEW - v2.1.0)

Chief Clarity now includes a three-tier archival system with topic indexing for efficient historical context retrieval:

**Active Data (7 days):**
- `data/structured_input.md` - Active entries with topic index and date index
- `data/structured_input_summary.md` - Weekly summaries for quick context
- `data/input_archive_YYYY-MM.md` - Raw user input archive (current month)

**Recent Archive (30 days):**
- `data/structured_input_archive_YYYY-MM.md` - Archived structured entries (current month)

**Long-term Archive:**
- `data/archives/YYYY-MM/` - Monthly archive folders
  - `input_archive_YYYY-MM.md` - Raw input by month
  - `structured_input_archive_YYYY-MM.md` - Structured entries by month
  - `README.md` - Archive usage guide

**System Documentation:**
- `data/ARCHIVAL_SYSTEM.md` - Complete archival system documentation

**Key Features:**
- **Topic Index:** Fast navigation to related entries by topic (Job Search, Project A, Family, etc.)
- **Date Index:** Quick access to entries by date range
- **Weekly Summaries:** Synthesized context across weeks without reading individual entries
- **Automatic Rotation:** 7-day rotation (Sundays), 30-day rotation (first Sunday of month)
- **Raw Input Preservation:** User's exact notes archived before cleanup

### History files

- `data/focus_log.md`
- `data/history_digest.md`
- `data/context_digest.md`

## `focus.md` Contract

`focus.md` must keep the existing `focus3-lite` structure.

The Writer Agent is responsible for preserving the exact section order from `templates/focus.md`.

The weekly layer is now built into `focus.md` itself. There is no separate weekly planning file.

Recommended usage:

- daily: `prepare_today`
- evening: `prepare_tomorrow`
- weekly: `prepare_week`
- deep refresh: `full_analysis`

The top of `focus.md` remains daily. The weekly view lives in:

- `## This Week`
- `## Weekly Calendar`

## How The System Works

Typical flow:

```text
user request -> ChiefClarity -> intake/planning/companion as needed -> writer -> focus.md/input.txt/answer.md
```

ChiefClarity decides:

- what the user wants
- whether clarification is needed
- which workers should run
- the execution order
- what outputs are expected

The workers do not decide orchestration.

## `run_manifest.json`

`run_manifest.json` is the execution contract for one run.

It exists to make ChiefClarity's decisions explicit and inspectable.

Typical fields include:

- request summary
- selected mode
- confidence
- whether live clarification is still required
- agents to run
- execution order
- question routing
- expected outputs
- blockers
- assumptions

## Installation

### Step 1 - Download the project

```bash
git clone https://github.com/YOUR_USERNAME/chiefclarity.git
```

Or download the ZIP and extract it somewhere your AI tool can read and write.

### Step 2 - Create your data files

Copy the starter templates into `data/`:

```bash
# macOS / Linux
cp templates/* data/

# Windows (PowerShell)
Copy-Item templates\* data\
```

### Step 3 - Do first-time setup in `data/input.txt`

The user should not open or edit `data/user_profile.md`, `data/objectives.md`, `data/OKR.md`, `data/focus.md`, or `data/answer.md` during normal use.

The main communication channel is:

- `data/input.txt`

For a first-time empty setup, `data/input.txt` should contain a small onboarding section with setup questions that the user answers directly there.

The first setup questions should cover at least:

- user profile
  - who the user is, timezone, location, routine, preferences, and communication style
- objectives
  - the user's high-level long-term goals, with short definitions or comments explaining what counts as an objective

Suggested principle:

- `input.txt` is the only user input surface
- the user never needs to manually edit profile, objectives, agenda, or answer files
- `user_profile.md`, `objectives.md`, and related internal files are generated or updated from answers in `input.txt`
- after setup, any future change to profile, objectives, habits, or agenda should also be communicated through `input.txt`

### Step 4 - Let Chief Clarity write the core files

After the user answers the setup questions in `data/input.txt`, Chief Clarity should populate:

- `data/user_profile.md`
- `data/objectives.md`
- `data/OKR.md` when enough information exists

The user should keep using `data/input.txt` for future corrections instead of editing those files directly.

### Step 5 - Add context files

Drop optional supporting files into `data/context/`.

### Step 6 - Start using Chief Clarity

Talk to Chief Clarity directly using `@cc_chiefclarity_agent.md` in your IDE. Chief Clarity will interpret your request and orchestrate the worker agents.

## Automation Script (Standalone Execution)

Chief Clarity now includes a Python automation script (`run_chiefclarity.py`) that executes the full multi-agent workflow using the Claude API, without requiring an IDE.

### Features

- **Interactive Menu** - Select mode without command-line arguments
- **Full Agent Orchestration** - Executes all 4 agents sequentially (ChiefClarity → Intake → Planning → Writer)
- **API Integration** - Uses Anthropic Claude API (claude-sonnet-4-5-20250929)
- **Config File Support** - Store API key in `config.json` (gitignored for security)
- **Automatic File Management** - Reads/writes all data files automatically

### Setup

**1. Install Python package:**
```bash
pip install anthropic
```

**2. Create `config.json` in the root directory:**
```json
{"ANTHROPIC_API_KEY": "sk-ant-api03-your-actual-key-here"}
```

Get your API key from https://console.anthropic.com/

**Note:** `config.json` is automatically gitignored to protect your API key.

**3. Run the script:**
```bash
# Interactive menu
python run_chiefclarity.py

# Direct mode execution
python run_chiefclarity.py prepare_week
```

### Available Modes

1. **Prepare Today** - Fast daily planning for today
2. **Prepare Tomorrow** - Evening planning for tomorrow
3. **Prepare Week** - Weekly view with calendar and priorities
4. **Full Analysis** - Deep refresh and comprehensive analysis
5. **Answer Input Questions** - Process questions from input.txt

### Cost & Performance

- **Cost:** ~$0.50-$1.00 per run (Claude API usage)
- **Time:** ~30-60 seconds for full workflow
- **Requirements:** Active Anthropic account with credits

### Output Files

The script generates:
- `data/run_manifest.json` - Execution plan
- `data/calendar.md` - Updated calendar (if temporal expressions found)
- `data/tasks.md` - Updated tasks (if deadlines found)
- `data/structured_input.md` - Classified input
- `data/intake_data.json` - Intake data
- `data/plan_data.md` - Planning analysis
- `data/focus.md` - Final executive dashboard

### Troubleshooting

**API Key Issues:**
- Make sure `config.json` exists in the root directory
- Verify API key is valid at https://console.anthropic.com/
- Check that you have credits in your Anthropic account

**Model Not Found:**
- The script uses `claude-sonnet-4-5-20250929`
- If unavailable, check your account's available models

**Environment Variable Conflicts:**
- The script prioritizes `config.json` over environment variables
- Remove stale env vars: `Remove-Item Env:ANTHROPIC_API_KEY` (PowerShell)

## How to Use Chief Clarity

### Daily Usage

**Morning Planning:**
```
@cc_chiefclarity_agent.md prepare today
```
Gets you a focused daily plan with:
- Today's must-win items
- Time-blocked agenda
- Risks and blockers
- Task check-in for the day

**Evening Planning:**
```
@cc_chiefclarity_agent.md prepare tomorrow
```
Prepares tomorrow's focus before you end the day:
- Tomorrow's priorities
- Agenda preview
- What to prep tonight

**Weekly Planning (Sunday or Monday):**
```
@cc_chiefclarity_agent.md prepare the week
```
Builds your weekly view:
- Week's critical items
- Weekly calendar with fixed commitments
- Deadlines and outcomes target
- Weekly priorities mapped to objectives

**Deep Analysis (Weekly refresh):**
```
@cc_chiefclarity_agent.md do a full analysis
```
Comprehensive current-state analysis:
- OKR progress review
- Risk and pattern identification
- Broad context refresh
- Strategic alignment check

### Asking Questions

**Answer questions you wrote in input.txt:**
```
@cc_chiefclarity_agent.md answer my questions
```

**Ask a specific question:**
```
@cc_chiefclarity_agent.md what is my top priority this week?
```

**General conversation:**
```
@cc_chiefclarity_agent.md hey
```
Chief Clarity will ask what you want to do and offer options.

### Example Workflows

**Typical Daily Flow:**
1. Morning: Add notes to `data/input.txt` (tasks, updates, questions)
2. Run: `@cc_chiefclarity_agent.md prepare today`
3. Review: Check `data/focus.md` for your agenda
4. Work through the day, update task check-in in `input.txt`
5. Evening: `@cc_chiefclarity_agent.md prepare tomorrow`

**Weekly Flow:**
1. Sunday/Monday: Review week, add notes to `input.txt`
2. Run: `@cc_chiefclarity_agent.md prepare the week`
3. Review: Check weekly calendar and critical items in `focus.md`
4. Mid-week: Run `prepare today` daily
5. End of week: `@cc_chiefclarity_agent.md do a full analysis` for deep refresh

**When Things Change:**
1. Add updates to `data/input.txt` (new tasks, changed priorities, decisions)
2. Run: `@cc_chiefclarity_agent.md prepare today` (or `prepare the week`)
3. Chief Clarity updates your plan based on new information

### Tips

- **Use `input.txt` for everything** - Don't edit `focus.md`, `user_profile.md`, `OKR.md` directly
- **Be specific in requests** - "prepare today" is clearer than "help me plan"
- **Answer task check-ins** - Update task status in `input.txt` for accurate planning
- **Review `focus.md` regularly** - It's your single source of truth for what matters now
- **Use topic links** - Click topic links in `focus.md` to jump to `topics.md` summaries, then to full detail files
- **Explore topic history** - Each topic file has complete timeline, ideas, decisions, and related tasks
- **Use context links** - Click agenda item links to see full context (ideas, decisions, next steps)
- **Ask clarification questions** - Chief Clarity will ask if your request is unclear
- **Search by topic** - Check topic index in `structured_input.md` for fast retrieval of related entries
- **Access historical context** - Weekly summaries provide quick context without reading individual entries
- **Your notes are preserved** - Raw input is archived before cleanup, never lost

## Project Structure

```text
chief-clarity/
|-- agents/                      # Multi-agent system
|   |-- cc_chiefclarity_agent.md # Main orchestrator (talk to this one)
|   |-- cc_intake_agent.md       # Normalizes inbox content
|   |-- cc_planning_agent.md     # Planning, priorities, OKR reasoning
|   |-- cc_companion_agent.md    # Emotional and behavioral support
|   `-- cc_writer_agent.md       # Renders final markdown files
|-- data/                        # Your data (git-ignored)
|   |-- input.txt                # ← YOU EDIT THIS (main input channel)
|   |-- focus.md                 # ← YOU READ THIS (main dashboard)
|   |-- answer.md                # Answer history log
|   |-- topics.md                # Topic Registry - executive summaries
|   |-- topics/                  # Topic detail files
|   |   |-- job-search.md        # Example: complete job search history
|   |   `-- ...                  # One file per topic
|   |-- topic_registry.json      # Topic metadata and linkages
|   |-- user_profile.md          # System-managed profile
|   |-- objectives.md            # System-managed objectives
|   |-- OKR.md                   # System-managed execution plan
|   |-- structured_input.md      # Active entries (7 days) with topic/date index
|   |-- structured_input_summary.md  # Weekly summaries
|   |-- structured_input_archive_YYYY-MM.md  # Monthly structured archive
|   |-- input_archive_YYYY-MM.md     # Monthly raw input archive
|   |-- archives/                # Long-term archives
|   |   `-- YYYY-MM/             # Monthly archive folders
|   |       |-- input_archive_YYYY-MM.md
|   |       |-- structured_input_archive_YYYY-MM.md
|   |       `-- README.md
|   |-- ARCHIVAL_SYSTEM.md       # Archival system documentation
|   |-- intake_data.json         # Intake agent output
|   |-- plan_data.json           # Planning agent output
|   |-- companion_data.json      # Companion agent output
|   |-- run_manifest.json        # Execution contract for each run
|   |-- focus_log.md             # Append-only run history
|   |-- history_digest.md        # Historical context digest
|   |-- context_digest.md        # Current context digest
|   `-- context/                 # Optional supporting files
`-- templates/                   # Starter templates
    |-- focus.md                 # Focus.md structure template
    |-- input.txt                # Input.txt starter template
    |-- topic_detail.md          # Topic detail file template
    `-- ...                      # Other templates
```

**Key Files:**
- **YOU EDIT:** `data/input.txt` only
- **YOU READ:** `data/focus.md` (main dashboard), `data/answer.md` (Q&A history)
- **SYSTEM MANAGES:** Everything else

## Design Principles

- **Chief Clarity first** - Orchestrator decides what to do, workers execute
- **Plain markdown and JSON** - No database, human-readable files
- **Local-first data ownership** - Your data stays on your machine
- **Clear worker boundaries** - Each agent has specific responsibilities
- **Append-only operational history** - Never lose context
- **Stable user-facing format** - `focus.md` structure stays consistent
- **Live clarification** - Ask questions when intent is unclear
- **Single input channel** - `input.txt` is the only file you edit
- **Context linking** - Agenda items link to full context (ideas, decisions, next steps)
- **Topic Registry** - Unified historical view of all recurring topics with auto-discovery and KR linkage
- **Layered memory** - Topic index (fast), weekly summaries (context), archives (deep history)
- **Data preservation** - Raw input archived before cleanup, never lost
- **Automatic archival** - 7-day and 30-day rotation without manual intervention

## Troubleshooting

**Q: Chief Clarity isn't responding to my request**
- Make sure you're using `@cc_chiefclarity_agent.md` to invoke Chief Clarity
- Check that your request is clear (e.g., "prepare today" not "help")

**Q: My changes in input.txt aren't showing up**
- Run a Chief Clarity command after updating `input.txt`
- Chief Clarity processes `input.txt` when you run a mode (prepare today, etc.)

**Q: focus.md has old information**
- Run `@cc_chiefclarity_agent.md prepare today` to refresh
- For deep refresh: `@cc_chiefclarity_agent.md do a full analysis`

**Q: I want to change my profile/objectives**
- Add the changes to `data/input.txt` in the INBOX section
- Run any Chief Clarity mode - it will update system files automatically
- Don't edit `user_profile.md` or `objectives.md` directly

**Q: How do I see context for an agenda item?**
- Look for clickable links in agenda table (e.g., `[Job search](#job-search-context)`)
- Click the link to jump to full context section
- Context includes: ideas, completed tasks, conclusions, next steps, decisions, undecided items

**Q: How do I see all history for a topic?**
- Click topic links in `focus.md` (e.g., `[Job Search](topics.md#job-search)`)
- This jumps to executive summary in `topics.md`
- Click `[→ Full Detail]` link to see complete historical timeline
- Topic files include: all INBOX references, ideas, decisions, completed work, OKR tasks

**Q: How do I find old notes or entries?**
- **Last 7 days:** Check topic index in `data/structured_input.md`
- **Last 2-4 weeks:** Read weekly summaries in `data/structured_input_summary.md`
- **Older entries:** Search `data/structured_input_archive_YYYY-MM.md`
- **Raw notes:** Search `data/input_archive_YYYY-MM.md` for your exact words
- **Very old:** Check `data/archives/YYYY-MM/` folders

**Q: Are my notes preserved when input.txt is cleaned?**
- Yes! The Intake Agent archives raw `input.txt` content BEFORE cleanup
- Your exact notes are preserved in `data/input_archive_YYYY-MM.md`
- Archival happens automatically on every Chief Clarity run

## License

MIT License. See [LICENSE](LICENSE) for details.

Created and maintained by [Farzin](https://github.com/zebercut). See [NOTICE](NOTICE) for attribution guidelines.

## Quick Reference

| What you want | Command |
|---------------|----------|
| Plan my day | `@cc_chiefclarity_agent.md prepare today` |
| Plan tomorrow | `@cc_chiefclarity_agent.md prepare tomorrow` |
| Plan my week | `@cc_chiefclarity_agent.md prepare the week` |
| Deep analysis | `@cc_chiefclarity_agent.md do a full analysis` |
| Answer my questions | `@cc_chiefclarity_agent.md answer my questions` |
| Ask a question | `@cc_chiefclarity_agent.md [your question]` |
| General help | `@cc_chiefclarity_agent.md hey` |
