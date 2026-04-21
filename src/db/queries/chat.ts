import { getDb } from "../index";
import type { ChatMessage, ChatHistory } from "../../types";

export async function loadChat(): Promise<ChatHistory> {
  const db = getDb();
  const rows = await db.execute("SELECT * FROM chat_messages ORDER BY id ASC");
  return {
    messages: rows.rows.map(rowToMessage),
    lastUpdated: rows.rows.length > 0
      ? (rows.rows[rows.rows.length - 1].timestamp as string)
      : "",
  };
}

export async function insertMessage(msg: ChatMessage): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO chat_messages
          (role, content, suggestions, smart_actions, items,
           write_summary, is_question, timestamp)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      msg.role, msg.content,
      msg.suggestions ? JSON.stringify(msg.suggestions) : null,
      msg.smartActions ? JSON.stringify(msg.smartActions) : null,
      msg.items ? JSON.stringify(msg.items) : null,
      msg.writeSummary ? JSON.stringify(msg.writeSummary) : null,
      msg.isQuestion ? 1 : 0,
      msg.timestamp,
    ],
  });
}

export async function clearChat(): Promise<void> {
  const db = getDb();
  await db.execute("DELETE FROM chat_messages");
}

function rowToMessage(r: Record<string, unknown>): ChatMessage {
  return {
    role: r.role as ChatMessage["role"],
    content: (r.content as string) ?? "",
    suggestions: safeJsonParse(r.suggestions),
    smartActions: safeJsonParse(r.smart_actions),
    items: safeJsonParse(r.items),
    writeSummary: safeJsonParse(r.write_summary),
    isQuestion: r.is_question === 1,
    timestamp: (r.timestamp as string) ?? "",
  };
}

function safeJsonParse(val: unknown): any {
  if (!val) return undefined;
  try { return JSON.parse(val as string); } catch { return undefined; }
}
