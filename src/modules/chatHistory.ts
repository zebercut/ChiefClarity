import { readJsonFile, writeJsonFile } from "../utils/filesystem";
import { isLibsqlMode } from "./loader";
import { nowLocalIso } from "../utils/dates";
import type { ChatMessage, ChatHistory } from "../types";

const FILE = "chat_history.json";
const MAX_MESSAGES = 200; // Keep last 200 messages (~100 turns)

// Dynamic require hidden from Metro's static resolver
// eslint-disable-next-line no-eval
const lazyRequire = (path: string) => eval("require")(path);

export async function loadChatHistory(): Promise<ChatMessage[]> {
  if (isLibsqlMode()) {
    const { loadChat } = lazyRequire("../db/queries/chat");
    const data = await loadChat();
    return (data.messages ?? []).slice(-MAX_MESSAGES);
  }
  const data = await readJsonFile<ChatHistory>(FILE);
  const messages = data?.messages ?? [];
  return messages.slice(-MAX_MESSAGES);
}

export async function saveChatHistory(messages: ChatMessage[]): Promise<void> {
  const trimmed = messages.slice(-MAX_MESSAGES);
  if (isLibsqlMode()) {
    const { clearChat, insertMessage } = lazyRequire("../db/queries/chat");
    await clearChat();
    for (const msg of trimmed) {
      await insertMessage(msg);
    }
    return;
  }
  const history: ChatHistory = {
    messages: trimmed,
    lastUpdated: nowLocalIso(),
  };
  await writeJsonFile(FILE, history);
}
