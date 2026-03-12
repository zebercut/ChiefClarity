<!-- SYSTEM FILE — Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity — System Run

- version: 1.1.0
- focus_schema_target: focus3-lite

> **All file paths below refer to `data/` files, NOT `templates/`.** Template files are used only for initial setup — never read them during a pipeline run.

Run the **Chief Clarity multi-agent pipeline** in the following order.

---

## Step 0a — Context Digest

Before running the pipeline, update the context digest so agents don't re-read unchanged files.

**Read:**
- `data/context_digest.md` (if it exists — this is the previous digest)
- `data/context/*` (list all files and check their last-modified dates)

**For each file in `data/context/`:**
1. Compare the file's last-modified date to the date recorded in `context_digest.md`
2. If the file is **new or modified** → read it fully and write a summary (3-5 bullet points of key data)
3. If the file is **unchanged** → keep the existing summary from the previous digest
4. If a file in the digest **no longer exists** → remove it from the digest

**Write:**
- `data/context_digest.md` — one entry per context file:

```
# Context Digest
Last updated: {timestamp}

## {filename}
- modified: {last-modified date of the file}
- summary:
  - {key data point 1}
  - {key data point 2}
  - {key data point 3}
```

If `data/context/` is empty or doesn't exist, write: `# Context Digest\n\nNo context files.`

---

## Step 0b — History Digest

Update the history digest so agents don't re-read the full `focus_log.md` or `input_archive.md` every run. Use **incremental reading** — after the first build, only new entries are processed.

**Read:**
- `data/history_digest.md` (if it exists — previous digest)

### Focus Log

1. Read `data/history_digest.md` → `## Focus Log` → `last-processed-date`
2. **If no digest exists (first run):** read full `data/focus_log.md`, extract patterns, write digest with `last-processed-date` set to today
3. **If digest exists:** read ONLY entries in `data/focus_log.md` dated AFTER `last-processed-date`
4. Merge new patterns with existing patterns in the digest. Update `last-processed-date`. Keep last 3 entries as recent context.
5. If no new entries found: keep digest as-is, skip re-write

### Input Archive

Same incremental approach for `data/input_archive.md`:
1. Read `data/history_digest.md` → `## Input Archive` → `last-processed-date`
2. **If first run:** read full `data/input_archive.md`, extract recurring themes, write digest
3. **If digest exists:** read ONLY entries appended AFTER `last-processed-date`
4. Merge new themes with existing themes. Update `last-processed-date`
5. If no new entries found: keep digest as-is, skip re-write

**Write:**
- `data/history_digest.md` — using the format from `templates/history_digest.md`

---

## Step 0c — Shared State

Read `data/user_profile.md` and `data/objectives.md` ONCE here. These files rarely change and are needed by all agents. Carry their content forward through all subsequent steps.

---

## Step 1 — Intake Processing

*Use the Intake Agent rules* (`agents/cc_intake_agent.md`).

**Read:**
- `data/user_profile.md`
- `data/input.txt` (*INBOX* section)
- `data/objectives.md`
- `data/OKR.md`
- `data/context_digest.md`

**Write:**
- `data/structured_input.md`

---

## Step 2 — Strategy Engine

*Use the Strategy Agent rules* (`agents/cc_strategy_agent.md`).

**Read:**
- `data/user_profile.md`
- `data/objectives.md`
- `data/OKR.md`
- `data/structured_input.md`
- `data/context_digest.md`

**Update:**
- `data/OKR.md`
- `data/input.txt` -> *QUESTIONS FROM CHIEF CLARITY* (if questions arise)

---

## Step 3 — Focus Analysis

*Use the Focus Agent rules* (`agents/cc_focus_agent.md`).

**Read:**
- `data/user_profile.md` (pre-read in Step 0c)
- `data/OKR.md`
- `data/objectives.md` (pre-read in Step 0c)
- `data/history_digest.md`
- `data/structured_input.md`
- `data/context_digest.md`

> Only read full `data/focus_log.md` or `data/input_archive.md` if the digest lacks specific detail needed for today's analysis.

**Update (ALWAYS — even if no new input):**
- `data/focus.md`
- `data/focus_log.md`
- `data/OKR.md` (task priorities only, if justified)
- `data/input.txt` -> *QUESTIONS FROM CHIEF CLARITY* (if questions arise)

---

## Step 4 — Executive Q&A

*Use the Executive Agent rules* (`agents/cc_executive_agent.md`).

**Read:**
- `data/user_profile.md` (pre-read in Step 0c)
- `data/focus.md`
- `data/history_digest.md`
- `data/OKR.md`
- `data/objectives.md` (pre-read in Step 0c)
- `data/structured_input.md`
- `data/input.txt` (*QUESTIONS FOR CHIEF CLARITY* section)
- `data/context_digest.md`

**Update:**
- `data/focus.md` — `## Answers` section only

---

## Step 5 — Archive Inbox & Generate Task Check-In

Append the processed content from `input.txt` -> *INBOX* section to `data/input_archive.md` with timestamp.

Then **rewrite `input.txt`** with:

1. **INBOX section** — include date headers for yesterday, today, and tomorrow.
2. **TASK CHECK-IN section** — read `data/focus.md` → *Today* and generate a yes/no checklist for each numbered item. This reduces typing — the user just marks done/not done.

```
TASK CHECK-IN ({today's date})
==============================
(Mark each task: yes / no / partial. Add a short note if needed.)

1. [ ] {Task name from Today} — {why it matters, from focus.md}
2. [ ] {Task name}
3. [ ] {Task name}
```

3. **QUESTIONS FROM CHIEF CLARITY** — keep any questions written by agents during this run. If no questions were written, keep `- (none)`.
4. **QUESTIONS FOR CHIEF CLARITY** — keep intact.
