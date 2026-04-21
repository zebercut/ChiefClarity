# Code Review: DB local path + backup + JSON cleanup + TaskDetail extraction + Setup wizard

**Created:** 2026-04-13
**Reviewer:** Code Reviewer Agent
**Status:** CHANGES REQUIRED
**Scope:** DB_PATH migration, backup/restore, JSON cleanup, TaskDetailSlideOver shared component, focus.tsx task detail, setup wizard

## Files Reviewed

| File | Change |
|------|--------|
| `scripts/api-proxy.js` | DB_PATH support, auto-migration, JSON cleanup, backup wiring |
| `scripts/headless-runner.js` | DB_PATH support, auto-migration, backup wiring |
| `scripts/db-backup.js` | New — backup utility (module + CLI) |
| `scripts/restore-db.js` | New — restore script |
| `src/components/TaskDetailSlideOver.tsx` | New — extracted shared component |
| `src/components/focus/TaskList.tsx` | Added `onTaskPress` prop |
| `app/(tabs)/focus.tsx` | Task detail slide-over integration |
| `app/(tabs)/tasks.tsx` | Removed inline TaskDetailSlideOver, imports shared |
| `app/setup.tsx` | New "dbpath" step, `getDefaultDbPath()`, config includes `dbPath` |
| `src/types/index.ts` | `dbPath?` added to AppConfig |
| `.env.example` | DB_PATH documentation |

---

## Overall Status

**CHANGES REQUIRED** (2 bugs, 2 issues)

---

## Correctness

- [x] DB_PATH correctly used in both proxy and headless runner
- [x] Auto-migration copies DB from cloud to local on first run
- [x] Backup uses temp-file-then-rename for atomicity
- [x] Restore uses .old rollback pattern
- [x] JSON cleanup deletes correct set of files
- [x] TaskDetailSlideOver extracted with full functionality preserved
- [x] Focus tab opens task detail on title tap
- [x] Setup wizard saves dbPath to config and .env

---

## Bugs

### Bug #1 (MUST FIX): `focus.tsx` handleTaskUpdate mutates state directly

**focus.tsx:136** — `Object.assign(task, patch)` mutates the task object in-place without creating a new state reference. React won't re-render the TaskList because `appState` is the same reference.

Compare with `tasks.tsx:314-326` which correctly creates a new immutable state:
```typescript
const next: AppState = {
  ...prev,
  tasks: { ...prev.tasks, tasks: prev.tasks.tasks.map((t) => t.id === taskId ? { ...t, ...patch } : t) },
};
```

The focus.tsx version mutates in-place and only does `setBrief({...})` — the task list itself won't visually update until the next full reload.

**Fix:** Use `setAppState` with immutable update, same pattern as `tasks.tsx`:
```typescript
async function handleTaskUpdate(taskId: string, patch: Partial<Task>) {
  if (!appState) return;
  const updated = {
    ...appState,
    tasks: {
      ...appState.tasks,
      tasks: appState.tasks.tasks.map((t) => t.id === taskId ? { ...t, ...patch } : t),
    },
  };
  updated._dirty = new Set(appState._dirty);
  updated._dirty.add("tasks");
  setAppState(updated);
  try {
    await flush(updated);
    setBrief({ ...updated.focusBrief });
  } catch {}
}
```

### Bug #2 (MUST FIX): Backup can copy a partially-written DB

**db-backup.js:50** — `fs.copyFileSync` copies the DB file while SQLite may be in the middle of a write (WAL mode, journal). The comment says "safe as long as we're the only writer (the .headless.lock ensures this)" — but:

1. The proxy does NOT use `.headless.lock` — only the headless runner does
2. Both proxy AND headless runner start backup intervals, so if both are running, two backup timers race
3. Even with a single process, `fs.copyFileSync` during an active SQLite transaction can produce a corrupt copy

**Fix options (choose one):**
- (a) Use SQLite's built-in backup: `VACUUM INTO '/path/to/backup.db'` via `getDb().execute()` — requires the DB to be open. Pass the open DB handle to the backup function.
- (b) Acquire the `.headless.lock` before copying and skip if locked (prevents concurrent backup, but still risky during active transactions)
- (c) Use SQLite's `.backup` API if the libsql client exposes it

Recommendation: **(a)** is safest. Modify `runBackup` to accept an optional `db` parameter. When provided, use `VACUUM INTO`. When running as CLI without a DB handle, fall back to file copy.

---

## Security

### Issue: JSON cleanup deletes files without confirmation

**api-proxy.js:250-274** — On every startup when DB is open, `cleanupStaleJsonFiles` silently deletes 20 JSON files. If the DB was actually empty/corrupt (e.g., wrong passphrase opened an empty DB), this destroys the only remaining data.

**Severity:** Medium — single-user app, but data loss risk.

**Fix:** Before cleanup, verify the DB actually has data:
```javascript
function cleanupStaleJsonFiles(dataRoot) {
  // Safety: verify DB has data before deleting JSON files
  try {
    const { getDb } = require("../src/db/index");
    const db = getDb();
    const result = db.execute("SELECT COUNT(*) as c FROM tasks");
    if (result.rows[0].c === 0) {
      console.warn("[proxy] DB appears empty — skipping JSON cleanup to preserve data");
      return;
    }
  } catch { return; }
  // ... rest of cleanup
}
```

---

## Performance

- Issues found: None
- Backup is async and non-blocking
- JSON cleanup runs once at startup, O(20) file checks

---

## Architecture Compliance

- [x] DB_PATH follows existing env var pattern
- [x] Backup utility is a standalone module — reusable by both proxy and headless
- [x] TaskDetailSlideOver correctly extracted with dependency injection (callbacks)
- [x] Setup wizard follows existing step pattern

### Issue: Duplicate backup timers when proxy + headless run simultaneously

Both `api-proxy.js:631-633` and `headless-runner.js:543-545` start independent backup intervals. If both processes are running (which is the normal setup — proxy for web, headless for cron), two backup timers race to write `lifeos_backup.db`.

The temp-file-then-rename pattern prevents corruption, but one backup always "wins" and the other's write is wasted I/O.

**Fix:** Only run backup in ONE process. The headless runner is the natural choice since it already has cron scheduling. Remove the backup interval from the proxy, OR add a flag file (`.backup.lock`) to skip if another process recently backed up.

---

## Code Quality

- [x] Comments explain "why" not "what"
- [x] Consistent error handling patterns
- [x] db-backup.js works as both module and CLI
- [x] restore-db.js has clear output and rollback

### Minor:

1. **JSDoc says "VACUUM INTO" but implementation uses `fs.copyFileSync`** (db-backup.js:4-5). The doc header is misleading.

2. **`getDefaultDbPath()` in setup.tsx uses `process.env`** which may not exist in all web contexts. The `typeof process !== "undefined"` guard handles this, but the fallback `"C:/Users/YOU/.lifeos"` is not useful — it would write to a literal path with "YOU" in it if someone submits without editing. Should use an empty string as fallback so the placeholder is shown.

---

## Testability

- [x] `runBackup` is a pure async function — testable with temp directories
- [x] `cleanupStaleJsonFiles` is a standalone function — testable
- [x] TaskDetailSlideOver is self-contained — testable with mock callbacks

---

## Required Changes

1. **[MUST] Fix focus.tsx handleTaskUpdate to use immutable state update** — see Bug #1 fix above

2. **[MUST] Add DB data verification before JSON cleanup** — check that at least one table has rows before deleting JSON files

3. **[SHOULD] Fix db-backup.js doc header** — remove "VACUUM INTO" claim, state it uses file copy

4. **[SHOULD] Fix getDefaultDbPath fallback** — return empty string instead of `"C:/Users/YOU/.lifeos"`

---

## Optional Suggestions

1. Run backup only in the headless runner, not both processes
2. Add a `--confirm` flag to restore-db.js for safety (currently restores without prompting)
3. After migrating DB from cloud to local, rename the old cloud copy to `lifeos.db.migrated` instead of leaving it (prevents the proxy from re-opening the stale cloud copy if DB_PATH is later unset)

---

## Patterns to Capture

### For AGENTS.md
- **SQLite files must not live on cloud-synced folders.** Google Drive, OneDrive, and Dropbox lock files during sync, which conflicts with SQLite's locking protocol. Always use a local path for the live DB and back up to the cloud folder as a separate step.
- **Verify data exists before deleting legacy formats.** When migrating from one storage format to another (JSON → DB), verify the new format actually contains data before cleaning up the old format. An empty/corrupt DB + deleted JSON = total data loss.

### For coding rules
- **Immutable state updates in React.** Never use `Object.assign(stateObj, patch)` to update React state — it mutates in-place without triggering re-renders. Always create a new object via spread: `{ ...state, field: { ...state.field, ...patch } }`.
