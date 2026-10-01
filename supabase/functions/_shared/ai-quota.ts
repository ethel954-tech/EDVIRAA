export type AiQuotaFailure = {
  status: 429 | 503;
  message: string;
};

const QUOTA_UNAVAILABLE_MESSAGE =
  "AI usage checks are temporarily unavailable. Please try again shortly.";

export async function checkAiQuota(
  rpc: () => PromiseLike<{ error: { message: string } | null }>,
  functionName: string,
): Promise<AiQuotaFailure | null> {
  try {
    const { error } = await rpc();
    return aiQuotaFailure(error, functionName);
  } catch (error) {
    console.error(`[${functionName}] consume_ai_quota RPC threw:`, error);
    return { status: 503, message: QUOTA_UNAVAILABLE_MESSAGE };
  }
}

export function aiQuotaFailure(
  error: { message: string } | null,
  functionName: string,
): AiQuotaFailure | null {
  if (!error) return null;

  console.error(`[${functionName}] consume_ai_quota RPC failed:`, error.message);
  if (error.message.includes("Daily limit reached")) {
    return {
      status: 429,
      message: "You've reached today's AI limit. Please try again tomorrow.",
    };
  }

  return {
    status: 503,
    message: QUOTA_UNAVAILABLE_MESSAGE,
  };
}