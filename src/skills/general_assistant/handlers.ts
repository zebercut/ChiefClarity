import type { ToolHandler } from "../../types/skills";

/**
 * Handler for `submit_general_response`.
 *
 * Args: { reply: string }
 *
 * Returns the reply as the user-facing message. No persistence — this
 * skill never writes to disk; conversation history is owned by the
 * chat surface.
 */
export const submit_general_response: ToolHandler = async (args, _ctx) => {
  const reply = (args.reply as string) ?? "";
  return {
    success: true,
    userMessage: reply || "(no reply)",
    data: { reply },
  };
};
