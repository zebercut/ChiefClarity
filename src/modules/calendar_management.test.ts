/**
 * FEAT059 — calendar_management skill tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/calendar_management.test.ts
 *       or: npm test
 *
 * Covers:
 *   1. Skill loads via production registry (smoke)
 *   2. Handler logic — defensive CalendarEvent defaults + stripRecurringFields safety
 *   3. 7-phrase regression fixture (Story 1) including recurring-attempt assertion
 *      (design review §6.6 — handler must emit zero recurring-field writes
 *       even if the LLM ignores the prompt's "do NOT" rule)
 *   4. Resolver branches: calendarEvents / calendarToday / calendarNextSevenDays
 *      (design review §6.3 — three new branches)
 *   5. Story 5 — template validation
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "assert";
import { dispatchSkill } from "./skillDispatcher";
import { loadSkillRegistry, _resetSkillRegistryForTests } from "./skillRegistry";
import { setDataRoot } from "../utils/filesystem";
import type { RouteResult } from "../types/orchestrator";
import { submit_calendar_action } from "../skills/calendar_management/handlers";
import { getActiveEvents } from "./assembler";

// Redirect filesystem writes during tests to a temp dir so applyWrites'
// flush() does not leak fixture data to the repo cwd. (FEAT060 leakage.)
const TMP_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "feat061-cm-"));
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

function makeFixtureState(extras?: any): any {
  return {
    _pendingContext: null,
    _loadedCounts: {},
    _dirty: new Set(),
    userProfile: { timezone: "UTC", workingHours: {} },
    hotContext: { today: "2026-04-27" },
    calendar: { _summary: "", events: extras?.events ?? [] },
    tasks: { _summary: "", tasks: [] },
    topicManifest: { topics: [], signals: [], suggestions: [] },
    contextMemory: { facts: [] },
    contradictionIndex: { byDate: {} },
  };
}

// ─── 7-phrase regression fixture (Story 1, design review §6.10) ─────────────

interface RegressionPhrase {
  phrase: string;
  cannedToolArgs: any;
  expect: {
    writeCount: number;
    needsClarification?: boolean;
    /** asserts the first write's data has none of the recurring fields */
    noRecurringFields?: boolean;
    /** asserts the first write has this title */
    expectedTitle?: string;
    /** asserts items length for query phrases */
    itemCount?: number;
  };
}

const REGRESSION_FIXTURES: RegressionPhrase[] = [
  // 1. Create — explicit time
  {
    phrase: "schedule a meeting with Contact A on Friday at 3pm",
    cannedToolArgs: {
      reply: "Scheduled: Meeting with Contact A — Fri 3:00 PM",
      writes: [{ action: "add", data: { title: "Meeting with Contact A", datetime: "2026-05-01T15:00:00", durationMinutes: 60 } }],
    },
    expect: { writeCount: 1, expectedTitle: "Meeting with Contact A", noRecurringFields: true },
  },
  // 2. Create — needs clarification (no time)
  {
    phrase: "book a call with Candidate X next Tuesday",
    cannedToolArgs: {
      reply: "What time should I schedule it?",
      writes: [],
      needsClarification: true,
    },
    expect: { writeCount: 0, needsClarification: true },
  },
  // 3. Update — reschedule by id
  {
    phrase: "reschedule the standup to 10am",
    cannedToolArgs: {
      reply: "Rescheduled: Standup → 10:00 AM",
      writes: [{ action: "update", id: "evt-1", data: { datetime: "2026-04-28T10:00:00" } }],
    },
    expect: { writeCount: 1 },
  },
  // 4. Cancel — sets status
  {
    phrase: "cancel Tuesday's meeting",
    cannedToolArgs: {
      reply: "Cancelled: Project Alpha sync",
      writes: [{ action: "update", id: "evt-2", data: { status: "cancelled" } }],
    },
    expect: { writeCount: 1 },
  },
  // 5. Query — today
  {
    phrase: "what's on my calendar today?",
    cannedToolArgs: {
      reply: "You have 1 thing today:",
      writes: [],
      items: [{ id: "evt-3", title: "Team meeting", type: "calendar" }],
    },
    expect: { writeCount: 0, itemCount: 1 },
  },
  // 6. Query — am I free
  {
    phrase: "am I free Friday afternoon?",
    cannedToolArgs: {
      reply: "You're free Friday afternoon.",
      writes: [],
      items: [],
    },
    expect: { writeCount: 0, itemCount: 0 },
  },
  // 7. Recurring attempt — defense in depth
  // The prompt says "do NOT". This fixture pretends the LLM ignored
  // the rule and emitted recurring fields anyway. The handler MUST
  // strip them before reaching the executor.
  {
    phrase: "schedule team sync every Friday at 11am",
    cannedToolArgs: {
      reply: "That sounds like a recurring activity — try the recurring task handler.",
      writes: [
        {
          action: "add",
          data: {
            title: "Team sync",
            datetime: "2026-05-01T11:00:00",
            recurring: true,
            recurrence: "weekly",
            recurrenceDay: "Friday",
          },
        },
      ],
      needsClarification: true,
    },
    expect: { writeCount: 1, expectedTitle: "Team sync", noRecurringFields: true, needsClarification: true },
  },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  section("Skill loading");

  await test("calendar_management loads via production registry with expected manifest", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("calendar_management");
    assert.ok(skill);
    assert.strictEqual(skill!.manifest.model, "haiku");
    assert.deepStrictEqual(skill!.manifest.tools, ["submit_calendar_action"]);
    assert.ok(skill!.handlers.submit_calendar_action);
    assert.deepStrictEqual(
      skill!.manifest.dataSchemas.read.sort(),
      ["calendar", "objectives", "tasks", "topics"]
    );
    assert.deepStrictEqual(skill!.manifest.dataSchemas.write, ["calendar"]);
    assert.strictEqual(skill!.manifest.tokenBudget, 3000);
    assert.strictEqual(skill!.manifest.surface, null);
  });

  await test("triggerPhrases use noun-prefixes (Story 5 — embedding distance from general_assistant)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("calendar_management")!;
    for (const t of skill.manifest.triggerPhrases) {
      const lower = t.toLowerCase();
      const hasNoun = /meeting|call|calendar|schedul|reschedul|cancel|free|event|block|have|anything/.test(lower);
      assert.ok(hasNoun, `triggerPhrase "${t}" should be calendar-noun-prefixed`);
    }
  });

  await test("prompt.md contains the recurring-event safety rule (design review §6.5)", () => {
    const promptPath = path.join("src", "skills", "calendar_management", "prompt.md");
    const prompt = fs.readFileSync(promptPath, "utf8");
    // The verbatim guard should mention all three deprecated fields.
    assert.ok(/recurring/i.test(prompt), "prompt should mention 'recurring'");
    assert.ok(/recurrence/i.test(prompt), "prompt should mention 'recurrence'");
    assert.ok(/recurrenceDay/.test(prompt), "prompt should mention 'recurrenceDay'");
    // It should redirect, not silently reject.
    assert.ok(/recurring (task|handler)/i.test(prompt), "prompt should redirect to recurring handler");
  });

  section("Handler logic (no state, no executor call)");

  await test("handler returns plan from args — test mode", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "Scheduled.",
        writes: [{ action: "add", data: { title: "Test event", datetime: "2026-05-01T15:00:00" } }],
      },
      { phrase: "schedule something", skillId: "calendar_management" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Scheduled.");
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].file, "calendar");
    assert.strictEqual(result.data.writes[0].action, "add");
  });

  await test("handler fills CalendarEvent defaults for all required fields", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [{ action: "add", data: { title: "Just title", datetime: "2026-05-01T10:00:00" } }],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    const data = result.data.writes[0].data;
    // Required CalendarEvent fields per src/types/index.ts:239-261
    // (id and createdAt are added by the executor's default branch — not here)
    assert.strictEqual(data.title, "Just title");
    assert.strictEqual(data.datetime, "2026-05-01T10:00:00");
    assert.strictEqual(data.durationMinutes, 60);  // default
    assert.strictEqual(data.status, "scheduled");
    assert.strictEqual(data.type, "meeting");
    assert.strictEqual(data.priority, "medium");
    assert.strictEqual(data.notes, "");
    assert.deepStrictEqual(data.relatedInbox, []);
  });

  await test("handler preserves explicit durationMinutes (does not override)", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [{ action: "add", data: { title: "30min call", datetime: "2026-05-01T10:00:00", durationMinutes: 30 } }],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    assert.strictEqual(result.data.writes[0].data.durationMinutes, 30);
  });

  await test("handler defaults durationMinutes to 60 when 0 or negative is supplied", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [{ action: "add", data: { title: "x", datetime: "2026-05-01T10:00:00", durationMinutes: 0 } }],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    assert.strictEqual(result.data.writes[0].data.durationMinutes, 60);
  });

  await test("handler strips recurring fields from add (design review §6.6)", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [
          {
            action: "add",
            data: {
              title: "Sync",
              datetime: "2026-05-01T10:00:00",
              recurring: true,
              recurrence: "weekly",
              recurrenceDay: "Friday",
            } as any,
          },
        ],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    const w = result.data.writes[0].data;
    assert.strictEqual(w.recurring, undefined);
    assert.strictEqual(w.recurrence, undefined);
    assert.strictEqual(w.recurrenceDay, undefined);
    assert.strictEqual(w.title, "Sync");
  });

  await test("handler strips recurring fields from update too", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [
          {
            action: "update",
            id: "evt-1",
            data: { recurring: true, status: "cancelled" } as any,
          },
        ],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    const w = result.data.writes[0].data;
    assert.strictEqual(w.recurring, undefined);
    assert.strictEqual(w.status, "cancelled");
  });

  await test("handler filters adds with empty title (defensive)", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { title: "real", datetime: "2026-05-01T10:00:00" } },
          { action: "add", data: { title: "" } } as any,
          { action: "add", data: {} } as any,
          null as any,
          { action: "bogus", data: {} } as any,
        ],
      },
      { phrase: "x", skillId: "calendar_management" }
    );
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].data.title, "real");
  });

  await test("handler propagates clarificationRequired flag", async () => {
    const result: any = await submit_calendar_action(
      { reply: "What time?", needsClarification: true, writes: [] },
      { phrase: "schedule X tomorrow", skillId: "calendar_management" }
    );
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("handler defensively returns when args are empty", async () => {
    const result: any = await submit_calendar_action(
      {},
      { phrase: "x", skillId: "calendar_management" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.userMessage, "string");
    assert.strictEqual(result.data.writes.length, 0);
  });

  await test("handler captures applyWrites errors gracefully (FEAT057 B1 pattern)", async () => {
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      calendar: null, // malformed — applyWrites should throw
    };
    const result: any = await submit_calendar_action(
      {
        reply: "Scheduling...",
        writes: [{ action: "add", data: { title: "Test", datetime: "2026-05-01T10:00:00" } }],
      },
      { state: badState, phrase: "schedule X", skillId: "calendar_management" }
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.userMessage.includes("write failed"));
    assert.ok(result.data.writeError);
  });

  await test("handler passes items through for queries", async () => {
    const result: any = await submit_calendar_action(
      {
        reply: "You have 1 thing today:",
        writes: [],
        items: [{ id: "evt-3", title: "Team meeting", type: "calendar" }],
      },
      { phrase: "what's on my calendar today?", skillId: "calendar_management" }
    );
    assert.strictEqual(result.data.items.length, 1);
    assert.strictEqual(result.data.items[0].id, "evt-3");
  });

  // FEAT061 — dispatcher state forwarding regression
  section("FEAT061 — dispatchSkill forwards state to handler ctx");

  await test("dispatchSkill forwards state to handler ctx → fixture state mutated", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    assert.strictEqual(state.calendar.events.length, 0, "precondition: empty");
    const result = await dispatchSkill(
      makeRoute("calendar_management"),
      "schedule a sync on Friday at 3pm",
      {
        registry: reg,
        enabledSkillIds: new Set(["calendar_management"]),
        state,
        llmClient: stubLlm("submit_calendar_action", {
          reply: "Scheduled: Sync — Fri 3:00 PM",
          writes: [{ action: "add", data: { title: "Sync", datetime: "2026-05-01T15:00:00", durationMinutes: 60 } }],
        }),
      }
    );
    assert.ok(result, "dispatch should not return null");
    assert.strictEqual(result!.skillId, "calendar_management");
    // The load-bearing assertion: applyWrites ran via the dispatcher path.
    assert.strictEqual(state.calendar.events.length, 1, "event should be appended via applyWrites");
    assert.strictEqual(state.calendar.events[0].title, "Sync");
  });

  // 7-phrase regression set (Story 1, design review §6.10)
  section("Story 1 + design review §6.10 — 7-phrase regression fixture (≥6/7 strict)");

  let regressionPasses = 0;
  for (const fx of REGRESSION_FIXTURES) {
    await test(`fixture: ${fx.phrase.slice(0, 60)}`, async () => {
      const reg = await loadProductionRegistry();
      const state = makeFixtureState({
        events: [
          { id: "evt-1", title: "Standup", datetime: "2026-04-28T09:00:00", durationMinutes: 15, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
          { id: "evt-2", title: "Project Alpha sync", datetime: "2026-04-28T14:00:00", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
          { id: "evt-3", title: "Team meeting", datetime: "2026-04-27T10:00:00", durationMinutes: 30, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        ],
      });
      const result = await dispatchSkill(
        makeRoute("calendar_management"),
        fx.phrase,
        {
          registry: reg,
          enabledSkillIds: new Set(["calendar_management"]),
          state,
          llmClient: stubLlm("submit_calendar_action", fx.cannedToolArgs),
        }
      );
      assert.ok(result, "dispatch should not return null");
      assert.strictEqual(result!.skillId, "calendar_management");
      const data = (result!.handlerResult as any)?.data ?? {};
      assert.strictEqual((data.writes ?? []).length, fx.expect.writeCount, `writes mismatch for: ${fx.phrase}`);
      if (fx.expect.expectedTitle && data.writes?.length) {
        assert.strictEqual(data.writes[0].data.title, fx.expect.expectedTitle);
      }
      if (fx.expect.noRecurringFields && data.writes?.length) {
        const w = data.writes[0].data;
        assert.strictEqual(w.recurring, undefined, "recurring must be stripped");
        assert.strictEqual(w.recurrence, undefined, "recurrence must be stripped");
        assert.strictEqual(w.recurrenceDay, undefined, "recurrenceDay must be stripped");
      }
      if (fx.expect.needsClarification) {
        assert.strictEqual(result!.clarificationRequired, true);
      }
      if (typeof fx.expect.itemCount === "number") {
        assert.strictEqual((data.items ?? []).length, fx.expect.itemCount);
      }
      regressionPasses++;
    });
  }

  // Story 5 — template validation
  section("Story 5 — template validation (FEAT057/058 pattern)");

  await test("calendar_management handler signature matches template", () => {
    assert.strictEqual(typeof submit_calendar_action, "function");
    const p = submit_calendar_action({}, { phrase: "x", skillId: "calendar_management" });
    assert.ok(p && typeof p.then === "function");
  });

  await test("calendar_management context.ts uses only supported resolver keys", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("calendar_management")!;
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

  // Resolver branches (design review §6.3)
  section("Resolver branches — calendarEvents / calendarToday / calendarNextSevenDays");

  await test("getActiveEvents filters cancelled, archived, undated, and past events", () => {
    const state = makeFixtureState({
      events: [
        { id: "a", title: "Future", datetime: "2026-05-10T10:00:00", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        { id: "b", title: "Past", datetime: "2026-04-01T10:00:00", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        { id: "c", title: "Cancelled", datetime: "2026-05-10T11:00:00", durationMinutes: 60, status: "cancelled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        { id: "d", title: "Archived", datetime: "2026-05-10T12:00:00", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [], archived: true },
        { id: "e", title: "Undated", datetime: "", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        { id: "f", title: "Today", datetime: "2026-04-27T15:00:00", durationMinutes: 60, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
      ],
    });
    const active = getActiveEvents(state);
    const ids = active.map((e: any) => e.id).sort();
    assert.deepStrictEqual(ids, ["a", "f"]);
  });

  await test("dispatcher resolver computes calendarEvents / calendarToday / calendarNextSevenDays", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("calendar_management")!;
    const state = makeFixtureState({
      events: [
        // today
        { id: "t1", title: "Today AM", datetime: "2026-04-27T09:00:00", durationMinutes: 30, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        // today+3 (within 7 days)
        { id: "t2", title: "Soon", datetime: "2026-04-30T10:00:00", durationMinutes: 30, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
        // today+10 (outside 7 days)
        { id: "t3", title: "Later", datetime: "2026-05-07T10:00:00", durationMinutes: 30, status: "scheduled", type: "meeting", priority: "medium", notes: "", relatedInbox: [] },
      ],
    });

    // Use dispatcher's internal resolver via a stub call — we capture the
    // context by intercepting the LLM call.
    let capturedContext: any = null;
    const llm: any = {
      messages: {
        create: async (params: any) => {
          capturedContext = params;
          return { content: [{ type: "tool_use", name: "submit_calendar_action", input: { reply: "ok", writes: [] } }] };
        },
      },
    };
    await dispatchSkill(
      makeRoute("calendar_management"),
      "test",
      { registry: reg, enabledSkillIds: new Set(["calendar_management"]), state, llmClient: llm }
    );
    assert.ok(capturedContext, "LLM must have been called with context");
    // The system prompt should include all three keys' values; we
    // assert via a serialized substring rather than parsing the prompt.
    const sys = JSON.stringify(capturedContext.system ?? "");
    const messagesStr = JSON.stringify(capturedContext.messages ?? "");
    const all = sys + messagesStr;
    assert.ok(all.includes("Today AM"), "calendarEvents/calendarToday should include today's event");
    assert.ok(all.includes("Soon"), "calendarNextSevenDays should include event within 7 days");
    // "Later" is outside 7 days but inside calendarEvents — at least one of
    // the three keys (calendarEvents) should contain it.
    assert.ok(all.includes("Later"), "calendarEvents should include far-future event");
    // Bind the skill check above to manifest declarations
    const declared = Object.keys(skill.contextRequirements);
    assert.ok(declared.includes("calendarEvents"));
  });

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`Regression fixture: ${regressionPasses}/${REGRESSION_FIXTURES.length} (strict threshold: ≥6/7)`);
  if (failed > 0) process.exit(1);
  if (regressionPasses < 6) {
    console.error("Regression threshold not met (need ≥6/7).");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(1);
});
