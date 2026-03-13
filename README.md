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

Most days you only care about:

```text
data/input.txt
data/focus.md
data/answer.md
```

You may also edit:

- `data/user_profile.md`
- `data/objectives.md`
- `data/OKR.md`
- files inside `data/context/`

## Main Data Files

### User-facing files

- `data/input.txt`
  - raw notes
  - task check-in
  - questions from the system
  - questions for the system
- `data/focus.md`
  - main dashboard
  - agenda
  - priorities
  - answers
- `data/answer.md`
  - append-only Q&A archive

### System state files

- `data/structured_input.md`
- `data/intake_data.json`
- `data/plan_data.json`
- `data/companion_data.json`
- `data/run_manifest.json`

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

### Step 3 - Fill in your profile

Open `data/user_profile.md` and fill in your name, timezone, routine, and preferences.

### Step 4 - Define your objectives

Open `data/objectives.md` for high-level goals, then `data/OKR.md` for measurable Key Results and tasks.

### Step 5 - Add context files

Drop optional supporting files into `data/context/`.

### Step 6 - Start using ChiefClarity

Ask for what you want directly, for example:

- `prepare today`
- `prepare my tomorrow`
- `prepare my week`
- `do a full analysis`
- `answer my questions in input.txt`
- `answer this question: what is my top priority this week?`
- `hey ChiefClarity`

If the request is unclear, ChiefClarity should ask what you want to do and offer the supported options.

## Commands

The repository still contains command files in `commands/`, but they should be treated as legacy helpers, not the primary control model.

The preferred interaction model is direct ChiefClarity-driven execution.

## Project Structure

```text
chief-clarity/
|-- agents/
|   |-- cc_chiefclarity_agent.md
|   |-- cc_intake_agent.md
|   |-- cc_planning_agent.md
|   |-- cc_companion_agent.md
|   `-- cc_writer_agent.md
|-- commands/
|   |-- cc_full_run.md
|   |-- cc_answer_questions.md
|   `-- cc_analyze_day.md
|-- data/
|   |-- input.txt
|   |-- focus.md
|   |-- answer.md
|   |-- user_profile.md
|   |-- objectives.md
|   |-- OKR.md
|   |-- structured_input.md
|   |-- intake_data.json
|   |-- plan_data.json
|   |-- companion_data.json
|   |-- run_manifest.json
|   |-- focus_log.md
|   |-- input_archive.md
|   |-- history_digest.md
|   |-- context_digest.md
|   `-- context/
`-- templates/
```

## Design Principles

- ChiefClarity first
- Plain markdown and JSON, no database
- Local-first data ownership
- Clear worker boundaries
- Append-only operational history
- Stable user-facing `focus.md` format
- Ask live clarification when intent is unclear

## License

MIT License. See [LICENSE](LICENSE) for details.

Created and maintained by [Farzin](https://github.com/zebercut). See [NOTICE](NOTICE) for attribution guidelines.
