/**
 * User-facing error messages for mobile.
 *
 * One place maps known error shapes to short, clear messages; everything
 * technical (codes, statuses, DB messages) goes to console.error only and is
 * never shown to the user. Never log tokens, emails, message text or
 * document text — call sites must only pass the error object itself.
 */

/** Messages a server/edge function may already have written for the user. */
const SERVER_FRIENDLY_PATTERNS: Array<{
  test: RegExp;
  message: string | null;
}> = [
  // "too many pages" — the server's message is already user-friendly.
  { test: /too many pages/i, message: null },
  {
    test: /verification is required|awaiting verification/i,
    message:
      "Your educator account is awaiting verification. Verify on the Edvira web app to create teacher rooms.",
  },
  {
    test: /invalid.*code|code.*not.*found|no room.*code/i,
    message:
      "That invite code doesn't match any room. Check the code and try again.",
  },
  {
    test: /already (been )?(set|chosen|finalized)|role.*already/i,
    message: "Your role has already been set and cannot be changed.",
  },
];

export function describeError(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null
      ? ((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const message = typeof raw === "string" ? raw : "";
  const status =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown; code?: unknown }).status
      : undefined;

  // Network failure: fetch throws TypeError; Supabase surfaces it as
  // "Failed to fetch" / "network request failed" / AuthRetryableFetchError.
  if (
    error instanceof TypeError ||
    /failed to fetch|network request failed|fetch failed|authretryablefetch/i.test(
      message,
    )
  ) {
    return "No connection. Check your internet and try again.";
  }

  if (
    status === 429 ||
    message === "429" ||
    /daily limit|rate limit|too many requests/i.test(message)
  ) {
    return "You've reached today's AI limit. Please try again tomorrow.";
  }

  if (
    status === 503 ||
    message === "503" ||
    /service unavailable|temporarily unavailable/i.test(message)
  ) {
    return "The service is temporarily unavailable. Please try again in a few minutes.";
  }

  if (status === 413 || /payload too large|too large/i.test(message)) {
    return "This file is too large to process. Try a smaller file.";
  }

  for (const pattern of SERVER_FRIENDLY_PATTERNS) {
    if (pattern.test.test(message)) {
      // Some server messages are already written for users — pass them through.
      return pattern.message ?? message;
    }
  }

  return "Something went wrong. Please try again.";
}

/** Log the technical detail (safe fields only), then get the user message. */
export function reportError(context: string, error: unknown): string {
  const safe =
    typeof error === "object" && error !== null
      ? {
          message: (error as { message?: unknown }).message,
          code: (error as { code?: unknown }).code,
          status: (error as { status?: unknown }).status,
        }
      : String(error);
  console.error(`[${context}]`, safe);
  return describeError(error);
}
