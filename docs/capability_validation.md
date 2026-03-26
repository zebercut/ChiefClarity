# Capability Validation & User Communication

**Version:** 3.0.0  
**Principle:** Agents validate their own capabilities and communicate limitations clearly

## Overview

When a user requests something the system cannot do, agents must:
1. **Detect** the out-of-scope request
2. **Validate** against their capability boundaries
3. **Communicate** limitations clearly to the user
4. **Suggest** alternative approaches within capabilities

---

## Multi-Layer Validation

### **Layer 1: ChiefClarity Agent (Request Validation)**

**Validates BEFORE routing to workers**

**System Capabilities:**
```
CAN DO:
✓ Plan daily/weekly schedules
✓ Analyze current situation
✓ Answer questions about execution, priorities, OKRs
✓ Process inbox and classify items
✓ Update calendar and tasks
✓ Generate focus.md with agenda
✓ Track progress on objectives

CANNOT DO:
✗ Execute external actions (emails, API calls)
✗ Access real-time data (weather, stocks, news)
✗ Make decisions for user (only recommendations)
✗ Modify files outside data/ directory
✗ Access internet or external databases
✗ Run code or scripts
✗ Create new agent types on the fly
```

**Response to Out-of-Scope Request:**
```json
{
  "status": "needs_clarification",
  "message": "This request is outside Chief Clarity's capabilities.",
  "clarification_questions": [
    "Chief Clarity can help with: planning, analysis, prioritization, and answering questions.",
    "Your request appears to be: [interpretation]",
    "Did you mean: [alternative interpretation within capabilities]?"
  ],
  "next_agent": null
}
```

**Examples:**

| User Request | Validation | Response |
|--------------|------------|----------|
| "Send email to my boss" | ❌ Out of scope | "I cannot send emails, but I can help you draft talking points for your boss meeting." |
| "What's the weather tomorrow?" | ❌ Out of scope | "I cannot access real-time weather data. Would you like me to plan tomorrow with a weather assumption?" |
| "Buy stocks for me" | ❌ Out of scope | "I cannot execute trades, but I can help you decide how much time to allocate to trading vs job search based on your OKRs." |
| "Draft talking points for boss meeting" | ✅ In scope | Proceeds to planning workflow |
| "Should I prioritize interview prep or blog post?" | ✅ In scope | Proceeds to planning workflow |

---

### **Layer 2: Intake Agent (Input Processing)**

**Validates during input classification**

**Capabilities:**
```
CAN PROCESS:
✓ Text input from input.txt
✓ Temporal expressions (dates, times, deadlines)
✓ Calendar events and tasks
✓ Topic classification
✓ Archival operations

CANNOT PROCESS:
✗ Requests requiring external API calls
✗ Requests requiring real-time data
✗ Requests requiring code execution
✗ Requests requiring file access outside data/
```

**Handling Out-of-Scope Input:**
```markdown
# structured_input.md

## Questions Requiring External Action

1. [INBOX-042] User requested: "Send email to recruiter"
   - Action: Cannot execute (external action)
   - Suggestion: Draft email content for user to send manually
   - Passed to Planning Agent for user communication

2. [INBOX-043] User requested: "Check stock price for AAPL"
   - Action: Cannot execute (real-time data)
   - Suggestion: User can add stock price to input.txt manually
   - Passed to Planning Agent for user communication
```

**Agent does NOT:**
- Attempt to execute out-of-scope requests
- Fail silently
- Make up data

**Agent DOES:**
- Note the request in structured_input.md
- Flag it for Planning Agent
- Suggest alternative approach

---

### **Layer 3: Planning Agent (Analysis Validation)**

**Validates during planning and analysis**

**Capabilities:**
```
CAN PROVIDE:
✓ Execution plans and priorities
✓ Risk analysis and pattern recognition
✓ OKR progress tracking
✓ Agenda recommendations
✓ Answers to operational questions (based on available data)
✓ Trade-off analysis between options
✓ Time estimation and scheduling advice

CANNOT PROVIDE:
✗ Real-time external data
✗ Decisions for the user (only recommendations)
✗ Guarantees or predictions about outcomes
✗ External API integrations
✗ Code execution or automation
```

**Handling Out-of-Scope Questions:**

**Example 1: Real-time data request**
```
User question: "What's the best stock to buy today?"

Planning Agent response in plan_data.md:
---
## Answers

**Question:** What's the best stock to buy today?

**Answer:** I cannot provide real-time stock recommendations or access market data. However, I can help you with:

1. **Time allocation:** Based on your OKRs, should you focus on trading or job search?
2. **Risk analysis:** What are the risks of allocating time to trading vs other priorities?
3. **Schedule:** When in your routine would be best for trading research?

Would you like me to analyze these aspects instead?
---
```

**Example 2: Decision request**
```
User question: "Should I take the [Job Option A] or keep looking?"

Planning Agent response in plan_data.md:
---
## Answers

**Question:** Should I take the [Job Option A] or keep looking?

**Answer:** I cannot make this decision for you, but I can provide analysis:

**Factors to consider:**
- [Job Option A] aligns with your income target (OKR: [Income goal])
- You have [X/Y] applications submitted ([Z%] of target)
- You have an interview coming up - decision not needed yet
- You have until [Deadline Window] to secure a role

**Trade-offs:**
- Taking [Job Option A]: Achieves income goal, may reduce job search effort
- Continuing search: More options, but time pressure ([Time Remaining])

**Recommendation:** Focus on the upcoming interview first. Evaluate the offer if received. Continue applications in parallel until you have a concrete offer.

**Next steps:**
1. Prepare for the upcoming interview
2. Continue [application cadence] target
3. Evaluate the offer when/if received
---
```

---

### **Layer 4: Writer Agent (Output Validation)**

**Validates during output generation**

**Capabilities:**
```
CAN WRITE:
✓ focus.md (daily/weekly plans)
✓ input.txt (cleaned inbox)
✓ answer.md (answers to user questions)
✓ Markdown formatted content
✓ Tables, lists, structured text

CANNOT WRITE:
✗ Code or scripts
✗ Files outside data/ directory
✗ Binary files or non-text formats
✗ External API calls or integrations
✗ Executable content
```

**Handling Out-of-Scope Writing:**

If Planning Agent requests something out of scope, Writer Agent adds to focus.md:

```markdown
## System Limitations

**Note:** Some requested actions are outside Chief Clarity's capabilities:

1. **Email to recruiter** - Chief Clarity cannot send emails automatically.
   - **Alternative:** Draft email content provided below. Copy and send manually.
   - **Draft:** "Dear [Recruiter], I wanted to follow up on..."

2. **Stock price check** - Chief Clarity cannot access real-time market data.
   - **Alternative:** Add current stock prices to input.txt manually, and I can help analyze.

3. **Automated calendar sync** - Chief Clarity cannot sync with external calendars.
   - **Alternative:** Add calendar events to input.txt, and I'll track them in calendar.md.
```

---

## Communication Patterns

### **Pattern 1: Acknowledge + Explain + Suggest**

```
User: "Send email to my boss"

Response:
"I cannot send emails automatically (Chief Clarity doesn't have email integration).

However, I can help you:
1. Draft talking points for your boss meeting
2. Create an agenda for the discussion
3. Identify key priorities to communicate

Would you like me to draft talking points instead?"
```

### **Pattern 2: Clarify Intent + Offer Alternative**

```
User: "What's the weather tomorrow?"

Response:
"I cannot access real-time weather data.

Did you mean:
1. Plan tomorrow assuming good weather?
2. Plan tomorrow with indoor backup options?
3. Add weather considerations to your agenda?

Please clarify, and I'll help you plan accordingly."
```

### **Pattern 3: Explain Limitation + Provide Workaround**

```
User: "Check if I have any meetings tomorrow"

Response:
"I cannot access your external calendar (Google Calendar, Outlook, etc.).

However, I can:
1. Check calendar.md for events you've added to Chief Clarity
2. Help you add upcoming meetings to calendar.md for tracking
3. Generate a daily agenda based on calendar.md

Current events in calendar.md for tomorrow:
- [Time]: [Event A] (CAL-102)
- [Time]: [Event B] (CAL-103)

Would you like to add more events?"
```

---

## User Communication Flow

```
User Request
  ↓
ChiefClarity Agent validates
  ↓
├─ In scope → Route to workflow
│
└─ Out of scope → Respond with:
     1. "I cannot do [X] because [reason]"
     2. "I can help with [alternative]"
     3. "Did you mean [interpretation]?"
     4. Wait for clarification
```

**Example Session:**

```
User: "Send email to recruiter about [Event A]"

ChiefClarity:
{
  "status": "needs_clarification",
  "message": "I cannot send emails automatically.",
  "clarification_questions": [
    "I can help you draft email content to send manually.",
    "Would you like me to:",
    "1. Draft email content for the recruiter?",
    "2. Create talking points for a phone call?",
    "3. Plan follow-up actions after the interview?"
  ]
}

[User clarifies: "Draft email content"]

ChiefClarity:
{
  "status": "completed",
  "message": "Interpreted as: Draft email content for recruiter",
  "next_agent": "cc_planning_agent"
}

[Workflow proceeds to generate email draft in focus.md]
```

---

## Benefits

1. ✅ **Clear boundaries** - Users know what system can/cannot do
2. ✅ **No silent failures** - Agents communicate limitations explicitly
3. ✅ **Helpful alternatives** - Agents suggest what they CAN do
4. ✅ **User education** - Users learn system capabilities over time
5. ✅ **Graceful degradation** - System doesn't break on out-of-scope requests

---

## Future Enhancements

### **Capability Registry**
```json
{
  "system_capabilities": {
    "planning": ["daily", "weekly", "monthly"],
    "analysis": ["priorities", "risks", "patterns"],
    "data_access": ["local_files_only"],
    "integrations": ["none"],
    "actions": ["read", "write", "analyze"]
  },
  "agent_capabilities": {
    "cc_chiefclarity_agent": ["orchestration", "validation"],
    "cc_intake_agent": ["classification", "archival"],
    "cc_planning_agent": ["analysis", "recommendations"],
    "cc_writer_agent": ["markdown_generation"]
  }
}
```

### **Dynamic Capability Detection**
```python
# Agent checks its own capabilities
if request_type not in self.capabilities:
    return suggest_alternative(request_type)
```

### **Learning from Out-of-Scope Requests**
```markdown
# Track common out-of-scope requests
- Email automation: 15 requests
- Weather data: 8 requests
- Stock prices: 5 requests

# Suggest future integrations based on demand
```

---

## Summary

**Who validates capabilities?**
- **ChiefClarity Agent** - Validates request is within system capabilities
- **Each worker agent** - Validates specific task is within their capabilities

**What happens when agent can't do something?**
1. Agent detects out-of-scope request
2. Agent sets status to "needs_clarification" or adds note to output
3. Agent explains limitation clearly
4. Agent suggests alternative within capabilities
5. User receives clear communication in focus.md or via clarification prompt

**How is it communicated to user?**
- **Immediate:** Via clarification questions (ChiefClarity Agent)
- **In output:** Via "System Limitations" section in focus.md (Writer Agent)
- **In answers:** Via "I cannot... but I can..." pattern (Planning Agent)

**Result:** Users understand system boundaries and get helpful alternatives instead of errors or silent failures.
