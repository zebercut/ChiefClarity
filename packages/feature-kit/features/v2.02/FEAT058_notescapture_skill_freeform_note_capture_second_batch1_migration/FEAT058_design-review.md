# FEAT058 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT058_notescapture_skill_freeform_note_capture_second_batch1_migration.md`
**Refs:** `docs/v4/02_skill_registry.md`, `src/skills/task_management/` (FEAT057 template), `src/types/index.ts:216-237` (Note type)

---

## 1. Verdict

**APPROVED for implementation** subject to §6 conditions.

This is a **template-validation FEAT** more than a feature. The bulk of the
work is reusing FEAT057's pattern for a second skill. If the pattern holds
clean (no resolver changes, no chat.tsx changes, handler structure mirrors
task_management), we promote the pattern to AGENTS.md as the canonical
skill-migration template. If anything breaks, we catch it now before
batch 1 expands further.

---

## 2. One-screen architecture

```
                 User: "save this idea: hire a security consultant"
                                    │
                                    ▼
   chat.tsx → runTriage → shouldTryV4 → routeToSkill
                                    │
                  (notes_capture top-1 via embedding match on noun-prefixed triggers)
                                    │
                                    ▼
   dispatchSkill (notes_capture in v4-enabled set)
        ├── resolveContext → 4 keys (already supported, FEAT057 added them)
        ├── llm.messages.create({ system: prompt.md, tools: [submit_note_capture] })
        ├── tool_use: submit_note_capture({ reply, writes: [{ action: "add", data: { text } }] })
        ├── handler: fills Note defaults, applyWrites(plan, state)
        └── returns SkillDispatchResult { skillId, userMessage }
                                    │
                                    ▼
   chat.tsx → flush(state) → setMessages([{ content, v4Meta: {...} }])
                                    │
                                    ▼
                   User sees: "Saved: hire a security consultant" + via notes_capture badge
```

**Zero changes** to chat.tsx, dispatcher, type definitions. Pure
addition: one new skill folder + one boot-wiring line.

---

## 3. Alternatives considered

### 3.1 Verbatim text vs. LLM cleanup (Q3)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Verbatim** (CHOSEN) | Respects user intent; simpler; deterministic | LLM might fix obvious typos that the user wanted preserved (rare in practice) | **CHOSEN** |
| Light LLM cleanup (capitalization, punctuation) | Marginal quality win | Inconsistent — sometimes the user wants exact wording (quotes, URLs) | Reject |
| LLM extracts title + body | Richer note structure | Premature; current Note type has only `text` field | Reject |

### 3.2 Trigger phrase choice (Q2)

PM proposed noun-prefixed. Alternatives considered:
- Verb-only ("remember this", "save this") → too close to general_assistant's "tell me about" patterns
- Title-extraction ("note about X: Y") → forces structure on a free-form intent
- Slash-command-only (`/note`) → loses NL routing entirely

Noun-prefixed (`note that`, `idea:`, `remember this idea`) gives clear
embedding distance from general_assistant. Confirmed.

### 3.3 Single tool with array writes (Q4)

Same as FEAT057. Single tool `submit_note_capture` with `writes[]`.
Standardizing this as the migration template — codify in AGENTS.md
after FEAT058 ships clean (Story 5).

---

## 4. Cross-feature concerns

### 4.1 Hard upstream dependencies (all Done)

- FEAT054 SkillRegistryAPI
- FEAT051 routeToSkill
- FEAT055 dispatchSkill (with FEAT057's items pass-through)
- FEAT056 chat.tsx wiring
- FEAT057 dispatcher resolver extensions + flush call

### 4.2 Hard downstream consumers

- FEAT059+ (calendar, inbox_triage, emotional_checkin migrations) —
  reuse the same pattern. If FEAT058 needs any pattern changes, they
  cascade.
- FEAT083 Topics skill — overlaps with `topic_note` (note-pinned-to-topic).
  `topic_note` is excluded from FEAT058's scope and lives entirely in
  FEAT083.

### 4.3 Coexistence with legacy

The legacy "save this idea" path goes through `general` intent (Haiku
fallback) which sometimes creates a note, sometimes doesn't. After
FEAT058:
- Phrase routes to `notes_capture` → consistent note creation
- `setV4SkillsEnabled([])` → reverts to legacy `general` (inconsistent
  but unchanged from today)

No legacy intent removal needed because there's no `note_capture`
intent to remove.

---

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM ignores "verbatim" rule and paraphrases | Medium | Low | Regression fixture asserts exact captured text; prompt patch if drift observed |
| Trigger phrase overlap routes notes to general_assistant | Medium | Low | Confidence gate + Haiku tiebreaker resolves; if user reports misrouting, tighten trigger phrases (1-line manifest update) |
| Defensive Note defaults drift from `Note` interface | Low | Medium | Unit test asserts the Note shape produced by handler is structurally complete |
| Migration template breaks at second instance (Story 5) | Low | High | This is exactly what FEAT058 tests. If the pattern doesn't generalize, surface in stage 5/6 and document the divergence in AGENTS.md |
| Notes are inadvertently created instead of tasks | Low | Medium | Skill prompt explicitly says "do NOT create tasks; tell user to use task handler" if intent is ambiguous |

---

## 6. Conditions before code-review approval

1. All ACs from spec testable + tested in stage 7.
2. Skill loads via FEAT054 (smoke check).
3. Handler structure matches FEAT057 (single tool + array writes + lazy
   executor import + try/catch).
4. **Defensive Note defaults** fill all 8 required Note fields (or note
   the missing ones — `id` and `createdAt` are executor's job).
5. Boot wiring appends `"notes_capture"`.
6. **Zero changes to chat.tsx** (FEAT057 already wired what's needed).
7. **Zero changes to dispatcher resolver** (FEAT057 already added the 4
   keys this skill needs).
8. **Zero new types** in `src/types/`.
9. Bundle gate (`npm run build:web`) passes.
10. 5/5 regression fixture passes.

If condition 6 or 7 is violated (i.e., FEAT058 needs a chat.tsx or
dispatcher change), pause and re-evaluate the template — Story 5 calls
for surfacing such gaps explicitly.

---

## 7. UX review

UX is identical to task_management. Reply is short, badge appears.
Existing notes tab renders the new note. No layout changes.

---

## 8. Test strategy review

5-phrase fixture is enough — the architecture is now well-trodden after
FEAT057's 23 tests + 10-phrase regression. Adding a sixth would test
the same code paths twice.

Real-LLM smoke is recommended post-merge but optional (same as FEAT057).

---

## 9. Pattern Learning

If FEAT058 ships clean (no surprise changes to chat.tsx / dispatcher /
types), promote the migration template to AGENTS.md as the canonical
v4 skill-migration recipe. Three skills in (priority_planning,
task_management, notes_capture) means the template is proven across
3 different domain shapes (reasoning, CRUD, free-form capture).

---

## 10. Sign-off

Architect approves. Conditions §6 binding. Coder may proceed.
