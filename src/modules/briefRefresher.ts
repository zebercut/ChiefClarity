/**
 * FEAT045 — Tier 2: Haiku mini-refresh of narrative fields.
 *
 * After 3+ Tier 1 patches, refreshes executiveSummary, priorities,
 * risks, and companion without regenerating the day structure.
 * Cost: ~$0.0001 per refresh. Triggered by timer or patch count.
 */
import type { AppState, FocusBrief, BriefChange, PriorityItem, RiskItem } from "../types";
import { isTaskActive } from "../types";
import { getChangelogCount } from "./briefPatcher";

const PATCH_THRESHOLD = 3;

/** Check if a Tier 2 refresh should run. */
export function shouldRefresh(state: AppState): boolean {
  return getChangelogCount(state) >= PATCH_THRESHOLD;
}

/**
 * Run a Haiku mini-refresh. Requires an LLM call function injected
 * from the proxy/headless (same pattern as other injections).
 *
 * Returns true if the refresh succeeded.
 */
let _refreshLlmFn: ((input: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null = null;

export function injectRefreshLlm(fn: typeof _refreshLlmFn): void {
  _refreshLlmFn = fn;
}

export async function refreshBriefNarrative(state: AppState): Promise<boolean> {
  const brief = state.focusBrief;
  if (!brief?.days?.length || !brief._changelog?.length) return false;
  if (!_refreshLlmFn) return false;

  const today = state.hotContext?.today || "";
  const openTasks = state.tasks.tasks.filter((t) => isTaskActive(t.status)).length;
  const completedToday = brief._changelog.filter((c) => c.type === "task_done").length;
  const overdueCount = state.hotContext?.overdueCount ?? 0;
  const nextEvent = state.hotContext?.nextCalendarEvent;

  const input: Record<string, unknown> = {
    currentBrief: {
      executiveSummary: brief.executiveSummary,
      priorities: brief.priorities,
      risks: brief.risks,
      companion: brief.companion ? {
        motivationNote: brief.companion.motivationNote,
        focusMantra: brief.companion.focusMantra,
        energyRead: brief.companion.energyRead,
      } : null,
    },
    changelog: brief._changelog.slice(-20), // last 20 changes max
    currentState: {
      today,
      openTaskCount: openTasks,
      completedToday,
      overdueCount,
      nextEvent: nextEvent ? `${nextEvent.title} at ${nextEvent.datetime}` : null,
    },
  };

  try {
    const result = await _refreshLlmFn(input);
    if (!result) return false;

    // Apply refreshed fields
    if (result.executiveSummary) {
      brief.executiveSummary = result.executiveSummary as string;
    }
    if (Array.isArray(result.priorities)) {
      brief.priorities = result.priorities as PriorityItem[];
    }
    if (Array.isArray(result.risks)) {
      brief.risks = result.risks as RiskItem[];
    }
    if (result.motivationNote && brief.companion) {
      brief.companion.motivationNote = result.motivationNote as string;
    }
    if (result.focusMantra && brief.companion) {
      brief.companion.focusMantra = result.focusMantra as string;
    }

    // Clear changelog after refresh
    brief._changelog = [];
    state._dirty.add("focusBrief");

    console.log("[brief-refresh] Tier 2 narrative refresh applied");
    return true;
  } catch (err: any) {
    console.warn("[brief-refresh] Tier 2 refresh failed:", err?.message);
    return false;
  }
}

/**
 * Build the Haiku refresh function for injection.
 * Called from proxy/headless startup. Uses the Anthropic SDK directly.
 */
export function createRefreshLlmFn(client: any, model: string) {
  const REFRESH_PROMPT = `You are updating the narrative parts of a daily focus brief.
The user's plan was generated this morning. Since then, things changed (see changelog).
Update ONLY the narrative fields to reflect current state. Keep it concise.

Use the submit_brief_refresh tool to respond.`;

  const REFRESH_TOOL = {
    name: "submit_brief_refresh",
    description: "Update the narrative fields of the focus brief.",
    input_schema: {
      type: "object" as const,
      properties: {
        executiveSummary: { type: "string", description: "Updated at-a-glance summary (4-6 bullet lines)" },
        priorities: { type: "array", items: { type: "object" }, description: "Updated priority list" },
        risks: { type: "array", items: { type: "object" }, description: "Updated risk list" },
        motivationNote: { type: "string", description: "Updated 2-3 sentence encouragement" },
        focusMantra: { type: "string", description: "Updated short daily mantra" },
      },
      required: ["executiveSummary"],
    },
  };

  return async (input: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const response = await client.messages.create({
      model,
      max_tokens: 400,
      system: REFRESH_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(input) }],
      tools: [REFRESH_TOOL],
      tool_choice: { type: "tool" as const, name: "submit_brief_refresh" },
    });

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "submit_brief_refresh") {
        return block.input as Record<string, unknown>;
      }
    }
    return null;
  };
}
