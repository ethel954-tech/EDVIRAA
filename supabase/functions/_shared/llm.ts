import { type ChatMessage, type ChatCompletionResult } from "./qwen.ts";

export async function chat(messages: ChatMessage[]): Promise<ChatCompletionResult> {
  const rawBaseUrl = Deno.env.get("LLM_BASE_URL");
  const apiKey = Deno.env.get("LLM_API_KEY");
  const model = Deno.env.get("LLM_MODEL");

  if (!rawBaseUrl || !apiKey || !model) {
    throw new Error("LLM configuration missing");
  }

  // Trim trailing slash
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  // Timeout controller (30s)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

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
        temperature: 0.3,
        max_tokens: 1500,
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
