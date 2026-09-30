/**
 * Passage chunker shared between the ingestion edge function and local
 * tests (spec section 6: build RAG logic once, both surfaces reuse it).
 *
 * Strategy, in order:
 *   1. Split on Markdown-ish headings (PDF extraction emits "# " for
 *      headings) into sections.
 *   2. Pack a section's paragraphs into ~maxLen chunks with overlap;
 *      oversize single paragraphs get hard-split.
 *
 * ~700 chars with 120 overlap keeps passages question-answerable without
 * diluting cosine similarity with unrelated topics.
 */
export const CHUNK_TARGET_CHARS = 700;
export const CHUNK_HARD_LIMIT = 1000;
export const CHUNK_OVERLAP = 120;

type Chunk = { chunk_index: number; content: string };

export function chunkPassages(
  text: string,
  {
    target = CHUNK_TARGET_CHARS,
    hardLimit = CHUNK_HARD_LIMIT,
    overlap = CHUNK_OVERLAP,
  }: { target?: number; hardLimit?: number; overlap?: number } = {},
): Chunk[] {
  const chunks: Chunk[] = [];
  let chunk_index = 0;

  function push(content: string) {
    const cleaned = content.trim();
    if (cleaned.length >= 40) {
      chunks.push({ chunk_index: chunk_index++, content: cleaned });
    }
  }

  const sections = text
    .split(/^#{1,6}\s+/m)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const section of sections) {
    const paragraphs = section
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    let buffer = "";
    for (const paragraph of paragraphs) {
      // A single paragraph bigger than the hard limit is split on sentence
      // boundaries so no passage crosses the token budget.
      if (paragraph.length > hardLimit) {
        if (buffer) {
          push(buffer);
          buffer = "";
        }
        for (const piece of splitLongParagraph(paragraph, target, overlap)) {
          push(piece);
        }
        continue;
      }

      if (buffer && buffer.length + paragraph.length + 1 > target) {
        push(buffer);
        // Carry the tail over so the next passage keeps some context.
        buffer = buffer.slice(-overlap) + " " + paragraph;
      } else {
        buffer = buffer ? `${buffer} ${paragraph}` : paragraph;
      }
    }
    if (buffer) push(buffer);
  }

  return chunks;
}

function splitLongParagraph(
  paragraph: string,
  target: number,
  overlap: number,
): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > target) {
      pieces.push(current);
      current = current.slice(-overlap) + " " + sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
