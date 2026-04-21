import { readTextFile, writeTextFile, fileExists } from "../utils/filesystem";
import { assembleContext } from "./assembler";
import { callLlm } from "./llm";
import { applyWrites } from "./executor";
import {
  updateSummaries,
  rebuildHotContext,
  rebuildContradictionIndex,
} from "./summarizer";
import type { AppState, IntentResult, InboxResult, WriteOperation } from "../types";
import { TOKEN_BUDGETS } from "./router";

const INBOX_FILE = "inbox.txt";
const STABILITY_DELAY = 500; // ms between reads for sync check
const MAX_CHUNK_TOKENS = 2000; // tokens per chunk (~6000 chars) — leaves ~4000 for context
const MAX_INBOX_SIZE = 500_000; // 500 KB — reject files larger than this to prevent OOM

/**
 * Check if inbox.txt exists and has content.
 * Performs a stability check (two reads, 500ms apart) to handle
 * Google Drive sync in progress.
 * Returns the text if stable and non-empty, null otherwise.
 */
export async function checkInbox(): Promise<string | null> {
  // Read directly — don't rely on fileExists (HEAD requests fail for non-JSON on web proxy)
  const first = await readTextFile(INBOX_FILE);
  if (!first || !first.trim()) return null;

  if (first.length > MAX_INBOX_SIZE) {
    console.error(`[inbox] file too large (${first.length} bytes, max ${MAX_INBOX_SIZE}) — skipping`);
    return null;
  }

  // Stability check — read again after delay
  await sleep(STABILITY_DELAY);
  const second = await readTextFile(INBOX_FILE);

  // If content changed, file is still syncing — skip this time
  if (second !== first) {
    console.log("[inbox] file still syncing, deferring");
    return null;
  }

  return first; // return raw (untrimmed) for accurate comparison in clear logic
}

/**
 * Result of processing a bulk_input bundle (inbox text or notes batch).
 */
export interface BundleResult {
  /** True if at least one chunk got a usable plan from the LLM. */
  succeeded: boolean;
  /** Total number of writes applied across all chunks. */
  totalWrites: number;
  /** Concatenated LLM replies, one per chunk that produced one. */
  replies: string[];
  /**
   * The actual write operations the LLM produced, aggregated across all chunks.
   * Used by callers (e.g. notesProcessor) to build a deterministic per-action
   * summary that doesn't depend on the LLM's reply quality.
   */
  writes: WriteOperation[];
}

/**
 * Process an arbitrary text bundle through the bulk_input pipeline:
 * chunk if oversized, call the LLM per chunk, apply writes, refresh
 * derived state. Returns aggregated success / writes / replies.
 *
 * Shared by `processInbox` (this module) and `notesProcessor` (FEAT026).
 * Caller is responsible for any post-processing (clearing inbox.txt,
 * updating note status, etc.).
 */
export async function processBundle(
  rawText: string,
  state: AppState,
  source: string = "bundle"
): Promise<BundleResult> {
  const text = rawText.trim();
  if (!text) return { succeeded: false, totalWrites: 0, replies: [], writes: [] };

  const chunks = chunkText(text);
  let totalWrites = 0;
  let anyChunkSucceeded = false;
  const replies: string[] = [];
  const writes: WriteOperation[] = [];

  console.log(`[${source}] processing ${chunks.length} chunk(s), ~${estimateTokens(text)} tokens`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const intent: IntentResult = {
      type: "bulk_input",
      tokenBudget: TOKEN_BUDGETS.bulk_input,
      phrase: chunk,
    };

    const context = await assembleContext(intent, chunk, state, []);
    const plan = await callLlm(context, "bulk_input");

    if (!plan) {
      console.warn(`[${source}] chunk ${i + 1}/${chunks.length} returned no plan`);
      continue;
    }

    anyChunkSucceeded = true;

    if (plan.writes.length > 0) {
      await applyWrites(plan, state);
      updateSummaries(state);
      rebuildHotContext(state);
      rebuildContradictionIndex(state);
      totalWrites += plan.writes.length;
      writes.push(...plan.writes);
    }

    if (plan.reply) {
      replies.push(plan.reply);
    }
  }

  return { succeeded: anyChunkSucceeded, totalWrites, replies, writes };
}

/**
 * Process inbox text: delegate to processBundle, then clear the inbox file.
 * Returns a summary of what was processed.
 */
export async function processInbox(
  rawText: string,
  state: AppState
): Promise<InboxResult> {
  const text = rawText.trim();
  if (!text) return { reply: "", writeCount: 0, processed: false };

  const result = await processBundle(rawText, state, "inbox");

  // If ALL chunks failed (LLM down), don't clear — let next cycle retry
  if (!result.succeeded) {
    console.error("[inbox] all chunks failed — keeping inbox for retry");
    return { reply: "Inbox processing failed. Will retry on next check.", writeCount: 0, processed: false };
  }

  // Clear inbox — compare raw content exactly (no trimming) to detect edits
  const currentContent = await readTextFile(INBOX_FILE);
  if (currentContent === rawText) {
    // Exact match — safe to clear
    await clearInbox();
  } else if (currentContent !== null) {
    // Content changed during processing — leave the entire file intact
    // Don't try to slice/diff — too risky. Next cycle will pick it up.
    console.log("[inbox] content changed during processing — leaving for next cycle");
  }

  const reply = result.replies.length > 0
    ? result.replies.join(" ")
    : `Processed inbox: ${result.totalWrites} write(s) applied.`;

  return {
    reply,
    writeCount: result.totalWrites,
    processed: true,
  };
}

/**
 * Clear inbox.txt by writing an empty string.
 * Keeps the file so Google Drive retains it.
 */
export async function clearInbox(): Promise<void> {
  await writeTextFile(INBOX_FILE, "");
  console.log("[inbox] cleared");
}

/**
 * Split text into chunks at paragraph boundaries (double newlines).
 * Each chunk stays under MAX_CHUNK_TOKENS.
 * Oversized paragraphs are further split on single newlines, then by sentence.
 */
function chunkText(text: string): string[] {
  const estimated = estimateTokens(text);
  if (estimated <= MAX_CHUNK_TOKENS) return [text];

  // Split into paragraphs, then break oversized ones further
  const rawParagraphs = text.split(/\n\s*\n/);
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    if (estimateTokens(para) <= MAX_CHUNK_TOKENS) {
      paragraphs.push(para);
    } else {
      // Try splitting on single newlines
      const lines = para.split(/\n/);
      for (const line of lines) {
        if (estimateTokens(line) <= MAX_CHUNK_TOKENS) {
          paragraphs.push(line);
        } else {
          // Last resort: split by sentences
          const sentences = line.match(/[^.!?]+[.!?]+/g) || [line];
          paragraphs.push(...sentences);
        }
      }
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const combined = current ? current + "\n\n" + para : para;
    if (estimateTokens(combined) > MAX_CHUNK_TOKENS && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
