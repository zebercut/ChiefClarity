# User Profile

This file is the **single source of truth** about the user. All Chief Clarity agents read this before processing. The Planning Agent may update it when the user states new preferences or routine facts.

---

## Identity

- preferred_name: (your name)
- family_members:
  - (abbreviation = name, relationship)
- timezone: (e.g. America/New_York)
- location: (city)

---

## Daily Routine (Weekdays)

| Time | Activity | Flexibility |
|------|----------|-------------|
| (wake time) | Wake up | fixed |
| (time) | (morning routine) | fixed |
| (time) | Deep work block | flexible |
| (time) | (midday activity) | flexible |
| (time) | (afternoon commitment) | fixed |
| (time) | Admin / light work | flexible |
| (time) | Sleep | fixed |

**Weekend capacity:** ~50% of weekday

---

## Preferences

- (activity): (preferred time and duration)
- (activity): (preferred time and duration)

---

## Work Style

- (observations about how you work best - the Planning Agent may add to this over time)

---

## Emotional State

- (updated from recent inputs when needed)

---

## Communication Style

- (how you prefer Chief Clarity to communicate with you)

---

## Task Completion Patterns

- (Planning Agent learns when you actually complete tasks vs. when you planned to)

---

## Goals Context

- (brief context about your current life situation that helps agents give better advice)

---

## Update Log

(Agents append updates here with timestamps)
