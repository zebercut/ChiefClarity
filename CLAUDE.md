# Chief Clarity - Project Rules

## Architecture Documentation

**MANDATORY:** When adding new functionality, changing architecture, adding new data files, new intents, new modules, or modifying the data flow, you MUST update the relevant file under `docs/v4/` to reflect the changes. The `docs/v4/` folder is the single source of truth for the system's architecture. Old v2/v3 docs in `docs/archive/` are preserved for historical context only — do NOT edit them.

**Where to update (by change type):**
- New skills (skill folder, manifest, prompt, context, handlers): `docs/v4/02_skill_registry.md`
- New modules in `src/modules/` or changes to dispatch / executor / assembler / router: `docs/v4/01_request_flow.md`
- New data files / data schemas: `docs/v4/03_memory_privacy.md`
- New attachment flows or RAG changes: `docs/v4/04_attachments_rag.md`
- New proactive sensors / nudge logic: `docs/v4/05_proactive_intelligence.md`
- Self-improvement / feedback flows: `docs/v4/06_feedback_improvement.md`
- Scheduling / cost / latency / migration phases / ADRs: `docs/v4/07_operations.md`
- Companion / emotional support: `docs/v4/08_companion.md`
- Build/migration plan changes: `docs/v4/09_dev_plan.md`
- Topics / topic-aware planning: `docs/v4/10_topics.md`
- High-level overview, system diagram, component catalog, non-negotiables: `docs/v4/00_overview.md`

**When to update:** After the code changes compile and work, before marking the task as done.

## README

**MANDATORY:** When adding new features, new scripts, changing how to run the app, adding new data files, or modifying the project structure, you MUST update `README.md` to reflect the changes.

**What to update:**
- New features: add to the feature list at the top and the relevant section
- New scripts: add to the Scripts table
- New data files: add to the Data Files table
- New modules: add to the Modules table
- Changed project structure: update the tree
- Changed run commands: update Quick Start and Scripts sections

**When to update:** After the code changes work, before marking the task as done.

## Feature Backlog

**MANDATORY:** Maintain the feature backlog in `packages/feature-kit/features/`.

Each feature is a folder (e.g., `FEAT001_Task_Management_Dashboard/`) containing `FEAT001_Task_Management_Dashboard.json` (structured metadata) and `FEAT001_Task_Management_Dashboard.md` (description/notes). The manifest at `features/_manifest.json` is auto-regenerated on every CLI mutation.

**What to update:**
- New feature ideas: `npx ts-node packages/feature-kit/src/cli.ts add --title="..." --category="..." --moscow=MUST --priority=N --release=vX.X --tags=tag1,tag2` (always provide all fields: category, moscow, priority, release, tags)
- Feature details/notes: edit the `.md` file inside the feature folder directly

**Status pipeline:** Update status as the feature progresses through the pipeline:
- `Planned` → PM wrote the feature spec
- `Design Reviewed` → Architect reviewed and approved the design
- `In Progress` → Developer is coding
- `Code Reviewed` → Code review passed
- `Testing` → In QA/testing
- `Done` → Complete
- `Rejected` → Won't do

Example: `npx ts-node packages/feature-kit/src/cli.ts update FEAT001 --status="Design Reviewed"`

**Quick reference:** `npx ts-node packages/feature-kit/src/cli.ts list` or `npx ts-node packages/feature-kit/src/cli.ts stats`

**When to update:** When a feature is discussed, planned, started, or completed.

## App Runs Continuously

**CRITICAL:** The app is opened once and stays running for days. NEVER design features that only trigger on app load, startup, or mount.

**Rules:**
- Every periodic check (inbox, nudges, proactive engine, state refresh) must run on a **recurring interval** inside the app, not just on mount or tab focus
- Use `setInterval` for in-app polling while the app is open
- The headless runner handles background scheduling when the app is closed, but the app itself must also poll while open
- Current intervals: inbox/nudges every 2 minutes, state refresh every 5 minutes
- All intervals must respect the `loadingRef` / `inboxProcessingRef` guards to avoid race conditions

## No Real User Data in ANY Committed File

**CRITICAL:** Never include real user data or sample user data in ANY file that is committed to the repository. This rule applies universally — there are NO exceptions, including feature specs, design reviews, code reviews, acceptance criteria, user stories, architecture docs, test cases, and sales materials.

**Applies to (exhaustive — if it's committed, it's covered):**
- TypeScript source files (`src/**/*.ts`, `app/**/*.tsx`)
- System prompts and LLM instructions (`src/constants/prompts.ts`)
- Scripts (`scripts/*.js`, `scripts/*.ts`)
- Documentation (`docs/*.md`, `README.md`)
- Feature specs and design docs (`packages/feature-kit/features/**/*.md`)
- Code review and architecture review docs
- Test fixtures, test files, and sample data
- HTML/CSS assets (`ADLC/docs/**/*.html`)
- Code comments and inline examples
- User stories and acceptance criteria examples
- JSON examples in documentation

**FORBIDDEN — these must NEVER appear in any committed file:**
- Real names of family members, friends, colleagues, or contacts (e.g., children's names, spouse, recruiter names, interviewer names)
- Real company names from the user's job search, interviews, or work history
- Real activities tied to specific family members (e.g., specific sports, lessons, clubs)
- Real school names, locations, or personal addresses
- Real task descriptions from the user's life
- Real dates referencing actual personal events
- Real email addresses (other than generic contact emails)
- Any data that could identify the user or their family
- The user's real name in examples, mockups, or wireframes (use `[USER]` placeholder)

**ALLOWED:**
- Generic placeholders: `[User's question]`, `[Task name]`, `[Date]`, `[USER]`
- Abstract examples: `Task A`, `Project X`, `Deadline Y`
- Clearly fictional data: "Example Corp meeting", "Project Alpha deadline"
- Generic activities: "weekly activity pickup", "extracurricular event", "team meeting", "Weekly Class"
- Generic roles: "Child A", "Child B", "Family member", "Colleague", "Candidate X", "Contact A"
- Author attribution in LICENSE, README, and package.json (standard OSS practice)

**Before completing any task**, review ALL modified files — including documentation, feature specs, and review docs — for real user data. This is a privacy and security requirement.

## One-Time Scripts Policy

**CRITICAL:** One-time scripts (data fixes, debug dumps, migration patches) must NEVER be committed to the repository.

**Why:** They are hardcoded to specific data (real event titles, real names, hardcoded dates) and become dead code immediately after running. They are the #1 source of personal data leaks.

**Rules:**
- One-time fix/debug scripts go in `scripts/scratch/` which is gitignored
- After a script runs successfully, it stays in `scripts/scratch/` (not committed) or is deleted
- If a fix script reveals a recurring problem, write a proper feature/module instead of keeping the script
- Only permanent infrastructure scripts belong in `scripts/` (e.g., `headless-runner.js`, `db-backup.js`, `api-proxy.js`)
- Migration scripts may be committed IF they contain no personal data and have reuse value

## Architecture Rules

- **Sacred boundary:** TypeScript owns routing, state, file I/O, conflict detection, writes, summarizing, token budgets. LLM owns language understanding, judgment, suggestions, natural language reply. Neither trespasses.
- **Single LLM call:** One call per user phrase. No multi-agent pipelines.
- **Structured output only:** LLM always returns JSON via tool use (`submit_action_plan`). TypeScript executes the plan.
- **Per-intent context:** The assembler sends only the data each intent needs. Do not send all files to all intents.
- **Token budgets:** Every intent has a token budget. The assembler enforces it by truncating low-priority arrays.
- **Atomic writes:** File writes go through `filesystem.ts`. Use temp-file-then-rename pattern.
- **User timezone:** Use `state.userProfile.timezone` for all date operations, not system locale.

## Learned Patterns (from code reviews)

- The Haiku→Sonnet validation fallback in `llm.ts` is gated by `SONNET_FALLBACK_INTENTS`. Simple CRUD intents (`task_create`, `bulk_input`) fail gracefully, not escalate to Sonnet.
- Injected LLM functions (`injectRefreshLlm`) bypass the `llm.ts` circuit breaker. Callers must check `isCircuitOpen()` before calling them.
- Headless runner is the biggest cost center — when wiring a module into the UI, always check if the headless runner also needs it.
- One Sonnet call per day (morning plan). Evening + light checks use Tier 2 Haiku refresh. Weekly plan is the only other Sonnet call.
- Database (`lifeos.db`) must live on a local path (`DB_PATH`), not on Google Drive. Hourly backup copies the DB to the cloud folder.
- When adding fields to the `Task` interface, update: `types/index.ts`, `db/queries/tasks.ts` (rowToTask + insertTask + updateTask), `executor.ts` (defaults), `recurringProcessor.ts`, and test fixtures.

## Output Style

- All user-facing messages must use plain, non-technical language.
- No file names, JSON keys, or system jargon in user-visible text.
- Focus on outcomes ("Your plan is ready") not actions ("Wrote focus_brief.json").
- Chat reply for planning intents must be 1-2 sentences max — details go in the Focus Brief.
