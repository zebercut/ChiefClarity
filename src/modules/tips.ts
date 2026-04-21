import { readJsonFile, writeJsonFile } from "../utils/filesystem";
import { isLibsqlMode } from "./loader";

// Dynamic require hidden from Metro's static resolver
// eslint-disable-next-line no-eval
const lazyRequire = (path: string) => eval("require")(path);
import type { AppState, IntentType } from "../types";

/**
 * Tips System — drip-feeds feature education to the user.
 *
 * Rules:
 * - Max 1 tip per session (app open)
 * - Never during emotional conversations
 * - Only when contextually relevant
 * - Never repeat a shown tip
 * - Tracks feature usage to skip tips for features already used
 */

const TIPS_FILE = "tips_state.json";

// ─── Types ────────────────────────────────────────────────────────────────

interface TipDef {
  id: string;
  trigger: TipTrigger;
  contextHint: string; // passed to LLM — it decides how to phrase it
  minSessions?: number; // don't show before N sessions (let user settle in)
}

type TipTrigger =
  | { type: "intent"; intent: IntentType }         // user just used this intent
  | { type: "usage_count"; feature: string; below: number } // feature used less than N times
  | { type: "session_count"; min: number }          // after N sessions
  | { type: "repeated_action"; action: string; threshold: number }; // same action N times

interface TipsState {
  shown: Record<string, string>;       // tipId -> date shown
  usage: Record<string, number>;       // feature -> count
  sessionCount: number;
  tipsDisabled: boolean;
  tipShownThisSession: boolean;        // reset on app load
}

const DEFAULT_STATE: TipsState = {
  shown: {},
  usage: {},
  sessionCount: 0,
  tipsDisabled: false,
  tipShownThisSession: false,
};

// ─── Tip Library ──────────────────────────────────────────────────────────

const TIP_LIBRARY: TipDef[] = [
  {
    id: "inbox_tip",
    trigger: { type: "intent", intent: "task_create" },
    contextHint: "The user created a task via chat but has never used inbox.txt. Mention briefly that they can drop notes into inbox.txt from any device and the system processes them automatically.",
    minSessions: 2,
  },
  {
    id: "focus_actions_tip",
    trigger: { type: "repeated_action", action: "chat_mark_done", threshold: 3 },
    contextHint: "The user has been marking tasks done via chat messages. Mention that in the Focus tab, they can tap the action menu on any card to mark done, reschedule, or drop tasks instantly — no typing needed.",
  },
  {
    id: "recurring_tip",
    trigger: { type: "repeated_action", action: "task_create", threshold: 5 },
    contextHint: "The user creates tasks frequently. Mention that they can set up recurring tasks — for example, 'remind me to submit a job application every weekday at 8:30am' — and the system creates them automatically each day.",
    minSessions: 3,
  },
  {
    id: "week_plan_tip",
    trigger: { type: "usage_count", feature: "week_plan", below: 1 },
    contextHint: "The user has never asked for a weekly plan. Suggest trying 'plan my week' for a full 7-day overview with priorities, risks, and calendar.",
    minSessions: 3,
  },
  {
    id: "schedule_tip",
    trigger: { type: "intent", intent: "full_planning" },
    contextHint: "The user just asked for planning. Mention that the system generates daily plans automatically each morning, and they can change the time by saying something like 'change my wake time to 7am'.",
    minSessions: 2,
  },
  {
    id: "annotation_tip",
    trigger: { type: "usage_count", feature: "focus_viewed", below: 1 },
    contextHint: "The user hasn't used the Focus tab much. Mention that they can add comments and quick actions on any card in the Focus tab — tap the three-dot menu to mark done, reschedule, or leave a note.",
    minSessions: 4,
  },
  {
    id: "companion_tip",
    trigger: { type: "intent", intent: "emotional_checkin" },
    contextHint: "The user shared something emotional. After responding with empathy, mention that the Focus Brief includes a companion section with energy reads, wins, and a focus mantra — designed to keep them grounded.",
    minSessions: 3,
  },
  {
    id: "theme_tip",
    trigger: { type: "session_count", min: 5 },
    contextHint: "Mention that there is a light/dark theme toggle in the chat header (the sun/moon icon).",
  },
  {
    id: "history_tip",
    trigger: { type: "session_count", min: 2 },
    contextHint: "Mention that pressing the up arrow key in the input box cycles through previous messages — like a terminal history.",
  },
];

// ─── Core Functions ───────────────────────────────────────────────────────

async function loadTipsState(): Promise<TipsState> {
  if (isLibsqlMode()) {
    const { loadKvGeneric } = lazyRequire("../db/queries/kv");
    const data = await loadKvGeneric("tips_state");
    return { ...DEFAULT_STATE, ...data };
  }
  const data = await readJsonFile<TipsState>(TIPS_FILE);
  return { ...DEFAULT_STATE, ...data };
}

async function saveTipsState(ts: TipsState): Promise<void> {
  if (isLibsqlMode()) {
    const { saveKvGeneric } = lazyRequire("../db/queries/kv");
    await saveKvGeneric("tips_state", ts as unknown as Record<string, unknown>);
    return;
  }
  await writeJsonFile(TIPS_FILE, ts);
}

let _sessionStarted = false; // in-memory guard against double mount (Strict Mode / Fast Refresh)

/**
 * Call on app startup to increment session count and reset per-session flag.
 * Guarded against double-calls from React Strict Mode.
 */
export async function startTipSession(): Promise<void> {
  if (_sessionStarted) return;
  _sessionStarted = true;
  const ts = await loadTipsState();
  ts.sessionCount++;
  ts.tipShownThisSession = false;
  await saveTipsState(ts);
}

/**
 * Track feature usage. Call whenever the user engages with a feature.
 */
export async function trackFeatureUsage(feature: string): Promise<void> {
  const ts = await loadTipsState();
  ts.usage[feature] = (ts.usage[feature] || 0) + 1;
  await saveTipsState(ts);
}

/**
 * Track multiple features in a single load-save cycle. Prevents race conditions.
 */
export async function trackFeaturesUsage(features: string[]): Promise<void> {
  if (features.length === 0) return;
  const ts = await loadTipsState();
  for (const f of features) {
    ts.usage[f] = (ts.usage[f] || 0) + 1;
  }
  await saveTipsState(ts);
}

/**
 * Disable all tips permanently.
 */
export async function disableTips(): Promise<void> {
  const ts = await loadTipsState();
  ts.tipsDisabled = true;
  await saveTipsState(ts);
}

/**
 * Pick a contextually relevant tip for the current interaction.
 * Returns the tip context hint for the LLM, or null if no tip should be shown.
 *
 * @param intentType - the classified intent of the current message
 * @param hasNegativeEmotion - true if the user is stressed/frustrated/venting
 */
export async function pickTip(
  intentType: IntentType,
  hasNegativeEmotion: boolean,
  today?: string
): Promise<string | null> {
  const ts = await loadTipsState();

  // Disabled or already shown this session
  if (ts.tipsDisabled || ts.tipShownThisSession) return null;

  // Never during emotional conversations (detected emotions OR emotional_checkin intent)
  if (hasNegativeEmotion || intentType === "emotional_checkin") return null;

  for (const tip of TIP_LIBRARY) {
    // Already shown
    if (ts.shown[tip.id]) continue;

    // Min sessions check
    if (tip.minSessions && ts.sessionCount < tip.minSessions) continue;

    // Check trigger
    if (!matchesTrigger(tip.trigger, intentType, ts)) continue;

    // This tip is eligible — mark as shown
    ts.shown[tip.id] = today || new Date().toLocaleDateString("en-CA");
    ts.tipShownThisSession = true;
    await saveTipsState(ts);

    return tip.contextHint;
  }

  return null;
}

function matchesTrigger(trigger: TipTrigger, intentType: IntentType, ts: TipsState): boolean {
  switch (trigger.type) {
    case "intent":
      return intentType === trigger.intent;

    case "usage_count":
      return (ts.usage[trigger.feature] || 0) < trigger.below;

    case "session_count":
      return ts.sessionCount >= trigger.min;

    case "repeated_action":
      return (ts.usage[trigger.action] || 0) >= trigger.threshold;

    default:
      return false;
  }
}
