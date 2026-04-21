import { readJsonFile, writeJsonFile } from "../utils/filesystem";
import { isLibsqlMode } from "./loader";
import { applyWrites, flush } from "./executor";
import { nowLocalIso } from "../utils/dates";
import type { AppState, ActionPlan } from "../types";

// Dynamic require hidden from Metro's static resolver
// eslint-disable-next-line no-eval
const lazyRequire = (path: string) => eval("require")(path);

const ANNOTATIONS_FILE = "annotations.json";

export interface Annotation {
  id: string;
  targetId: string;
  targetType: "priority" | "risk" | "calendar" | "okr" | "companion" | "general";
  targetTitle: string;
  comment: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: "user" | "llm" | "auto" | null;
}

export interface AnnotationsFile {
  annotations: Annotation[];
}

// ─── Immediate action patterns ────────────────────────────────────────────

const IMMEDIATE_PATTERNS: { pattern: RegExp; action: string }[] = [
  { pattern: /^(done|completed|finished|mark done|mark as done|did it)$/i, action: "mark_done" },
  { pattern: /^(cancel|cancelled|remove|delete|drop|kill)$/i, action: "delete" },
  { pattern: /^(skip|dismiss|not relevant|ignore|acknowledged?)$/i, action: "dismiss" },
];

function detectImmediateAction(comment: string): string | null {
  const trimmed = comment.trim();
  for (const { pattern, action } of IMMEDIATE_PATTERNS) {
    if (pattern.test(trimmed)) return action;
  }
  return null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export async function loadAnnotations(): Promise<AnnotationsFile> {
  if (isLibsqlMode()) {
    const { loadAnnotations: loadFromDb } = lazyRequire("../db/queries/annotations");
    const rows = await loadFromDb();
    return { annotations: rows };
  }
  const data = await readJsonFile<AnnotationsFile>(ANNOTATIONS_FILE);
  return data ?? { annotations: [] };
}

export async function saveAnnotations(file: AnnotationsFile): Promise<void> {
  if (isLibsqlMode()) {
    const { saveAnnotations: saveToDb } = lazyRequire("../db/queries/annotations");
    await saveToDb(file.annotations);
    return;
  }
  await writeJsonFile(ANNOTATIONS_FILE, file);
}

/**
 * Add a new annotation. If the comment matches an immediate action pattern,
 * execute it directly (no LLM) and mark as resolved.
 *
 * Returns: { executed: boolean, action?: string }
 */
export async function addAnnotation(
  targetId: string,
  targetType: Annotation["targetType"],
  targetTitle: string,
  comment: string,
  state: AppState | null
): Promise<{ executed: boolean; action?: string }> {
  const file = await loadAnnotations();

  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  const id = `ann_${Date.now().toString(36)}_${rand}`;
  const annotation: Annotation = {
    id,
    targetId,
    targetType,
    targetTitle,
    comment,
    createdAt: nowLocalIso(),
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
  };

  // Check for immediate action
  const immediateAction = detectImmediateAction(comment);
  if (immediateAction && state) {
    const executed = await executeImmediate(immediateAction, targetId, targetType, state);
    if (executed) {
      annotation.resolved = true;
      annotation.resolvedAt = nowLocalIso();
      annotation.resolvedBy = "auto";
    }
    file.annotations.push(annotation);
    await saveAnnotations(file);
    return { executed, action: immediateAction };
  }

  file.annotations.push(annotation);
  await saveAnnotations(file);
  return { executed: false };
}

/**
 * Get all unresolved annotations.
 */
export async function getUnresolvedAnnotations(): Promise<Annotation[]> {
  const file = await loadAnnotations();
  return file.annotations.filter((a) => !a.resolved);
}

/**
 * Mark annotations as resolved by IDs.
 */
export async function resolveAnnotations(ids: string[], resolvedBy: "user" | "llm" | "auto"): Promise<void> {
  const file = await loadAnnotations();
  const now = nowLocalIso();
  for (const ann of file.annotations) {
    if (ids.includes(ann.id) && !ann.resolved) {
      ann.resolved = true;
      ann.resolvedAt = now;
      ann.resolvedBy = resolvedBy;
    }
  }
  await saveAnnotations(file);
}

/**
 * Get annotation count for a specific target (for badge display).
 */
export async function getAnnotationCount(targetId: string): Promise<number> {
  const file = await loadAnnotations();
  return file.annotations.filter((a) => a.targetId === targetId && !a.resolved).length;
}

// ─── Immediate execution (no LLM) ────────────────────────────────────────

async function executeImmediate(
  action: string,
  targetId: string,
  targetType: string,
  state: AppState
): Promise<boolean> {
  try {
    if (action === "mark_done" && (targetType === "priority" || targetType === "calendar")) {
      // Mark task as done
      const task = state.tasks.tasks.find((t) => t.id === targetId);
      if (task) {
        task.status = "done";
        task.completedAt = nowLocalIso();
        state._dirty.add("tasks");
        await flush(state);
        console.log(`[annotations] marked task "${task.title}" as done`);
        return true;
      }
      // Try calendar event
      const event = state.calendar.events.find((e) => e.id === targetId);
      if (event) {
        event.status = "completed";
        state._dirty.add("calendar");
        await flush(state);
        console.log(`[annotations] marked event "${event.title}" as completed`);
        return true;
      }
    }

    if (action === "delete") {
      // Delete task
      const taskIdx = state.tasks.tasks.findIndex((t) => t.id === targetId);
      if (taskIdx >= 0) {
        const title = state.tasks.tasks[taskIdx].title;
        state.tasks.tasks.splice(taskIdx, 1);
        state._dirty.add("tasks");
        await flush(state);
        console.log(`[annotations] deleted task "${title}"`);
        return true;
      }
      // Cancel calendar event
      const event = state.calendar.events.find((e) => e.id === targetId);
      if (event) {
        event.status = "cancelled";
        state._dirty.add("calendar");
        await flush(state);
        console.log(`[annotations] cancelled event "${event.title}"`);
        return true;
      }
    }

    if (action === "dismiss") {
      // Just resolve the annotation, no data change
      return true;
    }

    return false;
  } catch (err) {
    console.error("[annotations] immediate action failed:", err);
    return false;
  }
}
