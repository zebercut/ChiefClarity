/**
 * One-time topic discovery — scans ALL data sources for topic signals.
 *
 * Scans: context_memory facts, tasks, and calendar events.
 * Sends everything to Haiku in one call for consistent classification.
 * Tags existing facts, creates synthetic facts for task/calendar signals,
 * and seeds the topic suggestion system.
 *
 * Usage: node scripts/discover-topics.js
 *        node scripts/discover-topics.js --dry-run   (preview without writing)
 */

const path = require("path");
const fs = require("fs");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const DATA_PATH = process.env.DATA_FOLDER_PATH;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.LLM_MODEL_LIGHT || "claude-haiku-4-5-20251001";
const DRY_RUN = process.argv.includes("--dry-run");

if (!DATA_PATH) { console.error("ERROR: DATA_FOLDER_PATH not set in .env"); process.exit(1); }
if (!API_KEY) { console.error("ERROR: ANTHROPIC_API_KEY not set in .env"); process.exit(1); }

// Register ts-node
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    target: "ES2020",
    esModuleInterop: true,
    jsx: "react",
  },
});

const { setDataRoot, readJsonFile, writeJsonFile } = require("../src/utils/filesystem");
const { updateSuggestions, recordSignal, slugifyTopic } = require("../src/modules/topicManager");
const Anthropic = require("@anthropic-ai/sdk").default;

setDataRoot(DATA_PATH);

async function main() {
  console.log("\n  Topic Discovery — One-Time Migration");
  console.log(`  Data: ${DATA_PATH}`);
  console.log(`  Model: ${MODEL}`);
  if (DRY_RUN) console.log("  Mode: DRY RUN (no writes)\n");
  else console.log("");

  // ─── 1. Gather items from all sources ──────────────────────────────────

  // Facts
  const contextMemory = await readJsonFile("context_memory.json");
  const facts = (contextMemory?.facts || []).map((f) =>
    typeof f === "string" ? { text: f, topic: null, date: "" } : f
  );
  const untaggedFacts = facts.filter((f) => !f.topic);

  // Tasks
  const tasksFile = await readJsonFile("tasks.json");
  const tasks = (tasksFile?.tasks || []).map((t) => ({
    source: "task",
    id: t.id || null,
    text: `Task: ${t.title}${t.category ? " [" + t.category + "]" : ""}${t.notes ? " — " + t.notes : ""}`,
  }));

  // Calendar events
  const calendarFile = await readJsonFile("calendar.json");
  const events = (calendarFile?.events || [])
    .filter((e) => !e.archived && e.status !== "cancelled")
    .map((e) => ({
      source: "event",
      id: e.id || null,
      text: `Event: ${e.title}${e.type ? " [" + e.type + "]" : ""}${e.notes ? " — " + e.notes : ""}`,
    }));

  const totalItems = untaggedFacts.length + tasks.length + events.length;
  if (totalItems === 0) {
    console.log("  No items to classify — nothing to do.");
    return;
  }

  console.log(`  Sources:`);
  console.log(`    Facts (untagged): ${untaggedFacts.length}`);
  console.log(`    Tasks:            ${tasks.length}`);
  console.log(`    Calendar events:  ${events.length}`);
  console.log(`    Total to classify: ${totalItems}\n`);

  // ─── 2. Build a single numbered list for the LLM ──────────────────────

  // Track which items map to which indices
  const allItems = [];
  let idx = 0;

  for (const f of untaggedFacts) {
    allItems.push({ idx: idx++, source: "fact", id: null, ref: f, text: f.text });
  }
  for (const t of tasks) {
    allItems.push({ idx: idx++, source: "task", id: t.id, ref: t, text: t.text });
  }
  for (const e of events) {
    allItems.push({ idx: idx++, source: "event", id: e.id, ref: e, text: e.text });
  }

  const itemsForLlm = allItems.map((item) => `${item.idx}: ${item.text}`).join("\n");

  // ─── 3. Classify with Haiku ────────────────────────────────────────────

  const client = new Anthropic({ apiKey: API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `You are a classification assistant. You will receive a numbered list of items (facts, tasks, calendar events) from a user's personal organizer. For each, assign a topic hint — a lowercase slug.

Reply with ONLY a JSON array of objects: [{"index": 0, "topic": "kids"}, {"index": 1, "topic": null}, ...]

Rules:
- Use short, lowercase slugs with hyphens for multi-word topics (e.g., "job-search", "chief-clarity", "saddle-up", "kids", "health")
- Be SPECIFIC: if an item mentions a specific project name (like "ChiefClarity", "SaddleUp", etc.), use that project name as the topic slug — don't generalize it to "work-projects"
- Be consistent — if two items are about the same subject, use the SAME slug
- Use null ONLY if an item is truly general with no recognizable subject
- Do NOT include the item text in your response, only index and topic`,
    messages: [{ role: "user", content: itemsForLlm }],
  });

  const text = response.content[0]?.text || "";

  let classifications;
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in response");
    classifications = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("  ERROR: Failed to parse LLM response:", err.message);
    console.error("  Raw response:", text.slice(0, 500));
    return;
  }

  // ─── 4. Apply classifications ──────────────────────────────────────────

  const topicCounts = {};         // topic -> total count across all sources
  const topicBySource = {};       // topic -> { fact: N, task: N, event: N }
  let taggedFactCount = 0;

  // Load or create manifest for signal recording
  let manifest;
  try {
    manifest = await readJsonFile("topics/_manifest.json");
  } catch {
    manifest = null;
  }
  if (!manifest) {
    manifest = { topics: [], pendingSuggestions: [], rejectedTopics: [], signals: [] };
  }
  if (!manifest.signals) manifest.signals = [];

  const today = new Date().toISOString().slice(0, 10);

  for (const cls of classifications) {
    const i = cls.index;
    if (i === undefined || i < 0 || i >= allItems.length) continue;

    const topic = cls.topic === "null" || cls.topic === null
      ? null
      : slugifyTopic(String(cls.topic));

    if (!topic) continue;

    const item = allItems[i];
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    if (!topicBySource[topic]) topicBySource[topic] = { fact: 0, task: 0, event: 0 };
    topicBySource[topic][item.source]++;

    if (item.source === "fact") {
      item.ref.topic = topic;
      taggedFactCount++;
      const factId = item.id || `fact_${item.ref.text.slice(0, 40).replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
      recordSignal(manifest, topic, "fact", factId, today);
    } else if (item.source === "task") {
      const taskId = item.id || `task_unknown_${i}`;
      recordSignal(manifest, topic, "task", taskId, today);
    } else if (item.source === "event") {
      const eventId = item.id || `event_unknown_${i}`;
      recordSignal(manifest, topic, "event", eventId, today);
    }
  }

  // ─── 5. Report ─────────────────────────────────────────────────────────

  console.log(`  Facts tagged: ${taggedFactCount}/${untaggedFacts.length}`);
  console.log(`  Signals recorded: ${manifest.signals.length}`);

  const sorted = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
  console.log("\n  Discovered topics:");
  for (const [topic, count] of sorted) {
    const sources = topicBySource[topic];
    const parts = [];
    if (sources.fact > 0) parts.push(`${sources.fact} facts`);
    if (sources.task > 0) parts.push(`${sources.task} tasks`);
    if (sources.event > 0) parts.push(`${sources.event} events`);
    const marker = count >= 3 ? " <- will suggest" : "";
    console.log(`    ${topic}: ${count} signals (${parts.join(", ")})${marker}`);
  }

  if (DRY_RUN) {
    console.log("\n  Dry run — no files written.");
    return;
  }

  // ─── 6. Write changes ─────────────────────────────────────────────────

  // Write tagged facts back
  contextMemory.facts = facts;
  await writeJsonFile("context_memory.json", contextMemory);
  console.log("\n  Wrote context_memory.json");

  // Update suggestions from signals and write manifest
  updateSuggestions(manifest);

  const topicsDir = path.join(DATA_PATH, "topics");
  if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });

  await writeJsonFile("topics/_manifest.json", manifest);
  console.log("  Wrote topics/_manifest.json");

  const pending = manifest.pendingSuggestions.filter((s) => s.status === "pending");
  if (pending.length > 0) {
    console.log(`\n  ${pending.length} topic(s) ready for suggestion:`);
    for (const s of pending) {
      console.log(`    "${s.topic}" (${s.count} signals)`);
    }
  }

  console.log("\n  Done. Next time the user chats, the system will suggest creating topics.\n");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
