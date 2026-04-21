import { readTextFile, writeTextFile } from "../utils/filesystem";
import type { TopicManifest, TopicSignal, TopicCrossRef, TopicDigestItem, Fact, Task, CalendarEvent, AppState, FocusBrief } from "../types";
import { computeKrActivity, computeKrOutcome, buildTaskStats } from "../types";
import { getUserToday } from "../utils/dates";

/** Max signals to keep in the ledger — FIFO eviction of oldest */
const MAX_SIGNALS = 1000;

/** Convert display name to filesystem-safe slug */
export function slugifyTopic(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Read a topic markdown file, return content or empty string */
export async function readTopicFile(topicId: string): Promise<string> {
  try {
    return (await readTextFile(`topics/${topicId}.md`)) || "";
  } catch {
    return "";
  }
}

/** Append a dated note to a topic markdown file */
export async function appendToTopicFile(
  topicId: string,
  topicName: string,
  note: string,
  date: string
): Promise<void> {
  let content = await readTopicFile(topicId);
  if (!content) {
    content = `# ${topicName}\n\n## Notes\n### ${date}\n- ${note}\n`;
  } else if (content.includes(`### ${date}`)) {
    // Use lastIndexOf to avoid inserting at a false match earlier in the file
    const heading = `### ${date}`;
    const idx = content.lastIndexOf(heading);
    const insertAt = idx + heading.length;
    content = content.slice(0, insertAt) + `\n- ${note}` + content.slice(insertAt);
  } else {
    content += `\n### ${date}\n- ${note}\n`;
  }
  await writeTextFile(`topics/${topicId}.md`, content);
}

/** Build a compact topic list for LLM context (topic names + aliases) */
export function buildTopicList(manifest: TopicManifest): string[] {
  return manifest.topics.map(t =>
    t.aliases.length > 0 ? `${t.name} (${t.aliases.join(", ")})` : t.name
  );
}

/** Extract unique topic hints from facts + signals for LLM consistency */
export function getExistingHints(manifest: TopicManifest, facts: (string | Fact)[]): string[] {
  const hints = new Set<string>();
  for (const f of facts) {
    if (typeof f !== "string" && f.topic) hints.add(f.topic);
  }
  for (const s of manifest.signals) {
    hints.add(s.topic);
  }
  return Array.from(hints);
}

/** Record a topic signal. Deduplicates by sourceType + sourceId. Returns true if new signal added. */
export function recordSignal(
  manifest: TopicManifest,
  topic: string,
  sourceType: TopicSignal["sourceType"],
  sourceId: string,
  date: string
): boolean {
  if (manifest.signals.some(s => s.sourceType === sourceType && s.sourceId === sourceId)) return false;

  manifest.signals.push({ topic, sourceType, sourceId, date });

  // FIFO eviction if over cap
  if (manifest.signals.length > MAX_SIGNALS) {
    manifest.signals = manifest.signals.slice(-MAX_SIGNALS);
  }

  return true;
}

/** Count topic signals and update suggestion statuses. Returns true if manifest changed. */
export function updateSuggestions(
  manifest: TopicManifest
): boolean {
  const counts = new Map<string, number>();
  for (const s of manifest.signals) {
    counts.set(s.topic, (counts.get(s.topic) || 0) + 1);
  }

  let changed = false;
  for (const [topic, count] of counts) {
    if (manifest.topics.some(t => t.id === topic)) continue;
    if (manifest.rejectedTopics.includes(topic)) continue;

    const existing = manifest.pendingSuggestions.find(s => s.topic === topic);
    if (existing) {
      if (existing.count !== count) {
        existing.count = count;
        changed = true;
      }
      if (count >= existing.threshold && (existing.status === "accumulating" || existing.status === "deferred")) {
        existing.status = "pending";
        changed = true;
      }
    } else {
      manifest.pendingSuggestions.push({
        topic,
        count,
        threshold: 3,
        status: count >= 3 ? "pending" : "accumulating",
      });
      changed = true;
    }
  }
  return changed;
}

/** Migrate facts with a given topic hint to a new topic file. Returns remaining facts. */
export async function migrateFactsToTopic(
  topicId: string,
  topicName: string,
  facts: (string | Fact)[]
): Promise<(string | Fact)[]> {
  const toMigrate: Fact[] = [];
  const remaining: (string | Fact)[] = [];

  for (const f of facts) {
    if (typeof f !== "string" && f.topic === topicId) {
      toMigrate.push(f);
    } else {
      remaining.push(f);
    }
  }

  for (const f of toMigrate) {
    await appendToTopicFile(topicId, topicName, f.text, f.date);
  }

  return remaining;
}

// ── Topic-aware planning helpers ─────────────────────────────────────────

/** Check if a text contains a topic name or any of its aliases (word-boundary match). */
function matchesTopicName(text: string, name: string, aliases: string[]): boolean {
  const lower = text.toLowerCase();
  const names = [name, ...aliases];
  for (const n of names) {
    const escaped = n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Use (?<!\w) and (?!\w) instead of \b so names with non-word chars (e.g. "C++") still match
    if (new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "i").test(lower)) return true;
  }
  return false;
}

/**
 * Build a cross-reference mapping topics to related task/event IDs.
 * Uses two strategies: signal-based lookup + title name matching.
 * Only returns topics with at least one related item.
 */
export function buildTopicCrossRef(
  manifest: TopicManifest,
  activeTasks: Task[],
  activeEvents: CalendarEvent[],
): TopicCrossRef[] {
  if (manifest.topics.length === 0) return [];

  // 1. Reverse-index signals: sourceId -> Set<topicSlug>
  const signalIndex = new Map<string, Set<string>>();
  for (const s of manifest.signals) {
    if (!signalIndex.has(s.sourceId)) signalIndex.set(s.sourceId, new Set());
    signalIndex.get(s.sourceId)!.add(s.topic);
  }

  // 2. Build per-topic accumulators + exclusion sets (O(1) lookup during matching)
  interface TopicAccum {
    name: string;
    aliases: string[];
    excluded: Set<string>;
    taskIds: Set<string>;
    eventIds: Set<string>;
    okrLinks: Set<string>;
  }
  const topicMap = new Map<string, TopicAccum>();
  for (const t of manifest.topics) {
    if (t.archivedAt) continue; // archived topics are hidden from planning/cross-ref
    topicMap.set(t.id, {
      name: t.name,
      aliases: t.aliases,
      excluded: new Set(t.excludedIds || []),
      taskIds: new Set(),
      eventIds: new Set(),
      okrLinks: new Set(),
    });
  }
  if (topicMap.size === 0) return [];

  // 3. Match tasks via signals + name matching (skipping excluded IDs)
  for (const task of activeTasks) {
    const signalTopics = signalIndex.get(task.id);
    if (signalTopics) {
      for (const slug of signalTopics) {
        const entry = topicMap.get(slug);
        if (entry && !entry.excluded.has(task.id)) {
          entry.taskIds.add(task.id);
          if (task.okrLink) entry.okrLinks.add(task.okrLink);
        }
      }
    }
    for (const [, entry] of topicMap) {
      if (entry.excluded.has(task.id)) continue;
      if (matchesTopicName(task.title, entry.name, entry.aliases)) {
        entry.taskIds.add(task.id);
        if (task.okrLink) entry.okrLinks.add(task.okrLink);
      }
    }
  }

  // 4. Match events via signals + name matching (skipping excluded IDs)
  for (const event of activeEvents) {
    const signalTopics = signalIndex.get(event.id);
    if (signalTopics) {
      for (const slug of signalTopics) {
        const entry = topicMap.get(slug);
        if (entry && !entry.excluded.has(event.id)) entry.eventIds.add(event.id);
      }
    }
    for (const [, entry] of topicMap) {
      if (entry.excluded.has(event.id)) continue;
      if (matchesTopicName(event.title, entry.name, entry.aliases)) {
        entry.eventIds.add(event.id);
      }
    }
  }

  // 5. Return only topics with at least one match
  const result: TopicCrossRef[] = [];
  for (const [id, entry] of topicMap) {
    if (entry.taskIds.size === 0 && entry.eventIds.size === 0) continue;
    result.push({
      topic: id,
      name: entry.name,
      taskIds: Array.from(entry.taskIds),
      eventIds: Array.from(entry.eventIds),
      okrLinks: Array.from(entry.okrLinks),
    });
  }
  return result;
}

/**
 * After daily planning, update each topic's markdown file with a structured Dashboard.
 * The Dashboard section is regenerated; the Notes section is preserved.
 */
export async function updateTopicPagesFromBrief(
  brief: FocusBrief,
  state: AppState,
): Promise<void> {
  const digest = brief.topicDigest;
  if (!digest || digest.length === 0) return;

  const today = getUserToday(state);

  // Build the cross-reference ONCE, then index by topic for O(1) lookup.
  // Previously this was rebuilt inside the loop for every digest item.
  const activeTasks = state.tasks.tasks.filter(
    t => t.status !== "done" && t.status !== "deferred" && t.status !== "parked"
  );
  const activeEvents = state.calendar.events.filter(
    e => !e.archived && e.status !== "cancelled"
  );
  const allCrossRefs = buildTopicCrossRef(state.topicManifest, activeTasks, activeEvents);
  const crossRefByTopic = new Map(allCrossRefs.map(cr => [cr.topic, cr]));
  const taskById = new Map(activeTasks.map(t => [t.id, t]));
  const eventById = new Map(activeEvents.map(e => [e.id, e]));

  for (const item of digest) {
    const topicEntry = state.topicManifest.topics.find(t => t.id === item.topic);
    if (!topicEntry) continue;

    const crossRef = crossRefByTopic.get(item.topic);

    // Build Dashboard markdown
    let dashboard = `## Dashboard\n_Last updated: ${today}_\n`;

    // Active Tasks — O(1) lookup via pre-built taskById map
    const relatedTasks = crossRef
      ? crossRef.taskIds.map(id => taskById.get(id)).filter((t): t is Task => !!t)
      : [];
    if (relatedTasks.length > 0) {
      dashboard += `\n### Active Tasks\n`;
      for (const t of relatedTasks) {
        dashboard += `- ${t.title} (due: ${t.due || "none"}, priority: ${t.priority}, status: ${t.status})\n`;
      }
    }

    // Upcoming Events — future events only
    const relatedEvents = crossRef
      ? crossRef.eventIds
          .map(id => eventById.get(id))
          .filter((e): e is CalendarEvent => !!e && !!e.datetime && e.datetime.slice(0, 10) >= today)
      : [];
    if (relatedEvents.length > 0) {
      dashboard += `\n### Upcoming Events\n`;
      for (const e of relatedEvents) {
        dashboard += `- ${e.title} (${e.datetime}, ${e.durationMinutes} min)\n`;
      }
    }

    // OKR Connection
    if (item.okrConnection) {
      dashboard += `\n### OKR Connection\n- ${item.okrConnection}\n`;
    } else if (crossRef && crossRef.okrLinks.length > 0) {
      // Derive from state
      const okrLines: string[] = [];
      for (const krId of crossRef.okrLinks) {
        for (const obj of state.planOkrDashboard.objectives) {
          const kr = obj.keyResults.find((k: any) => k.id === krId);
          if (kr) {
            const taskStats = buildTaskStats(state.tasks.tasks);
            const activity = computeKrActivity(kr.id, taskStats);
            const outcome = computeKrOutcome(kr);
            okrLines.push(`${obj.title} > ${kr.title} (activity: ${activity}%, outcome: ${outcome}%)`);
          }
        }
      }
      if (okrLines.length > 0) {
        dashboard += `\n### OKR Connection\n`;
        for (const line of okrLines) dashboard += `- ${line}\n`;
      }
    }

    // Insights
    if (item.newInsights) {
      dashboard += `\n### Insights\n${item.newInsights}\n`;
    }

    // Read existing file and preserve Notes section
    let existing = await readTopicFile(item.topic);
    let notesSection = "";

    if (existing) {
      // Split at "## Notes" or "---" separator between dashboard and notes
      const notesIdx = existing.indexOf("\n## Notes");
      if (notesIdx !== -1) {
        notesSection = existing.slice(notesIdx);
      } else {
        // Legacy format: notes start with "### YYYY-" date headings
        const dateMatch = existing.match(/\n### \d{4}-/);
        if (dateMatch && dateMatch.index != null) {
          notesSection = "\n## Notes" + existing.slice(dateMatch.index);
        }
      }
    }

    // Compose final file — always include ## Notes section to prevent
    // subsequent appendToTopicFile() notes from landing outside it
    const header = `# ${topicEntry.name}\n\n`;
    const separator = "\n---\n";
    const notes = notesSection ? notesSection.trimStart() : "## Notes\n";
    const finalContent = header + dashboard + separator + notes;

    await writeTextFile(`topics/${item.topic}.md`, finalContent);
  }
}
