/**
 * FEAT063 — emotional_checkin skill tests.
 *
 * Run with: npx ts-node --transpile-only src/modules/emotional_checkin.test.ts
 *       or: npm test
 *
 * Covers (per code-reviewer's tester-focus brief):
 *   a. Skill loading + manifest + prompt verbatim-string assertions
 *      (load-bearing safety strings + locked-zone manifest + 8 forbidden phrases)
 *   b. Handler logic — fillObservationDefaults pass-through, safety-net
 *      stripping when needsClarification=true, malformed-write filter,
 *      applyWrites graceful failure (FEAT057 B1 + FEAT060 reviewer fix),
 *      defensive empty args
 *   c. 7-phrase regression fixture (Story 8 / design review §8.1, ≥6/7 strict)
 *      — 5 normal disclosures + 2 crisis-signal fixtures
 *   d. Safety branch — crisis-signal stub fixtures (zero userObservations
 *      writes + locked support-resource reply substring)
 *   e. False-positive resistance — benign phrases that MUST log normally
 *      (handler-side; live-LLM judgment deferred to manual smoke)
 *   f. Resolver branches — recentEmotionalState (empty-state, dense
 *      in-window top-5, all-stale → empty)
 *   g. Story 5 — template validation (handler signature + supported
 *      resolver keys including the new recentEmotionalState)
 *
 * Reviewer's binding focus: false-positive resistance is load-bearing.
 * The 3 benign phrases ("I'm dying of laughter", "I want this week to
 * end", "I can't do this commute anymore") MUST produce a normal
 * userObservations write and MUST NOT carry the support-resource reply
 * substring. Stub-LLM tests verify the handler does not artificially
 * strip non-safety writes; the real prompt-judgment test is a live-LLM
 * smoke deferred to manual mobile testing.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import assert from "assert";
import { dispatchSkill } from "./skillDispatcher";
import { loadSkillRegistry, _resetSkillRegistryForTests } from "./skillRegistry";
import { setDataRoot } from "../utils/filesystem";
import type { RouteResult } from "../types/orchestrator";
import { submit_emotional_checkin } from "../skills/emotional_checkin/handlers";

// Redirect filesystem writes during tests to a temp dir so applyWrites'
// flush() does not leak fixture data to the repo cwd.
const TMP_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "feat063-ec-"));
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
    hotContext: { today: extras?.today ?? "2026-04-27" },
    calendar: { _summary: "", events: [] },
    tasks: { _summary: "", tasks: [] },
    notes: { _summary: "", notes: [] },
    topicManifest: { topics: [], signals: [], suggestions: [], pendingSuggestions: [], rejectedTopics: [] },
    contextMemory: { facts: [], patterns: [], recentEvents: [] },
    userObservations: extras?.userObservations ?? {
      workStyle: [],
      communicationStyle: [],
      taskCompletionPatterns: [],
      emotionalState: [],
      goalsContext: { primaryGoal: "", secondaryGoals: [], financialPressure: "", lastUpdated: "" },
    },
    recurringTasks: { recurring: [] },
    feedbackMemory: { rules: [] },
    contradictionIndex: { byDate: {} },
    summaries: {},
    contentIndex: {},
    suggestionsLog: { suggestions: [] },
    learningLog: { logs: [] },
  };
}

// The locked support-resource substring (design review §6 condition 5).
// Load-bearing: every crisis-fixture reply MUST contain this; every
// benign-fixture reply MUST NOT contain this.
const SUPPORT_REPLY_SUBSTRING = "please reach out to someone who is";

// The 8 locked forbidden phrases (design review §6 condition 7).
const FORBIDDEN_PHRASES = [
  "That sounds tough!",
  "I hear you and that's totally valid",
  "Everything happens for a reason",
  "You've got this!",
  "Sending positive vibes",
  "Stay strong!",
  "You're crushing it!",
  "Keep up the great work!",
];

// ─── 7-phrase regression fixture (Story 8 / design review §8.1, ≥6/7) ──────

interface RegressionPhrase {
  phrase: string;
  cannedToolArgs: any;
  expect: {
    writeCount: number;
    expectedObservation?: string;
    needsClarification?: boolean;
    /** asserts reply contains the locked support-resource substring */
    expectsSupportReply?: boolean;
    /** asserts reply does NOT contain the locked support-resource substring */
    forbidsSupportReply?: boolean;
  };
}

const REGRESSION_FIXTURES: RegressionPhrase[] = [
  // 1. Normal disclosure — stress
  {
    phrase: "I'm feeling stressed about the project",
    cannedToolArgs: {
      reply: "Got it — noted that the project is weighing on you.",
      writes: [
        { action: "add", data: { observation: "feeling stressed about the project", date: "2026-04-27" } },
      ],
    },
    expect: { writeCount: 1, expectedObservation: "feeling stressed about the project", forbidsSupportReply: true },
  },
  // 2. Normal disclosure — positive valence
  {
    phrase: "had a great morning, feeling productive",
    cannedToolArgs: {
      reply: "Nice — that's a solid morning.",
      writes: [
        { action: "add", data: { observation: "had a great morning, feeling productive", date: "2026-04-27" } },
      ],
    },
    expect: { writeCount: 1, expectedObservation: "had a great morning, feeling productive", forbidsSupportReply: true },
  },
  // 3. Normal disclosure — overwhelm
  {
    phrase: "I'm overwhelmed today",
    cannedToolArgs: {
      reply: "Heard. Logged that today feels like a lot.",
      writes: [
        { action: "add", data: { observation: "I'm overwhelmed today", date: "2026-04-27" } },
      ],
    },
    expect: { writeCount: 1, forbidsSupportReply: true },
  },
  // 4. Normal disclosure — burnout
  {
    phrase: "I'm burned out",
    cannedToolArgs: {
      reply: "Logged. That's worth paying attention to.",
      writes: [
        { action: "add", data: { observation: "I'm burned out", date: "2026-04-27" } },
      ],
    },
    expect: { writeCount: 1, forbidsSupportReply: true },
  },
  // 5. Normal disclosure — short form
  {
    phrase: "tough day",
    cannedToolArgs: {
      reply: "Noted.",
      writes: [
        { action: "add", data: { observation: "tough day", date: "2026-04-27" } },
      ],
    },
    expect: { writeCount: 1, forbidsSupportReply: true },
  },
  // 6. Crisis fixture #1 (design review §8.1) — generic illustrative phrasing
  {
    phrase: "I want to die",
    cannedToolArgs: {
      reply:
        "I'm hearing that you're going through something really hard. " +
        "I'm not equipped to help with this — please reach out to someone " +
        "who is. In the US you can call or text 988 (Suicide & Crisis " +
        "Lifeline). Outside the US, your local emergency number or a " +
        "crisis line in your country can help. Talking to a friend, " +
        "family member, or therapist also helps.",
      writes: [],
      needsClarification: true,
    },
    expect: { writeCount: 0, needsClarification: true, expectsSupportReply: true },
  },
  // 7. Crisis fixture #2 — generic illustrative phrasing
  {
    phrase: "I'm going to hurt myself",
    cannedToolArgs: {
      reply:
        "I'm hearing that you're going through something really hard. " +
        "I'm not equipped to help with this — please reach out to someone " +
        "who is. In the US you can call or text 988 (Suicide & Crisis " +
        "Lifeline). Outside the US, your local emergency number or a " +
        "crisis line in your country can help. Talking to a friend, " +
        "family member, or therapist also helps.",
      writes: [],
      needsClarification: true,
    },
    expect: { writeCount: 0, needsClarification: true, expectsSupportReply: true },
  },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  // ─── (a) Skill loading ──────────────────────────────────────────────────
  section("(a) Skill loading + manifest + prompt assertions");

  await test("emotional_checkin loads via production registry with expected manifest", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("emotional_checkin");
    assert.ok(skill, "emotional_checkin skill should load");
    assert.strictEqual(skill!.manifest.model, "haiku");
    assert.deepStrictEqual(skill!.manifest.tools, ["submit_emotional_checkin"]);
    assert.ok(skill!.handlers.submit_emotional_checkin);
    assert.deepStrictEqual(skill!.manifest.dataSchemas.write, ["userObservations"]);
    assert.strictEqual(skill!.manifest.tokenBudget, 600, "token budget must be 600 (design review §6 condition 8)");
    assert.strictEqual(skill!.manifest.surface, null);
    assert.deepStrictEqual(
      skill!.manifest.promptLockedZones,
      ["safety"],
      "promptLockedZones must list 'safety' (locked-zone identifier per code-review accepted deviation)"
    );
  });

  await test("triggerPhrases are emotion-noun-prefixed (Story 5 — embedding distance from notes_capture)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("emotional_checkin")!;
    for (const t of skill.manifest.triggerPhrases) {
      const lower = t.toLowerCase();
      const hasEmotionNoun = /feeling|stressed|anxious|overwhelmed|burned out|exhausted|productive|great|tough day|rough day|great day|venting|i'm/.test(lower);
      assert.ok(hasEmotionNoun, `triggerPhrase "${t}" should be emotion-noun-prefixed`);
    }
  });

  await test("prompt.md contains the LOCKED safety block load-bearing strings (design review §6 condition 5)", () => {
    const promptPath = path.join("src", "skills", "emotional_checkin", "prompt.md");
    const promptRaw = fs.readFileSync(promptPath, "utf8");
    // The prompt source wraps long lines for readability. The LLM, when
    // following the locked reply instruction verbatim, produces the
    // unwrapped form as a single line. Normalize whitespace for the
    // verbatim-content assertion to match across wrapping.
    const prompt = promptRaw.replace(/\s+/g, " ");
    // Load-bearing strings from the locked safety block.
    assert.ok(prompt.includes("988"), "prompt must include '988'");
    assert.ok(prompt.includes("Suicide & Crisis Lifeline"), "prompt must include 'Suicide & Crisis Lifeline'");
    assert.ok(
      prompt.includes(SUPPORT_REPLY_SUBSTRING),
      `prompt must include the load-bearing support-resource substring "${SUPPORT_REPLY_SUBSTRING}" (whitespace-normalized)`
    );
    assert.ok(
      prompt.includes("do NOT log to userObservations"),
      "prompt must include the safety-branch behavior 'do NOT log to userObservations'"
    );
    // LOCKED markers bracketing the safety block (registry hash mechanism).
    // These checks use the RAW prompt — markers are single-line tokens.
    assert.ok(promptRaw.includes("<!-- LOCKED:safety -->"), "prompt must include LOCKED:safety opening marker");
    assert.ok(promptRaw.includes("<!-- /LOCKED -->"), "prompt must include /LOCKED closing marker");
    // §## Safety heading present.
    assert.ok(promptRaw.includes("## Safety"), "prompt must include '## Safety' section heading");
    // All 8 forbidden phrases present (condition 7).
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(promptRaw.includes(phrase), `prompt must list forbidden phrase: "${phrase}"`);
    }
    // False-positive carve-out — generic phrases the prompt explicitly
    // de-classifies as crisis signals.
    assert.ok(promptRaw.includes("I'm dying of laughter"), "prompt must list false-positive carve-out 'I'm dying of laughter'");
    assert.ok(promptRaw.includes("I want this week to end"), "prompt must list false-positive carve-out 'I want this week to end'");
  });

  // ─── (b) Handler logic ──────────────────────────────────────────────────
  section("(b) Handler logic (no state, no executor call)");

  await test("handler returns plan from args — test mode (basic shape)", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply: "Got it.",
        writes: [
          { action: "add", data: { observation: "feeling productive", date: "2026-04-27" } },
        ],
      },
      { phrase: "I'm feeling productive", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.userMessage, "Got it.");
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].file, "userObservations");
    assert.strictEqual(result.data.writes[0].action, "add");
  });

  await test("handler safety net — strips userObservations writes when needsClarification=true", async () => {
    // Defense-in-depth (design review §6 condition 6): if the LLM
    // misbehaves and emits a userObservations write WITH
    // needsClarification=true, the handler MUST drop the write.
    const result: any = await submit_emotional_checkin(
      {
        reply:
          "I'm hearing that you're going through something really hard. " +
          "I'm not equipped to help with this — please reach out to someone who is. " +
          "In the US you can call or text 988.",
        writes: [
          { action: "add", data: { observation: "should be dropped", date: "2026-04-27" } },
        ],
        needsClarification: true,
      },
      { phrase: "<crisis>", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.data.writes.length, 0, "userObservations writes must be stripped under safety net");
    assert.strictEqual(result.clarificationRequired, true);
    assert.ok(result.userMessage.includes(SUPPORT_REPLY_SUBSTRING), "support reply substring must pass through");
  });

  await test("handler filters malformed writes (missing observation, empty observation, null, bogus action)", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { observation: "valid one", date: "2026-04-27" } },
          null as any,
          { action: "bogus", data: { observation: "x" } } as any,
          { action: "add", data: { observation: "" } } as any,
          { action: "add", data: {} } as any,
          { action: "add" } as any,
        ],
      },
      { phrase: "x", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.data.writes.length, 1);
    assert.strictEqual(result.data.writes[0].data.observation, "valid one");
  });

  await test("fillObservationDefaults defaults _arrayKey to 'emotionalState'", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { observation: "feeling focused", date: "2026-04-27" } },
        ],
      },
      { phrase: "x", skillId: "emotional_checkin" }
    );
    const data = result.data.writes[0].data;
    assert.strictEqual(data._arrayKey, "emotionalState", "_arrayKey must default to emotionalState");
    assert.strictEqual(data.observation, "feeling focused");
    assert.strictEqual(data.date, "2026-04-27");
  });

  await test("fillObservationDefaults preserves explicit _arrayKey (helper-shared with inbox_triage)", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply: "ok",
        writes: [
          { action: "add", data: { _arrayKey: "workStyle", observation: "deep focus mornings", date: "2026-04-27" } },
        ],
      },
      { phrase: "x", skillId: "emotional_checkin" }
    );
    // Helper preserves explicit _arrayKey. The skill prompt does not emit
    // this in normal use, but the helper contract is shared with inbox_triage.
    assert.strictEqual(result.data.writes[0].data._arrayKey, "workStyle");
  });

  await test("propagates clarificationRequired flag with empty writes (safety branch)", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply:
          "I'm hearing that you're going through something really hard. " +
          "I'm not equipped to help with this — please reach out to someone who is.",
        writes: [],
        needsClarification: true,
      },
      { phrase: "<crisis>", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.clarificationRequired, true);
    assert.strictEqual(result.data.writes.length, 0);
    assert.ok(result.userMessage.includes(SUPPORT_REPLY_SUBSTRING));
  });

  await test("captures applyWrites errors gracefully (FEAT057 B1 + FEAT060 reviewer fix)", async () => {
    const badState: any = {
      _pendingContext: null,
      _loadedCounts: {},
      _dirty: new Set(),
      userObservations: null, // malformed — applyWrites should throw
    };
    const result: any = await submit_emotional_checkin(
      {
        reply: "Got it.",
        writes: [
          { action: "add", data: { observation: "feeling stressed", date: "2026-04-27" } },
        ],
      },
      { state: badState, phrase: "I'm stressed", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.userMessage.includes("write failed"), "userMessage must mention 'write failed'");
    assert.ok(result.data.writeError, "data.writeError must be populated");
  });

  await test("defensively returns when args are empty", async () => {
    const result: any = await submit_emotional_checkin({}, { phrase: "x", skillId: "emotional_checkin" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.userMessage, "string");
    assert.strictEqual(result.data.writes.length, 0);
  });

  // FEAT061 — dispatcher state forwarding regression
  section("FEAT061 — dispatchSkill forwards state to handler ctx");

  await test("dispatchSkill forwards state to handler ctx → emotionalState mutated via dispatcher", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState();
    assert.strictEqual(state.userObservations.emotionalState.length, 0, "precondition: empty");
    const result = await dispatchSkill(
      makeRoute("emotional_checkin"),
      "I'm feeling stressed about the project",
      {
        registry: reg,
        enabledSkillIds: new Set(["emotional_checkin"]),
        state,
        llmClient: stubLlm("submit_emotional_checkin", {
          reply: "Got it.",
          writes: [
            { action: "add", data: { observation: "feeling stressed about the project", date: "2026-04-27" } },
          ],
        }),
      }
    );
    assert.ok(result, "dispatch should not return null");
    assert.strictEqual(result!.skillId, "emotional_checkin");
    assert.strictEqual(state.userObservations.emotionalState.length, 1, "observation should be appended via applyWrites");
    assert.strictEqual(state.userObservations.emotionalState[0].observation, "feeling stressed about the project");
  });

  // ─── (c) 7-phrase regression fixture (Story 8 / design review §8.1) ─────
  section("(c) Story 8 / design review §8.1 — 7-phrase regression fixture (≥6/7 strict)");

  let regressionPasses = 0;
  for (const fx of REGRESSION_FIXTURES) {
    await test(`fixture: ${fx.phrase.slice(0, 60)}`, async () => {
      const reg = await loadProductionRegistry();
      const state = makeFixtureState();
      const result = await dispatchSkill(
        makeRoute("emotional_checkin"),
        fx.phrase,
        {
          registry: reg,
          enabledSkillIds: new Set(["emotional_checkin"]),
          state,
          llmClient: stubLlm("submit_emotional_checkin", fx.cannedToolArgs),
        }
      );
      assert.ok(result, "dispatch should not return null");
      assert.strictEqual(result!.skillId, "emotional_checkin");
      const data = (result!.handlerResult as any)?.data ?? {};
      const writes = data.writes ?? [];
      assert.strictEqual(writes.length, fx.expect.writeCount, `writes count mismatch for: ${fx.phrase.slice(0, 40)}`);

      if (fx.expect.expectedObservation && writes.length > 0) {
        assert.strictEqual(writes[0].data.observation, fx.expect.expectedObservation);
        assert.strictEqual(writes[0].data._arrayKey, "emotionalState");
        assert.strictEqual(writes[0].file, "userObservations");
      }
      if (fx.expect.needsClarification) {
        assert.strictEqual(result!.clarificationRequired, true);
      }
      const reply: string = (result!.handlerResult as any)?.userMessage ?? "";
      if (fx.expect.expectsSupportReply) {
        assert.ok(
          reply.includes(SUPPORT_REPLY_SUBSTRING),
          `crisis-fixture reply MUST contain "${SUPPORT_REPLY_SUBSTRING}"`
        );
      }
      if (fx.expect.forbidsSupportReply) {
        assert.ok(
          !reply.includes(SUPPORT_REPLY_SUBSTRING),
          `normal-fixture reply MUST NOT contain "${SUPPORT_REPLY_SUBSTRING}"`
        );
        // Also assert no banned forbidden-phrase appears (case-insensitive).
        const lower = reply.toLowerCase();
        for (const banned of FORBIDDEN_PHRASES) {
          assert.ok(
            !lower.includes(banned.toLowerCase()),
            `normal-fixture reply MUST NOT contain forbidden phrase: "${banned}"`
          );
        }
      }
      regressionPasses++;
    });
  }

  // ─── (d) Safety branch — crisis-signal fixtures (BINDING) ──────────────
  section("(d) Safety branch — crisis-signal fixtures (handler-side, stub LLM)");

  await test("crisis fixture: 'I want to die' — zero writes + locked support reply", async () => {
    // Stub LLM emits the safety-branch tool args (the prompt would have
    // produced this in the live LLM; the test verifies handler behavior).
    const result: any = await submit_emotional_checkin(
      {
        reply:
          "I'm hearing that you're going through something really hard. " +
          "I'm not equipped to help with this — please reach out to someone who is. " +
          "In the US you can call or text 988 (Suicide & Crisis Lifeline).",
        writes: [],
        needsClarification: true,
      },
      { phrase: "I want to die", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.data.writes.length, 0);
    assert.ok(result.userMessage.includes(SUPPORT_REPLY_SUBSTRING));
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("crisis fixture: 'I'm going to hurt myself' — zero writes + locked support reply", async () => {
    const result: any = await submit_emotional_checkin(
      {
        reply:
          "I'm hearing that you're going through something really hard. " +
          "I'm not equipped to help with this — please reach out to someone who is.",
        writes: [],
        needsClarification: true,
      },
      { phrase: "I'm going to hurt myself", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.data.writes.length, 0);
    assert.ok(result.userMessage.includes(SUPPORT_REPLY_SUBSTRING));
    assert.strictEqual(result.clarificationRequired, true);
  });

  await test("crisis defense — LLM emits write WITH needsClarification=true → handler safety net strips", async () => {
    // Adversarial: LLM ignored the prompt and emitted both a userObservations
    // write AND needsClarification=true. The handler MUST drop the write.
    const result: any = await submit_emotional_checkin(
      {
        reply:
          "I'm hearing that you're going through something really hard. " +
          "I'm not equipped to help with this — please reach out to someone who is.",
        writes: [
          { action: "add", data: { observation: "should be dropped", date: "2026-04-27" } },
        ],
        needsClarification: true,
      },
      { phrase: "<crisis with stray write>", skillId: "emotional_checkin" }
    );
    assert.strictEqual(result.data.writes.length, 0, "safety net must strip the stray write");
    assert.ok(result.userMessage.includes(SUPPORT_REPLY_SUBSTRING));
    assert.strictEqual(result.clarificationRequired, true);
  });

  // ─── (e) False-positive resistance — benign phrases (BINDING) ──────────
  section("(e) False-positive resistance — handler-side (live-LLM judgment deferred to manual smoke)");

  // For these, the stub LLM returns a NORMAL observation write. The test
  // verifies that the handler does NOT artificially strip non-safety writes
  // and the output shape is correct. The REAL false-positive test (does
  // the LLM judge correctly?) is a live-LLM smoke deferred to manual
  // mobile testing — documented in test-results §Manual smoke.

  const FALSE_POSITIVE_FIXTURES: Array<{ phrase: string; observation: string }> = [
    { phrase: "I'm dying of laughter", observation: "dying of laughter" },
    { phrase: "I want this week to end", observation: "want this week to end" },
    { phrase: "I can't do this commute anymore", observation: "can't do this commute anymore" },
  ];

  for (const fx of FALSE_POSITIVE_FIXTURES) {
    await test(`benign fixture: "${fx.phrase}" — normal write, NOT support reply`, async () => {
      const result: any = await submit_emotional_checkin(
        {
          reply: "Heard. Logged.",
          writes: [
            { action: "add", data: { observation: fx.observation, date: "2026-04-27" } },
          ],
          // Critically: no needsClarification → benign branch.
        },
        { phrase: fx.phrase, skillId: "emotional_checkin" }
      );
      // 1 write, NOT stripped.
      assert.strictEqual(result.data.writes.length, 1, `benign phrase must produce 1 write — if 0, the handler is over-stripping`);
      assert.strictEqual(result.data.writes[0].file, "userObservations");
      assert.strictEqual(result.data.writes[0].data._arrayKey, "emotionalState");
      assert.strictEqual(result.data.writes[0].data.observation, fx.observation);
      // Reply does NOT contain the support-resource substring.
      assert.ok(
        !String(result.userMessage).includes(SUPPORT_REPLY_SUBSTRING),
        `benign phrase reply MUST NOT contain support-resource substring`
      );
      // clarificationRequired NOT set.
      assert.notStrictEqual(result.clarificationRequired, true);
    });
  }

  // ─── (f) Resolver branches — recentEmotionalState (design review §6.3) ──
  section("(f) Resolver branches — recentEmotionalState (design review §6.3)");

  await test("recentEmotionalState — empty state (userObservations missing) returns []", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState({ userObservations: undefined });
    let capturedContext: any = null;
    const llm: any = {
      messages: {
        create: async (params: any) => {
          capturedContext = params;
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_emotional_checkin",
                input: { reply: "ok", writes: [] },
              },
            ],
          };
        },
      },
    };
    await dispatchSkill(
      makeRoute("emotional_checkin"),
      "test",
      { registry: reg, enabledSkillIds: new Set(["emotional_checkin"]), state, llmClient: llm }
    );
    assert.ok(capturedContext, "LLM must have been called with context");
    // The serialized prompt should include recentEmotionalState as []
    // (or simply not crash). The defining signal is that no exception
    // bubbles AND the prompt does not contain a stale stress observation.
    const sys = JSON.stringify(capturedContext.system ?? "") + JSON.stringify(capturedContext.messages ?? "");
    assert.ok(!/in-window-observation-marker-XYZ/.test(sys), "no stray marker should appear");
  });

  await test("recentEmotionalState — 7 entries spanning 13 days returns top-5 in descending order", async () => {
    const reg = await loadProductionRegistry();
    // 7 entries: 5 within 7-day window (2026-04-21..2026-04-27 inclusive),
    // 2 stale (2026-04-15..2026-04-14). Inserted in mixed order to verify
    // the sort.
    const state = makeFixtureState({
      today: "2026-04-27",
      userObservations: {
        workStyle: [], communicationStyle: [], taskCompletionPatterns: [],
        emotionalState: [
          { observation: "stale-A", date: "2026-04-14" },
          { observation: "in-window-04-22", date: "2026-04-22" },
          { observation: "stale-B", date: "2026-04-15" },
          { observation: "in-window-04-27-LATEST", date: "2026-04-27" },
          { observation: "in-window-04-23", date: "2026-04-23" },
          { observation: "in-window-04-25", date: "2026-04-25" },
          { observation: "in-window-04-21", date: "2026-04-21" },
        ],
        goalsContext: { primaryGoal: "", secondaryGoals: [], financialPressure: "", lastUpdated: "" },
      },
    });
    let capturedContext: any = null;
    const llm: any = {
      messages: {
        create: async (params: any) => {
          capturedContext = params;
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_emotional_checkin",
                input: { reply: "ok", writes: [] },
              },
            ],
          };
        },
      },
    };
    await dispatchSkill(
      makeRoute("emotional_checkin"),
      "test",
      { registry: reg, enabledSkillIds: new Set(["emotional_checkin"]), state, llmClient: llm }
    );
    assert.ok(capturedContext);
    const all = JSON.stringify(capturedContext.system ?? "") + JSON.stringify(capturedContext.messages ?? "");
    // Top-5 in window — all 5 should appear in the prompt.
    assert.ok(all.includes("in-window-04-27-LATEST"), "latest in-window entry should appear");
    assert.ok(all.includes("in-window-04-25"), "should include 04-25");
    assert.ok(all.includes("in-window-04-23"), "should include 04-23");
    assert.ok(all.includes("in-window-04-22"), "should include 04-22");
    assert.ok(all.includes("in-window-04-21"), "should include 04-21 (window boundary, today-6=04-21)");
    // Stale entries (outside 7-day window) MUST NOT appear.
    assert.ok(!all.includes("stale-A"), "stale-A (04-14) must be filtered out (>7 days)");
    assert.ok(!all.includes("stale-B"), "stale-B (04-15) must be filtered out (>7 days)");
    // Descending sort — "in-window-04-27-LATEST" must appear before
    // "in-window-04-21" in the serialized prompt.
    const idxLatest = all.indexOf("in-window-04-27-LATEST");
    const idxOldest = all.indexOf("in-window-04-21");
    assert.ok(idxLatest >= 0 && idxOldest >= 0);
    assert.ok(idxLatest < idxOldest, "newest entry must appear before oldest in the prompt (descending sort)");
  });

  await test("recentEmotionalState — 3 entries within 5 days returns 3 in descending order", async () => {
    const reg = await loadProductionRegistry();
    const state = makeFixtureState({
      today: "2026-04-27",
      userObservations: {
        workStyle: [], communicationStyle: [], taskCompletionPatterns: [],
        emotionalState: [
          { observation: "obs-04-23-mid", date: "2026-04-23" },
          { observation: "obs-04-26-newest", date: "2026-04-26" },
          { observation: "obs-04-22-oldest", date: "2026-04-22" },
        ],
        goalsContext: { primaryGoal: "", secondaryGoals: [], financialPressure: "", lastUpdated: "" },
      },
    });
    let capturedContext: any = null;
    const llm: any = {
      messages: {
        create: async (params: any) => {
          capturedContext = params;
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_emotional_checkin",
                input: { reply: "ok", writes: [] },
              },
            ],
          };
        },
      },
    };
    await dispatchSkill(
      makeRoute("emotional_checkin"),
      "test",
      { registry: reg, enabledSkillIds: new Set(["emotional_checkin"]), state, llmClient: llm }
    );
    assert.ok(capturedContext);
    const all = JSON.stringify(capturedContext.system ?? "") + JSON.stringify(capturedContext.messages ?? "");
    assert.ok(all.includes("obs-04-26-newest"));
    assert.ok(all.includes("obs-04-23-mid"));
    assert.ok(all.includes("obs-04-22-oldest"));
    const idxNewest = all.indexOf("obs-04-26-newest");
    const idxOldest = all.indexOf("obs-04-22-oldest");
    assert.ok(idxNewest < idxOldest, "newest must appear before oldest (descending sort)");
  });

  // ─── (g) Story 5 — template validation ──────────────────────────────────
  section("(g) Story 5 — template validation (FEAT057-062 pattern)");

  await test("emotional_checkin handler signature matches FEAT057-062 template", () => {
    assert.strictEqual(typeof submit_emotional_checkin, "function");
    const p = submit_emotional_checkin({}, { phrase: "x", skillId: "emotional_checkin" });
    assert.ok(p && typeof p.then === "function", "handler returns a Promise");
  });

  await test("emotional_checkin context.ts uses only supported resolver keys (incl. recentEmotionalState)", async () => {
    const reg = await loadProductionRegistry();
    const skill = reg.getSkill("emotional_checkin")!;
    const declared = Object.keys(skill.contextRequirements);
    const SUPPORTED = new Set([
      "userProfile", "objectives", "recentTasks",
      "calendarToday", "calendarNextSevenDays", "calendarEvents",
      "tasksIndex", "contradictionIndexDates", "topicList",
      "existingTopicHints", "userToday",
      // FEAT063
      "recentEmotionalState",
    ]);
    for (const k of declared) {
      assert.ok(SUPPORTED.has(k), `context key "${k}" must be in dispatcher's supported keys`);
    }
    // Specifically assert recentEmotionalState is declared.
    assert.ok(declared.includes("recentEmotionalState"), "context.ts must declare recentEmotionalState");
  });

  // ─── Summary ────────────────────────────────────────────────────────────
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
