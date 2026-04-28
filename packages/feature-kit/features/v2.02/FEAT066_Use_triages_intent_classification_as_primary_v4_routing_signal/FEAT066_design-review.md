# FEAT066 — Design Review

**Reviewer:** Architect agent
**Date:** 2026-04-27
**Spec:** `FEAT066_Use_triages_intent_classification_as_primary_v4_routing_signal.md`
**Refs:** FEAT051 (router algorithm + ladder), FEAT054 (registry / `getSkill`),
FEAT056 (`shouldTryV4` gate, `setV4SkillsEnabled`),
FEAT064 (isomorphic skill loading — context for why the embedder is null on
web), FEAT065 (binding real-LLM smoke pattern + `scripts/scratch/smoke-v4.ts`
shape). Bug site: `src/modules/router.ts::routeToSkill` (no triage-hint step,
the structural matcher at lines 319-344 is the first NL signal it consults)
and `app/(tabs)/chat.tsx:399-401` (the `routeToSkill({ phrase })` call inside
the `shouldTryV4` block). Triage source-of-truth:
`src/modules/triage.ts::FAST_PATH_MAP` (lines 182-211) and `safeDefault`
(line 336). Types: `src/types/orchestrator.ts` (`RouteInput`,
`RoutingMethod`); `src/types/index.ts:62-79` (`IntentType`).

---

## 1. Verdict

**APPROVED for implementation** subject to §7 conditions.

Pure plumbing fix in the same shape as FEAT061 — one upstream signal
already exists, the consumer just doesn't read it. Add one optional field to
`RouteInput`, one literal to `RoutingMethod`, one static map plus one
short-circuit step in `routeToSkill`, one extra arg at the chat-surface call
site. No new modules, no new abstraction layer.

The load-bearing artifact is the **embedder-disabled real-LLM smoke** (§7
condition 8). The FEAT064 → FEAT065 pattern reasserts itself: stub-LLM
unit tests prove the new step *works*; only the embedder-disabled live
proxy run proves the bug *cannot recur on web*. The smoke is binding.

---

## 2. Architecture (one screen)

```
┌─ chat.tsx (one-line plumbing) ──────────────────────────────────────┐
│ const triage = await runTriage(phrase, ...);                        │
│ if (shouldTryV4({ state: s, triageLegacyIntent: triage.legacyIntent })) {│
│   const route = await routeToSkill({                                │
│     phrase,                                                         │ NEW
│     triageLegacyIntent: triage.legacyIntent ?? undefined,           │ NEW
│   });                                                               │
│   ...                                                               │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ types/orchestrator.ts (additive) ──────────────────────────────────┐
│ RouteInput {                                                        │
│   phrase: string;                                                   │
│   directSkillId?: string;                                           │
│   triageLegacyIntent?: IntentType;                                  │ NEW
│ }                                                                   │
│ RoutingMethod = ... | "haiku" | "fallback" | "triage_hint"          │ NEW
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ router.ts::routeToSkill — new Step 1a ─────────────────────────────┐
│ Step 0  directSkillId          (validate; degrade if missing)       │
│ Step 1a triage hint            ←── NEW                              │
│         if (triageLegacyIntent &&                                   │
│             TRIAGE_INTENT_TO_SKILL[triageLegacyIntent] is set &&    │
│             registry.getSkill(skillId) &&                           │
│             getV4SkillsEnabled().has(skillId)) {                    │
│           if (structural-match-on-first-token-disagrees) {          │
│             console.warn("[router] triage_hint pre-empts ...")      │
│           }                                                         │
│           return { skillId, confidence: 0.95,                       │
│                    routingMethod: "triage_hint", candidates: [] };  │
│         }                                                           │
│ Step 1  structural match  (unchanged)                               │
│ Step 2  embedding similarity  (unchanged — null on web)             │
│ Step 3  confidence gate  (unchanged)                                │
│ Step 4  haiku tiebreaker  (unchanged)                               │
│ Step 5  fallback → general_assistant  (unchanged)                   │
└─────────────────────────────────────────────────────────────────────┘
                ↓
┌─ TRIAGE_INTENT_TO_SKILL  (module const in router.ts) ───────────────┐
│ task_create | task_update | task_query → "task_management"          │
│ calendar_create | calendar_update | calendar_query → "calendar_..." │
│ emotional_checkin → "emotional_checkin"                             │
│ bulk_input → "inbox_triage"   (dead today — see §4)                 │
│ full_planning → "priority_planning"                                 │
│ general | info_lookup | learning | feedback | suggestion_request    │
│   → "general_assistant"                                             │
│ (omitted on purpose: okr_update, topic_query, topic_note)           │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this is the right shape.** Triage runs *upstream* of routing already
(`chat.tsx:389` precedes `chat.tsx:401`). Its `legacyIntent` is the
strongest pre-router classification signal the system has — regex fast-path
plus a Haiku tiebreaker. Today the router rebuilds intent from scratch
using two weaker signals (single-token structural compare; embedding
similarity unavailable on web). Plumbing the existing answer through one
extra hop is the canonical "fix the contract" move. Same template as
FEAT061.

---

## 3. Alternatives considered

### 3.1 Triage-hint step vs multi-token structural matcher

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| (a) Multi-token structural matcher (e.g., scan first 3 tokens, match against `structuralTriggers`) | Stays inside the structural step; no new signal source. | Triggers on per-skill manifest authorship choices — every new skill author has to enumerate every verb prefix. Misses paraphrase ("I'm feeling stressed" — neither "I'm" nor "feeling" is a structural trigger). Doesn't use the upstream classifier we already paid for. | Reject |
| **(b) Triage-hint step (CHOSEN)** | Reuses the upstream classifier — no manifest authoring burden. Catches paraphrase via the same regex/Haiku fast-path that already classifies for triage's data-source decision. Web-safe (no embedder dependency). | Couples router to triage's `IntentType` taxonomy. If triage drifts (a regex misfires), the router inherits the misclassification. Mitigated by §6 risk-1. | **CHOSEN** |
| (c) Unblock embeddings on web (FEAT067 pre-empted) | Most general fix — covers novel phrases triage can't classify. | Heavier work: Metro `blockList` unblock, WASM + tokenizer download flow, cold-start cost on first chat after install. Even when shipped, doesn't help phrases triage already classified — it'd compute embeddings the system doesn't need. Different scope; orthogonal. | Defer to FEAT067 |

**Decision rationale.** (b) closes the high-impact verb-prefix path at
near-zero cost and still composes with (c) when (c) ships. Doing (b) does
not diminish the case for (c); (c) covers the *long tail* triage misses, (b)
covers the *head* the system already classified.

### 3.2 Confidence value — 0.95 vs 1.0 vs lower

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| 1.0 (pin to "certain") | Log/UX simplicity — every non-fallback route shows the same confidence. | Triage is probabilistic (regex + Haiku tiebreaker on Haiku triage path). 1.0 overstates certainty and loses the "is triage drifting?" signal a future audit-log surface (FEAT069) could mine. | Reject |
| **0.95 (CHOSEN)** | Strong-signal — clearly above embedding `HIGH_THRESHOLD` (0.80) so the routing decision is unambiguous. Distinguishable from structural/direct (1.0) so audit-log consumers can tell the routes apart. Leaves headroom for a future "show top-3 alternatives" affordance. | One-line decision the coder can't second-guess. | **CHOSEN** |
| 0.85 or lower | Headroom for sub-1.0 alternative-skill UI. | Below `HIGH_THRESHOLD`-equivalent — a future code reader might assume the router shouldn't have short-circuited at this level. | Reject |

### 3.3 Pre-empt structural match — silent vs warn-on-disagreement

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Silent pre-empt | Cleanest log output. | Loses the "triage said X, structural says Y" signal that's worth surfacing if we ever need to tune either. | Reject |
| **Warn on disagreement, then take triage (CHOSEN)** | Behavior-identical to silent pre-empt (still routes via triage) — the warn is purely telemetry. Surfaces triage-vs-manifest-trigger drift as a learnable signal without changing routing semantics. | One extra `console.warn` in the disagreement case. | **CHOSEN** |
| Hard-prefer structural | Reverses the design — defeats the FEAT. | Triage is the higher-quality signal (regex + Haiku tiebreaker). Structural is single-token literal compare. | Reject |

### 3.4 Mapped skill present in registry but NOT in `getV4SkillsEnabled()`

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Silent fall-through (CHOSEN)** | The enabled-set IS the per-skill rollout knob. WARN here would spam the console every time a user (or test) calls `setV4SkillsEnabled([...])` to disable a skill. Silent fall-through preserves rollout discipline; the existing ladder still runs. | None significant. | **CHOSEN** |
| Warn-and-fall-through | Loud during rollback. | Anti-debug signal; rollback is intentional. | Reject |
| Short-circuit to legacy | Pre-empts the existing ladder. | Silently overrides FEAT051's behavior; not orthogonal to the rollout knob. | Reject |

### 3.5 Mapped skill NOT in registry (configuration mistake)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Silent fall-through | Quietest. | Masks a real bug — the map references a skill that was supposed to load but didn't. | Reject |
| **Warn-once + fall-through (CHOSEN)** | Surfaces the configuration mistake without breaking user chat. The "once" is enforced by a module-level `Set<string>` of already-warned skill ids — avoids log spam if the same phrase recurs. | Tiny module-level cache. | **CHOSEN** |
| Hard-error | Loudest. | Breaks chat for the user; the right severity for boot-time but not for per-phrase routing. The registry already rejects bad skills at boot (FEAT054 §3.4). If a mapped skill is missing here, falling through is acceptable. | Reject |

### 3.6 Add `okr_update` / `topic_query` / `topic_note` to map → `general_assistant`?

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Yes, point at `general_assistant` | Hits the fallback skill faster — skips the embedding step. | Masks the missing-skill state. The day `okr_update` migrates as its own v4 skill, the wiring would silently re-target — making the "new skill" deploy look like a routing change instead of a new capability. Defeats the per-skill rollout discipline. | Reject |
| **No entry — let the existing ladder handle them (CHOSEN)** | When those skills migrate, that FEAT adds the map entry as part of its scope. Today they fall through to embedding → fallback → `general_assistant` with a clearly-logged `routingMethod: "fallback"` reason. The signal "this intent has no v4 skill yet" stays visible. | Slightly slower routing for those phrases (no triage short-circuit). They were already going through the ladder; no regression. | **CHOSEN** |

### 3.7 Smoke embedder simulation — per-call override vs runtime flag

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `LIFEOS_DISABLE_EMBEDDER` runtime flag | One env var; smoke script trivially short. | Adds a global flag. Risk: leaks into production via misconfigured shell or test fixture. Embedder bypass is a *test-only* concern; flag-shaped solutions invite production accidents. | Reject |
| **Per-call `embedder: async () => null` injection (CHOSEN)** | Matches the existing test pattern in `router.test.ts:316,549` (the per-test embedder injection). Zero production code change — `RouteOptions.embedder` already exists. Smoke script in `scripts/scratch/` (gitignored per repo policy) explicitly passes the null embedder per phrase. | None — this is the established pattern. | **CHOSEN** |

---

## 4. Triage emit audit

Architect-derived from a line-by-line read of `src/modules/triage.ts::FAST_PATH_MAP`
and `safeDefault`. The **fast-path** is the only place triage assigns
`legacyIntent` to a regex-classified intent; the Haiku-triage path returns
a `TriageResult` with `legacyIntent` undefined (verified — the Haiku branch
constructs `result` at lines 281-293 without setting `legacyIntent`).

| Intent in PM map | Triage emits? | Notes | Live or dead today |
|---|---|---|---|
| `task_create` | YES | `FAST_PATH_MAP[0]`: `/\b(add\|create\|new)\b.*(task\|todo\|reminder)/i`, `/\b(remind me\|remember to\|don't forget)\b/i` | **Live** |
| `task_update` | YES | `FAST_PATH_MAP[1]`: `/\b(mark\|done\|complete\|finished\|cancel)\b.*(task\|todo)/i`, `/\b(done with\|finished)\b/i` | **Live** |
| `task_query` | NO | No fast-path regex; Haiku triage path doesn't set `legacyIntent` | **Dead** (forward-compat: kept for when triage gains a query fast-path) |
| `calendar_create` | YES | `FAST_PATH_MAP[2]`: `/\b(schedule\|book\|set up)\b.*(meeting\|appointment\|call\|event)/i` | **Live** |
| `calendar_update` | YES | `FAST_PATH_MAP[3]`: `/\b(cancel\|reschedule\|move\|postpone)\b.*(meeting\|event\|appointment\|call)/i` | **Live** |
| `calendar_query` | NO | Same as `task_query` — no fast-path regex | **Dead** (forward-compat) |
| `emotional_checkin` | YES | `FAST_PATH_MAP[6]`: `/\b(feeling\|stressed\|frustrated\|anxious\|overwhelmed\|venting\|what a day)\b/i` | **Live** |
| `bulk_input` | NO | Confirmed — not in `FAST_PATH_MAP`, not emitted by `safeDefault`. The `bulk_input` flow is `inbox.ts::processBundle` and bypasses the chat-surface triage hook entirely (`processBundle` calls `dispatchSkill` directly without going through `routeToSkill`). | **Dead** (entry preserved for completeness — see condition 4 note) |
| `full_planning` | YES | `FAST_PATH_MAP[4]`: `/\b(plan my\|plan the\|plan for)\b.*(day\|week\|tomorrow\|morning\|afternoon)/i`, `/\b(weekly review\|daily plan\|prepare.*plan)\b/i` | **Live** |
| `general` | YES | `safeDefault` (line 346) sets `legacyIntent: "general"` when both fast-path and Haiku triage fail. | **Live** |
| `info_lookup` | NO | No fast-path regex; Haiku triage path doesn't set `legacyIntent` | **Dead** (forward-compat) |
| `learning` | NO | Same | **Dead** (forward-compat) |
| `feedback` | NO | Same | **Dead** (forward-compat) |
| `suggestion_request` | NO | Same | **Dead** (forward-compat) |

**Outside the PM map (intentionally omitted):**

| Intent | Triage emits? | Why omitted |
|---|---|---|
| `okr_update` | YES (`FAST_PATH_MAP[5]`) | Per Open Q5: no migrated v4 skill exists. Pointing at `general_assistant` would mask the "missing capability" state. Adding the entry belongs to the FEAT that migrates `okr_update` to a v4 skill. |
| `topic_query` | NO | No migrated v4 skill exists. |
| `topic_note` | NO | No migrated v4 skill exists. |

**Audit conclusions.**

- 6 of the 14 mapped intents are **live** today — every CRUD verb-prefix
  case the bug report covers (`task_create`, `task_update`, `calendar_create`,
  `calendar_update`, `emotional_checkin`, `full_planning`) plus `general`
  via `safeDefault`.
- 8 are **dead** today (`task_query`, `calendar_query`, `bulk_input`,
  `info_lookup`, `learning`, `feedback`, `suggestion_request`). They remain
  in the map as **forward-compat** — if triage gains a fast-path for any of
  them, the route is wired the same day. The dead entries cost nothing at
  runtime (a Map-key lookup that never hits) and document the intended
  routing for future triage authors.
- The `bulk_input` entry is **special**: triage doesn't emit it AND
  `bulk_input` doesn't go through chat-surface routing at all — it goes
  through `inbox.ts::processBundle`. The map entry is dead from two
  directions. Keeping it is harmless and signals "if/when bulk input is
  ever routed via chat, this is where it goes". The coder should add a
  one-line comment in `TRIAGE_INTENT_TO_SKILL` next to the entry per
  condition 4.
- `okr_update` is the one **live triage emit with no map entry** — by
  design (Open Q5). Phrases like "OKR update" go through the existing
  ladder today and end up at `general_assistant` via fallback with a
  clear `reason` string. That visible-fallback behavior is what flags
  "missing capability" to a future architect; silencing it would defeat
  rollout discipline.

---

## 5. Cross-feature concerns

- **FEAT064 (web bundling).** This FEAT exists *because* of FEAT064 — the
  isomorphic skill loader runs on web with a null embedder, so the FEAT051
  ladder degrades to fallback for any phrase whose first token isn't a
  structural trigger. Triage runs on web (it's regex + a Haiku call via
  the api-proxy), so its `legacyIntent` is available. This FEAT closes the
  web routing gap FEAT064 surfaced. No FEAT064 code is touched.
- **FEAT065 (real-LLM smoke pattern).** §7 condition 8 mirrors FEAT065's
  binding-smoke shape: a `scripts/scratch/smoke-v4.ts` analog exercising
  the production routing path with deliberately disabled embedder. Pass
  threshold 10/11 strict per PM (the 11th phrase is optional). Stub-LLM
  unit tests prove the new step *works*; only the embedder-disabled live
  proxy run proves the bug *cannot recur on web*.
- **FEAT056 (`shouldTryV4` gate).** No change. The gate already accepts
  `triageLegacyIntent` in its input shape (line 38 of `v4Gate.ts`) for
  forward compatibility but doesn't read it. This FEAT does not modify
  that decision; it only widens what the *caller* (chat.tsx) does with the
  same value once the gate returns true.
- **FEAT069 (audit log consumer).** Forward-compatible additive widening
  of `RoutingMethod` — consumers reading `routingMethod` from `RouteResult`
  see a new literal. No existing consumer matches on the enumeration
  exhaustively (verified — the union is only consumed for log strings and
  badge UI).
- **Future skill migrations (e.g., the one that migrates `okr_update`).**
  Each such FEAT adds its own line to `TRIAGE_INTENT_TO_SKILL`. The map is
  the per-skill rollout's natural extension point — same place a future
  author looks when wiring triage to a new skill.
- **Headless runner and other `routeToSkill` callers.** Out of scope per
  spec. They keep working without the hint via the optional field. Threading
  the hint through scheduled flows is a follow-up FEAT, not this one.
- **FEAT067 (web embeddings).** Not blocked by this FEAT. FEAT066 closes
  the head-of-distribution verb-prefix gap; FEAT067 covers the long tail
  of phrases triage can't classify (genuinely novel inputs). Both
  compose: when FEAT067 ships, the embedder fills in for the long tail
  while triage-hint short-circuits the head.

---

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Triage classifier drift** — a triage regex misfires (e.g., a phrase the user meant as a query gets classified `task_create`) and the router faithfully ships the wrong skill. | Medium | Medium | Triage drift is out of scope here per spec — but the disagreement-warn (Open Q2 / §3.3) gives us telemetry: when triage and structural disagree we log it, so a future audit-log review surfaces drift candidates. Triage authors fix triage; this FEAT does not duplicate the fix at the router layer. |
| **Map staleness when skills are added/renamed** — a future skill rename leaves a stale `skill_id` string in `TRIAGE_INTENT_TO_SKILL`; routing silently falls through. | Medium | Low | Condition 7 (warn-once on missing-from-registry) surfaces the mistake in the console. A future hard-error follow-up (analogous to FEAT065's deferred WARN→throw) can downgrade once the map has stabilized for one release. |
| **Structural-vs-triage conflict masks a manifest bug** — a skill author adds a `structuralTriggers` entry that conflicts with triage's classification; the warn fires but the bug is opaque to the user. | Low | Medium | The disagreement-warn (Open Q2) names both candidate skill ids. A code reviewer reading the warn during stage 5 catches the manifest mistake. Not a routing-layer fix — surfaces the data. |
| **Smoke phrase set is too narrow** — 10 phrases may not exercise enough triage paraphrase variation; a real user phrase still misroutes. | Medium | Low | The smoke is a regression gate, not a coverage gate. The phrase set covers every live intent in the map plus one fallback — additions are welcome (condition 8 explicitly allows tester additions). FEAT067 long-tail coverage is the real fix for novel phrasing. |
| **Triage-hint pre-empts a correct structural match for a slash command** — `/foo` slash command lands when triage already classified the *previous* user phrase as `task_create`. | Very Low | Low | Triage runs per-phrase (`runTriage` is called fresh on each user message at `chat.tsx:389`), so the hint reflects the *current* phrase only. Slash commands are also typically not classified by triage's regex (the regex requires verbs like "add"/"schedule" — "/foo" matches none), so triage emits no hint and the structural step runs unchanged. Verified by reading `FAST_PATH_MAP`. |
| **Module-level warned-set leaks across tests** — the warn-once cache for missing-from-registry skills carries state between test cases. | Low | Low | Condition 5 requires a `_resetTriageHintWarnCacheForTests()` test helper, mirroring `_resetOrchestratorForTests()` (line 255 of `router.ts`). Existing test pattern. |

---

## 7. Conditions (numbered, BINDING)

1. **`RouteInput` widens additively.** `src/types/orchestrator.ts:36-44`
   gains `triageLegacyIntent?: IntentType;` after `directSkillId?`. Import
   `IntentType` from `./index`. No other field changes.
2. **`RoutingMethod` adds `"triage_hint"`.** `src/types/orchestrator.ts:12-17`
   union gains the literal as the second-to-last entry (before `"fallback"`).
   No other consumer changes — `logRoutingDecision` passes the value
   through as a string.
3. **`TRIAGE_INTENT_TO_SKILL` const added to `router.ts`.** Module-level,
   `Partial<Record<IntentType, string>>`, exported (so unit tests can
   import without duplicating the literal). Entries per the §4 audit:
   `task_create`/`task_update`/`task_query` → `task_management`,
   `calendar_create`/`calendar_update`/`calendar_query` → `calendar_management`,
   `emotional_checkin` → `emotional_checkin`,
   `bulk_input` → `inbox_triage` (with one-line comment: "dead via chat
   surface today — kept for forward compat; see FEAT066 §4"),
   `full_planning` → `priority_planning`,
   `general`/`info_lookup`/`learning`/`feedback`/`suggestion_request`
   → `general_assistant`. NO entries for `okr_update`, `topic_query`,
   `topic_note` (per §3.6).
4. **Step 1a in `routeToSkillInternal`** — added between Step 0
   (`directSkillId`) and Step 1 (structural match), in that exact position.
   Fires only when ALL hold:
   `input.triageLegacyIntent` is truthy;
   `TRIAGE_INTENT_TO_SKILL[input.triageLegacyIntent]` returns a skill id;
   `registry.getSkill(skillId)` returns non-null;
   `getV4SkillsEnabled().has(skillId)` is true.
   Returns `{ skillId, confidence: 0.95, routingMethod: "triage_hint", candidates: [] }`.
5. **Disagreement-warn telemetry.** Inside Step 1a, after the conditions
   pass and BEFORE the return, run the same first-token `structuralTriggers`
   lookup the existing Step 1 uses. If exactly one structural match exists
   AND its skill id differs from the triage-hint pick, emit
   `console.warn("[router] triage_hint pre-empts structural: triage=<intent>→<triageSkill>, structural=<structSkill>, phrase=<sha256First16>")`.
   No behavior change — still returns the triage pick. Warn is telemetry only.
6. **Silent fall-through when mapped skill is in registry but disabled.**
   Per §3.4. No console output; the existing ladder runs.
7. **Warn-once when mapped skill is NOT in registry.** Per §3.5. Module-level
   `Set<string>` cache. First miss emits
   `console.warn("[router] triage_hint map references unknown skill <skillId> for intent <intent>; falling through")`;
   subsequent misses for the same skill id stay silent. A
   `_resetTriageHintWarnCacheForTests()` exported helper resets it,
   mirroring `_resetOrchestratorForTests()` (line 255).
8. **`chat.tsx` passes the hint.** `app/(tabs)/chat.tsx:401` becomes
   ```
   const routeResult = await routeToSkill({
     phrase,
     triageLegacyIntent: triage.legacyIntent ?? undefined,
   });
   ```
   No other chat-surface logic changes.
9. **Unit tests** in `src/modules/router.test.ts` (extending the existing
   `routeToSkill` block) — at least one each for:
   (a) hint set, mapped skill enabled and present → `routingMethod: "triage_hint"`, confidence 0.95;
   (b) hint set, mapped skill not in `getV4SkillsEnabled()` → falls through to existing ladder (asserts no `triage_hint` method, no warn);
   (c) hint set, mapped skill not in registry → warn fires once, falls through;
   (d) hint set with a structural trigger that points at a different skill → triage wins, disagreement-warn fires;
   (e) hint NOT set → existing ladder unchanged (regression baseline);
   (f) hint set to an `IntentType` not in the map (`okr_update`, `topic_query`, `topic_note`) → falls through to existing ladder.
   All tests use the per-test `embedder: async () => null` injection
   pattern already established in `router.test.ts`.
10. **MANDATORY — Real-LLM smoke (BINDING).** Tester runs a script
    `scripts/scratch/smoke-feat066.ts` (gitignored under
    `scripts/scratch/` per repo policy) using the live api-proxy. Each
    phrase goes through `routeToSkill` with **`embedder: async () => null`
    injected per call** — simulating the web environment. For each phrase:
    `routeResult.routingMethod === "triage_hint"`,
    `routeResult.skillId === <expected>`,
    and the dispatcher then executes against the live Anthropic API and
    `toolCall.name` is one declared by the routed skill's manifest.
    **Pass threshold: 10/11 strict** (phrase 11 is optional per PM spec).
    If any of phrases 1-10 fails, do NOT mark Done.
    **Phrase set (verbatim from spec — generic placeholders only, no real
    user data):**
    | # | Phrase | Triage `legacyIntent` | Expected skill |
    |---|---|---|---|
    | 1 | `add a task to test task creation, due tomorrow` | `task_create` | `task_management` |
    | 2 | `create a task: review the placeholder doc by Friday` | `task_create` | `task_management` |
    | 3 | `remind me to follow up on Project Alpha next week` | `task_create` | `task_management` |
    | 4 | `mark the placeholder task as done` | `task_update` | `task_management` |
    | 5 | `schedule a meeting with Contact A tomorrow at 3pm` | `calendar_create` | `calendar_management` |
    | 6 | `book a 30-minute call about Project Alpha on Thursday` | `calendar_create` | `calendar_management` |
    | 7 | `cancel the Thursday placeholder meeting` | `calendar_update` | `calendar_management` |
    | 8 | `I'm feeling stressed about the upcoming deadline` | `emotional_checkin` | `emotional_checkin` |
    | 9 | `feeling overwhelmed by everything on my plate` | `emotional_checkin` | `emotional_checkin` |
    | 10 | `plan my day` | `full_planning` | `priority_planning` |
    | 11 (opt) | `tell me about Project Alpha` | `general` (safe-default) | `general_assistant` |
    Output captured in `FEAT066_test-results.md` per phrase: triage log
    line, router log line (showing `method=triage_hint`), dispatcher tool
    name, pass/fail flag.
11. **Existing tests pass unchanged.** `npm test` green; specifically
    `router.test.ts`, `v4Gate.test.ts`, `skillDispatcher.test.ts` — none
    of these regress.
12. **`tsc --noEmit` clean** other than pre-existing warnings.
    `npm run build:web` exits 0.
13. **`docs/new_architecture_typescript.md` updated** — Section 5
    (`RouteInput`, `RoutingMethod` updates), Section 6 (Module
    Responsibilities — describe Step 1a in the routing ladder), Section 9
    (ADR for "triage hint as primary routing signal" with the §3.1
    rationale). Wider doc sweeps out of scope per spec.
14. **Zero changes** to triage (`triage.ts`), the registry (`skillRegistry.ts`),
    the dispatcher (`skillDispatcher.ts`), the v4 gate (`v4Gate.ts`),
    the executor, the assembler, or any skill manifest / handler / prompt.
    Strictly local: types/orchestrator.ts, router.ts, chat.tsx, the new tests,
    the new smoke script (gitignored).

---

## 8. UX

**Zero changes** to surfaces, copy, or prompts.

**Visible delta after this FEAT lands** — verb-prefix phrases now route
correctly on web. The user-reported bug ("add a task as test task, due
tomorrow" → polite refusal from `general_assistant`) goes away. The user
types the natural English they were already typing; the right skill picks
it up. That is the entire user-visible scope.

The disagreement-warn (condition 5) is a console-only signal; users never
see it.

---

## 9. Test strategy

### 9.1 Unit tests — new Step 1a

Per condition 9. All extend `src/modules/router.test.ts` using the
established fixture-skill helpers and `embedder: async () => null`
injection pattern.

### 9.2 Map coherence test

A single test that asserts `TRIAGE_INTENT_TO_SKILL` keys are a subset of
the `IntentType` union (compile-time via `keyof`-narrowed Partial). This
catches typos and intents-removed-from-the-union as build errors.

### 9.3 Cross-module integration test

One end-to-end test through `chat.tsx`-equivalent fixtures (or a new
dispatcher-level test) that:
- Stubs triage to return `{ legacyIntent: "task_create", ... }`;
- Calls `routeToSkill({ phrase, triageLegacyIntent: "task_create" })`
  with `embedder: async () => null`;
- Asserts `routingMethod === "triage_hint"`, `skillId === "task_management"`.

### 9.4 MANDATORY — Real-LLM smoke (binding per condition 10)

The 10/11-phrase live-proxy run with embedder disabled. This is the
artifact that proves the bug cannot recur on web. **Pass threshold:
10/11 strict.** If any phrase fails, do NOT mark Done; return to architect.

### 9.5 Regression — full existing suite

- All baseline tests pass unchanged.
- `npm run build:web` still exports.
- `setV4SkillsEnabled([])` still falls back to legacy on every phrase
  (the gate short-circuits before `routeToSkill` runs — verified by
  reading `v4Gate.ts:45`).

**Out of scope:** triage misclassification tests (separate concern);
multi-skill conflict resolution UI (out of scope per spec); headless
runner integration (future FEAT).

---

## 10. Pattern Learning

**FEAT066 codifies "use upstream classification before redoing the work"
as a future-proof pattern.**

When a downstream module (router) has access to a classification an
upstream module (triage) already produced, the downstream module should
**consult the upstream signal first** before running an independent
classifier. Three reasons:

1. **Quality.** The upstream classifier had access to context the
   downstream module doesn't (in this case, triage's data-volumes input,
   the conversation summary, the user's scope preferences). Re-deriving
   intent at the downstream layer throws away signal.
2. **Cost.** Re-deriving costs CPU/LLM calls. Triage already paid for the
   classification; the router is paying again to recompute it (embedding
   call, possibly Haiku tiebreaker).
3. **Coherence.** When two layers run independent classifiers, they can
   disagree. Disagreement is hard to debug because the user-visible
   symptom (wrong skill) doesn't surface either classifier's output. Using
   the upstream signal makes the router's choice traceable to triage's
   reasoning — one source of truth.

**Future routing layers** (mobile clients via FEAT044, headless runner,
future API endpoints, web embeddings via FEAT067) inherit this rule:
**any classification signal already computed upstream MUST be threaded
into the router as an optional `RouteInput` field**. The router consults
it before any independent inference. Independent inference remains the
fallback.

**Codification:** add an entry to AGENTS.md (low-priority — may roll into
the next docs-cleanup PR rather than this FEAT) under "Architecture
Rules":

> **Use upstream classification before redoing the work.** When a
> downstream module (router, dispatcher, executor) has access to a
> classification an upstream module (triage, parser, gate) already
> produced, plumb the upstream signal through and consult it first.
> Independent re-derivation is the *fallback*, not the *primary path*.
> See FEAT061 (state forwarding) and FEAT066 (intent forwarding) for
> the canonical shape.

**Carry-forward:**

- **Headless runner integration.** A follow-up FEAT threads the hint into
  `headless-runner.js`'s scheduled `routeToSkill` callers. Out of scope
  here per spec.
- **`okr_update` / `topic_query` / `topic_note` migrations.** Each future
  skill-migration FEAT adds its own `TRIAGE_INTENT_TO_SKILL` line as part
  of its scope. The map is the natural extension point.
- **WARN → throw downgrade.** Once the map has stabilized for one release
  cycle, the warn-once-on-missing-skill (condition 7) can downgrade to a
  hard-error at boot. Tracked as a follow-up.

---

## 11. Sign-off

Architect approves. Conditions §7 binding (14 items). Condition 10
(real-LLM smoke, 10/11 strict, embedder disabled) is **the parity-defining
artifact** — coder must run it before declaring Done.

**Pay special attention to:**

- **Condition 10 (binding smoke, embedder disabled).** This is the bug
  the FEAT exists to fix. Stub-LLM unit tests prove the new step *works*;
  only the embedder-disabled live proxy run proves the bug *cannot recur
  on web*. The smoke output goes into `FEAT066_test-results.md` verbatim.
- **Condition 4 (Step 1a position).** Step 1a goes BETWEEN Step 0
  (`directSkillId`) and Step 1 (structural match). It does NOT bypass
  Step 0 — `directSkillId` is the explicit caller signal and must keep
  winning when present.
- **Condition 6 (silent fall-through when skill disabled).** Do NOT add
  a warn here. The disabled-set is the rollout knob; rollback is
  intentional and routine. Warn would spam.
- **Condition 7 (warn-once cache).** Use a module-level `Set<string>`,
  reset via `_resetTriageHintWarnCacheForTests()`. Mirrors the existing
  `_resetOrchestratorForTests()` pattern at `router.ts:255`. The cache
  must be tested.
- **Condition 5 (disagreement-warn).** This is telemetry, not behavior.
  The triage pick still wins. The warn lets a future architect mine the
  log for triage-vs-manifest-trigger drift.
- **Condition 14 (no triage / dispatcher / skill changes).** This is
  strictly a router/types/chat-call-site fix. Resist the temptation to
  fix triage misclassifications or add new structural triggers in this
  FEAT — those are separate concerns.
- **§4 audit (`bulk_input` is dead from two directions).** Keep the map
  entry with the explanatory comment. The dead entry costs nothing and
  documents the intent.

This auto-advances to the coder. No further architect review required
unless the coder surfaces a condition-blocking finding during stage 5.
