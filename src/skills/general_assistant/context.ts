import type { ContextRequirements } from "../../types/skills";

/**
 * What the general_assistant skill needs in its context blob.
 *
 * Minimal — just enough to answer "what am I working on" type freeform
 * questions. The skill prompt directs the LLM to reference context only
 * when relevant, so passing more wouldn't help quality.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  objectives: true,
  recentTasks: { limit: 5, includeCompleted: false },
};
