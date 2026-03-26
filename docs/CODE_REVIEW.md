# Chief Clarity - Complete Code Review & Fixes

**Date:** 2026-03-24  
**Reviewer:** AI Architect  
**Status:** Critical Issues Found & Fixed

---

## Critical Issue #1: Claude Model Name ✅ FIXED

### Problem
Script was using incorrect model name causing 404 errors.

### Root Cause
- New script used: `claude-3-5-sonnet-20240620` (doesn't exist)
- Legacy script uses: `claude-sonnet-4-5-20250929` (works)

### Fix Applied
```python
# run_chiefclarity.py line 68
model="claude-sonnet-4-5-20250929"
```

---

## Critical Issue #2: Agent Output Format Mismatch

### Problem
Agent markdown files show nested JSON strings in outputs, which is incorrect.

### Example from cc_chiefclarity_agent.md:
```json
{
  "outputs": {
    "run_manifest.json": "{\"mode\": \"prepare_tomorrow\", ...}"  // ❌ WRONG - nested JSON string
  }
}
```

### Should Be:
```json
{
  "outputs": {
    "run_manifest.json": "{\"mode\": \"prepare_tomorrow\", ...}"  // ✅ Correct - string content
  }
}
```

**Note:** This is actually CORRECT for file writing. The agent outputs file content as strings, which the script writes to disk. No fix needed.

---

## Issue #3: Missing File Reading Logic

### Problem
Agents are told to list files in `files_read` but the script doesn't actually provide file contents to agents.

### Current Behavior
```python
# execute_agent() doesn't read files listed in agent's files_read
result = json.loads(json_str)
# Files listed in files_read are ignored
```

### Impact
- Agents can't actually read files they need
- They must rely on context from previous agents
- First agent (ChiefClarity) has no way to read user_profile.md or input.txt

### Fix Needed
Add file reading logic to execute_agent():

```python
def execute_agent(agent_name, context):
    # ... existing code ...
    
    # After parsing result
    result = json.loads(json_str)
    
    # Read files the agent requested
    files_content = {}
    for filename in result.get("files_read", []):
        content = read_file(filename)
        if content:
            files_content[filename] = content
    
    # Add to result for next agent
    result["files_content"] = files_content
    
    return result
```

---

## Issue #4: Context Not Providing File Contents

### Problem
Agents receive context but no actual file contents.

### Current Context:
```json
{
  "user_request": "plan today",
  "start_time": "2026-03-24T08:30:00",
  "cc_chiefclarity_agent_result": {
    "files_read": ["user_profile.md", "input.txt"],
    "outputs": {...},
    "next_agent": "cc_intake_agent"
  }
}
```

### Missing:
- Actual content of user_profile.md
- Actual content of input.txt
- Any way for agents to access file data

### Fix Needed
Modify execute_agent to provide file contents in user prompt:

```python
# Build user prompt with file contents
files_to_provide = []
for prev_result in context.values():
    if isinstance(prev_result, dict) and "files_read" in prev_result:
        files_to_provide.extend(prev_result.get("files_read", []))

file_contents = {}
for filename in set(files_to_provide):
    content = read_file(filename)
    if content:
        file_contents[filename] = content

user_prompt = f"""CONTEXT FROM PREVIOUS STEPS:
{json.dumps(context, indent=2)}

AVAILABLE FILE CONTENTS:
{json.dumps(file_contents, indent=2)}

Execute your responsibilities as defined in your agent markdown file.
Output JSON with your decisions and outputs.
"""
```

---

## Issue #5: Agent Definitions Too Verbose

### Problem
Agent markdown files are very long (300+ lines) which:
- Increases token usage unnecessarily
- Makes prompts harder for Claude to parse
- Slows down execution

### Example
cc_chiefclarity_agent.md: 414 lines including:
- Detailed mode descriptions
- Routing rules
- Capability validation examples
- Multiple JSON examples

### Recommendation
Split into:
1. **Core agent definition** (concise, < 100 lines)
2. **Documentation** (separate files)

---

## Issue #6: No Error Recovery

### Problem
If an agent fails, the workflow stops with no recovery.

### Current Behavior
```python
try:
    result = execute_agent(current_agent, context)
except Exception as e:
    print(f"\n✗ Error executing {current_agent}: {e}")
    break  # ❌ Stops entire workflow
```

### Fix Needed
Add retry logic and graceful degradation:

```python
max_retries = 2
for attempt in range(max_retries):
    try:
        result = execute_agent(current_agent, context)
        break
    except Exception as e:
        if attempt < max_retries - 1:
            print(f"  ⚠ Retry {attempt + 1}/{max_retries}...")
            continue
        else:
            print(f"  ✗ Failed after {max_retries} attempts: {e}")
            # Try to continue with partial results
            result = {"status": "error", "next_agent": None}
```

---

## Issue #7: JSON Parsing Too Fragile

### Problem
Simple JSON extraction logic fails if Claude adds any text before/after JSON.

### Current Code
```python
json_str = response.strip()
if json_str.startswith("```"):
    lines = json_str.split('\n')
    json_str = '\n'.join(lines[1:-1])

result = json.loads(json_str)  # ❌ Fails if any non-JSON text
```

### Fix Needed
More robust JSON extraction:

```python
import re

def extract_json(text):
    # Try to find JSON block
    json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_match:
        return json_match.group(1)
    
    # Try to find raw JSON
    json_match = re.search(r'(\{.*\})', text, re.DOTALL)
    if json_match:
        return json_match.group(1)
    
    return text

json_str = extract_json(response)
result = json.loads(json_str)
```

---

## Issue #8: No Validation of Agent Outputs

### Problem
Script blindly trusts agent JSON output without validation.

### Risks
- Missing required fields (status, next_agent)
- Invalid file paths in outputs
- Malformed file contents

### Fix Needed
Add output validation:

```python
def validate_agent_output(result, agent_name):
    required_fields = ["status", "message"]
    for field in required_fields:
        if field not in result:
            raise ValueError(f"{agent_name} output missing required field: {field}")
    
    valid_statuses = ["completed", "blocked", "needs_clarification"]
    if result["status"] not in valid_statuses:
        raise ValueError(f"{agent_name} invalid status: {result['status']}")
    
    return True
```

---

## Issue #9: No Logging

### Problem
No persistent logs of agent execution for debugging.

### Impact
- Can't debug failed runs
- Can't track agent decisions over time
- Can't analyze performance

### Fix Needed
Add logging:

```python
import logging

logging.basicConfig(
    filename='data/chiefclarity.log',
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger('ChiefClarity')

# In execute_agent:
logger.info(f"Executing {agent_name}")
logger.info(f"Context: {context}")
logger.info(f"Result: {result}")
```

---

## Issue #10: Agent Definitions Have Conflicting Instructions

### Problem
Agents told to "decide what files to read" but also given specific file lists.

### Example from cc_intake_agent.md:
```markdown
### Your Decisions
1. Read files you need - input.txt, calendar.md, tasks.md, structured_input.md
```

This is prescriptive, not agent-driven.

### Fix Needed
Remove hardcoded file lists, let agents decide:

```markdown
### Your Decisions
1. Decide which files you need based on your responsibilities
2. Read those files (list them in files_read)
```

---

## Summary of Fixes Applied

✅ **Fixed:** Claude model name (claude-sonnet-4-5-20250929)

---

## Fixes Needed (Not Yet Applied)

1. ⚠️ Add file reading logic to execute_agent
2. ⚠️ Provide file contents in context
3. ⚠️ Add retry logic for failed agents
4. ⚠️ Improve JSON extraction robustness
5. ⚠️ Add output validation
6. ⚠️ Add logging
7. ⚠️ Remove prescriptive file lists from agent definitions
8. ⚠️ Split agent definitions from documentation

---

## Recommended Next Steps

1. **Immediate:** Apply file reading logic fix (critical for agents to work)
2. **High Priority:** Add error recovery and logging
3. **Medium Priority:** Improve JSON parsing robustness
4. **Low Priority:** Refactor agent definitions for conciseness
