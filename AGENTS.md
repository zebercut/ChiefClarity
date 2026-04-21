# AGENTS.md — LifeOS (Chief Clarity)

**Updated:** 2026-04-14

This file holds project-specific rules accumulated from Architect and Code Reviewer cycles for the LifeOS / Chief Clarity project. All agents must read this file before starting work on this project.

Generic ADLC-framework rules live in `ADLC/AGENTS.md` (submodule). Do not duplicate rules across both files — project-specific learnings stay here, cross-project rules stay in the submodule.

Coder-specific rules that govern day-to-day implementation style also live in `CLAUDE.md` at the project root.

## Rules

<!-- Rules are added here by the Architect Agent and Code Reviewer Agent after each review. Do not delete existing rules. -->

### Data Integrity
- When a function regenerates a section of a file while preserving another section, always write the preserved section's heading (even empty) so subsequent appends land in the correct location. Example: topic Dashboard regeneration must always write the `## Notes` marker so later `appendToTopicFile()` calls have a home. (DR-FEAT023)
- Never use `require()` for static imports in ES module files — always use top-level `import`. Dynamic `require()` bypasses tree-shaking and is a code smell. (DR-FEAT023)
- File-writing operations triggered by user action must include try-catch with user-facing error feedback. Silent write failures erode user trust. (DR-FEAT023)

### Architecture
- UI handlers for domain actions must delegate to the corresponding executor actions rather than duplicating state-mutation logic. Each inline copy of state mutation in the UI is a missed side-effect waiting to happen (e.g., fact migration, signal recording, conflict checks). If an action exists in the executor, the UI must call it — not reimplement it. (CR-FEAT023: `handleAccept` in `topics.tsx` bypassed `migrateFactsToTopic`.)
- The headless runner and the UI share the same assembler and executor pipeline. When adding a new per-intent context field in `assembler.ts`, both paths automatically benefit. When adding a new side-effect in `executor.ts`, it runs from both paths — confirm that's the intent. (DR-FEAT023)

### Performance
- When iterating over N items that each need a cross-reference against M entities, build the cross-reference once above the loop and index it by key (e.g., `Map<topic, TopicCrossRef>`). Do not rebuild the cross-reference inside the loop. (CR-FEAT023: `buildTopicCrossRef` was called per `topicDigest` item inside `updateTopicPagesFromBrief`.)

### Concurrency
- Shared SQLite writes across processes must use a lock file (or DB-level coordination) to avoid `SQLITE_BUSY`. The proxy and headless runner both start at `npm run dev`; long-running write sweeps (e.g., background embedding indexer) need a TTL-based lock at `{DB_PATH}/.indexer.lock` to serialize them. Stale-lock reclaim prevents crashes from wedging future runs.

### State integrity
- The flush `ShrinkageGuardError` catches corrupted-reload overwrites (> 50% loss between loaded and written counts). Any executor action that **intentionally** shrinks a guarded collection must rebase `state._loadedCounts[<key>]` after the shrinkage so the guard doesn't block a legitimate write. Known cases: `accept_suggestion` migrates facts from `contextMemory` to a topic file. Forgetting this produces runtime errors the user can't recover from without reloading the app.

### Sacred boundary — schedule computation
- When context sent to the LLM contains schedule definitions that require date computation (e.g., "weekly on Tuesday/Thursday"), TypeScript must pre-compute the applicable dates and send a date-keyed map. The LLM must not be expected to parse schedule types, compute weekday-to-date mappings, or handle exclude-date logic — that violates the sacred boundary ("TypeScript owns data computation, LLM owns language"). (CR: recurring events ignored in weekly plan because LLM was expected to compute which dates "weekly on tuesday" applies to.)

### Data model migrations
- When adding a new flag to a data model (e.g., `isRecurringInstance` on CalendarEvent), remember that existing records in the database won't have the flag set. Any filter that depends on the new flag must include a fallback for legacy data (e.g., matching by ID prefix `rcev_` as a backward-compatible heuristic). Without this, the first deploy after the fix still produces incorrect behavior until the old data ages out. (CR: recurring events, assembler filter.)

### Testing
- (Rules will be added here after first test cycle)
