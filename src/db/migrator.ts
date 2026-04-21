/**
 * FEAT041 — Schema migration runner.
 *
 * Reads .sql files from src/db/migrations/ in order, applies unapplied ones,
 * and records them in the _migrations table.
 */
import type { DbAdapter } from "./adapter";
import * as fs from "fs";
import * as path from "path";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export async function runPendingMigrations(db: DbAdapter): Promise<void> {
  // Ensure tracking table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version  INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      filename   TEXT NOT NULL
    )
  `);

  // Get already-applied versions
  const applied = await db.execute(
    "SELECT version FROM _migrations ORDER BY version"
  );
  const appliedSet = new Set(applied.rows.map((r) => Number(r.version)));

  // Read migration files: 0001_xxx.sql, 0002_yyy.sql, ...
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`  [migrator] Migrations dir not found: ${MIGRATIONS_DIR}`);
    return;
  }
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split("_")[0], 10);
    if (Number.isNaN(version)) continue;
    if (appliedSet.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    // Remove full-line comments, then split on semicolons, skip empty
    const cleaned = sql
      .split("\n")
      .map((line) => {
        const trimmed = line.trimStart();
        return trimmed.startsWith("--") ? "" : line;
      })
      .join("\n");
    const statements = cleaned
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      for (const stmt of statements) {
        await db.execute(stmt);
      }
      await db.execute({
        sql: "INSERT INTO _migrations (version, applied_at, filename) VALUES (?, ?, ?)",
        args: [version, new Date().toISOString(), file],
      });
    } catch (err: any) {
      // Non-critical migrations (e.g. vector extension) may fail on builds
      // that lack the extension. Log and continue — the table simply won't
      // exist until a compatible build is used.
      console.warn(
        `  [migrator] Migration ${file} failed: ${err.message ?? err}. Skipping.`
      );
    }
  }
}
