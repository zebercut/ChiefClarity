/**
 * FEAT041 — Database connection manager.
 *
 * Platform-aware: uses @libsql/client on Node, @capacitor-community/sqlite
 * on mobile. All query modules call getDb().execute() which returns the
 * same { rows, columns } shape on both platforms.
 */
import { createPlatformClient, type DbAdapter } from "./adapter";
import { runPendingMigrations } from "./migrator";

let _client: DbAdapter | null = null;

/**
 * Open the encrypted database, set PRAGMAs, run pending migrations.
 * Throws if the passphrase is wrong or the file is corrupt.
 */
export async function openDatabase(
  dbPath: string,
  passphrase: string
): Promise<DbAdapter> {
  _client = await createPlatformClient(dbPath, passphrase);
  await runPendingMigrations(_client as any);
  return _client;
}

/** Get the open connection. Throws if not opened. */
export function getDb(): DbAdapter {
  if (!_client)
    throw new Error("Database not opened — call openDatabase() first");
  return _client;
}

/** Close the connection. Safe to call if already closed. */
export async function closeDatabase(): Promise<void> {
  if (_client) {
    _client.close();
    _client = null;
  }
}

/** Change passphrase atomically. */
export async function rekeyDatabase(newPassphrase: string): Promise<void> {
  const db = getDb();
  const escaped = newPassphrase.replace(/'/g, "''");
  await db.execute(`PRAGMA rekey = '${escaped}'`);
}
