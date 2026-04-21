import { getDb } from "../index";
import type { SqlValue } from "../types";
import type {
  PlanOkrDashboard,
  OkrObjective,
  OkrKeyResult,
  OkrDecision,
} from "../../types";

export async function loadOkrDashboard(): Promise<PlanOkrDashboard> {
  const db = getDb();

  // Focus period
  const fpRows = await db.execute("SELECT * FROM okr_focus_period WHERE id = 1");
  const fp = fpRows.rows[0];
  const focusPeriod = fp
    ? { start: fp.start_date as string, end: fp.end_date as string }
    : { start: "", end: "" };

  // Objectives
  const objRows = await db.execute("SELECT * FROM okr_objectives ORDER BY id");
  const krRows = await db.execute("SELECT * FROM okr_key_results ORDER BY id");
  const decRows = await db.execute(
    "SELECT * FROM okr_decisions ORDER BY objective_id, id"
  );

  // Index KRs and decisions by objective
  const krsByObj = new Map<string, OkrKeyResult[]>();
  for (const r of krRows.rows) {
    const objId = r.objective_id as string;
    if (!krsByObj.has(objId)) krsByObj.set(objId, []);
    krsByObj.get(objId)!.push(rowToKr(r));
  }
  const decsByObj = new Map<string, OkrDecision[]>();
  for (const r of decRows.rows) {
    const objId = r.objective_id as string;
    if (!decsByObj.has(objId)) decsByObj.set(objId, []);
    decsByObj.get(objId)!.push({ date: r.date as string, summary: r.summary as string });
  }

  const objectives: OkrObjective[] = objRows.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    status: (r.status as OkrObjective["status"]) || "active",
    activityProgress: Number(r.activity_progress) || 0,
    outcomeProgress: Number(r.outcome_progress) || 0,
    keyResults: krsByObj.get(r.id as string) || [],
    decisions: decsByObj.get(r.id as string) || [],
  }));

  return { focusPeriod, objectives };
}

export async function saveOkrDashboard(dashboard: PlanOkrDashboard): Promise<void> {
  const db = getDb();

  // Focus period
  await db.execute({
    sql: `INSERT OR REPLACE INTO okr_focus_period (id, start_date, end_date) VALUES (1, ?, ?)`,
    args: [dashboard.focusPeriod.start, dashboard.focusPeriod.end],
  });

  // Clear and rewrite (simpler than diffing for small datasets)
  await db.execute("DELETE FROM okr_decisions");
  await db.execute("DELETE FROM okr_key_results");
  await db.execute("DELETE FROM okr_objectives");

  for (const obj of dashboard.objectives) {
    await db.execute({
      sql: `INSERT INTO okr_objectives (id, title, status, activity_progress, outcome_progress, created_at)
            VALUES (?,?,?,?,?,?)`,
      args: [
        obj.id, obj.title, obj.status,
        obj.activityProgress || 0, obj.outcomeProgress || 0, "",
      ],
    });
    for (const kr of obj.keyResults) {
      await db.execute({
        sql: `INSERT INTO okr_key_results
              (id, objective_id, title, metric, target_type, target_value,
               target_unit, current_value, current_note, last_updated, due_date)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          kr.id, obj.id, kr.title, kr.metric || "", kr.targetType || "numeric",
          kr.targetValue ?? 0, kr.targetUnit || "",
          kr.currentValue ?? null, kr.currentNote || null,
          kr.lastUpdated || null, kr.dueDate || null,
        ],
      });
    }
    for (const dec of obj.decisions) {
      await db.execute({
        sql: `INSERT INTO okr_decisions (objective_id, date, summary) VALUES (?,?,?)`,
        args: [obj.id, dec.date, dec.summary],
      });
    }
  }
}

export async function updateObjective(
  id: string,
  fields: Partial<OkrObjective>
): Promise<void> {
  const db = getDb();
  const sets: string[] = [];
  const args: SqlValue[] = [];
  if ("title" in fields) { sets.push("title = ?"); args.push(fields.title as SqlValue); }
  if ("status" in fields) { sets.push("status = ?"); args.push(fields.status as SqlValue); }
  if ("activityProgress" in fields) { sets.push("activity_progress = ?"); args.push(fields.activityProgress as SqlValue); }
  if ("outcomeProgress" in fields) { sets.push("outcome_progress = ?"); args.push(fields.outcomeProgress as SqlValue); }
  if (sets.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE okr_objectives SET ${sets.join(", ")} WHERE id = ?`, args });
}

function rowToKr(r: Record<string, unknown>): OkrKeyResult {
  return {
    id: r.id as string,
    title: r.title as string,
    metric: (r.metric as string) ?? "",
    targetType: (r.target_type as OkrKeyResult["targetType"]) || "numeric",
    targetValue: Number(r.target_value) || 0,
    targetUnit: (r.target_unit as string) ?? "",
    currentValue: r.current_value != null ? Number(r.current_value) : null,
    currentNote: (r.current_note as string) || null,
    lastUpdated: (r.last_updated as string) || null,
    dueDate: (r.due_date as string) || undefined,
  };
}
