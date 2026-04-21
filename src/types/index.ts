// ─── State ───────────────────────────────────────────────────────────────────

export interface AppState {
  hotContext: HotContext;
  summaries: Summaries;
  tasks: TasksFile;
  calendar: CalendarFile;
  contextMemory: ContextMemory;
  feedbackMemory: FeedbackMemory;
  contentIndex: ContentIndex;
  contradictionIndex: ContradictionIndex;
  suggestionsLog: SuggestionsLog;
  learningLog: LearningLog;
  userProfile: UserProfile;
  userLifestyle: UserLifestyle;
  userObservations: UserObservations;
  planNarrative: PlanNarrative;
  planAgenda: PlanAgenda;
  planRisks: PlanRisks;
  planOkrDashboard: PlanOkrDashboard;
  focusBrief: FocusBrief;
  recurringTasks: RecurringTasksFile;
  topicManifest: TopicManifest;
  notes: NotesFile;
  _dirty: Set<FileKey>;
  _pendingContext: IntentResult | null;
  /**
   * Wipe-protection: collection sizes recorded at load time. Populated by
   * loader.ts for collection-shaped files (tasks, calendar, notes, etc.).
   * The flush() guard refuses to write a collection that has shrunk
   * dramatically vs. its loaded baseline. See Bug #3 in the post-mortem
   * for the wipe pipeline this prevents.
   */
  _loadedCounts: Partial<Record<FileKey, number>>;
}

export type FileKey =
  | "hotContext"
  | "summaries"
  | "tasks"
  | "calendar"
  | "contextMemory"
  | "feedbackMemory"
  | "contentIndex"
  | "contradictionIndex"
  | "suggestionsLog"
  | "learningLog"
  | "userProfile"
  | "userLifestyle"
  | "userObservations"
  | "planNarrative"
  | "planAgenda"
  | "planRisks"
  | "planOkrDashboard"
  | "focusBrief"
  | "recurringTasks"
  | "topicManifest"
  | "notes";

// ─── Intent ──────────────────────────────────────────────────────────────────

export type IntentType =
  | "task_create"
  | "task_update"
  | "task_query"
  | "calendar_create"
  | "calendar_update"
  | "calendar_query"
  | "okr_update"
  | "full_planning"
  | "info_lookup"
  | "learning"
  | "emotional_checkin"
  | "feedback"
  | "suggestion_request"
  | "general"
  | "bulk_input"
  | "topic_query"
  | "topic_note";

export interface IntentResult {
  type: IntentType;
  tokenBudget: number;
  phrase: string;
  followupPhrase?: string;
}

// ─── Action Plan (LLM output) ───────────────────────────────────────────────

export interface ActionItem {
  id: string;
  type: "task" | "event" | "okr" | "suggestion" | "topic";
  group?: string;
  commentary?: string;
  suggestedAction?: "mark_done" | "delete" | "reschedule_tomorrow" | "reschedule_next_week" | "cancel";
  // Snapshot fields — populated by TypeScript at render time for history persistence
  _title?: string;
  _due?: string;
  _priority?: string;
  _status?: string;
  _category?: string;
}

export interface ActionPlan {
  reply: string;
  writes: WriteOperation[];
  items: ActionItem[];
  conflictsToCheck: string[];
  suggestions: string[];
  memorySignals: MemorySignal[];
  topicSignals: string[];
  needsClarification: boolean;
}

export interface WriteOperation {
  file: FileKey;
  action: "add" | "update" | "delete";
  id?: string;
  data: Record<string, unknown>;
  /**
   * Optional source-note attribution. When the LLM is processing a bulk_input
   * payload that contains `[note <id>]` markers (notes batch path), it tags
   * each write with the id of the source note so TypeScript can build
   * per-note summaries without re-prompting. Ignored by the executor.
   */
  sourceNoteId?: string;
}

export interface MemorySignal {
  signal: string;
  value: string;
}

// ─── Data File Shapes ───────────────────────────────────────────────────────

export interface HotContext {
  generatedAt: string;
  today: string;
  weekday: string;
  userName: string;
  timezone: string;
  top3ActiveTasks: TaskIndex[];
  nextCalendarEvent: { title: string; datetime: string } | null;
  okrSnapshot: string;
  openTaskCount: number;
  overdueCount: number;
  lastSuggestionShown: string;
}

export interface Summaries {
  tasks: string;
  calendar: string;
  okr: string;
  contextMemory: string;
  feedbackMemory: string;
  suggestionsLog: string;
  learningLog: string;
  topics?: string;
}

export interface TaskComment {
  id: string;
  text: string;
  date: string;       // ISO timestamp
}

export interface Task {
  id: string;
  title: string;
  due: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "done" | "overdue" | "deferred" | "parked";
  category: string;
  subcategory: string;
  okrLink: string | null;
  conflictStatus: "ok" | "flagged";
  conflictReason: string;
  conflictWith: string[];
  notes: string;
  createdAt: string;
  completedAt: string | null;
  dismissedAt: string | null;
  comments: TaskComment[];
  timeAllocated: string;
  relatedCalendar: string[];
  relatedInbox: string[];
}

/** Terminal statuses — task is finished (won't appear in active views). */
export function isTaskTerminal(status: Task["status"]): boolean {
  return status === "done" || status === "deferred";
}

/** Active statuses — task needs attention (appears in open/active counts). */
export function isTaskActive(status: Task["status"]): boolean {
  return !isTaskTerminal(status) && status !== "parked";
}

export interface TaskIndex {
  id: string;
  title: string;
  due: string;
  status: string;
  priority: string;
}

export interface TasksFile {
  _summary: string;
  tasks: Task[];
}

// ─── Notes (FEAT026) ────────────────────────────────────────────────────────

export type NoteStatus = "pending" | "processing" | "processed" | "failed";

export interface Note {
  id: string;
  text: string;
  createdAt: string;       // ISO timestamp
  status: NoteStatus;
  processedAt: string | null;
  writeCount: number;      // writes the LLM produced for this note
  /**
   * Human-readable summary of what was done with this note when it was
   * processed (e.g. "Created 1 task, Added 1 event."). Built deterministically
   * from the WriteOperation[] the LLM produced for this note. Null until
   * the note has been successfully processed.
   */
  processedSummary: string | null;
  attemptCount: number;
  lastError: string | null;
}

export interface NotesFile {
  _summary: string;
  notes: Note[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  datetime: string;
  durationMinutes: number;
  status: "scheduled" | "completed" | "cancelled";
  type: string;
  priority: string;
  notes: string;
  relatedInbox: string[];
  archived?: boolean;
  isRecurringInstance?: boolean;
  /** @deprecated Migration-only. Recurring patterns belong in RecurringTask, not here. */
  recurring?: boolean;
  /** @deprecated Migration-only. Use RecurringTask.schedule.type instead. */
  recurrence?: string;
  /** @deprecated Migration-only. Use RecurringTask.schedule.days instead. */
  recurrenceDay?: string;
  /** FEAT018: Integration source (e.g. 'google_calendar') or undefined for local */
  sourceIntegration?: string;
  /** FEAT018: External ID for dedup on re-sync */
  sourceId?: string;
}

export interface CalendarFile {
  _summary: string;
  events: CalendarEvent[];
}

export interface ContradictionIndex {
  byDate: Record<string, string[]>;
  byTopic: Record<string, string[]>;
  byOkr: Record<string, string[]>;
}

export interface Suggestion {
  id: string;
  text: string;
  shownAt: string;
  trigger: string;
  actionTaken: "acted_on" | "ignored" | "pending" | null;
  resolvedAt: string | null;
}

export interface SuggestionsLog {
  suggestions: Suggestion[];
}

export interface LearningItem {
  id: string;
  topic: string;
  source: string;
  status: "active" | "mastered" | "paused";
  createdAt: string;
  nextReview: string;
  reviewCount: number;
  masteryLevel: number;
  notes: string;
}

export interface LearningLog {
  _summary: string;
  items: LearningItem[];
}

export interface BehavioralRule {
  rule: string;
  source: "user" | "system";
  date: string;
}

export interface FeedbackMemory {
  preferences: {
    reminderFormat: string;
    responseLength: string;
    deepWorkDays: string[];
    ignoredTopics: string[];
    preferredTimeForReminders: string;
  };
  behavioralSignals: {
    signal: string;
    observed: number;
    lastSeen: string;
  }[];
  corrections: {
    original: string;
    correctedTo: string;
    date: string;
  }[];
  rules: BehavioralRule[];
}

export interface Fact {
  text: string;
  topic: string | null;
  date: string;
}

export interface ContextMemory {
  patterns: {
    pattern: string;
    evidence: string;
    firstSeen: string;
    lastSeen: string;
    confidence: number;
  }[];
  facts: (string | Fact)[];
  recentEvents: string[];
}

export interface TopicEntry {
  id: string;
  name: string;
  aliases: string[];
  createdAt: string;
  /** Task/event IDs explicitly excluded from this topic, even if name-matched or signaled.
   *  Set by the user via "Unassign from topic" / "Reassign" on the topic detail page. */
  excludedIds?: string[];
  /** ISO timestamp when the user archived this topic. Archived topics are hidden from
   *  the default Topics list, skipped by cross-reference, and omitted from the focus
   *  brief digest. Set to null/undefined when active. */
  archivedAt?: string | null;
}

export interface TopicSuggestion {
  topic: string;
  count: number;
  threshold: number;
  status: "accumulating" | "pending" | "deferred";
  suggestedAt?: string;
}

export interface TopicSignal {
  topic: string;
  sourceType: "fact" | "task" | "event" | "mention";
  sourceId: string;
  date: string;
}

export interface TopicManifest {
  topics: TopicEntry[];
  pendingSuggestions: TopicSuggestion[];
  rejectedTopics: string[];
  signals: TopicSignal[];
}

/** Pre-built cross-reference sent to LLM in full_planning context */
export interface TopicCrossRef {
  topic: string;       // slug
  name: string;        // display name
  taskIds: string[];   // IDs of active tasks linked to this topic
  eventIds: string[];  // IDs of calendar events linked to this topic
  okrLinks: string[];  // KR IDs linked via tasks
}

/** LLM output — topic grouping in the focus brief */
export interface TopicDigestItem {
  topic: string;        // slug
  name: string;         // display name
  items: string[];      // human-readable one-liners
  /** 2-3 sentence summary: what the topic tracks, what's been done, what's next.
   *  Rendered at the top of the topic detail page. */
  summary?: string;
  okrConnection?: string;
  newInsights?: string;
}

export interface ContentIndex {
  schemaVersion: string;
  updatedAt: string;
  entities: Record<
    string,
    { type: string; files: string[]; context: string }
  >;
}

export interface UserProfile {
  name: string;
  timezone: string;
  location: string;
  language: string;
  familyMembers: { abbreviation: string; name?: string; relation: string }[];
}

export interface UserLifestyle {
  sleepWake: { wake: string; sleep: string };
  weekdaySchedule: {
    time: string;
    activity: string;
    type: "fixed" | "flexible" | "preferred";
    days?: string[];
  }[];
  weekendSchedule: {
    capacity: string;
    saturday: string;
    sunday: string;
    notes: string;
  };
  weekStartsOn: string;
  availableWorkWindows: {
    label: string;
    time: string;
    notes: string;
  }[];
  preferences: Record<string, unknown>;
}

export interface UserObservations {
  workStyle: {
    observation: string;
    firstSeen: string;
    confidence?: number;
  }[];
  communicationStyle: {
    observation: string;
    firstSeen: string;
  }[];
  taskCompletionPatterns: {
    category: string;
    pattern: string;
    firstSeen: string;
  }[];
  emotionalState: {
    observation: string;
    date: string;
  }[];
  goalsContext: {
    primaryGoal: string;
    secondaryGoals: string[];
    financialPressure: string;
    lastUpdated: string;
  };
}

export interface PlanNarrative {
  summary: string;
}
export interface PlanAgenda {
  agenda: unknown[];
}
export interface PlanRisks {
  risks: unknown[];
}
export interface OkrKeyResult {
  id: string;
  title: string;
  metric: string;
  targetType: "numeric" | "percentage" | "milestone";
  targetValue: number;          // e.g. 500000, 80, 100
  targetUnit: string;           // e.g. "followers", "%", "plan"
  currentValue: number | null;  // latest raw measurement
  currentNote: string | null;   // qualitative context
  lastUpdated: string | null;   // ISO date when currentValue was last changed
  dueDate?: string;             // optional per-KR deadline
}

export interface OkrDecision {
  date: string;
  summary: string;
}

export interface OkrObjective {
  id: string;
  title: string;
  status: "active" | "parked" | "completed";
  activityProgress: number;  // CACHE — auto-computed from linked task completion
  outcomeProgress: number;   // CACHE — auto-computed from currentValue/targetValue
  keyResults: OkrKeyResult[];
  decisions: OkrDecision[];  // last 5 kept here, older pushed to contextMemory
}

export interface PlanOkrDashboard {
  focusPeriod: { start: string; end: string };
  objectives: OkrObjective[];
}

// ─── OKR Computation Helpers ──────────────────────────────────────────────

export function computeKrOutcome(kr: OkrKeyResult): number {
  if (kr.currentValue === null || kr.targetValue <= 0) return 0;
  return Math.min(Math.round((kr.currentValue / kr.targetValue) * 100), 100);
}

export function computeKrActivity(
  krId: string,
  taskStats: Record<string, { total: number; done: number }>
): number {
  const stats = taskStats[krId];
  return stats && stats.total > 0
    ? Math.round((stats.done / stats.total) * 100)
    : 0;
}

export function buildTaskStats(
  tasks: { okrLink: string | null; status: string }[]
): Record<string, { total: number; done: number }> {
  const stats: Record<string, { total: number; done: number }> = {};
  for (const t of tasks) {
    if (!t.okrLink) continue;
    if (!stats[t.okrLink]) stats[t.okrLink] = { total: 0, done: 0 };
    stats[t.okrLink].total++;
    if (t.status === "done") stats[t.okrLink].done++;
  }
  return stats;
}

// ─── Conversation ───────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SmartAction {
  text: string;
  type: "task_followup" | "question" | "advice" | "action" | "generic";
  taskId?: string;
  quickActions: { label: string; payload: string; isDirect?: boolean; targetId?: string }[];
}

export interface WriteSummary {
  file: string;
  action: string;
  title: string;
  id?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  smartActions?: SmartAction[];
  items?: ActionItem[];
  writeSummary?: WriteSummary[];
  isQuestion?: boolean;
  timestamp: string;
}

export interface ChatHistory {
  messages: ChatMessage[];
  lastUpdated: string;
}

// ─── Inbox ──────────────────────────────────────────────────────────────────

export interface InboxResult {
  reply: string;
  writeCount: number;
  processed: boolean;
}

// ─── Recurring Tasks ────────────────────────────────────────────────────────

export interface RecurringTask {
  id: string;
  title: string;
  schedule: RecurringSchedule;
  category: string;
  priority: "high" | "medium" | "low";
  okrLink: string | null;
  duration?: number;        // minutes, for calendar-style items
  notes?: string;
  active: boolean;
  createdAt: string;
}

export interface RecurringSchedule {
  type: "daily" | "weekly" | "weekdays" | "custom";
  days?: string[];          // e.g. ["monday", "wednesday", "friday"]
  time?: string;            // "HH:MM" — if set, also creates a calendar event
  excludeDates?: string[];  // YYYY-MM-DD dates to skip
}

export interface RecurringTasksFile {
  recurring: RecurringTask[];
}

// ─── Companion ──────────────────────────────────────────────────────────────

export interface CompanionOutput {
  emotions: string[];
  friction: string[];
  supportNote: string;
  energyEstimate: "low" | "medium" | "high";
}

// ─── Focus Brief ────────────────────────────────────────────────────────────

export type PlanVariant = "day" | "week" | "tomorrow";

// FEAT045: Change tracking for reactive brief updates
export type BriefChangeType =
  | "task_done" | "task_added" | "task_deleted"
  | "event_added" | "event_cancelled" | "event_moved"
  | "note_processed" | "okr_updated";

export interface BriefChange {
  type: BriefChangeType;
  itemId: string;
  itemTitle: string;
  timestamp: string;
  detail?: string;
}

export interface FocusBrief {
  id: string;
  generatedAt: string;
  variant: PlanVariant;
  dateRange: { start: string; end: string };
  executiveSummary: string;
  routineTemplate: AgendaEvent[];         // default weekday routine (sent once)
  weekendRoutineTemplate?: AgendaEvent[]; // optional weekend routine
  days: DaySlot[];                        // per-day exceptions + additions
  priorities: PriorityItem[];
  risks: RiskItem[];
  okrSnapshot: OkrSnapshotItem[];
  companion: CompanionBrief;
  annotations: Annotation[];
  /** FEAT046: Top 2-3 weekly priorities */
  weeklyFocus?: string[];
  /** FEAT046: Top 2-3 monthly objectives */
  monthlyFocus?: string[];
  /** FEAT023: Topic-grouped view of today's items */
  topicDigest?: TopicDigestItem[];
  /** FEAT045: Changes since last generation/refresh. Read by Tier 2/3. */
  _changelog?: BriefChange[];
  // Legacy — kept for backward compat with existing briefs
  calendar?: CalendarSlot[];
}

export interface MindsetCard {
  icon: string;
  title: string;
  body: string;
}

export interface CompanionBrief {
  energyRead: "low" | "medium" | "high";
  mood: string;
  motivationNote: string;
  patternsToWatch: PatternWarning[];
  copingSuggestion: string;
  wins: string[];
  focusMantra: string;
  /** FEAT046: Personalized behavioral nudge cards */
  mindsetCards?: MindsetCard[];
}

export interface AgendaEvent {
  id: string;
  title: string;
  time: string;
  duration: number;
  category: "work" | "family" | "health" | "admin" | "social" | "routine" | "learning" | "other";
  flexibility: "fixed" | "flexible" | "preferred";
  source: "calendar" | "routine" | "task" | "generated";
  notes?: string;
  /** FEAT045: Marked done by Tier 1 patcher */
  _completed?: boolean;
  /** FEAT045: Marked cancelled by Tier 1 patcher */
  _cancelled?: boolean;
}

export interface DaySlot {
  date: string;
  dayLabel: string;
  isWeekend: boolean;
  additions: AgendaEvent[];           // calendar events, slotted tasks, day-specific items
  removals: string[];                 // ids of routine items to skip this day
  overrides: Partial<AgendaEvent>[];  // routine items with modified time/title for this day
  freeBlocks: { start: string; end: string }[];
  dayNote?: string;                   // optional day-level note ("light day", "interview day")
}

// Legacy type for backward compat
export interface CalendarSlot {
  date: string;
  dayLabel: string;
  events: AgendaEvent[];
  freeBlocks: { start: string; end: string }[];
}

export interface PriorityItem {
  id: string;
  rank: number;
  title: string;
  why: string;
  due: string;
  priority: string;
  okrLink: string | null;
}

export interface RiskItem {
  id: string;
  type: "overdue" | "conflict" | "blocker" | "capacity";
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface OkrSnapshotItem {
  objective: string;
  activityProgress: number;
  outcomeProgress: number;
  keyResults: {
    title: string;
    currentValue: number | null;
    currentNote: string | null;
    targetValue: number;
    targetUnit: string;
    activityProgress: number;
    outcomeProgress: number;
  }[];
  trend: "up" | "flat" | "down";
}

export interface PatternWarning {
  pattern: string;                           // what the pattern is
  risk: "high" | "medium" | "low";           // how concerning
  suggestion: string;                        // what to do about it
}

export interface Annotation {
  id: string;
  targetId: string;
  targetType: "priority" | "risk" | "calendar" | "okr";
  comment: string;
  createdAt: string;
  resolved: boolean;
}

// ─── App Config ─────────────────────────────────────────────────────────────

export type ThemeMode = "dark" | "light";

export interface AppConfig {
  anthropicApiKey: string;
  dataFolderPath: string;
  dbPath?: string;                      // local path for lifeos.db (avoids cloud sync lock conflicts)
  theme: ThemeMode;
  encryptionEnabled?: boolean;          // false by default
  encryptionSalt?: string;              // hex-encoded 16-byte salt
  passphraseInSecureStore?: boolean;    // true = auto-unlock, false = prompt each launch
}
