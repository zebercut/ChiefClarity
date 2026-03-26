# Agent-Driven Data Validation

**Version:** 3.0.0  
**Principle:** Agents validate their own data, not the script

## Philosophy

**Agents are responsible for:**
- Validating input data exists and is fresh
- Detecting stale files from previous runs
- Blocking execution if critical data is missing
- Providing clear error messages about what's wrong

**Script is responsible for:**
- Executing agents in sequence
- Passing context between agents
- Handling agent errors gracefully

## Validation Chain

### **1. ChiefClarity Agent (Orchestrator)**

**Validates:**
- Execution state (stale run_manifest.json)
- User profile exists
- Input.txt exists

**Actions:**
- Generates unique `run_id` for this run
- Checks existing `run_manifest.json`:
  - Missing → Fresh start (OK)
  - < 5 min old → Possible incomplete run (warn)
  - > 5 min old → Stale (ignore, overwrite)
- Writes new `run_manifest.json` with timestamp

**Blocks if:**
- User profile missing (critical)

**Example Output:**
```json
{
  "files_read": ["user_profile.md", "input.txt", "run_manifest.json"],
  "outputs": {
    "run_manifest.json": "{\"run_id\": \"run_20260324_081400\", \"mode\": \"prepare_tomorrow\", \"generated_at\": \"2026-03-24T08:14:00\", ...}"
  },
  "next_agent": "cc_intake_agent",
  "status": "completed",
  "message": "Interpreted as 'prepare_tomorrow'. Previous run_manifest.json was stale (6 hours old), overwritten."
}
```

---

### **2. Intake Agent**

**Validates:**
- `run_manifest.json` exists and has valid run_id
- `input.txt` exists and is readable
- `calendar.md`, `tasks.md` exist (or creates them)

**Actions:**
- Reads `run_manifest.json` to get mode and run_id
- Verifies it matches current execution context
- Checks file formats before reading
- Creates missing files if needed (calendar.md, tasks.md)

**Blocks if:**
- `run_manifest.json` missing (ChiefClarity didn't run)
- `run_manifest.json` corrupted or invalid JSON
- `input.txt` missing and cannot be created

**Example Output:**
```json
{
  "files_read": ["run_manifest.json", "input.txt", "calendar.md", "tasks.md"],
  "outputs": {
    "calendar.md": "...",
    "tasks.md": "...",
    "structured_input.md": "..."
  },
  "next_agent": "cc_planning_agent",
  "status": "completed",
  "message": "Intake completed. Processed 5 items from input.txt."
}
```

**Blocked Example:**
```json
{
  "status": "blocked",
  "message": "run_manifest.json is missing. ChiefClarity agent must run first.",
  "next_agent": null
}
```

---

### **3. Planning Agent**

**Validates:**
- `run_manifest.json` exists with valid mode
- Intake outputs exist: `structured_input.md`, `calendar.md`, `tasks.md`
- `user_profile.md` exists (critical for timezone, routine)
- `OKR.md` exists (warns if missing, continues)

**Actions:**
- Reads `run_manifest.json` to understand mode
- Verifies Intake Agent completed successfully
- Checks all required files exist before reading
- Validates file contents are not empty

**Blocks if:**
- `run_manifest.json` missing
- `structured_input.md` missing (Intake didn't run)
- `calendar.md` or `tasks.md` missing (Intake didn't complete)
- `user_profile.md` missing (critical data)

**Example Output:**
```json
{
  "files_read": ["run_manifest.json", "user_profile.md", "OKR.md", "structured_input.md", "calendar.md", "tasks.md"],
  "outputs": {
    "plan_data.md": "..."
  },
  "next_agent": "cc_writer_agent",
  "status": "completed",
  "message": "Planning completed. Generated agenda with 3 must-wins."
}
```

**Blocked Example:**
```json
{
  "status": "blocked",
  "message": "Planning cannot proceed. Missing required files: structured_input.md, calendar.md. Intake Agent may have failed.",
  "next_agent": null
}
```

---

### **4. Writer Agent**

**Validates:**
- `run_manifest.json` exists with valid mode
- `plan_data.md` exists (Planning output)
- `plan_data.md` is not empty and contains expected sections
- `OKR.md` exists (for OKR Dashboard)

**Actions:**
- Reads `run_manifest.json` to get mode and dates
- Verifies Planning Agent completed successfully
- Checks `plan_data.md` has content
- Validates old `focus.md` (for cleanup)

**Blocks if:**
- `run_manifest.json` missing
- `plan_data.md` missing (Planning didn't run)
- `plan_data.md` empty or corrupted

**Example Output:**
```json
{
  "files_read": ["run_manifest.json", "plan_data.md", "OKR.md", "input.txt", "focus.md"],
  "outputs": {
    "focus.md": "...",
    "input.txt": "..."
  },
  "next_agent": null,
  "status": "completed",
  "message": "Writer completed. Generated focus.md and cleaned input.txt."
}
```

**Blocked Example:**
```json
{
  "status": "blocked",
  "message": "Cannot write focus.md. plan_data.md is missing. Planning Agent may have failed.",
  "next_agent": null
}
```

---

## Validation Patterns

### **Pattern 1: Check File Exists**
```
Agent reads file list from context
For each required file:
  - Check if file exists
  - If missing and critical → Block
  - If missing and optional → Warn and continue
```

### **Pattern 2: Validate run_manifest.json**
```
Read run_manifest.json
Parse JSON
Check fields:
  - run_id exists
  - mode exists
  - generated_at exists and is recent
If invalid → Block with clear error
```

### **Pattern 3: Verify Upstream Agent Completed**
```
Check expected outputs from previous agent exist
Example: Planning checks for structured_input.md from Intake
If missing → Block: "Upstream agent [name] did not complete"
```

### **Pattern 4: Timestamp Validation**
```
Read file timestamp or embedded timestamp
Compare to current time
If > threshold (e.g., 5 minutes) → Stale
If stale and critical → Block or warn
```

---

## Error Messages

### **Good Error Messages:**

✅ "run_manifest.json is missing. ChiefClarity agent must run first."  
✅ "Planning cannot proceed. Missing required files: structured_input.md, calendar.md. Intake Agent may have failed."  
✅ "Cannot write focus.md. plan_data.md is missing or empty. Planning Agent may have failed."

### **Bad Error Messages:**

❌ "File not found"  
❌ "Error reading data"  
❌ "Invalid input"

**Principle:** Error messages should:
1. State what's wrong
2. Explain why it's a problem
3. Suggest what might have caused it
4. Indicate which agent should have created the missing data

---

## Handling Stale Data

### **Stale Execution Files:**
- `run_manifest.json` > 5 min old → Overwrite
- `plan_data.md` from different run_id → Ignore
- `_debug_*.txt` files → Ignore (debugging artifacts)

### **Fresh Persistent Files:**
- `calendar.md`, `tasks.md` → Always use (updated by Intake)
- `OKR.md`, `user_profile.md` → Always use (core data)
- `input.txt` → Always use (user input)

### **Agent Decision:**
```
If file timestamp > 5 minutes old AND file is execution artifact:
  → Ignore or overwrite
If file timestamp > 5 minutes old AND file is persistent data:
  → Use (it's meant to persist)
```

---

## Benefits of Agent-Driven Validation

1. ✅ **Agents are self-sufficient** - Don't rely on script to validate
2. ✅ **Clear error messages** - Agents know what they need
3. ✅ **Graceful degradation** - Agents can warn and continue for non-critical data
4. ✅ **No script complexity** - Script stays thin, agents handle validation
5. ✅ **Flexible** - Easy to add new validation rules to agent markdown

---

## Script Responsibility (Minimal)

**Script only handles:**
- Executing agents in sequence
- Passing context between agents
- Catching exceptions (network errors, API failures)
- Respecting agent status (blocked, needs_clarification)

**Script does NOT:**
- Validate file existence
- Check file timestamps
- Clean up old files
- Decide what data is stale

---

## Example: Handling Incomplete Run

**Scenario:**
```
Run 1: "Plan tomorrow"
  ✓ ChiefClarity → run_manifest.json written
  ✓ Intake → calendar.md, tasks.md written
  ✗ Planning → FAILED (API error)
  
Run 2: "Plan today" (new request)
```

**What Happens:**

1. **ChiefClarity Agent:**
   - Reads old `run_manifest.json` (mode: prepare_tomorrow, 2 min old)
   - Detects recent incomplete run
   - Overwrites with new manifest (mode: prepare_today)
   - Message: "Previous run (prepare_tomorrow) was incomplete. Starting fresh."

2. **Intake Agent:**
   - Reads new `run_manifest.json` (mode: prepare_today)
   - Validates it matches current context
   - Processes input.txt normally
   - Overwrites calendar.md, tasks.md with fresh data

3. **Planning Agent:**
   - Reads new `run_manifest.json`
   - Finds fresh structured_input.md, calendar.md, tasks.md
   - Proceeds normally

4. **Writer Agent:**
   - Reads new `run_manifest.json`
   - Finds fresh plan_data.md
   - Writes focus.md successfully

**Result:** Clean recovery from incomplete run, no manual intervention needed.
