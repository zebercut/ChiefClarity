# FEAT024 — Topic auto-promotion with periodic background detection

**Status:** Planned
**MoSCoW:** SHOULD
**Category:** Data
**Priority:** 4  
**Release:** v2.2  
**Tags:** topics, knowledge, automation  
**Created:** 2026-04-05

---

## Summary

Enhance the topic system (FEAT023) with periodic background detection of recurring topic hints. Instead of only counting after writes, a background check runs on an interval to evaluate deferred suggestions and re-count hints. TypeScript appends suggestion notifications after the LLM reply (deterministic, not probabilistic).

---

## Problem Statement

Phase 1 (FEAT023) counts topic hints only after writes. Deferred suggestions (user said "wait") never get re-evaluated unless the user happens to add another fact with that hint. This phase adds a periodic background scan so deferred topics get re-promoted when their count exceeds the raised threshold.

---

## User Stories

### Story 1: Deferred re-evaluation
**As a** user, **I want** a topic I deferred to be suggested again after more notes accumulate, **so that** I don't have to remember to create it manually.

**Acceptance Criteria:**
- [ ] Deferred suggestions re-evaluated every N minutes
- [ ] When count exceeds new threshold, status changes back to "pending"

### Story 2: Deterministic suggestion display
**As a** user, **I want** topic suggestions to appear as a consistent system message after the reply, **so that** they don't interfere with the LLM's main response.

**Acceptance Criteria:**
- [ ] TypeScript appends suggestion text after LLM reply (not LLM-generated)
- [ ] Only shown once per session per suggestion
- [ ] Respects loadingRef/inboxProcessingRef guards

---

## Workflow

```
Periodic check (every 5 min while app is open)
  -> Scan context_memory.facts for topic hint counts
  -> Update pendingSuggestions statuses
  -> If any newly "pending", flag for next interaction
  -> Next LLM reply: TypeScript appends suggestion line
```

---

## Architecture Notes

- New interval in chat.tsx or a dedicated topicChecker module
- Suggestion display is a TypeScript postprocessor on the LLM reply, not an LLM behavior
- Deferred suggestions track `suggestedAt` timestamp for cooldown

---

## Dependencies

- Requires FEAT023 (Topic Repository core system) to be completed first

---

## Out of Scope

- Smart topic merging (combining similar topics)
- Topic hierarchy or nesting
- NLP-based topic detection (beyond LLM hint assignment)
