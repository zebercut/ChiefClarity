#!/usr/bin/env node
/**
 * Quick DB inspector — opens the encrypted lifeos.db and runs queries.
 *
 * Usage:
 *   node scripts/db-inspect.js                    # show all table counts
 *   node scripts/db-inspect.js "SELECT * FROM tasks LIMIT 5"
 */
const path = require("path");
const fs = require("fs");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true },
});

const { openDatabase, getDb, closeDatabase } = require("../src/db/index");

const DATA_PATH = process.env.DATA_FOLDER_PATH;
const PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
const dbPath = path.join(DATA_PATH, "lifeos.db").replace(/\\/g, "/");

async function main() {
  await openDatabase(dbPath, PASSPHRASE);
  const db = getDb();

  const query = process.argv[2];

  if (query) {
    // Run custom query
    const result = await db.execute(query);
    if (result.rows.length === 0) {
      console.log("(no rows)");
    } else {
      // Print as table
      const cols = result.columns;
      console.log(cols.join(" | "));
      console.log(cols.map(() => "---").join(" | "));
      for (const row of result.rows) {
        const vals = cols.map((c) => {
          const v = row[c];
          if (v === null) return "NULL";
          const s = String(v);
          return s.length > 60 ? s.slice(0, 57) + "..." : s;
        });
        console.log(vals.join(" | "));
      }
      console.log(`\n${result.rows.length} row(s)`);
    }
  } else {
    // Show all tables + row counts
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    console.log("\n  Table                      Rows");
    console.log("  " + "-".repeat(40));
    for (const t of tables.rows) {
      const name = t.name;
      const count = await db.execute(`SELECT COUNT(*) as c FROM "${name}"`);
      console.log(`  ${String(name).padEnd(25)} ${String(count.rows[0].c).padStart(6)}`);
    }
    console.log("");
  }

  await closeDatabase();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
