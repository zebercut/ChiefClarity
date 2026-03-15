# Chief Clarity

Chief Clarity is a ChiefClarity-driven multi-agent system for turning messy daily notes into a structured execution plan. The user talks to ChiefClarity, ChiefClarity decides what needs to happen, worker agents do the analysis, and the writer produces the final markdown files.

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
  - Normalizes inbox content
  - Writes `structured_input.md` and `intake_data.json`
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

### History files

- `data/focus_log.md`
- `data/input_archive.md`
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
|   |-- structured_input.md      # Normalized inbox (system-managed)
|   |-- intake_data.json         # Intake agent output
|   |-- plan_data.json           # Planning agent output
|   |-- companion_data.json      # Companion agent output
|   |-- run_manifest.json        # Execution contract for each run
|   |-- focus_log.md             # Append-only run history
|   |-- input_archive.md         # Archived inbox items
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
