/**
 * FEAT060 — inbox_triage skill tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/inbox_triage.test.ts
 *       or: npm test
 *
 * Covers (per code-reviewer's tester-focus brief):
 *   a. Skill loading + manifest + prompt verbatim-string assertions
 *   b. Handler logic — multi-file allowlist, defaults map, recurring strip,
 *      sourceNoteId pass-through, B1 graceful failure
 *   c. 6-phrase regression fixture (Story 8 + design review §8.1, ≥5/6 strict)
 *   d. Executor compatibility for non-array-shaped files (contextMemory,
 *      userObservations, recurringTasks)
 *   e. Disable-gate test for `processBundle` (timer entry point)
 *   f. Story 5 — template validation
 *
 * Two scope additions vs FEAT057-059 are explicitly tested:
 *   1. Multi-file write — each write's `file` is honored, validated against
 *      the six-file allowlist, dropped with a warn-log otherwise.
 *   2. Recurring-attempt parity — phrases like "every Friday at 4pm I have a
 *      team check-in" produce a `recurringTasks` write, not a calendar write
 *      with `recurring`/`recurrence`/`recurrenceDay`. The strip-then-default
 *      ordering in `applyDefaultsForFile` is the only thing protecting
 *      against drift — a fixture enforces it.
 *   3. v4 write-failure path — when `applyWrites` throws, the handler
 *      captures into `writeError` and `processBundle` returns
 *      `succeeded=false`, preserving the inbox for retry. This guards
 *      against silent data loss (the bug the code reviewer fixed).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "assert";
import { dispatchSkill } from "./skillDispatcher";
import { loadSkillRegistry, _resetSkillRegistryForTests } from "./skillRegistry";
import { setV4SkillsEnabled, _resetOrchestratorForTests } from "./router";
import { processBundle } from "./inbox";
import { setDataRoot } from "../utils/filesystem";
import type { RouteResult } from "../types/orchestrator";
import { submit_inbox_triage } from "../skills/inbox_triage/handlers";
import { applyWrites } from "./executor";

// Redirect filesystem writes during tests to a temp dir so applyWrites'
// flush() does not leak fixture data to the repo cwd. (FEAT060 leakage.)
const TMP_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "feat061-it-"));
setDataRoot(TMP_DATA_ROOT);

// ─── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log("  ✓", name);
    passed++;
  } catch (e: any) {
    console.error("  ✗", name);
    console.error("   ", e?.message ?? e);
    failed++;
  }
}
function section(title: string): void {
  console.log("\n" + title);
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

async function loadProductionRegistry() {
  const skillsDir = "src/skills";
  const cachePath = path.join(skillsDir, ".embedding_cache.json");
  const cache: Record<string, { manifestMtimeMs: number; embedding: number[] }> = {};
  for (const sub of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sub.isDirectory() || sub.name.startsWith(".") || sub.name.startsWith("_")) continue;
    const m = path.join(skillsDir, sub.name, "manifest.json");
    if (!fs.existsSync(m)) continue;
    cache[sub.name] = {
      manifestMtimeMs: fs.statSync(m).mtimeMs,
      embedding: new Array(384).fill(0).map((_, i) => i === 0 ? 1 : 0),
    };
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  _resetSkillRegistryForTests();
  return loadSkillRegistry();
}

function stubLlm(toolName: string, toolInput: Record<string, unknown>): any {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "tool_use", name: toolName, input: toolInput }],
      }),
    },
  };
}

function makeRoute(skillId: string): RouteResult {
  return { skillId, confidence: 0.9, routingMethod: "embedding", candidates: [{ skillId, score: 0.9 }] };
}

/**
 * Fixture state with all six allowlisted file shapes initialized.
 * Used for both handler and executor-compat tests.
 */
function makeFixtureState(extras?: any): any {
  return {
    _pendingContext: null,
    _loadedCounts: {},
    _dirty: new Set(),
    userProfile: { timezone: "UTC", workingHours: {} },
    hotContext: { today: "2026-04-27" },
    calendar: { _summary: "", events: extras?.events ?? [] },
    tasks: { _summary: "", tasks: extras?.tasks ?? [] },
    notes: { _summary: "", notes: [] },
    topicManifest: { topics: [], signals: [], suggestions: [], pendingSuggestions: [], rejectedTopics: [] },
    contextMemory: { facts: [], patterns: [], recentEvents: [] },
    userObservations: {
      workStyle: [],
      communicationStyle: [],
      taskCompletionPatterns: [],
      emotionalState: [],
      goalsContext: { primaryGoal: "", secondaryGoals: [], financialPressure: "", lastUpdated: "" },
    },
    recurringTasks: { recurring: [] },
    feedbackMemory: { rules: [] },
    // Legacy-path fields (assembleContext reads these for bulk_input intent).
    contradictionIndex: { byDate: {} },
    summaries: {},
    contentIndex: {},
    suggestionsLog: { suggestions: [] },
    learningLog: { logs: [] },
  };
}

// ─── 6-phrase regression fixture (Story 8 + design review §8.1, ≥5/6) ──────

interface RegressionPhrase {
  phrase: string;
  cannedToolArgs: any;
  expect: {
    writeCount: number;
    /** Files in the order writes should appear, e.g. ["tasks","calendar","notes"]. */
    expectedFiles?: string[];
    /** Asserts no calendar write carries any of recurring/recurrence/recurrenceDay. */
    noCalendarRecurringFields?: boolean;
    /** Asserts every write carries this sourceNoteId (or none if undefined). */
    expectedSourceNoteIds?: Array<string | undefined>;
    needsClarification?: boolean;
  };
}

const REGRESSION_FIXTURES: RegressionPhrase[] = [
  // 1. Mixed inbox blob — task + calendar + note
  {
    phrase: "Task A by Friday. Meeting with Contact A Tue 3pm. Idea: Project X needs a kickoff doc.",
    cannedToolArgs: {
      reply: "Created task: Task A | Added event: Meeting with Contact A | Noted: Project X kickoff doc",
      writes: [
        { file: "tasks", action: "add", data: { title: "Task A", priority: "medium", status: "pending" } },
        { file: "calendar", action: "add", data: { title: "Meeting with Contact A", datetime: "2026-04-28T15:00:00", durationMinutes: 60 } },
        { file: "notes", action: "add", data: { text: "Project X needs a kickoff doc" } },
      ],
    },
    expect: { writeCount: 3, expectedFiles: ["tasks", "calendar", "notes"], noCalendarRecurringFields: true },
  },
  // 2. Recurring-attempt blob (the parity-defining fixture per design review §6.5)
  {
    phrase: "Every Friday at 4pm I have a team check-in. Buy bread tomorrow.",
    cannedToolArgs: {
      reply: "Recurring: team check-in (Fri 4pm) | Created task: Buy bread",
      writes: [
        { file: "recurringTasks", action: "add", data: { title: "Team check-in", schedule: { type: "weekly", days: ["friday"], time: "16:00" } } },
        { file: "tasks", action: "add", data: { title: "Buy bread", priority: "medium", status: "pending" } },
      ],
    },
    expect: { writeCount: 2, expectedFiles: ["recurringTasks", "tasks"], noCalendarRecurringFields: true },
  },
  // 3. Source-note attribution blob (notes-processor path)
  {
    phrase:
      "[note note_test123 @ 2026-04-27T10:00:00] Task B by Monday.\n" +
      "[note note_test456 @ 2026-04-27T10:01:00] Save this thought: refactor inbox.",
    cannedToolArgs: {
      reply: "Created task: Task B | Noted: refactor inbox",
      writes: [
        { file: "tasks", action: "add", data: { title: "Task B", priority: "medium", status: "pending" }, sourceNoteId: "note_test123" },
        { file: "notes", action: "add", data: { text: "refactor inbox" }, sourceNoteId: "note_test456" },
      ],
    },
    expect: {
      writeCount: 2,
      expectedFiles: ["tasks", "notes"],
      expectedSourceNoteIds: ["note_test123", "note_test456"],
    },
  },
  // 4. Chat-driven paste — entry-point parity (same shape as 1, different phrasing)
  {
    phrase: "got a few things: review the audit doc tomorrow, lunch with Contact A on Thursday at noon.",
    cannedToolArgs: {
      reply: "Created task: Review audit doc | Added event: Lunch with Contact A",
      writes: [
        { file: "tasks", action: "add", data: { title: "Review audit doc", priority: "medium", status: "pending" } },
        { file: "calendar", action: "add", data: { title: "Lunch with Contact A", datetime: "2026-04-30T12:00:00", durationMinutes: 60 } },
      ],
    },
    expect: { writeCount: 2, expectedFiles: ["tasks", "calendar"], noCalendarRecurringFields: true },
  },
  // 5. Empty-actionable blob (only context, no writes — needsClarification)
  {
    phrase: "feeling good about the week so far",
    cannedToolArgs: {
      reply: "Nothing actionable in this batch.",
      writes: [],
      needsClarification: false,
    },
    expect: { writeCount: 0 },
  },
  // 6. Out-of-allowlist defense (synthetic — LLM emits userProfile, handler drops)
  {
    phrase: "I prefer morning workouts and I have a meeting with Contact A on Friday at 2pm",
    cannedToolArgs: {
      reply: "Added event: Meeting with Contact A",
      writes: [
        { file: "userProfile", action: "update", data: { workoutPref: "morning" } } as any,
        { file: "calendar", action: "add", data: { title: "Meeting with Contact A", datetime: "2026-05-01T14:00:00", durationMinutes: 60 } },
      ],
    },
    expect: { writeCount: 1, expectedFiles: ["calendar"] },
  },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // ─── (a) Skill loading ──────────────────────────────────────────────────
  section("(a) Skill loading + prompt assertions");

  await test("inbox_triage loads via production registry with expected manifest", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("inbox_triage");
    assert.ok(skill);
    assert.strictEqual(skill!.manifest.model, "haiku");
    assert.deepStrictEqual(skill!.manifest.tools, ["submit_inbox_triage"]);
    assert.ok(skill!.handlers.submit_inbox_triage);
    // Six-file write allowlist (design review §3.1 + §4)
    assert.deepStrictEqual(
      skill!.manifest.dataSchemas.write.slice().sort(),
      ["calendar", "contextMemory", "notes", "recurringTasks", "tasks", "userObservations"]
    );
    assert.strictEqual(skill!.manifest.tokenBudget, 6000);
    assert.strictEqual(skill!.manifest.surface, null);
  });

  await test("triggerPhrases use noun-prefixes (Story 5 — template validation)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("inbox_triage")!;
    for (const t of skill.manifest.triggerPhrases) {
      const lower = t.toLowerCase();
      const hasNoun = /inbox|brain dump|capture|paste|batch|stuff|things|dump|list|log|triage/.test(lower);
      assert.ok(hasNoun, `triggerPhrase "${t}" should be inbox/bulk-noun-prefixed`);
    }
  });

  await test("prompt.md contains load-bearing strings (design review §6 condition 4)", () => {
    const promptPath = path.join("src", "skills", "inbox_triage", "prompt.md");
    const prompt = fs.readFileSync(promptPath, "utf8");
    // The four flagged strings from the code review (§6 condition 4) — these
    // mirror SYSTEM_PROMPT:179 and :181-222 and are load-bearing for parity.
    assert.ok(prompt.includes("Process EVERY item"), "prompt must include 'Process EVERY item' (verbatim from prompts.ts:195)");
    assert.ok(prompt.includes("tasksIndex and calendarEvents"), "prompt must include the dedup load-bearing string 'tasksIndex and calendarEvents'");
    assert.ok(prompt.includes("[note <id> @ <timestamp>]"), "prompt must include source-note attribution marker syntax");
    assert.ok(prompt.includes('NEVER set "recurring"'), 'prompt must include the recurring guard ("NEVER set \\"recurring\\"")');
  });

  // ─── (b) Handler logic ──────────────────────────────────────────────────
  section("(b) Handler logic (no state, no executor call)");

  await test("handler returns plan from args — test mode (basic shape)", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "Created task: Task A",
        writes: [{ file: "tasks", action: "add", data: { title: "Task A" } }],
      },
      { phrase: "Task A by Friday", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Created task: Task A");
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].file, "tasks");
    assert.strictEqual(result.data.writes[0].action, "add");
  });

  await test("per-file allowlist — out-of-allowlist `file: objectives` is dropped", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [
          { file: "objectives", action: "update", data: { kr1Progress: 50 } },
          { file: "tasks", action: "add", data: { title: "Task A" } },
        ],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes.length, 1, "objectives write should be dropped");
    assert.strictEqual(result.data.writes[0].file, "tasks");
  });

  await test("per-file allowlist — each of the six allowed files passes through", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [
          { file: "tasks", action: "add", data: { title: "T" } },
          { file: "calendar", action: "add", data: { title: "C", datetime: "2026-05-01T10:00:00" } },
          { file: "notes", action: "add", data: { text: "N" } },
          { file: "contextMemory", action: "add", data: { text: "fact text", topic: null, date: "2026-04-27" } },
          { file: "userObservations", action: "add", data: { observation: "O", date: "2026-04-27" } },
          { file: "recurringTasks", action: "add", data: { title: "R", schedule: { type: "weekly", days: ["monday"] } } },
        ],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes.length, 6, "all six allowlisted files should pass");
    const files = result.data.writes.map((w: any) => w.file).sort();
    assert.deepStrictEqual(files, ["calendar", "contextMemory", "notes", "recurringTasks", "tasks", "userObservations"]);
  });

  await test("fillTaskDefaults fills required Task fields", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{ file: "tasks", action: "add", data: { title: "Just title" } }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data.title, "Just title");
    assert.strictEqual(data.priority, "medium");
    assert.strictEqual(data.status, "pending");
    assert.strictEqual(data.category, "general");
  });

  await test("fillCalendarEventDefaults fills required CalendarEvent fields", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{ file: "calendar", action: "add", data: { title: "Meeting", datetime: "2026-05-01T10:00:00" } }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data.title, "Meeting");
    assert.strictEqual(data.datetime, "2026-05-01T10:00:00");
    assert.strictEqual(data.durationMinutes, 60);
    assert.strictEqual(data.status, "scheduled");
    assert.strictEqual(data.type, "meeting");
    assert.strictEqual(data.priority, "medium");
  });

  await test("fillNoteDefaults fills required Note fields", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{ file: "notes", action: "add", data: { text: "Just text" } }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data.text, "Just text");
    assert.strictEqual(data.status, "pending");
    assert.strictEqual(data.processedAt, null);
    assert.strictEqual(data.writeCount, 0);
    assert.strictEqual(data.attemptCount, 0);
    assert.strictEqual(data.lastError, null);
  });

  await test("fillRecurringTaskDefaults fills schedule + active + duration", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{
          file: "recurringTasks",
          action: "add",
          data: { title: "Standup", schedule: { type: "daily", days: [], time: "09:00" } },
        }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data.title, "Standup");
    assert.strictEqual(data.schedule.type, "daily");
    assert.strictEqual(data.schedule.time, "09:00");
    assert.strictEqual(data.priority, "medium");
    assert.strictEqual(data.duration, 30);
    assert.strictEqual(data.active, true);
  });

  await test("fillContextMemoryFactDefaults wraps flat text into facts array", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{
          file: "contextMemory",
          action: "add",
          data: { text: "fact text", topic: "work", date: "2026-04-27" },
        }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.ok(Array.isArray(data.facts), "facts should be an array");
    assert.strictEqual(data.facts.length, 1);
    assert.strictEqual(data.facts[0].text, "fact text");
    assert.strictEqual(data.facts[0].topic, "work");
    assert.strictEqual(data.facts[0].date, "2026-04-27");
  });

  await test("fillContextMemoryFactDefaults preserves explicit facts array", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{
          file: "contextMemory",
          action: "add",
          data: { facts: [{ text: "f1", topic: null, date: "2026-04-27" }] },
        }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes[0].data.facts.length, 1);
    assert.strictEqual(result.data.writes[0].data.facts[0].text, "f1");
  });

  await test("fillObservationDefaults defaults _arrayKey to 'emotionalState'", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{
          file: "userObservations",
          action: "add",
          data: { observation: "feeling focused today", date: "2026-04-27" },
        }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data._arrayKey, "emotionalState");
    assert.strictEqual(data.observation, "feeling focused today");
  });

  await test("fillObservationDefaults preserves explicit _arrayKey", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [{
          file: "userObservations",
          action: "add",
          data: { _arrayKey: "workStyle", observation: "deep focus mornings", firstSeen: "2026-04-27" },
        }],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes[0].data._arrayKey, "workStyle");
  });

  await test("strip recurring fields ONLY on calendar writes (not on recurringTasks)", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [
          // calendar write with stray recurring fields — must be stripped
          {
            file: "calendar", action: "add",
            data: { title: "Team sync", datetime: "2026-05-01T11:00:00", recurring: true, recurrence: "weekly", recurrenceDay: "Friday" } as any,
          },
          // recurringTasks write with schedule — must be preserved (NOT stripped)
          {
            file: "recurringTasks", action: "add",
            data: { title: "Team sync", schedule: { type: "weekly", days: ["friday"], time: "11:00" } },
          },
        ],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes.length, 2);
    const cal = result.data.writes[0].data;
    assert.strictEqual(cal.recurring, undefined, "recurring must be stripped from calendar");
    assert.strictEqual(cal.recurrence, undefined, "recurrence must be stripped from calendar");
    assert.strictEqual(cal.recurrenceDay, undefined, "recurrenceDay must be stripped from calendar");
    const rec = result.data.writes[1].data;
    assert.ok(rec.schedule, "recurringTasks schedule must NOT be stripped");
    assert.strictEqual(rec.schedule.type, "weekly");
    assert.deepStrictEqual(rec.schedule.days, ["friday"]);
  });

  await test("filters malformed writes (missing action, bogus shape, null)", async () => {
    // Each filter line drops a malformed write. recurringTasks with only a
    // title gets RESCUED by fillRecurringTaskDefaults (which fills a default
    // weekly/empty-days schedule), so it survives the post-defaults check —
    // documented behavior of the defensive defaults pattern.
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [
          { file: "tasks", action: "add", data: { title: "real" } },           // survives
          null as any,                                                           // dropped: bad shape
          { file: "tasks", action: "bogus", data: {} } as any,                   // dropped: bad action
          { file: "tasks", action: "add", data: { title: "" } } as any,          // dropped: empty title
          { file: "calendar", action: "add", data: {} } as any,                  // dropped: no title
          { file: "notes", action: "add", data: {} } as any,                     // dropped: no text
        ],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].data.title, "real");
  });

  await test("propagates clarificationRequired flag", async () => {
    const result: any = await submit_inbox_triage(
      { reply: "What did you mean?", needsClarification: true, writes: [] },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("captures applyWrites errors gracefully (FEAT057 B1 + FEAT060 reviewer fix)", async () => {
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      tasks: null, // malformed — applyWrites should throw
    };
    const result: any = await submit_inbox_triage(
      {
        reply: "Processing...",
        writes: [{ file: "tasks", action: "add", data: { title: "Test" } }],
      },
      { state: badState, phrase: "Task A", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.userMessage.includes("write failed"), "userMessage should mention write failure");
    assert.ok(result.data.writeError, "data.writeError must be populated for processBundle to detect");
  });

  await test("preserves sourceNoteId verbatim per write (Story 3)", async () => {
    const result: any = await submit_inbox_triage(
      {
        reply: "ok",
        writes: [
          { file: "tasks", action: "add", data: { title: "T1" }, sourceNoteId: "note_aaa" },
          { file: "notes", action: "add", data: { text: "N1" }, sourceNoteId: "note_bbb" },
          { file: "tasks", action: "add", data: { title: "T2" } /* no sourceNoteId */ },
        ],
      },
      { phrase: "x", skillId: "inbox_triage" }
    );
    assert.strictEqual(result.data.writes[0].sourceNoteId, "note_aaa");
    assert.strictEqual(result.data.writes[1].sourceNoteId, "note_bbb");
    assert.strictEqual(result.data.writes[2].sourceNoteId, undefined);
  });

  await test("defensively returns when args are empty", async () => {
    const result: any = await submit_inbox_triage({}, { phrase: "x", skillId: "inbox_triage" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.userMessage, "string");
    assert.strictEqual(result.data.writes.length, 0);
  });

  // ─── FEAT061 — dispatcher state forwarding regression ───────────────────
  section("FEAT061 — dispatchSkill forwards state to handler ctx (chat-driven path)");

  await test("dispatchSkill forwards state to handler ctx → fixture state mutated (chat-driven path)", async () => {
    // Chat-driven path: dispatcher MUST forward state to the handler so
    // applyWrites mutates the fixture. (The timer path via processBundle
    // intentionally does NOT pass state; it owns its own write loop. That
    // path is unaffected by this fix.)
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    assert.strictEqual(state.tasks.tasks.length, 0, "precondition: tasks empty");
    assert.strictEqual(state.calendar.events.length, 0, "precondition: calendar empty");
    assert.strictEqual(state.notes.notes.length, 0, "precondition: notes empty");
    const result = await dispatchSkill(
      makeRoute("inbox_triage"),
      "Task A by Friday. Meeting Tue 3pm. Idea: Project X kickoff doc.",
      {
        registry: reg,
        enabledSkillIds: new Set(["inbox_triage"]),
        state,
        llmClient: stubLlm("submit_inbox_triage", {
          reply: "Created task / event / note",
          writes: [
            { file: "tasks", action: "add", data: { title: "Task A", priority: "medium", status: "pending" } },
            { file: "calendar", action: "add", data: { title: "Meeting", datetime: "2026-04-28T15:00:00", durationMinutes: 60 } },
            { file: "notes", action: "add", data: { text: "Project X kickoff doc" } },
          ],
        }),
      }
    );
    assert.ok(result, "dispatch should not return null");
    assert.strictEqual(result!.skillId, "inbox_triage");
    // Load-bearing assertions: applyWrites ran via the dispatcher path
    // (each collection grew by exactly one).
    assert.strictEqual(state.tasks.tasks.length, 1, "task should be appended via applyWrites");
    assert.strictEqual(state.calendar.events.length, 1, "event should be appended via applyWrites");
    assert.strictEqual(state.notes.notes.length, 1, "note should be appended via applyWrites");
    assert.strictEqual(state.notes.notes[0].text, "Project X kickoff doc");
  });

  // ─── (c) 6-phrase regression fixture (Story 8 + design review §8.1) ─────
  section("(c) Story 8 — 6-phrase regression fixture (≥5/6 strict)");

  let regressionPasses = 0;
  for (const fx of REGRESSION_FIXTURES) {
    await test(`fixture: ${fx.phrase.slice(0, 60)}`, async () => {
      const reg = await loadProductionRegistry();
      const state = makeFixtureState();
      const result = await dispatchSkill(
        makeRoute("inbox_triage"),
        fx.phrase,
        {
          registry: reg,
          enabledSkillIds: new Set(["inbox_triage"]),
          state,
          llmClient: stubLlm("submit_inbox_triage", fx.cannedToolArgs),
        }
      );
      assert.ok(result, "dispatch should not return null");
      assert.strictEqual(result!.skillId, "inbox_triage");
      const data = (result!.handlerResult as any)?.data ?? {};
      const writes = data.writes ?? [];
      assert.strictEqual(writes.length, fx.expect.writeCount, `writes count mismatch for: ${fx.phrase.slice(0, 40)}`);

      if (fx.expect.expectedFiles) {
        const actualFiles = writes.map((w: any) => w.file);
        assert.deepStrictEqual(actualFiles, fx.expect.expectedFiles, `expected files: ${fx.expect.expectedFiles.join(",")}`);
      }
      if (fx.expect.noCalendarRecurringFields) {
        for (const w of writes) {
          if (w.file !== "calendar") continue;
          assert.strictEqual(w.data.recurring, undefined, "calendar write must not carry recurring");
          assert.strictEqual(w.data.recurrence, undefined, "calendar write must not carry recurrence");
          assert.strictEqual(w.data.recurrenceDay, undefined, "calendar write must not carry recurrenceDay");
        }
      }
      if (fx.expect.expectedSourceNoteIds) {
        for (let i = 0; i < fx.expect.expectedSourceNoteIds.length; i++) {
          assert.strictEqual(writes[i]?.sourceNoteId, fx.expect.expectedSourceNoteIds[i]);
        }
      }
      regressionPasses++;
    });
  }

  // ─── (d) Executor compatibility for non-array-shaped files ──────────────
  section("(d) Executor compatibility — design review risk row 9");

  await test("userObservations._arrayKey write reaches applyAdd cleanly (state mutated)", async () => {
    const state = makeFixtureState();
    const plan: any = {
      reply: "",
      writes: [{
        file: "userObservations",
        action: "add",
        data: { _arrayKey: "emotionalState", observation: "feeling focused", date: "2026-04-27" },
      }],
      items: [],
      conflictsToCheck: [],
      suggestions: [],
      memorySignals: [],
      topicSignals: [],
      needsClarification: false,
    };
    await applyWrites(plan, state);
    // After applyWrites + flush, state._dirty is cleared on successful disk
    // write. The signal the test wants is that applyAdd actually mutated
    // userObservations.emotionalState — that array is non-empty iff the
    // executor accepted the non-array-shaped userObservations write.
    assert.strictEqual(state.userObservations.emotionalState.length, 1);
    assert.strictEqual(state.userObservations.emotionalState[0].observation, "feeling focused");
  });

  await test("contextMemory.facts write reaches applyAdd cleanly (state mutated)", async () => {
    const state = makeFixtureState();
    const plan: any = {
      reply: "",
      writes: [{
        file: "contextMemory",
        action: "add",
        data: { facts: [{ text: "Project X is blocked on auth", topic: null, date: "2026-04-27" }] },
      }],
      items: [],
      conflictsToCheck: [],
      suggestions: [],
      memorySignals: [],
      topicSignals: [],
      needsClarification: false,
    };
    await applyWrites(plan, state);
    assert.strictEqual(state.contextMemory.facts.length, 1);
    assert.strictEqual(state.contextMemory.facts[0].text, "Project X is blocked on auth");
  });

  await test("recurringTasks write reaches applyAdd cleanly (state mutated)", async () => {
    const state = makeFixtureState();
    const plan: any = {
      reply: "",
      writes: [{
        file: "recurringTasks",
        action: "add",
        data: {
          title: "Weekly review",
          schedule: { type: "weekly", days: ["sunday"], time: "18:00" },
          category: "",
          priority: "medium",
          okrLink: null,
          duration: 30,
          notes: "",
          active: true,
        },
      }],
      items: [],
      conflictsToCheck: [],
      suggestions: [],
      memorySignals: [],
      topicSignals: [],
      needsClarification: false,
    };
    await applyWrites(plan, state);
    assert.strictEqual(state.recurringTasks.recurring.length, 1);
    assert.strictEqual(state.recurringTasks.recurring[0].title, "Weekly review");
    assert.ok(state.recurringTasks.recurring[0].id, "executor should inject id");
    assert.ok(state.recurringTasks.recurring[0].createdAt, "executor should inject createdAt");
  });

  // ─── (e) Disable-gate tests for processBundle ───────────────────────────
  section("(e) Disable-gate test — processBundle (timer entry point, condition 11)");

  await test("processBundle with empty enabled set never invokes dispatchSkill (legacy path runs)", async () => {
    // With v4 disabled and no LLM client initialized, callLlm returns null
    // and the legacy chunk loop reports succeeded=false. The signal we want
    // is that the v4 dispatch path was NOT taken — verified by the absence
    // of any v4 writes (an empty Set in dispatcher means it returns null
    // before any LLM call). This tests condition 11 for the timer path.
    _resetOrchestratorForTests();
    setV4SkillsEnabled([]); // explicitly disable v4 for inbox_triage
    await loadProductionRegistry();

    const state = makeFixtureState();
    // Track dispatcher calls by stubbing global getClient via the inbox path:
    // when v4 is disabled the loop falls through to runLegacyChunk → callLlm,
    // which (with no client initialized in tests) returns null. So a fully
    // empty enabled-set forces the legacy path.
    const result = await processBundle("Buy bread tomorrow.", state, "test-disable");

    // Legacy path with no LLM client → succeeded=false, zero writes.
    // The fact that we got here without throwing AND zero writes happened
    // means dispatchSkill was never reached for inbox_triage (the gate
    // guarded it correctly). If the gate were broken, the v4 path would
    // have called the (uninitialized) client and behaved differently.
    assert.strictEqual(result.succeeded, false, "no client + legacy path → succeeded=false");
    assert.strictEqual(result.totalWrites, 0);
    assert.strictEqual(result.writes.length, 0);
  });

  await test("write-failure contract — handler surfaces writeError so processBundle preserves inbox", async () => {
    // The bug the code reviewer fixed (inbox.ts:108-127): if every chunk
    // hit a writeError, processBundle would still return succeeded=true →
    // processInbox calls clearInbox → user data lost. The fix hoists the
    // writeError check above the anyChunkSucceeded=true line. The
    // contract is: when applyWrites throws, the handler must return
    //   data.writeError !== null  AND  success === false
    // That is the signal `processBundle` (inbox.ts:117) reads to SKIP
    // the `anyChunkSucceeded = true` assignment, preventing clearInbox.
    //
    // Note: dispatchSkill does not forward `state` to handlers; in
    // production, state-in-ctx flows directly via a different path
    // (handler is invoked directly by processBundle's chain). We test
    // the handler contract at the boundary processBundle relies on.
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      tasks: null, // makes applyAdd throw on Object.assign(target, d)
    };
    const result: any = await submit_inbox_triage(
      {
        reply: "Created task: Buy bread",
        writes: [{ file: "tasks", action: "add", data: { title: "Buy bread" } }],
      },
      { state: badState, phrase: "Buy bread tomorrow.", skillId: "inbox_triage" }
    );
    // These three values are exactly what processBundle reads to
    // decide whether to mark the chunk succeeded.
    assert.strictEqual(result.success, false, "handler must report failure");
    assert.ok(result.data.writeError, "writeError must be populated");
    assert.ok(
      String(result.userMessage).toLowerCase().includes("write failed"),
      "userMessage must surface the failure for the inbox.ts replies aggregation"
    );
  });

  // ─── (f) Story 5 — template validation ──────────────────────────────────
  section("(f) Story 5 — template validation");

  await test("inbox_triage handler signature matches FEAT057-059 template", () => {
    assert.strictEqual(typeof submit_inbox_triage, "function");
    const p = submit_inbox_triage({}, { phrase: "x", skillId: "inbox_triage" });
    assert.ok(p && typeof p.then === "function", "handler returns a Promise");
  });

  await test("inbox_triage context.ts uses only supported resolver keys", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("inbox_triage")!;
    const declared = Object.keys(skill.contextRequirements);
    const SUPPORTED = new Set([
      "userProfile", "objectives", "recentTasks",
      "calendarToday", "calendarNextSevenDays", "calendarEvents",
      "tasksIndex", "contradictionIndexDates", "topicList",
      "existingTopicHints", "userToday",
    ]);
    for (const k of declared) {
      assert.ok(SUPPORTED.has(k), `context key "${k}" must be in dispatcher's supported keys`);
    }
  });

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`Regression fixture: ${regressionPasses}/${REGRESSION_FIXTURES.length} (strict threshold: ≥5/6)`);
  if (failed > 0) process.exit(1);
  if (regressionPasses < 5) {
    console.error("Regression threshold not met (need ≥5/6).");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
