import type { ContextRequirements } from "../../types/skills";

/**
 * Emotional check-in needs userToday for date-stamping the observation,
 * userProfile for timezone, topicList / existingTopicHints for tone
 * matching (informational only — the skill does not tag), and
 * recentEmotionalState (FEAT063 — last 7 days, capped at 5 most-recent
 * entries) so the LLM can briefly acknowledge a pattern without spending
 * a Sonnet call.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  topicList: true,
  existingTopicHints: true,
  recentEmotionalState: true,
};
