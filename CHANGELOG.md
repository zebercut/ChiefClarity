# Changelog

All notable changes to Chief Clarity will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2026-03-24

### Added

#### Hybrid Data Architecture
- **Three-layer data system** - Scalable architecture for 100+ agents
  - Layer 1: Markdown files (human-readable, editable)
  - Layer 2: `index.json` (fast metadata and caching)
  - Layer 3: `chiefclarity.db` (SQLite for queryable history)

- **IndexManager** (`data_manager.py`)
  - File metadata tracking (size, last_modified, generated_by)
  - File change detection (skip unchanged files)
  - Search result caching (24-hour TTL)
  - Learned patterns caching
  - Run metadata tracking

- **DatabaseManager** (`data_manager.py`)
  - 5 tables: runs, agent_executions, search_history, learned_patterns, behavior_metrics
  - Workflow execution logging
  - Agent performance tracking
  - Historical analytics
  - Foundation for Learning Agent

- **DataManager** (`data_manager.py`)
  - Main interface combining index and database
  - Run lifecycle management (start_run, end_run)
  - Agent execution tracking (log_agent_start, log_agent_end)
  - File change detection API

- **Logs Directory** - Organized debug file storage
  - `data/logs/` for all debug files
  - `_debug_*_response.txt` files auto-organized
  - Keeps data/ directory clean

#### Streaming Support
- **API streaming enabled** - Handles long-running operations
  - Prevents "Streaming required" errors
  - Supports responses >10 minutes
  - Uses `client.messages.stream()` for all API calls

#### Backup System Improvements
- **Smart backup management** - Prevents data loss
  - Keeps last 5 backups (increased from 3)
  - Only deletes failed run backup on restore
  - Preserves all successful run backups
  - Auto-cleanup of old backups (>5)

### Changed

#### Architecture
- **Agent output format** - Simplified JSON structure
  - Changed from nested `outputs` object to flat fields
  - `calendar_md`, `tasks_md`, `structured_input_md` instead of nested JSON
  - Prevents JSON truncation issues
  - Easier to parse and validate

- **Token limits** - Increased for large file generation
  - Default: 32,000 tokens (increased from 16,000)
  - Intake/Planning/Writer agents: 32,000 tokens
  - Other agents: 8,000 tokens
  - Prevents output truncation

- **File writing** - Index integration
  - Updates `index.json` on every file write
  - Tracks file metadata (size, generated_by, schema_version)
  - Enables change detection for performance

- **Error handling** - Database logging
  - All errors logged to `agent_executions` table
  - Error messages stored for debugging
  - Retry logic with error tracking

#### Performance
- **Change detection** - Skip unchanged files
  - Only read files modified since last run
  - Cache unchanged files in context
  - 2-3x speedup on subsequent runs

- **Search caching** - Avoid duplicate API calls
  - Cache search results in `index.json`
  - 24-hour TTL for cached results
  - Future: Web Search Agent integration

### Fixed

#### Critical Bugs
- **Backup deletion bug** - Fixed data loss issue
  - Previously: Deleted ALL backups on restore (including user data)
  - Now: Only deletes the failed run backup
  - Preserves all successful run backups
  - User data protected

- **Database lock error** - Fixed restore failure
  - Close database connection before restore
  - Prevents "file being used by another process" error
  - Successful restore every time

- **Streaming error** - Fixed API timeout
  - Enabled streaming for all API calls
  - Handles large responses (>24KB)
  - No more "Streaming required" errors

#### Workflow
- **Accurate status reporting** - Fixed false success messages
  - Tracks `workflow_success` flag throughout execution
  - Reports "FAILED" on errors (not "COMPLETED")
  - Shows run_id and agent count on success

- **Automatic rollback** - Data integrity on failure
  - Restores from backup on any workflow failure
  - No broken or fragmented data left behind
  - Clean state after failures

### Documentation
- **HELP.md** - Comprehensive user guide
  - Installation and setup
  - Daily usage workflows
  - Troubleshooting guide
  - Advanced features
  - Best practices

- **Architecture documentation** - Technical details
  - `DATA_ARCHITECTURE.md` - Hybrid data system design
  - `SCALABLE_ARCHITECTURE.md` - Plugin-based agent system
  - `ARCHITECTURE_ANALYSIS.md` - Multi-turn conversation patterns
  - `BACKUP_BUG_ANALYSIS.md` - Backup system fixes

### Performance
- **Execution time** - Optimized for speed
  - First run: ~30-60 seconds (full workflow)
  - Subsequent runs: ~15-30 seconds (with change detection)
  - Database queries: <1 second

- **Disk usage** - Efficient storage
  - Max 5 backups (~150 MB)
  - After restore: 0 MB (backups cleaned)
  - Logs auto-organized in logs/

### Breaking Changes
- **Agent output format** - JSON structure changed
  - Old: `{"outputs": {"file.md": "content"}}`
  - New: `{"calendar_md": "content", "tasks_md": "content"}`
  - Agents must use new format

- **Database required** - New dependency
  - `chiefclarity.db` created on first run
  - SQLite database for history tracking
  - Can be deleted and recreated if needed

### Migration Guide
- **From v2.x to v3.0:**
  1. Install: No new dependencies required
  2. Run: First run creates `index.json` and `chiefclarity.db`
  3. Backups: Old backups can be deleted (new system in place)
  4. Data: All existing data files compatible

## [2.2.0] - 2026-03-23

### Added

#### Automation Script (Standalone Execution)
- **Python automation script** (`run_chiefclarity.py`) - Execute Chief Clarity workflow without IDE
  - Full multi-agent orchestration (ChiefClarity → Intake → Planning → Writer)
  - Interactive menu for mode selection
  - Direct command-line mode execution support
  - Anthropic Claude API integration (claude-sonnet-4-5-20250929)
  - Config file support for API key storage (`config.json`)
  - Automatic file I/O for all data files
  - Error handling and user-friendly output

- **Configuration Management**
  - `config.json` - API key storage (gitignored for security)
  - `config.json.example` - Template file for new users
  - Priority: config.json > environment variable
  - Prevents stale environment variable conflicts

- **Calendar & Task Management Integration**
  - Intake Agent parses temporal expressions from input.txt
  - Creates/updates `calendar.md` and `tasks.md` entries
  - Tracks event status (confirmed, pending, tentative, completed, cancelled)
  - Archives completed items to `calendar_archive.md`
  - Planning Agent merges calendar data into focus.md
  - Time-blocked agenda generation with calendar events

#### Templates
- **Calendar Templates** - New user setup files
  - `templates/calendar.md` - Calendar event structure
  - `templates/tasks.md` - Task tracking format
  - `templates/calendar_archive.md` - Completed event archive

#### Documentation
- **README.md** updates:
  - New "Automation Script (Standalone Execution)" section
  - Setup instructions for Python script
  - Available modes and cost information
  - Output files documentation
  - Troubleshooting for API key and model issues
  
- **CHANGELOG.md** - Version 2.2.0 release notes (this entry)

- **.gitignore** updates:
  - Added `config.json` to protect API keys
  - `config.json.example` remains tracked as template

### Changed

#### Agent Enhancements
- **Intake Agent** (`cc_intake_agent.md`)
  - Added calendar extension for temporal expression parsing
  - Status tracking for events and tasks
  - Daily cleanup and archival processes
  - Links calendar entries to structured_input.md

- **Planning Agent** (`cc_planning_agent.md`)
  - Added calendar extension for event/task queries
  - Expands recurring events for current day/week
  - Merges calendar data into focus.md sections
  - Pattern-based recommendations (completion probability, optimal times)
  - Time-blocked agenda with calendar integration

- **ChiefClarity Agent** (`cc_chiefclarity_agent.md`)
  - Updated mode descriptions to include calendar and habit discovery
  - All planning modes now query calendar.md and tasks.md
  - Habit discovery integrated into daily, weekly, and full analysis modes

#### Script Architecture
- **Simplified Planning Output** - Changed from JSON to markdown
  - Planning Agent outputs `plan_data.md` instead of `plan_data.json`
  - Avoids JSON truncation issues with large datasets
  - More concise and readable intermediate format
  - Writer Agent reads markdown plan data

- **Input Truncation** - Smart input size management
  - Large files truncated to avoid token limits
  - OKR, structured_input, calendar, tasks limited to relevant portions
  - Maintains functionality while preventing API errors

### Fixed

#### API Integration
- **Model Name Detection** - Dynamic model selection
  - Script detects available Claude models from user's account
  - Uses `claude-sonnet-4-5-20250929` (Claude Sonnet 4.5)
  - Graceful fallback if model unavailable

- **Environment Variable Priority** - Config file takes precedence
  - Fixed issue where stale env vars caused authentication errors
  - `config.json` now checked before environment variables
  - Prevents conflicts from previous terminal sessions

- **JSON Parsing** - Robust error handling
  - Extracts JSON from AI responses with start/end markers
  - Handles incomplete responses gracefully
  - Provides clear error messages for debugging

### Performance

- **Execution Time** - ~30-60 seconds for full workflow
- **API Cost** - ~$0.50-$1.00 per run (4 API calls)
- **Token Usage** - Optimized with input truncation and concise outputs

## [2.1.0] - 2026-03-18

### Added

#### Archival & Indexing System
- **Three-tier archival architecture** - Efficient historical context management
  - Active data (7 days) with topic and date indexing
  - Recent archive (30 days) with monthly rotation
  - Long-term archive (permanent storage by month)

- **Topic Index** - Fast navigation to related entries
  - `structured_input.md` header with topic-based navigation
  - Recent INBOX-IDs per topic (last 7 days)
  - Topic summaries with latest activity
  - Last updated timestamps per topic
  - 10 default topics: Job Search, Project A, Family, Vehicle, Emotional State, Daily Habits, Admin, Finances, Health, Chief Clarity Development

- **Date Index** - Quick access by date range
  - `structured_input.md` header with date-based navigation
  - INBOX-ID ranges per date
  - Entry counts per day
  - Last 7 days visible in active file

- **Weekly Summaries** - Synthesized context across weeks
  - `data/structured_input_summary.md` - Weekly summary file
  - Automatic generation every Sunday
  - Sections: Job Search, Project A, Family Support, Habits & Health, Critical Decisions, Patterns, Risks
  - Quick context without reading individual entries

- **Automatic Archival Rotation**
  - **7-day rotation (Sundays):**
    - Entries older than 7 days moved to `structured_input_archive_YYYY-MM.md`
    - Weekly summary generated and appended
    - Topic index updated (old INBOX-IDs removed)
    - Active file stays small (~300 lines)
  - **30-day rotation (First Sunday of month):**
    - Previous month's archives moved to `archives/YYYY-MM/` folder
    - New monthly archive files created
    - Long-term storage organized by month

- **Raw Input Preservation**
  - `data/input_archive_YYYY-MM.md` - Monthly raw input archive
  - Archives raw `input.txt` content BEFORE cleanup
  - Preserves user's exact notes forever
  - Timestamped entries with ISO 8601 format

- **Archive Folder Structure**
  - `data/archives/YYYY-MM/` - Monthly archive folders
  - `input_archive_YYYY-MM.md` - Raw input by month
  - `structured_input_archive_YYYY-MM.md` - Structured entries by month
  - `README.md` - Archive usage guide with search examples

- **System Documentation**
  - `data/ARCHIVAL_SYSTEM.md` - Complete archival system documentation
  - Architecture overview, workflow, file structure, search methods
  - Implementation status and version history

#### Agent Enhancements
- **Intake Agent** (`cc_intake_agent.md`) - Major workflow update
  - **STEP 1:** Archive raw input BEFORE processing (critical for data preservation)
  - **STEP 2:** Check 7-day rotation (Sundays only)
  - **STEP 3:** Check 30-day rotation (first Sunday of month only)
  - **STEP 4:** Process input (normal intake work)
  - Topic index updates with new INBOX-IDs
  - Date index updates with new entries
  - Weekly summary generation from archived entries

#### Documentation
- **README.md** updates:
  - Archival & Indexing System section
  - Updated Main Agents section (Intake Agent responsibilities)
  - Updated project structure with archive files
  - New troubleshooting entries for historical search
  - Updated design principles (layered memory, data preservation)
  - New tips for topic index and archive usage
- **CHANGELOG.md** - Version 2.1.0 release notes (this file)

### Changed

#### File Organization
- **structured_input.md** - New header structure
  - Topic index at top (fast navigation)
  - Date index below topic index
  - Active period: last 7 days only
  - Modified timestamp updated on every run

- **Intake Agent workflow** - Archival-first approach
  - Raw input archival happens FIRST (before any processing)
  - Prevents data loss from Writer Agent cleanup
  - Rotation checks happen before normal processing
  - Topic and date indexes updated automatically

#### Performance Optimization
- **Layered retrieval strategy** - Hierarchical search from fast to deep
  - Layer 1: Topic Index (fastest, 80% of queries, <1 second)
  - Layer 2: Date Index (fast, time-based queries, <2 seconds)
  - Layer 3: Weekly Summaries (medium, broader context, <1 second)
  - Layer 4: Archive Search (slower, deep history, ~5 seconds)
  - Layer 5: Raw Input Search (deepest, exact words, ~5 seconds)

- **Active file size management**
  - `structured_input.md` stays under 500 lines (7 days only)
  - Weekly summaries ~200 lines/month
  - Monthly archives ~3,000-5,000 lines
  - Annual total ~36,000-60,000 lines (manageable without database)

### Fixed

#### Data Loss Prevention
- **Raw input preservation** - Fixed archival process that stopped after [Month] [Day]
  - Intake Agent now archives raw input on EVERY run
  - Missing entries for [Date Range] restored manually
  - Archival happens BEFORE Writer Agent cleanup
  - User's exact notes never lost again

### Added - 2026-03-15

#### Topic Registry Architecture
- **Topic Registry system** - Unified historical view of all recurring topics
  - `data/topics.md` - Executive summaries with status and recent activity
  - `data/topics/[topic-name].md` - Complete historical context per topic
  - `data/topic_registry.json` - Metadata store with topic-to-KR linkages
  - `templates/topic_detail.md` - Template for topic detail files

#### Agent Enhancements
- **Planning Agent** (`cc_planning_agent.md`)
  - Topic auto-discovery from inbox items
  - Context gathering from OKR.md, structured_input.md, history_digest.md
  - Topic-to-KR linkage proposals with user consultation
  - Update frequency optimization per mode (daily/weekly/full_analysis)
  
- **Writer Agent** (`cc_writer_agent.md`)
  - Topic file generation (topics.md + detail files)
  - Cross-file hyperlink generation in focus.md
  - Topic Registry updates per mode
  - Correct link format: `[Topic Name](topics.md#topic-id)`

#### Documentation
- **TOPIC_REGISTRY_IMPLEMENTATION.md** - Complete architecture documentation
- **CHANGELOG.md** - Version history tracking (this file)
- **README.md** updates:
  - Topic Registry feature documentation
  - Updated project structure
  - Topic navigation tips
  - Troubleshooting for topic history access

### Fixed - 2026-03-15

#### Link Architecture
- **Cross-file markdown links** - Fixed incorrect anchor-only links
  - Changed from `[Topic](#id)` to `[Topic](topics.md#id)` in focus.md
  - Updated Writer Agent instructions with correct link format
  - All topic links now work correctly across files

#### Project Structure
- **Template location** - Moved topic template to correct folder
  - Moved from `data/topics/_template.md` to `templates/topic_detail.md`
  - Updated Writer Agent to reference correct template path
  - Maintains consistency with other templates

### Changed - 2026-03-15

#### File Organization
- **Topic files** - New hybrid structure for topics
  - Executive summaries in `topics.md` (quick scan)
  - Detailed history in `topics/[topic-name].md` (deep dive)
  - Metadata in `topic_registry.json` (system state)

#### Agent Workflow
- **Mode-based updates** - Optimized topic processing per mode
  - `prepare_today/prepare_tomorrow`: Update summaries only, skip detail files
  - `prepare_week`: Update summaries + detail files for active topics
  - `full_analysis`: Rebuild all topic files from scratch

## [Previous Versions]

### Context Linking Architecture
- Agenda items link to full context sections
- Ideas, decisions, next steps, completed work grouped by context
- Expandable detail sections in focus.md

### Multi-Agent System
- ChiefClarity orchestrator agent
- Intake Agent (inbox normalization)
- Planning Agent (strategic planning)
- Companion Agent (emotional support)
- Writer Agent (markdown generation)

### Core Features
- Four operational modes (prepare_today, prepare_tomorrow, prepare_week, full_analysis)
- Single input channel (input.txt)
- OKR tracking and progress monitoring
- Weekly calendar integration
- Task check-in system
- Question routing (live vs persistent)

---

**Note:** This changelog was created on 2026-03-15. Previous changes were not tracked in this format.
