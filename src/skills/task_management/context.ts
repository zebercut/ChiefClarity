import type { ContextRequirements } from "../../types/skills";

/**
 * What task_management needs in context. Each key is supported by the
 * dispatcher's resolver in `src/modules/skillDispatcher.ts`. The full
 * Assembler in Phase 3 will refine this with policy filtering.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  tasksIndex: true,
  contradictionIndexDates: true,
  topicList: true,
  existingTopicHints: true,
};
