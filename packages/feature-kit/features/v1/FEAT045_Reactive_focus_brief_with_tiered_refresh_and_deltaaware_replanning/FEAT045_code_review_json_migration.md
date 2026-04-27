# Code Review: Migrate remaining JSON files to DB

**Created:** 2026-04-14
**Reviewer:** Code Reviewer Agent
**Status:** APPROVED WITH COMMENTS

## Scope

Migrating 5 remaining JSON-file-backed modules to use DB queries when in libSQL mode: `chatHistory.ts`, `nudges.ts`, `annotations.ts`, `proactiveEngine.ts` (proactive_state), `tips.ts` (tips_state).

## Files Reviewed

| File | Change |
|------|--------|
| `src/modules/chatHistory.ts` | load/save branch on `isLibsqlMode()` |
| `src/modules/nudges.ts` | load/save branch on `isLibsqlMode()` |
| `src/modules/annotations.ts` | load/save branch on `isLibsqlMode()` |
| `src/modules/proactiveEngine.ts` | loadProactiveState/saveProactiveState branch |
| `src/modules/tips.ts` | loadTipsState/saveTipsState branch |
| `src/db/queries/kv.ts` | Added `loadKvGeneric`/`saveKvGeneric` exports |
| `scripts/api-proxy.js` | Added 5 files to cleanup list |

## Overall Status: APPROVED WITH COMMENTS

No bugs. Clean implementation. All DB tables and query files already existed — this was purely wiring.

## Correctness

- [x] All 5 modules correctly gate on `isLibsqlMode()` before using DB queries
- [x] JSON fallback preserved for non-DB setups
- [x] Data shapes match between module interfaces and DB query return types
- [x] Cleanup list updated to include all 5 files
- [x] No other files directly read/write these JSON files (verified via grep)
- [x] Proxy `/files` endpoint already had DB-aware handlers — no change needed
- [x] Type-check passes clean

## Issues Found and Fixed

**1. (FIXED) Unused destructuring in `loadProactiveState`**

Line 71 imported `saveKvGeneric` alongside `loadKvGeneric` but only used the latter. Removed the unused import.

## Comments (not blockers)

**1. `saveChatHistory` does DELETE + 200 inserts without a transaction**

`chatHistory.ts:22-26` — `clearChat()` then loops `insertMessage()` 200 times. Each is a separate DB call. If the process crashes mid-save, you get partial history. The same pattern exists in the DB query `saveNudges` (DELETE + N inserts).

This is pre-existing (the DB query files were written this way before this change) and not introduced by this migration. But worth noting as tech debt — wrapping in a transaction would make it atomic.

**2. `annotations` load returns `AnnotationRow[]` where `Annotation[]` is expected**

`AnnotationRow.targetType` is `string`, but `Annotation.targetType` is a union type. At runtime this is fine since the DB stores what the module wrote, but TypeScript doesn't enforce the union at the boundary. Acceptable for a single-user app.

**3. KV tables use DELETE + re-insert pattern**

`proactive_state` and `tips_state` use the generic `saveKv` which DELETEs all rows then re-inserts. For small KV stores (< 10 keys) this is fine. For larger ones it could be slow. Current data is well within this limit.

## Verification

- All JSON files deleted from data folder
- Data folder now contains only: `_vault.json`, `focus_brief.html`, `inbox.txt`, `lifeos_backup.db`
- `_vault.json` is used for encryption key verification (not data) — correct to keep
- `focus_brief.html` is a generated output — correct to keep
- `inbox.txt` is a user input file — correct to keep
