# Chief Clarity v4 — Proactive Intelligence

The system observes, learns, anticipates, and proposes — without the user asking.
This is the differentiator. It runs entirely in the background, costs ~$0.02/month,
and improves over time by learning which nudges this specific user finds valuable.

---

## Architecture overview

```
[Continuous, TypeScript, $0]
Signal Sensors
  → raw signals → sensor_signals table
          │
          ▼
[Scheduled ~3x/day, ONE Haiku call per run]
Signal Synthesizer
  → ranked nudge proposals
          │
          ▼
[TypeScript, $0]
Nudge Filter
  → filtered, de-duped, channel-routed nudges
          │
          ▼
User surface (chat / notification / morning brief)
          │
          ▼
[TypeScript, $0]
Response Tracker → nudge outcome → nudges table
          │
          ▼
[Weekly Haiku, one call]
Pattern Learner
  → proposes sensor tuning / new sensors → Pending Improvements
```

---

## 1. Signal Sensors

**Location:** `src/sensors/`  
**Type:** TypeScript, continuous, $0  
**Pattern:** Pluggable folder (same as skills — drop a file, register, done)

Each sensor watches a specific pattern and writes to the `sensor_signals` table when
it detects something worth surfacing. Sensors never call the LLM. They never notify
the user directly. They only produce signals.

### Sensor catalog

| Sensor | File | What it detects |
|---|---|---|
| **RecencyWatcher** | `recencyWatcher.ts` | Time since last interaction with each person, project, or topic exceeds per-entity baseline |
| **FrequencyDrift** | `frequencyDrift.ts` | Activity rate for a category (meetings, tasks completed, family time) diverging from the user's own baseline |
| **ObjectiveProgress** | `objectiveProgress.ts` | No movement on a stated objective for N days; at-risk milestones |
| **LoadDensity** | `loadDensity.ts` | Calendar + task density spiking above sustainable threshold (user-calibrated) |
| **DependencyChain** | `dependencyChain.ts` | Task A is blocking 1+ tasks and is overdue or has no due date |
| **RepetitionDetector** | `repetitionDetector.ts` | Similar tasks or notes clustered by embedding similarity — possible hidden project or recurring problem |
| **DeadlineApproach** | `deadlineApproach.ts` | Task or event approaching deadline with no recent activity |
| **ConflictPredictor** | `conflictPredictor.ts` | Tight transitions in tomorrow's schedule (time + geography) |
| **TopicDrift** | `topicDrift.ts` | Semantic shift in user's recent notes/conversations compared to prior period |
| **CommitmentTracker** | `commitmentTracker.ts` | Phrases like "I'll do X" or "I'll reply by Y" detected in past chat with no follow-through |
| **EnergyPattern** | `energyPattern.ts` | User's historically productive time windows vs. current scheduling (meetings stacking at high-energy times) |
| **MoodSignal** | `moodSignal.ts` | Embedding-based detection of low-mood themes in recent notes/companion turns over trailing 72h (feeds companion check-ins) — see `08_companion.md` |
| **FrictionSignal** | `frictionSignal.ts` | Behavioral detection: tasks rescheduled 3+ times, repeated start/abandon, sustained calendar overrun (feeds companion check-ins) — see `08_companion.md` |
| **TopicEmergence** | `topicEmergence.ts` | Embedding-based clustering of recent tasks/notes/events; emits a signal when 5+ items cluster around a theme that isn't already a topic. Synthesizer turns this into a "make a topic?" nudge — see `10_topics.md` |

### Sensor signal format

```ts
{
  id: string;
  sensorId: string;
  signalType: string;           // e.g. "recency_gap", "deadline_approaching"
  payload: {
    entity?: string;            // person, project, or task id (no real names in code)
    metric?: number;            // e.g. days since last contact
    threshold?: number;         // the threshold that was breached
    urgency: "low" | "medium" | "high";
  };
  score: number;                // 0–1 severity
  createdAt: string;
  consumedAt: string | null;    // set when Synthesizer processes
}
```

### Adding a new sensor

Drop a file in `src/sensors/<sensor-id>.ts`. It exports:

```ts
export const sensorId = "commitment_tracker";

// Called on a trigger (data write event or scheduled tick)
export async function run(db: Database): Promise<SensorSignal[]> {
  // query db, detect pattern, return signals (or empty array)
}

// How often to run (minimum interval — headless runner may call more often)
export const intervalMs = 15 * 60 * 1000; // 15 minutes
```

Register in `src/sensors/index.ts`. No other changes.

---

## 2. Signal Synthesizer

**File:** `src/modules/proactiveSynthesizer.ts`  
**Schedule:** ~3x/day (morning, midday, evening) + on-demand after major events  
**Cost:** One Haiku call per run, ~2000 tokens input, ~500 output ≈ $0.0003/run

The Synthesizer takes all unconsumed sensor signals and decides what is worth
surfacing to the user right now. This is the intelligence layer — it reasons about
context, timing, and what this user has responded to before.

### Synthesizer input

```ts
{
  unconsumedSignals: SensorSignal[];     // from sensor_signals table
  userObjectives: Objective[];           // cached
  recentDiaryNarrative: string;         // last 2 diary entries (context)
  recentNudgeHistory: NudgeSummary[];   // what was surfaced, how user responded
  userPreferences: {
    quietHours: { start: string; end: string };
    maxNudgesPerDay: number;
    mutedCategories: string[];
  };
  currentTime: string;
  currentDayOfWeek: string;
}
```

### Synthesizer output (structured tool call)

```ts
[
  {
    sensorType: "commitment_tracker",
    observation: "You mentioned replying to a proposal by Friday — tomorrow.",
    proposedAction: "Draft a reply now, or snooze this reminder?",
    skillToInvoke: "email_drafting",
    confidence: 0.92,
    urgency: "high",
    suppressIfActedOn: ["task:proposal_reply_done"]
  },
  {
    sensorType: "load_density",
    observation: "Next week has twice your usual meeting load. Want to review what can move?",
    proposedAction: "review_calendar",
    skillToInvoke: "calendar",
    confidence: 0.78,
    urgency: "medium"
  }
]
```

The Synthesizer is instructed to:
- Surface at most 3 nudges per run
- Prioritize urgency + relevance to current objectives
- Suppress signals the user has already dismissed twice in the last 14 days
- Frame suggestions as observations ("I noticed..."), never commands
- Never surface sensitive categories (medical, financial) unless user explicitly granted

---

## 3. Nudge Filter

**File:** `src/modules/nudgeFilter.ts`  
**Type:** TypeScript, $0

Final gate before nudges reach the user. Applies:

| Rule | Logic |
|---|---|
| Quiet hours | Suppress if current time is in user's quiet window |
| Daily frequency cap | Max N nudges per day (default: 3); high-urgency exempted |
| Per-type weekly cap | Max 1 nudge of same type per week (prevents repetition) |
| Mute rules | User muted this sensor category → suppress for mute duration |
| De-duplication | Same observation surfaced in last 48h → suppress |
| Deadline exemption | `urgency: "high"` with type "deadline" or "conflict_predictor" bypasses quiet hours and caps |
| Companion exemption | `skillToInvoke: "companion"` nudges have a separate per-day cap of 2 and bypass the per-type weekly cap (well-being shouldn't be throttled by repetition rules) — see `08_companion.md` §4 |

Output: filtered, channel-routed nudge list.

Channel routing:
- `urgency: high` → push notification + chat
- `urgency: medium` → chat sidebar or morning brief
- `urgency: low` → morning brief only

---

## 4. Nudge Memory & Personalization Loop

**Table:** `nudges`  
**Type:** TypeScript response tracking, $0

Every surfaced nudge is logged. The user's response is captured:

| Response | Signal | Effect on future |
|---|---|---|
| Acted on (tapped action) | Strong positive | Boost similar nudges |
| Snoozed | Mild negative | Delay same nudge 48h |
| Dismissed | Negative | Lower priority for this type |
| Marked "not useful" | Strong negative | Suppress this type for 14 days |
| Ignored (no action in 4h) | Mild negative | No boost |

These response signals feed the Pattern Learner weekly and inform the Synthesizer's
ranking on the next run (via recentNudgeHistory in its input).

Over weeks, the system learns:
- Which sensors produce useful signals for this user
- Which urgency thresholds are calibrated correctly
- Which times of day the user responds best to nudges
- Which categories to deprioritize or mute

---

## 5. Proactive → action handoff

When a nudge proposes an action and the user taps "yes" (or types a confirming reply):

```
User taps "Draft the reply" on a commitment_tracker nudge
  → synthetic phrase: "draft reply to proposal"
  → enters normal Orchestrator flow
  → ONE LLM call to email_drafting skill with context
  → response with draft
```

Proactive layer proposes. Interactive layer executes. Clean separation. No special
code path — the action is a normal user phrase.

---

## 6. Pattern Learner

**File:** `src/modules/patternLearner.ts`  
**Schedule:** Weekly (Sunday night or configurable)  
**Cost:** One Haiku call, ~3000 tokens ≈ $0.001/week

Reviews nudge history + action history for the past 7 days. Proposes:

- **Sensor tuning:** "RecencyWatcher threshold for colleagues should be 14 days for
  this user, not 30 — they've acted on 0 of 5 nudges at the 30-day mark."
- **New sensor stubs:** "User asks about energy patterns 3x this week but no sensor
  covers it. Suggested new sensor: ProductivityWindowSensor."
- **Synthesizer prompt patches:** "User prefers observation framing over directive —
  adjust Synthesizer to avoid imperative phrasing."
- **Auto-mute proposals:** "User dismissed all LoadDensity nudges 6 times — propose
  muting this sensor for this user."

All proposals go to Pending Improvements. User approves or rejects with one tap.
Sensor stubs are code scaffolds — they require the developer to implement the logic
before activation. This keeps the Pattern Learner within the "propose, don't deploy"
boundary.

---

## 7. Cost summary

| Activity | Frequency | Tokens/run | Cost/month |
|---|---|---|---|
| Signal Sensors | Continuous | 0 | $0 |
| Signal Synthesizer | ~3x/day | ~2500 | ~$0.018 |
| Pattern Learner | Weekly | ~3000 | ~$0.004 |
| Nudge Filter / Tracker | Continuous | 0 | $0 |
| **Total** | | | **~$0.022/month** |

---

## 8. Intelligence categories this enables

| Category | Example observation |
|---|---|
| Recency / Connection | "You haven't connected with Contact A in 3 weeks." |
| Drift / Anomaly | "Your meeting load this week is 2x your baseline." |
| Progress / Gaps | "No progress on Objective X in 14 days." |
| Load / Sustainability | "Tomorrow has 8 back-to-back items — no buffer." |
| Dependencies | "Task B is blocking 3 others and has no due date." |
| Hidden Projects | "5 similar tasks this month — is there a project here?" |
| Forgotten Commitments | "You said you'd follow up with Contact B by Friday." |
| Calendar Risk | "9am meeting followed immediately by a 30-min drive." |
| Topic Drift | "Your notes have shifted toward Topic Z this month — intentional?" |
| Energy Patterns | "Your most productive windows are being filled with low-priority meetings." |
