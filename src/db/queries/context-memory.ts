import { getDb } from "../index";
import type { ContextMemory, Fact } from "../../types";

export async function loadContextMemory(): Promise<ContextMemory> {
  const db = getDb();
  const factRows = await db.execute("SELECT * FROM facts ORDER BY id");
  const patternRows = await db.execute("SELECT * FROM patterns ORDER BY id");
  const eventRows = await db.execute("SELECT * FROM recent_events ORDER BY id");

  return {
    facts: factRows.rows.map((r) => ({
      text: r.text as string,
      topic: (r.topic as string) || null,
      date: (r.date as string) ?? "",
    })),
    patterns: patternRows.rows.map((r) => ({
      pattern: r.pattern as string,
      evidence: (r.evidence as string) ?? "",
      firstSeen: (r.first_seen as string) ?? "",
      lastSeen: (r.last_seen as string) ?? "",
      confidence: Number(r.confidence) || 0,
    })),
    recentEvents: eventRows.rows.map((r) => r.text as string),
  };
}

export async function insertFact(fact: Fact): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "INSERT INTO facts (text, topic, date) VALUES (?,?,?)",
    args: [fact.text, fact.topic || null, fact.date || null],
  });
}

export async function insertPattern(pattern: {
  pattern: string;
  evidence: string;
  firstSeen: string;
  lastSeen: string;
  confidence: number;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO patterns (pattern, evidence, first_seen, last_seen, confidence)
          VALUES (?,?,?,?,?)`,
    args: [pattern.pattern, pattern.evidence, pattern.firstSeen, pattern.lastSeen, pattern.confidence],
  });
}

export async function insertRecentEvent(text: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: "INSERT INTO recent_events (text) VALUES (?)", args: [text] });
}

export async function saveContextMemory(cm: ContextMemory): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM facts");
  await db.execute("DELETE FROM patterns");
  await db.execute("DELETE FROM recent_events");

  for (const f of cm.facts) {
    const fact: Fact = typeof f === "string" ? { text: f, topic: null, date: "" } : f;
    await insertFact(fact);
  }
  for (const p of cm.patterns) {
    await insertPattern(p);
  }
  for (const e of cm.recentEvents) {
    await insertRecentEvent(e);
  }
}
