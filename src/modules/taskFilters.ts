import type { Task } from "../types";
import { isTaskTerminal } from "../types";
import { dateOffset, isOverdue } from "../utils/dates";

/**
 * Pure helpers for the Tasks tab: filter, group, search.
 *
 * All functions are deterministic and accept `today` as YYYY-MM-DD in the
 * user's timezone. Use `getUserToday(state)` to obtain it.
 */

export type DueBucket =
  | "Today"
  | "Tomorrow"
  | "This Week"
  | "Later"
  | "No Due Date";

export type GroupBy = "status" | "dueBucket" | "category" | "none";

export interface TaskFilters {
  status?: Task["status"];
  dueBucket?: DueBucket;
  priority?: Task["priority"];
  category?: string;
  /** When false (default), tasks with status="done" are excluded. */
  includeDone?: boolean;
}

export interface TaskSection {
  title: string;
  data: Task[];
}

const STATUS_GROUP_LABELS: Record<Task["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  overdue: "Overdue",
  done: "Done",
  deferred: "Deferred",
  parked: "Parked",
};

const DUE_BUCKET_ORDER: DueBucket[] = [
  "Today",
  "Tomorrow",
  "This Week",
  "Later",
  "No Due Date",
];

/**
 * Compute which due-date bucket a task belongs to relative to `today`.
 * "This Week" = within the next 7 days (excluding today and tomorrow).
 */
export function dueBucketOf(task: Task, today: string): DueBucket {
  if (!task.due) return "No Due Date";
  const due = task.due.slice(0, 10);
  if (due === today) return "Today";
  const tomorrow = dateOffset(today, 1);
  if (due === tomorrow) return "Tomorrow";
  if (isOverdue(task.due, today)) {
    // Overdue tasks belong to "Today" bucket so the user sees them in the
    // most-urgent grouping rather than buried under "Later".
    return "Today";
  }
  const weekEnd = dateOffset(today, 7);
  if (due <= weekEnd) return "This Week";
  return "Later";
}

/**
 * Apply filters with AND logic. Empty/undefined fields are ignored.
 * `done` tasks are excluded unless `includeDone === true`.
 */
export function filterTasks(
  tasks: Task[],
  filters: TaskFilters,
  today: string
): Task[] {
  return tasks.filter((t) => {
    if (!filters.includeDone && isTaskTerminal(t.status)) return false;
    if (filters.status && t.status !== filters.status) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.category && t.category !== filters.category) return false;
    if (filters.dueBucket && dueBucketOf(t, today) !== filters.dueBucket)
      return false;
    return true;
  });
}

/**
 * Case-insensitive substring search on the task title only.
 * Returns the input unchanged when the trimmed query is shorter than 2 chars.
 *
 * Title-only is intentional: searching notes/category surprised users by
 * matching tasks whose connection to the query lived in fields not visible
 * on the row. The detail panel exposes notes/category for users who want
 * deeper context on a specific task.
 */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return tasks;
  return tasks.filter((t) => (t.title || "").toLowerCase().includes(q));
}

/**
 * Group tasks into SectionList-shaped sections.
 * The input is assumed to be already sorted by `computeTaskPriority`; sections
 * preserve that order within each group.
 *
 * `none` returns a single section with title "" so the screen can render the
 * flat list without special-casing.
 */
export function groupTasks(tasks: Task[], groupBy: GroupBy, today: string): TaskSection[] {
  if (groupBy === "none") {
    return tasks.length === 0 ? [] : [{ title: "", data: tasks }];
  }

  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    let key: string;
    if (groupBy === "status") key = STATUS_GROUP_LABELS[t.status] || t.status;
    else if (groupBy === "dueBucket") key = dueBucketOf(t, today);
    else key = t.category || "Uncategorized";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }

  const orderedKeys = orderKeys(groupBy, Array.from(buckets.keys()));
  return orderedKeys.map((title) => ({ title, data: buckets.get(title)! }));
}

function orderKeys(groupBy: GroupBy, keys: string[]): string[] {
  if (groupBy === "dueBucket") {
    return DUE_BUCKET_ORDER.filter((k) => keys.includes(k));
  }
  if (groupBy === "status") {
    const order = ["Overdue", "In Progress", "Pending", "Done"];
    return order
      .filter((k) => keys.includes(k))
      .concat(keys.filter((k) => !order.includes(k)));
  }
  // category — alphabetical
  return [...keys].sort((a, b) => a.localeCompare(b));
}
