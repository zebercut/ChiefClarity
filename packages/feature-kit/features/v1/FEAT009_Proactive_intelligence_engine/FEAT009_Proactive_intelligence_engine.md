# F09 — Proactive intelligence engine

Nudges, conflict detection, and smart follow-ups that surface issues before they become problems.

---

## What this delivers

The app doesn't wait for you to ask. It watches your tasks, calendar, and OKRs, and proactively alerts you when something needs attention — with one-tap actions to resolve it.

## Capabilities (shipped)

- **9 nudge types** — overdue task follow-up, event preparation reminder, stalled task detection, OKR pace warning, forgotten inbox items, scheduling conflicts, deadline approaching, recurring task check-in, weekly review prompt.
- **Quick actions** — each nudge includes contextual actions: snooze, reschedule, mark done, dismiss. One tap, no chat required.
- **Cooldown system** — prevents nudge fatigue. Each type has a minimum interval (e.g., same overdue task won't re-nudge for 24 hours).
- **Calendar conflict detection** — when two events overlap, surfaces a conflict card with options: keep both, reschedule one, cancel one.
- **Priority-aware** — high-priority items nudge sooner and more frequently than low-priority ones.

## Architecture

- Nudges evaluated every 2 minutes via the polling loop.
- Cooldowns tracked per-item in `nudge_cooldowns.json`.
- Conflict detection runs on calendar write, not on a timer.
