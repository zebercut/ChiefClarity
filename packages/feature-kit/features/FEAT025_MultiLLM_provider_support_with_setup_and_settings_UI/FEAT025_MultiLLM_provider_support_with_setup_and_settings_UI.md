# FEAT025 — Multi-LLM provider support with setup and settings UI

**Status:** Planned
**MoSCoW:** COULD
**Category:** Infrastructure
**Priority:** 5  
**Release:** v2.0  
**Tags:** llm, multi-provider, settings, openai  
**Created:** 2026-04-05

---

## Summary

Allow users to choose their LLM provider (Anthropic, OpenAI, etc.) during initial setup or change it later via a settings screen. Introduces a provider-agnostic adapter layer so the rest of the app doesn't care which LLM is behind the scenes.

---

## Problem Statement

The app is hardcoded to the Anthropic SDK. Users who have OpenAI credits, prefer GPT models, or want to use local models (Ollama) cannot use the app without an Anthropic API key. Supporting multiple providers broadens the user base and reduces vendor lock-in.

---

## User Stories

### Story 1 — Initial setup
**As a** new user, **I want** to pick my LLM provider and enter my API key during setup, **so that** I can use whichever AI service I already pay for.

**Acceptance Criteria:**
- [ ] Setup screen shows a provider dropdown (Anthropic, OpenAI, future: Gemini, Ollama)
- [ ] Key input label and validation adapt to the selected provider
- [ ] "Test key" button verifies the key works with the chosen provider
- [ ] Config saves both `llmProvider` and `llmApiKey`

### Story 2 — Change provider after setup
**As an** existing user, **I want** to switch my LLM provider in settings, **so that** I can move to a different service without re-installing.

**Acceptance Criteria:**
- [ ] Settings screen lets user change provider + key
- [ ] App re-initializes the LLM client on save without requiring restart
- [ ] Old key is securely overwritten

---

## Workflow

```
Setup / Settings screen
  → User picks provider from dropdown
  → User enters API key
  → "Test" validates key against provider's API
  → Save → initLlmClient() creates correct adapter
  → All LLM calls (router, companion) go through adapter
```

---

## Architecture — Adapter Layer

### Interface (`src/modules/llmAdapter.ts` — new file)

```
LlmAdapter {
  sendMessage(system, messages, tool, maxTokens) → ActionPlan | null
  classifyIntent(phrase) → string
  testConnection() → boolean
}
```

### Provider implementations

| Adapter | SDK | Tool use mechanism | Cheap model (for router) |
|---------|-----|--------------------|--------------------------|
| `AnthropicAdapter` | `@anthropic-ai/sdk` | `tool_choice` + `tool_use` blocks | Haiku 4.5 |
| `OpenAIAdapter` | `openai` | `functions` / `tool_choice` + `tool_calls` array | GPT-4o-mini |
| `OllamaAdapter` (future) | `ollama` | JSON mode with schema prompt | same model |

Each adapter:
1. Translates `submit_action_plan` tool schema into provider-specific format
2. Sends the request using the provider's SDK
3. Parses the response back into a plain `ActionPlan` object
4. Passes it through `validateActionPlan()` (shared, provider-agnostic)

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Provider returns malformed tool response | `validateActionPlan` rejects it; retry once; show error if still fails |
| User switches provider mid-session | Re-init adapter; next LLM call uses new provider; no stale client |
| Provider API is down | Existing circuit breaker logic works (it's in the shared layer) |
| User enters OpenAI key for Anthropic | "Test key" fails with clear error: "This key doesn't work with Anthropic" |
| Ollama model lacks tool-use support | Adapter falls back to JSON-mode prompt with schema in system message |

---

## Success Metrics

- App works end-to-end with at least 2 providers (Anthropic + OpenAI)
- No regression in action plan validation pass rate for Anthropic
- OpenAI validation pass rate > 95%

---

## Out of Scope

- Mixing providers (e.g., routing to OpenAI for some intents and Anthropic for others)
- Cost tracking / usage dashboards per provider
- Streaming responses
- Image/vision input differences between providers

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/modules/llmAdapter.ts` | **New.** Adapter interface + factory function `createAdapter(provider, apiKey)` |
| `src/modules/adapters/anthropic.ts` | **New.** Extract current `llm.ts` logic into adapter |
| `src/modules/adapters/openai.ts` | **New.** OpenAI implementation — map tool schema, parse `tool_calls` |
| `src/modules/llm.ts` | Simplify to thin wrapper that delegates to active adapter |
| `src/modules/router.ts` | Use adapter's `classifyIntent()` instead of direct Anthropic SDK call |
| `src/types/index.ts` | Add `llmProvider` to `AppConfig`; deprecate `anthropicApiKey` in favor of `llmApiKey` |
| `src/utils/config.ts` | Migration: read old `anthropicApiKey`, map to new fields |
| `app/setup.tsx` | Provider dropdown + adaptive key input + provider-specific test |
| `app/settings.tsx` | **New or extend.** Screen to change provider + key post-setup |
| `app/_layout.tsx` | Pass provider + key to `createAdapter()` instead of `initLlmClient()` |
| `package.json` | Add `openai` SDK as optional dependency |

---

## Dependencies

- **FEAT022** (per-intent model routing) should land first — this feature builds on the same `MODEL_BY_INTENT` map but makes it per-provider

---

## Testing Notes

- [ ] Anthropic adapter passes all existing intents (regression)
- [ ] OpenAI adapter passes `full_planning`, `task_create`, `quick_query` end-to-end
- [ ] Setup flow works with each provider
- [ ] Settings change re-initializes client correctly
- [ ] Config migration from old `anthropicApiKey` format works
- [ ] Circuit breaker works with each adapter
- [ ] `validateActionPlan` catches bad output from each provider

---

## Open Questions

- Should we ship with OpenAI only, or also Gemini in v1 of this feature?
- How to handle model-specific token limits (Anthropic 64k output vs OpenAI 16k)?
- Should the adapter layer live in its own package for reuse?
- Ollama: worth supporting given unreliable tool use, or wait for ecosystem to mature?
