<!-- SYSTEM FILE - Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity - Answer Questions Only

- version: 2.0.0
- pipeline_schema_target: cc4
- focus_schema_target: focus3-lite

> This command is a narrow Q&A pass. It does not process the inbox, does not rebuild the full dashboard, and does not update `OKR.md`.

All file paths below refer to `data/` files.

## Purpose

Use this command when the user wants answers only for:

- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`

This command must:

1. Route the questions
2. Answer them from existing files only
3. Update `data/focus.md` -> `## Answers`
4. Append the answered questions to `data/answer.md`
5. Clear only the processed questions from `data/input.txt`

This command must not:

- process `INBOX`
- update `structured_input.md`
- update `OKR.md`
- update `focus_log.md`
- archive `INBOX`
- rewrite any section of `input.txt` other than `QUESTIONS FOR CHIEF CLARITY`

## Step 1 - ChiefClarity

Use `agents/cc_chiefclarity_agent.md`.

Read:

- `data/user_profile.md`
- `data/input.txt`
- `data/focus.md`
- `data/OKR.md`
- `data/history_digest.md`
- `data/context_digest.md`

Write:

- `data/run_manifest.json`

This step must set `run_mode` to `answer_only` and route each question to `planning`, `companion`, or `both`.

## Step 2 - Planning Answers

Use `agents/cc_planning_agent.md`.

Read only the minimum required files:

- `data/user_profile.md`
- `data/OKR.md`
- `data/focus.md`
- `data/objectives.md`
- `data/history_digest.md`
- `data/context_digest.md`
- `data/structured_input.md` if needed
- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`
- `data/run_manifest.json`

Write:

- `data/plan_data.json`

This step should focus on answers for questions routed to `planning` or `both`. Leave non-answer dashboard fields valid but minimal if they are not needed for this run.

## Step 3 - Companion Answers

Use `agents/cc_companion_agent.md`.

Read only the minimum required files:

- `data/user_profile.md`
- `data/history_digest.md`
- `data/context_digest.md`
- `data/structured_input.md` if needed
- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`
- `data/run_manifest.json`

Write:

- `data/companion_data.json`

This step should focus on answers for questions routed to `companion` or `both`. If there are no companion-routed questions, write a minimal valid JSON object.

## Step 4 - Writer

Use `agents/cc_writer_agent.md`.

Read:

- `data/plan_data.json`
- `data/companion_data.json`
- `data/run_manifest.json`
- `data/focus.md`
- `data/input.txt`
- `data/answer.md`

Write:

- `data/focus.md` -> replace `## Answers` only
- `data/answer.md`
- `data/input.txt` -> remove only processed questions from `QUESTIONS FOR CHIEF CLARITY`

Do not modify any other section of `data/focus.md`.
