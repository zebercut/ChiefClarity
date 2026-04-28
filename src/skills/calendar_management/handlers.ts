import type { SkillTool, ToolHandler } from "../../types/skills";
import type { ActionPlan, AppState, ActionItem, FileKey, CalendarEvent } from "../../types";

/**
 * Args shape the LLM produces via the `submit_calendar_action` tool.
 *
 * Same template as task_management (FEAT057) and notes_capture (FEAT058):
 * single tool with array writes + items for queries. Handler delegates
 * to executor.applyWrites for time-validation, conflict detection, and
 * recurring-event safety — all unchanged.
 */
interface CalendarActionArgs {
  reply: string;
  writes?: Array<{
    action: "add" | "update" | "delete";
    id?: string;
    data?: Partial<CalendarEvent>;
  }>;
  items?: ActionItem[];
  conflictsToCheck?: string[];
  suggestions?: string[];
  needsClarification?: boolean;
}

/**
 * Single tool covering create / update / cancel / query.
 *
 * For writes, the handler:
 *   1. Filters out malformed writes (invalid action, missing required data)
 *   2. **Filters out writes with recurring fields** as a safety net for
 *      the prompt's recurring guard. The prompt says "do NOT", but if
 *      the LLM ignores it, we still don't pass recurring fields to the
 *      executor — which would otherwise convert the event into a
 *      RecurringTask (per executor.ts line 517-526). Notably, that
 *      auto-conversion is itself the legacy safety mechanism, but the
 *      v4 skill should fail fast and ask the user instead.
 *   3. Forces file="calendar" on every write
 *   4. Defensively fills required CalendarEvent defaults
 *   5. Lazy-imports applyWrites and runs it inside try/catch
 */
export const submit_calendar_action: ToolHandler = async (args, ctx) => {
  const a = (args ?? {}) as unknown as CalendarActionArgs;
  const state = ctx.state as AppState | undefined;

  const writes = (a.writes ?? [])
    .filter((w) => w && (w.action === "add" || w.action === "update" || w.action === "delete"))
    .map((w) => ({
      file: "calendar" as FileKey,
      action: w.action,
      id: w.id,
      data: stripRecurringFields(w.data ?? {}),
    }))
    // Drop adds without a title (defense against malformed args).
    .filter((w) => {
      if (w.action !== "add") return true;
      const title = (w.data as { title?: unknown }).title;
      return typeof title === "string" && title.length > 0;
    })
    .map((w) => {
      if (w.action === "add") {
        w.data = fillCalendarEventDefaults(w.data);
      }
      return w;
    });

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
      console.error(`[calendar_management] applyWrites failed: ${writeError}`);
    }
  }

  return {
    success: writeError === null,
    userMessage: writeError
      ? `${plan.reply || "I tried to update your calendar"} — but the write failed: ${writeError}`
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

export const toolSchemas: Record<string, SkillTool> = {
  submit_calendar_action: {
    name: "submit_calendar_action",
    description:
      "Create, update, cancel, or query calendar events. Single-occurrence events only — recurring events are handled by a separate skill.",
    input_schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description:
            "Short user-facing confirmation or query summary. Required and surfaced verbatim to the user.",
        },
        writes: {
          type: "array",
          description:
            "List of calendar mutations. Omit when the request is a pure query.",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["add", "update", "delete"],
                description:
                  "Operation type. Use add for new events, update for edits, delete for cancellations.",
              },
              id: {
                type: "string",
                description:
                  "Existing event id. Required for update and delete; omit for add.",
              },
              data: {
                type: "object",
                description:
                  "Event payload. Single-occurrence only — do NOT include recurring, recurrence, or recurrenceDay fields. Recurring events are handled by the recurring_tasks skill.",
                additionalProperties: true,
              },
            },
            required: ["action"],
            additionalProperties: false,
          },
        },
        items: {
          type: "array",
          description:
            "Query result rows for the user. Omit unless this is a query.",
          items: {
            type: "object",
            additionalProperties: true,
          },
        },
        conflictsToCheck: {
          type: "array",
          description:
            "Optional list of free-text conflict probes for the executor (e.g. overlapping events).",
          items: { type: "string" },
        },
        suggestions: {
          type: "array",
          description: "Optional follow-up suggestions surfaced to the user.",
          items: { type: "string" },
        },
        needsClarification: {
          type: "boolean",
          description:
            "Set true when the request is too ambiguous to act on; pair with a question in `reply`.",
        },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
};

/**
 * Strip recurring/recurrence/recurrenceDay fields if the LLM emitted
 * them despite the prompt's "do NOT" rule. Defense in depth — without
 * this, the executor would auto-convert the event into a RecurringTask
 * (executor.ts line 517-526), which is the legacy fallback. The v4
 * skill should fail closed on recurring attempts and ask the user
 * to retry through the recurring-task handler instead.
 */
export function stripRecurringFields(data: Partial<CalendarEvent>): Partial<CalendarEvent> {
  const cleaned = { ...data };
  // The fields are deprecated on CalendarEvent but still present at runtime.
  delete (cleaned as any).recurring;
  delete (cleaned as any).recurrence;
  delete (cleaned as any).recurrenceDay;
  return cleaned;
}

/**
 * Fill in CalendarEvent defaults the LLM may omit. The executor's
 * applyAdd default-branch sets `id` and `createdAt` for array-based
 * files, so we leave those.
 */
export function fillCalendarEventDefaults(input: Partial<CalendarEvent>): Record<string, unknown> {
  return {
    title: String(input.title ?? ""),
    datetime: input.datetime ?? "",
    durationMinutes:
      typeof input.durationMinutes === "number" && input.durationMinutes > 0
        ? input.durationMinutes
        : 60,
    status: input.status ?? "scheduled",
    type: input.type ?? "meeting",
    priority: input.priority ?? "medium",
    notes: input.notes ?? "",
    relatedInbox: Array.isArray(input.relatedInbox) ? input.relatedInbox : [],
  };
}
