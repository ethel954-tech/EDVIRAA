import { createClient } from "@/lib/supabase/client";

/**
 * Calls a Supabase edge function with the user's access token.
 * Throws a user-friendly Error on failure; returns the parsed JSON payload.
 */
export async function callEdgeFunction<TResponse = unknown>(
  name: string,
  body: unknown,
): Promise<TResponse> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("Your session expired. Please log in again.");
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & TResponse;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  return payload;
}
