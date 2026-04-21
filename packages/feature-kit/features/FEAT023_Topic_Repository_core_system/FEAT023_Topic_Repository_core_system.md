# FEAT023 — Topic Repository core system

**Status:** Design Reviewed
**MoSCoW:** MUST
**Category:** Data
**Priority:** 2  
**Release:** v2.1  
**Tags:** topics, knowledge, notes, planning, ui  
**Created:** 2026-04-05

---

## Problem Statement

Today, general notes go into context_memory.facts as unstructured strings with no grouping. When a user asks "tell me everything about X", the system has no way to quickly retrieve all related information — it's scattered across flat fact lists with no topic organization. Additionally, the daily planning intent has zero topic awareness — it schedules tasks and events without grouping them by theme, making it harder for the user to see the big picture. There is also no dedicated UI for browsing, searching, and managing topics.

---

## Goals

1. Organize knowledge by named topics with aliases and notes
2. Automatically detect recurring themes and suggest topic creation
3. Group tasks, events, and notes by topic during daily planning so the user sees thematic clusters
4. Provide a dedicated Topics page for browsing, searching, and drilling into topic details
5. Keep topic pages (markdown files) up to date with structured dashboards showing related items

---

## Success Metrics

- Topics created: user has 3+ active topics within first 2 weeks of use
- Topic coverage: 60%+ of active tasks are associated with at least one topic via signals or name matching
- Topic page engagement: user visits the Topics page at least once per planning session
- Daily plan topic digest: when topics exist with related items, the focus brief includes a `topicDigest` section

---

## User Stories

### Story 1: Create a topic
**As a** user, **I want** to say "create a topic for kids", **so that** future notes about kids are organized in one place.

**Acceptance Criteria:**
- [x] Topic entry created in topics manifest (DB)
- [x] Topic markdown file created on first note

### Story 2: Add a note to a topic
**As a** user, **I want** to say "note for kids: soccer moved to Thursdays", **so that** the note is appended to the kids topic file.

**Acceptance Criteria:**
- [x] Note appended under today's date heading in topics/{slug}.md
- [x] If topic doesn't exist, fact stored in context_memory with topic hint

### Story 3: Query a topic
**As a** user, **I want** to say "tell me everything about kids", **so that** the LLM reads the topic file and summarizes it.

**Acceptance Criteria:**
- [x] Assembler reads topic file content and includes it in LLM context
- [x] LLM summarizes topic content + related tagged facts + relevant tasks

### Story 4: Topic suggestion
**As a** user, **I want** the system to notice when I've mentioned "health" in 3+ facts, **so that** it suggests creating a health topic.

**Acceptance Criteria:**
- [x] Suggestion counting runs after every write
- [x] Pending suggestions surfaced to LLM in topic_note context
- [x] User can accept (creates topic + migrates facts), reject (never ask again), or defer (raise threshold by 3)

### Story 5: Topic-aware daily planning
**As a** user, **I want** my daily plan to group related tasks and events by topic, **so that** I can see thematic clusters (e.g., all job-search items together) instead of a flat list.

**Acceptance Criteria:**
- [ ] Given a user with 2+ registered topics and active tasks/events related to those topics, when the user says "plan my day", then the focus brief includes a `topicDigest` array grouping items by topic
- [ ] Given a task whose title contains a topic name or alias (e.g., task "Prepare for Example Corp interview" and topic "Job Search" with alias "interview"), then that task appears in the topic's digest even if no signal was previously recorded
- [ ] Given a task linked to a topic that also has an `okrLink`, then the topic digest entry includes an `okrConnection` field naming the objective and key result
- [ ] Given related items within a topic cluster, when the LLM detects a meaningful connection (e.g., two deadlines in the same week), then the digest entry includes a `newInsights` field with a one-sentence insight
- [ ] Given a user with no registered topics, when the user says "plan my day", then no `topicDigest` field is emitted and the plan functions identically to before
- [ ] Each topic digest item contains human-readable one-liner descriptions of items (not raw IDs)
- [ ] Items belonging to multiple topics appear in each relevant topic's digest entry

### Story 6: Topic page updates from daily planning
**As a** user, **I want** each topic's markdown file to be automatically updated after daily planning, **so that** the topic page always shows current related tasks, events, OKR connections, and insights.

**Acceptance Criteria:**
- [ ] After a focus brief is generated, for each topic in the `topicDigest`, the corresponding `topics/{slug}.md` file is updated with a structured Dashboard section
- [ ] The Dashboard section contains: Active Tasks (title, due, priority, status), Upcoming Events (title, datetime, duration), OKR Connection (objective and KR names with progress), and Insights (from `newInsights`)
- [ ] The Dashboard section is regenerated on every plan (not appended), so it always reflects current state
- [ ] The Notes section (user-written notes with date headings) is preserved and never overwritten by the Dashboard update
- [ ] On replan (same day), the Dashboard updates without duplicating notes or corrupting the file structure

### Story 7: Topics page — list view
**As a** user, **I want** a dedicated Topics page accessible from the left sidebar, **so that** I can browse all my topics at a glance.

**Acceptance Criteria:**
- [ ] A "Topics" entry appears in the left sidebar (desktop) and bottom tab bar (mobile) with a book emoji icon
- [ ] The page displays all registered topics as cards, each showing: topic name, stats (task count, event count, signal count), last activity date, and priority breakdown pills
- [ ] Topics are sorted by last activity (most recent first)
- [ ] A search input filters topics by name and aliases (client-side, instant)
- [ ] When more than 10 topics exist, only the first 10 are shown with a "Show N more" button
- [ ] Pending topic suggestions appear in a collapsible section above the topic list, each with Create, Dismiss, and Later actions
- [ ] When no topics exist, an empty state is shown with an explanation and example phrases that navigate to chat when tapped

### Story 8: Topics page — detail view
**As a** user, **I want** to tap a topic card to see a full detail page, **so that** I can see all related tasks, events, OKR connections, insights, notes, and activity in one place.

**Acceptance Criteria:**
- [ ] Tapping a topic card navigates to a detail page showing the topic name, aliases, and creation date in the header
- [ ] The detail page has a back arrow that returns to the topic list
- [ ] An "Active Tasks" section lists all tasks related to this topic (via signals + name matching), each showing title, due date, priority pill, and status — tapping a task navigates to the Tasks tab
- [ ] An "Upcoming Events" section lists related calendar events with title, datetime, duration, and flexibility — tapping an event navigates to the Focus tab
- [ ] An "OKR Connection" section shows linked objectives and key results with activity and outcome progress bars (only shown if related tasks have `okrLink`)
- [ ] An "Insights" section shows the latest LLM-generated insight from the most recent daily plan (if available), with a timestamp
- [ ] A "Notes" section shows the user's notes from the topic markdown file, grouped by date heading (newest first), with a "Show older notes" expander
- [ ] An "Activity" section shows signal count breakdown and a simple activity bar
- [ ] An "Add Note" button opens a text input that appends a note to the topic file under today's date
- [ ] On mobile (< 900px width), the detail page renders as a full-screen drill-down; on desktop, it replaces the list content

---

## Workflow

### Topic core (Stories 1-4, implemented)
```
User says note/fact
  -> Router classifies intent (topic_note or general/bulk_input)
  -> LLM assigns topic hint to fact (reuses existing hints)
  -> Executor writes to topic file (if topic exists) or context_memory (with hint)
  -> updateSuggestions() counts hints, promotes to "pending" at threshold
  -> Next interaction: LLM mentions pending suggestion
  -> User accepts/rejects/defers
```

### Topic-aware planning (Stories 5-6, new)
```
User says "plan my day"
  -> Router classifies: full_planning
  -> Assembler builds topicCrossRef:
     1. Reverse-index manifest.signals -> Map<sourceId, Set<topicSlug>>
     2. Name-match task/event titles against topic names + aliases
     3. Build TopicCrossRef[] with taskIds, eventIds, okrLinks per topic
  -> Assembler injects topicCrossRef + topicList into LLM context
  -> LLM generates focusBrief with topicDigest[]
  -> Executor saves focusBrief to state
  -> Executor calls updateTopicPagesFromBrief():
     1. For each topicDigest item, read topics/{slug}.md
     2. Rebuild Dashboard section from state (tasks, events, OKR, insights)
     3. Preserve Notes section
     4. Write updated file
```

### Topics page (Stories 7-8, new)
```
User taps "Topics" in sidebar
  -> topics.tsx loads state.topicManifest
  -> Computes stats per topic (cross-ref signals + name matching against tasks/events)
  -> Renders topic cards sorted by last activity
  -> User taps a card -> navigates to topic-detail view
  -> Detail view reads topic markdown file + queries state for tasks/events/OKR
  -> All sections rendered client-side from live state
```

---

## Architecture Notes

### New types
- `TopicCrossRef { topic, name, taskIds[], eventIds[], okrLinks[] }` — assembler → LLM context
- `TopicDigestItem { topic, name, items[], okrConnection?, newInsights? }` — LLM → focusBrief output

### Extended types
- `FocusBrief` — add optional `topicDigest: TopicDigestItem[]`

### Existing types (no changes)
- `Fact { text, topic, date }` — structured fact with soft topic hint
- `TopicEntry { id, name, aliases, createdAt }` — active topic
- `TopicSuggestion { topic, count, threshold, status }` — pending/accumulating/deferred
- `TopicManifest { topics[], pendingSuggestions[], rejectedTopics[], signals[] }`

### Existing data files (no changes)
- `topics/{slug}.md` — per-topic markdown file (format extended with Dashboard section)

### Existing module
- `topicManager.ts` — slug generation, file read/write, hint extraction, suggestion counting, fact migration

### New module functions (topicManager.ts)
- `buildTopicCrossRef(manifest, tasks, events)` — builds signal + name-match cross-reference
- `updateTopicPagesFromBrief(briefData, state)` — rebuilds Dashboard section in topic files

### New UI files
- `app/(tabs)/topics.tsx` — Topics list page
- `app/(tabs)/topic-detail.tsx` — Topic detail page (or nested route)
- `src/components/topics/TopicCard.tsx` — List card component
- `src/components/topics/TopicSuggestionCard.tsx` — Suggestion card component
- `src/components/topics/TopicDetailSections.tsx` — Detail page section components

---

## Implementation Notes

### Stories 1-4 (completed)

| File | Change |
|------|--------|
| `src/types/index.ts` | Added Fact, TopicEntry, TopicSuggestion, TopicManifest; extended FileKey, AppState, IntentType, Summaries, ActionItem |
| `src/modules/topicManager.ts` | NEW — slugify, read/write topic files, hints, suggestions, migration |
| `src/modules/loader.ts` | Added topicManifest to FILE_MAP + defaults; fact normalization on load |
| `src/modules/router.ts` | Added topic_query/topic_note patterns, budgets, valid intents, Haiku prompt |
| `src/modules/assembler.ts` | Made async; added topicList + existingTopicHints to base context; topic_query/topic_note cases |
| `src/modules/executor.ts` | Made applyAdd async; topicManifest handler; contextMemory structured facts; post-write suggestions |
| `src/modules/llm.ts` | Added topicManifest to file enum + token budgets |
| `src/constants/prompts.ts` | Added Topics section; updated fact format instructions |
| `src/modules/summarizer.ts` | Topic summary + fact topic-tagged count |
| `src/utils/validation.ts` | Added topicManifest to valid keys + topic to action item types |
| `app/(tabs)/chat.tsx` | await assembleContext |
| `src/modules/inbox.ts` | await assembleContext |

### Stories 5-6 (topic-aware planning)

| File | Change |
|------|--------|
| `src/types/index.ts` | Add TopicCrossRef, TopicDigestItem interfaces; extend FocusBrief with topicDigest |
| `src/modules/topicManager.ts` | Add buildTopicCrossRef(), updateTopicPagesFromBrief() |
| `src/modules/assembler.ts` | Add topicList + topicCrossRef to full_planning case; add topicCrossRef to truncatableKeys |
| `src/constants/prompts.ts` | Add Topic Digest instructions to full_planning system prompt |
| `src/modules/executor.ts` | Call updateTopicPagesFromBrief() after focusBrief write |
| `src/modules/briefRenderer.ts` | Add Topics section to HTML output |

### Stories 7-8 (Topics page)

| File | Change |
|------|--------|
| `app/(tabs)/topics.tsx` | NEW — Topics list page |
| `app/(tabs)/topic-detail.tsx` | NEW — Topic detail page |
| `src/components/topics/TopicCard.tsx` | NEW — Topic list card |
| `src/components/topics/TopicSuggestionCard.tsx` | NEW — Suggestion card with actions |
| `src/components/topics/TopicDetailSections.tsx` | NEW — Detail sections (Tasks, Events, OKR, Insights, Notes, Activity) |
| `app/(tabs)/_layout.tsx` | Add Topics to NAV_ITEMS |
| `src/modules/topicManager.ts` | Add getTopicStats(), getTopicTasks(), getTopicEvents(), getTopicOkrLinks() helpers |

---

## Architecture Notes

### Data Models

| Entity | Storage | Key fields |
|--------|---------|------------|
| TopicEntry | DB `topics` + manifest JSON | id (slug), name, aliases[], createdAt |
| TopicSuggestion | DB `topic_suggestions` + manifest JSON | topic, count, threshold, status |
| TopicSignal | DB `topic_signals` + manifest JSON | topic, sourceType, sourceId, date |
| TopicManifest | AppState (flushed to DB/file) | topics[], pendingSuggestions[], rejectedTopics[], signals[] |
| TopicCrossRef | Computed in-memory (not persisted) | topic, name, taskIds[], eventIds[], okrLinks[] |
| TopicDigestItem | Persisted inside FocusBrief | topic, name, items[], okrConnection?, newInsights? |
| Topic Dashboard | topics/{slug}.md | Regenerated per plan; Notes section preserved |

### Service Dependencies

| Dependency | Purpose | Risk |
|------------|---------|------|
| topicManager.ts | Cross-ref builder, topic page updater | Must not throw in planning path — wrapped in try-catch |
| assembler.ts | Injects topic context into full_planning | Token budget — topicCrossRef is truncatable |
| executor.ts | Triggers topic page update post-brief | Non-blocking side effect |
| filesystem.ts | Reads/writes topic markdown files | Platform-aware (Node/Web/Capacitor) |
| briefRenderer.ts | Renders topicDigest in HTML | XSS-safe via esc() |

No new third-party dependencies. No new API endpoints. No new database tables.

### Design Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| Signal-based reverse index | buildTopicCrossRef() | O(n) lookup of topic→item relationships |
| Name matching fallback | buildTopicCrossRef() | Catches items not yet tagged with signals |
| Dashboard regeneration | updateTopicPagesFromBrief() | Always-fresh; avoids stale data accumulation |
| Notes preservation | updateTopicPagesFromBrief() | User content is sacred; Dashboard is system-generated |
| Budget-safe truncation | enforceBudget() | topicCrossRef in truncatableKeys — degrades gracefully |
| Non-blocking side effect | executor try-catch | Topic file writes can't break daily planning |

### New vs Reusable Components

**New:**
- `app/(tabs)/topics.tsx` — Topics list page
- `app/(tabs)/topic-detail.tsx` — Topic detail page
- `src/components/topics/TopicCard.tsx` — Topic list card
- `src/components/topics/TopicSuggestionCard.tsx` — Suggestion card
- `buildTopicCrossRef()` — signal + name-match cross-reference builder
- `updateTopicPagesFromBrief()` — deterministic topic page Dashboard updater

**Reusable (no changes):**
- `topicManager.ts` — slug generation, file I/O, signals, suggestions
- `assembler.ts` — context assembly framework, budget enforcement
- `executor.ts` — write application framework, flush pipeline
- `briefRenderer.ts` — HTML rendering with esc() helper
- `filesystem.ts` — platform-aware file I/O
- `_layout.tsx` — sidebar/bottom-bar navigation (extended with Topics entry)

### Risks & Concerns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Topic file corruption from malformed existing content | LOW | Add structure guard before split in updateTopicPagesFromBrief() |
| Token budget pressure from many topics | LOW | topicCrossRef in truncatableKeys; ~50 tokens per topic |
| LLM emitting topicDigest with unknown slugs | LOW | updateTopicPagesFromBrief() skips unknown topics via `continue` |
| Topic notes not encrypted at rest | MEDIUM | Decision: add topics/ to sensitive file patterns if user content requires encryption |

### UX Review Notes

- **Topics page (list):** All states handled (loading, empty, populated). Search, pagination, suggestion actions all implemented.
- **Topics page (detail):** All sections handle missing data gracefully. OKR section safe when no OKR data. Notes support add/view with newest-first ordering.
- **Focus Dashboard gap:** The React Native Focus tab does not render topicDigest. The HTML renderer does. Decision: Topics page is the primary UI for topic grouping; Focus tab can add a TopicDigestCard in a future iteration.
- **Condition:** `updateTopicPagesFromBrief()` must always write `## Notes` section (even empty) to prevent subsequent notes from landing outside the Notes section boundary.

### Testing Notes

#### Unit Tests Required
- `buildTopicCrossRef()` — signal-based matching returns correct taskIds/eventIds per topic
- `buildTopicCrossRef()` — name matching catches task title containing topic alias (word-boundary)
- `buildTopicCrossRef()` — returns empty array when no topics registered
- `buildTopicCrossRef()` — item matching two topics appears in both TopicCrossRef entries
- `buildTopicCrossRef()` — regex special characters in topic names do not cause errors
- `matchesTopicName()` — word boundary prevents partial matches ("art" should not match "article")
- `updateTopicPagesFromBrief()` — preserves Notes section when regenerating Dashboard
- `updateTopicPagesFromBrief()` — creates new file when topic file doesn't exist
- `updateTopicPagesFromBrief()` — skips digest items with unknown topic IDs
- `updateTopicPagesFromBrief()` — writes empty Notes section when no prior notes exist

#### Component Tests Required
- Assembler: full_planning case includes topicCrossRef in context when topics exist
- Assembler: full_planning case does not include topicCrossRef when no topics registered
- Assembler: enforceBudget truncates topicCrossRef when budget exceeded
- Executor: updateTopicPagesFromBrief() called when focusBrief has topicDigest
- Executor: updateTopicPagesFromBrief() NOT called when focusBrief has no topicDigest
- Executor: planning succeeds even when updateTopicPagesFromBrief() throws

#### Integration Tests Required
- End-to-end: "plan my day" with 2 topics, 3 related tasks, 1 related event → focusBrief.topicDigest has 2 entries with correct items
- End-to-end: after planning, topics/{slug}.md contains Dashboard with correct Active Tasks and Upcoming Events
- End-to-end: replan same day → Dashboard regenerated, Notes preserved
- End-to-end: plan with no topics → no topicDigest, plan functions normally
- Topics page: load state → renders topic cards sorted by last activity
- Topics page: accept suggestion → topic created, list refreshed
- Topic detail: tap topic → loads tasks, events, OKR, notes for that topic
- Topic detail: add note → persisted to file, note appears in list

#### Scope Isolation Tests Required
No — single-user app, no multi-tenant scoping.

#### Agent Fixtures Required
- LLM fixture: full_planning response with topicDigest containing 2 topic entries, one with okrConnection and newInsights, one without
- LLM fixture: full_planning response with empty topicCrossRef → no topicDigest emitted

---

## Testing Notes (Manual QA)

### Stories 1-4 (existing)
- [ ] "Create a topic for job search" -> manifest updated, reply confirms
- [ ] "Note for job search: had interview at Example Corp" -> appended to topics/job-search.md
- [ ] "Tell me everything about job search" -> reads topic file, summarizes
- [ ] "Remember the dentist only takes mornings" -> fact stored with topic hint "health"
- [ ] After 3+ "health" facts, next interaction mentions suggestion
- [ ] Accept/reject/defer suggestion flows work correctly
- [ ] Existing string facts in context_memory.json load and normalize

### Stories 5-6 (topic-aware planning)
- [ ] "Plan my day" with 2+ topics that have related tasks/events -> focusBrief contains topicDigest with correct groupings
- [ ] Task titled "Prepare for interview" matches topic "Job Search" (alias: "interview") even without a prior signal
- [ ] Task with okrLink appears in topicDigest with okrConnection field populated
- [ ] After planning, topics/{slug}.md has a Dashboard section with Active Tasks, Upcoming Events, OKR Connection, and Insights
- [ ] Dashboard section is replaced (not appended) on replan
- [ ] Notes section in topic file is preserved after Dashboard update
- [ ] "Plan my day" with no topics -> no topicDigest, no errors, plan works normally
- [ ] Item belonging to 2 topics appears in both digest entries
- [ ] focus_brief.html includes a rendered Topics section

### Stories 7-8 (Topics page)
- [ ] "Topics" appears in sidebar and bottom tab bar
- [ ] Topics list shows all topics sorted by last activity with correct stats
- [ ] Search filters topics by name and aliases instantly
- [ ] "Show N more" pagination works when > 10 topics
- [ ] Pending suggestions section appears only when suggestions exist, with functional Create/Dismiss/Later buttons
- [ ] Empty state shown when no topics exist; tapping example phrase navigates to chat
- [ ] Tapping a topic card navigates to detail page
- [ ] Detail page shows Active Tasks, Upcoming Events, OKR Connection, Insights, Notes, Activity sections
- [ ] Tapping a task in detail navigates to Tasks tab
- [ ] Tapping an event in detail navigates to Focus tab
- [ ] "Add Note" appends to topic file under today's date heading
- [ ] Back arrow returns to topic list
- [ ] Mobile drill-down navigation works correctly

---

## Out of Scope

- Periodic background counting (Phase 2 — FEAT024)
- Deferred threshold re-evaluation on timer (Phase 2)
- Cross-topic references or linking
- Topic search across all topics at once (full-text search within topic files)
- Topic archival or deletion
- Topic merging (combining similar topics)
- Topic hierarchy or nesting
- NLP-based topic detection (beyond LLM hint assignment + name matching)
