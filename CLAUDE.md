# Chief Clarity - Project Rules

## No Sample User Data in Shippable Code

**CRITICAL:** Never include real user data or sample user data in any shippable code files.

**Applies to:**
- Agent definitions (`agents/*.md`)
- Python scripts (`*.py`)
- Templates (`templates/*.md`)
- Documentation examples
- Code comments
- Test fixtures

**FORBIDDEN:**
- Real names, dates, tasks, or events from user's life
- Sample data that resembles real user information (e.g., specific deadlines, interview names, family member names)
- Company names, exact dates/times in examples

**ALLOWED:**
- Generic placeholders: `[User's question]`, `[Task name]`, `[Date]`
- Abstract examples: `Task A`, `Project X`, `Deadline Y`
- Structural examples without real content
- Clearly fictional data: "Example Corp meeting", "Project Alpha deadline"

**Rationale:** Protects user privacy, prevents data leakage in version control, keeps codebase reusable.

## Architecture Rules

- **Thin code:** `run_chiefclarity.py` is a thin execution layer. All business logic lives in agent markdown files. Do not add decision-making logic to Python code.
- **Agent-driven:** The orchestrator agent decides what to do and who to call. Do not hardcode workflows in the script.
- **Performance:** Use JSON and DB files for structured data. Keep markdown files indexed. Minimize token usage per agent call.
- **Per-agent context:** Each agent receives only the files it needs (configured in `_per_agent_files`). Do not send all files to all agents.
- **Date authority:** System time is UTC via `datetime.now(timezone.utc)`. Agents use `run_manifest.json -> current_time_user_tz` for all date operations.

## Output Style

- All user-facing messages (steps, console output, answers) must use plain, non-technical language.
- No file names, JSON keys, or system jargon in user-visible text.
- Focus on outcomes ("Your plan is ready") not actions ("Wrote focus.md").
