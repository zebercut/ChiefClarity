# Chief Clarity

A multi-agent AI system that turns messy daily notes into a structured execution plan. Chief Clarity reads your free-form input, maps it to your goals, builds an executive-first focus dashboard, and keeps you accountable through plain markdown files.

## Why Chief Clarity?

### Your data stays with you
Chief Clarity runs entirely on local markdown files. No cloud database, no SaaS account, no vendor lock-in. Unlike productivity apps that store your goals, habits, and priorities on their servers permanently, Chief Clarity keeps everything in a folder you control.

**A note on AI and privacy:** When you use a cloud AI (Claude, GPT, Gemini), your data is sent to that provider during processing, similar to sending an email or using any other cloud service. For full privacy, use a local model such as Ollama, LLaMA, or Mistral so your data never leaves your machine. Chief Clarity works the same either way.

### It gets better with better AI
Chief Clarity is AI-powered but AI-agnostic. You can run it through any AI assistant that can read and write files on your machine. Better models produce better prioritization, sharper synthesis, and stronger recommendations.

### It thinks like a chief of staff, not a to-do app
Chief Clarity does more than list tasks. It maps work to your objectives, separates targets from actuals, builds a realistic agenda around your schedule, flags drift, and asks pointed questions when something important is missing.

### Input is just talking
`input.txt` is plain text. There is no required syntax or format. Type a line, paste a paragraph, or use speech-to-text and talk into it. The Intake Agent is responsible for turning that mess into structure.

## Daily Workflow

Most days you only interact with these files:

```text
input.txt   -> what happened, what changed, answers, questions
focus.md    -> executive dashboard, agenda, progress, answers
answer.md   -> append-only archive of answered questions
```

**Morning**
1. Open `data/input.txt`, answer the Task Check-In, and add any new notes.
2. Run the full pipeline.
3. Open `data/focus.md` to see your executive summary, main focus area, must-win tasks, agenda, risks, and answers.

**During the day**
Add notes to `data/input.txt` whenever something comes up.

**Question-only runs**
If you only want answers for `QUESTIONS FOR CHIEF CLARITY`, run the Q&A-only command instead of the full pipeline.

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

Open `data/user_profile.md` and fill in your name, timezone, routine, and preferences. All agents read this first.

### Step 4 - Define your objectives

Open `data/objectives.md` for high-level goals, then `data/OKR.md` for measurable Key Results and tasks.

### Step 5 - Add context files (optional)

Drop supporting files into `data/context/`, for example:

- `data/context/expenses.md`
- `data/context/workout_log.md`
- `data/context/meeting_notes.md`

Chief Clarity summarizes these into `data/context_digest.md` and only re-reads changed files on later runs.

### Step 6 - Add your first input

Open `data/input.txt` and write anything under `INBOX`. This can be:

- A quick note: `need to call the dentist`
- A brain dump: `meeting moved to next month, need to update budget, remind me to email Sarah`
- Speech-to-text: `"I finished the proposal but still need to review the contract"`

### Step 7 - Run Chief Clarity

You need an AI assistant that can read and write files.

#### Option A: Claude Code

```bash
npm install -g @anthropic-ai/claude-code
cd /path/to/chief-clarity
claude
```

Full pipeline:

```text
run commands/cc_full_run.md
```

Question-only pass:

```text
run commands/cc_answer_questions.md
```

#### Option B: Cursor / Windsurf / similar coding editors

Open the project folder, then point the assistant at one of these files:

- `commands/cc_full_run.md`
- `commands/cc_answer_questions.md`

Ask it to follow the command file step by step and update the data files accordingly.

#### Option C: Claude.ai / ChatGPT / other file-based tools

Upload the project files, then instruct the model to execute either:

- `commands/cc_full_run.md` for the full pipeline
- `commands/cc_answer_questions.md` for question-only Q&A

After the run, download the updated files, especially `data/focus.md`, `data/input.txt`, and `data/answer.md`.

#### Option D: Local AI

For maximum privacy, use a local model with a file-capable tool such as Ollama plus Open Interpreter or Aider.

## Commands

Chief Clarity currently ships with two command files:

- `commands/cc_full_run.md` runs the full multi-agent pipeline.
- `commands/cc_answer_questions.md` answers only the `QUESTIONS FOR CHIEF CLARITY` section, updates `focus.md -> ## Answers`, archives results in `answer.md`, and leaves the rest of the pipeline untouched.

## How It Works

Full pipeline flow:

```text
input.txt -> Context Digest -> Intake -> Strategy -> Focus -> Executive -> Archive -> input.txt
```

| Step | Agent | What It Does |
|------|-------|--------------|
| 0 | Context + History Digests | Re-reads only changed context and new history |
| 1 | Intake | Classifies messy notes into structured input |
| 2 | Strategy | Maps work to objectives and OKRs |
| 3 | Focus | Builds the executive-first dashboard, agenda, and objective status |
| 4 | Executive | Answers questions and writes them into `focus.md` |
| 5 | Archive | Archives input and generates the next task check-in |

## Project Structure

```text
chief-clarity/
|-- agents/
|   |-- cc_intake_agent.md
|   |-- cc_strategy_agent.md
|   |-- cc_focus_agent.md
|   `-- cc_executive_agent.md
|-- commands/
|   |-- cc_full_run.md
|   `-- cc_answer_questions.md
|-- data/
|   |-- input.txt
|   |-- focus.md
|   |-- answer.md
|   |-- user_profile.md
|   |-- objectives.md
|   |-- OKR.md
|   |-- structured_input.md
|   |-- focus_log.md
|   |-- input_archive.md
|   |-- history_digest.md
|   |-- context_digest.md
|   `-- context/
`-- templates/
```

**You usually edit:** `input.txt`, `user_profile.md`, `objectives.md`, and files under `context/`

**Chief Clarity writes:** everything else

## Key Features

- Executive-first dashboard in `focus.md`
- Main Focus Area plus 1-3 must-win items for today
- Time-blocked agenda based on the user's real routine
- Target vs actual tracking for objectives and key results
- Off-focus detection and risk surfacing
- Task Check-In generation for the next run
- Pattern learning through `focus_log.md` and `history_digest.md`
- Question answering with reusable history in `answer.md`
- Local-file architecture with no database or lock-in

## Performance Optimization

Chief Clarity uses a dual-digest system to reduce token usage and processing time.

### Context Digest

`data/context_digest.md` stores summaries of context files and only refreshes entries for files that changed.

### History Digest

`data/history_digest.md` incrementally summarizes `focus_log.md` and `input_archive.md`, so later runs read only new history instead of the full archive.

## Design Principles

- Plain markdown, no database
- Low-friction daily workflow
- AI-agnostic execution
- Local-first data ownership
- Clear agent boundaries
- Append-only operational history
- Full-run focus regeneration on every pipeline execution

## Contributing

Contributions are welcome. Open an issue first before submitting large changes.

Please avoid:

- Editing `agents/cc_*.md` without discussion
- Including personal data in pull requests
- Submitting pipeline changes without testing the full flow

## License

MIT License. See [LICENSE](LICENSE) for details.

Created and maintained by [Farzin](https://github.com/zebercut). See [NOTICE](NOTICE) for attribution guidelines.
