# FEAT059 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT059_Migrate_calendarmanagement_intents_...md`
**Refs:** FEAT057 (template), FEAT058 (template generalized), `src/modules/assembler.ts:54-61, 329` (current calendar context + `getActiveEvents`), `src/constants/prompts.ts:179` (recurring guard)

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions. Third
template-application (after FEAT057, FEAT058). Two scope additions
beyond a pure copy-paste: (a) export `getActiveEvents` and add three
resolver branches (`calendarEvents`, `calendarToday`,
`calendarNextSevenDays`); (b) preserve the recurring-event safety rule
verbatim. Both small.

---

## 2. Architecture (one screen)

```
User: "schedule a meeting with Contact A on Friday at 3pm"
  ↓
shouldTryV4 (Node) → routeToSkill → calendar_management top-1
  ↓
dispatchSkill
  ├── resolver: 6 keys (5 existing + calendarEvents new)
  ├── llm: prompt.md (includes recurring guard verbatim) + submit_calendar_action tool
  ├── handler: defensive CalendarEvent defaults → applyWrites
  └── return → chat: flush + render with badge

If "schedule every Friday":
  prompt redirects → handler emits 0 writes + needsClarification=true
  → user redirected to recurring-task handler (FEAT-future)
```

---

## 3. Alternatives considered

### 3.1 Resolver: one branch (`calendarEvents`) vs three (`calendarEvents`, `calendarToday`, `calendarNextSevenDays`)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| One branch + LLM filters | Simpler resolver | Wastes tokens; LLM gets full event list and has to derive today/7-day windows itself; doesn't fix priority_planning's latent bug | Reject |
| **Three branches (CHOSEN)** | priority_planning latent bug fixed for free; calendar_management's prompt sees pre-filtered context | One extra branch | **CHOSEN** |

### 3.2 FEAT040 admission control fold-in vs deferral

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Fold FEAT040 into FEAT059 | Single PR delivers complete calendar story | Doubles scope; admission control involves objective-impact + OKR-slip analysis (its own design space) | Reject |
| **Defer FEAT040 to follow-on (CHOSEN)** | FEAT059 ships clean parity migration; admission control gets focused review later | Calendar v4 = today's `calendar_create` minus admission control until FEAT040 ships | **CHOSEN** — matches FEAT057-cleanup pattern |

### 3.3 Recurring redirect: redirect vs allow

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Skill silently rejects recurring fields | Strict | Lossy — user gets no useful response | Reject |
| **Skill prompt redirects (CHOSEN)** | User gets actionable redirect | Still no recurring task created — that's the recurring handler's job | **CHOSEN** |
| Skill creates a stub RecurringTask cross-skill | "Helpful" | Cross-skill calls violate ADR-001 | Reject |

---

## 4. Cross-feature concerns

**Upstream:** FEAT054/051/055/056/057/058 — all Done. Template proven 3×.

**Downstream:**
- **FEAT040** (admission control) folds into the calendar skill prompt
  + handler later. Will append admission-analysis to the existing
  prompt and add a `check_admission` tool call to the skill.
- **Recurring task migration** (future FEAT) — calendar's redirect
  language references it. When recurring skill ships, the redirect
  text stays intact; user follows the redirect cleanly.
- **FEAT083 Topics** — unchanged.

**Latent bug fix as side effect:** priority_planning's
`calendarToday` / `calendarNextSevenDays` declarations have been
silently returning `undefined` from the resolver since FEAT055.
Fixing the resolver in this FEAT closes that gap retroactively.
priority_planning will start receiving real calendar context after
this ships — verify with a smoke test that priority_planning's output
quality doesn't change unexpectedly.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Recurring rule drops from prompt during copy | Low | High | Stage 7 fixture asserts no `recurring`/`recurrence` fields in writes from recurring-attempt phrase |
| priority_planning output quality changes after latent bug fix | Medium | Low | The skill *gains* context it expected — should improve, not regress. Document in test results. |
| Default duration (60min) overrides LLM intent | Low | Low | Handler only fills if `durationMinutes` is undefined/0; explicit values pass through |
| `getActiveEvents` filter semantics differ from skill expectations | Low | Medium | Resolver tests assert exact shape per fixture state |
| FEAT040 expectation creep — "admission control should ship together" | Medium | Low | Spec is explicit about deferral; PR description reiterates |

---

## 6. Conditions

1. All ACs testable + tested in stage 7.
2. **`getActiveEvents` exported** from assembler.ts (visibility-only).
3. Three new resolver branches added; tests assert each.
4. Skill folder follows canonical migration template (single tool +
   array writes + lazy import + try/catch + defensive defaults).
5. Recurring guard from `SYSTEM_PROMPT:179` preserved verbatim in
   `calendar_management/prompt.md`.
6. Recurring-attempt test fixture asserts handler emits no
   recurring-field writes.
7. Boot wiring appends `"calendar_management"`.
8. **Zero changes** to chat.tsx, types/index.ts, types/orchestrator.ts.
9. Bundle gate (`npm run build:web`) passes.
10. 7-phrase regression: ≥6/7 strict.

---

## 7. UX

Same as task_management / notes_capture. Zero layout changes.

---

## 8. Test strategy

7-phrase fixture covers create / update / query, with one explicit
recurring-attempt test alongside. Tests use stub LLM with canned
responses. Real-LLM smoke recommended post-merge but optional.

---

## 9. Pattern Learning

If FEAT059 ships with the planned scope (3 resolver branches + 1
exported helper + skill folder + boot line), the migration template
is unambiguously canonical. After this FEAT:
- 4 skills migrated in v2.02 (chat wiring, task_management,
  notes_capture, calendar_management)
- Pattern proven across reasoning, multi-op CRUD, free-form capture,
  time-based CRUD with safety rules
- AGENTS.md template entry stable

Subsequent migrations (inbox_triage, emotional_checkin) should be
near-mechanical. If they aren't, it'll signal something legitimately
different about those intents that warrants a template update.

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.
