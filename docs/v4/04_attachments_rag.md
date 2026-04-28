# Chief Clarity v4 — Attachments & RAG

The system accepts files, links, and pasted content as inputs. RAG is applied
selectively based on the attachment's lifetime and the skill's declared needs.
Zero LLM calls during ingestion (except the optional one-time batch summarizer).

**Status (FEAT067 unblock):** The query-side embedder now runs on the web
bundle via the in-browser xenova/onnxruntime-web WASM path. RAG (FEAT068) was
blocked on the missing web embedder and is now buildable on the same surface
the user runs the app on. Index-side and query-side both pin
`MODEL_ID = "Xenova/all-MiniLM-L6-v2"` (384-dim) — change `MODEL_ID` to force
re-indexing.

---

## 1. Attachment lifetimes

Every attachment is classified into one of four lifetimes at ingestion:

| Lifetime | Storage | Expiry | Use case |
|---|---|---|---|
| **Ephemeral** | RAM only | After response | "Read this article and give me the key points" |
| **Session** | RAM | N hours of inactivity | "Use this PDF for the next few questions" |
| **Persistent** | Vector DB | Never (user deletes) | "Remember this — it's my company handbook" |
| **Live** | Vector DB + scheduled re-fetch | Until user removes | "Watch this Google Sheet — it's my project tracker" |

**Default: Ephemeral.** Promotion to a higher lifetime requires explicit user action
(a "Remember this" button or a phrase like "save this to my library"). The system
never silently persists attachments.

---

## 2. Supported input types

| Type | Parser | Notes |
|---|---|---|
| PDF | `pdf-parse` | Text extraction; tables preserved as structured text |
| XLSX / XLS | `xlsx` library | Rows → JSON; headers extracted as chunk metadata |
| CSV | Node built-in | Rows → JSON; same as XLSX treatment |
| Plain text / markdown | Direct | No parser needed |
| URL (article) | `fetch` + `@mozilla/readability` | Extracts readable content, strips nav/ads |
| URL (Google Sheets) | `integrations/registry.ts` Google Sheets API | Fetches rows; supports live lifetime |
| URL (Notion) | `integrations/registry.ts` Notion API | Fetches page; supports live lifetime |
| Image | Deferred (Phase 6) | Stored but not parsed at ingestion in v4 |

---

## 3. Ingestion pipeline

Runs on attachment drop, paste, or link submission. All TypeScript. Zero LLM calls.

```
Attachment received
        │
        ▼
[TS] Type Detector
  MIME type / extension / URL pattern
  → attachmentType

        │
        ▼
[TS] Parser (per type)
  PDF → text + page numbers
  XLSX/CSV → { headers, rows[] }
  URL article → { title, author, content, publishedAt }
  URL live → { source, rows[], fetchedAt }
  → normalizedContent + metadata

        │
        ▼
[TS] Lifetime Classifier
  Check: did user tap "Remember this"? → persistent
  Check: is source a live integration? → live
  Check: did user mention "for now / just this question"? → ephemeral
  Default: ephemeral
  → lifetime tag

        │ (skip if ephemeral + content < 3000 tokens)
        ▼
[TS] Chunker
  Semantic chunking: ~400 tokens per chunk, 50-token overlap
  Tables: rows kept atomic — never split across chunks
  Each chunk tagged with:
    { attachmentId, chunkIndex, sourceMetadata, schemaCategory, lifetime }
  → chunks[]

        │
        ▼
[TS] Embedder (local bge-m3)
  Embed each chunk
  → embeddings[]

        │
        ▼
[TS] Attachment Store
  If ephemeral: store in memory (Map keyed by session id)
  If session/persistent/live: write to attachment_chunks table
  → stored, acknowledged to user

Acknowledgment: "Indexed [filename] — [N] sections ready."
```

---

## 4. RAG retrieval at query time (Assembler)

When a skill declares `attachmentChunks` in its context requirements:

```
[TS] Assembler at query time:
  1. Embed user phrase (already done by Orchestrator, cached for this turn)
  2. Query attachment store:
     - Scope: ephemeral (current session) + session + persistent attachments
     - Filter: schemaCategory must be in skill.manifest.dataSchemas.read
     - Similarity threshold: > 0.65
     - Max chunks: skill-declared limit (e.g., 5)
  3. Apply token budget cap (e.g., max 1500 tokens from attachments)
  4. Include top-K chunks in context blob, each with source citation metadata

Chunk included in context:
  {
    content: "...",
    source: "Company Handbook, page 17",
    similarity: 0.83
  }
```

A 50 MB spreadsheet contributes ~600 tokens to the prompt. Cost stays flat regardless
of attachment size. This is the point of chunked retrieval.

---

## 5. Large-document summarization (batch, at ingestion)

Edge case: user uploads a 100-page PDF and asks "summarize the whole thing."

This cannot be done in a single LLM call. It is treated as a **batch ingestion task**,
not an interactive turn. Runs once at ingestion; future queries use the summary chunk.

```
[TS] Detect: user intent = "summarize" AND total tokens > model context limit

[Parallel Haiku calls, TypeScript-orchestrated]
  Map: one Haiku call per ~4000-token chunk → chunk summary
  These run in parallel, not serial

[One final Haiku call]
  Reduce: merge chunk summaries → document-level summary

[TS] Store summary as special chunk:
  { chunkType: "doc_summary", content: summary, attachmentId, ... }
  Prioritized over regular chunks in future retrieval

Acknowledgment: "Summarized [filename] — [N] pages condensed."
```

This is the one legitimate exception to the single-call rule. It happens once per
document at ingestion. Every subsequent interactive query is single-call.

---

## 6. Live attachments (scheduled re-fetch)

Live attachments (Google Sheets, Notion pages, live URLs) are re-fetched on schedule.

```
[Headless runner — configurable interval, default: hourly]
  For each live attachment:
    1. Fetch latest version via integrations/registry.ts
    2. Compute content hash
    3. If hash unchanged → skip (no re-embedding)
    4. If changed:
       a. Diff: identify new/changed/removed rows or sections
       b. Re-chunk only changed sections
       c. Delete old embeddings for changed sections
       d. Re-embed changed chunks
       e. Update attachment_chunks table
       f. Log re-sync event
```

Zero LLM calls. Pure TypeScript + local embedder.

User can force a manual refresh via a "Sync now" button, which triggers the same flow
immediately outside the scheduled interval.

---

## 7. Skill manifest for attachments

Skills that accept attachments declare it in their manifest:

```jsonc
{
  "id": "data_analysis",
  "supportsAttachments": ["csv", "xlsx", "tabular_url"],
  "dataSchemas": {
    "read": ["tasks", "attachments:work_reference"],
    "write": ["notes"]
  }
}
```

Skills that do not declare `supportsAttachments` never receive attachment chunks,
even if the user attached a file in the same session. The Assembler enforces this.

---

## 8. End-to-end example

User drops a company handbook PDF, then asks: "What is the parental leave policy?"

```
T=0ms      PDF dropped
T=20ms     [TS] Detect: PDF
T=200ms    [TS] Parse: 12,000 tokens of text
T=210ms    [TS] Classify: user tapped "Remember this" → persistent
T=600ms    [TS] Chunk: 30 chunks @ ~400 tokens
T=2400ms   [TS] Embed: 30 chunks via bge-m3
T=2500ms   [TS] Store in attachment_chunks (schemaCategory: work_reference)
T=2510ms   Acknowledgment: "Indexed handbook — 30 sections."

[User asks "What is the parental leave policy?"]

T=0ms      Phrase arrives
T=5ms      [TS] Orchestrator: embed phrase → "research" or "notes" skill
T=210ms    [TS] Assembler: top-3 chunks from handbook
           chunk 1: "Parental Leave — page 17..." (similarity 0.91)
           chunk 2: "Benefits Overview — page 12..." (similarity 0.74)
           chunk 3: "Leave Policies — page 16..." (similarity 0.71)
           total: ~1200 tokens from attachment
T=220ms    [ONE LLM CALL — Haiku]
T=1200ms   Response: "Per your handbook (page 17): ..."
           Citation includes page number from chunk metadata.
```

One LLM call. RAG used. Token cost flat. Cited source.
