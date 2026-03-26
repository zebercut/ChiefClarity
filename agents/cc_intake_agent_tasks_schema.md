<!-- SYSTEM FILE - Do not modify. This file defines the tasks.json schema for the Intake Agent. -->

# tasks.json Schema

## Structure

```json
{
  "schema_version": "1.0",
  "last_updated": "YYYY-MM-DDTHH:MM:SS-04:00",
  "timezone": "America/Toronto",
  "tasks": [
    {
      "id": "TASK-XXX",
      "title": "Task title",
      "due_date": "YYYY-MM-DDTHH:MM:SS-04:00",
      "status": "pending|in_progress|completed|blocked|at_risk|overdue|unknown",
      "priority": "critical|high|medium|low",
      "time_allocated_minutes": 60,
      "time_window": {
        "start": "HH:MM",
        "end": "HH:MM"
      },
      "related_items": ["CAL-XXX", "TASK-YYY", "INBOX-ZZZ"],
      "tags": ["tag1", "tag2"],
      "notes": "Additional context",
      "created": "YYYY-MM-DDTHH:MM:SS-04:00",
      "completed": "YYYY-MM-DDTHH:MM:SS-04:00 or null",
      "blocked_by": ["TASK-YYY"]
    }
  ],
  "metadata": {
    "total_tasks": 0,
    "active_tasks": 0,
    "completed_tasks": 0,
    "overdue_tasks": 0,
    "at_risk_tasks": 0,
    "blocked_tasks": 0
  }
}
```

## Field Definitions

### Task Object

- **id** (string, required): Unique task identifier (format: `TASK-XXX`)
- **title** (string, required): Short task description
- **due_date** (ISO 8601 datetime, required): When task is due (with timezone)
- **status** (enum, required): Current task status
  - `pending`: Not started
  - `in_progress`: Currently working on it
  - `completed`: Finished
  - `blocked`: Cannot proceed (see `blocked_by`)
  - `at_risk`: May not complete on time
  - `overdue`: Past due date, not completed
  - `unknown`: Status unclear
- **priority** (enum, required): Task priority level
  - `critical`: Must be done, high impact
  - `high`: Important, should be done soon
  - `medium`: Normal priority
  - `low`: Nice to have
- **time_allocated_minutes** (integer, required): Estimated time in minutes
- **time_window** (object, optional): Specific time slot for task
  - `start`: Start time (HH:MM format)
  - `end`: End time (HH:MM format)
- **related_items** (array of strings, optional): Related calendar events, tasks, or inbox items
- **tags** (array of strings, optional): Categorization tags (e.g., "work", "family", "finance")
- **notes** (string, optional): Additional context or details
- **created** (ISO 8601 datetime, required): When task was created
- **completed** (ISO 8601 datetime or null, required): When task was completed (null if not completed)
- **blocked_by** (array of strings, optional): Task IDs that block this task

### Metadata Object

- **total_tasks**: Total number of tasks in file
- **active_tasks**: Tasks with status != completed
- **completed_tasks**: Tasks with status = completed
- **overdue_tasks**: Tasks with status = overdue
- **at_risk_tasks**: Tasks with status = at_risk
- **blocked_tasks**: Tasks with status = blocked

## Generation Rules

1. **Read existing tasks.json** before updating
2. **Preserve existing tasks** unless explicitly modified by user input
3. **Update metadata** counts after modifying tasks array
4. **Use ISO 8601 datetime format** with timezone for all timestamps
5. **Auto-detect overdue tasks**: If due_date < current_time and status != completed, set status = overdue
6. **Validate task IDs**: Ensure unique, sequential TASK-XXX format
7. **Update last_updated** timestamp on every write

## Example Task Parsing

**Input from input.txt:**
```
- Submit taxes by 5 PM today (3.5 hours allocated, 8:30 AM-12:00 PM)
```

**Output in tasks.json:**
```json
{
  "id": "TASK-XXX",
  "title": "Submit taxes",
  "due_date": "2026-03-25T17:00:00-04:00",
  "status": "pending",
  "priority": "critical",
  "time_allocated_minutes": 210,
  "time_window": {
    "start": "08:30",
    "end": "12:00"
  },
  "related_items": [],
  "tags": ["tax", "deadline"],
  "notes": "Tax deadline TODAY by 5 PM",
  "created": "2026-03-25T08:00:00-04:00",
  "completed": null,
  "blocked_by": []
}
```
