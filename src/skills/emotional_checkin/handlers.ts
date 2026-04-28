import type { SkillTool, ToolHandler } from "../../types/skills";
import type { ActionPlan, AppState, FileKey } from "../../types";
import { fillObservationDefaults } from "../inbox_triage/handlers";

/**
 * Args shape the LLM produces via the `submit_emotional_checkin` tool.
 *
 * FEAT063 — single-tool capture into userObservations.emotionalState.
 * Same template as notes_capture (free-form capture) plus a handler
 * safety net (defense in depth) that strips any userObservations write
 * when the LLM signals needsClarification — i.e. the safety branch fired.
 */
interface EmotionalCheckinArgs {
  reply: string;
  writes?: Array<{
    file?: string;
    action: "add";
    data?: { observation?: string; date?: string; _arrayKey?: string };
  }>;
  needsClarification?: boolean;
}

export const submit_emotional_checkin: ToolHandler = async (args, ctx) => {
  const a = (args ?? {}) as unknown as EmotionalCheckinArgs;
  const state = ctx.state as AppState | undefined;
  const needsClarification = Boolean(a.needsClarification);

  let writes = (a.writes ?? [])
    .filter(
      (w) =>
        w &&
        w.action === "add" &&
        typeof w.data?.observation === "string" &&
        w.data.observation.length > 0
    )
    .map((w) => ({
      file: "userObservations" as FileKey,
      action: "add" as const,
      data: fillObservationDefaults(w.data as Record<string, unknown>),
    }));

  // FEAT063 condition 6 — handler-side safety net. If the LLM flagged
  // needsClarification (safety branch), drop any userObservations writes
  // it may have emitted in spite of the prompt. Defense in depth.
  if (needsClarification) {
    const dropped = writes.filter((w) => w.file === "userObservations");
    if (dropped.length > 0) {
      console.warn(
        "[emotional_checkin] dropped userObservations write because needsClarification=true (safety net)"
      );
    }
    writes = writes.filter((w) => w.file !== "userObservations");
  }

  const plan: ActionPlan = {
    reply: a.reply ?? "",
    writes,
    items: [],
    conflictsToCheck: [],
    suggestions: [],
    memorySignals: [],
    topicSignals: [],
    needsClarification,
  };

  let writeError: string | null = null;
  if (state && plan.writes.length > 0) {
    const { applyWrites } = await import("../../modules/executor");
    try {
      await applyWrites(plan, state);
    } catch (err: any) {
      writeError = err?.message ?? String(err);
      console.error(`[emotional_checkin] applyWrites failed: ${writeError}`);
    }
  }

  return {
    success: writeError === null,
    userMessage: writeError
      ? `${plan.reply || "I tried to log that"} — but the write failed: ${writeError}`
      : plan.reply,
    clarificationRequired: plan.needsClarification,
    items: [],
    data: {
      writes: plan.writes,
      writeError,
    },
  };
};

// FEAT065 — schema is intentionally narrow. The nested `writes[].data` shape
// is strict (additionalProperties: false) so the LLM cannot smuggle
// crisis-disclosure-related text into fields outside `observation`. Any new
// field here must be added in lockstep with prompt + handler updates and a
// re-review of the FEAT063 safety scope.
export const toolSchemas: Record<string, SkillTool> = {
  submit_emotional_checkin: {
    name: "submit_emotional_checkin",
    description:
      "Capture a brief emotional-state observation into userObservations. The reply is a 1-sentence empathetic acknowledgement; the write stores the observation verbatim.",
    input_schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description:
            "One-sentence empathetic acknowledgement surfaced verbatim to the user.",
        },
        writes: {
          type: "array",
          description:
            "Single-element list capturing the observation. Use exactly one entry, or omit when needsClarification is true.",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["add"],
                description: "Always \"add\" — emotional_checkin is capture-only.",
              },
              data: {
                type: "object",
                description:
                  "Observation payload. Strict shape: only observation, date, and the array key are accepted.",
                properties: {
                  observation: {
                    type: "string",
                    description:
                      "Verbatim observation captured from the user, in their own words.",
                  },
                  date: {
                    type: "string",
                    description:
                      "ISO date (YYYY-MM-DD) for this observation. Defaults to userToday when omitted.",
                  },
                  _arrayKey: {
                    type: "string",
                    enum: ["emotionalState"],
                    description:
                      "Sub-array selector inside userObservations. Always \"emotionalState\".",
                  },
                },
                required: ["observation"],
                additionalProperties: false,
              },
            },
            required: ["action", "data"],
            additionalProperties: false,
          },
        },
        needsClarification: {
          type: "boolean",
          description:
            "Set true to skip the write and prompt the user for more context (e.g. when safety branch fires).",
        },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
};
