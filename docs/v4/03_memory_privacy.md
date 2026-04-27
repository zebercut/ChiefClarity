# Chief Clarity v4 — Memory & Privacy

---

## 1. Vector Database

**Stack:** SQLite + sqlite-vss extension + local bge-m3 embeddings (already in `src/modules/embeddings/`)  
**Location:** `DB_PATH` (local path, never on cloud drive — see CLAUDE.md)  
**Backup:** Hourly copy to cloud folder via headless runner

### Roles in v4 (expanded from v3)

| Role | How used | Who calls it |
|---|---|---|
| **Semantic memory** | Retrieve past tasks, notes, decisions relevant to current phrase | Assembler |
| **Skill matching** | Score user phrase against skill description embeddings | Orchestrator |
| **Conflict detection** | Find prior agreements/decisions contradicting current request | Assembler |
| **Attachment chunks** | Store and retrieve ingested file/URL content | Attachment Store |
| **Nudge memory** | Store surfaced nudges + user response signals | Nudge Filter / Self-Scorer |
| **Sensor signals** | Store raw sensor outputs for Synthesizer consumption | Signal Sensors |

### Schema additions (new tables in v4)

```sql
-- Attachment chunks
CREATE TABLE attachment_chunks (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  chunk_index INTEGER,
  source_metadata TEXT,       -- JSON: title, page, row_range, url
  schema_category TEXT,       -- e.g. "work_reference", "medical", "personal"
  lifetime TEXT NOT NULL,     -- "ephemeral" | "session" | "persistent" | "live"
  expires_at TEXT,            -- null for persistent
  created_at TEXT NOT NULL
);

-- Nudge memory
CREATE TABLE nudges (
  id TEXT PRIMARY KEY,
  sensor_type TEXT NOT NULL,
  observation TEXT NOT NULL,
  proposed_action TEXT,
  skill_to_invoke TEXT,
  confidence REAL,
  surfaced_at TEXT,
  user_response TEXT,         -- "acted" | "snoozed" | "dismissed" | "ignored" | null
  responded_at TEXT
);

-- Sensor signal log
CREATE TABLE sensor_signals (
  id TEXT PRIMARY KEY,
  sensor_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  payload TEXT NOT NULL,      -- JSON
  score REAL,                 -- severity/urgency
  created_at TEXT NOT NULL,
  consumed_at TEXT            -- null until Synthesizer processes
);

-- Pending improvements
CREATE TABLE pending_improvements (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,       -- "instant_feedback" | "nightly_evaluator" | "pattern_learner"
  target_type TEXT NOT NULL,  -- "skill_prompt" | "sensor_config" | "policy" | "new_skill_stub"
  target_id TEXT,             -- skill id or sensor id
  diff TEXT NOT NULL,         -- unified diff or JSON patch
  rationale TEXT NOT NULL,
  status TEXT NOT NULL,       -- "pending" | "approved" | "rejected"
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

---

## 2. Data Schema Registry

**File:** `src/config/data_schemas.json`  
**Purpose:** Defines all data categories in the system and their default access policies. Enforced by the Assembler at retrieval time — restricted data is never assembled, never passed to the LLM.

### Schema definition format

```jsonc
{
  "categories": {
    "tasks": {
      "label": "Tasks & To-Dos",
      "defaultReadSkills": ["task_management", "priority_planning", "daily_planning", "weekly_planning", "inbox_triage"],
      "defaultWriteSkills": ["task_management", "daily_planning"],
      "sensitive": false
    },
    "calendar": {
      "label": "Calendar & Schedule",
      "defaultReadSkills": ["calendar", "daily_planning", "weekly_planning", "priority_planning"],
      "defaultWriteSkills": ["calendar"],
      "sensitive": false
    },
    "objectives": {
      "label": "Goals & Objectives",
      "defaultReadSkills": ["priority_planning", "daily_planning", "weekly_planning", "emotional_checkin"],
      "defaultWriteSkills": ["daily_planning"],
      "sensitive": false
    },
    "notes:work": {
      "label": "Work Notes",
      "defaultReadSkills": ["notes", "research", "priority_planning", "daily_planning"],
      "defaultWriteSkills": ["notes"],
      "sensitive": false
    },
    "notes:personal": {
      "label": "Personal Notes",
      "defaultReadSkills": ["notes", "emotional_checkin"],
      "defaultWriteSkills": ["notes"],
      "sensitive": true
    },
    "medical": {
      "label": "Health & Medical",
      "defaultReadSkills": [],
      "defaultWriteSkills": [],
      "sensitive": true,
      "requiresExplicitGrant": true
    },
    "financial": {
      "label": "Financial Records",
      "defaultReadSkills": [],
      "defaultWriteSkills": [],
      "sensitive": true,
      "requiresExplicitGrant": true
    },
    "family": {
      "label": "Family Information",
      "defaultReadSkills": ["emotional_checkin", "daily_planning"],
      "defaultWriteSkills": [],
      "sensitive": true
    },
    "observations": {
      "label": "Behavioral Observations",
      "defaultReadSkills": ["priority_planning", "emotional_checkin", "daily_planning"],
      "defaultWriteSkills": [],
      "sensitive": false
    },
    "topics": {
      "label": "Topics (themes aggregating tasks, notes, events, facts)",
      "defaultReadSkills": ["topics", "daily_planning", "weekly_planning", "priority_planning", "notes", "research"],
      "defaultWriteSkills": ["topics", "notes", "task_management", "calendar", "inbox_triage"],
      "sensitive": false
    },
    "attachments:work_reference": {
      "label": "Work Reference Documents",
      "defaultReadSkills": ["research", "notes", "priority_planning"],
      "defaultWriteSkills": [],
      "sensitive": false
    },
    "attachments:personal": {
      "label": "Personal Attachments",
      "defaultReadSkills": ["notes"],
      "defaultWriteSkills": [],
      "sensitive": true
    }
  }
}
```

### User overrides

The user can grant or revoke access per skill via the Settings UI:

```jsonc
// src/config/user_policy_overrides.json (gitignored, user-specific)
{
  "grants": [
    { "skill": "daily_planning", "category": "medical", "grantedAt": "..." }
  ],
  "revocations": [
    { "skill": "emotional_checkin", "category": "family", "revokedAt": "..." }
  ]
}
```

Policy resolution order: user overrides > category defaults.

---

## 3. Access control enforcement

### At retrieval time (Assembler)

```
For each context requirement declared by skill.context.ts:
  1. Identify data category (e.g., recentNotes → "notes:work" or "notes:personal")
  2. Check: does skill.manifest.dataSchemas.read include this category?
  3. Check: does user_policy_overrides revoke it?
  4. If denied → exclude from query entirely (not fetched, not truncated, not present)
  5. If allowed → fetch and include
```

Sensitive categories (`medical`, `financial`) with `requiresExplicitGrant: true` are
excluded unless the user has explicitly granted access. The Assembler never passes
these to the LLM speculatively.

### At write time (Executor)

```
Before skill.handlers.* write:
  1. Check skill.manifest.dataSchemas.write includes target category
  2. Check user_policy_overrides
  3. If denied → throw PermissionDeniedError, do not write, surface to user
  4. If allowed → write via filesystem.ts (atomic)
```

### Audit log

Every data access is logged (read + write):

```ts
{
  timestamp: string;
  skillId: string;
  operation: "read" | "write";
  category: string;
  rowCount?: number;
  tokensUsed?: number;
  userPhrase_hash: string;  // hashed, not stored in plain text
}
```

Audit log is append-only. No skill can delete its own audit entries.

---

## 4. Encryption at rest

- Vector DB (SQLite) encrypted with SQLCipher using user-controlled key
- Key stored in OS keychain (not in the repo, not in any config file)
- Backup copies inherit the same encryption
- Key rotation: user-initiated via Settings

---

## 5. Privacy guarantees by design

| Threat | Mitigation |
|---|---|
| Calendar skill reads medical notes | Data Schema Registry blocks at retrieval — medical never assembled for calendar |
| Attachment leaks sensitive data across skills | Attachment chunks tagged with schema_category, same policy enforcement |
| LLM receives more context than needed | Per-skill token budget + strict requirement declarations in context.ts |
| Audit trail can be tampered with | Append-only audit log, written via filesystem.ts (no skill can call audit directly) |
| Cloud backup exposes data | DB encrypted before backup, key never leaves device |
| New skill requests access to sensitive data | requiresExplicitGrant categories block auto-access; user must grant explicitly |
