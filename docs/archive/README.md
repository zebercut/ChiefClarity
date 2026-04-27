# Archived Architecture Docs

These were the design references for earlier iterations of the system.
They are preserved for historical context but **are not current** and
should not be used to guide new work.

| File | What it described | Status |
|---|---|---|
| `v2_typescript_architecture.md` | v2 — single-agent, regex router, JSON files, single LLM call per phrase | Superseded by v4 (skill-based) |
| `v3_multi_agent_architecture.md` | v3 proposal — multi-agent, multi-LLM, SQLite-backed | Never implemented; replaced by v4 single-call multi-specialist |
| `v3_design_review.md` | Architect review of the v3 proposal | Same |

**Current source of truth:** `docs/v4/` — 12 focused files covering
overview, request flow, skill registry, memory/privacy,
attachments/RAG, proactive intelligence, feedback, operations,
companion, dev plan, topics, and the v2 design review.

When updating architecture docs, edit the appropriate file under
`docs/v4/`. Do not edit anything in `docs/archive/`.
