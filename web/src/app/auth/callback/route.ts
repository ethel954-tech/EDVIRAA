import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth + email-confirmation landing point (spec section 4).
 *
 * Google redirects here with ?code=..., which we exchange for a session.
 * Email confirmation links (only if the project enables it) arrive as a
 * hash fragment that supabase-js verifies client-side via the detectSessionInUrl
 * default — this route handles the code-exchange side only.
 *
 * Where the user goes next is decided by middleware: profiles without a
 * role (Google signups) are sent to /auth/role, everyone else onward.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  // Only allow same-app redirects (open-redirect protection).
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//")
    ? rawNext
    : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Middleware re-evaluates profile state on this navigation and
      // reroutes to /auth/role when the role is still pending.
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Missing/invalid code (expired, replayed, or misconfigured provider).
  return NextResponse.redirect(
    `${origin}/auth/login?error=auth_callback_failed`,
  );
}
