/**
 * Zod schemas for validating LLM output before execution.
 *
 * The LLM returns structured JSON via tool use. We validate it here
 * to prevent malformed or malicious output from corrupting state.
 */

import { z } from "zod";
import type { ActionPlan } from "../types";

// ─── Dangerous keys that could cause prototype pollution ────────────────────

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Recursively strip keys that could cause prototype pollution. */
export function stripDangerousKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripDangerousKeys);

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    clean[key] = stripDangerousKeys(value);
  }
  return clean;
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const VALID_FILE_KEYS = [
  "tasks", "calendar", "contextMemory", "feedbackMemory",
  "suggestionsLog", "learningLog", "userProfile", "userLifestyle",
  "userObservations", "planNarrative", "planAgenda",
  "planOkrDashboard", "planRisks", "focusBrief", "recurringTasks",
  "topicManifest",
] as const;

const WriteOperationSchema = z.object({
  file: z.enum(VALID_FILE_KEYS),
  action: z.enum(["add", "update", "delete"]),
  id: z.string().optional(),
  data: z.record(z.unknown()).default({}),
  // Set by the LLM only when processing bulk_input with [note <id>] markers
  // (notes batch). The notesProcessor groups writes by this field to build
  // per-note summaries.
  sourceNoteId: z.string().optional(),
});

const ActionItemSchema = z.object({
  id: z.string(),
  type: z.enum(["task", "event", "okr", "suggestion", "topic"]),
  group: z.string().optional(),
  commentary: z.string().optional(),
  suggestedAction: z.enum([
    "mark_done", "delete", "reschedule_tomorrow", "reschedule_next_week", "cancel",
  ]).nullable().optional(),
}).passthrough();

const MemorySignalSchema = z.object({
  signal: z.string(),
  value: z.string(),
});

const ActionPlanSchema = z.object({
  reply: z.string().default(""),
  writes: z.array(WriteOperationSchema).max(50).default([]),
  items: z.array(ActionItemSchema).max(100).default([]),
  conflictsToCheck: z.array(z.string()).max(50).default([]),
  suggestions: z.array(z.string()).max(20).default([]),
  memorySignals: z.array(MemorySignalSchema).max(20).default([]),
  topicSignals: z.array(z.string()).max(20).default([]),
  needsClarification: z.boolean().default(false),
});

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Validate and sanitize raw LLM output into a safe ActionPlan.
 * Returns null if validation fails entirely.
 */
export function validateActionPlan(raw: unknown): ActionPlan | null {
  try {
    // Strip prototype pollution vectors before parsing
    const sanitized = stripDangerousKeys(raw);
    const parsed = ActionPlanSchema.parse(sanitized);

    // Sanitize data within each write operation
    parsed.writes = parsed.writes.map((w) => ({
      ...w,
      data: stripDangerousKeys(w.data) as Record<string, unknown>,
    }));

    return parsed as ActionPlan;
  } catch (err) {
    console.error("[validation] LLM output failed schema validation:", err);
    return null;
  }
}
