import type { ToolHandler } from "../../types/skills";

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
