/**
 * End-to-end RAG pipeline test with a REAL PDF (Task 7 acceptance).
 *
 * What is real here:
 *   - a genuine PDF is generated (real text objects + full xref table) and
 *     extraction runs the production pdfjs-dist code path,
 *   - chunking runs the production chunker (web/src/lib/rag/chunker.ts),
 *   - retrieval runs the same cosine-similarity math as the search RPC
 *     (similarity = 1 - cosine distance, identical formula),
 *   - relevance is asserted: for each test question, the TOP retrieved
 *     chunk must come from the matching topic's chunk set.
 *
 * What is stubbed and why:
 *   - Qwen embeddings need DASHSCOPE_API_KEY, absent in this environment.
 *     A deterministic hashed-bag-of-words embedder (same interface, same
 *     1024 dims, unit-normalized) stands in so the full mechanics —
 *     extract -> chunk -> embed -> cosine top-k -> relevance — are all
 *     exercised. With a key, embedTexts() slots in; nothing else changes.
 *
 * Run:  node scripts/rag-e2e-test.mjs   (from web/)
 * Node >= 23 runs .ts natively via type stripping (no ts-node needed).
 */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// .ts imports are executed natively by Node's type stripping.
import { chunkPassages } from "../src/lib/rag/chunker.ts";

const require_ = createRequire(import.meta.url);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

const { generateMultiTopicPdf } = await import("./generate-test-pdf.mjs");

// ---------------------------------------------------------------------------
// Deterministic stand-in embedder: hashed bag of words, 1024 dims,
// unit-normalized. Real Qwen swap-in: createQwenEmbedder(apiKey).embedMany.
// ---------------------------------------------------------------------------
const DIMS = 1024;

function hashWord(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function embed(text) {
  const vec = new Array(DIMS).fill(0);
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    vec[hashWord(raw) % DIMS] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// Same math as the search RPC: 1 - cosine_distance (= cosine similarity).
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both unit-normalized
}

function topK(queryVec, chunkVecs, k) {
  return chunkVecs
    .map((cv, i) => ({ index: i, similarity: cosineSimilarity(queryVec, cv) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// Test corpus: 3 distinct topics, each with question-answerable facts.
// ---------------------------------------------------------------------------
const TOPICS = [
  {
    heading: "Photosynthesis",
    paragraphs: [
      "Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. It takes place in the chloroplasts, using the pigment chlorophyll to absorb sunlight.",
      "The overall equation combines six molecules of carbon dioxide with six molecules of water to produce one molecule of glucose and six molecules of oxygen. Light-dependent reactions occur in the thylakoid membrane, while the Calvin cycle occurs in the stroma.",
    ],
    question: "Where does photosynthesis take place in a plant cell?",
  },
  {
    heading: "The French Revolution",
    paragraphs: [
      "The French Revolution began in 1789 with the storming of the Bastille prison in Paris. Widespread inequality between the three estates, food shortages, and financial crisis pushed the people of France to overthrow the absolute monarchy of King Louis XVI.",
      "The revolution abolished feudal privileges, issued the Declaration of the Rights of Man, and eventually led to the rise of Napoleon Bonaparte in 1799.",
    ],
    question: "In what year did the French Revolution begin?",
  },
  {
    heading: "Newton's Laws of Motion",
    paragraphs: [
      "Newton's first law states that an object at rest stays at rest, and an object in motion stays in motion at constant velocity, unless acted upon by an external net force. This is the law of inertia.",
      "Newton's second law relates force, mass, and acceleration: force equals mass times acceleration. Newton's third law states that for every action there is an equal and opposite reaction.",
    ],
    question: "What does Newton's second law say about force and acceleration?",
  },
];

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  console.error(`  FAIL  ${label}`);
  process.exitCode = 1;
  return false;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("== RAG pipeline end-to-end test ==\n");

  // 1. Generate a REAL PDF with the three topics as sections.
  const dir = mkdtempSync(join(tmpdir(), "rag-e2e-"));
  const pdfPath = join(dir, "study-material.pdf");
  generateMultiTopicPdf(pdfPath, TOPICS.map((t) => ({
    heading: t.heading,
    paragraphs: t.paragraphs,
  })));
  console.log("[1] Generated real PDF:", pdfPath);
  const pdfBytes = new Uint8Array(readFileSync(pdfPath));

  // 2. EXTRACTION — production code path (pdfjs-dist).
  const { extractTextFromPdf } = await import("../src/lib/rag/pdf.ts");
  const text = await extractTextFromPdf(pdfBytes);
  console.log(`[2] Extracted ${text.length} chars via pdfjs-dist`);

  // 3. CHUNKING — production chunker.
  const chunks = chunkPassages(text);
  console.log(`[3] Produced ${chunks.length} chunks`);
  const chunkVecs = chunks.map((c) => embed(c.content));

  // Extraction sanity: every topic heading and a keyword fact must appear.
  for (const topic of TOPICS) {
    assert(
      text.includes(topic.heading),
      `extraction contains heading "${topic.heading}"`,
    );
    const keyword = topic.question.match(/[a-z]+/g).at(-1);
    // find a content keyword from the topic's own paragraphs
    const factWord = topic.paragraphs[0]
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 6)[0];
    assert(
      text.toLowerCase().includes(factWord),
      `extraction contains fact word "${factWord}" from ${topic.heading}`,
    );
  }

  // Chunking sanity: bounded size, ordered indices.
  assert(
    chunks.every((c) => c.content.length <= 1000 && c.content.length >= 40),
    "all chunks are within size bounds [40, 1000]",
  );
  assert(
    chunks.every((c, i) => c.chunk_index === i),
    "chunk indices are sequential",
  );

  // 4. RETRIEVAL RELEVANCE — the acceptance criterion.
  // Each question's top chunk must belong to the matching topic: verified by
  // checking the top chunk shares the topic's distinctive vocabulary.
  console.log("\nRetrieval relevance:");
  for (const topic of TOPICS) {
    const qVec = embed(topic.question);
    const [top] = topK(qVec, chunkVecs, 1);
    const topChunk = chunks[top.index];
    const topicWords = new Set(
      (topic.heading + " " + topic.paragraphs.join(" "))
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 4),
    );
    const otherWords = new Set(
      TOPICS.filter((t) => t !== topic)
        .flatMap((t) => (t.heading + " " + t.paragraphs.join(" ")).toLowerCase().split(/[^a-z0-9]+/))
        .filter((w) => w.length > 4),
    );
    const distinctive = [...topicWords].filter((w) => !otherWords.has(w));
    const overlap = distinctive.filter((w) => topChunk.content.toLowerCase().includes(w));
    const isRelevant = overlap.length >= Math.min(3, distinctive.length);
    assert(
      isRelevant,
      `"${topic.question}" -> top chunk from "${topic.heading}" (similarity ${top.similarity.toFixed(3)}, ${overlap.length} distinctive words)`,
    );
  }

  // 5. Distractor check: an off-topic query must NOT match every topic.
  const offVec = embed("quantum entanglement qubits superposition");
  const [offTop] = topK(offVec, chunkVecs, 1);
  assert(
    offTop.similarity < 0.35,
    `off-topic query scores low (${offTop.similarity.toFixed(3)})`,
  );

  rmSync(dir, { recursive: true, force: true });
  console.log(
    process.exitCode
      ? "\n== RESULT: FAILED =="
      : "\n== RESULT: ALL CHECKS PASSED ==",
  );
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
