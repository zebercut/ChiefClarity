/**
 * FEAT056 — v4 routing gate.
 *
 * Pure function used by chat.tsx to decide whether to attempt the v4
 * dispatch path before falling through to legacy. Extracted as its own
 * module so the decision is unit-testable in isolation (the chat surface
 * is too complex to test the decision inline).
 *
 * Returns false (skip v4, use legacy) when:
 *   - v4-enabled set is empty (rollback / disabled)
 *   - pending-context multi-turn is in flight
 *
 * Otherwise returns true and the caller should try the v4 path.
 *
 * Note: an earlier draft also gated on `triage.legacyIntent` being set,
 * with the rationale "preserve fast-path optimization for clear CRUD
 * phrases". That gate was wrong — it blocked v4 from handling planning
 * phrases that triage fast-paths to `full_planning`, and it blocked v4
 * for ANY phrase that triage's `safeDefault` punted on (because
 * safeDefault sets legacyIntent="general", a truthy string). Removed.
 *
 * The orchestrator (FEAT051) already decides routing correctly via its
 * confidence gate + Haiku tiebreaker, and the dispatcher (FEAT055)
 * returns null when the routed skill isn't in the v4-enabled set. No
 * need for the gate to second-guess that decision based on triage
 * metadata.
 */

import type { AppState } from "../types";
import { getV4SkillsEnabled } from "./router";

export interface V4GateInput {
  state: AppState;
  /**
   * Kept in the input shape for forward compatibility — callers can
   * pass it without effect. The gate no longer reads this field.
   */
  triageLegacyIntent?: string | null;
}

export function shouldTryV4(input: V4GateInput): boolean {
  // v4 only runs when skills are enabled and the user isn't mid-clarification.
  // Skill loading is now isomorphic (FEAT064 — registry reads SKILL_BUNDLE on
  // every platform), so the prior Node-only short-circuit is gone.
  if (getV4SkillsEnabled().size === 0) return false;
  if (input.state._pendingContext) return false;
  return true;
}
