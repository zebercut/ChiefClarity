# F15 — Multi-user

Shared task lists, family calendars, or collaborative planning.

---

## Status: Rejected

This was considered and explicitly rejected. The app is designed as a **personal** organizer. Multi-user adds complexity (permissions, conflict resolution, real-time sync) that conflicts with the core design of simple JSON files in a user-controlled folder.

## Why rejected

- JSON-file-on-disk architecture doesn't support concurrent writers safely.
- Personal organizer value proposition is strongest for individual use.
- Collaboration features would require a server, authentication, and permission model — fundamentally different architecture.
