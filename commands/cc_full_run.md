<!-- SYSTEM FILE — Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity — System Run

Run the **Chief Clarity multi-agent pipeline** in the following order.

---

## Step 0 — Context Digest

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

## {filename}
- modified: {last-modified date}
- summary:
  - ...
```

If `data/context/` is empty or doesn't exist, write: `# Context Digest\n\nNo context files.`

---

## Step 1 — Intake Processing

*Use the Intake Agent rules* (`agents/cc_intake_agent.md`).

**Read:**
- `data/user_profile.md`
- `data/input.txt` (*INBOX* section)
- `data/objectives.md`
- `data/OKR.md`
- `data/context_digest.md` (context summary — do not re-read raw context files unless a question requires deeper detail from a specific file)

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
- `data/context_digest.md` (context summary — do not re-read raw context files unless a question requires deeper detail from a specific file)

**Update:**
- `data/OKR.md`
- `data/input.txt` -> *QUESTIONS FROM CHIEF CLARITY* (if questions arise)

---

## Step 3 — Focus Analysis

*Use the Focus Agent rules* (`agents/cc_focus_agent.md`).

**Read:**
- `data/user_profile.md`
- `data/OKR.md`
- `data/objectives.md`
- `data/focus_log.md`
- `data/structured_input.md`
- `data/input_archive.md`
- `data/context_digest.md` (context summary — do not re-read raw context files unless a question requires deeper detail from a specific file)

**Update (ALWAYS — even if no new input):**
- `data/focus.md` (rewrite in place — never skip, deadlines get closer every run)
- `data/focus_log.md` (append only)
- `data/OKR.md` (task priorities only, if justified)
- `data/input.txt` -> *QUESTIONS FROM CHIEF CLARITY* (if questions arise, especially WHY questions for off-focus activity)

---

## Step 4 — Executive Q&A

*Use the Executive Agent rules* (`agents/cc_executive_agent.md`).

**Read:**
- `data/user_profile.md`
- `data/focus.md`
- `data/focus_log.md`
- `data/OKR.md`
- `data/objectives.md`
- `data/structured_input.md`
- `data/input.txt` (*QUESTIONS FOR CHIEF CLARITY* section)
- `data/context_digest.md` (context summary — do not re-read raw context files unless a question requires deeper detail from a specific file)

**Update:**
- `data/focus.md` — `## Answers` section only (do not modify other sections)

---

## Step 5 — Archive Inbox & Generate Task Check-In

Append the processed content from `input.txt` -> *INBOX* section to `data/input_archive.md` with timestamp.

Then **rewrite `input.txt`** with:

1. **INBOX section** — Include date headers for yesterday, today, and tomorrow so the user knows where to add notes:

```
INBOX
======
(Add new notes/tasks/answers here. Free-form is fine.)
(Answer the Task Check-In below — just write yes/no or a short note next to each item.)

{Yesterday's date, e.g. March 7, 2026 (Sat)}
(anything from yesterday you forgot to mention?)

{Today's date, e.g. March 8, 2026 (Sun)}


{Tomorrow's date, e.g. March 9, 2026 (Mon)}

```

2. **TASK CHECK-IN section** — Read `data/focus.md` → *Today's Focus* and generate a yes/no checklist for each task. This reduces typing — the user just marks done/not done. Format:

```
TASK CHECK-IN ({today's date})
==============================
(Mark each task: yes / no / partial. Add a short note if needed.)

1. [ ] {Task name from Today's Focus} — {why it matters, from focus.md}
2. [ ] {Task name}
3. [ ] {Task name}
...
```

3. **QUESTIONS FROM CHIEF CLARITY** — Keep any questions written by agents during this run (Steps 2 & 3). If no questions were written, keep the placeholder `- (none)`.

4. **QUESTIONS FOR CHIEF CLARITY** — Keep intact (preserve any user questions that weren't answered yet, or leave empty).
