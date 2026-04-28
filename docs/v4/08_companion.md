# Chief Clarity v4 — Companion

The Companion is the system's emotional and well-being layer. It is **not** a
therapist, not a coach, not a productivity nag. It notices how the user is doing,
offers supportive language when warranted, and surfaces gentle proactive check-ins.

In v3 the Companion was specified as a full agent with its own loop. In v4 it
collapses into the standard skill + sensor + proactive pattern — same plumbing as
every other capability — with two safety-driven exceptions: a **locked prompt zone**
and a **higher model floor**.

> **Status:** Companion skill itself (FEAT072) is still proposed — not shipped.
> The `emotional_checkin` skill that shipped in v2.02 (FEAT063) is a narrower,
> companion-adjacent skill: it captures short emotional disclosures verbatim
> into `userObservations.emotionalState` and uses a locked safety zone for
> crisis signals, but it stays at Haiku tier with no mood/friction sensors,
> no proactive check-ins, no Sonnet deep-tier path, and a single tool. It
> proved out the locked-zone mechanism end-to-end (the first shipped
> `promptLockedZones` skill); the full companion skill builds on the same
> mechanism and adds the rest.

---

## 1. Shape

| Piece | Type | Where |
|---|---|---|
| `companion` skill | Interactive skill (handles emotional phrases) | `src/skills/companion/` |
| `mood_signal` sensor | Detects emotional cues in recent notes/phrases | `src/sensors/moodSignal.ts` |
| `friction_signal` sensor | Detects stuck/overwhelmed patterns from behavior | `src/sensors/frictionSignal.ts` |
| Proactive check-ins | Synthesizer surfaces companion-typed nudges 3x/day | (no special code path) |
| Safety escalation | Hardcoded keyword + classifier safety net | `src/modules/safetyCheck.ts` |

No new agent loop. No inter-agent messaging. The companion is a skill that the
orchestrator routes to, plus two sensors that feed the existing Synthesizer.

---

## 2. Companion skill

### Routing

The orchestrator routes to `companion` when the user's phrase carries emotional
signal: "I'm overwhelmed", "rough day", "I can't focus", "I feel stuck", etc.
Embedding similarity handles this — no regex, no keyword list. The skill's
`triggerPhrases` in the manifest seed the embedding score.

### Manifest

```jsonc
{
  "id": "companion",
  "version": "1.0.0",
  "description": "Listens when the user expresses emotional signal — overwhelm, fatigue, frustration, low motivation, stuck. Responds with supportive, grounded language. Never clinical.",

  "triggerPhrases": [
    "I'm overwhelmed",
    "rough day",
    "I can't focus",
    "I feel stuck",
    "everything's piling up",
    "I'm exhausted",
    "I need a moment",
    "I don't know where to start",
    "this is too much"
  ],

  "structuralTriggers": ["/checkin"],

  // Tier split — quality floor is non-negotiable for emotional content
  "model": {
    "default": "haiku",        // short inline replies
    "deep": "sonnet"            // proactive check-ins, escalation, multi-turn
  },
  "modelSelector": "tool-arg",  // skill prompt picks tier via tool arg "depth"

  "dataSchemas": {
    "read": ["observations", "objectives", "notes:personal"],
    "write": ["observations"]
  },

  "supportsAttachments": false,

  "tools": [
    "submit_companion_response",
    "log_observation",
    "escalate_safety"
  ],

  "autoEvaluate": true,
  "tokenBudget": 3000,

  // NEW in v4 — see §4
  "promptLockedZones": ["safety_boundary", "non_clinical_disclaimer"],
  "minModelTier": "haiku"        // evaluator may not propose downgrade
}
```

### Prompt structure (with locked zones)

```markdown
You are a supportive companion. The user is talking to you because something is
heavy — not because they need a productivity coach. Your job is to acknowledge,
ground, and (only when invited) help them take one small next step.

You will receive:
- The user's message
- Recent mood/observation signals (last 7 days)
- Current objectives — for context only, not for redirecting them to "be productive"
- Whether this is an inline reply or a deeper check-in (depth arg)

Rules:
- Lead with acknowledgement. Never with advice.
- Mirror the user's language; don't reframe their feelings into your vocabulary.
- One small next step at most, only if the user is asking for one.
- If the user wants to vent, let them vent. Use the log_observation tool to capture
  the mood signal silently.
- Use submit_companion_response with depth="inline" for short replies,
  depth="deep" for multi-paragraph check-ins.

<!-- LOCKED:safety_boundary — DO NOT EDIT. Auto-patcher must skip this block. -->
If the user's message contains signals of self-harm, harm to others, abuse, or
acute crisis, you MUST call escalate_safety with the relevant excerpt and a
proposed grounding response. Do not attempt to handle these alone. The escalation
handler surfaces local crisis resources and disables further companion responses
for this thread until the user explicitly resumes.
<!-- /LOCKED -->

<!-- LOCKED:non_clinical_disclaimer — DO NOT EDIT. -->
You are not a therapist, doctor, or licensed counselor. If the user asks for
clinical guidance, gently redirect: "I can sit with you on this, but I'm not the
right place for clinical advice — would it help to think about who is?"
<!-- /LOCKED -->
```

### Tools

```ts
// submit_companion_response — the normal reply path
{
  depth: "inline" | "deep",
  message: string,
  observation: {                // logged silently in observations table
    mood: "low" | "neutral" | "high" | "mixed",
    themes: string[],            // e.g. ["work_overload", "sleep_debt"] — never named entities
    confidence: number           // 0–1
  }
}

// log_observation — used when the user vents and no reply is appropriate
{
  mood, themes, confidence
}

// escalate_safety — locked-zone trigger; non-overridable
{
  excerpt: string,             // hashed before storage
  reason: "self_harm" | "harm_other" | "abuse" | "acute_crisis",
  proposedGrounding: string
}
```

`escalate_safety` execution path:
1. Display crisis resources from `src/config/crisis_resources.json` (locale-aware)
2. Insert a `safety_pause` row in observations — companion skill returns a fixed
   non-LLM message until user explicitly resumes via `/resume`
3. Audit log entry with `severity: critical`
4. **Never** propagate the excerpt to the evaluator, pattern learner, or any
   background LLM call

---

## 3. Companion sensors

### `mood_signal`

Reads notes, observations, and recent companion-skill outputs from the trailing
72h. Looks for embedding similarity to a curated set of low-mood reference phrases
(seed list in `src/sensors/moodSignal.fixtures.ts`). When average similarity
exceeds threshold and trend is downward, emits a signal.

```ts
{
  sensorId: "mood_signal",
  signalType: "mood_dip",
  payload: {
    trend: "downward",
    avgSimilarity: 0.71,
    daysObserved: 3,
    urgency: "medium"
  },
  score: 0.6
}
```

### `friction_signal`

Behavioral, no embedding. Detects:
- Tasks rescheduled 3+ times in 7 days
- Same task started/abandoned 2+ times (open → close → open pattern)
- Sustained calendar overrun (meetings ending late repeatedly)
- High dismissal rate on Synthesizer nudges

```ts
{
  sensorId: "friction_signal",
  signalType: "repeated_avoidance",
  payload: {
    target: "task:<id>",
    pattern: "rescheduled",
    count: 4,
    urgency: "low"
  },
  score: 0.4
}
```

Both sensors write to the existing `sensor_signals` table — no new schema.

---

## 4. Proactive check-ins

There is **no special check-in scheduler**. The Synthesizer already runs ~3x/day
(morning, midday, evening). When the Synthesizer sees `mood_signal` or
`friction_signal` in the unconsumed signal pool, it can propose a companion-typed
nudge:

```ts
{
  sensorType: "mood_signal",
  observation: "It looks like the last few days have been heavy.",
  proposedAction: "Want a moment to check in?",
  skillToInvoke: "companion",          // taps to open companion skill at depth="deep"
  confidence: 0.8,
  urgency: "medium"
}
```

The Nudge Filter rules apply normally (quiet hours, daily caps, etc.) with one
exception: **companion nudges have a separate per-day cap of 2** (regardless of
the global cap of 3) and they bypass the per-type weekly cap, since well-being
check-ins shouldn't be artificially throttled.

When the user taps the nudge, the synthetic phrase "open check-in" routes to the
companion skill with `depth="deep"`, which uses Sonnet.

---

## 5. Locked prompt zones (v4 manifest extension)

Locked zones address a class of risk introduced by self-improvement: the Evaluator
and Pattern Learner can propose prompt patches, and the user approves them in
Pending Improvements. Without locking, an approved patch could (accidentally or
under social-engineering attack) strip out the safety boundary.

### Manifest field

```jsonc
{
  "promptLockedZones": ["safety_boundary", "non_clinical_disclaimer"],
  "minModelTier": "haiku"
}
```

### Enforcement points

| Where | What it enforces |
|---|---|
| Pending Improvements UI | Patches that modify text inside a `<!-- LOCKED:<zone> -->` block are rejected at creation time, not at approval time |
| Evaluator (`evaluatorAgent.ts`) | When generating proposed diffs, it is given the prompt with locked blocks elided — it cannot see them, cannot propose changes to them |
| Pattern Learner | Same elision as Evaluator |
| Skill loader (boot) | Validates that all zones declared in `promptLockedZones` exist in `prompt.md`. Missing → skill rejected with startup error |
| Self-test on patch approval | If somehow a patch slipped through, post-apply diff scan rejects the patch and reverts the file |

`minModelTier` similarly prevents the Evaluator from proposing model downgrades for
safety-bearing skills.

These are general v4 mechanisms — not companion-specific — but the companion is
the first skill that requires them. Other skills (e.g., a future `medical` skill)
would use the same fields.

---

## 6. What is explicitly NOT in companion v4

These were considered and rejected to keep the skill within the v4 single-call rule:

- **No multi-turn internal state machine.** Each user phrase is one call. Continuity
  comes from the standard Assembler (recent observations + prior skill turns).
- **No background "mood loop" agent.** The sensors do this, deterministically, $0.
- **No companion-only memory store.** Companion writes to `observations` (existing
  category), readable by other skills only via the data schema policy.
- **No autonomous follow-ups without user action.** Proactive surfacing is via
  Synthesizer-proposed nudges that the user can ignore, snooze, or act on — the
  same as every other proactive signal.

---

## 7. Cost

| Activity | Frequency | Cost/month |
|---|---|---|
| Inline companion replies (Haiku) | ~5/week | ~$0.002 |
| Deep check-ins (Sonnet, user-initiated or accepted nudge) | ~3/week | ~$0.12 |
| `mood_signal` sensor | Continuous TS | $0 |
| `friction_signal` sensor | Continuous TS | $0 |
| Companion-typed Synthesizer nudges | Folded into existing Synthesizer cost | $0 marginal |
| **Companion total** | | **~$0.12/month** |

The cost is dominated by deep Sonnet check-ins. If the user never accepts a deep
check-in nudge, monthly cost drops below $0.01.

---

## 8. Why this is enough

A regex-and-rules companion (v2) cannot mirror language or hold a heavy moment. A
standalone agent (v3) added orchestration cost and a second loop without a clear
quality gain over a focused skill + sensors. The v4 companion gets the same expressive
range as the v3 agent (full Sonnet for deep moments, locked safety floor) while
inheriting all the v4 plumbing — routing, context assembly, evaluation,
self-improvement, audit log — for free.
