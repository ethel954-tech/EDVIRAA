import { type ChatMessage, type ChatCompletionResult } from "./qwen.ts";

/** Default chat-completion timeout: 30s. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Long generations (structured JSON, large quizzes) need more headroom. */
export const GENERATION_TIMEOUT_MS = 60_000;

export async function chat(
  messages: ChatMessage[],
  {
    temperature = 0.3,
    maxTokens = 1500,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ChatCompletionResult> {
  const rawBaseUrl = Deno.env.get("LLM_BASE_URL");
  const apiKey = Deno.env.get("LLM_API_KEY");
  const model = Deno.env.get("LLM_MODEL");

  if (!rawBaseUrl || !apiKey || !model) {
    throw new Error("LLM configuration missing");
  }

  // Trim trailing slash
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  // Timeout controller (default 30s; callers can raise it for long outputs)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Chat request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Chat response returned empty content");
    }

    return {
      content,
      model: json.model ?? model,
      usage: json.usage
    };
  } finally {
    clearTimeout(timeout);
  }
}
