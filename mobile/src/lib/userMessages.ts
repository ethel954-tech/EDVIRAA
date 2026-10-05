/**
 * User-facing error messages for mobile.
 *
 * One place maps known error shapes to short, clear messages; everything
 * technical (codes, statuses, DB messages) goes to console.error only and is
 * never shown to the user. Never log tokens, emails, message text or
 * document text — call sites must only pass the error object itself.
 */

/** Contexts that call AI edge functions — their 429 is the daily AI quota. */
const AI_CONTEXTS = ['tutor', 'process-document', 'backfill-summary'];

/**
 * Server messages that are already written for users. Sources — the exact
 * `raise exception` lines in supabase/migrations:
 *   'Educator verification is required to create teacher rooms'
 *     -> migrations/*educator_verification*.sql
 *   'No room found for that code'
 *     -> migrations/20250921000009_study_rooms.sql (join_room_by_code)
 *   'Role already set and cannot be changed'
 *     -> migrations/20250921000002_auth_role_finalization.sql (finalize_role)
 *   'Daily limit reached' (errcode P0001)
 *     -> migrations/20261001000001_ai_usage_daily.sql
 */
const SERVER_FRIENDLY_PATTERNS: Array<{ test: RegExp; message: string | null }> = [
  // "too many pages" — the server's message is already user-friendly.
  { test: /too many pages/i, message: null },
  {
    test: /educator verification is required|awaiting verification/i,
    message:
      'Your educator account is awaiting verification. Verify on the Edvira web app to create teacher rooms.',
  },
  {
    test: /no room found for that code/i,
    message:
      "That invite code doesn't match any room. Check the code and try again.",
  },
  {
    test: /role already set and cannot be changed|role is permanently locked/i,
    message: 'Your role has already been set and cannot be changed.',
  },
  {
    test: /daily limit reached/i,
    message: "You've reached today's AI limit. Please try again tomorrow.",
  },
];

/**
 * Resolved facts about an error: the HTTP status when known, and the
 * server's own message (the raise-exception text from a Postgres error,
 * or the JSON {error} body of an edge-function response).
 */
type ResolvedError = { message: string; status?: number };

function resolveError(error: unknown): ResolvedError {
  if (typeof error === 'object' && error !== null) {
    const e = error as {
      message?: unknown;
      status?: unknown;
      code?: unknown;
    };
    const message = typeof e.message === 'string' ? e.message : '';
    // Postgres raise-exception errors keep the SQLSTATE in `code`
    // (P0001 = raise exception, 42501 = RLS denied).
    const pgCode = typeof e.code === 'string' ? e.code : undefined;
    const pgStatus = pgCode === '42501' ? 403 : undefined;
    return {
      message,
      status: typeof e.status === 'number' ? e.status : pgStatus,
    };
  }
  return { message: String(error ?? '') };
}

export function describeError(error: unknown, context?: string): string {
  const { message, status } = resolveError(error);
  const lower = message.toLowerCase();

  // Network failure: only these three surfaces mean "no connection".
  // A plain TypeError is deliberately NOT treated as a network error.
  if (/failed to fetch|network request failed|authretryablefetch/i.test(message)) {
    return 'No connection. Check your internet and try again.';
  }

  const isAiContext = context !== undefined && AI_CONTEXTS.includes(context);

  if (
    status === 429 ||
    message === '429' ||
    /daily limit|rate limit|too many requests/.test(lower)
  ) {
    return isAiContext
      ? "You've reached today's AI limit. Please try again tomorrow."
      : 'Too many requests. Please wait a minute and try again.';
  }

  if (
    status === 503 ||
    message === '503' ||
    /service unavailable|temporarily unavailable/.test(lower)
  ) {
    return 'The service is temporarily unavailable. Please try again in a few minutes.';
  }

  if (status === 413 || /payload too large|too large/.test(lower)) {
    return 'This file is too large to process. Try a smaller file.';
  }

  for (const pattern of SERVER_FRIENDLY_PATTERNS) {
    if (pattern.test.test(message)) {
      // Some server messages are already written for users — pass them through.
      return pattern.message ?? message;
    }
  }

  return 'Something went wrong. Please try again.';
}

/** Log the technical detail (safe fields only), then get the user message. */
export function reportError(context: string, error: unknown): string {
  console.error(`[${context}]`, safeFields(error));
  return describeError(error, context);
}

/**
 * supabase.functions.invoke wraps non-2xx responses in FunctionsHttpError
 * with the raw Response in `error.context` (body still unread). Read it
 * once here so the HTTP status and the server's JSON {error} message can
 * feed describeError.
 */
export async function reportInvokeError(
  context: string,
  error: unknown,
): Promise<string> {
  const resolved = resolveError(error);
  const ctx = (error as { context?: unknown } | null)?.context;
  const response = ctx instanceof Response ? ctx : null;

  if (response && resolved.status === undefined) {
    resolved.status = response.status;
  }
  if (response) {
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === 'string') {
        resolved.message = parsed.error;
      }
    } catch {
      // Body missing or already consumed — the status alone still drives
      // the 429/503 mappings above.
    }
  }

  console.error(
    `[${context}]`,
    { status: resolved.status, message: truncate(resolved.message, 120) },
  );
  return describeError(resolved, context);
}

function safeFields(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return truncate(String(error ?? ''), 120);
  }
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  return {
    code: e.code,
    status: e.status,
    message: truncate(String(e.message ?? ''), 120),
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
