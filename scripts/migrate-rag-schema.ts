/**
 * FEAT068 — RAG schema migration (PERMANENT).
 *
 * Creates the sibling `rag_chunks` table required by the
 * `LibsqlVectorStore` backend on Node. Idempotent — running twice is a
 * no-op. Reuses the existing `embeddings` table from FEAT042 (migration
 * 0002) for the actual vectors, so this script only adds the
 * chunk-level identity table.
 *
 * Run on every fresh-clone Node setup (per FEAT068 cond. 16):
 *
 *   npx ts-node scripts/migrate-rag-schema.ts
 *
 * Reads the DB path from env (DB_PATH, then DATA_FOLDER_PATH) — same
 * lookup the proxy/headless runner uses.
 */

import * as fs from "fs";
import * as path from "path";

function loadDotEnv(): void {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf-8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadDotEnv();

async function main(): Promise<void> {
  const dbDir = process.env.DB_PATH || process.env.DATA_FOLDER_PATH;
  if (!dbDir) {
    console.error(
      "[migrate-rag-schema] DB_PATH (or DATA_FOLDER_PATH) not set. Set it in .env or env."
    );
    process.exit(2);
  }
  const passphrase = process.env.DB_PASSPHRASE || "";

  const { openDatabase, getDb, closeDatabase } = await import("../src/db/index");
  const dbFile = path.join(dbDir, "lifeos.db");
  console.log(`[migrate-rag-schema] opening ${dbFile}`);
  await openDatabase(dbFile, passphrase);
  const db = getDb();

  // Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      chunk_id    TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      source_id   TEXT NOT NULL,
      text        TEXT NOT NULL,
      model_id    TEXT NOT NULL,
      indexed_at  TEXT NOT NULL
    )
  `);
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(source, source_id)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_rag_chunks_modelid ON rag_chunks(model_id)"
  );

  // Backfill rag_chunks from existing FEAT042 embeddings rows so the
  // first run doesn't lose visibility into pre-existing entities. Only
  // the chunk-level identity is synthesized — text is empty (the
  // info_lookup retriever joins back via source/source_id, and the
  // backfill walker re-indexes with real text on first boot).
  const existing = await db.execute(
    "SELECT source_type, source_id FROM embeddings"
  );
  const indexedAt = new Date().toISOString();
  for (const row of existing.rows) {
    const source = row.source_type as string;
    const sourceId = row.source_id as string;
    const chunkId = `${source}:${sourceId}`;
    await db.execute({
      sql: `INSERT OR IGNORE INTO rag_chunks (chunk_id, source, source_id, text, model_id, indexed_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [chunkId, source, sourceId, "", "unknown", indexedAt],
    });
  }
  const after = await db.execute("SELECT COUNT(*) AS c FROM rag_chunks");
  const inserted = Number(after.rows[0].c);

  console.log(
    `[migrate-rag-schema] OK — rag_chunks ready; total chunks (incl. existing): ${inserted}.`
  );
  await closeDatabase();
}

main().catch((err) => {
  console.error("[migrate-rag-schema] failed:", err);
  process.exit(1);
});
