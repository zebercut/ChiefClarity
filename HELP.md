# Chief Clarity - User Guide

Complete guide to using Chief Clarity effectively.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Daily Usage](#daily-usage)
4. [Understanding the Files](#understanding-the-files)
5. [How to Use](#how-to-use)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Features](#advanced-features)
8. [Best Practices](#best-practices)

---

## Quick Start

**1. Install dependencies:**
```bash
pip install anthropic
```

**2. Create `config.json` with your API key:**
```json
{"ANTHROPIC_API_KEY": "sk-ant-api03-your-key-here"}
```

**3. Run Chief Clarity:**
```bash
python run_chiefclarity.py
```

**4. Enter your request:**
```
Your request: plan today
```

**5. Check your plan:**
```
data/focus.md
```

---

## Installation

### Prerequisites

- Python 3.7+
- Anthropic API account with credits
- Text editor or IDE

### Step 1: Get API Key

1. Go to https://console.anthropic.com/
2. Create account or sign in
3. Navigate to API Keys
4. Create new key
5. Copy the key (starts with `sk-ant-api03-`)

### Step 2: Configure Chief Clarity

Create `config.json` in the root directory:

```json
{
  "ANTHROPIC_API_KEY": "sk-ant-api03-your-actual-key-here"
}
```

**Security:** `config.json` is automatically gitignored to protect your API key.

### Step 3: Initialize Data Files

Copy starter templates:

```bash
# macOS / Linux
cp templates/* data/

# Windows (PowerShell)
Copy-Item templates\* data\
```

### Step 4: First Run

Edit `data/input.txt` with your initial information:

```markdown
# INBOX

## Profile Setup
- Name: [Your Name]
- Timezone: America/Toronto
- Location: [Your City]
- Work schedule: [Your typical hours]

## Objectives
- [Your main goal 1]
- [Your main goal 2]
- [Your main goal 3]

## Today's Notes
- [What you're working on today]
```

Then run:
```bash
python run_chiefclarity.py
```

Select "Prepare Today" from the menu.

---

## Daily Usage

### Morning Routine

**1. Add notes to `data/input.txt`:**
```markdown
# INBOX

## Today ([Date])
- [Event A] at [Time]
- [Task A]
- [Task B]

## Questions
- What should I prioritize today?
```

**2. Run Chief Clarity:**
```bash
python run_chiefclarity.py
```
Enter: `plan today`

**3. Review your plan:**
Open `data/focus.md` - your daily dashboard with:
- Executive Summary (top priorities)
- Today's Agenda (time-blocked schedule)
- This Week (weekly view)
- Yesterday (what you completed)

### Evening Routine

**1. Update task status in `input.txt`:**
```markdown
## Task Check-In
- [x] [Event A] - completed
- [x] [Task A] - completed
- [ ] [Task B] - moved to tomorrow
```

**2. Plan tomorrow:**
```bash
python run_chiefclarity.py
```
Enter: `plan tomorrow`

**3. Review tomorrow's plan in `focus.md`**

### Weekly Planning (Sunday/Monday)

```bash
python run_chiefclarity.py
```
Enter: `plan my week`

Reviews:
- Week's critical items
- Weekly calendar
- Deadlines and outcomes
- Weekly priorities

---

## Understanding the Files

### Files You Edit

**`data/input.txt`** - Your ONLY input file
- Add all notes, tasks, questions here
- Never edit other files directly
- Chief Clarity processes this file

### Files You Read

**`data/focus.md`** - Your main dashboard
- Executive Summary
- Today's Agenda
- This Week view
- Yesterday's summary
- OKR Dashboard
- Answers to questions

**`data/answer.md`** - Q&A history
- Append-only log
- All answered questions
- Timestamped entries

### System Files (Don't Edit)

**`data/user_profile.md`** - Auto-generated from input.txt
**`data/OKR.md`** - Auto-updated objectives
**`data/calendar.md`** - Auto-managed events
**`data/tasks.md`** - Auto-managed tasks
**`data/index.json`** - Metadata cache
**`data/chiefclarity.db`** - History database
**`data/logs/`** - Debug files

---

## How to Use

### Natural Language Requests

Chief Clarity understands natural language:

**Planning:**
- "plan today"
- "plan tomorrow"
- "plan my week"
- "help me plan my day"

**Questions:**
- "what should I prioritize today?"
- "should I focus on task A or B?"
- "what's my top priority this week?"

**Analysis:**
- "do a full analysis"
- "analyze my situation"
- "review my progress"

### Available Modes

**1. Prepare Today** - Daily planning
- Fast daily planning for today
- Time-blocked agenda
- Must-win items
- Risk identification

**2. Prepare Tomorrow** - Evening planning
- Tomorrow's priorities
- Agenda preview
- What to prep tonight

**3. Prepare Week** - Weekly planning
- Week's critical items
- Weekly calendar
- Deadlines and outcomes
- Weekly priorities

**4. Full Analysis** - Deep refresh
- OKR progress review
- Risk and pattern identification
- Broad context refresh
- Strategic alignment

**5. Answer Questions** - Q&A
- Processes questions from input.txt
- Appends to answer.md

### Input.txt Structure

```markdown
# INBOX

## Today (Date)
- [Your notes for today]
- [Tasks, events, updates]

## Tomorrow
- [Notes for tomorrow]

## This Week
- [Weekly notes]

## Questions for Chief Clarity
- [Your questions here]

## Task Check-In
- [x] Completed task
- [ ] Pending task
- [~] In progress task

## Profile Updates
- [Changes to your profile]

## Objective Updates
- [Changes to your goals]
```

---

## Troubleshooting

### API Issues

**"API key not found"**
- Check `config.json` exists in root directory
- Verify API key is correct
- Ensure key starts with `sk-ant-api03-`

**"Model not found"**
- Your account may not have access to Claude Sonnet 4.5
- Check available models at https://console.anthropic.com/
- Contact Anthropic support for access

**"Insufficient credits"**
- Add credits to your Anthropic account
- Check billing at https://console.anthropic.com/

### Workflow Issues

**"Streaming required" error**
- Fixed in latest version
- Update to latest code
- Streaming is now enabled by default

**"Database file locked" error**
- Fixed in latest version
- Database closes properly before restore

**"Workflow failed" message**
- Check `data/logs/_debug_*_response.txt` for details
- Review error messages in terminal
- Data is automatically restored from backup

### Data Issues

**"My changes aren't showing up"**
- Make sure you edited `data/input.txt`
- Run Chief Clarity after making changes
- Check that you ran the correct mode

**"focus.md has old information"**
- Run `plan today` to refresh
- For deep refresh, run full analysis

**"I lost my data"**
- Check `data_backup/` folder for backups
- System keeps last 5 backups
- On failure, data is restored automatically

### Performance Issues

**"Workflow is slow"**
- Normal: 30-60 seconds for full workflow
- Large files may take longer
- Check internet connection

**"High API costs"**
- Each run costs ~$0.50-$1.00
- Use "plan today" for daily use (cheapest)
- Use "full analysis" sparingly (most expensive)

---

## Advanced Features

### Hybrid Data Architecture

Chief Clarity uses a 3-layer data system:

**Layer 1: Markdown Files** (Human-readable)
- `focus.md`, `calendar.md`, `tasks.md`
- You can read and understand these
- Version control friendly

**Layer 2: index.json** (Fast metadata)
- File change detection
- Search result caching
- Learned patterns storage
- Skips unchanged files for speed

**Layer 3: chiefclarity.db** (Queryable history)
- All workflow runs logged
- Agent performance tracking
- Historical analytics
- Foundation for future Learning Agent

### Backup System

**Automatic Backups:**
- Created before each workflow run
- Stored in `data_backup/`
- Keeps last 5 backups
- Auto-cleanup of old backups

**On Failure:**
- Data restored from backup
- Failed run backup deleted
- Good backups preserved

**Manual Restore:**
```bash
# Copy backup to data folder
Copy-Item "data_backup\backup_YYYYMMDD_HHMMSS\*" data\ -Recurse
```

### Logs and Debugging

**Debug files:** `data/logs/_debug_*_response.txt`
- Created on errors
- Contains raw API responses
- Helps diagnose issues

**Database queries:**
```bash
# View recent runs
sqlite3 data/chiefclarity.db "SELECT * FROM runs ORDER BY timestamp DESC LIMIT 10;"

# View agent performance
sqlite3 data/chiefclarity.db "SELECT agent_name, AVG(tokens_used) FROM agent_executions GROUP BY agent_name;"
```

### Future Features (Planned)

**Learning Agent:**
- Learns your patterns and preferences
- Adapts recommendations over time
- Stored in `learned_patterns` table

**Web Search Agent:**
- Fetches real-time information
- Caches search results
- Answers questions requiring current data

**Email Agent:**
- Drafts emails based on context
- Sends with your approval
- Logs sent emails

---

## Best Practices

### Daily Workflow

**Morning (5 minutes):**
1. Add notes to `input.txt`
2. Run `plan today`
3. Review `focus.md`
4. Start working

**During Day:**
- Update task status in `input.txt` as you complete things
- Add new notes to INBOX section

**Evening (5 minutes):**
1. Update task check-in
2. Run `plan tomorrow`
3. Review tomorrow's plan

### Weekly Workflow

**Sunday/Monday (15 minutes):**
1. Review past week
2. Add weekly notes to `input.txt`
3. Run `plan my week`
4. Review weekly calendar and priorities

**Mid-week:**
- Run `plan today` daily
- Keep `input.txt` updated

**End of week:**
- Optional: Run full analysis for deep refresh

### Input.txt Tips

**Be specific:**
```markdown
# Good
- [Event A] at [Time] on [Date]

# Too vague
- Interview sometime this week
```

**Use task check-ins:**
```markdown
## Task Check-In
- [x] Blog post published
- [~] [Project A] (in progress, blocked on [Blocker])
- [ ] [Admin Task] (due [Date] - urgent)
```

**Ask clear questions:**
```markdown
## Questions for Chief Clarity
- Should I prioritize [Event A] prep or [Project A] today?
- What's the optimal time to schedule deep work this week?
```

### Focus.md Usage

**Read top-to-bottom:**
1. Executive Summary (5-7 lines) - Quick overview
2. Today's Agenda - What to do NOW
3. This Week - Weekly context
4. Yesterday - What you completed

**Use links:**
- Click topic links to see full history
- Click agenda links for context
- Navigate quickly with hyperlinks

**Don't edit directly:**
- Use `input.txt` for all changes
- `focus.md` is regenerated each run

### Cost Management

**Minimize costs:**
- Use "plan today" for daily use (~$0.50)
- Use "plan tomorrow" for evening (~$0.50)
- Use "plan week" weekly (~$0.75)
- Use "full analysis" sparingly (~$1.00)

**Typical monthly cost:**
- Daily use: ~$15/month (30 days × $0.50)
- With weekly planning: ~$18/month
- With occasional full analysis: ~$20/month

---

## Getting Help

**Check logs:**
```
data/logs/_debug_*_response.txt
```

**Review errors:**
- Terminal output shows detailed errors
- Check for API key issues
- Verify file permissions

**Database issues:**
- Delete `chiefclarity.db` to reset
- Will be recreated on next run

**Data recovery:**
- Check `data_backup/` folder
- Restore from most recent backup
- Contact support if needed

**Community:**
- GitHub Issues: Report bugs and request features
- Documentation: README.md and CHANGELOG.md
- Examples: See templates/ folder

---

## Summary

**Key Points:**
1. ✅ Only edit `data/input.txt`
2. ✅ Read `data/focus.md` for your plan
3. ✅ Run daily for best results
4. ✅ Use natural language requests
5. ✅ Check logs on errors
6. ✅ Backups are automatic
7. ✅ Costs ~$0.50 per run

**Quick Commands:**
- Daily: `plan today`
- Evening: `plan tomorrow`
- Weekly: `plan my week`
- Deep: `full analysis`

**Support:**
- Documentation: README.md, CHANGELOG.md
- Logs: data/logs/
- Backups: data_backup/
- Database: data/chiefclarity.db

Happy planning! 🚀
