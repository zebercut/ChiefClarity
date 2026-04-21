import { readJsonFile, writeJsonFile } from "../utils/filesystem";
import { isLibsqlMode } from "./loader";
import { nowLocalIso } from "../utils/dates";
import type { Nudge } from "./proactiveEngine";

// Dynamic require hidden from Metro's static resolver
// eslint-disable-next-line no-eval
const lazyRequire = (path: string) => eval("require")(path);

const NUDGES_FILE = "nudges.json";
const MAX_PER_SESSION = 3;

export interface NudgesFile {
  nudges: Nudge[];
  lastRunAt: string;
}

// ─── Async mutex to prevent concurrent read-modify-write ──────────────────

let _lock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const prev = _lock;
  _lock = next;
  return prev.then(fn).finally(() => release!());
}

// ─── Core functions (all wrapped in mutex) ────────────────────────────────

export async function loadNudges(): Promise<NudgesFile> {
  if (isLibsqlMode()) {
    const { loadNudges: loadFromDb } = lazyRequire("../db/queries/nudges");
    const rows = await loadFromDb();
    return {
      nudges: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        priority: r.priority,
        message: r.message,
        actions: r.actions || [],
        relatedId: r.relatedId || undefined,
        createdAt: r.createdAt,
        shownAt: r.shownAt,
        dismissedAt: r.dismissedAt,
      })),
      lastRunAt: rows.length > 0 ? rows[0].createdAt : "",
    };
  }
  const data = await readJsonFile<NudgesFile>(NUDGES_FILE);
  return data ?? { nudges: [], lastRunAt: "" };
}

export async function saveNudges(file: NudgesFile): Promise<void> {
  if (isLibsqlMode()) {
    const { saveNudges: saveToDb } = lazyRequire("../db/queries/nudges");
    await saveToDb(file.nudges.map((n) => ({
      id: n.id,
      type: n.type,
      priority: n.priority,
      message: n.message,
      actions: n.actions || [],
      relatedId: n.relatedId || null,
      createdAt: n.createdAt,
      shownAt: n.shownAt || null,
      dismissedAt: n.dismissedAt || null,
    })));
    return;
  }
  await writeJsonFile(NUDGES_FILE, file);
}

/**
 * Write new nudges from the proactive engine.
 * Deduplicates by id. Preserves existing unshown nudges.
 */
export function writeNudges(newNudges: Nudge[]): Promise<void> {
  return withLock(async () => {
    const file = await loadNudges();

    // Remove dismissed nudges older than 7 days
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    file.nudges = file.nudges.filter(
      (n) => !n.dismissedAt || n.dismissedAt > cutoff
    );

    // Merge: add new nudges that don't already exist
    const existingIds = new Set(file.nudges.map((n) => n.id));
    for (const nudge of newNudges) {
      if (!existingIds.has(nudge.id)) {
        file.nudges.push(nudge);
      }
    }

    file.lastRunAt = nowLocalIso();
    await saveNudges(file);
  });
}

/**
 * Get unshown nudges for display in the app.
 * Returns up to MAX_PER_SESSION, sorted by priority.
 * Marks them as shown.
 */
export function getUnshownNudges(): Promise<Nudge[]> {
  return withLock(async () => {
    const file = await loadNudges();
    const unshown = file.nudges.filter((n) => !n.shownAt && !n.dismissedAt);

    const order: Record<string, number> = { urgent: 0, important: 1, helpful: 2 };
    unshown.sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));

    const toShow = unshown.slice(0, MAX_PER_SESSION);
    const now = nowLocalIso();

    for (const nudge of toShow) {
      nudge.shownAt = now;
    }

    if (toShow.length > 0) {
      await saveNudges(file);
    }

    return toShow;
  });
}

/**
 * Dismiss a nudge by id.
 */
export function dismissNudge(nudgeId: string): Promise<void> {
  return withLock(async () => {
    const file = await loadNudges();
    const nudge = file.nudges.find((n) => n.id === nudgeId);
    if (nudge) {
      nudge.dismissedAt = nowLocalIso();
      await saveNudges(file);
    }
  });
}
