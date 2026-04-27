import type { ContextRequirements } from "../../types/skills";

/**
 * What the priority_planning skill needs in its context blob.
 * The dispatcher's resolver maps these declarations to actual data fetches.
 *
 * Supported keys for the v2.01 minimal resolver (per FEAT055 design review §3.3):
 *   - userProfile, objectives, recentTasks, calendarToday, calendarNextSevenDays
 *
 * Unknown keys are skipped with a warning. The full Assembler arrives in Phase 3.
 */
export const contextRequirements: ContextRequirements = {
  userProfile: true,
  objectives: true,
  recentTasks: { limit: 20, includeCompleted: false },
  calendarToday: true,
  calendarNextSevenDays: true,
};
