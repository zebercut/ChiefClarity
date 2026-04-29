import type { ContextRequirements } from "../../types/skills";

/**
 * info_lookup is a retrieval-grounded skill: the heavy lifting flows in
 * via `retrievedKnowledge`, not via assembler context. Only minimal
 * lookups are declared here — `userToday` for timestamping any future
 * follow-up writes, `userProfile` so the model can match relations
 * (e.g. "tell me about my brother") to retrieved chunks.
 */
export const contextRequirements: ContextRequirements = {
  userToday: true,
  userProfile: true,
};
