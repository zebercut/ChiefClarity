import type { ContextRequirements } from "../../types/skills";

/**
 * Notes capture needs minimal context — just enough to acknowledge
 * the capture in the user's tone. No tasksIndex (notes don't conflict
 * with time blocks); no contradictionIndexDates (notes are free-form,
 * not date-anchored).
 *
 * All four keys are already supported by the dispatcher's resolver
 * (added in FEAT057). Zero new resolver work required.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  topicList: true,
  existingTopicHints: true,
};
