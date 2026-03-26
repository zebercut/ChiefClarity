# Natural Language Interface Guide

**Version:** 3.0.0  
**Feature:** Natural Language Orchestration

## Overview

Chief Clarity now accepts **natural language requests** instead of menu selections. The orchestration agent interprets your request and decides what to do automatically.

## How It Works

```
You: "Help me plan tomorrow"
  ↓
ChiefClarity Agent interprets → prepare_tomorrow mode
  ↓
Executes: Intake → Planning → Writer
  ↓
Generates: focus.md with tomorrow's plan
```

## Supported Requests

### Daily Planning

**Prepare Tomorrow:**
- "Help me plan tomorrow"
- "Prepare tomorrow"
- "What should I do tomorrow?"
- "Plan for tomorrow"
- "Tomorrow's plan"

**Prepare Today:**
- "Plan my day"
- "Prepare today"
- "What's my plan today?"
- "Help me with today"
- "Today's agenda"

### Weekly Planning

**Prepare Week:**
- "Plan this week"
- "Weekly planning"
- "What's happening this week?"
- "Help me plan the week"
- "Week ahead"

### Analysis

**Full Analysis:**
- "Full analysis"
- "Deep dive"
- "Analyze everything"
- "Complete review"
- "Comprehensive analysis"

### Questions

**Answer Input Questions:**
- "Answer my questions"
- "I have questions"
- "Questions in input.txt"
- "Help with my questions"

**Answer One Question:**
- "What's the best time to schedule my interview?"
- "Should I prioritize task A or B?"
- "How do I handle this situation?"
- Any specific question

## Examples

### Example 1: Morning Planning

```
$ python run_chiefclarity.py

What would you like Chief Clarity to do?
Your request: Help me plan my day

Processing: Help me plan my day
============================================================
Understanding your request…
Analyzing your notes and compiling a plan…
Writing your plan…

✅ Done. Check `data/focus.md` for your plan.
```

### Example 2: Weekly Planning

```
Your request: Plan this week

Processing: Plan this week
============================================================
[Agent: cc_chiefclarity_agent]
  → Interpreted request as 'prepare_week'
  → Starting workflow with Intake Agent

[Workflow executes...]

✓ Check data/focus.md for your weekly plan!
```

### Example 3: Question Answering

```
Your request: Should I prioritize [Event A] prep or [Task A]?

Processing: Should I prioritize [Event A] prep or [Task A]?
============================================================
Understanding your request…
Analyzing your data and compiling findings…
Writing a clear answer…

✅ Answer displayed in the console and saved to `data/chat_history.md`.
```

### Example 4: Ambiguous Request (Clarification)

```
Your request: Help me plan

Processing: Help me plan
============================================================
[Agent: cc_chiefclarity_agent]
  → Status: needs_clarification
  → Message: I need clarification on your request.

Clarification needed:
  - Did you mean plan for today or tomorrow?
  - Are you planning for the day or the week?

Please provide more details.
```

## Natural Language Patterns

### Time References

- **Today:** "today", "my day", "this morning", "tonight"
- **Tomorrow:** "tomorrow", "next day", "the day ahead"
- **This Week:** "this week", "week ahead", "upcoming week"
- **General:** "plan", "help", "prepare" (agent will ask for clarification)

### Action Verbs

- **Plan:** "plan", "prepare", "organize", "schedule"
- **Analyze:** "analyze", "review", "assess", "evaluate"
- **Answer:** "answer", "help with", "respond to", "clarify"

### Question Indicators

- Starts with: "What", "How", "Should", "Can", "Is", "When", "Why"
- Contains: "?", "question", "help me decide"

## Benefits

### Before (Menu-Based)
```
User sees menu → Picks number → Mode executes
```
- ❌ Requires memorizing menu options
- ❌ Interrupts flow with menu
- ❌ Limited to predefined options

### After (Natural Language)
```
User states intent → Agent interprets → Mode executes
```
- ✅ Natural conversation
- ✅ No menu memorization
- ✅ Flexible interpretation
- ✅ Handles variations
- ✅ Can ask for clarification

## Advanced Usage

### Combining Requests

```
Your request: Plan tomorrow and answer my questions about [Event A]

[Agent interprets as: prepare_tomorrow + specific questions]
[Executes full workflow + includes answers in focus.md]
```

### Context-Aware Interpretation

The orchestration agent reads:
- `user_profile.md` - Your timezone, routine, preferences
- `input.txt` - Recent notes and context
- Current time - Morning vs evening affects "today" vs "tomorrow"

**Example:**
```
Time: 9:00 PM
Request: "Help me plan"

Agent interprets: "It's evening, user likely means tomorrow"
→ Executes: prepare_tomorrow
```

## Fallback to Menu

If you prefer the menu, you can still use the legacy script:

```powershell
python run_chiefclarity_legacy.py
```

## Tips

1. **Be specific when possible:** "Plan tomorrow" is clearer than "Help me"
2. **Use natural language:** Write how you'd ask a human assistant
3. **Ask questions directly:** No need to say "I have a question about..."
4. **Trust the agent:** It will ask for clarification if needed

## Future Enhancements

- Voice input support
- Multi-turn conversations
- Context memory across sessions
- Proactive suggestions based on patterns
- Integration with chat apps (Discord, WhatsApp)
