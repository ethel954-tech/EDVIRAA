/**
 * Qwen (DashScope) API layer — shared by the edge functions and local tests
 * (spec section 6: AI calls live in one place, never duplicated per app).
 *
 * OpenAI-compatible endpoints:
 *   embeddings: POST {base}/embeddings   model: text-embedding-v3 (1024 dims)
 *   chat:       POST {base}/chat/completions
 *
 * The base URL is overridable so tests (and self-hosted Qwen) can point at
 * an OpenAI-compatible stub without code changes.
 */

const DASHSCOPE_BASE =
  process.env.DASHSCOPE_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const EMBEDDING_MODEL = process.env.QWEN_EMBEDDING_MODEL ?? "text-embedding-v3";
export const CHAT_MODEL = process.env.QWEN_CHAT_MODEL ?? "qwen-plus";
export const EMBEDDING_DIMENSIONS = 1024;

export class QwenError extends Error {}

type Embedder = {
  embedMany(texts: string[]): Promise<number[][]>;
};

/** Minimal embedder shape so tests can inject a deterministic stand-in. */
export function createQwenEmbedder(apiKey: string): Embedder {
  return {
    async embedMany(texts) {
      return embedTexts(texts, { apiKey });
    },
  };
}

export async function embedTexts(
  texts: string[],
  {
    apiKey,
    baseUrl = DASHSCOPE_BASE,
    model = EMBEDDING_MODEL,
  }: { apiKey: string; baseUrl?: string; model?: string },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new QwenError(
      `Embedding request failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  if (!json.data || json.data.length !== texts.length) {
    throw new QwenError(
      `Embedding response mismatch: sent ${texts.length}, got ${json.data?.length ?? 0}`,
    );
  }

  // The API returns embeddings out of order when batching; restore by index.
  const ordered: number[][] = new Array(texts.length);
  for (const item of json.data) {
    ordered[item.index] = item.embedding;
  }
  return ordered;
}

/** OpenAI-style chat message as sent to (and returned from) Qwen. */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  /** Token usage when the API reports it (not all compatible servers do). */
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

/**
 * Non-streaming chat completion against the OpenAI-compatible endpoint.
 * The tutor edge function passes grounded history; tests can point baseUrl
 * at a stub, exactly like the embedder.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  {
    apiKey,
    baseUrl = DASHSCOPE_BASE,
    model = CHAT_MODEL,
    temperature = 0.3,
    maxTokens = 1500,
  }: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<ChatCompletionResult> {
  if (messages.length === 0) {
    throw new QwenError("chatCompletion requires at least one message");
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new QwenError(
      `Chat request failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: ChatCompletionResult["usage"];
  };

  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new QwenError("Chat response had no message content");
  }

  return { content, model: json.model ?? model, usage: json.usage };
}
