<!-- SYSTEM FILE - Do not modify. This file is part of the Chief Clarity engine. -->

# Chief Clarity - Analyze My Day

- version: 1.1.0
- pipeline_schema_target: cc4
- focus_schema_target: focus3-lite

> Use this command when the user wants a full day analysis and wants ChiefClarity to control the workflow. This command is intentionally thin. It does not hardcode the worker sequence.

All file paths below refer to `data/` files unless explicitly marked as `templates/`.

## Purpose

This is the ChiefClarity-first entrypoint for a full daily analysis.

This command does only four things:

1. Refresh shared digests
2. Run ChiefClarity
3. Read `run_manifest.json`
4. Execute the exact workflow chosen by ChiefClarity

If you find yourself manually reconstructing the pipeline inside this command, stop. That logic belongs in ChiefClarity and the worker agent specs.

## Step 0a - Refresh Context Digest

Update `data/context_digest.md` so unchanged context files do not need to be re-read.

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

## Step 0b - Refresh History Digest

Update `data/history_digest.md` incrementally from:

- `data/focus_log.md`
- `data/input_archive.md`

Read only entries newer than the stored `last-processed-date` when the digest already exists.

Write `data/history_digest.md` using the existing template format.

## Step 1 - Run ChiefClarity

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

ChiefClarity requirements for this command:

1. Set `run_mode` to `full_run`
2. Set the top-level intent to `analyze_my_day`
3. Decide which worker agents are needed
4. Decide their execution order
5. Decide which user questions route to `planning`, `companion`, or `both`
6. Decide whether any worker can be skipped
7. Record blockers, assumptions, and skip reasons

`run_manifest.json` must be the single source of truth for what runs next.

## Step 2 - Follow The Manifest

Read `data/run_manifest.json` and execute exactly what it says.

Do not rebuild the worker sequence in this command.

Rules:

1. Run only the agents listed in `agents_to_run`
2. Run them in the listed order
3. Use each agent's own spec as the source of truth for:
   - required inputs
   - optional inputs
   - outputs
   - allowed file updates
4. If `status` is `blocked`, stop and do not run workers
5. If a worker is skipped by ChiefClarity, do not reconstruct its outputs unless another agent spec explicitly allows minimal defaults

Valid worker agents for this command:

- `intake`
- `planning`
- `companion`
- `writer`

### Execution Mapping

- `intake` -> `agents/cc_intake_agent.md`
- `planning` -> `agents/cc_planning_agent.md`
- `companion` -> `agents/cc_companion_agent.md`
- `writer` -> `agents/cc_writer_agent.md`

## Step 3 - Archive Only If The Manifest Implies It

Archive `INBOX` into `data/input_archive.md` only if:

1. `intake` ran
2. `writer` ran successfully
3. ChiefClarity did not mark the run as blocked or partial in a way that should prevent archiving

If those conditions are not met, do not archive the inbox.

## Step 4 - End State Checks

Before ending:

1. Confirm `data/run_manifest.json` reflects what actually ran
2. Confirm `data/focus.md` still matches the `focus3-lite` section order if `writer` ran
3. Confirm `data/input.txt` still preserves unanswered `QUESTIONS FOR CHIEF CLARITY`

## Example Intention

For this command, ChiefClarity is expected to make decisions such as:

- no meaningful inbox updates -> skip `intake`
- no behavior signal and no companion-routed questions -> skip `companion`
- answer-only question load discovered during analysis -> route only those questions while still allowing a full render if needed
- blocked upstream state -> stop before `writer`

Those decisions belong in ChiefClarity output, not in this command file.
