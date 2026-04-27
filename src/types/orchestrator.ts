/**
 * FEAT051 — Skill Orchestrator types.
 *
 * Public-API stability contract consumed by:
 *   - chat.tsx and any other caller that picks a skill per user phrase
 *   - FEAT066 Feedback skill (reads RouteResult to know which skill answered)
 *   - FEAT069 Pending Improvements UI (audit log entries reference these)
 *
 * Breaking changes here ripple to all consumers.
 */

export type RoutingMethod =
  | "structural"  // slash command or directly named skill via structuralTriggers
  | "direct"      // button event passed a skillId
  | "embedding"   // top-1 score above threshold + gap above threshold
  | "haiku"       // tiebreaker resolved an ambiguous case
  | "fallback";   // no skill above fallback threshold → general_assistant

export interface RouteResult {
  skillId: string;
  /** 0..1 cosine similarity of the chosen skill, or 1.0 for structural/direct, or 0 for fallback. */
  confidence: number;
  routingMethod: RoutingMethod;
  /**
   * Top-3 considered candidates for transparency log + user-facing "use a
   * different skill" affordance. Empty for structural / direct routing.
   */
  candidates: Array<{ skillId: string; score: number }>;
  /**
   * Optional explanation, populated for fallback / haiku / degraded-haiku
   * cases. Used in logs and (later) the user-facing badge tap popover.
   */
  reason?: string;
}

export interface RouteInput {
  phrase: string;
  /**
   * Set when a button or programmatic caller wants to bypass NL routing
   * and invoke a specific skill (e.g., a "Re-plan" button always goes to
   * `daily_planning`).
   */
  directSkillId?: string;
}

/**
 * Result of running a routed skill end-to-end (FEAT055).
 * Returned by `dispatchSkill` in `src/modules/skillDispatcher.ts`.
 */
export interface SkillDispatchResult {
  /** The skill that handled the phrase. */
  skillId: string;
  /** The tool call the LLM produced (for logging + audit). */
  toolCall: { name: string; args: Record<string, unknown> };
  /** Handler return value. Each skill defines its own shape. */
  handlerResult: unknown;
  /** Natural-language message to show in chat. */
  userMessage: string;
  /** Optional: handler may signal that it needs the user to clarify. */
  clarificationRequired?: boolean;
  /** Set when the dispatcher degraded gracefully (e.g., LLM throw). */
  degraded?: { reason: string };
  /**
   * FEAT057: structured items the skill produced (e.g. task_query
   * results). Pass-through from `handlerResult.items`. The chat surface
   * renders these via the existing ItemListCard.
   */
  items?: import("./index").ActionItem[];
}
