# Changelog

All notable changes to Chief Clarity will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
