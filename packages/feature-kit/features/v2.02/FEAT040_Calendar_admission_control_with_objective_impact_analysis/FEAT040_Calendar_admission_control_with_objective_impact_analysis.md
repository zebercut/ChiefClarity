# FEAT040 — Calendar admission control with objective impact analysis

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** MUST
**Category:** Calendar
**Priority:** 1
**Release:** v2.3
**Tags:** calendar, conflict, admission-control, objectives, focus
**Created:** 2026-04-07

**Depends on:** FEAT039 (Day/Week/Month objective layers) — admission control needs `objectives.json` to compute impact.
**Independent of:** FEAT037, FEAT038 — works with or without them, but is more accurate paired with both.

---

## Summary

Today, calendar events are written through the executor like any other data. Conflict detection runs *after* the LLM has already produced the write, and only checks time overlap. There's no concept of "this new meeting will eat the only remaining block I had for a weekly objective."

This feature introduces an **admission control layer** that sits in front of `executor.ts` for any new calendar event. Before a calendar write is committed, TypeScript computes:

1. **Time overlap** with existing events (already done)
2. **Free-block consumption** — which free blocks does this consume?
3. **Objective impact** — which weekly/daily objectives lose the time they were depending on?
4. **Slip risk** — which OKRs fall behind pace if the affected objectives are deferred?

The LLM then translates this structured impact summary into a natural-language warning and offers 2–3 concrete options (accept-and-reschedule, decline, shorten, move). The user decides; the executor commits the chosen path.

This is the feature that turns the system into a *focus partner*, not a calendar app.

---

## Problem Statement

Today, when the user adds a new meeting:

- Best case: the system detects a time overlap and warns about it.
- Worst case: it silently accepts the meeting, even though it just consumed the only 2-hour block this week the user had reserved for a critical weekly objective.

There's no way for the system to say *"this meeting kills your client proposal — are you sure?"* because (a) there are no explicit weekly objectives to protect (FEAT039 fixes this) and (b) there's no admission control gate to compute impact (this feature).

---

## User Stories

### Story 1 — Honest impact warnings
**As a** user, **I want** the system to tell me what I'm giving up when I accept a new meeting **so that** I can make an informed trade-off.

**Acceptance Criteria:**
- [ ] When adding a calendar event that consumes a block tied to a `must` weekly objective, an impact warning fires.
- [ ] The warning names the affected objective(s), the OKR pace impact, and 2–3 options.
- [ ] Accepting the warning commits the event; declining returns to no-op.

### Story 2 — Quiet on low-stakes additions
**As a** user, **I want** routine additions (1:1s, lunches, ambient blocks) to commit without ceremony **so that** I'm not spammed with dialogs.

**Acceptance Criteria:**
- [ ] If no `must` objective is impacted and no time overlap exists, the event commits with a one-line confirm only.
- [ ] If only `could` / ambient objectives are impacted, a soft heads-up appears but no choice prompt.

### Story 3 — Survival-mode bypass
**As a** user, **I want** the system to skip impact analysis on survival days **so that** it doesn't lecture me on a back-to-back day.

**Acceptance Criteria:**
- [ ] When `objectives.day.survivalMode === true`, admission control runs time-overlap check only and skips objective impact analysis.

### Story 4 — Apply to all calendar entry paths
**As a** user, **I want** admission control to fire whether the event comes from chat, inbox, recurring rule, or anywhere else **so that** the gate is consistent.

**Acceptance Criteria:**
- [ ] All calendar write paths (chat, inbox, recurring instance creation, annotation actions) flow through admission control.

---

## Workflow

```
Source (chat / inbox / recurring) produces a calendar_create write
    ↓
admissionControl.evaluate(write, state)
    ├── 1. timeOverlap = conflict.detectOverlap()
    ├── 2. consumedBlocks = freeBlocksConsumedBy(write)
    ├── 3. impactedObjectives =
    │      objectives that depended on consumedBlocks
    │      (joins objectives.day + objectives.week)
    ├── 4. slipRisk = okrPaceImpact(impactedObjectives)
    └── returns AdmissionResult { severity, summary, options[] }
    ↓
severity decision:
    ├── none → executor.applyWrites() directly, one-line confirm
    ├── soft → executor commits, append "FYI: ..." to chat reply
    └── high → return needsClarification: true with options[]
              wait for user choice
              executor commits chosen path
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| No overlap, no impact | Commit silently with one-line confirm |
| Overlap but no objective impact (e.g., free time) | Show overlap warning only (current behavior) |
| Impact on `must` weekly objective | High-severity dialog with named impact + options |
| Impact on `could` / ambient objective | Soft FYI line, commit |
| Survival mode active for today | Skip impact check, time-overlap only |
| User accepts and chooses "reschedule X" option | Admission control returns a follow-up `task_update` / `calendar_update` write |
| Recurring rule creates 5 instances at once | Run admission control per instance; bundle warnings into one summary |
| Inbox parses 10 events at once | Aggregate impact across all events; one batch warning |
| Bypass via explicit "force add" phrase | Skip admission control, log to suggestions log |

---

## Success Metrics

- 0 silent commits of events that destroy `must` weekly objectives.
- Soft warnings fire for ≤30% of routine additions (otherwise we're crying wolf).
- User-reported "the system protects my focus" sentiment improves.
- Manual test: adding a 2h meeting onto a deep-work block tied to a `must` weekly objective produces a high-severity dialog with named impact.

---

## Out of Scope

- Day/Week/Month objective layers themselves → FEAT039 (dependency)
- Auto-rescheduling without user confirmation → never
- Calendar imports from external sources → handled separately
- Negotiating meetings with other people → never (this is a personal app)
- Predicting future meetings the user might want to add → defer

---

## Architecture Notes

### New module: `src/modules/admissionControl.ts`

```typescript
export interface AdmissionResult {
  severity: "none" | "soft" | "high";
  timeOverlaps: ConflictReport[];
  consumedBlocks: { date: string; block: string }[];
  impactedObjectives: {
    id: string;
    title: string;
    layer: "day" | "week";
    priority: "must" | "should" | "could";
  }[];
  slipRisk: {
    okrId: string;
    okrTitle: string;
    daysBehind: number;
  }[];
  summary: string;                       // structured input for the LLM to translate
  options: AdmissionOption[];
}

export interface AdmissionOption {
  label: string;                         // "accept and reschedule client proposal to next week"
  writes: WriteOperation[];              // pre-computed write set if user picks this
}

export function evaluate(
  write: WriteOperation,
  state: AppState,
): AdmissionResult;
```

### Severity rules

- `none` — no overlaps, no objective impact
- `soft` — overlap with free time, or impact on `could` / ambient objectives only
- `high` — overlap with another event, OR impact on at least one `must` weekly objective

### LLM integration

- When severity is `high`, the executor pauses, the assembler builds a small `admission_review` context (the AdmissionResult + relevant objectives), and the LLM is called to produce a natural-language warning + final phrasing of the options.
- The user's choice routes through the existing `_pendingContext` clarification mechanism — no new state machine.
- When severity is `soft`, no LLM call; TypeScript appends a templated FYI line to the executor's existing reply.

### Sacred boundary check

- TypeScript owns: overlap detection, free-block math, objective impact joining, slip computation.
- LLM owns: turning the structured impact into language and final option phrasing.
- The LLM never decides whether to commit. It only writes words.

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/modules/admissionControl.ts` | NEW — `evaluate()`, severity rules, option pre-computation. |
| [src/modules/conflict.ts](../../../../src/modules/conflict.ts) | Export `detectOverlap()` for reuse; no behavioral change. |
| [src/modules/agendaMerger.ts](../../../../src/modules/agendaMerger.ts) | Export helpers for free-block math. |
| [src/modules/executor.ts](../../../../src/modules/executor.ts) | For `calendar` adds, route through `admissionControl.evaluate()` first. Honor `severity` to decide commit / soft FYI / high-severity pause. |
| [src/modules/inbox.ts](../../../../src/modules/inbox.ts) | When parsing produces calendar writes, run admission control on the batch. |
| [src/modules/recurringProcessor.ts](../../../../src/modules/recurringProcessor.ts) | Run admission control per generated instance. |
| [src/types/index.ts](../../../../src/types/index.ts) | New `AdmissionResult`, `AdmissionOption` types. |
| [src/constants/prompts.ts](../../../../src/constants/prompts.ts) | New `admission_review` intent prompt block: how to phrase impact warnings, how to format options. |
| [src/modules/router.ts](../../../../src/modules/router.ts) | New `admission_review` intent (LLM-only, never user-typed; routed via `_pendingContext`). |
| [src/modules/assembler.ts](../../../../src/modules/assembler.ts) | New context case for `admission_review`. |
| `docs/new_architecture_typescript.md` | New section: "Calendar Admission Control"; update intent table, module table, data flow diagram. |
| `README.md` | Document the impact-warning behavior. |

---

## Testing Notes

- [ ] Unit test: `evaluate()` with no impact returns `severity: none`.
- [ ] Unit test: `evaluate()` with `must` objective impact returns `severity: high` and names the objective.
- [ ] Unit test: `evaluate()` in survival mode skips objective check.
- [ ] Integration test: chat-driven calendar add that destroys a deep-work block produces a high-severity dialog.
- [ ] Integration test: routine 1:1 addition commits silently.
- [ ] Integration test: inbox-driven batch of 10 events aggregates into one warning.
- [ ] Integration test: user picks "accept and reschedule" → both writes commit.
- [ ] Regression: existing time-overlap warnings still fire.

---

## Open Questions

- Should admission control also fire on calendar **updates** (rescheduling) and not just creates? Recommendation: yes — moving an event into a critical block is the same problem.
- Should the user be able to mark a meeting as "untouchable" (immune to future admission warnings about it)? Recommendation: defer to v2.4.
- Should slip-risk be shown as a number ("2 days behind pace") or a qualitative label ("on track / at risk / behind")? Recommendation: qualitative — numbers invite false precision.
- What happens when the user has no weekly objectives set (skipped review)? Recommendation: degrade to time-overlap-only mode and prompt for a weekly review.
