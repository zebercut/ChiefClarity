import type { ContextRequirements } from "../../types/skills";

/**
 * Inbox triage needs broad context — it deduplicates against existing
 * tasks and calendar events, resolves relative dates against today, tags
 * structured facts with topic hints, and avoids contradicting prior
 * decisions on the same date.
 *
 * All seven keys are already supported by the dispatcher's resolver
 * (added by FEAT057 + FEAT059). Zero new resolver work required.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  tasksIndex: true,
  calendarEvents: true,
  topicList: true,
  existingTopicHints: true,
  contradictionIndexDates: true,
};
