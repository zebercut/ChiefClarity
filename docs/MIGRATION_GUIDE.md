# Migration Guide: Legacy to Agent-Driven Architecture

**Version:** 3.0.0  
**Date:** 2026-03-24  
**Status:** In Progress

## Overview

Chief Clarity has been refactored from a **hardcoded Python orchestrator** to an **agent-driven architecture** where agents control the workflow.

## What Changed

### Before (Legacy - v2.x)

```python
# Python script decides everything
def execute_intake():
    input_txt = read_file("input.txt")  # ❌ Hardcoded
    calendar = read_file("calendar.md")  # ❌ Hardcoded
    # ... hardcoded prompts ...
    write_file("calendar.md", outputs["calendar_md"])  # ❌ Hardcoded
    write_file("tasks.md", outputs["tasks_md"])  # ❌ Hardcoded

# Hardcoded execution order
execute_chiefclarity()
execute_intake()
execute_planning()
execute_writer()
```

### After (Agent-Driven - v3.0)

```python
# Agents decide everything
def execute_agent(agent_name, context):
    agent_definition = read_file(f"agents/{agent_name}.md")
    # Agent reads its definition
    # Agent decides what files to read
    # Agent decides what to output
    # Agent decides next agent
    result = call_claude(agent_definition, context)
    return result

# Agent-driven loop
while current_agent:
    result = execute_agent(current_agent, context)
    current_agent = result.get("next_agent")  # ✅ Agent decides
```

## Key Principles

1. **Agents control workflow** - Not Python script
2. **Agents decide file I/O** - Not hardcoded paths
3. **Agents decide execution order** - Not fixed sequence
4. **Agent definitions are source of truth** - Not Python code

## Files

### New Files
- `run_chiefclarity.py` - Thin execution layer (v3.0)
- `MIGRATION_GUIDE.md` - This file

### Backup Files
- `run_chiefclarity_legacy.py` - Original script (v2.x)

### Updated Files
- `agents/cc_chiefclarity_agent.md` - Added agent-driven execution section
- `agents/cc_intake_agent.md` - Added agent-driven execution section
- `agents/cc_planning_agent.md` - Added agent-driven execution section
- `agents/cc_writer_agent.md` - Added agent-driven execution section

## Migration Strategy (Hybrid Approach)

### Phase 1: Setup ✅
- [x] Backup legacy script as `run_chiefclarity_legacy.py`
- [x] Create new agent-driven `run_chiefclarity.py`
- [x] Update agent markdown files with execution instructions

### Phase 2: Testing (In Progress)
- [ ] Test with `answer_input_questions` mode (simplest)
- [ ] Compare output with legacy script
- [ ] Fix any issues

### Phase 3: Migration
- [ ] Test `prepare_tomorrow` mode
- [ ] Test `prepare_today` mode
- [ ] Test `prepare_week` mode
- [ ] Test `full_analysis` mode

### Phase 4: Validation
- [ ] Run both scripts side-by-side for 1 week
- [ ] Compare outputs for consistency
- [ ] Document any differences

### Phase 5: Deprecation
- [ ] Archive legacy script
- [ ] Update README.md
- [ ] Update CHANGELOG.md

## How to Test

### Run Legacy Script
```powershell
python run_chiefclarity_legacy.py
```

### Run New Agent-Driven Script
```powershell
python run_chiefclarity.py
```

### Compare Outputs
```powershell
# Compare focus.md files
diff data/focus.md data/focus_legacy.md

# Compare all generated files
diff -r data/ data_legacy/
```

## Agent Output Format

All agents now output JSON:

```json
{
  "files_read": ["file1.md", "file2.md"],
  "outputs": {
    "output1.md": "content here",
    "output2.json": "{\"key\": \"value\"}"
  },
  "next_agent": "cc_next_agent" or null,
  "status": "completed" | "blocked" | "needs_clarification",
  "message": "Human-readable status"
}
```

## Rollback Plan

If issues arise:

1. **Immediate rollback:**
   ```powershell
   Copy-Item run_chiefclarity_legacy.py run_chiefclarity.py -Force
   ```

2. **Restore agent files:**
   ```powershell
   git checkout agents/
   ```

3. **Report issues** in GitHub or to development team

## Benefits of New Architecture

1. ✅ **No hardcoded logic** - All logic in agent markdown files
2. ✅ **Flexible workflows** - Agents decide execution order
3. ✅ **Easy to extend** - Add new agents by creating markdown files
4. ✅ **Easy to modify** - Change agent behavior by editing markdown
5. ✅ **No Python changes** - Modify agents without touching code
6. ✅ **True agent autonomy** - Agents control their own execution

## Known Issues

- [ ] None yet (testing in progress)

## Support

- Legacy script: `run_chiefclarity_legacy.py` (v2.x)
- New script: `run_chiefclarity.py` (v3.0)
- Documentation: `README.md`, `CHANGELOG.md`
- Agent definitions: `agents/*.md`

## Next Steps

1. Test new architecture with simple mode
2. Compare outputs with legacy
3. Fix any issues
4. Gradually migrate all modes
5. Deprecate legacy script when stable
