#!/usr/bin/env node
/** Quick test: semantic search over embeddings */
const path = require("path");
const envPath = path.join(__dirname, "..", ".env");
const envContent = require("fs").readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", target: "ES2020", esModuleInterop: true },
});

const query = process.argv[2] || "job search interview";
const dbPath = path.join(process.env.DATA_FOLDER_PATH, "lifeos.db").replace(/\\/g, "/");

(async () => {
  const { openDatabase, closeDatabase } = require("../src/db/index");
  await openDatabase(dbPath, process.env.ENCRYPTION_PASSPHRASE);

  const { embed } = require("../src/modules/embeddings/provider");
  const { searchSimilar } = require("../src/db/queries/embeddings");

  console.log(`\nSearching for: "${query}"\n`);
  const vec = await embed(query);
  const results = await searchSimilar(vec, ["task", "event", "fact", "note", "observation"], 10, 0.5);

  const { getDb } = require("../src/db/index");
  const db = getDb();

  for (const r of results) {
    const tableMap = { task: "tasks", event: "calendar_events", note: "notes", fact: "facts", observation: "user_observations" };
    const table = tableMap[r.sourceType];
    const rows = await db.execute({ sql: `SELECT * FROM "${table}" WHERE id = ?`, args: [r.sourceId] });
    const row = rows.rows[0] || {};
    const label = row.title || row.text || row.observation || row.pattern || "(no text)";
    const dist = r.distance.toFixed(3);
    console.log(`  ${r.sourceType.padEnd(12)} dist=${dist}  ${String(label).slice(0, 80)}`);
  }

  console.log(`\n${results.length} results`);
  await closeDatabase();
})().catch((e) => console.error("Error:", e.message));
