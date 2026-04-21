import Anthropic from "@anthropic-ai/sdk";
import type { IntentResult, IntentType, AppState } from "../types";
import { MODEL_LIGHT, isCircuitOpen } from "./llm";

let client: Anthropic | null = null;

export function setRouterClient(c: Anthropic): void {
  client = c;
}

export const TOKEN_BUDGETS: Record<IntentType, number> = {
  task_create: 800,
  task_update: 800,
  task_query: 800,
  calendar_create: 800,
  calendar_update: 800,
  calendar_query: 800,
  okr_update: 1200,
  full_planning: 12000,
  info_lookup: 3000,
  learning: 1200,
  emotional_checkin: 800,
  feedback: 600,
  suggestion_request: 1500,
  general: 3000,
  bulk_input: 6000,
  topic_query: 3000,
  topic_note: 800,
};

// More specific patterns first — order matters
const PATTERNS: Array<[IntentType, RegExp[]]> = [
  [
    "task_update",
    [
      /\b(mark|set|change).*(done|complete|finished|priority|status)\b/i,
      /\b(cancel|remove|delete) (task|todo|to-do|reminder)\b/i,
      /\b(done with|finished|completed) .+\b/i,
    ],
  ],
  [
    "calendar_update",
    [
      /\b(cancel|reschedule|move|postpone|push back) .*(meeting|appointment|call|event)\b/i,
      /\b(meeting|appointment|call|event).*(cancel|reschedule|move)\b/i,
    ],
  ],
  [
    "task_create",
    [
      /\b(add|create|remind|remember|don't forget|make a note)\b/i,
      /\b(todo|to-do|task)\b/i,
    ],
  ],
  [
    "calendar_create",
    [
      /\b(schedule|book|set up|put on calendar|block)\b/i,
      /\b(meeting|appointment|call|event)\b.*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|\d+(am|pm))\b/i,
    ],
  ],
  [
    "calendar_query",
    [/\b(what('s| is) (on|happening)|do i have|am i free|my schedule)\b/i],
  ],
  [
    "task_query",
    [
      /\b(what (tasks|do i|should i)|show me|list my|pending|overdue)\b/i,
      /\b(show|list|find|search|get|display) .*(task|tasks|todo|to-do|item|items)\b/i,
      /\b(tasks?|items?) .*(about|related|for|with|called|named)\b/i,
      /\bwhat('s| is| are) .*(task|tasks|todo|item|items)\b/i,
      /\bhow many (tasks|items|todos)\b/i,
      /\b(where did you (log|put|save|create))\b/i,
      /\bshow me everything .*(task|todo|related|about)\b/i,
    ],
  ],
  [
    "full_planning",
    [
      /\bplan (my )?(week|day|month|tomorrow)\b/i,
      /\bweekly (plan|review|summary)\b/i,
      /\bprepare (for )?(today|tomorrow|the week)\b/i,
      /\btomorrow'?s? plan\b/i,
    ],
  ],
  [
    "okr_update",
    [/\bokr\b/i, /\bgoal\b.*\b(update|progress|status)\b/i],
  ],
  [
    "learning",
    [
      /\b(learn|study|review|practice)\b/i,
      /\b(learning item|flashcard)\b/i,
    ],
  ],
  [
    "info_lookup",
    [
      /\b(who is|what is|find|search|look up|where is)\b/i,
      /\b(what do (you|we) know about|any info on|tell me about|details on)\b/i,
      /\b(search for|look for|find me|check for)\b/i,
    ],
  ],
  [
    "emotional_checkin",
    [
      /^(what a day|tough day|great day|exhausted|tired|stressed|happy|good day)[.!]?$/i,
      /\b(feeling|venting|just wanted to say)\b/i,
    ],
  ],
  [
    "feedback",
    [
      /\b(i (prefer|like|want|hate|don't like|dislike))\b/i,
      /\b(stop|don't|never|always) .*(remind|suggest|show|ask)\b/i,
      /\b(change|update) (my )?(preference|setting|format)\b/i,
      /\b(too (long|short|verbose|brief))\b/i,
    ],
  ],
  [
    "topic_query",
    [
      /\b(tell|show|give)\b.*\b(about|on)\b.*\btopic\b/i,
      /\btopic\b.*\b(summary|overview|status)\b/i,
      /\beverything (about|on|regarding)\b/i,
    ],
  ],
  [
    "topic_note",
    [
      /\bnote (for|about|under|in) \b/i,
      /\b(add|save|store)\b.*\b(to|for|under|in) topic\b/i,
      /\bcreate (a )?topic\b/i,
    ],
  ],
  [
    "suggestion_request",
    [
      /\b(suggest|recommend|what should i|any ideas|next steps|what('s| is) next)\b/i,
    ],
  ],
];

export function classifyIntent(
  phrase: string,
  _state: AppState
): IntentResult {
  const lower = phrase.toLowerCase().trim();

  for (const [intentType, patterns] of PATTERNS) {
    if (patterns.some((p) => p.test(lower))) {
      return {
        type: intentType,
        tokenBudget: TOKEN_BUDGETS[intentType],
        phrase,
      };
    }
  }

  // Regex found no match — return general, LLM fallback runs async
  return { type: "general", tokenBudget: TOKEN_BUDGETS.general, phrase };
}

const HAIKU_MODEL = MODEL_LIGHT;
const VALID_INTENTS: IntentType[] = [
  "task_create", "task_update", "task_query",
  "calendar_create", "calendar_update", "calendar_query",
  "okr_update", "full_planning", "info_lookup", "learning",
  "emotional_checkin", "feedback", "suggestion_request", "general", "bulk_input",
  "topic_query", "topic_note",
];

export async function classifyIntentWithFallback(
  phrase: string,
  state: AppState
): Promise<IntentResult> {
  // Try regex first
  const regexResult = classifyIntent(phrase, state);
  if (regexResult.type !== "general") return regexResult;

  // Regex couldn't classify — use Haiku as a cheap fallback
  if (!client || isCircuitOpen()) return regexResult;

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      system: "Classify the user's intent into exactly one of these categories. Reply with ONLY the category name, nothing else: task_create, task_update, task_query, calendar_create, calendar_update, calendar_query, okr_update, full_planning, info_lookup, learning, emotional_checkin, feedback, suggestion_request, general, topic_query, topic_note",
      messages: [{ role: "user", content: phrase }],
    });

    const text = (response.content[0] as any)?.text?.trim().toLowerCase() ?? "";
    const matched = VALID_INTENTS.find((i) => text === i);
    if (matched) {
      return {
        type: matched,
        tokenBudget: TOKEN_BUDGETS[matched],
        phrase,
      };
    }
  } catch (err) {
    console.warn("[router] Haiku fallback failed, using general:", err);
  }

  return regexResult;
}
