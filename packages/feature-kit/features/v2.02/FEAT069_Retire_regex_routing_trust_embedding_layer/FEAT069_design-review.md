# FEAT069 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT069_Retire_regex_routing_trust_embedding_layer.md`
**Refs:** FEAT051 (router algorithm + ladder + threshold magic numbers),
FEAT054 (registry + `descriptionEmbedding`), FEAT064 (bundle-time skill
embeddings + isomorphic loading + byte-equality determinism), FEAT066
(triage_hint as primary signal — Step 1a), FEAT067 (embeddings on web
bundle), FEAT068 (RAG-based info_lookup).
Bug sites: `src/modules/triage.ts::FAST_PATH_MAP` (lines 182-225) +
`tryFastPath` (lines 227-245) + call site (line 256);
`src/modules/router.ts::routeToSkillInternal` Step 1 structural matcher
(lines 421-446) and FEAT066 speculative-disagreement block within Step 1a
(lines 388-410); load-bearing magic number `FALLBACK_THRESHOLD = 0.40`
(`router.ts:232`); 8 skill manifests under `src/skills/*/manifest.json`;
`src/skills/info_lookup/prompt.md` (Story 5).

---

## 1. Verdict

**APPROVED for implementation** subject to §7 conditions (15 binding items).

This is the architectural completion of the FEAT067 + FEAT068 arc. FEAT067
unblocked the embedder on web; FEAT068 wired RAG retrieval through the same
embedder. Both retired the *symptom* of the rule-based routing layers
(unavailable/missing) without retiring the *cause*. FEAT069 retires the
cause: two rule-based pre-filters (triage's regex fast-path and the v4
router's structural first-token compare) that silently stole phrases the
embedding step would have correctly routed.

The load-bearing artifacts are:

1. **The calibration corpus + cliff visualization** (Story 3, condition 4).
   The threshold is set by data, not by guess. The cliff visualization in
   `FEAT069_test-results.md` is the artifact that survives the FEAT.
2. **The binding real-LLM smoke** (Story 6, condition 14). 10 phrases,
   8/10 strict, with phrases 1 ("what is my plan today") and 2 ("what is
   chiefclarity") in the MUST-PASS pool — those are the user-reported
   failures.

The risk profile is moderate. Calibration corpora drift; the corpus we
ship is the v1 best-effort and re-calibration is manual. The general-
knowledge fallback in `info_lookup` invites fabrication if the disclaimer
template is bypassed. Both risks are mitigated by binding conditions, not
left to good intentions.

---

## 2. Architecture (one screen)

### Before (today, three parallel rule-based pre-filters in front of embedding)

```
┌─ chat.tsx ─────────────────────────────────────────────────────────┐
│ const triage = await runTriage(phrase, ...);                       │
│   └─ tryFastPath(phrase) ── REGEX → emits legacyIntent             │ DELETE (Story 1)
│      else Haiku → emits legacyIntent                               │
│ const route = await routeToSkill({ phrase, triageLegacyIntent }); │
└────────────────────────────────────────────────────────────────────┘
                ↓
┌─ router.ts::routeToSkillInternal ──────────────────────────────────┐
│ Step 0   directSkillId               (caller override)             │
│ Step 1a  triage_hint (FEAT066)       (legacyIntent → skill)        │
│   └─ speculative structural-disagreement-warn                      │ DELETE (Story 2)
│ Step 1   STRUCTURAL FIRST-TOKEN MATCH                              │ DELETE (Story 2)
│ Step 2   embedding cosine similarity (top-3)                       │
│ Step 3   confidence gate (HIGH=0.80, GAP=0.15)                     │ RECALIBRATE (Story 3)
│ Step 4   Haiku tiebreaker            (between FALLBACK and HIGH)   │
│ Step 5   fallback → general_assistant (top-1 < FALLBACK=0.40)      │ RECALIBRATE (Story 3)
└────────────────────────────────────────────────────────────────────┘
```

The two user-reported failures fell through the gaps:

- **"what is my plan today?"** — `tryFastPath` regex requires `plan my|plan
  the|plan for`; first token "what" matches no `structuralTrigger`;
  embedding similarity vs. today's lean `priority_planning.description`
  was below 0.40 → fallback to `general_assistant` with a polite refusal.
- **"what is chiefcalrity?"** — typo of "chiefclarity"; `tryFastPath`
  regex requires "what do you know about" / "tell me about" syntax; first
  token "what" matches nothing structural; embedding score for the typo
  variant fell below 0.40 → fallback.

### After (one rule-based shortcut + embedding does the work)

```
┌─ chat.tsx (UNCHANGED) ─────────────────────────────────────────────┐
│ const triage = await runTriage(phrase, ...);                       │
│   └─ Haiku → may emit legacyIntent (no regex fast-path)            │
│ const route = await routeToSkill({ phrase, triageLegacyIntent }); │
└────────────────────────────────────────────────────────────────────┘
                ↓
┌─ router.ts::routeToSkillInternal (NEW LADDER) ─────────────────────┐
│ Step 0   directSkillId               (caller override)             │
│ Step 1a  triage_hint                  (Haiku-fed, FEAT066)         │
│ Step 2   embedding cosine similarity (now the primary NL signal)   │
│ Step 3   confidence gate              (HIGH=<calibrated>)          │
│ Step 4   Haiku tiebreaker             (between FALLBACK and HIGH)  │
│ Step 5   fallback → general_assistant (top-1 < FALLBACK=<cal>)     │
└────────────────────────────────────────────────────────────────────┘
```

**What was removed.**

- Triage's `FAST_PATH_MAP` (8 regex rules) and `tryFastPath` function. Triage
  no longer attempts intent classification via regex. The Haiku call still
  runs and still emits `legacyIntent` — that's the only intent classifier
  in triage now.
- Router Step 1 (structural first-token compare) deleted entirely.
- The FEAT066 speculative structural-match-for-disagreement-warn block
  inside Step 1a — dead branch once Step 1 is gone.

**What was added (substrate, not new layers).**

- 8 enriched manifest descriptions with the natural-language phrasings
  users actually type (Story 4). Shifts the cosine similarity surface.
- Fixed-template general-knowledge disclaimer in `info_lookup`'s prompt
  (Story 5). When retrieval is empty, the model answers from general
  knowledge with the locked disclaimer.
- New `FALLBACK_THRESHOLD` (and possibly `HIGH_THRESHOLD`) values, set by
  calibration corpus data, not by guess.

**Why this is the right shape.** The vector embedding layer is the architectural
answer to "phrasings the rule-author did not anticipate". Two pre-filters
in front of it converted "did the rule-author anticipate this phrasing?"
back into the deciding question. With those pre-filters retired and
descriptions enriched, the embedder gets to do its job. The triage_hint
shortcut (FEAT066) remains for the head-of-distribution cases that triage's
Haiku call does cleanly classify — that's the canonical "use upstream
classification before redoing the work" pattern (FEAT066 §10).

---

## 3. Alternatives considered

### 3.1 Triage's intent classifier replacement

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) **Keep Haiku as the only intent classifier in triage (CHOSEN)** | The legacy v3 chain (which still consumes `legacyIntent` via `MODEL_BY_INTENT`) does not regress. FEAT066 Step 1a continues firing for the head-of-distribution phrases triage does cleanly classify. Cost is unchanged — Haiku call already runs for emotional/source/complexity/clarification. | Couples triage to v3 chain lifetime; FEAT070 still needs to retire that chain before the Haiku-as-intent-classifier role can fully retire. | **CHOSEN** |
| (b) Drop `legacyIntent` emission entirely | Forces FEAT070 sooner; cleaner contract. | Legacy v3 chain breaks immediately for any phrase v4 doesn't handle. Out of scope for this FEAT — would require the FEAT070 audit and v3 retirement *inside* this FEAT. | Reject |
| (c) Embedding-in-triage for intent | Triage maps top-1 skill to `legacyIntent`. | Duplicates router Step 2 — two embedder calls per phrase. Strictly worse than (a). | Reject |

### 3.2 Calibration corpus — committed vs gitignored

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Commit corpus as `tests/fixtures/routing-corpus.json` | Reproducible by anyone with the repo. Survives developer machine swaps. | Risks personal-data drift over time (corpus authors slip in real names). One-Time Scripts Policy explicitly steers calibration scripts to `scripts/scratch/`. | Reject |
| **Gitignored `scripts/scratch/calibrate-routing.ts` (CHOSEN, PM proposal accepted)** | Aligns with One-Time Scripts Policy (`scripts/scratch/` is gitignored). The artifact that *survives* the FEAT is `FEAT069_test-results.md` — the cliff visualization, the chosen threshold, the score-distribution table. The corpus phrases are inlined in the table for reproducibility. | Re-running calibration requires re-creating the script (or recovering from a developer's machine). Re-calibration is rare; this is acceptable. | **CHOSEN** |
| Embed corpus in a unit test fixture | Versioned + survives. | Test-file phrases drift toward "what tests assert" rather than "what users type". Wrong tool. | Reject |

### 3.3 Description enrichment vs threshold-only tuning

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Lower thresholds, keep descriptions lean | Smallest diff; no manifest churn. | Lower thresholds admit more false positives — the cliff between in-distribution and out-of-distribution narrows. The user-reported "what is my plan today" failure was a cosine-similarity floor problem, not a threshold-too-high problem; lowering the floor without raising the signal hurts other phrases. | Reject |
| Enrich descriptions, keep thresholds | Raises the cosine-similarity floor for in-distribution phrases without admitting noise. | Manifest churn (8 files); requires re-running `bundle:skills`. Bounded by the description-enrichment quality bar (architect's 0.05 admission band). | Partial — see below |
| **Both — enrich descriptions, then recalibrate thresholds against the new score distribution (CHOSEN)** | Description enrichment shifts the in-distribution distribution; recalibration sets thresholds against the *new* distribution. The cliff is wider after both. | Largest diff; iteration risk (each description rewrite invalidates the calibration; re-run). Architect time-budgets the iteration to 16h total per Open Q6. | **CHOSEN** |

### 3.4 `info_lookup` general-knowledge fallback — fixed template vs LLM-discretionary

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| LLM-discretionary disclaimer | Natural-language variation; the model picks phrasing that fits the question. | Greppable smoke tests become regex-soup. Users get inconsistent UX — sometimes the disclaimer is up-front, sometimes buried. Risk: the model decides the disclaimer is unnecessary and answers without it. | Reject |
| **Fixed template (CHOSEN, PM proposal accepted)** | Greppable in smoke (`"I don't have personal notes about"` is a literal substring assertion). Consistent UX. Forces the model to commit to "this is general knowledge, not your data" before answering. | Slight prose stiffness on the first sentence. | **CHOSEN** |

Locked phrasing: `"I don't have personal notes about <topic>, but in general:\n\n<general-knowledge answer>"`.
The colon + double newline is a load-bearing visual separator. Smoke
phrase 4 asserts on the literal substring `"I don't have personal notes about"`.

---

## 4. Audit results — verification of PM's 6 technical claims

| # | PM claim | Architect verification | Result |
|---|---|---|---|
| 1 | `tryFastPath` is called only at `runTriage:256` | Grep shows function definition at `triage.ts:227` and the single call site at `triage.ts:256`. No other consumers. | **Correct** |
| 2 | `legacyIntent` is consumed by ~22 files; deletion not safe in this FEAT | Grep returns 20 files including `MODEL_BY_INTENT` (assembler), `v4Gate.ts`, `chat.tsx`, `router.test.ts`, `rag.test.ts`, `triage.ts`, `router.ts`, plus 13+ feature-kit docs. Concur — deletion belongs in FEAT070. | **Correct** (count off by 2 — irrelevant) |
| 3 | `v4Gate.test.ts:94-119` asserts the gate IGNORES legacyIntent | Verified verbatim. Test name: `"triage's legacyIntent is IGNORED — gate trusts the orchestrator instead"`. Asserts `result === true` despite `triageLegacyIntent: "task_create"`. | **Correct** |
| 4 | FEAT066 disagreement-warn at `router.ts:390-410` is dead code after Step 1 deletion | Verified by reading the block. The speculative structural lookup (`firstTok`/`tokenForMatch`/`structuralMatches`) is *byte-identical* logic to the deletion target in Step 1 (`router.ts:421-446`). With Step 1 gone, the speculative lookup is the only place structural matching still appears, but its only purpose is to flag drift between two layers — and one of the two layers no longer exists. Dead branch. | **Correct** (line range 388-410, off by 2) |
| 5 | `descriptionEmbedding` is the only embedded surface (not `triggerPhrases`) | Grep on `skillBundle.ts` returns 8 instances of `descriptionEmbedding`; zero of `triggerPhrasesEmbedding` or any other embedded field. `triggerPhrases` are consumed *only* by the Haiku tiebreaker prompt (`router.ts:608-617`) as plain text. | **Correct** |
| 6 | `info_lookup` already has `retrievalHook.minScoreInclude: 0.40` | Verified at `src/skills/info_lookup/manifest.json:33`. The Story 5 prompt edit interacts with this — when retrieval returns no chunks above 0.40, the prompt now allows the general-knowledge fallback with the locked disclaimer. | **Correct** |

**All 6 PM claims are CORRECT.** No corrections required. Two line-number
references were off by 2 (claims 2 and 4); architect cites the actual line
ranges in §1's bug sites and condition 1.

---

## 5. Cross-feature concerns

- **FEAT042 / FEAT044 / FEAT050 ripple — does anything else read
  `tryFastPath`?** Audit complete: `tryFastPath` is local to `triage.ts`
  (Grep result above). No external consumer. The `TriageResult.fastPath`
  field is read by `chat.tsx:508` (the legacy-assembler shortcut: `if
  (triage.fastPath && triage.legacyIntent)`). With Story 1, that branch
  becomes unreachable — the fast-path field is undefined for every triage
  result. **Coder must update `chat.tsx:508` to remove the `triage.fastPath`
  branch.** That's a single boolean now constantly false; the alternate
  branch (full assembler path) takes over for every phrase the legacy
  chain still handles. No FEAT042/044/050 module reads the field.
- **FEAT066 (triage_hint) stays primary.** Step 1a is unchanged in shape.
  The only edit inside Step 1a is *deletion* of the speculative structural
  lookup that fed the disagreement-warn (lines 388-410). The triage_hint
  short-circuit return remains intact. FEAT066's binding smoke phrases all
  still pass post-FEAT069 (verified by inspection — every FEAT066 smoke
  phrase has a `triageLegacyIntent`, so they hit Step 1a before they could
  hit Step 2).
- **FEAT067 (embeddings on web) becomes the dominant NL signal.** With
  Step 1 gone, every non-triage_hint, non-`directSkillId` phrase reaches
  Step 2's embedder. FEAT067 already proves the embedder loads on web;
  this FEAT relies on that proof. The risk is "embedder cold-start latency
  on the first chat after install" — pre-existing, not new. FEAT067
  documents the cold-start tradeoff.
- **FEAT068 (RAG retrieval) still gated by `info_lookup`'s `retrievalHook`.**
  The Story 5 prompt edit only changes what happens *when retrieval returns
  nothing above `minScoreInclude: 0.40`*. The retrieval pipeline is
  untouched; the manifest's `retrievalHook` config is untouched. The
  fabrication-catcher contract for *non-empty retrieval* (chunks present
  → cite the chunks, never blend in general knowledge) is preserved. Only
  the *empty-retrieval* branch changes from "polite refusal" to "prefixed
  general-knowledge answer".
- **FEAT070 (legacy v3 chain retirement) is unblocked but not advanced
  by this FEAT.** Decision 1 (keep Haiku as triage's only intent
  classifier) keeps `legacyIntent` flowing for the v3 chain. FEAT070's
  scope remains the same: audit every `legacyIntent` consumer, retire
  `MODEL_BY_INTENT`, retire `classifyIntent`/`classifyIntentWithFallback`,
  delete `chat.tsx:486-510` v3 chain plumbing.
- **`okr_update` (un-migrated v3 intent).** Today, triage's regex fast-path
  emits `legacyIntent: "okr_update"`. After FEAT069, the regex is gone —
  triage's Haiku call may or may not emit it depending on the prompt and
  the user's phrasing. Either way, `TRIAGE_INTENT_TO_SKILL` (FEAT066) does
  NOT contain `okr_update`, so Step 1a falls through. The phrase reaches
  Step 2 (embedding) and likely scores below `FALLBACK_THRESHOLD` against
  any v4 skill (no skill claims OKR territory) → falls back to
  `general_assistant`, which today politely says "I can't update OKRs yet".
  No regression; the missing-capability state stays visible.
- **FEAT056 audit-log consumer.** `routingMethod === "structural"` may
  appear in older audit-log rows but no new rows produce it after FEAT069.
  Decision: leave the `"structural"` literal in the `RoutingMethod` union
  (per spec Story 2 AC) — it remains a valid historical value that
  audit-log readers must tolerate. No code reads on that literal except
  log strings.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Calibration corpus too narrow** — 74 phrases may not span the user's real input distribution; the chosen threshold misroutes phrases the corpus didn't represent. | Medium | Medium | Corpus design (§9) covers 8 skills × 6 phrases + 8 generic + 10 knowledge + 5 noise + 3 typo = head-of-distribution, the boundary, and the noise floor. Real drift is caught by the binding smoke (condition 14, 8/10 strict on phrases the corpus didn't generate). If the smoke fails, calibration is wrong; iterate. |
| **Corpus drift over time** — user's vocabulary, app's skills, embedder model evolve. The thresholds picked today become wrong six months from now. | Medium | Medium | The corpus is gitignored — so re-calibration is manual, but the calibration script + corpus are reproducible from `FEAT069_test-results.md`'s phrase listing. A future FEAT (telemetry-driven re-calibration) is the proper fix; out of scope here per spec. **Carry-forward:** add to FEAT backlog. |
| **Threshold misroutes when corpus distribution differs from real usage** — corpus author bias toward formal phrasings; real users type fragments and slang the corpus underrepresents. | Medium | Medium | Two layers of defense. (1) Corpus includes typo variants (`chiefcalrity`, `addd a tassk`) and generic-conversational shorts ("ok", "yes"). (2) The Haiku tiebreaker (Step 4) catches phrases that score in the ambiguous band — that's its design purpose. Coder pays attention to Haiku call rate (Success Metric: ≤ 20% increase over FEAT066 baseline). |
| **General-knowledge fallback in info_lookup invites fabrication** — model answers a personal-life question from general knowledge with a generic disclaimer, missing the user's actual data. | Low | High | The disclaimer is a fixed template. The prompt explicitly distinguishes the two modes: empty retrieval → general-knowledge with disclaimer; non-empty retrieval → cite chunks only, never blend. Smoke phrase 3 ("who is Contact A") tests the disclaimer-present path; smoke phrase 4 ("what is the capital of France") tests the general-knowledge path. The fabrication-catcher contract for non-empty retrieval (FEAT068) is preserved. |
| **Haiku tiebreaker latency on every phrase that doesn't auto-route** — if calibration sets `HIGH_THRESHOLD` low and the score distribution is bimodal-ambiguous, every-second-phrase pays a Haiku call (~200ms + ~$0.0005). | Low | Medium | Success Metric explicitly tracks tiebreaker call rate. Architect's no-raise rule on `HIGH_THRESHOLD` (Decision 5) means the threshold can only move toward "more tiebreaker" if data demands; the calibration script publishes the tiebreaker hit rate as part of the cliff visualization. If hit rate exceeds 20% above FEAT066 baseline, revisit before merge. |
| **Description enrichment regresses a previously-correct route** — rewriting `priority_planning.description` to include "what is my plan today" shifts its embedding such that it now wins for `task_management`-domain phrases. | Medium | Medium | The 0.05 admission band (Decision 6) is the test: every Story-3 corpus phrase tagged for skill X must score top-1 for X *or* within 0.05 of the top-1 winner WITH X in the top-2. Re-run calibration after every description edit. The FEAT064 byte-equality determinism test bounces a half-edited bundle. |
| **`/skillId` slash command UX regresses** — chat.tsx parses slash commands today via the structural matcher. After Story 2 deletion, slash commands may misroute. | Low | High | Architect has not yet verified that chat.tsx sets `directSkillId` for slash commands. **Condition 7 (binding) — coder verifies and either confirms `directSkillId` parsing exists OR adds it BEFORE deleting Step 1.** Smoke phrase set should include `/focus` or `/note` if slash UX is in scope. If not, the spec's "out of scope" position is fine. |
| **The chat.tsx `triage.fastPath` branch becomes unreachable but isn't deleted** — `chat.tsx:508` reads `triage.fastPath`, which Story 1 deletes. Half-deleted state ships. | Low | Low | Condition 6 (binding) — coder updates `chat.tsx:508` to remove the `triage.fastPath` branch as part of Story 1. `tsc --noEmit` catches the missing field; can't ship a broken build. |

---

## 7. Conditions (numbered, BINDING — 15 items)

1. **Triage regex fast-path deletion (Story 1).** Delete from `src/modules/triage.ts`:
   `FAST_PATH_MAP` (lines 182-225), `tryFastPath` function (lines 227-245),
   the `tryFastPath(phrase)` call in `runTriage` (lines 256-260), the
   `fastPath?: boolean` field on `TriageResult` (line 44).
   `runTriage`'s new entry path: circuit-breaker check → Haiku call (or
   `safeDefault` if client missing or breaker open). Triage continues
   emitting `legacyIntent` from the Haiku tool output AND from
   `safeDefault` (existing behavior).
2. **Router structural matcher deletion (Story 2).** Delete from `src/modules/router.ts`:
   the entire Step 1 block (lines 421-446) — the `firstToken` extraction,
   the `tokenForMatch` lowercase+trim, the `allSkills.filter(...)` against
   `structuralTriggers`, and the `if (matches.length === 1) return ...`
   shortcut. Step 0 (`directSkillId`) stays unchanged. Step 1a (FEAT066
   triage_hint) stays in place.
3. **FEAT066 speculative-disagreement-warn deletion (Story 2).** Delete from
   `src/modules/router.ts` Step 1a: the speculative structural lookup
   (lines 388-410, the `firstTok`/`tokenForMatch`/`structuralMatches`
   block and the `if (structuralMatches.length === 1 && ...) console.warn(...)`
   block). The triage_hint return (lines 411-416) remains.
4. **Calibration corpus + script (Story 3).** New `scripts/scratch/calibrate-routing.ts`
   (gitignored). Loads `src/skills/_generated/skillBundle.ts`; for each of
   74 corpus phrases, calls `embed(phrase)`, computes cosine similarity
   against every skill's `descriptionEmbedding`, outputs a Markdown table:
   `phrase | top-1 skill | top-1 score | top-2 skill | top-2 score | gap | expected | match?`,
   sorted by top-1 score descending. Corpus composition: 48 per-skill (6 ×
   8) + 8 generic + 10 knowledge (5 personal-data + 5 general) + 5 noise +
   3 typo = 74 phrases. Inline in script. No real user data — generic
   placeholders only.
5. **Threshold values set from calibration data (Story 3).** The architect
   does NOT prescribe values. Coder runs the calibration script, eyeballs
   the score distribution for the cliff between in-distribution and
   noise, sets `FALLBACK_THRESHOLD` (and optionally `HIGH_THRESHOLD`) to
   the cliff midpoint. The chosen values, the cliff visualization, and
   the corpus phrases that bracket the cliff are documented in
   `FEAT069_test-results.md`. `HIGH_THRESHOLD` may be lowered if data
   demands; not raised. `GAP_THRESHOLD` defaults to no-change.
6. **`chat.tsx` legacy `triage.fastPath` branch deletion.** `app/(tabs)/chat.tsx:508`
   currently reads `if (triage.fastPath && triage.legacyIntent) {…}`.
   After Story 1, `triage.fastPath` is deleted from the type — this
   conditional becomes a `tsc --noEmit` error. Coder removes the branch
   and lets the alternate path (full assembler) handle every phrase the
   legacy chain still serves. No other chat.tsx changes.
7. **Slash command UX preserved.** Coder verifies `chat.tsx`'s slash-
   command parsing. Two cases:
   (a) chat.tsx sets `directSkillId` for `/<skillId>` phrases — Step 0
       handles them; deletion is invisible. **Confirm and document.**
   (b) chat.tsx does NOT set `directSkillId` and relied on Step 1 — coder
       adds the `directSkillId` parsing in `chat.tsx` BEFORE deleting Step 1.
   Either way, smoke phrase set may include a slash command (architect
   leaves to coder discretion; the spec's smoke set does not include one).
8. **Skill description enrichment (Story 4).** Each of 8 manifests under
   `src/skills/*/manifest.json` rewrites/extends the `description` field
   to include 6-12 natural-language phrasings (PM seeds in spec Story 4).
   Each description is one paragraph of natural prose, NOT a regex
   dump. Quality bar (Decision 6): every Story-3 corpus phrase tagged
   for skill X must score top-1 for X *or* be within 0.05 of the top-1
   winner with X in the top-2. After every description edit, run
   `npm run bundle:skills` and re-run the calibration script. Iterate up
   to 16h total time-budget; if a phrase still fails, surface — that's
   a triage_hint candidate or a real cross-skill ambiguity.
9. **Bundle regenerated + determinism preserved.** After Story 4 edits,
   commit the regenerated `src/skills/_generated/skillBundle.ts`. The
   FEAT064 byte-equality determinism test (`skillBundle.test.ts:197-260`)
   must pass on a no-source-change second run.
10. **`info_lookup` graceful general-knowledge fallback (Story 5).** Edit
    `src/skills/info_lookup/prompt.md`. Today's "When retrieval came back
    empty (or weak)" section instructs the model to say "I don't have
    anything specific". After this FEAT: when `retrievedKnowledge` is
    empty OR `retrievalMeta.topScore < 0.40`, the model MAY answer from
    general knowledge **only if** it leads with the locked disclaimer:
    `"I don't have personal notes about <topic>, but in general:\n\n<answer>"`.
    For questions clearly tied to the user's life ("what was that
    meeting about", "who is <Contact placeholder>"), the disclaimer-then-
    no-answer path remains unchanged. The prompt explicitly distinguishes
    the two modes per spec Story 5. The fabrication-catcher contract for
    non-empty retrieval is preserved verbatim.
11. **`TriageResult` type cleanup.** Delete `fastPath?: boolean` (line
    44 of `triage.ts`). Keep `legacyIntent?: IntentType` — still emitted
    by Haiku triage and consumed by FEAT066 + the v3 legacy chain.
12. **`RoutingMethod` enum unchanged.** The literal `"structural"` stays
    in the `RoutingMethod` union for audit-log backward compat (per spec
    Story 2 AC). No new code produces it; old audit-log rows may still
    reference it.
13. **Unit tests updated.** `src/modules/router.test.ts`:
    (a) Delete `Story 2 — Structural triggers` AC 2.1 (`/plan today` → `'structural'`)
        — replace with a `directSkillId` test if slash UX migrated to
        Step 0 per condition 7, or delete entirely.
    (b) Delete `FEAT066: triage hint disagrees with structural → triage
        wins, disagreement-warn fires` (lines ~857-890) — speculative
        block is gone.
    (c) Update `Story 4 — Router output schema` if it asserts on
        `routingMethod !== 'structural'` (it currently doesn't — verify).
    (d) All other tests pass unchanged.
    `triage.test.ts` (if it exists) — any test asserting fast-path is
    replaced with the equivalent Haiku-or-null assertion.
14. **MANDATORY — Real-LLM smoke (BINDING, 8/10 strict).** Tester runs
    `scripts/scratch/smoke-feat069.ts` (gitignored) using the live api-
    proxy. Each of 10 phrases (verbatim from spec Story 6) goes through
    the full ladder. Per phrase, all 5 criteria must hold:
    - `triage.fastPath` is undefined (regex deleted; the field doesn't exist).
    - `routeResult.routingMethod ∈ {"embedding", "haiku", "triage_hint"}` —
      never `"fallback"` or `"structural"`.
    - `routeResult.skillId === expected` per the Story 6 table.
    - `dispatchResult.userMessage` is a non-empty string.
    - For `info_lookup` phrases (#2, #3, #4): retrieval cited chunks OR
      reply contains the literal `"I don't have personal notes about"`.
    Pass threshold: ≥ 8/10 strict. **Phrases #1 ("what is my plan today")
    and #2 ("what is chiefclarity") MUST PASS** — they are not in the
    tolerated 2-of-10 nondeterminism pool. Output captured per phrase
    in `FEAT069_test-results.md` with triage log line, router log line
    (`method=...`), dispatcher tool name, pass/fail flag.
15. **Docs updated.** `docs/new_architecture_typescript.md`:
    Section 6 (Module Responsibilities — triage no longer classifies
    intent via regex; router has 4-step ladder, not 5);
    Section 9 (ADR — regex/structural retirement, calibrated thresholds);
    Section 12 (Feature Catalog — FEAT069 entry).
    `FEAT069_test-results.md` — cliff visualization, chosen thresholds,
    smoke output, BEFORE/AFTER cost comparison (Story 7).
    No README.md change expected (this is internal architecture).

---

## 8. UX

**Zero blocking changes** to surfaces, copy, prompts, or buttons.

**User-visible delta after this FEAT lands:**

- Natural-language phrases that previously hit polite refusals now route
  correctly. The two user-reported examples ("what is my plan today",
  "what is chiefcalrity") work without the user having to hunt for the
  rule-author's preferred syntax.
- General-knowledge questions in `info_lookup` no longer dead-end. "What
  is the capital of France" returns a useful answer with a clear "I don't
  have personal notes about this, but in general:" disclaimer — the user
  knows this is general knowledge, not their data.
- Typos in personal-data lookups still resolve (the embedder is robust to
  single-character typos). "what is chiefcalrity" finds the same path
  "what is chiefclarity" would have.

The user's mental model — "I type a question; the assistant answers" —
no longer requires the user to internalize the regex grammar of the
fast-path layer. That is the whole point of the embedder; this FEAT lets
it do its job.

---

## 9. Test strategy

### 9.1 Unit tests covering the new ladder

Per condition 13. The new ladder is `directSkillId → triage_hint →
embedding → tiebreaker → fallback`. The existing `router.test.ts`
already covers Steps 0, 1a (FEAT066), 2, 3, 4, 5; deleting Step 1 only
removes tests, doesn't add gaps. Verify by reading the post-deletion
test file: every step in the new ladder has at least one test.

### 9.2 Calibration script + corpus

`scripts/scratch/calibrate-routing.ts` per condition 4. Inlined corpus
of 74 phrases. Output is a Markdown score table sorted by top-1 desc;
the cliff is visible by eye. The architect's corpus design philosophy:

- **Per-skill canonical (6 × 8 = 48).** Tests the embedder's ability to
  surface the correct skill on phrases the user actually types. Mixes
  formal English ("schedule a meeting tomorrow at 3pm") with shorter
  fragments ("rough day", "ok") and slash-prefix-free verb forms ("add
  a task").
- **Generic conversational (8).** Tests `general_assistant`'s magnetism
  for chitchat. If a chitchat phrase scores top-1 for a specialized skill,
  that's a sign the specialized skill's description over-claims.
- **Knowledge questions (10, half/half).** Tests that `info_lookup` is
  the embedding-magnet for both personal-data lookups ("tell me about
  Project Alpha") AND general-knowledge questions ("what is React").
  Story 5's general-knowledge fallback handles the empty-retrieval case
  for the latter half.
- **Out-of-distribution noise (5).** Tests the FALLBACK threshold's
  noise floor. "asdfghjkl" should NOT score top-1 for any skill above
  `FALLBACK_THRESHOLD` — that's the cliff.
- **Typo variants (3).** Tests embedder robustness. "what is chiefcalrity"
  must route to the same skill as "what is chiefclarity" — that's the
  bug the user reported.

The cliff visualization (a sorted top-1 score plot) shows two clusters:
in-distribution phrases bunched near 0.5-0.8, noise phrases bunched near
0.1-0.3. The threshold sits in the gap. If there is no gap, the corpus
or the descriptions are wrong; iterate.

### 9.3 Threshold values picked

Documented in `FEAT069_test-results.md`. Format:

```
FALLBACK_THRESHOLD: <value> (was 0.40)
  cliff between phrase "<lowest in-dist>" (top-1=<x>) and phrase "<highest noise>" (top-1=<y>)
  threshold sits at midpoint (x+y)/2
HIGH_THRESHOLD: <value> (was 0.80, kept|lowered)
  rationale: <one line>
GAP_THRESHOLD: <value> (was 0.15, no change)
```

### 9.4 BINDING smoke (10 phrases, 8/10 strict)

Per condition 14. The 10 phrases are verbatim from spec Story 6's table.
Phrases #1 ("what is my plan today") and #2 ("what is chiefclarity") are
the user-reported failures and MUST PASS — they are not in the tolerated
2-of-10 nondeterminism pool.

Cost comparison (Story 7) goes in `FEAT069_test-results.md`:

| Path | BEFORE (today) | AFTER (this FEAT) |
|---|---|---|
| Regex fast-path hit | ~0ms / 0 tokens | (no longer exists) |
| Structural first-token hit | ~0ms / 0 tokens | (no longer exists) |
| Embedding hit | ~50ms / 0 tokens | ~50ms / 0 tokens |
| Haiku tiebreaker | ~200ms + ~$0.0005 | ~200ms + ~$0.0005 (rate ≤ 20% above FEAT066 baseline) |
| Fallback | ~50ms (embedder ran) | ~50ms |

If AFTER median latency exceeds BEFORE median by > 100ms on a fixed
test phrase set, architect explicitly accepts or rejects the tradeoff
before merge.

### 9.5 Regression — full existing suite

- `router.test.ts` — modified per condition 13; passes.
- `v4Gate.test.ts` — unchanged; passes (the IGNORES-legacyIntent test
  is preserved verbatim).
- `skillBundle.test.ts` — byte-equality determinism passes after `bundle:skills`
  re-run.
- `triage.test.ts` (if exists) — fast-path tests rewritten or deleted.
- `npm run build:web` exits 0.

---

## 10. Pattern Learning

**FEAT069 codifies "calibrate routing thresholds against a real corpus,
don't guess them" as a reusable practice.**

The original `FALLBACK_THRESHOLD = 0.40` was a guess at FEAT051 design
time. It survived three FEATs (051, 054, 064) without ever being
measured against a phrase corpus. The user-reported failures are the
direct consequence of guessing — "what is my plan today" scored, say,
0.38 (we'd have to measure to know), one notch under the guessed floor,
and produced a polite refusal that read as a system bug to the user.

**Pattern statement (proposed addition to AGENTS.md, low-priority follow-up):**

> **Calibrate routing thresholds against a real corpus, don't guess.**
> Any threshold the routing pipeline depends on (cosine-similarity
> floors, gap-margin gates, retrieval `minScore` cutoffs) MUST be set
> from measured data, not from intuition. The artifact that survives
> the FEAT is the score-distribution table + the cliff visualization
> in `<FEAT>_test-results.md` — the threshold value alone is not
> sufficient documentation. When the corpus distribution drifts (new
> skills, new embedder model, observed routing failures), re-calibrate
> against the same artifact shape; do NOT silently bump the constant.
> Calibration scripts live in `scripts/scratch/` (gitignored); the
> table and chosen value live in committed test-results docs.
> See FEAT069 for the canonical shape.

**Carry-forward:**

- **Telemetry-driven re-calibration.** Future FEAT (post-FEAT070) adds
  audit-log routing-decision rows (FEAT056 Phase 3), enabling drift
  detection without manual re-runs of the corpus script.
- **Embedder model swap.** When the embedder migrates off
  `Xenova/all-MiniLM-L6-v2`, every threshold value in this FEAT must be
  re-calibrated against the new model. The calibration script is the
  reproducible mechanism.
- **`okr_update` / `topic_query` / `topic_note` migrations.** Each
  future skill-migration FEAT adds 5-8 corpus phrases for the new skill
  and re-calibrates if the noise floor shifts. The corpus is a living
  artifact, not a one-shot.

---

## 11. Sign-off

Architect approves. Conditions §7 binding (15 items). Conditions 4
(calibration corpus + script), 5 (thresholds set from data), 8 (description
enrichment), and 14 (binding 10-phrase smoke, 8/10 strict, phrases #1
and #2 MUST PASS) are the parity-defining artifacts — coder must
complete all four before declaring Done.

**Pay special attention to:**

- **Conditions 4 + 5 (calibration is load-bearing).** Do NOT pick a
  threshold by guess or by copy-paste from FEAT051. Run the corpus.
  Read the cliff. Set the value where the cliff sits. Document.
- **Condition 8 (description enrichment with 0.05 admission band).**
  The 0.05 band is deliberate. Do not iterate descriptions until every
  phrase scores top-1 outright if a tight 2-skill cluster appears —
  that's what the Haiku tiebreaker is for.
- **Condition 14 (smoke phrases #1 and #2 MUST PASS).** They are not
  in the tolerated nondeterminism pool. If either fails on the smoke
  run, do NOT mark Done.
- **Condition 7 (slash command UX).** Verify before deleting Step 1.
  If chat.tsx didn't already set `directSkillId` for slash commands,
  add that BEFORE the deletion lands.
- **Condition 6 (chat.tsx fastPath branch deletion).** Easy to forget
  because it's outside the router/triage diff. `tsc --noEmit` will
  catch it; do not skip the build check.
- **Condition 10 (fixed-template disclaimer is greppable).** The literal
  substring `"I don't have personal notes about"` MUST appear verbatim
  in the model's reply for empty-retrieval general-knowledge answers.
  The smoke phrase 4 assertion checks for it.
- **No real user data.** Calibration corpus and smoke phrases use
  generic placeholders only ("Project Alpha", "Topic X", "Contact A",
  "Task A"). The user-reported failure phrases are explicitly allowed
  because they contain no personal data; "ChiefClarity" is the project
  name (OSS-attribution exception).

This auto-advances to the coder. No further architect review required
unless the coder surfaces a condition-blocking finding during stage 5.
