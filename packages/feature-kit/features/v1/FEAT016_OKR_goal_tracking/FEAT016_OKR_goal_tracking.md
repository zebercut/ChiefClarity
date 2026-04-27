# FEAT016 — OKR goal tracking with dual-measurement

Full OKR (Objectives and Key Results) system with two independent progress measurements per KR: activity progress and outcome progress.

---

## What this delivers

A structured goal tracking system where each Key Result shows two things side-by-side: how much work you've done (activity) and how close you are to the target (outcome). This prevents the common trap of confusing busyness with results.

## Capabilities (shipped)

### Dual-Measurement Model
- **Activity progress** — auto-computed from linked task completion (tasks done / total tasks per KR). Requires zero manual input.
- **Outcome progress** — auto-computed from `currentValue / targetValue`. User provides only the raw measurement; system does the math.
- Both measurements roll up from KR level to objective level (average of KR values).

### Three KR Target Types
- **Numeric** — count toward a number (e.g., target: 500000, unit: "followers"). Outcome = currentValue / targetValue.
- **Percentage** — hit a rate (e.g., target: 80, unit: "%"). Outcome = currentValue / targetValue.
- **Milestone** — binary/checklist progress. User sets currentValue to 0, 25, 50, 75, or 100 to indicate stage. currentNote describes the milestone reached.

### OKR Dashboard
- Create and manage objectives with status (active, parked, completed).
- Add key results with structured targets (type, value, unit).
- Link tasks to KRs via `okrLink` field — activity progress computed automatically.
- Decision logging per objective (capped at 5, older pushed to context memory).
- Focus period with start/end dates.
- Optional per-KR due dates that override the focus period for pace checking.

### Proactive KR Value Nudges
- System detects stale KR values (never set or >7 days since last update).
- Fires a nudge per stale KR with 7-day cooldown.
- Nudge opens chat pre-filled with "Update my KR values" for easy input.
- OKR pace check compares outcome progress against expected timeline — nudges when 15+ points behind.

### Display
- Dual progress bars in Focus Brief (HTML export) — Activity (blue) and Outcome (green).
- Dual progress bars in React Native Focus screen — same layout.
- Per KR row shows both percentages and raw value/target.
- KRs with no linked tasks show "—" for activity instead of misleading 0%.

### Data Migration
- Auto-migrates from old single-progress format on first load.
- Guesses target type from old freetext target strings (e.g., "80%" becomes percentage, "TBD" becomes milestone).
- Preserves existing qualitative notes in currentNote field.

## Architecture

### Data Model (plan_okr_dashboard.json)
- `OkrKeyResult`: 9 stored fields — id, title, metric, targetType, targetValue, targetUnit, currentValue, currentNote, lastUpdated, optional dueDate.
- `OkrObjective`: activityProgress and outcomeProgress are CACHE — computed by summarizer every turn, never trusted as source of truth.
- Progress computation happens in `summarizer.ts` (compute-on-write pattern, same as hotContext).

### Module Responsibilities
- **Summarizer** — computes both progress values from raw data (task counts + currentValue/targetValue). Runs migration on old data.
- **Executor** — handles nested OKR writes (objectives, KRs via `_targetObjective`, decisions via `_addDecision`). Sets defaults for new KRs.
- **Assembler** — injects `okrProgress` map (per-KR activity/outcome/task counts) into `full_planning` and `okr_update` contexts.
- **LLM** — writes `currentValue`, `currentNote`, `lastUpdated` only. Never writes progress fields.
- **Proactive Engine** — `checkStaleKrValues()` for weekly value prompts, `checkOkrPace()` for timeline checks.

### Key Design Decisions
- Computed values not persisted on KRs — derived from raw data each turn.
- LLM never sets progress numbers — only raw values. System computes percentages.
- Three target types cover all real-world KR patterns without overcomplicating the model.
- No `startValue` field — default is always 0 for personal OKR.
- Executor stays dumb (Object.assign) — validation lives in the prompt, computation in the summarizer.
