/**
 * FEAT041 — Platform-aware database adapter.
 *
 * Provides a unified execute() interface across:
 *   - Node: @libsql/client (native binding)
 *   - Web: proxy handles it (browser never opens DB)
 *   - Capacitor: @capacitor-community/sqlite (native SQLite + SQLCipher)
 *
 * All query modules use getDb().execute({ sql, args }) — this adapter
 * ensures both drivers return the same { rows, columns } shape.
 */

export interface DbResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

export interface DbStatement {
  sql: string;
  args?: unknown[];
}

export interface DbAdapter {
  execute(stmtOrSql: DbStatement | string, args?: unknown[]): Promise<DbResult>;
  close(): void;
}

/**
 * Open a database using the platform-appropriate driver.
 * Returns a DbAdapter with a unified execute() interface.
 */
export async function createPlatformClient(
  dbPath: string,
  passphrase: string
): Promise<DbAdapter> {
  // Detect platform at runtime
  const g = globalThis as Record<string, any>;
  const isCapacitorPlatform =
    g.window?.Capacitor?.isNativePlatform?.() === true;

  if (isCapacitorPlatform) {
    return createCapacitorAdapter(dbPath, passphrase);
  }
  return createLibsqlAdapter(dbPath, passphrase);
}

// ── Node adapter (@libsql/client) ──────────────────────────────────────

async function createLibsqlAdapter(
  dbPath: string,
  passphrase: string
): Promise<DbAdapter> {
  // Dynamic require prevents Metro from resolving @libsql/client at bundle time
  const pkg = "@libsql/client";
  const { createClient } = require(pkg);
  const client = createClient({ url: `file:${dbPath}` });

  // SQLCipher PRAGMAs
  const escaped = passphrase.replace(/'/g, "''");
  await client.execute(`PRAGMA key = '${escaped}'`);
  await client.execute("PRAGMA cipher_kdf_iter = 600000");

  // Smoke test
  try {
    await client.execute("SELECT 1");
  } catch {
    client.close();
    throw new Error("Wrong passphrase or corrupt database");
  }

  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");

  return {
    execute: async (stmtOrSql, args) => {
      const stmt =
        typeof stmtOrSql === "string"
          ? { sql: stmtOrSql, args: args || [] }
          : stmtOrSql;
      const result = await client.execute(stmt);
      return {
        rows: result.rows as Record<string, unknown>[],
        columns: result.columns,
      };
    },
    close: () => client.close(),
  };
}

// ── Capacitor adapter (@capacitor-community/sqlite) ────────────────────

async function createCapacitorAdapter(
  dbPath: string,
  passphrase: string
): Promise<DbAdapter> {
  const { CapacitorSQLite } = await import("@capacitor-community/sqlite");

  // Extract database name from path (Capacitor manages its own storage location)
  const dbName = dbPath.replace(/^.*[\\/]/, "").replace(/\.db$/, "");

  // Create encrypted connection
  await CapacitorSQLite.createConnection({
    database: dbName,
    encrypted: true,
    mode: "encryption",
    version: 1,
    readonly: false,
  });

  await CapacitorSQLite.open({ database: dbName });

  // Set encryption key + pragmas
  await CapacitorSQLite.execute({
    database: dbName,
    statements: `PRAGMA key = '${passphrase.replace(/'/g, "''")}';`,
  });
  await CapacitorSQLite.execute({
    database: dbName,
    statements: "PRAGMA foreign_keys = ON;",
  });

  return {
    execute: async (stmtOrSql, args) => {
      const stmt =
        typeof stmtOrSql === "string"
          ? { sql: stmtOrSql, args: args || [] }
          : stmtOrSql;

      const values = (stmt.args || []).map((a) =>
        a === null || a === undefined ? null : a
      );

      // Detect if this is a read (SELECT/PRAGMA) or write (INSERT/UPDATE/DELETE/CREATE)
      const trimmed = stmt.sql.trimStart().toUpperCase();
      const isRead = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA");

      if (isRead) {
        const result = await CapacitorSQLite.query({
          database: dbName,
          statement: stmt.sql,
          values: values as any[],
        });
        const rows = result.values || [];
        const columns = rows.length > 0 ? Object.keys(rows[0] as object) : [];
        return { rows: rows as Record<string, unknown>[], columns };
      } else {
        await CapacitorSQLite.execute({
          database: dbName,
          statements: stmt.sql,
        });
        return { rows: [], columns: [] };
      }
    },
    close: () => {
      CapacitorSQLite.close({ database: dbName });
    },
  };
}
