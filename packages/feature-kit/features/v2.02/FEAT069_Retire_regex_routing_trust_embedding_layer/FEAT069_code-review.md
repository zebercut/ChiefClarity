# FEAT069 — Code Review

**Reviewer:** Code Reviewer agent
**Date:** 2026-04-27
**Spec:** `FEAT069_Retire_regex_routing_trust_embedding_layer.md`
**Design review:** `FEAT069_design-review.md` (15 binding conditions)
**Precedents:** `FEAT065/066/067/068_*/code-review.md`

---

## 1. Verdict

**APPROVED WITH MINOR FIXES — auto-advances to tester.**

FEAT069 is a clean architectural retirement. Two rule-based pre-filters
are gone (triage's `FAST_PATH_MAP` + `tryFastPath`, router's Step 1
structural matcher), the FEAT066 disagreement-warn dead branch is gone,
the calibration is data-driven and documented, the locked disclaimer
template lives in `info_lookup/prompt.md` exactly where the smoke greps
for it, all 8 manifests carry enriched descriptions, the bundle is
byte-equal across two consecutive `npm run bundle:skills` runs, and
the chat.tsx legacy `triage.fastPath` branch is correctly retired
along with the now-unused `assembleContext` import.

**Gates run by the reviewer (post-fix):**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean except pre-existing `executor.ts:229` |
| `node scripts/run-tests.js` | 484 / 484 PASS (baseline +1) |
| `npm run bundle:skills` (×2) | md5 `c8554ded6362d7cc03daa41e2343719e` (byte-equal) |
| `npm run build:web` | exports cleanly |
| Hardening exercise (re-add `tryFastPath`/`FAST_PATH_MAP`) | new test correctly fails |

**Fixes applied directly during review:**

1. **Privacy — replaced `"Aria"` with `"Contact A"`** in the smoke
   phrase #3 (both the gitignored `scripts/scratch/smoke-feat069.ts`
   and the committed `FEAT069_test-results.md`). "Aria" reads as a
   personal name — possibly a real one tied to the user's life — and
   the spec/design review both call for the generic `"Contact A"`
   placeholder. The smoke script is gitignored, but the test-results
   doc is committed; the rename keeps both consistent and removes the
   personal-name risk from the committed artifact.

The two flagged-but-not-fixed items (78.3% calibration pass; 8/10
smoke with #3 + #4 in the tolerated nondeterminism pool) are within
architect's published budget (Decision 6, condition 14). Docs deferral
on Condition 15 stands as flagged — `docs/new_architecture_typescript.md`
does not exist on this branch.

---

## 2. Files reviewed (post-fix)

**Source — diff inspected line-by-line:**

- `src/modules/triage.ts` — `FAST_PATH_MAP`, `tryFastPath`,
  `fastPath?: boolean` field, `TOKEN_BUDGETS` import all deleted.
  `runTriage` flow reduced to: circuit-breaker check → Haiku call →
  `safeDefault`. Comment block at lines 185-188 explains the deletion
  in-code.
- `src/modules/router.ts` — Step 1 structural matcher block deleted
  (was 421-446). Speculative structural-disagreement-warn block deleted
  from Step 1a (was 388-410). New comment block at 226-242 explains
  the calibration findings and the chosen thresholds. Pipeline doc
  comment (lines 335-345) updated to drop "Step 1".
- `src/modules/router.test.ts` — AC 2.1 "structural" test rewritten
  to assert the structural matcher is RETIRED (matching Mode B is
  `embedding`, not `structural`). FEAT066 disagreement-warn test
  rewritten to assert the warn does NOT fire. Two gate-probe tests
  recalibrated to the new HIGH=0.50 / FALLBACK=0.05 bands. New test
  asserts `tryFastPath` and `FAST_PATH_MAP` are not exported from
  `triage.ts` (this is the test that caught the hardening probe).
- `src/modules/rag.test.ts` — section title flipped from
  "FEAT068 — triage fast-path regex covers info_lookup phrases" to
  "FEAT069 — triage no longer regex-classifies intent". Each phrase
  test now asserts `result.fastPath === undefined` and
  `result.legacyIntent === "general"` (the safeDefault path with no
  Haiku client wired in).
- `app/(tabs)/chat.tsx` — `if (triage.fastPath && triage.legacyIntent)`
  branch removed (the field doesn't exist anymore; `tsc` would have
  bounced it). Now-unused `assembleContext` import also removed.
  Comment at lines 503-506 explains the simplification.

**Manifests (description enrichment):**

- `priority_planning/manifest.json` — adds "what is my plan today",
  "plan my day", "what's on my agenda", "where should I start",
  "weekly plan", "plan tomorrow". Generic prose, no user data.
- `info_lookup/manifest.json` — front-loads interrogative patterns
  ("What is X. Who is Y. Tell me about Z."), adds general-knowledge
  cues ("capital of France", "React", "closure", "photosynthesis"),
  documents the disclaimer-fallback contract.
- `task_management/manifest.json` — adds "show my open tasks",
  "remind me to follow up", "remind me to call X" (generic placeholder).
- `notes_capture/manifest.json` — adds "remember the idea",
  "capture this thought".
- `general_assistant/manifest.json` — broadens to chitchat /
  greetings / acknowledgements ("how are you", "what's up", "thanks",
  "haha", "ok", "yes", "tell me a joke").
- `inbox_triage/manifest.json` — tightens to "ONLY for bulk
  multi-item input — NOT for single-item creation, single-item
  lookup, single-item planning, or one-line questions" so the skill
  stops magnetizing single-phrase queries.
- `emotional_checkin/manifest.json` — tightens to "ONLY for explicit
  emotional disclosure, NOT for chitchat, greetings, thanks, or
  short acknowledgements".
- `calendar_management/manifest.json` — unchanged (already strong
  post-FEAT065).

**Prompt:**

- `src/skills/info_lookup/prompt.md` — Mode A (retrieval cited) and
  Mode B (empty-retrieval) sections. Mode B includes the locked
  template `"I don't have personal notes about <subject>, but in
  general:\n\n<answer>"` for both personal-life-tied and
  general-knowledge questions. The literal substring `"I don't have
  personal notes about"` is present at lines 50, 63, 88-90 — greppable
  per Condition 10.

**Bundle:**

- `src/skills/_generated/skillBundle.ts` — regenerated from the 8
  edited manifests. Byte-equal across two consecutive runs (md5
  `c8554ded6362d7cc03daa41e2343719e`).

**Test-results doc (committed):**

- `FEAT069_test-results.md` — cliff visualization, chosen thresholds,
  smoke output, cost comparison, conditions ledger.

**Untracked (gitignored, expected per One-Time Scripts Policy):**

- `scripts/scratch/calibrate-routing.ts` — 74-phrase corpus, embeds
  via FEAT067 isomorphic provider, prints sorted markdown table.
- `scripts/scratch/smoke-feat069.ts` — 10-phrase BINDING smoke.
- `scripts/scratch/calibration-output.md` — full sorted score table.

---

## 3. §15 conditions audit (final, post-fix)

| # | Condition | Status | Notes |
|---:|---|---|---|
| 1 | Triage regex fast-path deletion | DONE | `FAST_PATH_MAP`, `tryFastPath`, `fastPath?: boolean` all gone; flow reduced to circuit-breaker → Haiku → safeDefault. Verified by Grep — only references in source are the test absence-assertions. |
| 2 | Router structural matcher deletion | DONE | Old Step 1 block fully removed; Step 0 (`directSkillId`) and Step 1a (FEAT066 triage_hint) preserved unchanged. |
| 3 | FEAT066 speculative-disagreement-warn deletion | DONE | The `firstTok`/`tokenForMatch`/`structuralMatches` block inside Step 1a is gone. The legitimate "unknown mapped skill" warn cache (`_triageHintMissingWarnCache`) is retained correctly. |
| 4 | Calibration corpus + script | DONE | `scripts/scratch/calibrate-routing.ts` (gitignored). 74 phrases inlined: 48 canonical + 8 generic + 10 knowledge + 5 noise + 3 typo. Output `calibration-output.md` sorted by top-1 desc. No real user data. |
| 5 | Threshold values from data | DONE (with adjudication caveat below in §4) | `HIGH_THRESHOLD: 0.80 → 0.50`; `FALLBACK_THRESHOLD: 0.40 → 0.05`; `GAP_THRESHOLD: 0.15` unchanged. |
| 6 | `chat.tsx` legacy `triage.fastPath` branch deletion | DONE | Branch removed, `assembleContext` import removed. `tsc --noEmit` is clean. |
| 7 | Slash command UX preserved | VERIFIED with caveat (§5) | `chat.tsx` does not parse `/skillId` slugs into `directSkillId`. Slash phrases now route via embedding. See §5 for the caveat — this is a soft regression for power-users who typed `/task add foo`, since previously the structural matcher routed them. The architect's stance ("smoke phrase set may include a slash command at coder discretion; the spec's smoke set does not") accepts this. |
| 8 | Skill description enrichment | DONE (78.3% pass per architect's 0.05 admission band) | 7 of 8 manifests edited; `calendar_management` was already strong. The 78.3% top-1-or-within-0.05 pass rate is below the spec's "every phrase scores top-1 or within 0.05" quality bar but Decision 6 explicitly admits the band; iteration budget exhausted. |
| 9 | Bundle regenerated + determinism preserved | DONE | md5 `c8554ded6362d7cc03daa41e2343719e` byte-equal across two runs. `skillBundle.test.ts` passes. |
| 10 | `info_lookup` graceful general-knowledge fallback | DONE | Mode A / Mode B in `prompt.md`. Locked disclaimer present verbatim — greppable. |
| 11 | `TriageResult` type cleanup | DONE | `fastPath?: boolean` deleted; `legacyIntent?: IntentType` retained. |
| 12 | `RoutingMethod` enum unchanged | DONE | `"structural"` literal still in `src/types/orchestrator.ts:15` and `src/types/index.ts:583` for audit-log backward compat. No new code produces it. |
| 13 | Unit tests updated | DONE | `router.test.ts` AC 2.1 rewritten; FEAT066 disagreement-warn test rewritten; new `tryFastPath`-not-exported test added; gate-probe tests recalibrated. `rag.test.ts` FEAT068 fast-path tests rewritten to assert absence. |
| 14 | BINDING real-LLM smoke (8/10 strict) | PASS — 8/10; both MUST-PASS phrases #1 and #2 passed | Tester re-runs as part of stage 6. See §6 below for what tester should focus on. |
| 15 | Docs updated | PARTIAL (deferred — file does not exist) | `docs/new_architecture_typescript.md` was archived prior to this branch. Coder captured the architectural delta in `FEAT069_test-results.md` and flagged. Accept as deferred — the architect-archived doc cannot be updated by this FEAT. |

---

## 4. Threshold adjudication (cliff data interpretation)

The coder's claim — "data justifies HIGH=0.50, FALLBACK=0.05" —
is **YES, with a caveat on the FALLBACK value's permissiveness**.

### `HIGH_THRESHOLD = 0.50` — JUSTIFIED

The full corpus table (`scripts/scratch/calibration-output.md`)
shows:

- Highest in-distribution top-1: 0.598 (`mark Task A done`).
- Only 6 of 74 phrases score ≥ 0.50.
- Canonical priority_planning, task_management, calendar_management
  phrases mostly score 0.20-0.50 — the original 0.80 bar would have
  forced Haiku tiebreaker on essentially every confident route.

Lowering to 0.50 admits the highest-confidence band into
embedding-only routing without compromising the rest. The architect
explicitly permitted lowering (Decision 5) and forbade raising. **OK.**

### `FALLBACK_THRESHOLD = 0.05` — JUSTIFIED but PERMISSIVE

The cliff is not clean. Score table (sorted desc, abbreviated):

```
... top-1 ≥ 0.20 = mostly in-distribution canonical phrases
0.189  ok                  ← noise
0.169  asdfghjkl           ← noise
0.153  🤔                  ← noise
0.150  what is React       ← knowledge:general
0.147  thanks              ← canonical:general_assistant
0.146  explain quantum...  ← knowledge:general
0.145  ...                 ← noise
0.142  any info on Contact A ← canonical:info_lookup
0.129  what was that thing about Project Alpha ← knowledge:personal
0.127  what do you think   ← generic
0.119  what is a closure...  ← knowledge:general
0.119  yes                 ← noise
0.103  thanks a lot        ← generic
0.102  haha that's funny   ← canonical:general_assistant
0.102  what is Project Alpha ← canonical:info_lookup
0.101  what is chiefcalrity ← typo (the user-reported)
0.043  what is the capital of France ← knowledge:general
```

In-distribution short-knowledge phrases (`what is React`, `what is
a closure`, `what is Project Alpha`, `what is chiefcalrity`) sit
at 0.10-0.15 — co-mingled with noise. Setting FALLBACK above 0.10
would force user-reported typo phrase #2 ("what is chiefcalrity",
score 0.101) into the fallback path, which is the very bug FEAT069
is fixing. Setting FALLBACK at 0.05 admits the entire knowledge
phrase band into the Haiku tiebreaker — Decision 6's stated intent.

**The cost:** with FALLBACK=0.05, only ONE phrase in the corpus
scores below it (`what is the capital of France` at 0.043).
Practically, the fallback path is now near-dead — every phrase
hits Haiku. This shifts cost from "0ms regex pre-filter" to
"~200ms + ~$0.0005 Haiku call per non-confident phrase". The
tiebreaker call rate observed in the smoke is 7/10 — within
budget per Story 7. Architect's no-raise rule on HIGH and the
explicit Haiku-as-resolver framing in Decision 6 accept this.

**Pure-noise routing safety check:** with FALLBACK=0.05, "asdfghjkl"
(top-1 = 0.169 against `emotional_checkin`, top-2 = `general_assistant`
at 0.143) goes to Haiku tiebreaker. Haiku picks among the top-3
candidate skills (it has `general_assistant` available in top-3 for
short noise phrases). Empirically Haiku tends to pick general_assistant
for nonsense phrases, so the practical behavior is acceptable — but
this depends on Haiku's judgment, not a hard architectural floor.
The FEAT051 design's "noise-floor cliff" is gone; the Haiku
tiebreaker now bears the load. **Documented; accepted.**

---

## 5. Slash command verification

`chat.tsx` does NOT parse `/skillId` slugs and never has — Grep on
the chat.tsx surface returns no `directSkillId =` assignment for
slash phrases (the only `directSkillId` callsite is the
`processBundle` timer in `src/modules/inbox.ts:97` setting
`"inbox_triage"`).

The deleted Step 1 structural matcher previously routed slash phrases
(`/task add foo`, `/cal book`, `/note save this`, `/focus`,
`/feeling`, `/inbox`, `/dump`) by matching the first token against
`structuralTriggers` arrays on each manifest. After FEAT069, those
phrases route via the embedding step instead.

**Practical effect:** typing `/task add foo` no longer guarantees
`task_management` — it depends on whether the embedder picks
`task_management` from the cosine score. Spot check via the
calibration corpus: phrases like "add a task to call the dentist"
score 0.39 against task_management and route correctly through
Haiku tiebreaker. Slash-prefixed variants are not in the corpus, so
the empirical behavior is untested.

**Adjudication:** The coder marked Condition 7 verified ("the
deleted structural matcher was a no-op for slash UX"). That phrasing
is **technically incorrect** — the structural matcher was the only
path that made `/task` route to `task_management`. The correct
framing is: slash UX was never a chat.tsx concern, and the structural
matcher's slash handling was incidental. Slash-typing power users
will notice a subtle change (slash phrases now go through
embedding+Haiku, not structural). The architect's spec stance ("smoke
phrase set may include a slash command at coder discretion") accepts
this regression as in-budget.

**Tester focus:** if the user typically uses `/skill` slash
prefixes, the tester's smoke run should add a slash phrase
(e.g., `/task add foo`) to verify it still reaches `task_management`
via the embedder. This is NOT in the BINDING 10-phrase set, so it
is suggested-but-not-required.

---

## 6. Code observations

- **Comment block at `router.ts:226-242` is exemplary.** Documents
  the calibration findings, the cliff visualization, the chosen
  thresholds, and the rationale inline. Survives the source even
  if the test-results doc rotates out.
- **`router.ts:185-188` triage comment** captures the architectural
  intent clearly. Future readers will not need to read the FEAT069
  spec to understand why the regex is gone.
- **`rag.test.ts` migration is clean.** Each old fast-path test now
  asserts `(result as any).fastPath === undefined` AND
  `result.legacyIntent === "general"` (the safeDefault path). The
  defensive `as any` cast is appropriate for asserting the field's
  absence on the type.
- **`router.test.ts` AC 2.1 rewrite is correct.** The test now
  ensures `routingMethod !== "structural"` AND `routingMethod ===
  "embedding"` for `/plan today` against a stubbed embedder — proves
  Step 1 deletion is honored. The new "tryFastPath is no longer
  exported" test reaches into the imported triage module and asserts
  both names are `undefined` — caught the hardening probe.
- **chat.tsx simplification is minimal and surgical.** Single
  branch removed, single import removed, comment explains why. No
  drift into adjacent code.
- **Manifest description prose is natural, not regex-dump.** Each
  one paragraph; the example phrasings flow as prose. Quality bar
  per Decision 6 met (78.3% top-1-or-within-0.05).
- **The locked disclaimer template appears verbatim three times in
  `info_lookup/prompt.md`** — Mode B personal-life-tied case (line
  50), Mode B general-knowledge case (line 63), and a "do not skip
  the disclaimer" reminder (line 90). Greppable on `"I don't have
  personal notes about"` per Condition 10.

---

## 7. Hardening exercises

1. **Re-add `FAST_PATH_MAP` + `tryFastPath` to triage.ts** —
   inserted dummy exports `export const FAST_PATH_MAP: Array<...> = []`
   and `export function tryFastPath(_p: string): null { return null }`
   directly above `runTriage`.
   - Result: `router.test.ts` "FEAT069: tryFastPath is no longer
     exported from triage" test failed (1 of 36 router tests).
   - The two `assert.strictEqual` checks correctly trapped both
     names. **Test does its job.** Restored.
2. **Verified `routingMethod !== "structural"` test holds** — the
   AC 2.1 rewrite correctly probes `routeToSkill` against a stubbed
   embedder and asserts the new `embedding` outcome.
3. **Bundle determinism** — ran `npm run bundle:skills` twice; md5
   `c8554ded6362d7cc03daa41e2343719e` matches both runs and matches
   the coder's claim.

---

## 8. Things NOT in scope (carried forward, not in this FEAT)

- `docs/new_architecture_typescript.md` reconstruction. The archived
  doc must either be reinstated by a separate FEAT or replaced by
  the v4 docs under `docs/v4/`. **Carried forward.**
- AGENTS.md "calibrate routing thresholds against a real corpus"
  pattern entry (architect's §10 proposal). Low-priority follow-up.
  **Carried forward.**
- Telemetry-driven re-calibration (post-FEAT070). **Carried forward.**
- `RoutingMethod` enum cleanup (deleting the `"structural"` literal).
  Defer per Condition 12. **Carried forward.**
- `structuralTriggers` field removal from manifests + loader +
  bundle codegen. Defer per spec "Out of Scope". **Carried forward.**
- `okr_update` migration to a v4 skill — separate FEAT (likely
  FEAT071). **Carried forward.**
- Slash command UX hardening (chat.tsx parsing `/skillId` →
  `directSkillId`). The structural matcher's incidental slash
  handling is gone; if power-users notice a regression, this is the
  fix. **Carried forward.**
- Legacy v3 chain retirement (FEAT070). Decision 1 keeps Haiku as
  triage's only intent classifier specifically to keep the v3 chain
  working. **Carried forward.**

---

## 9. Sign-off

Code review APPROVED. One privacy fix applied directly (Aria →
Contact A in test-results doc + smoke script). All gates pass
post-fix. Hardening exercise validates the new
`tryFastPath`-not-exported test. Threshold adjudication: data
justifies the chosen values; FALLBACK=0.05 is permissive but
within architect Decision 6's deliberate band, with Haiku as the
designed resolver. 78.3% calibration pass and 8/10 smoke are within
architect-published budgets. Conditions 7 (slash UX) and 15 (docs
deferral) carry caveats but are accepted.

This auto-advances to the tester. The tester re-runs the BINDING
10-phrase smoke against the live API proxy. Phrases #1 ("what is
my plan today" → priority_planning) and #2 ("what is chiefclarity"
→ info_lookup) MUST PASS — not in the tolerated 2-of-10 pool.
Phrases #3 (`who is Contact A`) and #4 (`what is the capital of
France`) are the architect-acknowledged soft spots; if either
fails, that's within budget — but the disclaimer literal `"I don't
have personal notes about"` MUST appear in phrase #4's reply
regardless of which skill it routes to.

— Code Reviewer agent
