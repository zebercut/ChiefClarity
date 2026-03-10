# Chief Clarity

A multi-agent AI system that turns messy daily notes into a structured execution plan. Chief Clarity reads your free-form input, maps it to your goals, builds a prioritized focus dashboard, and keeps you accountable — all through plain markdown files.

## Why Chief Clarity?

### Your data stays with you
Chief Clarity runs entirely on local markdown files. Your goals, tasks, routines, and personal notes never leave your machine. No cloud database, no SaaS account, no vendor lock-in. You own your data, period.

### It gets better with better AI
Chief Clarity is AI-powered but AI-agnostic. You run the pipeline through any AI assistant that can read and write files — Claude, GPT, Gemini, or a local model. The smarter the AI, the better the output: sharper prioritization, more useful suggestions, better pattern recognition. As AI models improve, your Chief Clarity improves with them — no software update needed.

### It thinks like a Chief of Staff, not a to-do app
Chief Clarity doesn't just list your tasks. It scores them against your actual goals, builds a time-blocked agenda around your real routine, flags when you're off-track, and asks the right questions to keep you moving. It learns your patterns over time and adapts.

### Input is just talking
`input.txt` is a plain text file. There's no format, no syntax, no structure required. Write a sentence, paste a paragraph, or use **speech-to-text** and just talk into it. It can be messy, long, short, full of typos — Chief Clarity doesn't care. The Intake Agent's entire job is to make sense of whatever you throw at it.

## Daily Workflow

Your daily interaction with Chief Clarity comes down to **two files**:

```
input.txt  →  (you write)  →  what happened, what's new, answers to questions
focus.md   →  (Chief Clarity writes)  →  your dashboard, agenda, progress, answers
```

**Morning:**
1. Open `data/input.txt` — answer the Task Check-In (yes/no for yesterday's tasks), add any new notes. Use your keyboard, or just open your phone's voice typing and talk. Messy is fine.
2. Run the pipeline (see "Running Chief Clarity" below)
3. Open `data/focus.md` — this is your daily dashboard: what to focus on, your time-blocked agenda, progress on goals, and answers to any questions you asked

**Throughout the day:** Add notes to `input.txt` whenever something comes up. Quick thought? Speech-to-text it in 10 seconds.

**That's it.** Two files. Input goes in, focus comes out.

## Installation

### Step 1 — Download the project

Clone or download the entire Chief Clarity folder to a location where your AI assistant can access the files:

```bash
git clone https://github.com/YOUR_USERNAME/chief-clarity.git
```

Or download the ZIP and extract it. Put it somewhere accessible — your home directory, Documents, Google Drive, Dropbox — anywhere works, as long as the AI tool you use can read and write to that folder.

### Step 2 — Create your data files

Copy the starter templates into the `data/` folder:

```bash
# macOS / Linux
cp templates/* data/

# Windows (Command Prompt)
copy templates\* data\

# Windows (PowerShell)
Copy-Item templates\* data\
```

This creates blank versions of all the files Chief Clarity needs. You'll fill them in next.

### Step 3 — Fill in your profile

Open `data/user_profile.md` and fill in your name, timezone, daily routine, and preferences. All agents read this file first — the more you fill in, the better Chief Clarity adapts to your schedule.

### Step 4 — Define your objectives

Open `data/objectives.md` and write your high-level goals (the "north star" — what you're working toward). Then open `data/OKR.md` and break them down into measurable Key Results with tasks.

### Step 5 — Add context files (optional)

Drop any reference files into `data/context/` — expenses, health logs, meeting notes, work documents. Any format works (`.md`, `.txt`, `.csv`). All agents read these as read-only context but never modify them.

More context = better suggestions. For example:
- `data/context/expenses.md` — Chief Clarity can flag budget overruns and connect spending to your financial goals
- `data/context/workout_log.md` — Chief Clarity can track exercise consistency and adjust your agenda
- `data/context/meeting_notes.md` — Chief Clarity can pull action items and connect them to your OKRs

You maintain these files yourself. Add, update, or remove them anytime.

Chief Clarity is smart about context files — it doesn't re-read unchanged files on every run. Step 0 of the pipeline builds a **context digest** (`context_digest.md`) that summarizes each file with its last-modified date. On the next run, only new or modified files get re-read. Agents work from the digest for speed, and only open the raw file when they need specific numbers.

### Step 6 — Add your first input

Open `data/input.txt` and write anything under the INBOX section. This is plain text — no format required. You can:

- Type a quick note: `need to call the dentist`
- Paste a brain dump: `had a meeting with the team, we decided to push the launch to next month, also need to update the budget spreadsheet, remind me to email Sarah`
- Use speech-to-text and just talk: `"I finished the client proposal this morning but I still need to review the contract, also I forgot to mention yesterday I signed up for that conference in April"`

It can be messy. It can have typos. It can be one line or twenty paragraphs. Chief Clarity will classify and organize everything.

### Step 7 — Run the pipeline

This is where the AI does the work. You need an AI assistant that can read and write files on your machine. Here are examples:

**Using Claude Code (recommended):**
```bash
# Open the Chief Clarity folder
cd /path/to/chief-clarity

# Start Claude Code
claude

# Then tell Claude to run the pipeline:
> run commands/cc_full_run.md
```

**Using Claude with Projects (claude.ai):**
- Upload the entire Chief Clarity folder to a Claude project
- In the chat, type: "Run the pipeline in commands/cc_full_run.md — follow all 5 steps in order"

**Using Cursor / Windsurf / other AI coding editors:**
- Open the Chief Clarity folder as a project
- Open `commands/cc_full_run.md`
- Tell the AI: "Follow this file step by step — execute all 5 steps in order, reading and writing the data files as instructed"

**Using OpenAI (ChatGPT with file access):**
- Upload the project files or connect your folder
- Paste the contents of `commands/cc_full_run.md` and say: "Execute this pipeline on my data files, step by step"

After the run:
- Open `data/focus.md` — your prioritized dashboard, time-blocked agenda, progress bars, and answers
- Open `data/input.txt` — refreshed with a task check-in for tomorrow

## How It Works

Chief Clarity runs a 5-step pipeline using specialized agents:

```
input.txt → Context Digest → Intake → Strategy → Focus → Executive → Archive → input.txt (refreshed)
```

| Step | Agent | What It Does |
|------|-------|-------------|
| 0 | **Context Digest** | Summarizes context files — only re-reads new or modified files |
| 1 | **Intake** | Classifies your messy notes into tasks, ideas, decisions, status updates, questions |
| 2 | **Strategy** | Maps work to Objectives & Key Results, detects duplicates and contradictions |
| 3 | **Focus** | Scores tasks, builds daily agenda, tracks progress across all goals |
| 4 | **Executive** | Answers your questions and writes them into the focus dashboard |
| 5 | **Archive** | Archives processed input, generates a task check-in for tomorrow |

## Project Structure

```
chief-clarity/
├── agents/                    # Agent rule files — DO NOT MODIFY
│   ├── cc_intake_agent.md    # Classifies raw input
│   ├── cc_strategy_agent.md  # Maps work to OKRs
│   ├── cc_focus_agent.md     # Builds daily focus dashboard
│   └── cc_executive_agent.md # Answers questions
├── commands/                  # Pipeline orchestration — DO NOT MODIFY
│   └── cc_full_run.md        # Run this to execute all 5 steps
├── data/                      # Your workspace (private — your data lives here)
│   ├── input.txt              # YOUR INPUT — write here daily (plain text, any format)
│   ├── focus.md               # YOUR OUTPUT — daily dashboard + answers (auto-generated)
│   ├── user_profile.md        # Your identity, routine, preferences (you fill in once)
│   ├── objectives.md          # High-level life/work objectives (you fill in once)
│   ├── OKR.md                 # Objectives, Key Results, and tasks (auto-managed)
│   ├── structured_input.md    # Classified inbox (auto-generated)
│   ├── focus_log.md           # Historical log (auto-generated, append-only)
│   ├── input_archive.md       # Archived inbox entries (auto-generated)
│   ├── context_digest.md      # Summarized context (auto-generated, avoids re-reading)
│   └── context/               # Your reference files (read-only by agents)
│       ├── expenses.md        # Budget, spending logs
│       ├── workout_log.md     # Exercise history
│       └── ...                # Any file — agents read, never modify
└── templates/                 # Starter templates — copy into data/ to begin
    └── ...
```

**Files you write to:** `input.txt`, `user_profile.md`, `objectives.md`, `context/*`
**Files Chief Clarity writes for you:** everything else

## Key Features

- **Focus Scoring** — Every task gets rated HIGH/MEDIUM/LOW/NOISE based on alignment with your OKRs
- **Daily Agenda** — Time-blocked schedule built from your actual routine and preferences
- **Progress Tracking** — Visual progress bars per objective with KR-level detail
- **Off-Focus Detection** — Flags when you're working on low-priority items instead of what matters
- **Task Check-In** — Daily yes/no checklist so you don't forget to report on tasks
- **Pattern Learning** — Detects your work habits over time (what you avoid, when you're productive)
- **User Profile** — Remembers your preferences, routine, and behavioral patterns across runs
- **Accountability** — Asks pointed questions when work stalls or priorities shift
- **Q&A** — Ask questions in input.txt, get sourced answers in focus.md
- **Data Privacy** — Everything stays in local markdown files you control
- **Voice-Friendly Input** — input.txt is plain text — use speech-to-text and just talk

## Design Principles

- **Plain markdown** — No database, no app, no lock-in. Everything is readable text files you can open anywhere.
- **Two-file interface** — Daily interaction is just `input.txt` (write) and `focus.md` (read).
- **Zero-friction input** — input.txt has no format. Type, paste, or speech-to-text. Messy is fine.
- **AI-agnostic** — Works with any AI that can read/write files. Better AI = better results.
- **Data stays local** — Your `data/` folder never needs to leave your machine. Store it wherever you trust.
- **Agent separation** — Each agent has clear boundaries: what it reads, what it writes, what it does NOT do.
- **Append-only logs** — `focus_log.md` and `input_archive.md` never rewrite history.
- **Always-run** — The Focus Agent rewrites `focus.md` on every run, even with no new input. Deadlines get closer every day.

## License

MIT
