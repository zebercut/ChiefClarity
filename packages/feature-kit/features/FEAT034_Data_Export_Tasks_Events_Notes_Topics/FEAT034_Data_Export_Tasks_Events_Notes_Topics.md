# FEAT034 — Data Export (Tasks, Events, Notes, Topics)

**Type:** feature
**Status:** Planned | **Progress:** 0%
**MoSCoW:** SHOULD
**Category:** Data Management
**Priority:** 3  
**Release:** v2.2  
**Tags:** export, backup, data, portability  
**Created:** 2026-04-07

---

## Summary

Allow the user to export their LifeOS data — tasks, calendar events, notes, and topics — in formats best suited to each data type. Supports backup, migration to other tools, offline analysis, and data portability/ownership.

---

## Problem Statement

User data lives inside LifeOS files with no easy way to:
- Back up to an external location in a usable form
- Move data to another tool (Obsidian, Notion, Google Calendar, Excel)
- Analyze tasks/notes outside the app
- Have peace of mind that data is portable and not locked in

---

## User Stories

### Story 1 — Per-type export
**As a** user, **I want** to export each data type individually in its best format, **so that** I can use the data in the right downstream tool without conversion.

**Acceptance Criteria:**
- [ ] Tasks export to CSV (flat) and JSON (lossless with subtasks/metadata)
- [ ] Calendar events export to ICS (.ics standard)
- [ ] Notes export to a zip of Markdown files (one file per note)
- [ ] Topics export to a zip of Markdown files (native format)
- [ ] Each export downloads with a timestamped filename

### Story 2 — Export everything
**As a** user, **I want** a single "Export Everything" action, **so that** I can get a complete backup in one click.

**Acceptance Criteria:**
- [ ] One button produces a single zip containing all four data types
- [ ] Zip is organized into folders: `/tasks`, `/events`, `/notes`, `/topics`
- [ ] Filename includes ISO timestamp

---

## Workflow

```
Settings → Export Data → choose type (or "Export Everything") → file downloads
```

---

## Format Decisions

| Data Type | Primary Format | Why |
|-----------|---------------|-----|
| Tasks | CSV + JSON | CSV for spreadsheets, JSON for lossless re-import |
| Calendar Events | ICS (.ics) | Universal standard, imports into Google/Apple/Outlook |
| Notes | Markdown (zipped) | Compatible with Obsidian, Notion, plain text editors |
| Topics | Markdown (zipped) | Already native format on disk |

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Empty data type | Export still produces a file (empty CSV / empty zip) with a header row |
| Very large export | Stream / chunk write to avoid memory spike |
| Special characters in note titles | Sanitize filenames for cross-platform safety |
| Recurring events | Expand to RRULE in ICS, do not flatten |
| Archived/completed items | Include by default; consider toggle in v2 |

---

## Success Metrics

- User can produce a complete backup in under 10 seconds
- Exported ICS imports cleanly into Google Calendar with no errors
- Exported Markdown notes open correctly in Obsidian

---

## Out of Scope (v1)

- Date range filters
- Selective export (pick individual items)
- Re-import / restore from export
- Cloud sync / scheduled automatic backups
- PDF export

---

## Architecture Notes

- New module: `src/modules/exporter.ts` — pure functions per data type returning Blob/string
- New UI: Settings panel section "Export Data" with buttons per type + "Export Everything"
- Use `jszip` (or similar) for zip bundling — check if already in deps
- Filenames: `lifeos-tasks-2026-04-07.csv`, `lifeos-export-2026-04-07T14-30.zip`
- All export logic runs client-side; no server calls
- Reads existing data files via `filesystem.ts`, does NOT mutate state

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/modules/exporter.ts` | NEW — format converters and zip bundler |
| `app/components/Settings.tsx` (or equivalent) | NEW export section with buttons |
| `package.json` | Add `jszip` if not present |
| `docs/new_architecture_typescript.md` | Document new module + feature |
| `README.md` | Add to feature list |

---

## Testing Notes

- [ ] Unit tests for each format converter (tasks→CSV, events→ICS, etc.)
- [ ] Test ICS output against a real calendar app import
- [ ] Test zip integrity and folder structure
- [ ] Test with empty datasets
- [ ] Test with unicode/emoji in titles and content

---

## Open Questions

- Should "Export Everything" also include user profile / settings?
- CSV vs JSON for tasks — offer both, or pick one as default?
- Where in the UI does this live — Settings, or its own "Data" tab?
- Do we need a confirmation/progress indicator for large exports?
