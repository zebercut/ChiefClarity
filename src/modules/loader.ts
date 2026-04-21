import { readJsonFile } from "../utils/filesystem";
import { isEncryptionConfigured, hasKey } from "../utils/crypto";
import { isWeb } from "../utils/platform";
import { setDefaultTimezone } from "../utils/dates";
import type { AppState, FileKey } from "../types";
import { recoverStaleProcessing } from "./notesStore";

// ── libSQL mode detection ──────────────────────────────────────────────
let _libsqlMode = false;
let _loadStateFromDbFn: (() => Promise<AppState>) | null = null;
let _flushToDbFn: ((state: AppState) => Promise<void>) | null = null;

/** Mark that the app is running in libSQL mode (DB is open). */
export function setLibsqlMode(enabled: boolean): void {
  _libsqlMode = enabled;
}

/** Check if the app is in libSQL mode. */
export function isLibsqlMode(): boolean {
  return _libsqlMode;
}

/**
 * Inject the DB functions from Node-only code (proxy/headless).
 * This avoids Metro bundling src/db/ into the web bundle.
 */
export function injectDbFunctions(fns: {
  loadStateFromDb: () => Promise<AppState>;
  flushToDb: (state: AppState) => Promise<void>;
}): void {
  _loadStateFromDbFn = fns.loadStateFromDb;
  _flushToDbFn = fns.flushToDb;
}

/** Get the injected flushToDb function (used by executor). */
export function getFlushToDbFn(): ((state: AppState) => Promise<void>) | null {
  return _flushToDbFn;
}

/**
 * Collection-shaped files: state slices that contain a primary array. The
 * loader records the loaded length so flush() can refuse a write that would
 * dramatically shrink the collection (the wipe-protection guard).
 */
const COLLECTION_PATHS: Partial<Record<FileKey, (slice: any) => number>> = {
  tasks:           (s) => Array.isArray(s?.tasks) ? s.tasks.length : 0,
  calendar:        (s) => Array.isArray(s?.events) ? s.events.length : 0,
  notes:           (s) => Array.isArray(s?.notes) ? s.notes.length : 0,
  learningLog:     (s) => Array.isArray(s?.items) ? s.items.length : 0,
  recurringTasks:  (s) => Array.isArray(s?.recurring) ? s.recurring.length : 0,
  suggestionsLog:  (s) => Array.isArray(s?.suggestions) ? s.suggestions.length : 0,
  contextMemory:   (s) => Array.isArray(s?.facts) ? s.facts.length : 0,
  planOkrDashboard:(s) => Array.isArray(s?.objectives) ? s.objectives.length : 0,
};

/** Public helper used by executor.flush() — returns the count or undefined */
export function collectionCountOf(key: FileKey, slice: unknown): number | undefined {
  const fn = COLLECTION_PATHS[key];
  return fn ? fn(slice) : undefined;
}

export const FILE_MAP: Record<FileKey, string> = {
  hotContext: "hot_context.json",
  summaries: "summaries.json",
  tasks: "tasks.json",
  calendar: "calendar.json",
  contextMemory: "context_memory.json",
  feedbackMemory: "feedback_memory.json",
  contentIndex: "content_index.json",
  contradictionIndex: "contradiction_index.json",
  suggestionsLog: "suggestions_log.json",
  learningLog: "learning_log.json",
  userProfile: "user_profile.json",
  userLifestyle: "user_lifestyle.json",
  userObservations: "user_observations.json",
  planNarrative: "plan/plan_narrative.json",
  planAgenda: "plan/plan_agenda.json",
  planRisks: "plan/plan_risks.json",
  planOkrDashboard: "plan/plan_okr_dashboard.json",
  focusBrief: "focus_brief.json",
  recurringTasks: "recurring_tasks.json",
  topicManifest: "topics/_manifest.json",
  notes: "notes.json",
};

const DEFAULTS: Omit<AppState, "_dirty" | "_pendingContext" | "_loadedCounts"> = {
  hotContext: {
    generatedAt: "",
    today: "",
    weekday: "",
    userName: "",
    timezone: "",
    top3ActiveTasks: [],
    nextCalendarEvent: null,
    okrSnapshot: "",
    openTaskCount: 0,
    overdueCount: 0,
    lastSuggestionShown: "",
  },
  summaries: {
    tasks: "",
    calendar: "",
    okr: "",
    contextMemory: "",
    feedbackMemory: "",
    suggestionsLog: "",
    learningLog: "",
  },
  tasks: { _summary: "", tasks: [] },
  calendar: { _summary: "", events: [] },
  contextMemory: { patterns: [], facts: [], recentEvents: [] },
  feedbackMemory: {
    preferences: {
      reminderFormat: "task",
      responseLength: "short",
      deepWorkDays: [],
      ignoredTopics: [],
      preferredTimeForReminders: "morning",
    },
    behavioralSignals: [],
    corrections: [],
    rules: [],
  },
  contentIndex: { schemaVersion: "1.0", updatedAt: "", entities: {} },
  contradictionIndex: { byDate: {}, byTopic: {}, byOkr: {} },
  suggestionsLog: { suggestions: [] },
  learningLog: { _summary: "", items: [] },
  userProfile: {
    name: "",
    timezone: "",
    location: "",
    language: "en",
    familyMembers: [],
  },
  userLifestyle: {
    sleepWake: { wake: "", sleep: "" },
    weekdaySchedule: [],
    weekendSchedule: { capacity: "", saturday: "", sunday: "", notes: "" },
    weekStartsOn: "sunday",
    availableWorkWindows: [],
    preferences: {},
  },
  userObservations: {
    workStyle: [],
    communicationStyle: [],
    taskCompletionPatterns: [],
    emotionalState: [],
    goalsContext: {
      primaryGoal: "",
      secondaryGoals: [],
      financialPressure: "",
      lastUpdated: "",
    },
  },
  planNarrative: { summary: "" },
  planAgenda: { agenda: [] },
  planRisks: { risks: [] },
  planOkrDashboard: { focusPeriod: { start: "", end: "" }, objectives: [] },
  focusBrief: {
    id: "",
    generatedAt: "",
    variant: "day",
    dateRange: { start: "", end: "" },
    executiveSummary: "",
    routineTemplate: [],
    days: [],
    priorities: [],
    risks: [],
    okrSnapshot: [],
    companion: {
      energyRead: "medium",
      mood: "",
      motivationNote: "",
      patternsToWatch: [],
      copingSuggestion: "",
      wins: [],
      focusMantra: "",
    },
    annotations: [],
  },
  recurringTasks: { recurring: [] },
  topicManifest: { topics: [], pendingSuggestions: [], rejectedTopics: [], signals: [] },
  notes: { _summary: "", notes: [] },
};

/**
 * Load all data files into a fresh AppState.
 *
 * Post-incident contract (Bug 1 + Bug 6):
 *   - If encryption is configured, the key MUST already be cached. We assert
 *     loudly instead of silently falling through to the plaintext branch and
 *     reading encrypted bytes as garbage.
 *   - For each file, distinguish three outcomes:
 *       null   → file does not exist     → use the default (first-run state)
 *       data   → file loaded successfully → use the data, record collection counts
 *       throw  → file exists but failed   → ABORT, throw to caller
 *   - Never silently substitute defaults for a file that exists but failed
 *     to read. That was the wipe pipeline that destroyed tasks.json.
 */
export async function loadState(): Promise<AppState> {
  // ── libSQL mode: load from database instead of JSON files ──────────
  // Guard: only runs on Node (proxy/headless). On web, the proxy serves
  // DB data through the /files endpoints, so the browser stays in JSON mode.
  if (_libsqlMode && !isWeb()) {
    // _loadStateFromDbFn is injected by the proxy/headless at startup
    // to avoid Metro bundling src/db/ into the web bundle.
    if (!_loadStateFromDbFn) throw new Error("[loader] libSQL mode but no loadStateFromDb injected");
    const { loadStateFromDb } = { loadStateFromDb: _loadStateFromDbFn };
    const state: AppState = await loadStateFromDb();
    // Run the same post-load normalizations as the JSON path
    if (state.contextMemory?.facts) {
      state.contextMemory.facts = state.contextMemory.facts.map((f: any) =>
        typeof f === "string" ? { text: f, topic: null, date: "" } : f
      );
    }
    if (state.topicManifest && !Array.isArray(state.topicManifest.signals)) {
      state.topicManifest.signals = [];
    }
    if (state.notes?.notes) {
      const recovered = recoverStaleProcessing(state);
      if (recovered > 0) {
        console.log(`[loader] recovered ${recovered} stale processing note(s) → pending`);
      }
    }
    if (state.userProfile?.timezone) setDefaultTimezone(state.userProfile.timezone);
    return state;
  }

  // ── JSON mode (legacy) ─────────────────────────────────────────────
  // Bug 6: hard assertion. If we got here without a cached key but
  // encryption is configured, every encrypted read will throw and we'd
  // end up with all-defaults state. Stop now with a clear message.
  //
  // EXCEPT on Web: in web mode the browser is just a thin client and the
  // api-proxy holds the key + does the actual decryption. The browser
  // never needs a cached key on web — it sends/receives plaintext from
  // the proxy. Only assert on platforms where this process does the work.
  if (!isWeb() && isEncryptionConfigured() && !hasKey()) {
    throw new Error(
      "[loader] loadState() called before encryption key was unlocked. " +
      "The caller must derive + cacheKey() the encryption key first."
    );
  }

  const state: AppState = {
    ...(structuredClone(DEFAULTS) as any),
    _dirty: new Set<FileKey>(),
    _pendingContext: null,
    _loadedCounts: {},
  };

  const entries = Object.entries(FILE_MAP) as [FileKey, string][];

  // Load files SEQUENTIALLY rather than in parallel.
  //
  // Why sequential:
  //   - On Web mode, every read goes through the api-proxy, which has a
  //     rate limit on /files. 21 parallel requests + multiple tabs +
  //     periodic reloads can burst over the limit and produce 429s.
  //     fetchWithRetry handles transient 429s, but the cleanest fix is
  //     to never burst in the first place.
  //   - 21 files × ~5ms each = ~100ms total. Imperceptible to the user.
  //   - Aggregating errors still works: we collect failures and report
  //     them all at once, just one read at a time instead of in parallel.
  const failures: { key: FileKey; path: string; error: Error }[] = [];
  for (const [key, path] of entries) {
    try {
      const data = await readJsonFile(path);
      if (data !== null) {
        (state as any)[key] = data;
        const count = collectionCountOf(key, data);
        if (typeof count === "number") {
          state._loadedCounts[key] = count;
        }
      }
      // null means the file doesn't exist on disk → keep the default,
      // which is a legitimate first-run state. Don't record a count.
    } catch (err) {
      failures.push({ key, path, error: err as Error });
    }
  }

  if (failures.length > 0) {
    // Build a single aggregated error so the loader caller (UI / headless
    // runner) gets the complete picture. Prior behavior would have silently
    // used defaults for failed slices and then flushed the empty defaults
    // back to disk on the next write — destroying user data.
    const summary = failures
      .map((f) => `  • ${f.path} (${f.error?.name || "Error"}): ${f.error?.message || f.error}`)
      .join("\n");
    const err = new Error(
      `[loader] aborted: ${failures.length} sensitive file(s) failed to load.\n` +
      `These files exist on disk but could not be read or decrypted. ` +
      `Refusing to continue with empty defaults — that would overwrite real data on the next save.\n` +
      summary
    );
    (err as any).failures = failures;
    throw err;
  }

  // Normalize legacy string facts to structured Fact format
  if (state.contextMemory?.facts) {
    state.contextMemory.facts = state.contextMemory.facts.map((f: any) =>
      typeof f === "string" ? { text: f, topic: null, date: "" } : f
    );
  }

  // Ensure topicManifest has signals array (may be missing from older data)
  if (state.topicManifest && !Array.isArray(state.topicManifest.signals)) {
    state.topicManifest.signals = [];
  }

  // Recover stale "processing" notes from an unclean shutdown.
  // See notesStore.recoverStaleProcessing for the rationale (no attemptCount bump).
  if (state.notes?.notes) {
    const recovered = recoverStaleProcessing(state);
    if (recovered > 0) {
      console.log(`[loader] recovered ${recovered} stale processing note(s) → pending`);
    }
  }

  if (state.userProfile?.timezone) setDefaultTimezone(state.userProfile.timezone);
  return state;
}
