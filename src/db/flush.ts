/**
 * FEAT041 — DB flush: persists dirty AppState slices to libSQL.
 *
 * This module is Node-only. It is injected into the executor via
 * injectDbFunctions() at startup by the proxy/headless runner.
 * Metro never sees this file (blocked by metro.config.js).
 */
import { getDb } from "./index";
import { indexEntity, fileKeyToSourceType } from "../modules/embeddings/indexer";
import { linkTask, linkEvent } from "../modules/embeddings/linker";
import { insertTask } from "./queries/tasks";
import { insertEvent } from "./queries/calendar";
import { insertNote } from "./queries/notes";
import { insertRecurring } from "./queries/recurring";
import { saveOkrDashboard } from "./queries/okr";
import { saveContextMemory } from "./queries/context-memory";
import { saveObservations } from "./queries/observations";
import { saveTopics } from "./queries/topics";
import { saveSuggestions } from "./queries/suggestions";
import { saveLearning } from "./queries/learning";
import { saveProfile, saveLifestyle } from "./queries/kv";
import { saveSnapshot } from "./queries/snapshots";
import { saveFileSummary } from "./queries/summaries";
import type { AppState, FileKey } from "../types";

async function txRewrite(
  deleteStmt: string,
  rows: unknown[],
  inserter: (row: any) => Promise<void>,
  summary?: { key: string; text: string }
): Promise<void> {
  const db = getDb();
  await db.execute("BEGIN");
  try {
    await db.execute(deleteStmt);
    for (const row of rows) await inserter(row);
    if (summary) await saveFileSummary(summary.key, summary.text);
    await db.execute("COMMIT");
  } catch (err) {
    await db.execute("ROLLBACK");
    throw err;
  }
}

const snapshotKeys = new Set([
  "hotContext", "summaries", "planNarrative", "planAgenda", "planRisks",
  "focusBrief", "contentIndex", "contradictionIndex", "feedbackMemory",
]);

const collectionSavers: Partial<Record<FileKey, (data: any) => Promise<void>>> = {
  tasks: async (data) => {
    await txRewrite(
      "DELETE FROM tasks", data.tasks || [], insertTask,
      data._summary ? { key: "tasks", text: data._summary } : undefined
    );
  },
  calendar: async (data) => {
    await txRewrite(
      "DELETE FROM calendar_events", data.events || [], insertEvent,
      data._summary ? { key: "calendar", text: data._summary } : undefined
    );
  },
  notes: async (data) => {
    await txRewrite(
      "DELETE FROM notes", data.notes || [], insertNote,
      data._summary ? { key: "notes", text: data._summary } : undefined
    );
  },
  recurringTasks: async (data) => {
    await txRewrite("DELETE FROM recurring_tasks", data.recurring || [], insertRecurring);
  },
  planOkrDashboard: async (data) => { await saveOkrDashboard(data); },
  contextMemory: async (data) => { await saveContextMemory(data); },
  userObservations: async (data) => { await saveObservations(data); },
  topicManifest: async (data) => { await saveTopics(data); },
  suggestionsLog: async (data) => { await saveSuggestions(data); },
  learningLog: async (data) => { await saveLearning(data); },
  userProfile: async (data) => { await saveProfile(data); },
  userLifestyle: async (data) => { await saveLifestyle(data); },
};

export async function flushToDb(state: AppState): Promise<void> {
  const dirtyKeys = Array.from(state._dirty);
  if (dirtyKeys.length === 0) return;

  const failures: { key: FileKey; error: any }[] = [];

  for (const key of dirtyKeys) {
    const data = (state as any)[key];
    if (data === undefined) continue;

    try {
      if (collectionSavers[key]) {
        await collectionSavers[key]!(data);
      } else if (snapshotKeys.has(key)) {
        await saveSnapshot(key, data);
      } else {
        console.warn(`[flush-db] unknown dirty key: ${key}`);
        continue;
      }
      state._dirty.delete(key);

      // FEAT042: index written entities + run linker (non-blocking)
      const srcType = fileKeyToSourceType(key);
      if (srcType && data) {
        indexAndLink(key, srcType, data).catch(() => {});
      }
    } catch (err: any) {
      failures.push({ key, error: err });
      console.error(`[flush-db] write failed for ${key}:`, err?.message || err);
    }
  }

  if (failures.length > 0) {
    const summary = failures
      .map((f) => `  • ${f.key}: ${f.error?.message || f.error}`)
      .join("\n");
    const err: any = new Error(`[flush-db] ${failures.length} write(s) failed:\n${summary}`);
    err.failures = failures;
    throw err;
  }
}

/**
 * FEAT042: Index entities after flush + run cross-domain linker.
 *
 * Skip full-collection flushes (DELETE-all + re-insert) — the background
 * indexer at startup handles catch-up for those. Only index when a small
 * number of items changed (likely a single add/update from a chat turn).
 */
async function indexAndLink(
  fileKey: string,
  sourceType: string,
  data: any
): Promise<void> {
  try {
    let items: Array<Record<string, unknown>> = [];
    if (fileKey === "tasks") items = data.tasks || [];
    else if (fileKey === "calendar") items = data.events || [];
    else if (fileKey === "notes") items = data.notes || [];

    // Full-collection flush (> 20 items) = bulk rewrite, skip inline indexing.
    // The background indexer will catch any missing embeddings on next startup.
    if (items.length > 20) return;

    for (const item of items) {
      const id = String(item.id || "");
      if (!id) continue;

      // Index and get the vector back for reuse by the linker
      const vec = await indexEntity(sourceType, id, item);

      // Run cross-domain linker, passing the precomputed vector
      const text = [item.title, item.notes, item.text, item.category]
        .filter(Boolean)
        .join(" ");
      if (sourceType === "task" && text) {
        await linkTask(id, text, vec);
      } else if (sourceType === "event" && text) {
        await linkEvent(id, text, vec);
      }
    }
  } catch (err: any) {
    console.warn(`[flush-db] indexing failed for ${fileKey}:`, err?.message);
  }
}
