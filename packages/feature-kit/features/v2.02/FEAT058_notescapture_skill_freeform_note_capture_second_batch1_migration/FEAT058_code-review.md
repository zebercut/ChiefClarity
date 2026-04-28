# Code Review: FEAT058 — notes_capture skill

**Reviewer:** Code Reviewer agent
**Date:** 2026-04-27
**Spec:** `FEAT058_notescapture_skill_freeform_note_capture_second_batch1_migration.md`
**Design Review:** `FEAT058_design-review.md`
**Files reviewed:**
- `src/skills/notes_capture/{manifest.json, prompt.md, context.ts, handlers.ts}` — new skill (~110 lines total)
- `app/_layout.tsx` — boot wiring (1 line)

---

## Overall Status

**APPROVED** — 0 blocking issues, 0 fixes needed.

The FEAT057 migration template generalized cleanly. **Story 5 (template validation) succeeds.** Zero changes to dispatcher, types, chat.tsx, or any shared infrastructure. Pure addition: one skill folder + boot wiring. This is the cleanest skill migration so far.

Smoke test (`scripts/scratch/feat058_smoke.ts`): all 4 skills load correctly via the production registry; manifests, tools, and handlers all match spec.

---

## Correctness

### Spec ACs verified

| Story | AC | Status |
|---|---|---|
| 1.1 (note created with correct shape) | ✅ Tests verify Note shape with all 8 required fields populated |
| 1.2 (chat reply with badge) | ✅ FEAT056 mechanism unchanged |
| 1.3 (legacy reverts when disabled) | ✅ FEAT056 mechanism unchanged |
| 2.1 (explicit note phrases route to notes_capture) | ✅ Trigger phrases noun-prefixed |
| 2.2 (task phrases still route to task_management) | ✅ FEAT057 regression suite still 23/23 |
| 2.3 (ambiguous → router decides) | ✅ Confidence gate handles per FEAT051 |
| 3.1 (delegates to applyWrites) | ✅ Same lazy-import pattern as task_management |
| 3.2 (topic auto-tag preserved) | ✅ Server-side via executor — handler doesn't touch topics |
| 3.3 (flush persists writes) | ✅ FEAT057's chat.tsx flush still applies — no new chat.tsx work |
| 4.1 (rollback works) | ✅ FEAT056 enabled-set mechanism |
| 4.2 (full set wins) | ✅ Same |
| 5.1 (folder shape mirrors task_management) | ✅ |
| 5.2 (handler structure mirrors) | ✅ Test asserts handler signature matches pattern |
| 5.3 (no new resolver keys) | ✅ Test asserts context keys are all in SUPPORTED set |
| 5.4 (template gaps documented) | ✅ NO GAPS — design review §1 confirms |
| 6.1 (no regression in 300 tests) | ✅ 315/315 (300 + 15 new) |
| 6.2 (manual smoke on non-notes phrases) | ⏳ User's call after merge |
| 6.3 (build:web exports) | ✅ |

### Design Review §6 conditions

| # | Condition | Status |
|---|---|---|
| 1 | All ACs testable + tested | ✅ |
| 2 | Skill loads via FEAT054 | ✅ Smoke confirmed |
| 3 | Handler structure matches FEAT057 | ✅ |
| 4 | Defensive Note defaults fill all required fields | ✅ Test asserts all 8 fields set |
| 5 | Boot wiring appends `"notes_capture"` | ✅ |
| 6 | **Zero changes to chat.tsx** | ✅ |
| 7 | **Zero changes to dispatcher resolver** | ✅ |
| 8 | **Zero new types** | ✅ |
| 9 | Bundle gate passes | ✅ |
| 10 | 5/5 regression fixture passes | ✅ |

### Type check

`npx tsc --noEmit` → only pre-existing executor.ts:229. No new errors.

---

## Bugs

**None.** The template was proven on FEAT057 and generalized without surprises.

---

## Story 5 — Template validation outcome

This was the most important question for FEAT058: does the FEAT057 migration template generalize?

**Yes.** Confirmed by:

1. **Zero changes to shared infrastructure** — no chat.tsx changes, no dispatcher changes, no type changes. The skill folder is fully self-contained.
2. **Handler shape mirrors task_management** — same five sections (args type, write filter/coerce, ActionPlan build, lazy-import + try/catch, return shape).
3. **Context keys all pre-existing** — notes_capture's context.ts uses 4 keys all already supported by the resolver (added in FEAT057). Test asserts this.
4. **Defensive defaults pattern reusable** — task_management didn't need defaults because its data is heavily LLM-shaped; notes_capture needed them because the Note type has 8 required fields and the LLM is unlikely to populate them all. The `fillNoteDefaults` helper is the FEAT058-specific addition that future skills with similarly strict types should follow.

**Promoting the migration template to AGENTS.md** — added one new rule (CR-FEAT058).

---

## Security

| Check | Status |
|---|---|
| No secrets / credentials | ✅ |
| No `process.env` reads | ✅ |
| Handler validates writes target "notes" file only | ✅ — `file: "notes" as FileKey` hardcoded |
| Empty-text writes filtered out | ✅ — defense against LLM emitting empty notes |
| LLM-supplied data sanitized through executor's existing path | ✅ |

No security issues.

---

## Performance

| Check | Status |
|---|---|
| Single LLM call (ADR-001) | ✅ Haiku, ~2000 token budget |
| No new resolver computation | ✅ Reuses 4 existing keys |
| Bundle size impact | Negligible |

No performance concerns.

---

## Architecture Compliance

All AGENTS.md rules satisfied. No new violations. The migration template
established by FEAT057 is now confirmed as canonical.

---

## Code Quality

- File sizes: all small, focused
- Naming: matches FEAT057 conventions (`submit_note_capture` parallels `submit_task_action`, `submit_priority_ranking`)
- Documentation: handler header explains the verbatim-capture rule + defensive defaults pattern
- `fillNoteDefaults` helper is well-documented for future template-pattern-matchers

---

## Required Changes

**None.**

---

## Optional Suggestions (advisory)

1. **Consider `topic_note` migration in FEAT083 Topics work** — when Topics ships, migrate the topic-pinned-note flow there. Out of scope for FEAT058.
2. **Real-LLM smoke recommended post-merge** — same as FEAT057.

---

## Pattern Learning — addition to AGENTS.md

The migration template is proven across 3 skills (priority_planning, task_management, notes_capture). Adding to AGENTS.md as the canonical recipe:

- **v4 skill migration template (CR-FEAT058):** new skills follow this exact shape — single tool with array `writes` argument; handler builds an `ActionPlan` with defensive defaults for the data type's required fields; lazy-imports `executor.applyWrites` inside try/catch (FEAT057 B1 pattern); returns `{ success, userMessage, items?, clarificationRequired, data }`. Manifest's `dataSchemas.write` matches the file key the handler writes to. Context.ts declares only keys in `SUPPORTED_KEYS` (extend the resolver in `skillDispatcher.ts` if the skill needs more). No chat.tsx changes for new skills — FEAT056 + FEAT057 already wired the consumer paths.

---

## Sign-off

Code review **APPROVED**. Tester proceeded. **Status: FEAT058 → `Code Reviewed → Done`** (single combined pass since no fixes needed).
