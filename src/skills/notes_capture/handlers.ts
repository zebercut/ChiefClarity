import type { ToolHandler } from "../../types/skills";
import type { ActionPlan, AppState, FileKey, Note } from "../../types";

/**
 * Args shape the LLM produces via the `submit_note_capture` tool.
 *
 * Same shape as task_management (FEAT057 template) but scoped to notes.
 * The handler defensively fills in required Note fields the LLM may
 * omit, then delegates to executor.applyWrites — same dedup / topic-tag
 * pipeline as today's implicit `general` → note path.
 */
interface NoteCaptureArgs {
  reply: string;
  writes?: Array<{
    action: "add"; // notes_capture is create-only for v2.02
    data?: Partial<Note> & { text?: string };
  }>;
  conflictsToCheck?: string[];
  needsClarification?: boolean;
}

/**
 * Single tool — notes_capture is create-only. Update/query operations
 * stay legacy until later FEATs cover them.
 */
export const submit_note_capture: ToolHandler = async (args, ctx) => {
  const a = (args ?? {}) as unknown as NoteCaptureArgs;
  const state = (ctx as { state?: AppState }).state;

  // Defensive coercion: drop malformed writes; force file="notes".
  // Fill in Note defaults the LLM may omit (executor adds id + createdAt
  // via its array-file default branch in applyAdd).
  const writes = (a.writes ?? [])
    .filter((w) => w && w.action === "add" && typeof w.data?.text === "string" && w.data.text.length > 0)
    .map((w) => ({
      file: "notes" as FileKey,
      action: "add" as const,
      data: fillNoteDefaults(w.data!),
    }));

  const plan: ActionPlan = {
    reply: a.reply ?? "",
    writes,
    items: [],
    conflictsToCheck: a.conflictsToCheck ?? [],
    suggestions: [],
    memorySignals: [],
    topicSignals: [],
    needsClarification: Boolean(a.needsClarification),
  };

  let writeError: string | null = null;
  if (state && plan.writes.length > 0) {
    // Lazy import per AGENTS.md (handlers.ts no work at module-load).
    const { applyWrites } = await import("../../modules/executor");
    try {
      await applyWrites(plan, state);
    } catch (err: any) {
      // FEAT057 B1 pattern — handler never throws; capture and surface.
      writeError = err?.message ?? String(err);
      console.error(`[notes_capture] applyWrites failed: ${writeError}`);
    }
  }

  return {
    success: writeError === null,
    userMessage: writeError
      ? `${plan.reply || "I tried to save your note"} — but the write failed: ${writeError}`
      : plan.reply,
    clarificationRequired: plan.needsClarification,
    data: {
      writes: plan.writes,
      writeError,
    },
  };
};

/**
 * Fill in the required Note fields the LLM may have omitted.
 *
 * The executor's applyAdd default-branch sets `id` (genId("note")) and
 * `createdAt` (nowLocalIso()) for array-based files, so we leave those.
 * Other Note fields default to their initial state for a freshly
 * captured note.
 *
 * Test contract: if the `Note` interface gains required fields, this
 * function must update accordingly. Unit test asserts the produced
 * shape is structurally complete.
 */
function fillNoteDefaults(input: Partial<Note> & { text?: string }): Record<string, unknown> {
  return {
    text: String(input.text ?? ""),
    status: input.status ?? "pending",
    processedAt: input.processedAt ?? null,
    writeCount: input.writeCount ?? 0,
    processedSummary: input.processedSummary ?? null,
    attemptCount: input.attemptCount ?? 0,
    lastError: input.lastError ?? null,
  };
}
