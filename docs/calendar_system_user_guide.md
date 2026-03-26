# Calendar System User Guide (Phase 5)

## Overview

Chief Clarity now includes a complete calendar and task management system that learns from your habits to improve planning over time.

---

## Quick Start

### How to Use the Calendar System

You interact with the calendar system through `input.txt` using natural language. The system automatically:
- Creates calendar entries
- Tracks task completion
- Learns from your patterns
- Improves future planning

---

## Creating Calendar Items

### Book an Appointment

**Write in input.txt:**
```
- Book [event name] for [date] at [time]
- Schedule [event] for [day] at [time]
- Meeting with [person] on [day] at [time]
```

**System creates:**
- Calendar entry in `calendar.md`
- Appears in daily plan automatically
- Reminder surfaces on the day

### Set a Reminder

**Write in input.txt:**
```
- Remind me to [action] on [date]
- Reminder to [action] on [day]
- Don't forget to [action] by [date]
```

**System creates:**
- Reminder entry in `calendar.md`
- Surfaces in daily plan on target date

### Create Recurring Event

**Write in input.txt:**
```
- [Event name] every [day] at [time]
- Weekly [event] every [day] at [time]
- [Event] every [day] at [time]
```

**System creates:**
- Recurring event in `calendar.md`
- Automatically appears every week
- Never forgotten

### Add Task with Deadline

**Write in input.txt:**
```
- [Task name] by [day]
- [Task] due [date]
- [Task] deadline [date]
```

**System creates:**
- Task entry in `tasks.md`
- Surfaces in daily plan on due date
- Auto-detects if overdue

---

## Marking Tasks Complete

### Method 1: State Completion

**Write in input.txt:**
```
- Finished [task name]
- Completed [task name]
- Done with [task name]
```

**System updates:**
- Task status → completed
- Records completion time
- Moves to Completed section
- Archives for learning

### Method 2: Task Check-In

**In input.txt task check-in:**
```
TASK CHECK-IN (Date - Day)
=========================================

1. [X] **Task name** ← Mark with X when done
2. [~] **Task name** ← Mark with ~ when partially done
3. [ ] **Task name** ← Leave empty if not done
```

**System updates:**
- `[X]` → status: completed
- `[~]` → status: in_progress
- `[ ]` → status: pending (or overdue if past due)

---

## Rescheduling

### Reschedule an Event/Task

**Write in input.txt:**
```
- Reschedule [event] to [new date] at [time]
- Move [event] to [new time]
- Change [task] deadline to [new date]
```

**System handles:**
- Updates original → status: rescheduled
- Creates new entry with new date
- Preserves history
- Links old and new entries

---

## Cancelling

### Cancel an Event/Task

**Write in input.txt:**
```
- Cancel [event] this [day]
- Not doing [task] anymore
- Cancelled [event]
```

**System handles:**
- Updates status → cancelled
- Records cancellation reason
- Moves to Recent Past
- Preserves for pattern analysis

---

## Understanding Your Daily Plan

### Calendar Items in focus.md

Your daily plan (`focus.md`) automatically includes:

#### Fixed Appointments
```markdown
### Fixed Appointments
- 🔴 HH:MM: Event Name (CAL-XXX)
  - With: Person name
  - Prep needed: Preparation items
```

#### Recurring Commitments
```markdown
### Recurring Commitments
- HH:MM: Recurring event name (REC-XXX)
- HH:MM: Weekly event (REC-XXX)
```

#### Deadlines Today
```markdown
### Deadlines Today
- 🔴 Task name (TASK-XXX)
- 🔴 Reminder action (CAL-XXX)
```

#### Time-Blocked Agenda
```markdown
| Time | Task | Source | Urgency |
|------|------|--------|---------|
| HH:MM | Event name | CAL-XXX | 🔴 |
| HH:MM | Task name | TASK-XXX | 🔴 |
```

Every item shows its **source** (CAL-001, TASK-010, etc.) so you can trace back to the calendar.

---

## Pattern-Based Recommendations

The system learns from your habits and provides recommendations:

### Completion Probability Warnings

```markdown
⚠️ **Task name (time)**: XX% completion probability
- Pattern: Time-based pattern description
- Recommendation: Alternative suggestion
```

### Optimal Time Recommendations

```markdown
### Recommended Schedule (Based on Your Patterns)

| Time | Task | Why This Time? |
|------|------|----------------|
| HH:MM | Task name | 📊 Pattern: Success rate description |
| HH:MM | Task name | 📊 Pattern: Success rate description |
```

### Time Estimate Calibrations

```markdown
### Time Allocations (Calibrated)

- **Task name**
  - Your estimate: X hours
  - Calibrated: Y hours (📊 Pattern description)
  - Recommendation: Time allocation
```

### Habit Optimization

```markdown
**Habit Name**
- Best time: HH:MM (XX% success)
- Worst time: Time description (XX% success)
- Success pattern: Pattern description
- Recommendation: Suggested time ✅
```

---

## Temporal Expressions Reference

### Dates

**Relative:**
- "tomorrow" → next day
- "next Monday" → next occurrence of Monday
- "this weekend" → next Saturday/Sunday
- "next week" → 7 days from now
- "in 2 weeks" → 14 days from now

**Absolute:**
- "[Month] [Day]" → YYYY-MM-DD
- "Tuesday" → next Tuesday
- "MM/DD" → [Month]/[Day]

### Times

- "11 AM" → 11:00
- "2:30 PM" → 14:30
- "morning" → 09:00 (default)
- "afternoon" → 14:00 (default)
- "evening" → 18:00 (default)

### Recurring

- "every Monday" → weekly on Monday
- "every Wednesday at 3:15 PM" → weekly Wednesday 3:15 PM
- "weekly" → every 7 days
- "monthly" → every month

---

## Status Definitions

### Event Statuses

- **pending**: Scheduled but not confirmed
- **confirmed**: Verified and locked in
- **tentative**: Scheduled but needs confirmation
- **completed**: Happened, outcome recorded
- **cancelled**: Was scheduled but cancelled
- **rescheduled**: Moved to new date
- **no_show**: Scheduled but didn't happen

### Task Statuses

- **pending**: Not started
- **in_progress**: Actively working
- **blocked**: Waiting on dependency
- **completed**: Done
- **overdue**: Past due date, not completed
- **cancelled**: No longer needed
- **rescheduled**: Due date moved

---

## Files Reference

### calendar.md
- **Purpose:** Master calendar database
- **Contains:** Upcoming events, recurring events, recent past
- **You edit:** No (system manages automatically)
- **You view:** Yes (to see all appointments)

### tasks.md
- **Purpose:** Task list with deadlines
- **Contains:** Active tasks, completed tasks, backlog
- **You edit:** No (system manages automatically)
- **You view:** Yes (to see all tasks)

### calendar_archive.md
- **Purpose:** Complete history for learning
- **Contains:** All past events/tasks with metadata
- **You edit:** No (system manages automatically)
- **You view:** Yes (to see patterns and history)

### focus.md
- **Purpose:** Daily/weekly plan (generated)
- **Contains:** Merged calendar view with recommendations
- **You edit:** No (regenerated daily)
- **You view:** Yes (your main planning document)

### input.txt
- **Purpose:** Your input to the system
- **Contains:** Notes, task check-ins, questions
- **You edit:** Yes (this is where you write)
- **You view:** Yes

---

## Tips for Best Results

### 1. Be Specific with Dates/Times

**Good:**
- "Book [event] for [specific date] at [specific time]"
- "Remind me to [action] on [specific date]"

**Less Good:**
- "Book [event] sometime next week"
- "Remind me to [action] soon"

### 2. Mark Tasks Complete

Always mark tasks complete in `input.txt`:
- "Finished [task name]"
- Or use task check-in: `[X]`

This helps the system learn your patterns.

### 3. Trust the Recommendations

The system learns from your actual behavior:
- If it warns "80% risk of rescheduling" → consider moving the task
- If it recommends morning time → there's data showing you succeed in mornings
- If it calibrates time estimates → it's based on your actual time spent

### 4. Use Recurring Events

For anything that repeats:
- "[Event name] every [day] at [time]"
- "Weekly [event] every [day] at [time]"

This ensures you never forget regular commitments.

### 5. Check Your Daily Plan

Your `focus.md` is regenerated daily with:
- All appointments for the day
- All deadlines
- Pattern-based recommendations
- Time-blocked agenda

Review it each morning.

---

## Troubleshooting

### "My appointment didn't appear in today's plan"

**Check:**
1. Is it in `calendar.md`? (Look for CAL-XXX entry)
2. Is the date correct?
3. Is the status "confirmed" or "pending"? (Not "cancelled")
4. Did planning agent run to regenerate `focus.md`?

**Fix:**
- If not in `calendar.md`: Add it via `input.txt`
- If wrong date: Reschedule via `input.txt`
- If cancelled: Recreate via `input.txt`

### "System keeps warning about low completion probability"

**This is good!** The system is learning your patterns.

**Action:**
- Consider moving the task to recommended time
- Or accept the risk and try anyway
- Over time, system learns what works for you

### "Time estimates are always wrong"

**This is normal at first.** The system needs data to calibrate.

**Action:**
- Keep marking tasks complete with actual time spent
- After 2-3 weeks, calibration improves
- System will start adjusting estimates automatically

### "Recurring event missing from a specific day"

**Check:**
1. Is the recurring event status "active"? (Not "cancelled")
2. Is it the right day of week?
3. Did the event get manually cancelled for that specific day?

**Fix:**
- Check `calendar.md` Recurring Events section
- If cancelled: Recreate via `input.txt`

---

## Advanced Features

### Habit Stacking

The system detects when pairing habits increases success:

**Example:**
- Communication practice at 1:00 PM → 45% success alone
- Exercise at 1:30 PM after communication → 75% success together

**System recommends:**
- Schedule both back-to-back for higher success rate

### Interview Day Handling

System learns that interview days drain energy:

**Pattern detected:**
- Habits missed 80% of time on interview days

**System recommends:**
- Complete habits day before interview
- Keep interview day light (only interview + follow-up)
- Plan recovery time after interview

### Calendar Density Warnings

System detects when "calendar full" reduces completion:

**Pattern detected:**
- More than 8 tasks in one day → 50% completion drop

**System recommends:**
- Spread tasks across multiple days
- Prioritize critical items
- Move non-urgent tasks to less busy days

---

## Privacy & Data

### What Data is Stored

- All calendar events and tasks
- Completion status and timestamps
- Actual time spent vs estimated
- Outcomes and satisfaction (inferred from your language)
- Energy levels (inferred from context)

### Where Data is Stored

- **Locally only:** All data in `g:\My Drive\__LifeOS\data\`
- **No external services:** Pure internal system
- **No cloud sync:** Unless you enable Google Calendar (optional, Phase 6)

### How Data is Used

- **Pattern analysis:** To improve future planning
- **Recommendations:** To suggest optimal scheduling
- **Learning:** To calibrate time estimates
- **Never shared:** Data stays on your machine

---

## Getting Help

### Questions for Chief Clarity

Write in `input.txt`:
```
QUESTIONS FOR CHIEF CLARITY:
- [Your question about task/planning]
- [Your question about scheduling]
- [Your question about patterns]
```

Answers appear in `focus.md` ## Answers section.

### System Questions for You

The system asks questions in `input.txt`:
```
QUESTIONS FROM CHIEF CLARITY:
- Did [event] on [date] happen? Mark as completed/cancelled
- "[relative date]" - did you mean [date1] or [date2]?
```

Answer in INBOX section above.

---

## What's Next

### Phase 6 (Future): Google Calendar Integration

**Optional feature** (not yet implemented):
- Sync Chief Clarity with Google Calendar
- Read external events automatically
- Write Chief Clarity appointments to Google Calendar
- Bidirectional sync

**Benefits:**
- Mobile access via Google Calendar app
- Family calendar integration
- Use existing calendar tools

**Trade-offs:**
- Requires OAuth setup
- API dependencies
- Privacy considerations

**Status:** Planned for future release

---

## Summary

### You Control Everything

- **Input:** Write in `input.txt` using natural language
- **System:** Automatically manages calendar/tasks
- **Output:** See merged plan in `focus.md`
- **Learning:** System improves over time

### System Learns From You

- Completion patterns
- Optimal time slots
- Rescheduling triggers
- Time estimation accuracy
- Habit success factors

### No Manual Maintenance

- Automatic cleanup (old events archived)
- Automatic status updates (overdue detection)
- Automatic recommendations (pattern-based)
- Automatic time calibration (learns accuracy)

### Privacy First

- All data local
- No external services
- No cloud dependencies
- You own everything

---

**Welcome to your self-improving calendar system!** 🎯

The more you use it, the better it gets at helping you plan effectively.
