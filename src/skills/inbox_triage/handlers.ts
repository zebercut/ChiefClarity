import type { ToolHandler } from "../../types/skills";
import type {
  ActionPlan,
  AppState,
  ActionItem,
  FileKey,
  CalendarEvent,
  Note,
  RecurringTask,
} from "../../types";
import { fillNoteDefaults } from "../notes_capture/handlers";
import {
  fillCalendarEventDefaults,
  stripRecurringFields,
} from "../calendar_management/handlers";

/**
 * Args shape the LLM produces via the `submit_inbox_triage` tool.
 *
 * First multi-file-write skill (FEAT060). Same template as FEAT057-059
 * except each write carries its own `file` field. Handler validates
 * each `file` against the manifest's `dataSchemas.write` allowlist
 * (belt-and-suspenders per design review §3.2).
 */
interface InboxTriageArgs {
  reply: string;
  writes?: Array<{
    file?: string;
    action: "add" | "update" | "delete";
    id?: string;
    data?: Record<string, unknown>;
    sourceNoteId?: string;
  }>;
  items?: ActionItem[];
  conflictsToCheck?: string[];
  suggestions?: string[];
  needsClarification?: boolean;
}

/**
 * Six-file allowlist mirrors `manifest.dataSchemas.write`. Source of
 * truth lives in the manifest; this constant is the runtime filter.
 */
const WRITE_ALLOWLIST: ReadonlySet<FileKey> = new Set<FileKey>([
  "tasks",
  "calendar",
  "notes",
  "contextMemory",
  "userObservations",
  "recurringTasks",
]);

export const submit_inbox_triage: ToolHandler = async (args, ctx) => {
  const a = (args ?? {}) as unknown as InboxTriageArgs;
  const state = ctx.state as AppState | undefined;

  // Multi-file write loop: each write declares its own `file`. We honor
  // it (unlike single-file skills FEAT057-059 which force one constant)
  // but validate against the allowlist and apply per-file defaults.
  const writes = (a.writes ?? [])
    .filter((w) => w && (w.action === "add" || w.action === "update" || w.action === "delete"))
    .map((w) => normalizeWrite(w))
    .filter((w): w is NormalizedWrite => w !== null);

  const plan: ActionPlan = {
    reply: a.reply ?? "",
    writes,
    items: (a.items ?? []) as ActionItem[],
    conflictsToCheck: a.conflictsToCheck ?? [],
    suggestions: a.suggestions ?? [],
    memorySignals: [],
    topicSignals: [],
    needsClarification: Boolean(a.needsClarification),
  };

  let writeError: string | null = null;
  if (state && plan.writes.length > 0) {
    const { applyWrites } = await import("../../modules/executor");
    try {
      await applyWrites(plan, state);
    } catch (err: any) {
      writeError = err?.message ?? String(err);
      console.error(`[inbox_triage] applyWrites failed: ${writeError}`);
    }
  }

  return {
    success: writeError === null,
    userMessage: writeError
      ? `${plan.reply || "I tried to process your inbox"} — but the write failed: ${writeError}`
      : plan.reply,
    clarificationRequired: plan.needsClarification,
    items: plan.items,
    data: {
      writes: plan.writes,
      items: plan.items,
      suggestions: plan.suggestions,
      conflictsToCheck: plan.conflictsToCheck,
      writeError,
    },
  };
};

interface NormalizedWrite {
  file: FileKey;
  action: "add" | "update" | "delete";
  id?: string;
  data: Record<string, unknown>;
  sourceNoteId?: string;
}

function normalizeWrite(
  w: NonNullable<InboxTriageArgs["writes"]>[number]
): NormalizedWrite | null {
  const fileRaw = typeof w.file === "string" ? (w.file as FileKey) : null;
  if (!fileRaw || !WRITE_ALLOWLIST.has(fileRaw)) {
    console.warn(`[inbox_triage] dropped write for unsupported file=${String(w.file)}`);
    return null;
  }
  const file = fileRaw as FileKey;
  const rawData = (w.data ?? {}) as Record<string, unknown>;

  // Per-file defensive defaults applied only on `add`. Updates/deletes
  // pass through with their existing data shape (executor handles them).
  let data: Record<string, unknown>;
  if (w.action === "add") {
    data = applyDefaultsForFile(file, rawData);
  } else {
    data = rawData;
  }

  // Drop calendar adds without a title — same defense as calendar_management.
  if (file === "calendar" && w.action === "add") {
    const title = (data as { title?: unknown }).title;
    if (typeof title !== "string" || title.length === 0) {
      console.warn("[inbox_triage] dropped calendar add with no title");
      return null;
    }
  }
  // Drop note adds without text — same defense as notes_capture.
  if (file === "notes" && w.action === "add") {
    const text = (data as { text?: unknown }).text;
    if (typeof text !== "string" || text.length === 0) {
      console.warn("[inbox_triage] dropped notes add with no text");
      return null;
    }
  }
  // Drop task adds without a title.
  if (file === "tasks" && w.action === "add") {
    const title = (data as { title?: unknown }).title;
    if (typeof title !== "string" || title.length === 0) {
      console.warn("[inbox_triage] dropped tasks add with no title");
      return null;
    }
  }
  // Drop recurringTasks adds without a title or schedule.
  if (file === "recurringTasks" && w.action === "add") {
    const title = (data as { title?: unknown }).title;
    const schedule = (data as { schedule?: unknown }).schedule;
    if (typeof title !== "string" || title.length === 0 || !schedule || typeof schedule !== "object") {
      console.warn("[inbox_triage] dropped recurringTasks add with missing title or schedule");
      return null;
    }
  }

  const out: NormalizedWrite = {
    file,
    action: w.action,
    id: w.id,
    data,
  };
  if (typeof w.sourceNoteId === "string" && w.sourceNoteId.length > 0) {
    out.sourceNoteId = w.sourceNoteId;
  }
  return out;
}

function applyDefaultsForFile(file: FileKey, data: Record<string, unknown>): Record<string, unknown> {
  switch (file) {
    case "tasks":
      return fillTaskDefaults(data);
    case "calendar":
      // FEAT059 pattern preserved — strip recurring fields BEFORE filling
      // defaults so a stray recurring flag never reaches the executor.
      return fillCalendarEventDefaults(stripRecurringFields(data as Partial<CalendarEvent>));
    case "notes":
      return fillNoteDefaults(data as Partial<Note> & { text?: string });
    case "contextMemory":
      return fillContextMemoryFactDefaults(data);
    case "userObservations":
      return fillObservationDefaults(data);
    case "recurringTasks":
      return fillRecurringTaskDefaults(data as Partial<RecurringTask>);
    default:
      return data;
  }
}

function fillTaskDefaults(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...input,
    title: typeof input.title === "string" ? input.title : "",
    priority: typeof input.priority === "string" ? input.priority : "medium",
    status: typeof input.status === "string" ? input.status : "pending",
    category: typeof input.category === "string" ? input.category : "general",
  };
}

function fillContextMemoryFactDefaults(input: Record<string, unknown>): Record<string, unknown> {
  // contextMemory writes carry a `facts: [{ text, topic, date }]` array.
  // The executor (executor.ts:475) iterates and inserts; if `facts` is
  // missing or malformed we coerce to an empty array so the write is a
  // safe no-op rather than a runtime throw.
  const factsRaw = (input as { facts?: unknown }).facts;
  if (Array.isArray(factsRaw)) {
    return { ...input, facts: factsRaw };
  }
  // Single fact provided as flat fields — wrap into the expected shape.
  if (typeof (input as { text?: unknown }).text === "string") {
    return {
      facts: [
        {
          text: (input as { text: string }).text,
          topic: (input as { topic?: string | null }).topic ?? null,
          date: (input as { date?: string }).date ?? "",
        },
      ],
    };
  }
  return { ...input, facts: [] };
}

export function fillObservationDefaults(input: Record<string, unknown>): Record<string, unknown> {
  // userObservations writes target a named sub-array via `_arrayKey`
  // (e.g. "emotionalState"). Default to "emotionalState" if unset, since
  // bulk-input legacy emits emotional/mood logs there.
  return {
    ...input,
    _arrayKey: typeof input._arrayKey === "string" ? input._arrayKey : "emotionalState",
  };
}

function fillRecurringTaskDefaults(input: Partial<RecurringTask>): Record<string, unknown> {
  const schedule = (input as { schedule?: unknown }).schedule as Partial<RecurringTask["schedule"]> | undefined;
  return {
    title: String(input.title ?? ""),
    schedule: {
      type: (schedule?.type as string) ?? "weekly",
      days: Array.isArray(schedule?.days) ? schedule!.days : [],
      time: schedule?.time,
    },
    category: typeof input.category === "string" ? input.category : "",
    priority: (input.priority as "high" | "medium" | "low") ?? "medium",
    okrLink: input.okrLink ?? null,
    duration: typeof input.duration === "number" ? input.duration : 30,
    notes: typeof input.notes === "string" ? input.notes : "",
    active: input.active === false ? false : true,
  };
}
