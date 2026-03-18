# Changelog

All notable changes to Chief Clarity will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
  - 10 default topics: Job Search, SaddleUp, Family (Vida/Sofia/Leila), Car Replacement, Emotional State, Daily Habits, Admin/Taxes, Chief Clarity Development

- **Date Index** - Quick access by date range
  - `structured_input.md` header with date-based navigation
  - INBOX-ID ranges per date
  - Entry counts per day
  - Last 7 days visible in active file

- **Weekly Summaries** - Synthesized context across weeks
  - `data/structured_input_summary.md` - Weekly summary file
  - Automatic generation every Sunday
  - Sections: Job Search, SaddleUp, Family Support, Habits & Health, Critical Decisions, Patterns, Risks
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
- **Raw input preservation** - Fixed archival process that stopped after March 9
  - Intake Agent now archives raw input on EVERY run
  - Missing March 16-17 entries restored manually
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
