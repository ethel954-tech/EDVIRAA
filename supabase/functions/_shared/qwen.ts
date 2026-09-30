/**
 * LLM API layer — shared by the edge functions and local tests
 * (spec section 6: AI calls live in one place, never duplicated per app).
 *
 * Embeddings: POST {LLM_BASE_URL}/embeddings with model `gemini-embedding-001`
 *   and `dimensions` = 1024, matching document_chunks.embedding vector(1024).
 *   Base URL and key come from LLM_BASE_URL / LLM_API_KEY (see llm.ts).
 * Chat: delegated to chat() in ./llm.ts — single source of truth.
 *
 * Requests are batched and 429 (rate limit) responses are retried with
 * exponential backoff. Every embedded text is capped under 2,048 tokens.
 */

import { chat } from "./llm.ts";

export const EMBEDDING_MODEL =
  Deno.env.get("LLM_EMBEDDING_MODEL") ?? "gemini-embedding-001";
/** Must match document_chunks.embedding = extensions.vector(1024). */
export const EMBEDDING_DIMENSIONS = 1024;

/** Hard cap per embedded text: safely under the 2,048-token limit. */
export const MAX_CHUNK_TOKENS = 2000;
/** ~4 chars per token (conservative for mixed prose/code). */
const CHARS_PER_TOKEN = 4;
/** Max texts sent in one embeddings request. */
export const EMBED_BATCH_SIZE = 100;

const MAX_429_RETRIES = 4;

export class QwenError extends Error {}

/** Truncates a text so its estimated token count stays under 2,048. */
export function capChunkTokens(text: string): string {
  const maxChars = (MAX_CHUNK_TOKENS - 1) * CHARS_PER_TOKEN;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** One embeddings POST with exponential backoff on 429 (rate limit). */
async function embedRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  batch: string[],
): Promise<Array<{ index: number; embedding: number[] }>> {
  let lastStatus = 0;
  let detail = "";

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (response.ok) {
      const json = await response.json();
      return json.data ?? [];
    }

    lastStatus = response.status;
    detail = await response.text().catch(() => "");

    // 429 rate-limited: wait 0.5s * 2^attempt (max ~4s), then retry.
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    break;
  }

  throw new QwenError(
    `Embedding request failed (${lastStatus}): ${detail.slice(0, 300)}`,
  );
}

/**
 * Embeds texts with gemini-embedding-001 at 1024 dimensions.
 * Texts are capped under 2,048 tokens and sent in batches; each batch is
 * retried with exponential backoff on 429.
 */
export async function embedTexts(
  texts: string[],
  {
    apiKey = Deno.env.get("LLM_API_KEY") ?? "",
    baseUrl = Deno.env.get("LLM_BASE_URL") ?? "",
    model = EMBEDDING_MODEL,
  }: { apiKey?: string; baseUrl?: string; model?: string } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!baseUrl || !apiKey) throw new QwenError("LLM configuration missing");

  const clean = texts.map(capChunkTokens);
  const ordered: number[][] = [];

  for (let i = 0; i < clean.length; i += EMBED_BATCH_SIZE) {
    const batch = clean.slice(i, i + EMBED_BATCH_SIZE);
    const data = await embedRequest(baseUrl, apiKey, model, batch);

    if (data.length !== batch.length) {
      throw new QwenError(
        `Embedding response mismatch: sent ${batch.length}, got ${data.length}`,
      );
    }
    for (const item of data) {
      if (item.embedding?.length !== EMBED_DIMS) {
        throw new QwenError(
          `Embedding dimension mismatch: expected ${EMBED_DIMS}, got ${item.embedding?.length ?? 0}`,
        );
      }
      ordered.push(item.embedding);
    }
  }
  return ordered;
}

export function createQwenEmbedder(apiKey?: string) {
  return {
    async embedMany(texts: string[]): Promise<number[][]> {
      return embedTexts(texts, { apiKey });
    },
  };
}

/**
 * Non-streaming chat completion — delegates to chat() in llm.ts
 * (single source of truth; options are kept for call-site compatibility
 * but ignored, since llm.ts owns the model/settings).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  _opts: unknown = {},
): Promise<ChatCompletionResult> {
  return chat(messages);
}

/** OpenAI-style chat message as sent to (and returned from) the LLM. */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const EMBED_DIMS = EMBEDDING_DIMENSIONS;
