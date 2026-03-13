<!-- SYSTEM FILE - Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity - System Run

- version: 2.0.0
- pipeline_schema_target: cc4
- focus_schema_target: focus3-lite

> All file paths below refer to `data/` files, not `templates/`. Template files are used only as structure sources and initial setup assets.

Run the Chief Clarity pipeline in this order.

## Step 0a - Context Digest

Before running the pipeline, update `data/context_digest.md` so agents do not re-read unchanged context files.

Read:

- `data/context_digest.md` if it exists
- `data/context/*` file names and last-modified timestamps

For each file in `data/context/`:

1. Compare the file's last-modified time with the digest entry.
2. If the file is new or changed, read it fully and refresh its summary.
3. If unchanged, keep the prior summary.
4. If the file was removed, remove its digest entry.

Write `data/context_digest.md` in the existing template format.

If `data/context/` is empty or missing, write:

```md
# Context Digest

No context files.
```

## Step 0b - History Digest

Update `data/history_digest.md` incrementally from:

- `data/focus_log.md`
- `data/input_archive.md`

Read only entries newer than the stored `last-processed-date` when the digest already exists.

Write `data/history_digest.md` using the existing template format.

## Step 0c - ChiefClarity

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

This step must:

1. Set `run_mode` to `full_run`
2. Route each question in `QUESTIONS FOR CHIEF CLARITY`
3. Decide whether both `planning` and `companion` are needed
4. Record blockers before downstream steps run

## Step 1 - Intake

Use `agents/cc_intake_agent.md`.

Read:

- `data/user_profile.md`
- `data/input.txt` -> `INBOX`
- `data/objectives.md`
- `data/OKR.md`
- `data/context_digest.md`

Write:

- `data/structured_input.md`
- `data/intake_data.json`

## Step 2 - Planning

Use `agents/cc_planning_agent.md`.

Read:

- `data/user_profile.md`
- `data/objectives.md`
- `data/OKR.md`
- `data/structured_input.md`
- `data/intake_data.json`
- `data/history_digest.md`
- `data/context_digest.md`
- `data/focus.md`
- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`
- `data/run_manifest.json`

Update only if justified:

- `data/OKR.md`
- `data/user_profile.md`

Write:

- `data/plan_data.json`

## Step 3 - Companion

Use `agents/cc_companion_agent.md`.

Read:

- `data/user_profile.md`
- `data/structured_input.md`
- `data/intake_data.json`
- `data/history_digest.md`
- `data/context_digest.md`
- `data/input.txt` -> `QUESTIONS FOR CHIEF CLARITY`
- `data/run_manifest.json`

Write:

- `data/companion_data.json`

If ChiefClarity routed no questions to `companion` and there are no notable behavioral or emotional signals in the run, you may write a minimal valid JSON object with empty arrays and `unknown` state values.

## Step 4 - Writer

Use `agents/cc_writer_agent.md`.

Read:

- `templates/focus.md`
- `templates/focus_log.md`
- `templates/input.txt`
- `data/plan_data.json`
- `data/companion_data.json`
- `data/run_manifest.json`
- `data/focus.md`
- `data/input.txt`
- `data/answer.md`

Write:

- `data/focus.md`
- `data/focus_log.md`
- `data/input.txt`
- `data/answer.md`

Requirements:

1. Preserve the exact `focus.md` heading order from `templates/focus.md`
2. Replace `## Answers` using merged planning and companion answers
3. Append the run summary to `focus_log.md`
4. Rewrite `input.txt` with a fresh task check-in from `focus.md` -> `## Today`
5. Keep unanswered `QUESTIONS FOR CHIEF CLARITY` intact
6. Keep `QUESTIONS FROM CHIEF CLARITY` populated from `plan_data.json` and `companion_data.json`

## Step 5 - Archive Inbox

Append the processed `INBOX` content to `data/input_archive.md` with a timestamp after the writer step succeeds.

Do not rewrite prior archive history.
