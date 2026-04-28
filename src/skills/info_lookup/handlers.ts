import type { SkillTool, ToolHandler } from "../../types/skills";
import type { ActionItem } from "../../types";

/**
 * FEAT068 — info_lookup tool handler.
 *
 * Read-only. The dispatcher's pre-LLM retrieval already pushed the
 * top-K chunks into the user message; the LLM picks which to cite and
 * returns:
 *   - `reply`  : 1–3 sentence synthesis (or "I don't have anything specific")
 *   - `items`  : one entry per cited chunk, surfaced verbatim
 *
 * No writes. The chat surface renders `items` via the existing
 * ItemListCard pattern.
 */

interface InfoLookupArgs {
  reply: string;
  items?: Array<{
    id?: string;
    type?: string;
    _title?: string;
  }>;
}

export const submit_info_lookup: ToolHandler = async (args) => {
  const a = (args ?? {}) as unknown as InfoLookupArgs;
  const reply = typeof a.reply === "string" ? a.reply : "";
  const rawItems = Array.isArray(a.items) ? a.items : [];

  const items: ActionItem[] = rawItems
    .filter((it) => it && typeof it === "object")
    .map((it) => {
      // Normalize the item shape to ActionItem. The chat surface only
      // requires `id` and `type`; the rest are optional snapshot fields.
      const id = typeof it.id === "string" && it.id.length > 0 ? it.id : "";
      const type = ((): ActionItem["type"] => {
        // ActionItem allows: "task" | "event" | "okr" | "suggestion" | "topic".
        // Map our retrieval sources onto that union; non-topic sources
        // collapse to "topic" for ItemListCard rendering (they're knowledge
        // chunks regardless).
        if (it.type === "topic") return "topic";
        return "topic";
      })();
      return {
        id,
        type,
        _title: typeof it._title === "string" ? it._title : undefined,
      };
    })
    .filter((it) => it.id.length > 0);

  return {
    success: true,
    userMessage: reply,
    clarificationRequired: false,
    items,
    data: {
      itemCount: items.length,
    },
  };
};

export const toolSchemas: Record<string, SkillTool> = {
  submit_info_lookup: {
    name: "submit_info_lookup",
    description:
      "Return a grounded answer to a 'what do you know about X' question, citing the user's own notes / topics / facts. Read-only — never writes.",
    input_schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description:
            "1-3 sentence synthesis grounded in retrievedKnowledge, with a citation phrase ('from your notes', 'you mentioned in topic X'). When the index has nothing relevant, say so cleanly and offer to capture notes.",
        },
        items: {
          type: "array",
          description:
            "One entry per cited chunk. Each entry references the chunk id from retrievedKnowledge so the chat surface can render a card list.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "The chunkId of the cited chunk, copied verbatim from retrievedKnowledge[].chunkId.",
              },
              type: {
                type: "string",
                description:
                  "The source kind (note, topic, contextMemory). Used by the chat surface for icon selection.",
              },
              _title: {
                type: "string",
                description:
                  "Short human-readable label for the chunk (first line / first phrase of its text).",
              },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      required: ["reply"],
      additionalProperties: false,
    },
  },
};
