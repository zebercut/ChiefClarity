import * as fs from "fs";
import * as path from "path";

/**
 * Migration script: converts a markdown feature table into file-per-feature structure.
 *
 * Usage: npx ts-node scripts/migrate-from-markdown.ts <path-to-features.md>
 *
 * Expected markdown format:
 * | # | Feature | Category | MoSCoW | Prio | Status |
 * |---|---------|----------|--------|------|--------|
 * | F01 | Feature title — description | Tasks | MUST | 1 | Planned |
 */

// Use ajv via the validator for consistency
// Import inline to keep this script self-contained within the package
const FEATURES_DIR = path.join(__dirname, "..", "features");

interface ParsedRow {
  id: string;
  title: string;
  description: string;
  category: string;
  moscow: string;
  priority: number | null;
  status: string;
}

function parseLine(line: string): ParsedRow | null {
  // Split by | and trim
  const cells = line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (cells.length < 6) return null;

  const id = cells[0];
  if (!/^F\d{2,}$/.test(id)) return null;

  const fullTitle = cells[1];
  // Split title from description at the first dash separator
  const dashIdx = fullTitle.indexOf(" — ");
  const emDashIdx = fullTitle.indexOf(" — ");

  let title: string;
  let description: string;

  if (dashIdx !== -1) {
    title = fullTitle.slice(0, dashIdx).trim();
    description = fullTitle.slice(dashIdx + 3).trim();
  } else if (emDashIdx !== -1) {
    title = fullTitle.slice(0, emDashIdx).trim();
    description = fullTitle.slice(emDashIdx + 3).trim();
  } else {
    title = fullTitle;
    description = "";
  }

  const category = cells[2];
  const moscow = cells[3];
  const prioStr = cells[4];
  const priority = /^\d+$/.test(prioStr) ? parseInt(prioStr, 10) : null;

  const statusRaw = cells[5];
  // Normalize status
  let status = statusRaw;
  if (statusRaw.toLowerCase() === "rejected") status = "Rejected";
  else if (statusRaw.toLowerCase() === "done") status = "Done";
  else if (statusRaw.toLowerCase() === "planned") status = "Planned";
  else if (statusRaw.toLowerCase() === "in progress") status = "In Progress";

  return { id, title, description, category, moscow, priority, status };
}

function main(): void {
  const mdPath = process.argv[2];
  if (!mdPath) {
    console.error("Usage: npx ts-node scripts/migrate-from-markdown.ts <path-to-features.md>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(mdPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const lines = content.split("\n");

  if (!fs.existsSync(FEATURES_DIR)) fs.mkdirSync(FEATURES_DIR, { recursive: true });

  const now = new Date().toISOString();
  let migrated = 0;

  for (const line of lines) {
    const row = parseLine(line);
    if (!row) continue;

    const featureDir = path.join(FEATURES_DIR, row.id);
    if (!fs.existsSync(featureDir)) fs.mkdirSync(featureDir, { recursive: true });

    const feature = {
      id: row.id,
      title: row.title,
      category: row.category,
      moscow: row.moscow,
      priority: row.priority,
      status: row.status,
      createdAt: now,
      updatedAt: now,
      tags: [] as string[],
      okrLink: null as string | null,
    };

    fs.writeFileSync(
      path.join(featureDir, "feature.json"),
      JSON.stringify(feature, null, 2) + "\n",
      "utf-8"
    );

    const readme = `# ${row.id} — ${row.title}\n\n${row.description || "_Add description, design notes, and acceptance criteria here._"}\n`;
    fs.writeFileSync(path.join(featureDir, "README.md"), readme, "utf-8");

    migrated++;
    console.log(`  ${row.id}: ${row.title} [${row.status}]`);
  }

  console.log(`\nMigrated ${migrated} features to ${FEATURES_DIR}`);

  // Generate manifest
  const { generateManifest } = require("../src/index-generator");
  const manifest = generateManifest(FEATURES_DIR);
  console.log(`Generated manifest: ${manifest.count} features`);
}

main();
