# FEAT046 — Focus Brief UI redesign with interactive sections and reduced chat noise

**Type:** feature
**Status:** Design Reviewed | **Progress:** 0%
**MoSCoW:** MUST
**Category:** UX
**Priority:** 1
**Release:** v4.0
**Tags:** ux, brief, focus, interactive, chat, companion, redesign
**Created:** 2026-04-12
**Design Reviewed:** 2026-04-12

---

## Summary

Redesign the Focus Brief (Focus tab) into a structured, interactive daily command center with clearly defined sections. Simultaneously reduce noise in the Chat tab by keeping it lightweight — chat is for quick input/output, the Focus tab is where the user lives and acts on their day.

---

## Problem Statement

### Focus tab is a flat wall of information

The current Focus tab renders the brief as a single scrollable page with interleaved calendar, priorities, risks, OKR, and companion sections. There's no visual hierarchy that guides the eye. Everything looks the same importance. The user has to scan the entire page to find what matters.

### Chat is overloaded

When the user asks "plan my day", the chat response includes the full brief inline — summary, all priorities, all risks, calendar, companion note. This creates a massive message bubble that pushes the conversation off-screen. The user then has to switch to the Focus tab to see the same information in a slightly different format. The chat should show a concise confirmation ("Your day is planned — check the Focus tab") and let the Focus tab be the command center.

### Tasks are not interactive in the brief

The daily brief shows tasks as text. The user can't mark them done, postpone, or drop them from the brief — they have to go to the Chat or Tasks tab. The brief should be where the user acts on their day.

---

## Design: Section layout (top to bottom)

### Section 1: Today's Snapshot (hero card)

Dark gradient card at the top. Personalized greeting + 3-4 sentence narrative hitting the critical beats of the day. Bolded keywords for scanability. Energy tip at the bottom.

```
┌──────────────────────────────────────────┐
│  ✨ GOOD MORNING, [USER]!               │
│                                          │
│  You have a **packed day** — the         │
│  **Q3 Roadmap Review at 2 PM** is your   │
│  biggest leadership moment this week...  │
│                                          │
│  ⚡ Front-load hard thinking before noon │
└──────────────────────────────────────────┘
```

**Data source:** `brief.executiveSummary` + `brief.companion.energyRead`

### Section 2: Mindset (companion mini-cards)

3 horizontal cards from the companion agent. Each card is a behavioral nudge — not generic productivity advice, but personalized insights from the user's observed patterns.

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ 🐸 EAT THE  │ │ ⏱ 2-MINUTE  │ │ 🧘 TRANSITION│
│    FROG      │ │    RULE      │ │    RITUAL    │
│ Your hardest │ │ If a task    │ │ Before the   │
│ task is the  │ │ takes < 2min │ │ meeting,     │
│ budget...    │ │ do it now.   │ │ take 3 deep  │
│              │ │              │ │ breaths...   │
└─────────────┘ └─────────────┘ └─────────────┘
```

**Data source:** NEW — `brief.companion.mindsetCards[]`. The LLM generates 2-3 cards from `patternsToWatch`, `copingSuggestion`, and `wins`. TypeScript can also generate static cards for common patterns (e.g., "2-minute rule" for users with many small tasks).

### Section 3: Focus layers (Daily / Weekly / Monthly)

Three side-by-side columns showing the focus at each time horizon. Gives the user a sense of what matters NOW vs this week vs this month.

```
┌─ DAILY FOCUS ──┐ ┌─ WEEKLY FOCUS ─┐ ┌─ MONTHLY FOCUS ┐
│ • Finalize Q3   │ │ • Complete     │ │ • Launch fall   │
│ • Review mockups│ │   marketing   │ │   campaign      │
│ • Send budget   │ │ • Align with   │ │ • Hit 50k MQL   │
│                  │ │   Horizon     │ │ • Onboard new   │
│                  │ │               │ │   strategist    │
└──────────────────┘ └───────────────┘ └────────────────┘
```

**Data source:** `brief.priorities` (daily), + NEW fields: `brief.weeklyFocus[]` and `brief.monthlyFocus[]` from OKR objectives and weekly plan.

### Section 4: Today's Tasks (interactive)

The core interactive section. Shows tasks due today + overdue, with quick-action buttons per task.

```
┌──────────────────────────────────────────┐
│ 📋 TODAY'S TASKS                    4/7  │
├──────────────────────────────────────────┤
│ ○ Finalize Q3 campaign strategy    HIGH  │
│   Due: Today · SaddleUp                  │
│   [✓ Done] [→ Tomorrow] [→ Next week] [✗]│
├──────────────────────────────────────────┤
│ ○ Review ad creative mockups     MEDIUM  │
│   Due: Yesterday (1d overdue) · Work     │
│   [✓ Done] [→ Tomorrow] [→ Next week] [✗]│
├──────────────────────────────────────────┤
│ ✓ Send budget summary to CFO      DONE  │
│   Completed at 10:30                     │
└──────────────────────────────────────────┘
```

**Actions per task:**
- **Done** → marks task done, strikethrough, Tier 1 brief patch
- **Tomorrow** → reschedules due date to tomorrow
- **Next week** → reschedules due date to next Monday
- **Drop** → deletes the task (with confirmation)

**Data source:** `state.tasks.tasks` filtered to `due <= today` and `status != done`, plus recently completed (today). NOT from the brief's additions — live from the tasks table.

**Interaction:** Each action calls `executeDirectAction()` → `flush()` → `patchBrief()` → re-render. Instant, no LLM.

### Section 5: Today's Agenda (timeline)

Visual timeline of the day's schedule — routine + additions, with completed items struck through.

```
┌──────────────────────────────────────────┐
│ 📅 TODAY'S AGENDA                        │
├──────────────────────────────────────────┤
│ 07:00  Morning routine          routine  │
│ 08:30  Deep work block           work    │
│ 10:00  ━━ Client call ━━        FIXED    │
│ 11:00  Blog prep session         work    │
│ 12:00  Lunch                    routine  │
│ 13:00  [FREE — 60min]                    │
│ 14:00  Q3 Roadmap Review        FIXED    │
│ 15:30  Admin block               admin   │
│ 17:00  Family time              family   │
└──────────────────────────────────────────┘
```

**Data source:** `mergeWeekCalendar(brief, today)` — the existing merged timeline.

### Section 6: Next 7 Days (collapsible)

Collapsed by default. Shows the next 7 days as a compact grid/list.

```
▶ NEXT 7 DAYS                         [expand]
┌──────────────────────────────────────────┐
│ Mon Apr 13: 3 tasks, 2 events            │
│ Tue Apr 14: 5 tasks, activity pickup      │
│ Wed Apr 15: Tax deadline, 2 tasks        │
│ ...                                      │
└──────────────────────────────────────────┘
```

**Data source:** `brief.days[]` for multi-day briefs, or `state.tasks + state.calendar` for next 7 days.

### Section 7: Companion (expanded)

Full companion section — mood, motivation, patterns to watch, coping suggestion, wins, focus mantra. Bigger presence than in the current brief.

```
┌──────────────────────────────────────────┐
│ 🧠 YOUR COMPANION                       │
├──────────────────────────────────────────┤
│ Energy: 🟢 High                          │
│ Mood: Cautiously optimistic              │
│                                          │
│ "Strong morning — 4 tasks cleared before │
│ noon. The interview pressure is real but  │
│ you're preparing well. One thing at a    │
│ time."                                   │
│                                          │
│ 🏆 Recent wins:                          │
│   • Completed migration to libSQL        │
│   • Blog post published on time          │
│                                          │
│ ⚠️ Watch for:                            │
│   • Overcommitting (14 open tasks)       │
│   • Late-night coding sessions           │
│                                          │
│ 💡 Try: Take a 5-min walk before the    │
│    afternoon review.                     │
│                                          │
│ 🎯 "Finish strong."                     │
└──────────────────────────────────────────┘
```

**Data source:** `brief.companion`

### Section 8: Risks & Blockers

```
┌──────────────────────────────────────────┐
│ ⚠️ RISKS & BLOCKERS                     │
├──────────────────────────────────────────┤
│ 🔴 HIGH  Property tax overdue — 3 days   │
│ 🟡 MED   Insurance blocker pending       │
│ 🟢 LOW   Low application volume          │
└──────────────────────────────────────────┘
```

**Data source:** `brief.risks`

### Section 9: OKR Progress

```
┌──────────────────────────────────────────┐
│ 🎯 OKR PROGRESS                         │
├──────────────────────────────────────────┤
│ Obj 1: Income stability                  │
│   Activity ████████░░ 80%                │
│   Outcome  ████░░░░░░ 40%               │
│   KR: Revenue target — $42k / $50k       │
│                                          │
│ Obj 2: SaddleUp growth                   │
│   Activity ██████░░░░ 60%                │
│   Outcome  ███░░░░░░░ 30%               │
└──────────────────────────────────────────┘
```

**Data source:** `brief.okrSnapshot` + live `state.planOkrDashboard`

---

## Chat noise reduction

### Current problem

When the user says "plan my day", the chat response includes the full brief inline — every priority, every risk, the companion note, the agenda. This creates a wall of text that buries the conversation.

### Solution

For `full_planning` intent, the chat response becomes a concise summary + a link to the Focus tab:

```
Assistant: Your day is planned! Here's the quick version:
- 7 tasks on deck, 3 high priority
- Key event: Q3 Roadmap Review at 2 PM
- Watch out: property tax overdue
→ See full brief in the Focus tab

[Open Focus Tab]
```

The full rich content lives in the Focus tab. Chat stays conversational.

### Implementation

In `processPhrase()`, after a `focusBrief` write:
- Don't render the full brief in the chat message
- Use the `executiveSummary` as the reply (already concise — 4-6 bullets)
- Add a `SmartAction` button: "Open Focus Tab" → `router.push("/(tabs)/focus")`

---

## New types needed

```typescript
// Add to FocusBrief:
weeklyFocus?: string[];   // 2-3 items for weekly column
monthlyFocus?: string[];  // 2-3 items from OKR objectives

// Add to CompanionBrief:
mindsetCards?: Array<{
  icon: string;     // emoji
  title: string;    // "EAT THE FROG"
  body: string;     // personalized advice
}>;
```

---

## Work packages

### WP-1: Restructure Focus tab layout

Rewrite `app/(tabs)/focus.tsx` with the 9 sections in order:
1. Today's Snapshot (hero card)
2. Mindset (companion mini-cards)
3. Focus layers (Daily / Weekly / Monthly)
4. Today's Tasks (interactive)
5. Today's Agenda (timeline)
6. Next 7 Days (collapsible)
7. Companion (expanded)
8. Risks & Blockers
9. OKR Progress

Each section is a separate React component for clean separation.

### WP-2: Interactive task actions in Focus tab

Wire the task section with direct actions:
- Done → `executeDirectAction("mark_done", taskId, state)` → `patchBrief()` → re-render
- Tomorrow → update task due date → flush → patchBrief
- Next week → update task due date → flush → patchBrief
- Drop → delete task → flush → patchBrief

Uses existing `executeDirectAction` from `smartActions.ts`.

### WP-3: Chat noise reduction for planning

After `focusBrief` write in `processPhrase()`:
- Replace the full LLM reply with `executiveSummary`
- Add "Open Focus Tab" smart action button
- Remove inline brief rendering from the chat message

### WP-4: LLM prompt updates for new fields

Update the planning prompt to generate:
- `weeklyFocus[]` — top 2-3 weekly priorities from the week plan
- `monthlyFocus[]` — top 2-3 monthly objectives from active OKRs
- `companion.mindsetCards[]` — 2-3 personalized behavioral nudge cards

Update `submit_action_plan` tool schema to accept these new fields.

### WP-5: Brief renderer update (HTML)

Update `briefRenderer.ts` to render the new layout for the HTML version (used by headless + Google Drive). Match the section order and styling of the React Native version.

---

## Files to create

| File | Purpose |
|---|---|
| `src/components/focus/SnapshotCard.tsx` | Section 1: Hero card with greeting + summary |
| `src/components/focus/MindsetCards.tsx` | Section 2: Companion mini-cards |
| `src/components/focus/FocusLayers.tsx` | Section 3: Daily/Weekly/Monthly columns |
| `src/components/focus/TaskList.tsx` | Section 4: Interactive task list with actions |
| `src/components/focus/AgendaTimeline.tsx` | Section 5: Day timeline |
| `src/components/focus/WeekPreview.tsx` | Section 6: Collapsible 7-day preview |
| `src/components/focus/CompanionCard.tsx` | Section 7: Full companion section |
| `src/components/focus/RisksCard.tsx` | Section 8: Risks & blockers |
| `src/components/focus/OkrCard.tsx` | Section 9: OKR progress bars |

## Files to modify

| File | Change |
|---|---|
| `app/(tabs)/focus.tsx` | Rewrite to use new section components |
| `app/(tabs)/chat.tsx` | Reduce planning response to summary + "Open Focus Tab" button |
| `src/types/index.ts` | Add `weeklyFocus`, `monthlyFocus`, `mindsetCards` |
| `src/constants/prompts.ts` | Update planning prompt for new fields |
| `src/modules/llm.ts` | Update `ACTION_PLAN_TOOL` schema for new brief fields |
| `src/modules/briefRenderer.ts` | Update HTML rendering to match new section order |

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| No brief exists | Show empty state with "Plan my day" button (unchanged) |
| Brief from yesterday | Show it with a "Stale — regenerate?" banner |
| No tasks due today | Section 4 shows "No tasks due today. Enjoy the space." |
| No OKR data | Section 9 hidden |
| No companion data | Section 7 shows minimal "No companion insights yet" |
| Week brief with 7 days | Section 6 shows all 7 days, Section 5 shows today |

---

## Out of Scope

- Drag-and-drop task reordering (future)
- Calendar event creation from the Focus tab (use Chat)
- Inline task editing (title, notes) — use Tasks tab for that
- Push notifications for brief changes (future, needs Capacitor)

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Should Focus tab load from brief or live state? | **Both.** Brief for structure (agenda, companion, risks), live state for tasks (always current). |
| Should chat show any brief content? | **Yes, but minimal.** `executiveSummary` only + "Open Focus Tab" button. |
| Should mindset cards come from LLM or TypeScript? | **Both.** LLM generates personalized ones, TypeScript adds common patterns (2-min rule, deep work reminder) if LLM returns < 3. |
| Should tasks be sorted? | **Yes.** Overdue first, then today, sorted by priority (high → medium → low). |
| Should completed tasks show in Section 4? | **Yes, at the bottom, greyed out with timestamp.** Gives a sense of progress. |
