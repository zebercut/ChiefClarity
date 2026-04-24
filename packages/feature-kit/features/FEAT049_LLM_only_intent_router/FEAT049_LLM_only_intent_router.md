# FEAT049 — LLM-Only Intent Router

**Status:** Planned  
**MoSCoW:** MUST  
**Category:** Core  
**Priority:** 2  
**Release:** v2.3  
**Tags:** router, intent, classification, haiku, triage  
**Created:** 2026-04-21

---

## Problem Statement

The intent router uses a two-tier system: regex patterns first, Haiku LLM fallback second. This causes misclassification bugs that produce user-visible damage:

- **Nudge action "Focus on the 3 overdue high-priority tasks first" was classified as `full_planning`** — Haiku saw "focus" + "priority" + "tasks" and generated a full daily plan instead of triaging 3 overdue items. The user got "Your day is planned" instead of a triage response.
- **Regex patterns are too narrow** — "help me plan my schedule" doesn't match `full_planning` regex (`/\bplan (my )?(week|day|month|tomorrow)\b/i`), so it falls to Haiku. But "plan my day" matches regex and skips Haiku. Two paths for the same intent = inconsistent behavior.
- **Regex patterns are unmaintainable** — every new intent (topic_query, topic_note, bulk_input) needs new patterns. They're never complete, never tested, and fail silently on edge cases.
- **Cost argument is obsolete** — Haiku classification costs ~$0.00005 per call (~50 input tokens). At 100 messages/day = $0.005/day. The regex saves a fraction of a cent while introducing misclassification risk.

---

## Goals

1. Single classification path — every user phrase goes through one classifier, producing consistent results
2. Higher accuracy — the classifier has context (conversation history, available intents, examples) instead of pattern matching against isolated keywords
3. Zero maintenance for new intents — adding a new intent means updating the classifier prompt, not writing regex
4. Support for action-with-intent — nudge quick-actions and smart actions can carry a pre-set intent that bypasses classification entirely

---

## Success Metrics

- Zero regex patterns in router.ts (PATTERNS array removed)
- Misclassification rate on a test corpus of 50 phrases is lower than current regex+Haiku combo
- Nudge/smart-action taps that carry an explicit intent are never reclassified
- P95 classification latency < 500ms (Haiku is ~200-300ms today)

---

## User Stories

### Story 1 — Remove regex classification tier

**As a** developer maintaining the router, **I want** a single LLM-based classifier instead of regex+LLM, **so that** there's one path to maintain and intent accuracy improves.

**Acceptance Criteria:**
- [ ] Given any user phrase, when `classifyIntentWithFallback()` is called, then the Haiku LLM classifier runs (no regex pre-check)
- [ ] The `PATTERNS` array and `classifyIntent()` regex function are removed from `router.ts`
- [ ] The Haiku classification prompt includes 2-3 disambiguating examples per intent (not just category names)
- [ ] Given the phrase "Focus on the 3 overdue high-priority tasks first", then the classifier returns `task_query`, not `full_planning`
- [ ] Given the phrase "plan my day", then the classifier returns `full_planning` (same as regex did, no regression)
- [ ] Given the phrase "note for health: dentist appointment tomorrow", then the classifier returns `topic_note`
- [ ] Given the circuit breaker is open (no API), then the router returns `general` as fallback (same as today)

### Story 2 — Improved classification prompt with examples

**As a** user, **I want** the classifier to understand the difference between similar-sounding phrases, **so that** triage requests don't become planning requests.

**Acceptance Criteria:**
- [ ] The classification prompt includes at least 2 examples per intent showing what DOES and what does NOT belong to that category
- [ ] Given "show me my overdue tasks", the classifier returns `task_query`, not `full_planning`
- [ ] Given "prepare for tomorrow", the classifier returns `full_planning`
- [ ] Given "I'm exhausted", the classifier returns `emotional_checkin`, not `general`
- [ ] Given "stop suggesting tasks at night", the classifier returns `feedback`
- [ ] Given "what do I know about the job search topic", the classifier returns `topic_query`

### Story 3 — Pre-set intent on quick actions

**As a** user tapping a nudge suggestion or smart action, **I want** the system to execute the action I chose without reclassifying it, **so that** "Focus on overdue tasks" doesn't turn into "plan my day."

**Acceptance Criteria:**
- [ ] Given a nudge quick-action has `intent: "task_query"` in its metadata, when the user taps it, then the router uses `task_query` directly without calling Haiku
- [ ] Given a smart action has `intent: "task_update"` in its metadata, when the user taps it, then the router uses `task_update` directly
- [ ] Given a suggestion has no `intent` field (legacy format), then the router classifies normally via Haiku
- [ ] The `Nudge` type includes an optional `intent?: IntentType` field on each action
- [ ] The `SmartAction` type includes an optional `intent?: IntentType` field

### Story 4 — Semantic similarity fallback via embeddings

**As a** user typing a phrase that Haiku can't confidently classify, **I want** the system to check against known phrases using vector similarity, **so that** common variations of the same intent are handled consistently.

**Acceptance Criteria:**
- [ ] Given a set of canonical phrases per intent stored in a reference table (e.g., `intent_examples` in libSQL), when Haiku returns `general` (low confidence), then the system checks the phrase's embedding against the reference embeddings
- [ ] Given the phrase "help me sort out my week" and a reference phrase "plan my week" with cosine distance < 0.15, then the system returns `full_planning`
- [ ] Given no reference phrase matches within threshold, then the system returns `general` (same as today's fallback)
- [ ] The reference table is populated with 5-10 canonical phrases per intent at migration time
- [ ] New canonical phrases can be added via a CLI command or settings panel (future)

---

## Architecture Notes

*To be filled by Architect Agent.*

### Key decisions needed:
- Should the classification prompt use few-shot examples (in the system prompt) or a separate fine-tuned classifier?
- Should the embedding fallback (Story 4) run in parallel with Haiku or only when Haiku returns `general`?
- Token budget: the classification prompt with examples will be ~200-300 tokens. Verify this doesn't cause latency regression.

### Modules affected:
- `src/modules/router.ts` — remove PATTERNS, update classifyIntentWithFallback
- `src/modules/proactiveEngine.ts` — add `intent` field to nudge actions
- `src/modules/smartActions.ts` — add `intent` field to smart actions
- `app/(tabs)/chat.tsx` — pass intent from action metadata to router if present
- `src/db/migrations/` — new migration for `intent_examples` table (Story 4)

---

## Out of Scope

- Fine-tuning a dedicated classification model
- Multi-intent detection (e.g., "plan my day and tell me about the job search topic" → two intents)
- Client-side classification (on-device model) for offline mode
- Changing the intent taxonomy itself (same intents, better routing)

---

## Open Questions

1. Should Story 4 (embedding fallback) be in this feature or deferred to a later release? It adds complexity but catches edge cases Haiku misses.
2. Should we keep a minimal regex layer for truly deterministic phrases (e.g., `/^plan my (day|week)$/i`) as a fast-path optimization, or go fully LLM? The PM recommends fully LLM for simplicity; the Architect may disagree for latency reasons.
3. How many few-shot examples per intent is optimal? Too few = poor accuracy. Too many = token bloat. Need testing.
