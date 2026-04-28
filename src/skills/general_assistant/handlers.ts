import type { SkillTool, ToolHandler } from "../../types/skills";

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

export const toolSchemas: Record<string, SkillTool> = {
  submit_general_response: {
    name: "submit_general_response",
    description:
      "Return a plain-text conversational reply for a general-assistant phrase. Use whenever the user is chatting, asking a question, or making a request that does not fit a specialized skill.",
    input_schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "The full user-facing reply. Must be non-empty.",
        },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
};
