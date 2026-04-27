import type { ContextRequirements } from "../../types/skills";

/**
 * Calendar skill needs the active events list (filtered by getActiveEvents
 * in the dispatcher resolver), today's date for relative-date resolution,
 * topic context for tagging, and contradiction history for avoiding
 * conflicting decisions.
 *
 * `calendarEvents` is the new key added in FEAT059. The other 5 keys are
 * already supported (FEAT057).
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  userToday: true,
  calendarEvents: true,
  contradictionIndexDates: true,
  topicList: true,
  existingTopicHints: true,
};
