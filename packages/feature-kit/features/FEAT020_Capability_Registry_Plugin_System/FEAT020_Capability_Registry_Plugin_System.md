# FEAT020 — Capability Registry Plugin System

**Status:** Planned
**MoSCoW:** SHOULD
**Category:** Architecture
**Priority:** 2  
**Created:** 2026-04-04

---

## Summary

A plugin system that allows independent capabilities (e.g., travel-time estimation, weather context, email triage) to hook into the existing pipeline without modifying core modules. Each capability is a self-contained folder with a manifest, hook implementations, optional prompt fragments, and its own data files. Capabilities can be enabled/disabled independently.

---

## Problem Statement

Today, adding new functionality (like travel-time-aware scheduling) requires modifying core files: assembler.ts, prompts.ts, executor.ts, and loader.ts. This makes features tightly coupled, hard to test in isolation, and impossible to ship or enable independently. There is no way for a user to "install" or toggle a capability without code changes.

---

## User Stories

### Story 1 — Developer adds a new capability
**As a** developer, **I want** to add a new capability by creating a folder with a manifest and hook functions, **so that** I don't need to modify core pipeline files.

**Acceptance Criteria:**
- [ ] Given a valid capability folder in `src/capabilities/`, when the app starts, then the registry discovers and loads it
- [ ] Given a capability with `enrichContext`, when a matching intent fires, then the capability's context is injected into the LLM call
- [ ] Given a capability with `promptFragment`, when the system prompt is built, then the fragment is appended

### Story 2 — User enables/disables a capability
**As a** user, **I want** to enable or disable capabilities (e.g., "turn off travel time"), **so that** I control what the assistant does without needing technical knowledge.

**Acceptance Criteria:**
- [ ] Given a disabled capability, when assembler runs, then the capability's hooks are skipped
- [ ] Given a user saying "disable travel time", when processed, then the capability is toggled off in settings

### Story 3 — Travel-time capability (first plugin)
**As a** user, **I want** the assistant to know how long it takes to travel between events, **so that** it warns me about scheduling conflicts and adds buffer time.

**Acceptance Criteria:**
- [ ] Given two consecutive calendar events at different locations, when building context, then travel time estimate is included
- [ ] Given back-to-back events with insufficient travel buffer, when LLM returns a plan, then a warning is surfaced

---

## Workflow

```
App starts
    |
Registry scans src/capabilities/*/manifest.json
    |
For each enabled capability: load hooks, register data files
    |
Per user turn:
    |
    Router -> Assembler -> [enrichContext hooks] -> LLM (with prompt fragments) -> [validatePlan hooks] -> Executor -> [postExecute hooks]
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Capability throws an error in enrichContext | Log warning, skip that capability, continue pipeline |
| Two capabilities inject conflicting context keys | Registry validates key uniqueness at load time |
| Capability data file is missing/corrupt | Init with default value from manifest, log warning |
| User disables a capability that has pending data | Data files preserved, hooks simply not called |
| Capability prompt fragment exceeds token budget | Registry enforces max fragment size (e.g., 200 tokens) |

---

## Success Metrics

- New capability can be added with 0 changes to core pipeline files (assembler, executor, llm, router)
- Travel-time capability works end-to-end as the first proof-of-concept
- Capability toggle works via user chat command

---

## Out of Scope

- Self-generating capabilities from user feedback (future FEAT — requires pattern detection + curated registry)
- Capabilities that add new LLM tools (all capabilities work within the existing `submit_action_plan` tool)
- Multi-LLM-call capabilities (violates single-call architecture rule)
- Third-party / community capability marketplace

---

## Architecture Notes

### Capability Interface

```typescript
interface Capability {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;

  // Pipeline hooks (all optional)
  enrichContext?(intent: IntentResult, state: AppState, ctx: Record<string, unknown>): void | Promise<void>;
  promptFragment?(): string;
  validatePlan?(plan: ActionPlan, state: AppState): string[];  // returns warnings
  postExecute?(plan: ActionPlan, state: AppState): Promise<void>;

  // Data files owned by this capability
  dataFiles?: { key: string; filename: string; defaultValue: any }[];
}
```

### Folder Structure

```
src/capabilities/
  registry.ts              # Discovery, loading, hook orchestration
  types.ts                 # Capability, CapabilityManifest interfaces
  travel-time/
    manifest.json          # { id, name, hooks, dataFiles, defaultEnabled }
    index.ts               # Implements Capability interface
    travel-cache.json      # Own data (estimated travel times cache)
```

### Core Integration Points (4 hooks)

| File | Change | Hook |
|------|--------|------|
| `src/modules/assembler.ts` | After building ctx, call `registry.runEnrichContext(intent, state, ctx)` | enrichContext |
| `src/modules/llm.ts` | Append `registry.getPromptFragments()` to system prompt | promptFragment |
| `src/modules/executor.ts` | After `applyWrites`, call `registry.runValidatePlan(plan, state)` then `registry.runPostExecute(plan, state)` | validatePlan, postExecute |
| `src/modules/loader.ts` | Load capability data files alongside core files | data loading |

### Settings Storage

Capability enabled/disabled state stored in `data/capability_settings.json`:

```json
{
  "travel-time": { "enabled": true, "enabledAt": "2026-04-04" },
  "weather": { "enabled": false }
}
```

---

## Implementation Notes

| File | Change |
|------|--------|
| `src/capabilities/types.ts` | New — Capability interface, CapabilityManifest |
| `src/capabilities/registry.ts` | New — discover, load, orchestrate hooks |
| `src/capabilities/travel-time/` | New — first capability implementation |
| `src/modules/assembler.ts` | Add ~5 lines: call enrichContext hooks after ctx is built |
| `src/modules/llm.ts` | Add ~3 lines: append prompt fragments to system prompt |
| `src/modules/executor.ts` | Add ~8 lines: call validatePlan + postExecute hooks |
| `src/modules/loader.ts` | Add capability data file loading |
| `src/types/index.ts` | Add capability_settings to AppState and FileKey |

**Estimated core pipeline changes: ~20 lines across 4 files.**

---

## Testing Notes

- [ ] Unit tests for registry discovery (finds capabilities, skips invalid ones)
- [ ] Unit tests for hook orchestration (calls in order, skips disabled, handles errors)
- [ ] Unit tests for travel-time enrichContext (injects travel data into context)
- [ ] Integration test: full pipeline with travel-time capability enabled
- [ ] Integration test: capability disabled mid-session, hooks stop firing

---

## Open Questions

- Should capabilities declare which intents they care about (e.g., travel-time only for calendar_create, calendar_query, full_planning) or run on all intents?
- How to handle capability-specific user commands ("disable travel time") — new intent type or handled within feedback intent?
- Should capabilities be able to declare dependencies on other capabilities?
- For travel-time specifically: use a local heuristic (distance/speed estimate) or require a Maps API key?
