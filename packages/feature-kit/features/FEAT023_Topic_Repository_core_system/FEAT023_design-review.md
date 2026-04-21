# FEAT023 — Design Review

**Reviewer:** Architect Agent  
**Date:** 2026-04-14  
**Status:** Approved with conditions  
**Spec:** FEAT023_Topic_Repository_core_system.md

---

## 1. Architecture Assessment

### Overall Verdict: APPROVED WITH CONDITIONS

The implementation correctly follows the project's sacred boundary (TypeScript owns data, LLM owns language). The data flow chain is complete and sound:

```
Assembler (buildTopicCrossRef) → LLM context → LLM emits topicDigest → Executor saves brief → updateTopicPagesFromBrief → topic markdown files
```

The headless runner automatically benefits from the assembler changes — no separate wiring needed. Topic manifest dual persistence (file + DB) is properly supported. The single-LLM-call rule is respected.

### Strengths
- `buildTopicCrossRef()` uses two discovery strategies (signals + name matching) without adding LLM cost
- Topic page Dashboard is rebuilt deterministically (not LLM-generated), keeping costs at zero
- `topicCrossRef` is in `truncatableKeys` — budget-safe under pressure
- Executor wraps `updateTopicPagesFromBrief()` in try-catch so topic file failures never block planning
- All HTML output properly XSS-escaped via `esc()` in briefRenderer
- Regex injection prevented — all topic names escaped before word-boundary matching

---

## 2. Issues Found

### ISSUE 1 — `require()` instead of `import` in topics.tsx (MEDIUM)

**File:** `app/(tabs)/topics.tsx` lines 174, 184, 205  
**Problem:** Three suggestion action handlers use `require("../../src/modules/executor")` to get `flush`. This bypasses tree-shaking and is a code smell in an ES module codebase.  
**Fix:** Import `flush` from executor at the top of the file alongside the other imports.  
**Impact:** Bundle size, code consistency.

### ISSUE 2 — No error feedback on Add Note in topic-detail.tsx (MEDIUM)

**File:** `app/(tabs)/topic-detail.tsx` lines 190-198  
**Problem:** `handleAddNote()` calls `appendToTopicFile()` without try-catch. If the file write fails, the user gets no feedback — the input closes and the note silently disappears.  
**Fix:** Wrap in try-catch, show an alert or inline error on failure.  
**Impact:** User trust — lost notes with no indication.

### ISSUE 3 — No markdown validation on topic file rewrite (LOW)

**File:** `src/modules/topicManager.ts` line 316-336  
**Problem:** `updateTopicPagesFromBrief()` reads the existing topic file, splits at `## Notes` or date headings, then rewrites. If the file is malformed (corrupted, manually edited with wrong format), the split logic could produce broken markdown.  
**Fix:** Add a guard — if the file content doesn't match expected structure (has `#` heading, has `## Notes` or `### YYYY-` patterns), skip the split and append Dashboard before the raw content with a separator.  
**Impact:** Edge case — only triggered by manual file edits or corruption.

### ISSUE 4 — Topic markdown files not encrypted (OBSERVATION)

**File:** `src/utils/filesystem.ts` — `isSensitiveFile()` does not include `topics/*.md`  
**Problem:** Tasks and calendar events are encrypted at rest, but topic notes (which may contain the same information) are stored as plaintext markdown.  
**Decision needed:** Is this intentional? Topic files may contain sensitive user data (e.g., "Interview at Company X", health notes).  
**Recommendation:** Add `topics/` to the sensitive file patterns if the project requires at-rest encryption for user content.

---

## 3. UX Review

### Stories 1-4 (Core topic system — implemented)
- **Create, query, note, suggestion flows:** All covered in existing implementation.
- **No gaps found** in the existing FEAT023 core implementation.

### Story 5 (Topic-aware daily planning)
- **topicDigest in FocusBrief:** Schema is correct. Brief-level (not per-day) is the right choice — themes span days.
- **UX gap:** The Focus Dashboard (`app/(tabs)/focus.tsx`) does not render `topicDigest`. The HTML renderer does, but the in-app React Native view has no `TopicDigestCard` component.
- **Recommendation:** Either add a `TopicDigestCard` to the Focus tab, or defer to Story 7-8 (Topics page) as the primary UI for topic grouping. Document the decision.

### Story 6 (Topic page updates from planning)
- **Dashboard regeneration:** Correct approach — rebuilds on every plan, preserves Notes.
- **Edge case:** First plan with no existing topic file creates a file with Dashboard only (no Notes separator). Subsequent manual notes via `appendToTopicFile()` would create `### date` headings outside the Notes section. Next Dashboard update would then try to split at `## Notes` and fail to find it, falling back to the date-heading regex — which would capture Dashboard's own date. 
- **Fix:** Always write `## Notes` section even if empty: `\n---\n## Notes\n` at the end of the Dashboard.

### Story 7 (Topics page — list view)
- ✅ Loading, empty, and populated states all handled
- ✅ Search filters by name + aliases
- ✅ "Show N more" pagination implemented
- ✅ Suggestions section with collapsible header and all three actions
- ✅ Empty state with example phrases that navigate to chat

### Story 8 (Topics page — detail view)
- ✅ Back navigation, topic header with aliases and creation date
- ✅ Active Tasks section with navigation to Tasks tab
- ✅ Upcoming Events section with navigation to Focus tab
- ✅ OKR Connection section with progress bars (safe when no OKR data)
- ✅ Insights section from latest focus brief (safe when no insight)
- ✅ Notes section with date grouping, newest-first, "Show older" expander
- ✅ Activity section (collapsible) with signal breakdown
- ✅ Add Note with text input and save/cancel

---

## 4. Data Models

### Existing (no changes needed)
| Entity | Storage | Key fields |
|--------|---------|------------|
| TopicEntry | DB `topics` table + manifest JSON | id (slug), name, aliases[], createdAt |
| TopicSuggestion | DB `topic_suggestions` + manifest JSON | topic, count, threshold, status |
| TopicSignal | DB `topic_signals` + manifest JSON | topic, sourceType, sourceId, date |
| TopicManifest | AppState (in-memory, flushed to DB/file) | topics[], pendingSuggestions[], rejectedTopics[], signals[] |

### New (added by this feature)
| Entity | Storage | Key fields |
|--------|---------|------------|
| TopicCrossRef | Computed in-memory by assembler (not persisted) | topic, name, taskIds[], eventIds[], okrLinks[] |
| TopicDigestItem | Persisted inside FocusBrief | topic, name, items[], okrConnection?, newInsights? |
| Topic Dashboard | topics/{slug}.md (markdown file) | Regenerated per plan; Notes section preserved |

### Data Flow
```
[Assembler] buildTopicCrossRef(manifest, tasks, events)
    ↓ signals + name matching
TopicCrossRef[] → LLM context (ctx.topicCrossRef)
    ↓ LLM generates
TopicDigestItem[] → focusBrief.topicDigest (persisted in state)
    ↓ executor post-write
updateTopicPagesFromBrief() → topics/{slug}.md Dashboard section (persisted to disk)
```

---

## 5. Service Dependencies

| Dependency | Purpose | Risk |
|------------|---------|------|
| `topicManager.ts` | Cross-ref builder, topic page updater | Core — must not throw in planning path |
| `assembler.ts` | Injects topic context into full_planning | Token budget — truncatable |
| `executor.ts` | Triggers topic page update after brief write | Try-catch wrapped |
| `filesystem.ts` | Reads/writes topic markdown files | Platform-aware (Node/Web/Capacitor) |
| `briefRenderer.ts` | Renders topicDigest in HTML output | XSS-safe |

No new third-party dependencies. No new API endpoints. No new database tables.

---

## 6. Design Patterns

| Pattern | Where | Why |
|---------|-------|-----|
| Signal-based reverse index | `buildTopicCrossRef()` | Efficient O(n) lookup of topic-to-item relationships |
| Name matching fallback | `buildTopicCrossRef()` | Catches items not yet tagged with signals |
| Dashboard regeneration | `updateTopicPagesFromBrief()` | Always-fresh view; avoids stale data accumulation |
| Notes preservation | `updateTopicPagesFromBrief()` | User content is sacred — Dashboard is system-generated |
| Budget-safe truncation | `enforceBudget()` in assembler | topicCrossRef in truncatableKeys — degrades gracefully |
| Non-blocking side effect | executor try-catch | Topic file writes can't break daily planning |

---

## 7. Risks & Concerns

| Risk | Severity | Mitigation |
|------|----------|------------|
| Topic file corruption from malformed existing content | LOW | Add structure guard before split (Issue 3) |
| Token budget pressure from many topics | LOW | topicCrossRef in truncatableKeys; ~50 tokens per topic |
| LLM emitting topicDigest with unknown topic slugs | LOW | `updateTopicPagesFromBrief()` skips unknown topics via `continue` |
| Concurrent planning races on topic files | LOW | Sequential execution; app is single-user |
| Topic notes not encrypted at rest | MEDIUM | Decision needed — see Issue 4 |

---

## 8. New vs Reusable Components

### New
- `app/(tabs)/topics.tsx` — Topics list page
- `app/(tabs)/topic-detail.tsx` — Topic detail page
- `src/components/topics/TopicCard.tsx` — Topic list card
- `src/components/topics/TopicSuggestionCard.tsx` — Suggestion card
- `buildTopicCrossRef()` in topicManager.ts
- `updateTopicPagesFromBrief()` in topicManager.ts

### Reusable (existing, no changes)
- `topicManager.ts` — slug generation, file read/write, signals, suggestions
- `assembler.ts` — context assembly framework, budget enforcement
- `executor.ts` — write application framework, flush pipeline
- `briefRenderer.ts` — HTML rendering with `esc()` helper
- `filesystem.ts` — platform-aware file I/O
- `_layout.tsx` — sidebar/bottom-bar navigation (extended with Topics entry)

---

## 9. Conditions for Approval

Before marking this feature as "Design Reviewed", fix:

1. **MUST:** Replace `require()` with `import` for `flush` in `topics.tsx`
2. **MUST:** Add try-catch + user feedback to `handleAddNote()` in `topic-detail.tsx`
3. **MUST:** Always write `## Notes` section (even empty) at the end of Dashboard output in `updateTopicPagesFromBrief()` to prevent subsequent notes from landing outside the Notes section
4. **SHOULD:** Decide on topic file encryption and document the decision
