import { getDb } from "../index";
import type { UserObservations } from "../../types";

export async function loadObservations(): Promise<UserObservations> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM user_observations ORDER BY id");
  const gcRows = await db.execute("SELECT * FROM goals_context WHERE id = 1");

  const workStyle: UserObservations["workStyle"] = [];
  const communicationStyle: UserObservations["communicationStyle"] = [];
  const taskCompletionPatterns: UserObservations["taskCompletionPatterns"] = [];
  const emotionalState: UserObservations["emotionalState"] = [];

  for (const r of rows.rows) {
    const cat = r.category as string;
    if (cat === "workStyle") {
      workStyle.push({
        observation: r.observation as string,
        firstSeen: (r.date as string) ?? "",
        confidence: r.confidence != null ? Number(r.confidence) : undefined,
      });
    } else if (cat === "communicationStyle") {
      communicationStyle.push({
        observation: r.observation as string,
        firstSeen: (r.date as string) ?? "",
      });
    } else if (cat === "taskCompletionPatterns") {
      taskCompletionPatterns.push({
        category: (r.cat_label as string) ?? "",
        pattern: (r.pattern as string) ?? "",
        firstSeen: (r.date as string) ?? "",
      });
    } else if (cat === "emotionalState") {
      emotionalState.push({
        observation: r.observation as string,
        date: (r.date as string) ?? "",
      });
    }
  }

  const gc = gcRows.rows[0];
  const goalsContext = gc
    ? {
        primaryGoal: (gc.primary_goal as string) ?? "",
        secondaryGoals: safeJsonArray(gc.secondary_goals),
        financialPressure: (gc.financial_pressure as string) ?? "",
        lastUpdated: (gc.last_updated as string) ?? "",
      }
    : {
        primaryGoal: "",
        secondaryGoals: [],
        financialPressure: "",
        lastUpdated: "",
      };

  return { workStyle, communicationStyle, taskCompletionPatterns, emotionalState, goalsContext };
}

export async function saveObservations(obs: UserObservations): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM user_observations");

  for (const o of obs.workStyle) {
    await db.execute({
      sql: `INSERT INTO user_observations (category, observation, date, confidence)
            VALUES ('workStyle',?,?,?)`,
      args: [o.observation, o.firstSeen || "", o.confidence ?? null],
    });
  }
  for (const o of obs.communicationStyle) {
    await db.execute({
      sql: `INSERT INTO user_observations (category, observation, date)
            VALUES ('communicationStyle',?,?)`,
      args: [o.observation, o.firstSeen || ""],
    });
  }
  for (const o of obs.taskCompletionPatterns) {
    await db.execute({
      sql: `INSERT INTO user_observations (category, observation, pattern, cat_label, date)
            VALUES ('taskCompletionPatterns',?,?,?,?)`,
      args: [o.category + ": " + o.pattern, o.pattern || "", o.category || "", o.firstSeen || ""],
    });
  }
  for (const o of obs.emotionalState) {
    await db.execute({
      sql: `INSERT INTO user_observations (category, observation, date)
            VALUES ('emotionalState',?,?)`,
      args: [o.observation, o.date || ""],
    });
  }

  // Goals context singleton
  await db.execute({
    sql: `INSERT OR REPLACE INTO goals_context
          (id, primary_goal, secondary_goals, financial_pressure, last_updated)
          VALUES (1,?,?,?,?)`,
    args: [
      obs.goalsContext?.primaryGoal ?? "",
      JSON.stringify(obs.goalsContext?.secondaryGoals ?? []),
      obs.goalsContext?.financialPressure ?? "",
      obs.goalsContext?.lastUpdated ?? "",
    ],
  });
}

function safeJsonArray(val: unknown): string[] {
  if (!val) return [];
  try { return JSON.parse(val as string); } catch { return []; }
}
