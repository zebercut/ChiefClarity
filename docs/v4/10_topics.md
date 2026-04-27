# Chief Clarity v4 — Topics

A **topic** is a user-meaningful theme that aggregates everything related to one
thread of life or work — tasks, notes, events, facts, attachments. Examples:
"Job search", "House renovation", "Q3 product launch", "Kid A schooling".

Topics let the user navigate by theme instead of by data type. Instead of asking
the chat "what's happening with X?", they open the Topics surface, find X, and
see everything together: open tasks, recent notes, upcoming events, recorded
facts. This was already validated as valuable in v3 (FEAT023 reached Design
Reviewed) — v4 brings it up to first-class status.

In v4, Topics is the same shape as Companion: skill + sensor + cross-cutting
executor hook + UI surface. Same plumbing, no special casing.

---

## 1. Shape

| Piece | Type | Where |
|---|---|---|
| `topics` skill | Interactive skill (handles topic queries and digest requests) | `src/skills/topics/` |
| `TopicEmergence` sensor | Embedding-based clustering of recent items | `src/sensors/topicEmergence.ts` |
| Executor auto-tag hook | Cross-skill — when any write happens, similarity-match against existing topics | `src/modules/executor.ts` (extension) |
| Topics surface | Pluggable UI tab declared in the skill manifest | `src/skills/topics/ui/TopicsView.tsx` |
| `topics` data category | Data Schema Registry entry | `src/config/data_schemas.json` (see `03_memory_privacy.md §2`) |

No new agent loop. No multi-call pipelines. The skill handles user queries; the
sensor proposes new topics; the executor hook keeps existing topics current; the
surface renders what's there.

---

## 2. Data model

Reuses the existing v3 tables with one schema addition for confidence tracking
(needed for the auto-tag confirm-and-learn loop, §4).

```sql
-- Existing in v3 (keep as-is)
CREATE TABLE topics (
  id TEXT PRIMARY KEY,             -- slug, e.g. "job-search"
  name TEXT NOT NULL,              -- display name
  aliases TEXT NOT NULL,           -- JSON array of alt names
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE topic_signals (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  source_type TEXT NOT NULL,       -- "task" | "note" | "event" | "fact" | "attachment"
  source_id TEXT NOT NULL,
  confidence REAL,                 -- NEW in v4 — 0..1, set by auto-tag or 1.0 if user-confirmed
  source TEXT NOT NULL,            -- NEW in v4 — "user" | "auto" | "auto_confirmed"
  created_at TEXT NOT NULL,
  UNIQUE(topic_id, source_type, source_id)
);

CREATE TABLE topic_suggestions (   -- proposed but not yet accepted
  id TEXT PRIMARY KEY,
  proposed_name TEXT NOT NULL,
  cluster_size INTEGER NOT NULL,
  cluster_member_ids TEXT NOT NULL, -- JSON array
  emergence_signal_id TEXT,
  status TEXT NOT NULL,            -- "pending" | "accepted" | "rejected"
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE rejected_topics (     -- dedup against re-proposing the same cluster
  id TEXT PRIMARY KEY,
  rejected_name TEXT NOT NULL,
  cluster_signature TEXT NOT NULL, -- hash of member embeddings
  rejected_at TEXT NOT NULL
);
```

Topic membership is **flat**: there's one `topics` data category (per user
decision), not `topics:work` / `topics:personal`. A skill that can read topics
sees all of them.

---

## 3. The `topics` skill

### Routing

The orchestrator routes here when the user phrases something topic-scoped:
"how's the job search going?", "what's left on the renovation?", "summarize
[topic X]", "show me everything on [topic Y]".

### Manifest sketch

```jsonc
{
  "id": "topics",
  "version": "1.0.0",
  "description": "Topic-scoped queries and digests. Returns everything related to one theme — open tasks, recent notes, upcoming events, recorded facts — and a one-paragraph state-of-the-topic summary.",

  "triggerPhrases": [
    "how's [X] going",
    "what's left on [X]",
    "summarize [X]",
    "show me everything on [X]",
    "status of [X]",
    "where am I with [X]"
  ],

  "structuralTriggers": ["/topic", "/topics"],

  "model": "sonnet",

  "dataSchemas": {
    "read": ["tasks", "calendar", "notes:work", "notes:personal", "topics", "objectives"],
    "write": ["topics"]
  },

  "supportsAttachments": false,
  "tools": ["submit_topic_digest", "create_topic", "merge_topics", "archive_topic"],
  "autoEvaluate": true,
  "tokenBudget": 4000,
  "promptLockedZones": [],

  "surface": {
    "id": "topics",
    "label": "Topics",
    "icon": "tag",
    "route": "/topics",
    "component": "ui/TopicsView.tsx",
    "order": 50
  }
}
```

### Tools

```ts
// submit_topic_digest — main reply path
{
  topicId: string,
  summary: string,             // 1-paragraph state-of-the-topic
  openTasks: TaskRef[],         // ids only — UI fetches details
  recentNotes: NoteRef[],
  upcomingEvents: EventRef[],
  keyFacts: FactRef[],
  suggestedNextStep: string | null
}

// create_topic — when user says "make a topic for X"
{ name: string, aliases: string[], seedItemIds: ItemRef[] }

// merge_topics — when user disambiguates duplicate topics
{ targetId: string, sourceIds: string[] }

// archive_topic — soft-delete
{ topicId: string, reason: string }
```

The skill never fetches topic data directly — the Assembler does, via the
`topics` data category, filtered by the topic id parsed from the user's phrase
or passed as a structural trigger argument.

---

## 4. Executor auto-tag hook (confirm-and-learn)

When any skill writes a new task, note, event, or fact, the executor checks for
topic affinity. Per user decision: **ask and learn**, do not silently auto-tag.

### Flow

```
1. Skill handler returns a new item (task/note/event/fact) → Executor about to write
2. Executor computes embedding for the item content
3. Executor compares against all active topic centroids
4. Tiered behavior:
     similarity > 0.85 → write WITH suggested topic, surface a one-tap confirm in chat
                          ("Tagged this to [Job search] — undo?")
                          On confirm: source="auto_confirmed", confidence=1.0
                          On undo:    source removed, recorded as negative example
     0.65 ≤ sim ≤ 0.85 → write WITHOUT topic, surface a one-tap proposal
                          ("This looks related to [Renovation]. Tag it?")
                          On accept: source="user", confidence=1.0
                          On dismiss: nothing recorded as negative (low signal)
     similarity < 0.65 → write WITHOUT topic, no prompt
5. If multiple topics tie within 0.05 of each other → propose a chooser (max 3)
```

### Learning

A per-user threshold table shifts the bands over time based on accept/reject
ratios. Stored in `user_profile` KV (existing table):

```jsonc
{
  "topicAutoTag": {
    "autoConfirmThreshold": 0.85,   // tighten if undo rate > 20%; loosen if accept rate > 90%
    "proposeThreshold": 0.65,       // same logic
    "lastTuned": "2026-04-26T..."
  }
}
```

Tuning runs weekly inside the Pattern Learner (`05_proactive_intelligence.md §6`).
This is the "learn" half of "ask and learn". Pattern Learner proposes the
threshold change; the user approves via Pending Improvements.

### Why not silent auto-tag

A wrong tag pollutes the topics surface and the user has to manually clean up.
The cost of one extra tap on a confirmation is much lower than the cost of a
wrong tag persisting and infecting the topic digest. The bands let high-confidence
matches get the lightest possible UI (a "tagged — undo?" toast), so the friction
is real but small.

---

## 5. TopicEmergence sensor

**File:** `src/sensors/topicEmergence.ts`
**Type:** TypeScript, periodic, $0
**Replaces:** v3's `topic_auto_promotion` background detector (FEAT024 in old plan)

### Algorithm

```
Every 6 hours:
  1. Pull all items written in trailing 14 days that have NO topic tag
     and were not auto-tag-rejected
  2. Embed each (most are already embedded — reuse from embeddings table)
  3. Run lightweight clustering (DBSCAN with embedding distance) — 
     min cluster size: 5, eps: 0.25
  4. For each cluster:
       a. Check rejected_topics table — if cluster_signature already rejected,
          skip (don't re-propose)
       b. Generate proposed name (LLM-free: most common noun phrase via tf-idf
          across cluster members; if low confidence, leave blank — user names it)
       c. Emit signal:
          { sensorType: "topic_emergence",
            payload: { proposedName, clusterSize, memberIds, signature },
            score: clamp(clusterSize / 20, 0, 1) }
```

### Synthesizer behavior

When the Synthesizer sees a `topic_emergence` signal, it proposes a nudge:

```
"I noticed 6 tasks and notes about [renovation] this week.
 Want to make it a topic so you can track it together?"
 → tap "Yes, name it [renovation]"  → invokes topics skill: create_topic
 → tap "Pick a different name"      → invokes topics skill with a name prompt
 → tap "Not a topic"                → records rejected_topics row
```

**Cap:** Max 1 topic-emergence nudge per week (avoids overwhelming the user
when many threads are emerging at once).

---

## 6. Topics surface

A standard React view rendered into the slot reserved by the skill manifest's
`surface` field. The shell doesn't know what Topics is — it just renders the
component the skill points at.

The view shows:
- Search/filter bar across topics
- One card per topic with: name, item count, last activity, open task count
- Tap a topic → topic detail view: digest summary, item lists by type, action menu
- "+ New topic" → opens topics skill with `/topic new`
- Pending suggestions (from TopicEmergence) shown as a banner at top

Read paths use the topics data category. Writes (create / merge / archive) go
through the topics skill, not from the surface directly — the surface emits a
synthetic phrase to the orchestrator, the skill handles it. This keeps the
sacred boundary intact.

---

## 7. What changes vs. v3

| Aspect | v3 (today) | v4 |
|---|---|---|
| Topic queries | Hardcoded handlers in `topicManager.ts` + intent branches | `topics` skill — one prompt, one Sonnet call |
| Auto-promotion | Background TS scan with hardcoded thresholds | `TopicEmergence` sensor → Synthesizer proposes nudge |
| Item → topic linking | Per-intent code calls `recordSignal` from a few places | Universal executor hook, runs from any skill that writes items |
| Topics tab | Hardcoded into shell navigation | Declared in `topics` skill manifest, registered at boot |
| Privacy | No category — implicit access everywhere | `topics` is a data category in the schema registry |
| Auto-tag confidence | Single threshold | Tiered (auto-confirm / propose / silent) with per-user learned thresholds |

The net effect: Topics gets the same plug-in shape as every other v4 capability,
deletes about half of `topicManager.ts`'s ad-hoc routing code, and gains learned
auto-tagging.

---

## 8. Migration plan

Lives in `09_dev_plan.md` Phase 2. In summary:

1. Create `src/skills/topics/` skill (FEAT083) — declares the surface
2. Add executor auto-tag hook with confirm-and-learn (FEAT084)
3. Move topic data access through the schema registry (folds into FEAT055 in Phase 3)
4. Build TopicEmergence sensor (rewrites FEAT024) — ships in Phase 5
5. Once parity confirmed, delete the old per-intent topic branches in router/assembler/executor

The v3 `topicManager.ts` shrinks to a pure data-access library — slug, file IO,
embedding cross-ref. All the routing and decision logic moves out to the skill,
sensor, and executor hook.

---

## 9. Cost

| Activity | Frequency | Cost/month |
|---|---|---|
| Topic skill replies (Sonnet, user-initiated) | ~5/week | ~$0.20 |
| TopicEmergence sensor | Continuous TS | $0 |
| Executor auto-tag hook (TS embedding compare) | Per write | $0 |
| Synthesizer-surfaced topic-emergence nudges | Folded into Synthesizer cost | $0 marginal |
| **Topics total** | | **~$0.20/month** |

---

## 10. What is explicitly NOT in Topics v4

- **No topic-internal LLM reasoning loop.** The skill is one Sonnet call per
  user phrase. It does not chat with itself across multiple calls to enrich a
  digest.
- **No topic-to-topic relationship graph.** A topic has items; items don't have
  inter-topic links. If the user wants this later, it's a separate feature.
- **No auto-topic-creation without user confirmation.** Even at very high
  emergence scores, the user always names and confirms a new topic. The system
  proposes; the user decides.
- **No topic-scoped sub-prompts to other skills.** A topics digest does not
  invoke daily_planning to re-rank tasks. Cross-skill calls violate ADR-001.
