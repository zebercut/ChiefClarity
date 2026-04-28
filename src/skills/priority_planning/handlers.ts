import type { SkillTool, ToolHandler } from "../../types/skills";

/**
 * Handler for `submit_priority_ranking`.
 *
 * Args shape (validated by the LLM tool schema, not re-validated here):
 *   {
 *     ranked: Array<{ taskId: string; reason: string }>,  // max 5
 *     topPick: { taskId: string; reason: string },
 *     summary: string                                     // one-paragraph framing
 *   }
 *
 * v2.01 POC scope: this handler builds the user-facing message and returns
 * the ranking. Persistence to `priority_log` is deferred to FEAT080 batch 1
 * when the executor is wired into the dispatch path.
 */
export const submit_priority_ranking: ToolHandler = async (args, _ctx) => {
  const ranked = (args.ranked as Array<{ taskId: string; reason: string }>) ?? [];
  const topPick = args.topPick as { taskId: string; reason: string } | undefined;
  const summary = (args.summary as string) ?? "";

  return {
    success: true,
    userMessage: buildUserMessage(summary, topPick, ranked),
    data: { ranked, topPick, summary },
  };
};

export const request_clarification: ToolHandler = async (args, _ctx) => {
  const question = (args.question as string) ?? "Could you give me a bit more context?";
  return {
    success: true,
    clarificationRequired: true,
    userMessage: question,
    data: { question },
  };
};

function buildUserMessage(
  summary: string,
  topPick: { taskId: string; reason: string } | undefined,
  ranked: Array<{ taskId: string; reason: string }>
): string {
  const lines: string[] = [];
  if (summary) lines.push(summary);
  if (topPick) {
    lines.push("");
    lines.push(`Top pick: ${topPick.taskId} — ${topPick.reason}`);
  }
  if (ranked.length > 0) {
    lines.push("");
    lines.push("Full ranking:");
    ranked.forEach((item, i) => {
      lines.push(`  ${i + 1}. ${item.taskId} — ${item.reason}`);
    });
  }
  return lines.join("\n");
}

export const toolSchemas: Record<string, SkillTool> = {
  submit_priority_ranking: {
    name: "submit_priority_ranking",
    description:
      "Submit a ranked list of the user's most important tasks for today, the single top pick, and a one-paragraph framing summary. Use when there is enough context to produce a confident ranking.",
    input_schema: {
      type: "object",
      properties: {
        ranked: {
          type: "array",
          description:
            "Ordered list of up to 5 tasks, highest priority first. Each entry references an existing task by id and gives a short reason.",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              taskId: {
                type: "string",
                description: "Existing task id from the provided context.",
              },
              reason: {
                type: "string",
                description: "Short justification for this ranking position.",
              },
            },
            required: ["taskId", "reason"],
            additionalProperties: false,
          },
        },
        topPick: {
          type: "object",
          description:
            "The single most important task to focus on right now. Must be the first entry of `ranked`.",
          properties: {
            taskId: {
              type: "string",
              description: "Existing task id from the provided context.",
            },
            reason: {
              type: "string",
              description: "Short justification for picking this task first.",
            },
          },
          required: ["taskId", "reason"],
          additionalProperties: false,
        },
        summary: {
          type: "string",
          description:
            "One-paragraph framing summary explaining the day's focus. Surfaced verbatim to the user.",
        },
      },
      required: ["ranked", "topPick", "summary"],
      additionalProperties: false,
    },
  },
  request_clarification: {
    name: "request_clarification",
    description:
      "Ask the user a single follow-up question when the available context is too thin to produce a confident ranking.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "A single, short clarifying question. Surfaced verbatim to the user.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
};
