/**
 * FEAT068 — Topic-page chunker.
 *
 * Splits a long-form text into paragraph-sized chunks before embedding,
 * so retrieval scores per-paragraph instead of being smeared across an
 * entire long page. Paragraph split on double newline; each chunk capped
 * at 500 chars (split further on sentence boundary if longer); empties
 * dropped; no overlap (per FEAT068 design review §3 alt 7).
 *
 * Dormant until topic-page writes ship under FEAT083+. Notes /
 * contextMemory facts use a single-chunk encoding (the whole text).
 */

const MAX_CHUNK_CHARS = 500;

/** Split a paragraph into <= MAX_CHUNK_CHARS pieces on sentence boundary. */
function splitLongParagraph(p: string): string[] {
  if (p.length <= MAX_CHUNK_CHARS) return [p];
  const out: string[] = [];
  // Cheap sentence split — period/exclamation/question followed by space.
  const sentences = p.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const s of sentences) {
    if (!s) continue;
    if (buf.length === 0) {
      buf = s;
      continue;
    }
    if (buf.length + 1 + s.length <= MAX_CHUNK_CHARS) {
      buf = buf + " " + s;
    } else {
      out.push(buf);
      buf = s;
    }
  }
  if (buf) out.push(buf);
  // Hard cap any piece still too long (single 500+ char sentence) by char slice.
  return out.flatMap((piece) =>
    piece.length <= MAX_CHUNK_CHARS
      ? [piece]
      : sliceByChars(piece, MAX_CHUNK_CHARS)
  );
}

function sliceByChars(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

export function chunkTopicPage(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs.flatMap(splitLongParagraph);
}
