# Chief Clarity v4 — Feedback & Self-Improvement

The system grades itself, identifies failures, proposes fixes, and queues them for
the developer's review. The goal: you review diffs in seconds instead of debugging
from scratch.

---

## 1. Three feedback channels

| Channel | Trigger | Latency | LLM |
|---|---|---|---|
| **A. Instant** | User explicitly says "that was wrong" or taps feedback button | Synchronous, ~2s | 1 Haiku call |
| **B. Implicit** | TypeScript detects behavioral signals (dismissed, edited, ignored, repeated request) | Real-time, $0 | None |
| **C. Nightly synthesis** | Batch review of all flagged interactions | Overnight | 1 Haiku batch run |

All three converge on the same output: **Pending Improvements**.

---

## 2. Channel A — Instant in-chat feedback

Triggered when the user:
- Types a phrase indicating dissatisfaction ("that was wrong", "you missed the point")
- Taps a thumbs-down or "this didn't help" button

The orchestrator routes the feedback phrase to a `feedback` skill. This is a normal
skill, subject to the same single-call rule. ONE Haiku call.

### Feedback skill input (Assembler provides)

```ts
{
  userFeedback: string;               // the user's complaint
  priorTurn: {
    userPhrase: string;               // the original request
    skillUsed: string;                // which skill handled it
    contextSent: ContextBlob;         // what the Assembler provided
    toolCallMade: ToolCall;           // what the LLM returned
    executorResult: ExecutorResult;   // what TypeScript did with it
  };
  userObjectives: Objective[];        // for context
}
```

### Feedback skill output (structured tool call)

```ts
{
  tool: "submit_feedback_evaluation",
  args: {
    failedAgent: "priority_planning",
    rootCause: "Synthesizer context did not include family-priority objective rule.",
    userReply: "You're right — I missed your family priority. Let me redo this.",
    proposedPatch: {
      targetType: "skill_prompt",
      targetId: "priority_planning",
      diff: "+ Family and health commitments always rank above work tasks unless the user explicitly overrides for this request."
    },
    autoCorrectionPhrase: "help me re-prioritize with family first",
    requiresApproval: true
  }
}
```

### Executor actions (after one Haiku call)

1. Post `userReply` to chat immediately (~2s after feedback received)
2. If `autoCorrectionPhrase` present: re-run it as a synthetic user phrase with the
   proposed patch applied in-memory (scoped to session only)
3. Write proposed patch to `pending_improvements` table with `status: "pending"`
4. Emit audit log entry

The in-memory patch is **session-scoped only**. The prompt file on disk does not
change until the developer reviews and approves via Pending Improvements. If the
session ends without approval, the patch remains in the queue, not applied.

---

## 3. Channel B — Implicit behavioral signals

TypeScript watches post-response behavior and scores each interaction.
No LLM calls. Runs continuously.

### Signal types

| Signal | Score | How detected |
|---|---|---|
| User acted on output | +2 | Executor detects follow-through action within 10 min |
| User accepted suggestion | +1 | User tapped "yes" / confirmed |
| Output ignored (no action in 4h) | -1 | Timer + no follow-through detected |
| User dismissed suggestion | -1 | Tap dismiss, or said "no thanks" |
| User edited output before using | -2 | Edit event captured with diff |
| User repeated similar request within 30 min | -3 | Embedding similarity > 0.80 between current and prior phrase |
| LLM returned low-confidence output | -1 | Skill manifest has `autoEvaluate: true` + tool output includes `confidence < 0.6` |
| Routing fell through to Haiku tiebreaker | -0.5 | Orchestrator method = "haiku" (ambiguous phrase) |

Interaction score = sum of applicable signals.

Interactions with score ≤ -2 are automatically flagged for nightly review.
Interactions with score ≥ +1 are tagged as positive examples (used for few-shot
context in future evaluator runs).

---

## 4. Channel C — Nightly synthesis

**File:** `src/modules/evaluatorAgent.ts`  
**Schedule:** Nightly (2am or configurable)  
**Cost:** One Haiku batch call, ~4000 tokens ≈ $0.0005/night

Input:
- All interactions flagged by Channel B (score ≤ -2) since last run
- A random sample of 5 unflagged interactions (sanity check)
- The current prompt file for each skill involved in flagged interactions
- Recent positive examples (score ≥ +1, for contrast)

The Haiku call clusters failures by pattern and generates proposals:

```ts
[
  {
    pattern: "priority_planning missed family rules 3 times this week",
    affectedInteractionIds: ["abc", "def", "ghi"],
    failedAgent: "priority_planning",
    rootCause: "Prompt does not explicitly state family/health precedence rule.",
    proposedPatch: {
      targetType: "skill_prompt",
      targetId: "priority_planning",
      diff: "+ Family and health items always rank above professional work unless user explicitly overrides for a specific request."
    },
    confidence: 0.87
  },
  {
    pattern: "calendar skill accepted meeting without checking existing conflicts",
    affectedInteractionIds: ["jkl"],
    failedAgent: "calendar",
    rootCause: "Conflict check tool not called before schedule_event tool.",
    proposedPatch: {
      targetType: "skill_prompt",
      targetId: "calendar",
      diff: "+ Always call check_conflicts before calling schedule_event. Never schedule without a conflict check."
    },
    confidence: 0.91
  }
]
```

All proposals written to `pending_improvements` table.

---

## 5. Pending Improvements UI

**File:** `app/pending-improvements.tsx`

Shows all pending proposals in a review queue. Each card shows:

- Which skill is affected
- The root cause in plain language
- A unified diff of the proposed prompt change (or policy change, or sensor config)
- The interactions that triggered it (user can tap to see the full exchange)
- Approve / Reject buttons

On **Approve:**
- Patch applied to `src/skills/<id>/prompt.md` (or relevant config file)
- Change committed to git with auto-generated message
- Affected interactions re-run against the new prompt (self-test, see below)
- `pending_improvements` row updated: `status: "approved"`

On **Reject:**
- Row updated: `status: "rejected"`, reason optionally recorded
- Proposal not re-raised unless Pattern Learner generates a distinct new one

---

## 6. Self-test on patch approval

When a patch is approved, the system replays the original failing interactions
against the updated prompt to verify the fix works:

```
[TS] For each interaction_id in proposal.affectedInteractionIds:
  1. Reconstruct original input: { phrase, contextBlob }
  2. Call Dispatcher with updated prompt (ONE Haiku call per interaction)
  3. Compare new output against the failure pattern
  4. Score: did the patch resolve the failure?
  If any interaction still fails → surface a "patch may be incomplete" warning
  If all pass → mark proposal: fully resolved
```

This closes the loop: the system validates its own fix before marking it done.

---

## 7. Diary Agent

**File:** `src/modules/diaryAgent.ts`  
**Schedule:** Weekly, Sunday 23:30 (after self-scoring, before archive)  
**Coverage window:** The week that **ended 7 days ago** (not the week just past)  
**Cost:** One Haiku call, ~5000 tokens ≈ $0.0007/run ≈ $0.003/month

### Why a 7-day lag instead of nightly

The user backfills notes for past days — sometimes 2, 3, or 6 days late. A nightly
diary run on day N has not yet seen the notes that will be written on days N+1
through N+6 *about* day N. Compressing the day prematurely loses those late notes
forever. A weekly run with a 7-day lag gives the user a full week to backfill before
the week is sealed.

### Coverage window

```
Run on Sunday 2026-04-26 at 23:30
  → Diary covers: Mon 2026-04-13 through Sun 2026-04-19
  → Skips: Mon 2026-04-20 through Sun 2026-04-26 (still mutable)
```

The trailing 14-day window of raw activity stays untouched and fully searchable.
Only data older than 7 days is eligible for diary compression; only data older than
14 days is eligible for archival.

### Input

- All activity from the vector DB for the **target week** (tasks created/completed,
  meetings, notes, decisions, interactions, mood/companion observations)
- User objectives active during that week (for framing progress)
- Prior weekly diary entry (for continuity of narrative)
- Sensor signals raised during the week (for thematic shape)

### Output

A weekly narrative entry stored in the `narratives` table:

```
"During the week of Apr 13–19 you focused on [Project X], completing
12 tasks and shipping [milestone]. [Objective Y] moved forward through a
mid-week meeting with [Contact A]. The latter half of the week shifted
toward [Topic B]. Two threads remained open going into the following week:
[Task Z] and [Follow-up C]. Family time included [generic activity] mid-week
and on the weekend."
```

No real names. Generic activity descriptions. See CLAUDE.md privacy rules.

### Narratives table change

```sql
-- v3 schema (per-day) is replaced. Migration: backfill existing rows with period_type="day"
ALTER TABLE narratives ADD COLUMN period_type TEXT NOT NULL DEFAULT 'week';  -- "day" | "week"
ALTER TABLE narratives ADD COLUMN period_start TEXT NOT NULL;                 -- ISO date, inclusive
ALTER TABLE narratives ADD COLUMN period_end TEXT NOT NULL;                   -- ISO date, inclusive
```

### Archival

After the weekly diary entry is written, raw activity data older than the retention
window (default: 90 days from `period_end`) is flagged for archival. Archived data
is compressed and moved out of the active vector DB but remains restorable.

### Synthesizer context impact

The Synthesizer's `recentDiaryNarrative` field now reads the **last 1–2 weekly
narratives** instead of the last 2 nightly entries. Context is coarser-grained but
the trailing 14 days of raw signals (sensor_signals, recent tasks/notes) remain
fully available — the Synthesizer was never solely reliant on diaries for recency.

---

## 8. Self-improvement cost summary

| Activity | Frequency | Cost |
|---|---|---|
| Channel A (instant feedback) | Per explicit feedback | ~$0.0002/event |
| Channel B (implicit scoring) | Continuous | $0 |
| Nightly evaluator | Nightly | ~$0.0005/night ($0.015/month) |
| Self-test on patch approval | Per approved patch | ~$0.001/patch (amortized) |
| Diary Agent | Weekly (7-day lag) | ~$0.0007/week ($0.003/month) |
| **Total** | | **~$0.02/month** |
