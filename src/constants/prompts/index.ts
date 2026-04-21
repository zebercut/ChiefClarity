/**
 * FEAT043 — Composable prompt builder.
 *
 * Selects prompt sections based on the triage actionType.
 * Replaces the monolithic 420-line SYSTEM_PROMPT for Stage 2.
 */
import { CORE_RULES } from "./core";
import { CREATE_RULES } from "./create";
import { ANALYSIS_RULES } from "./analysis";
import { SYSTEM_PROMPT } from "../prompts";
import type { ActionType } from "../../modules/triage";

// Planning rules are too complex to extract right now — reuse the
// full SYSTEM_PROMPT for planning intents. Other action types get lean prompts.
const PLANNING_RULES = SYSTEM_PROMPT;

const SECTION_MAP: Record<ActionType, string[]> = {
  create: [CORE_RULES, CREATE_RULES],
  update: [CORE_RULES],
  query: [CORE_RULES],
  analysis: [CORE_RULES, ANALYSIS_RULES],
  plan: [PLANNING_RULES],
  chat: [CORE_RULES],
};

/**
 * Build the system prompt for Stage 2 based on the triage actionType.
 * Returns a lean prompt for simple actions, full prompt for planning.
 */
export function buildSystemPrompt(actionType: ActionType): string {
  const sections = SECTION_MAP[actionType] || [CORE_RULES];
  return sections.join("\n\n");
}
