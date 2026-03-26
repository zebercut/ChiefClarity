<!-- SYSTEM FILE - Do not modify. This file defines the calendar.json schema for the Intake Agent. -->

# calendar.json Schema

## Structure

```json
{
  "schema_version": "1.0",
  "last_updated": "YYYY-MM-DDTHH:MM:SS-04:00",
  "timezone": "[Timezone]",
  "events": [
    {
      "id": "CAL-XXX",
      "title": "Event title",
      "date": "YYYY-MM-DDTHH:MM:SS-04:00",
      "duration_minutes": 60,
      "status": "confirmed|pending|completed|cancelled|not_confirmed|active",
      "type": "appointment|deadline|reminder|family|work|habit|planning|interview|focus|reflection|maintenance|coordination|decision|content",
      "location": "Location string or null",
      "notes": "Additional context",
      "related_items": ["CAL-YYY", "TASK-ZZZ", "INBOX-AAA"],
      "created": "YYYY-MM-DDTHH:MM:SS-04:00"
    }
  ],
  "recurring_events": [
    {
      "id": "REC-XXX",
      "title": "Recurring event title",
      "recurrence": {
        "frequency": "daily|weekly",
        "time": "HH:MM",
        "duration_minutes": 60,
        "day_of_week": "monday|tuesday|wednesday|thursday|friday|saturday|sunday"
      },
      "status": "active|inactive",
      "type": "habit|family|planning",
      "notes": "Additional context",
      "created": "YYYY-MM-DDTHH:MM:SS-04:00"
    }
  ],
  "metadata": {
    "total_events": 0,
    "active_events": 0,
    "completed_events": 0,
    "recurring_patterns": 0,
    "confirmed_events": 0,
    "not_confirmed_events": 0
  }
}
```

## Field Definitions

### Event Object

- **id** (string, required): Unique event identifier (format: `CAL-XXX`)
- **title** (string, required): Event description
- **date** (ISO 8601 datetime, required): When event occurs (with timezone)
- **duration_minutes** (integer, required): Duration in minutes (0 for point events)
- **status** (enum, required): Current event status
  - `confirmed`: Scheduled and confirmed
  - `pending`: Tentative or needs confirmation
  - `completed`: Already happened
  - `cancelled`: Cancelled
  - `not_confirmed`: Not yet confirmed
  - `active`: Currently in progress
- **type** (enum, required): Event category
  - `appointment`: Scheduled meeting
  - `deadline`: Due date
  - `reminder`: Alert/notification
  - `family`: Family-related
  - `work`: Work-related
  - `habit`: Recurring personal habit
  - `planning`: Planning session
  - `interview`: Job interview
  - `focus`: Deep work block
  - `reflection`: Review/debrief
  - `maintenance`: Car/home maintenance
  - `coordination`: Logistics coordination
  - `decision`: Decision point
  - `content`: Content creation/publishing
- **location** (string or null, optional): Physical location
- **related_items** (array of strings, optional): Related tasks, events, or inbox items
- **notes** (string, optional): Additional context
- **created** (ISO 8601 datetime, required): When event was created

### Recurring Event Object

- **id** (string, required): Unique recurring event identifier (format: `REC-XXX`)
- **title** (string, required): Event description
- **recurrence** (object, required): Recurrence pattern
  - `frequency`: `daily` or `weekly`
  - `time`: Time of day (HH:MM format)
  - `duration_minutes`: Duration in minutes
  - `day_of_week`: Day name for weekly events (monday-sunday)
- **status** (enum, required): `active` or `inactive`
- **type** (enum, required): Event category (subset of event types)
- **notes** (string, optional): Additional context
- **created** (ISO 8601 datetime, required): When pattern was created

### Metadata Object

- **total_events**: Total number of one-time events
- **active_events**: Events with status = active or confirmed
- **completed_events**: Events with status = completed
- **recurring_patterns**: Number of recurring event patterns
- **confirmed_events**: Events with status = confirmed
- **not_confirmed_events**: Events with status = not_confirmed

## Generation Rules

1. **Read existing calendar.json** before updating
2. **Preserve existing events** unless explicitly modified by user input
3. **Update metadata** counts after modifying events array
4. **Use ISO 8601 datetime format** with timezone for all timestamps
5. **Auto-detect completed events**: If event date < current_time and status != completed, set status = completed
6. **Validate event IDs**: Ensure unique, sequential CAL-XXX format
7. **Update last_updated** timestamp on every write

## Recurring Event Expansion

When querying for specific dates:
1. Start with base events in `events` array
2. Expand `recurring_events` for target date range:
   - Daily: Add event if time matches any date
   - Weekly: Add event if day_of_week matches target date
3. Generate temporary event objects with expanded dates
4. Merge with base events for final result

## Example Event Parsing

**Input from input.txt:**
```
- Meeting with [Person X] at [Time] [Relative Date] ([Duration], [Context])
```

**Output in calendar.json:**
```json
{
  "id": "CAL-XXX",
  "title": "Meeting with [Person X]",
  "date": "YYYY-MM-DDTHH:MM:SS-04:00",
  "duration_minutes": 30,
  "status": "pending",
  "type": "interview",
  "location": null,
  "notes": "[Context]",
  "created": "YYYY-MM-DDTHH:MM:SS-04:00"
}
```
