<!-- SYSTEM FILE - Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity - Answer Questions Only

- version: 1.0.0
- focus_schema_target: focus3-lite

> This command is a narrow Q&A pass. It does not process the full inbox, does not update strategy, and does not rebuild focus. It archives only answered Q&A entries to `data/answer.md`.

All file paths below refer to `data/` files, not `templates/`.

---

## Purpose

Use this command when the user wants Chief Clarity to answer only the questions listed in:

- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`

This command must:

1. Read only the files needed for Executive Q&A
2. Answer the questions using existing data only
3. Update `data/focus.md` -> `## Answers`
4. Archive the answered Q&A in `data/answer.md`
5. Clear the processed questions from `data/input.txt`

This command must not:

- read the full `INBOX` for processing
- classify input
- update `structured_input.md`
- update `OKR.md`
- update `focus_log.md`
- archive `input.txt`
- rewrite any part of `input.txt` outside `QUESTIONS FOR CHIEF CLARITY`
- generate task check-ins

---

## Step 1 - Read Questions Only

Read:

- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY` section only
- `data/answer.md`

Do not process any other section of `data/input.txt`.

Use `data/answer.md` first to check whether the same or a substantially similar question was already answered.

If a prior answer is still valid based on current `focus.md` and `OKR.md`, reuse it in a shortened form instead of rebuilding the answer from scratch.

If a prior answer appears stale or conflicts with current files, write a refreshed answer and treat the old one as historical context only.

---

## Step 2 - Primary Lookup (Fast Path)

Read these files first:

- `data/focus.md`
- `data/OKR.md`

Try to answer every question from these two files only.

If a question is answered well enough from `focus.md` and `OKR.md`, stop there and do not read anything else.

This is the default path because it is the cheapest and usually contains the most current synthesized state. `data/answer.md` is used before this step for duplicate detection, not as the primary factual source of truth.

---

## Step 3 - Fallback Lookup (Accuracy Path)

Only if a question cannot be answered accurately from `focus.md` and `OKR.md`, read the smallest additional context needed from this list:

- `data/user_profile.md`
- `data/history_digest.md`
- `data/objectives.md`
- `data/structured_input.md`
- `data/context_digest.md`

Only read a raw file from `data/context/` if a specific question requires exact details that are not available in `context_digest.md`.

Only read full `data/focus_log.md` if a specific question requires historical detail that is missing from `history_digest.md`.

Do not expand beyond this fallback path unless accuracy would otherwise be compromised.

---

## Step 4 - Answer Questions

Use the rules in `agents/cc_executive_agent.md`.

Requirements:

- Answer each question from `QUESTIONS FOR CHIEF CLARITY`
- Use existing files only
- Never invent facts
- Include sources for every answer as `file: section`
- If data is missing, say `Unknown from current files` and state what is missing
- Check `data/answer.md` first for duplicate or substantially similar questions
- Reuse prior answer structure when helpful, but validate it against current `focus.md` and `OKR.md`
- Prefer `focus.md` and `OKR.md` as the primary sources whenever they are sufficient
- If fallback files were needed, use only the minimum extra sources required
- If there are no questions, write `No questions this run.`

---

## Step 5 - Update Focus Output

Update only:

- `data/focus.md` -> replace the `## Answers` section only

Do not modify any other part of `data/focus.md`.

---

## Step 6 - Archive Answers

Append the answered questions to:

- `data/answer.md`

Rules:

- Preserve the existing frontmatter and append-only history
- Add new entries at the bottom
- One entry per answered question
- Use a timestamp in the user's timezone when available; if timezone is not read on the fast path and is needed, read `data/user_profile.md`
- Keep the existing log format:

```md
### {timestamp}
- question_id: {generated id}
- question: "{question text}"
- answer: "{answer text}"
- sources:
  - {file}: {section}
- notes: "(optional)"
```

- If there are no questions, do not append anything to `data/answer.md`

---

## Step 7 - Clean Up Processed Questions

After successfully writing answers:

- Update only the `QUESTIONS FOR CHIEF CLARITY` section in `data/input.txt`
- Remove the processed questions
- Leave the rest of `data/input.txt` unchanged
- Replace the section body with:

```txt
- (none)
```

If there were no questions, leave `data/input.txt` unchanged.
