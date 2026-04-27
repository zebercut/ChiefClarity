import type { ToolHandler } from "../../types/skills";
import type { ActionPlan, AppState, ActionItem, FileKey } from "../../types";

/**
 * Args shape the LLM produces via the `submit_task_action` tool.
 *
 * Mirrors today's ActionPlan shape (per FEAT057 design review §3.1) but
 * scoped to task operations only. Handler validates that all writes
 * target the "tasks" file before delegating to executor.applyWrites.
 */
interface TaskActionArgs {
  reply: string;
  writes?: Array<{
    action: "add" | "update" | "delete";
    id?: string;
    data?: Record<string, unknown>;
  }>;
  items?: ActionItem[];
  conflictsToCheck?: string[];
  suggestions?: string[];
  needsClarification?: boolean;
}

/**
 * Single tool — covers create, update, delete, query.
 *
 * For writes (create/update/delete): handler builds an ActionPlan and
 * calls executor.applyWrites. The executor handles dedup, conflict
 * detection, time-validation against userLifestyle, topic auto-tagging,
 * and file persistence — all unchanged from legacy.
 *
 * For queries: handler returns the LLM's `items` array. The dispatcher's
 * items pass-through (FEAT057 SkillDispatchResult.items) flows them to
 * the chat surface for ItemListCard rendering.
 */
export const submit_task_action: ToolHandler = async (args, ctx) => {
  const a = (args ?? {}) as unknown as TaskActionArgs;
  const state = (ctx as { state?: AppState }).state;

  // Defensive coercion: every write targets the "tasks" file. The skill's
  // dataSchemas.write declaration guarantees this contractually; this
  // check defends against malformed LLM output (the prompt is explicit
  // but real LLMs produce surprises).
  const writes = (a.writes ?? [])
    .filter((w) => w && (w.action === "add" || w.action === "update" || w.action === "delete"))
    .map((w) => ({
      file: "tasks" as FileKey,
      action: w.action,
      id: w.id,
      data: (w.data ?? {}) as Record<string, unknown>,
    }));

  // Build the plan. Other ActionPlan fields are kept empty / passthrough —
  // memorySignals and topicSignals come from executor.applyWrites side
  // effects (topic auto-tag), not from the skill's tool args.
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

  // Execute writes through the legacy executor. Unit tests pass no state
  // in ctx — the handler returns the plan as data so the test can assert
  // on it without invoking real I/O.
  //
  // NOTE on persistence: applyWrites mutates `state` and marks `_dirty`,
  // but does NOT write to disk. The legacy flush() call at the end of
  // chat.tsx's processPhrase persists. The v4 hook in chat.tsx must
  // call flush() after dispatchSkill returns — handler does not.
  let writeError: string | null = null;
  if (state && plan.writes.length > 0) {
    // Lazy import to avoid pulling executor's transitive deps at module-load
    // time (matches the AGENTS.md handlers.ts no-work-at-import rule).
    const { applyWrites } = await import("../../modules/executor");
    try {
      await applyWrites(plan, state);
    } catch (err: any) {
      // Per design review §6 condition 4 — handler never throws. Capture
      // and surface as a graceful failure. The dispatcher will see a
      // result with an error message; chat surface displays it.
      writeError = err?.message ?? String(err);
      console.error(
        `[task_management] applyWrites failed: ${writeError}`
      );
    }
  }

  return {
    success: writeError === null,
    userMessage: writeError
      ? `${plan.reply || "I tried to update your tasks"} — but the write failed: ${writeError}`
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
