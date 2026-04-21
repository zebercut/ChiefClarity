/**
 * FEAT042 — Background indexer.
 *
 * Runs once at startup to embed all existing entities that don't have
 * embeddings yet. Also useful as a manual catch-up tool.
 *
 * Concurrency: proxy and headless-runner both call this at startup. A
 * file-based lock in DB_PATH prevents the second caller from racing on
 * writes (avoids SQLITE_BUSY). Stale locks older than LOCK_TTL_MS are
 * reclaimed so a crashed run doesn't wedge the indexer forever.
 */
import * as fs from "fs";
import * as path from "path";
import { findUnindexed, countEmbeddings } from "../../db/queries/embeddings";
import { getDb } from "../../db/index";
import { indexEntity } from "./indexer";

const LOCK_TTL_MS = 120_000;

function getLockPath(): string | null {
  const dbDir = process.env.DB_PATH || process.env.DATA_FOLDER_PATH;
  if (!dbDir) return null;
  return path.join(dbDir, ".indexer.lock");
}

function tryAcquireLock(): boolean {
  const lockFile = getLockPath();
  if (!lockFile) return true; // no path known — skip locking (web/capacitor)
  try {
    if (fs.existsSync(lockFile)) {
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (age < LOCK_TTL_MS) return false;
      fs.unlinkSync(lockFile);
    }
    fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  const lockFile = getLockPath();
  if (!lockFile) return;
  try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
}

interface IndexSource {
  type: string;
  table: string;
  idCol: string;
  textFn: (row: Record<string, unknown>) => Record<string, unknown>;
}

const SOURCES: IndexSource[] = [
  {
    type: "task",
    table: "tasks",
    idCol: "id",
    textFn: (r) => ({
      title: r.title,
      notes: r.notes,
      category: r.category,
      subcategory: r.subcategory,
    }),
  },
  {
    type: "event",
    table: "calendar_events",
    idCol: "id",
    textFn: (r) => ({ title: r.title, notes: r.notes, type: r.type }),
  },
  {
    type: "note",
    table: "notes",
    idCol: "id",
    textFn: (r) => ({ text: r.text }),
  },
  {
    type: "fact",
    table: "facts",
    idCol: "id",
    textFn: (r) => ({ text: r.text, topic: r.topic }),
  },
  {
    type: "observation",
    table: "user_observations",
    idCol: "id",
    textFn: (r) => ({ observation: r.observation, pattern: r.pattern }),
  },
];

/**
 * Index all unindexed entities. Returns the number of new embeddings created.
 * Safe to call multiple times — only processes items without embeddings.
 * If another process holds the indexer lock, this call is a no-op.
 */
export async function runBackgroundIndex(): Promise<number> {
  if (!tryAcquireLock()) {
    console.log("[bg-indexer] skipped — another process is indexing");
    return 0;
  }

  const db = getDb();
  let indexed = 0;
  const startTime = Date.now();

  try {
    for (const src of SOURCES) {
      const unindexed = await findUnindexed(src.type, src.table, src.idCol);
      if (unindexed.length === 0) continue;

      console.log(`[bg-indexer] ${src.type}: ${unindexed.length} unindexed`);
      for (const id of unindexed) {
        const rows = await db.execute({
          sql: `SELECT * FROM "${src.table}" WHERE "${src.idCol}" = ?`,
          args: [id],
        });
        if (rows.rows.length === 0) continue;
        await indexEntity(
          src.type,
          String(id),
          src.textFn(rows.rows[0] as Record<string, unknown>)
        );
        indexed++;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const total = await countEmbeddings();
    console.log(
      `[bg-indexer] done: ${indexed} new embeddings in ${elapsed}s (total: ${total})`
    );
    return indexed;
  } finally {
    releaseLock();
  }
}
