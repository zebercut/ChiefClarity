import { getDb } from "../index";
import type { SuggestionsLog, Suggestion } from "../../types";

export async function loadSuggestions(): Promise<SuggestionsLog> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM suggestions ORDER BY shown_at DESC");
  return {
    suggestions: rows.rows.map((r) => ({
      id: r.id as string,
      text: r.text as string,
      shownAt: (r.shown_at as string) ?? "",
      trigger: (r.trigger_text as string) ?? "",
      actionTaken: (r.action_taken as Suggestion["actionTaken"]) || null,
      resolvedAt: (r.resolved_at as string) || null,
    })),
  };
}

export async function insertSuggestion(s: Suggestion): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO suggestions
          (id, text, shown_at, trigger_text, action_taken, resolved_at)
          VALUES (?,?,?,?,?,?)`,
    args: [s.id, s.text, s.shownAt, s.trigger || "", s.actionTaken || null, s.resolvedAt || null],
  });
}

export async function saveSuggestions(log: SuggestionsLog): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM suggestions");
  for (const s of log.suggestions) {
    await insertSuggestion(s);
  }
}
