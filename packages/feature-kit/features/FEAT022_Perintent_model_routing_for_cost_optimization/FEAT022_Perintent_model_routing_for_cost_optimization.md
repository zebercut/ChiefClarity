# FEAT022 — Per-intent model routing for cost optimization

**Status:** Planned
**MoSCoW:** SHOULD
**Category:** Infrastructure
**Priority:** 3  
**Release:** v1.0  
**Tags:** llm, cost, performance  
**Created:** 2026-04-05

---

## Summary

Route simple/low-stakes intents to Haiku 4.5 instead of Sonnet 4.6. Keep Sonnet for complex intents that require nuanced judgment and large structured outputs. Add a Sonnet fallback when Haiku output fails validation.

---

## Problem Statement

All 17 intents currently use `claude-sonnet-4-6` ($3/$15 per MTok). Simple CRUD operations like `task_update` or `feedback` produce 1-2 small writes and a short reply — they don't need Sonnet. Haiku 4.5 ($1/$5 per MTok) is 67% cheaper and handles simple structured output reliably.

---

## Current State (what exists today)

```typescript
// src/modules/llm.ts — lines 74-80
const MODEL_BY_INTENT: Partial<Record<IntentType, string>> = {
  full_planning: "claude-sonnet-4-6",
  suggestion_request: "claude-sonnet-4-6",
  emotional_checkin: "claude-sonnet-4-6",
  bulk_input: "claude-sonnet-4-6",
};
const DEFAULT_MODEL = "claude-sonnet-4-6";
```

Everything falls through to Sonnet. The `MODEL_BY_INTENT` map only exists because it was set up for future routing — but `DEFAULT_MODEL` is also Sonnet, so no intent actually uses Haiku today.

Note: Haiku is already in the codebase — `router.ts:165` uses it for intent classification (a 50-token call).

---

## Model Routing Plan

### Tier 1 — Sonnet 4.6 (complex judgment, large structured output)

| Intent | Why Sonnet | Typical output |
|--------|-----------|----------------|
| `full_planning` | 330-line system prompt, deeply nested focusBrief with routineTemplate/additions/removals/overrides, companion section, OKR snapshot, travel rule, overlap detection. Hardest task in the system. | 4K-10K tokens |
| `bulk_input` | Parses freeform multi-item inbox text into multiple write operations across different files. Must not miss items. | 2K-4K tokens |
| `suggestion_request` | Needs nuanced judgment, checks suggestionsLog history, considers work patterns. | 1K-2K tokens |
| `emotional_checkin` | Empathy quality directly impacts user trust. Output is small but tone matters. Cost is negligible (small output) — not worth risking quality. | 200-500 tokens |

### Tier 2 — Haiku 4.5 (simple CRUD, structured writes, short replies)

| Intent | Why Haiku | Typical output |
|--------|----------|----------------|
| `task_create` | 1 write to tasks, short reply. Well-defined schema. | 200-400 tokens |
| `task_update` | 1 write (status/priority/due change), short reply. | 150-300 tokens |
| `task_query` | Search tasksIndex, return items array. No writes. | 300-800 tokens |
| `calendar_create` | 1 write to calendar, short reply. | 200-400 tokens |
| `calendar_update` | 1 write (reschedule/cancel), short reply. | 150-300 tokens |
| `calendar_query` | Return events as items array. No writes. | 300-800 tokens |
| `okr_update` | Structured update with well-defined write patterns. | 300-600 tokens |
| `info_lookup` | Search contentIndex, answer from data. No writes. | 300-800 tokens |
| `learning` | Simple learning log entry. | 200-400 tokens |
| `feedback` | Acknowledge preference, 1 write to feedbackMemory. | 150-300 tokens |
| `general` | Catch-all. Gets task+calendar data. Simple answers. | 300-800 tokens |
| `topic_query` | Search and return topic data. | 300-800 tokens |
| `topic_note` | Simple note addition to topic. | 200-400 tokens |

### Decision: `emotional_checkin` stays on Sonnet

The original draft proposed Haiku. After review: the output cost for emotional_checkin is tiny (200-500 output tokens = $0.001 on Sonnet vs $0.00025 on Haiku). The savings are negligible but the quality difference in empathetic language is noticeable. Keep on Sonnet.

---

## Sonnet Fallback on Haiku Validation Failure

When Haiku's output fails `validateActionPlan`, retry once with Sonnet before giving up. This is the safety net.

### Design

```
Haiku call → validateActionPlan → PASS → return plan (recordSuccess)
                                → FAIL → retry with Sonnet → validate → return or null
```

**Rules:**
- Fallback retry does NOT count toward the circuit breaker (it's a planned escalation, not a failure)
- Fallback only triggers on validation failure, not on API errors (auth, rate limit, network)
- Log the fallback: `[LLM] Haiku validation failed for {intent} — retrying with Sonnet`
- If Sonnet fallback also fails validation, THAT counts as a circuit breaker failure

---

## Realistic Cost Savings Estimate

The original spec claimed 40-45%. That's wrong. Here's why:

**Cost is dominated by `full_planning`** — it sends ~12K input tokens and receives 4-10K output tokens. This single intent accounts for ~60-70% of total API spend (it runs every morning, evening, and on-demand). It stays on Sonnet.

| Intent tier | % of calls | % of cost | Model change |
|-------------|-----------|-----------|--------------|
| Sonnet intents (4) | ~30% | ~75% | No change |
| Haiku intents (13) | ~70% | ~25% | 67% cheaper |

**Realistic savings: 15-20% of total API cost.**

This is still meaningful — at your usage pattern of ~10-15 calls/day, it saves ~$3-5/month. The main cost lever remains reducing `full_planning` frequency or token count (separate optimization).

---

## Implementation (Done)

### Files changed

| File | Change |
|------|--------|
| `src/modules/llm.ts` | Model constants from env, routing map, `sendLlmRequest` helper, Sonnet fallback, `MODEL_LIGHT` export |
| `src/modules/router.ts` | Import `MODEL_LIGHT` from llm.ts, remove hardcoded Haiku model ID |
| `.env` | Add `LLM_MODEL_HEAVY` / `LLM_MODEL_LIGHT` (commented out, defaults apply) |

### Model configuration

Model IDs are configurable via environment variables. Defaults are hardcoded so the app works without any env config:

```
# .env — uncomment and change when models are deprecated
# LLM_MODEL_HEAVY=claude-sonnet-4-6
# LLM_MODEL_LIGHT=claude-haiku-4-5-20251001
```

- `LLM_MODEL_HEAVY` → used for full_planning, suggestion_request, emotional_checkin, bulk_input
- `LLM_MODEL_LIGHT` → used for all other intents + intent classification in router.ts
- When Anthropic deprecates a model: edit `.env`, restart — no code change needed

### Sonnet fallback

`callLlm` calls `sendLlmRequest(model, ...)`. If the model was Haiku and output fails validation, it retries once with Sonnet. API errors throw (no fallback for auth/rate limit). The fallback does not count toward the circuit breaker — only final failures do.

### Logging

```
[LLM] haiku attempt 1, model=claude-haiku-4-5-20251001, max_tokens=1024, intent=task_create
[LLM] sonnet attempt 1, model=claude-sonnet-4-6, max_tokens=4000, intent=full_planning
[LLM] Haiku output failed validation for task_create — retrying with Sonnet
```

---

## What was NOT changed

- **System prompt** (`prompts.ts`): Same prompt for both models.
- **Tool schema** (`ACTION_PLAN_TOOL`): Same schema for both models.
- **Token budgets** (`router.ts`): Control context assembly, not model selection.
- **`estimateMaxTokens`**: Same logic — Haiku also has 64K output cap.
- **Circuit breaker**: Haiku→Sonnet fallback is exempt. Only final failures count.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Haiku returns malformed JSON | `validateActionPlan` catches it → Sonnet fallback → validate again |
| Sonnet fallback also fails | `recordFailure` called, null returned, circuit breaker tracks it |
| New intent added without mapping | Falls through to `DEFAULT_MODEL` (Haiku). Safe — Sonnet fallback protects. |
| Haiku API error (auth, rate limit) | No fallback (API error, not validation failure). `recordFailure` called. |
| `max_tokens` truncation on Haiku | Existing retry logic doubles budget and retries (same model). Only falls back to Sonnet on validation failure. |
| Model deprecated by Anthropic | Change `LLM_MODEL_HEAVY` / `LLM_MODEL_LIGHT` in `.env` and restart. No code change. |

---

## Testing Plan

### Automated (check logs)
- [ ] `task_create` → log shows `model=claude-haiku-4-5-20251001`
- [ ] `full_planning` → log shows `model=claude-sonnet-4-6`
- [ ] Each of the 13 Haiku intents produces a valid ActionPlan
- [ ] Fallback: intentionally corrupt Haiku response (mock) → Sonnet retry fires → valid plan returned

### Manual smoke test
- [ ] "Add a task: buy groceries" → task created (Haiku)
- [ ] "Plan my day" → full brief generated (Sonnet)
- [ ] "Mark buy groceries as done" → task updated (Haiku)
- [ ] "What's on my calendar?" → events listed (Haiku)
- [ ] "How am I doing?" → suggestions returned (Sonnet)
- [ ] "Feeling stressed today" → empathetic reply (Sonnet)
- [ ] Headless runner morning/evening jobs still work

### Monitoring (first week)
- [ ] Track Haiku validation pass rate — should be >95%
- [ ] Track Sonnet fallback frequency — should be <5% of Haiku calls
- [ ] Compare API cost before/after (Anthropic dashboard)

---

## Open Questions — Resolved

| Question | Resolution |
|----------|-----------|
| Should `emotional_checkin` use Haiku? | **No.** Cost difference is negligible ($0.00075/call), empathy quality matters. |
| Should `DEFAULT_MODEL` be Haiku? | **Yes.** New intents default cheap. Sonnet fallback protects against quality issues. |
| What if Haiku quality degrades over time? | Monitor validation pass rate. If it drops below 90% for any intent, move that intent back to Sonnet in `MODEL_BY_INTENT`. One-line change. |
| What if models get deprecated? | Model IDs come from `LLM_MODEL_HEAVY` / `LLM_MODEL_LIGHT` env vars. Edit `.env` and restart — no code change needed. |
