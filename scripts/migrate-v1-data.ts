/**
 * Migration script: converts v1 Python data files to v2 TypeScript schema.
 *
 * Usage: npx ts-node scripts/migrate-v1-data.ts <source-data-dir> <target-data-dir>
 *   e.g.: npx ts-node scripts/migrate-v1-data.ts ./data ./data
 *
 * What it does:
 *   1. Reads v1 tasks.json, calendar.json, context_memory.json, content_index.json,
 *      feedback_memory.json, user_profile.md
 *   2. Transforms snake_case -> camelCase, restructures schemas
 *   3. Writes v2-compatible JSON files (backs up originals as *.v1.json)
 *   4. Creates missing files with defaults
 */

import * as fs from "fs";
import * as path from "path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function backup(filePath: string): void {
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    fs.copyFileSync(filePath, `${base}.v1${ext}`);
  }
}

// ─── Task Migration ─────────────────────────────────────────────────────────

function migrateTasks(src: string, dst: string): void {
  const v1 = readJson(path.join(src, "tasks.json"));
  if (!v1?.tasks) {
    console.log("  [skip] tasks.json — not found or empty");
    return;
  }

  backup(path.join(dst, "tasks.json"));

  const tasks = v1.tasks.map((t: any) => ({
    id: t.id ?? "",
    title: t.title ?? "",
    due: t.due_date ?? t.due ?? "",
    priority: normalizePriority(t.priority),
    status: normalizeTaskStatus(t.status),
    category: t.category ?? "",
    subcategory: t.subcategory ?? "",
    okrLink: t.related_objective ?? null,
    conflictStatus: "ok" as const,
    conflictReason: "",
    conflictWith: [],
    notes: t.notes ?? "",
    createdAt: t.created_at ?? v1.generated_at ?? new Date().toISOString(),
    completedAt: t.completed_date ?? t.completed_at ?? null,
    timeAllocated: t.time_allocated ?? "",
    relatedCalendar: t.related_calendar ?? [],
    relatedInbox: t.related_inbox ?? [],
  }));

  const open = tasks.filter((t: any) => t.status !== "done");
  const overdue = open.filter((t: any) => {
    if (!t.due) return false;
    try { return new Date(t.due) < new Date(); } catch { return false; }
  });

  writeJson(path.join(dst, "tasks.json"), {
    _summary: `${open.length} open tasks. ${overdue.length} overdue.`,
    tasks,
  });

  console.log(`  [ok] tasks.json — ${tasks.length} tasks migrated`);
}

function normalizePriority(p: string): "high" | "medium" | "low" {
  if (!p) return "medium";
  const lower = p.toLowerCase();
  if (lower === "critical" || lower === "high") return "high";
  if (lower === "low") return "low";
  return "medium";
}

function normalizeTaskStatus(s: string): "pending" | "in_progress" | "done" | "overdue" {
  if (!s) return "pending";
  const lower = s.toLowerCase();
  if (lower === "completed" || lower === "done") return "done";
  if (lower === "overdue") return "overdue";
  if (lower === "in_progress" || lower === "active") return "in_progress";
  return "pending";
}

// ─── Calendar Migration ─────────────────────────────────────────────────────

function migrateCalendar(src: string, dst: string): void {
  const v1 = readJson(path.join(src, "calendar.json"));
  if (!v1?.events) {
    console.log("  [skip] calendar.json — not found or empty");
    return;
  }

  backup(path.join(dst, "calendar.json"));

  const events = v1.events.map((e: any) => {
    // v1 has separate date + time fields; v2 uses a single datetime ISO string
    let datetime = "";
    if (e.datetime) {
      datetime = e.datetime;
    } else if (e.date && e.time) {
      datetime = `${e.date}T${e.time}:00`;
    } else if (e.date) {
      datetime = `${e.date}T00:00:00`;
    }

    // Calculate duration from time + end_time if available
    let durationMinutes = e.duration_minutes ?? e.durationMinutes ?? 30;
    if (e.time && e.end_time && !e.duration_minutes) {
      const [sh, sm] = e.time.split(":").map(Number);
      const [eh, em] = e.end_time.split(":").map(Number);
      durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
      if (durationMinutes <= 0) durationMinutes = 30;
    }

    return {
      id: e.id ?? "",
      title: e.title ?? "",
      datetime,
      durationMinutes,
      status: normalizeEventStatus(e.status),
      type: e.type ?? "",
      priority: e.priority ?? "medium",
      notes: e.notes ?? "",
      relatedInbox: e.related_inbox ?? [],
    };
  });

  const now = new Date().toISOString();
  const upcoming = events.filter((e: any) => e.datetime >= now);

  writeJson(path.join(dst, "calendar.json"), {
    _summary: `${upcoming.length} upcoming events.`,
    events,
  });

  console.log(`  [ok] calendar.json — ${events.length} events migrated`);
}

function normalizeEventStatus(s: string): "scheduled" | "completed" | "cancelled" {
  if (!s) return "scheduled";
  const lower = s.toLowerCase();
  if (lower === "completed") return "completed";
  if (lower === "cancelled" || lower === "canceled") return "cancelled";
  return "scheduled";
}

// ─── Context Memory Migration ───────────────────────────────────────────────

function migrateContextMemory(src: string, dst: string): void {
  const v1 = readJson(path.join(src, "context_memory.json"));
  if (!v1) {
    console.log("  [skip] context_memory.json — not found");
    return;
  }

  backup(path.join(dst, "context_memory.json"));

  writeJson(path.join(dst, "context_memory.json"), {
    patterns: (v1.patterns ?? []).map((p: any) => ({
      pattern: p.pattern ?? "",
      evidence: p.evidence ?? "",
      firstSeen: p.first_seen ?? "",
      lastSeen: p.last_seen ?? "",
      confidence: p.confidence ?? 0.5,
    })),
    facts: v1.facts ?? [],
    recentEvents: v1.recent_events ?? v1.recentEvents ?? [],
  });

  console.log("  [ok] context_memory.json — migrated");
}

// ─── Content Index Migration ────────────────────────────────────────────────

function migrateContentIndex(src: string, dst: string): void {
  const v1 = readJson(path.join(src, "content_index.json"));
  if (!v1) {
    console.log("  [skip] content_index.json — not found");
    return;
  }

  backup(path.join(dst, "content_index.json"));

  writeJson(path.join(dst, "content_index.json"), {
    schemaVersion: v1.schema_version ?? "1.0",
    updatedAt: v1.updated_at ?? "",
    entities: v1.entities ?? {},
  });

  console.log("  [ok] content_index.json — migrated");
}

// ─── Feedback Memory Migration ──────────────────────────────────────────────

function migrateFeedbackMemory(src: string, dst: string): void {
  const v1 = readJson(path.join(src, "feedback_memory.json"));
  if (!v1) {
    console.log("  [skip] feedback_memory.json — not found");
    return;
  }

  backup(path.join(dst, "feedback_memory.json"));

  const preferences = v1.preferences ?? {
    reminderFormat: "task",
    responseLength: "short",
    deepWorkDays: [],
    ignoredTopics: [],
    preferredTimeForReminders: "morning",
  };

  const behavioralSignals = (v1.behavioral_signals ?? v1.behavioralSignals ?? []).map((s: any) => ({
    signal: s.signal ?? "",
    observed: s.observed ?? 1,
    lastSeen: s.last_seen ?? s.lastSeen ?? "",
  }));

  const corrections = (v1.corrections ?? []).map((c: any) => ({
    original: c.original ?? "",
    correctedTo: c.corrected_to ?? c.correctedTo ?? "",
    date: c.date ?? "",
  }));

  // If v1 had feedback_items (the old schema), extract preferences from them
  if (v1.feedback_items && Array.isArray(v1.feedback_items)) {
    for (const item of v1.feedback_items) {
      if (item.type === "correction" && item.summary) {
        corrections.push({
          original: item.summary,
          correctedTo: item.applied_to?.action ?? "",
          date: item.created_at ?? "",
        });
      }
    }
  }

  writeJson(path.join(dst, "feedback_memory.json"), {
    preferences,
    behavioralSignals,
    corrections,
  });

  console.log("  [ok] feedback_memory.json — migrated");
}

// ─── User Profile Migration (markdown -> JSON) ─────────────────────────────

function migrateUserProfile(src: string, dst: string): void {
  const mdPath = path.join(src, "user_profile.md");
  if (!fs.existsSync(mdPath)) {
    console.log("  [skip] user_profile.md — not found");
    return;
  }

  const md = fs.readFileSync(mdPath, "utf8");

  // Parse key fields from the markdown
  const name = md.match(/preferred_name:\s*(.+)/)?.[1]?.trim() ?? "";
  const timezone = md.match(/timezone:\s*(.+)/)?.[1]?.trim() ?? "";
  const location = md.match(/location:\s*(.+)/)?.[1]?.trim() ?? "";

  // Parse family members
  const familyMembers: { abbreviation: string; name: string; relation: string }[] = [];
  const familySection = md.match(/family_members:\n((?:\s+- .+\n?)+)/);
  if (familySection) {
    const lines = familySection[1].split("\n").filter((l) => l.trim().startsWith("-"));
    for (const line of lines) {
      const match = line.match(/- (\w+)\s*=\s*(\w+)\s*\((\w+)\)/);
      if (match) {
        familyMembers.push({
          abbreviation: match[1],
          name: match[2],
          relation: match[3],
        });
      }
    }
  }

  // Extract projects from OKR.md if available
  const okrPath = path.join(src, "OKR.md");
  const projects: string[] = [];
  const okrs: Record<string, string> = {};
  if (fs.existsSync(okrPath)) {
    const okrContent = fs.readFileSync(okrPath, "utf8");
    const objMatches = okrContent.matchAll(/## Objective \d+:\s*(.+)/g);
    let i = 1;
    for (const m of objMatches) {
      okrs[`obj${i}`] = m[1].trim();
      i++;
    }
  }

  writeJson(path.join(dst, "user_profile.json"), {
    name,
    timezone,
    location,
    language: "en",
    familyMembers,
    dailyRoutine: {
      wake: "05:00",
      deepWorkStart: "08:30",
      deepWorkEnd: "11:00",
      endOfDay: "18:00",
    },
    projects,
    okrs,
  });

  console.log(`  [ok] user_profile.json — migrated from user_profile.md`);
}

// ─── Create Missing Files ───────────────────────────────────────────────────

function createMissingFiles(dst: string): void {
  const defaults: Record<string, any> = {
    "hot_context.json": {
      generatedAt: "", today: "", weekday: "", userName: "", timezone: "",
      top3ActiveTasks: [], nextCalendarEvent: null, okrSnapshot: "",
      openTaskCount: 0, overdueCount: 0, lastSuggestionShown: "",
    },
    "summaries.json": {
      tasks: "", calendar: "", okr: "", contextMemory: "",
      feedbackMemory: "", suggestionsLog: "", learningLog: "",
    },
    "contradiction_index.json": { byDate: {}, byTopic: {}, byOkr: {} },
    "suggestions_log.json": { suggestions: [] },
    "learning_log.json": { _summary: "", items: [] },
    "plan/plan_narrative.json": { summary: "" },
    "plan/plan_agenda.json": { agenda: [] },
    "plan/plan_risks.json": { risks: [] },
    "plan/plan_okr_dashboard.json": { objectives: [] },
  };

  for (const [filename, data] of Object.entries(defaults)) {
    const filePath = path.join(dst, filename);
    if (!fs.existsSync(filePath)) {
      writeJson(filePath, data);
      console.log(`  [new] ${filename} — created with defaults`);
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const src = args[0] ?? "./data";
  const dst = args[1] ?? args[0] ?? "./data";

  console.log(`\nMigrating v1 data: ${src} -> ${dst}\n`);

  migrateTasks(src, dst);
  migrateCalendar(src, dst);
  migrateContextMemory(src, dst);
  migrateContentIndex(src, dst);
  migrateFeedbackMemory(src, dst);
  migrateUserProfile(src, dst);
  createMissingFiles(dst);

  console.log("\nMigration complete. Original files backed up as *.v1.json\n");
}

main();
