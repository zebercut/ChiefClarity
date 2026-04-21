import { flush } from "./executor";
import { nowLocalIso } from "../utils/dates";
import type { AppState, SmartAction, WriteSummary, WriteOperation } from "../types";

/**
 * Smart Actions — derives actionable cards from LLM output.
 *
 * Key principle: every button executes IMMEDIATELY.
 * No "send to chat" for things TypeScript can do directly.
 * Only truly ambiguous operations go through chat.
 */

// ─── Direct execution functions ───────────────────────────────────────────

export async function executeDirectAction(
  actionType: string,
  targetId: string,
  state: AppState
): Promise<{ success: boolean; message: string }> {
  try {
    switch (actionType) {
      case "mark_done": {
        const task = state.tasks.tasks.find((t) => t.id === targetId);
        if (task) {
          task.status = "done";
          task.completedAt = nowLocalIso();
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${task.title}" marked done` };
        }
        const event = state.calendar.events.find((e) => e.id === targetId);
        if (event) {
          event.status = "completed";
          state._dirty.add("calendar");
          await flush(state);
          return { success: true, message: `"${event.title}" completed` };
        }
        return { success: false, message: "Item not found" };
      }

      case "cancel": {
        const event = state.calendar.events.find((e) => e.id === targetId);
        if (event) {
          event.status = "cancelled";
          state._dirty.add("calendar");
          await flush(state);
          return { success: true, message: `"${event.title}" cancelled` };
        }
        // Also try tasks — cancel = dismiss for tasks
        const cancelTask = state.tasks.tasks.find((t) => t.id === targetId);
        if (cancelTask) {
          cancelTask.status = "done";
          cancelTask.dismissedAt = nowLocalIso();
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${cancelTask.title}" dismissed` };
        }
        return { success: false, message: "Item not found" };
      }

      case "delete": {
        const delTask = state.tasks.tasks.find((t) => t.id === targetId);
        if (delTask) {
          delTask.status = "done";
          delTask.dismissedAt = nowLocalIso();
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${delTask.title}" dismissed` };
        }
        return { success: false, message: "Task not found" };
      }

      case "reschedule_tomorrow": {
        const today = getUserToday(state);
        const d = new Date(today + "T12:00:00");
        d.setDate(d.getDate() + 1);
        const tomorrowStr = d.toISOString().slice(0, 10);
        const task = state.tasks.tasks.find((t) => t.id === targetId);
        if (task) {
          task.due = tomorrowStr;
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${task.title}" moved to ${tomorrowStr}` };
        }
        return { success: false, message: "Task not found" };
      }

      case "reschedule_next_week": {
        const today = getUserToday(state);
        const d = new Date(today + "T12:00:00");
        d.setDate(d.getDate() + 7);
        const nextWeekStr = d.toISOString().slice(0, 10);
        const task = state.tasks.tasks.find((t) => t.id === targetId);
        if (task) {
          task.due = nextWeekStr;
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${task.title}" moved to ${nextWeekStr}` };
        }
        return { success: false, message: "Task not found" };
      }

      case "priority_high":
      case "priority_medium":
      case "priority_low": {
        const prio = actionType.split("_")[1] as "high" | "medium" | "low";
        const task = state.tasks.tasks.find((t) => t.id === targetId);
        if (task) {
          task.priority = prio;
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${task.title}" priority → ${prio}` };
        }
        return { success: false, message: "Task not found" };
      }

      case "dismiss":
        return { success: true, message: "Dismissed" };

      case "defer": {
        const deferTask = state.tasks.tasks.find((t) => t.id === targetId);
        if (deferTask) {
          deferTask.status = "deferred";
          deferTask.dismissedAt = nowLocalIso();
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${deferTask.title}" deferred` };
        }
        return { success: false, message: "Task not found" };
      }

      case "park": {
        const parkTask = state.tasks.tasks.find((t) => t.id === targetId);
        if (parkTask) {
          parkTask.status = "parked";
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${parkTask.title}" parked` };
        }
        return { success: false, message: "Task not found" };
      }

      case "resume": {
        const resumeTask = state.tasks.tasks.find((t) => t.id === targetId);
        if (resumeTask) {
          resumeTask.status = "pending";
          state._dirty.add("tasks");
          await flush(state);
          return { success: true, message: `"${resumeTask.title}" resumed` };
        }
        return { success: false, message: "Task not found" };
      }

      default:
        // Handle add_comment:taskId format
        if (actionType.startsWith("add_comment:")) {
          const commentText = actionType.slice("add_comment:".length);
          const task = state.tasks.tasks.find((t) => t.id === targetId);
          if (task) {
            if (!task.comments) task.comments = [];
            task.comments.push({
              id: `cmt_${Date.now()}`,
              text: commentText,
              date: nowLocalIso(),
            });
            state._dirty.add("tasks");
            await flush(state);
            return { success: true, message: "Comment added" };
          }
          return { success: false, message: "Task not found" };
        }
        return { success: false, message: `Unknown action: ${actionType}` };
    }
  } catch (err: any) {
    return { success: false, message: err?.message || "Action failed" };
  }
}

// ─── Smart Action Detection ───────────────────────────────────────────────

export function detectSmartActions(
  suggestions: string[],
  state: AppState
): SmartAction[] {
  return suggestions.map((text) => detectSuggestionType(text, state));
}

function detectSuggestionType(text: string, state: AppState): SmartAction {
  const lower = text.toLowerCase();

  // Check if suggestion references a known task
  const matchedTask = findMatchingTask(text, state);
  if (matchedTask) {
    return {
      text,
      type: "task_followup",
      taskId: matchedTask.id,
      quickActions: [
        { label: "\u2713 Done", payload: "mark_done", isDirect: true, targetId: matchedTask.id },
        { label: "Tomorrow", payload: "reschedule_tomorrow", isDirect: true, targetId: matchedTask.id },
        { label: "Next week", payload: "reschedule_next_week", isDirect: true, targetId: matchedTask.id },
        { label: "\u2717 Drop", payload: "delete", isDirect: true, targetId: matchedTask.id },
      ],
    };
  }

  // Question — ends with ?
  if (text.trim().endsWith("?")) {
    // Try to detect what the question is about for smarter options
    const isYesNo = /\b(want|would|should|shall|can|do you|is it|are you)\b/i.test(lower);
    return {
      text,
      type: "question",
      quickActions: isYesNo
        ? [
            { label: "Yes", payload: `Yes, ${text.replace(/\?$/, "")}` },
            { label: "No", payload: "dismiss", isDirect: true },
          ]
        : [
            { label: "Type...", payload: `Regarding "${text.slice(0, 50)}": ` },
          ],
    };
  }

  // Advice — starts with advice-like words
  if (/^(consider|try|you (could|should|might)|it might|think about|maybe)/i.test(lower)) {
    return {
      text,
      type: "advice",
      quickActions: [
        { label: "\u{1F44D} Do it", payload: text },
        { label: "Not now", payload: "dismiss", isDirect: true },
      ],
    };
  }

  // Action — contains action verbs
  if (/(update|check|follow up|log|set|create|add|schedule|send|call|reach out|submit)/i.test(lower)) {
    return {
      text,
      type: "action",
      quickActions: [
        { label: "\u26A1 Do it", payload: text },
        { label: "\u23F0 Remind me", payload: `Create a reminder: ${text}` },
      ],
    };
  }

  // Generic
  return {
    text,
    type: "generic",
    quickActions: [
      { label: text.length > 50 ? text.slice(0, 47) + "..." : text, payload: text },
    ],
  };
}

function findMatchingTask(text: string, state: AppState): { id: string; title: string } | null {
  const lower = text.toLowerCase();
  for (const task of state.tasks.tasks) {
    if (task.status === "done" || task.status === "deferred") continue;
    const taskLower = task.title.toLowerCase();
    if (taskLower.length >= 15 && lower.includes(taskLower)) {
      return { id: task.id, title: task.title };
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getUserToday(state: AppState): string {
  if (state.hotContext?.today) return state.hotContext.today;
  const tz = state.userProfile?.timezone || undefined;
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

// ─── Write Summary ────────────────────────────────────────────────────────

const FILE_DISPLAY_NAMES: Record<string, string> = {
  tasks: "Task",
  calendar: "Calendar event",
  focusBrief: "Focus brief",
  planNarrative: "Plan narrative",
  planAgenda: "Plan agenda",
  planRisks: "Plan risks",
  planOkrDashboard: "OKR dashboard",
  contextMemory: "Memory note",
  feedbackMemory: "Preference",
  suggestionsLog: "Suggestion",
  learningLog: "Learning item",
  userProfile: "Profile",
  userLifestyle: "Lifestyle",
  userObservations: "Observation",
  recurringTasks: "Recurring task",
};

export function buildWriteSummary(writes: WriteOperation[]): WriteSummary[] {
  return writes.map((w) => {
    const title = (w.data?.title as string) || (w.data?.name as string) || FILE_DISPLAY_NAMES[w.file] || w.file;
    const actionLabel = w.action === "add" ? "Created" : w.action === "update" ? "Updated" : "Removed";
    return {
      file: w.file,
      action: actionLabel,
      title,
      id: w.id || (w.data?.id as string),
    };
  });
}

// ─── Question Detection ──────────────────────────────────────────────────

export function isQuestionReply(reply: string, needsClarification: boolean): boolean {
  if (needsClarification) return true;
  const trimmed = reply.trim();
  if (!trimmed.endsWith("?")) return false;
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const lastSentence = sentences[sentences.length - 1];
  return lastSentence.endsWith("?");
}

export function generateResponseOptions(reply: string): SmartAction[] {
  const sentences = reply.trim().split(/(?<=[.!?])\s+/);
  const questionSentences = sentences.filter((s) => s.trim().endsWith("?"));
  if (questionSentences.length === 0) return [];

  const lastQ = questionSentences[questionSentences.length - 1].trim();
  const isYesNo = /\b(want|would|should|shall|can|do you|is it|are you)\b/i.test(lastQ.toLowerCase());

  return [{
    text: lastQ,
    type: "question",
    quickActions: isYesNo
      ? [
          { label: "Yes", payload: `Yes, ${lastQ.replace(/\?$/, "")}` },
          { label: "No, skip it", payload: "dismiss", isDirect: true },
          { label: "Type...", payload: `Regarding "${lastQ.slice(0, 40)}": ` },
        ]
      : [
          { label: "Type...", payload: `Regarding "${lastQ.slice(0, 40)}": ` },
        ],
  }];
}

// ─── ID-to-Title Replacement ──────────────────────────────────────────────

/**
 * Replace any raw IDs (TASK-123, CAL-45, etc.) in text with human-readable titles.
 * Safety net for when the LLM ignores the prompt rule.
 */
export function humanizeIds(text: string, state: AppState): string {
  if (!text) return text;

  // Build lookup map: id -> title
  const idMap = new Map<string, string>();
  for (const t of state.tasks.tasks) {
    if (t.id && t.title) idMap.set(t.id, t.title);
  }
  for (const e of state.calendar.events) {
    if (e.id && e.title) idMap.set(e.id, e.title);
  }
  // Recurring task templates — the LLM may reference the template ID or
  // construct an instance ID (rec_<templateId>_YYYYMMDD) that hasn't been
  // spawned yet. Map both the template and any plausible instance pattern.
  for (const r of state.recurringTasks.recurring) {
    if (r.id && r.title) {
      idMap.set(r.id, r.title);
    }
  }
  // OKR objectives and key results
  for (const obj of state.planOkrDashboard.objectives) {
    if (obj.id && obj.title) idMap.set(obj.id, obj.title);
    for (const kr of obj.keyResults) {
      if (kr.id && kr.title) idMap.set(kr.id, kr.title);
    }
  }

  // Replace patterns like TASK-108, CAL-45, rec_xxx, obj_1, kr_2_4
  return text.replace(/\b(TASK-\d+|CAL-\d+|CAL-[A-Z]+-\d+|tsk_\w+|rec_\w+|obj_\w+|kr_[\w]+|rcev_\w+|FEAT\d+)\b/g, (match) => {
    // For recurring instance IDs like rec_rec_abc123_20260408, also try
    // stripping the date suffix to match the template ID
    let title = idMap.get(match);
    if (!title) {
      const stripped = match.replace(/_\d{8}$/, "");
      title = idMap.get(stripped);
    }
    return title ? title : match;
  });
}
