# Code Review: FEAT051 — Skill Router (Orchestrator)

**Reviewer:** Code Reviewer agent (project rule: reviewer fixes directly per `feedback_adlc_workflow` memory)
**Date:** 2026-04-27
**Spec:** `FEAT051_Skill_Router_and_Composer.md`
**Design Review:** `FEAT051_design-review.md`
**Files reviewed:**
- `src/types/orchestrator.ts` (new, ~50 lines)
- `src/modules/router.ts` (extended — new orchestrator added alongside legacy `classifyIntent`)

---

## Overall Status

**APPROVED WITH COMMENTS** — 4 issues found, all fixed by reviewer in this pass. 1 advisory note for follow-up.

---

## Correctness

### Spec ACs verified

| Story | AC | Status | Where |
|---|---|---|---|
| 1.1 | Skill with matching triggerPhrases gets routed | ✅ | Step 2-3 (embedding + gate) |
| 1.2 | Clear match → no Haiku tiebreaker | ✅ | Step 3 short-circuits |
| 1.3 | Ambiguous → Haiku tiebreaker invoked once | ✅ | Step 4 |
| 1.4 | New skill folder routable on next boot | ✅ | Registry is loaded on demand; new skills appear automatically |
| 1.5 | Empty registry → fallback | ✅ | `makeFallback(registry, [], "registry empty")` |
| 2.1 | `/plan` → routes to skill, no embedding/LLM | ✅ | Step 1 short-circuits before embedding |
| 2.2 | Direct `skillId` from button → routes there | ✅ | Step 0 short-circuits |
| 2.3 | Duplicate structural triggers blocked | ✅ | Delegated to FEAT054 loader |
| 3.1 | `general_assistant` exists + weak match → fallback | ✅ | `makeFallback` returns it |
| 3.2 | `general_assistant` missing → degrades with warning | ✅ | `makeFallback` else-branch logs warn + returns top-1 |
| 3.3 | Fallback threshold configurable | ✅ | `FALLBACK_THRESHOLD` constant exported |
| 4.1 | Legacy ">30 items, ask scope" rule removed | ⚠️ Not present in new orchestrator code; legacy `classifyIntent` still has triage logic — that lives in `triage.ts` and migrates to skills as part of FEAT080 (per spec Q6). FEAT051 itself doesn't touch it. |
| 4.2 | Skills handle their own clarification | ✅ | Orchestrator has no clarification fields in `RouteResult` |
| 4.3 | Router output has no clarification fields | ✅ | `RouteResult` confirmed — only routing data |
| 5.1 | `skillId` in reply metadata | ⚠️ Out of scope for FEAT051 — consumer (chat.tsx) wires this. FEAT051 returns the data; consumer renders it. Per design review §6 condition 7. |
| 5.2 | Structured log per routing decision | ✅ Fixed in this review (added `logRoutingDecision`) |
| 5.3 | Tap badge → popover + log | ⚠️ Consumer concern, same as 5.1 |
| 6.1 | Circuit-open → top-1 without tiebreaker | ✅ Step 4 checks `isCircuitOpen()` |
| 6.2 | Bad `skillId` from orchestrator → dispatcher catches | ✅ Spec acknowledges this is dispatcher's job, not router's |
| 6.3 | Disable flag → legacy routing | ✅ `setV4SkillsEnabled([])` + consumer-side gating per design review §4.4 |

### Design Review §6 conditions verified

| # | Condition | Status |
|---|---|---|
| 1 | All ACs testable + tested | ⚠️ Code is testable; tests come stage 7 |
| 2 | `RouteResult` and `RouteInput` exported from `src/types/orchestrator.ts` | ✅ |
| 3 | Router never throws — all external deps wrapped | ✅ try/catch around embedder + LLM call; degraded paths for every external |
| 4 | No `process.env` reads added | ✅ `grep process.env src/modules/router.ts src/types/orchestrator.ts` returns 0 new matches |
| 5 | TODO at setter for FEAT035 migration | ✅ |
| 6 | Threshold constants exported for tests | ✅ `HIGH_THRESHOLD`, `GAP_THRESHOLD`, `FALLBACK_THRESHOLD`, `FALLBACK_SKILL_ID` all exported |
| 7 | One migration per PR scope | ✅ Files: `src/types/orchestrator.ts`, `src/modules/router.ts`. `app/(tabs)/chat.tsx` deliberately not touched per design review |
| 8 | Capacitor smoke test for phrase embedder | ⚠️ Not run in this environment — same constraint as FEAT054 §6.7. Must be verified with `npx cap sync` before merge |

### Type check

`npx tsc --noEmit` → only the pre-existing `executor.ts:229` error. No new errors.

---

## Bugs (FIXED in this review)

### B1 — Dead `getRegistrySync` helper

**Was:** A typing workaround `getRegistrySync(_r: SkillRegistry): SkillRegistry { return _r; }` left over from development. `makeFallback` referred to it via `ReturnType<typeof getRegistrySync>` instead of the simpler `SkillRegistry` type.

**Fix:** removed the dead helper, simplified `makeFallback` parameter type to `SkillRegistry` directly.

### B2 — `directSkillId` not validated against the registry

**Was:** Step 0 returned `routingMethod: "direct"` for any caller-provided `directSkillId`, even if no such skill existed. The dispatcher would then fail on an unknown id.

**Fix:** added registry lookup. If `directSkillId` is missing, log a warning and fall through to NL routing instead of returning a bad result. The router never throws but also doesn't propagate definitely-broken data.

### B3 — No structured log per routing decision (Story 5 AC 2)

**Was:** Only `console.warn` calls existed for fallback / degraded paths. Successful routings produced no log line. Story 5 AC 2 requires every routing decision to be logged.

**Fix:** added `logRoutingDecision(phrase, result)` wrapper, called from `routeToSkill` after every internal result. Phrase is hashed (sha256, first 16 hex chars) so logs don't carry plaintext user input. Hash format matches what FEAT056 audit_log will use in Phase 3.

### B4 — Shared LLM client reuse not documented

**Was:** `haikuTiebreaker` uses the module-level `client` set by the legacy `setRouterClient()`. No comment indicated this intentional sharing — future readers might think the new orchestrator needed its own client.

**Fix:** added a comment at the tiebreaker entry point explaining the legacy + v4 client sharing.

---

## Security

| Check | Status |
|---|---|
| No secrets / credentials in code | ✅ |
| No `process.env` reads | ✅ |
| Phrase hashed before logging | ✅ Fixed (B3) |
| Tool input from LLM validated against allowlist | ✅ `pick_skill` tool's input_schema uses `enum: allowedIds`; runtime double-check `allowedIds.includes(picked)` |
| LLM tool-use response handles non-tool blocks defensively | ✅ Loop checks `block.type === "tool_use"` |

No security issues.

---

## Performance

| Check | Status |
|---|---|
| Structural-trigger check before embedding (zero cost when matched) | ✅ Step 1 short-circuits before Step 2 |
| Single embedding per phrase | ✅ One `embed()` call per `routeToSkill` |
| Tiebreaker only fires when gate fails (not on every call) | ✅ Step 4 gated by Step 3 outcome |
| LLM call short-circuited when circuit open | ✅ Step 4 checks `isCircuitOpen()` first |
| Targets: <50ms clear, <300ms tiebreaker | ⚠️ Tester to verify in stage 7. Embedding step is the hot path. |

No performance issues blocking approval.

---

## Architecture Compliance

| Rule (per `AGENTS.md`) | Status |
|---|---|
| One LLM reasoning call per phrase (ADR-001) | ✅ Tiebreaker is a small classifier (Haiku ~80 tokens, not reasoning); main reasoning happens in the chosen skill, not here |
| No on-the-fly skill composition | ✅ Composer code does not exist |
| Privacy filter upstream | N/A for orchestrator |
| Embedding-based routing, no NL regex (ADR-003) | ✅ Regex only used for `phrase.split(/\s+/)[0]` to extract slash command — not for NL classification |
| One migration per PR | ✅ Two source files + one new type file |
| No `process.env` reads outside settings.ts | ✅ |
| Skill handlers no work at module load | N/A |
| Per-boot caches rebuild from scratch | N/A — orchestrator has no caches |
| Surface routes validated | N/A |
| Pluggable contributor uniqueness collisions | N/A — delegated to FEAT054 |

No architecture violations.

---

## Code Quality

### Acceptable per existing project conventions
- `console.log` / `console.warn` for routing-decision log + warning paths matches existing modules.
- `catch (err: any)` matches existing pattern.
- `lazy require("crypto")` for the hash helper — slightly unusual; preferred over a module-top import only because `crypto` isn't otherwise used in this file. The skillRegistry.ts uses `import * as crypto`. Consistency choice — I chose lazy here because the function is called from a single hot-path log write; eager import is fine too. Acceptable; not changing.

### Naming
- New constants are SCREAMING_SNAKE per project convention.
- `_resetOrchestratorForTests` follows the underscore-internal-export convention from `_resetSkillRegistryForTests`.
- `routeToSkill` matches v4 vocabulary in the docs (Orchestrator → routes to skill).

### Function size
- `routeToSkillInternal` is ~60 lines orchestrating 6 steps. Could be split per step but the linear flow reads better than 6 helper functions. Acceptable.
- `haikuTiebreaker` is ~50 lines including prompt construction. Acceptable.

### Documentation
- File-section comment block explains the FEAT051 split from legacy code, points at the algorithm spec.
- Each public function has JSDoc.
- TODO(FEAT035) comment at the setter per design review §6 condition 5.
- Inline comment at the shared-client reuse per fix B4.

---

## Testability

| Check | Status |
|---|---|
| Pure functions for business logic | ✅ Threshold gate is pure given top-1/gap; `sha256First16` is pure |
| Dependencies injectable | ⚠️ Tiebreaker uses module-level `client`. Tests can call `setRouterClient(mockClient)` to inject. Not perfect DI but matches the existing pattern in this file. |
| No logic at module level | ✅ Only constant + state declarations |
| Explicit return types | ✅ All public functions typed |
| Errors typed | ⚠️ Plain `Error` with descriptive messages; same pattern as skillRegistry.ts. Acceptable. |
| Test reset hook exported | ✅ `_resetOrchestratorForTests` |

No testability issues blocking approval.

---

## Required Changes

**None remaining.** All required changes were applied in this review pass:
- B1: dead `getRegistrySync` removed
- B2: `directSkillId` validated; falls through if missing
- B3: structured routing decision log added with hashed phrase
- B4: shared-client reuse documented inline

---

## Optional Suggestions (advisory)

1. **`sha256First16` could move to a `src/utils/hash.ts`** if FEAT056 audit_log needs the same helper in Phase 3. Not blocking — keep here for now and refactor when the second consumer appears.

---

## Pattern Learning — additions to AGENTS.md

One new pattern from this review (will be added to AGENTS.md):

- **Routing/orchestration code must log every decision with a structured entry that includes a hashed (not plaintext) form of the user phrase.** The hash format must match the audit log convention so log entries can be cross-referenced with audit rows once FEAT056 ships.

---

## Sign-off

Code review **APPROVED WITH COMMENTS**. Tester (stage 7) may proceed.

**Status update:** FEAT051 → `Code Reviewed`.

**Outstanding for the user / project:**
- Capacitor smoke test for phrase embedder on `npx cap sync` build
- Architectural decisions for FEAT080 batch: which legacy `triage.ts` clarification rules become which skill-side rules
