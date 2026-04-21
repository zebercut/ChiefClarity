import type { Task } from "../types";
import { isTaskTerminal } from "../types";
import { isOverdue } from "../utils/dates";

/**
 * Deterministic task prioritization shared by the Focus Brief and the Tasks tab.
 *
 * Sort order:
 *   1. Done tasks always sort last (only included when `opts.includeDone` is true).
 *   2. Overdue tasks bubble to the top (status === "overdue" OR due < today).
 *   3. Priority enum (high → medium → low; unknown treated as low).
 *   4. Due date ascending (missing due dates sort last).
 *
 * `done` tasks are filtered out unless `opts.includeDone` is true. When kept,
 * they are sorted to the end (newest completion first if `completedAt` is set,
 * otherwise by due date) so they never visually compete with active work.
 *
 * `today` must be a YYYY-MM-DD string in the user's timezone — pass
 * `getUserToday(state)` from `src/utils/dates.ts`.
 */
const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export type SortMode = "default" | "due" | "priority" | "title";

export interface PrioritizeOptions {
  includeDone?: boolean;
  sortBy?: SortMode;
}

export function computeTaskPriority(
  tasks: Task[],
  today: string,
  opts: PrioritizeOptions = {}
): Task[] {
  const sortBy: SortMode = opts.sortBy || "default";
  const filtered = opts.includeDone
    ? [...tasks]
    : tasks.filter((t) => !isTaskTerminal(t.status));

  return filtered.sort((a, b) => {
    // 0. Done tasks sink to the bottom; among themselves, newest completion first.
    const aDone = isTaskTerminal(a.status);
    const bDone = isTaskTerminal(b.status);
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone && bDone) {
      const aCompleted = a.completedAt || "";
      const bCompleted = b.completedAt || "";
      if (aCompleted !== bCompleted) return bCompleted.localeCompare(aCompleted);
      return (a.due || "\uffff").localeCompare(b.due || "\uffff");
    }
    return compareActive(a, b, today, sortBy);
  });
}

function compareActive(a: Task, b: Task, today: string, sortBy: SortMode): number {
  switch (sortBy) {
    case "due":
      return (a.due || "\uffff").localeCompare(b.due || "\uffff");
    case "priority": {
      const pDiff =
        (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return (a.due || "\uffff").localeCompare(b.due || "\uffff");
    }
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "default":
    default: {
      // Overdue → priority enum → due date asc
      const aOverdue = a.status === "overdue" || isOverdue(a.due, today);
      const bOverdue = b.status === "overdue" || isOverdue(b.due, today);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      const pDiff =
        (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      return (a.due || "\uffff").localeCompare(b.due || "\uffff");
    }
  }
}
