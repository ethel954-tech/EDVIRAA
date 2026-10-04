import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LOGIN = "/auth/login";
const SIGN_UP = "/auth/sign-up";
const ROLE = "/auth/role";
const ONBOARDING = "/onboarding";
const EDUCATOR_ONBOARDING = "/onboarding/educator";
const EDUCATOR_PENDING = "/educator/pending";
const HOME_BY_ROLE = { student: "/dashboard", educator: "/educator", admin: "/admin" } as const;

const AUTH_PAGES = [LOGIN, SIGN_UP];

/**
 * Refreshes the Supabase auth cookie on every request and routes by
 * auth/profile state (spec sections 4 + 7):
 *
 *   logged out                    -> /auth/* allowed, everything else to /auth/login
 *   logged in, role NULL          -> Google signup that hasn't picked a role yet:
 *                                    everything goes to /auth/role
 *   logged in, student, no subjects-> locked to /onboarding (spec section 4:
 *                                    role -> subject selection -> roadmap)
 *   logged in, educator, no setup -> locked to /onboarding/educator (name +
 *                                    subject area), then the educator dashboard
 *   logged in, otherwise set up   -> /auth/* and /dashboard sent to the role's
 *                                    home, app pages allowed
 */
export async function updateSession(request: NextRequest) {
  // App shell and public pages work before Supabase is configured;
  // once .env.local exists this always runs.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and this call —
  // getUser() is what triggers the token refresh and re-issues cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /** Copy any refreshed auth cookies onto a redirect response. */
  function redirectPreservingCookies(path: string) {
    const url = request.nextUrl.clone();
    url.search = "";
    url.pathname = path;
    const response = NextResponse.redirect(url);
    for (const { name, value } of supabaseResponse.cookies.getAll()) {
      response.cookies.set(name, value);
    }
    return response;
  }

  const { pathname } = request.nextUrl;
  const isAuthPage = AUTH_PAGES.some((p) => pathname.startsWith(p));

  // The OAuth/email code-exchange endpoint must never be gated: at this
  // point the visitor may not have a session yet — that's the whole point.
  if (pathname.startsWith("/auth/callback")) {
    return supabaseResponse;
  }

  // Signed out: only the auth pages are public.
  if (!user) {
    if (isAuthPage) return supabaseResponse;
    const target =
      pathname === "/" ? "/dashboard" : pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = LOGIN;
    url.search = "";
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  // Signed in: a NULL role means the account exists but the one-time role
  // choice hasn't been made (Google SSO signups). Lock them to /auth/role.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Generated database types aren't wired up yet; pin the role enum here.
  const userRole = profile?.role as "student" | "educator" | "admin" | undefined;

  if (!userRole) {
    if (pathname === ROLE) return supabaseResponse;
    return redirectPreservingCookies(ROLE);
  }

  // Role-specific onboarding and home routing (spec section 4).
  if (userRole === "student") {
    // Students with no subjects yet go through onboarding. They may only
    // leave once at least one subject exists — enforced here on every
    // request, not just at the end of the onboarding form.
    const { count, error: subjectsError } = await supabase
      .from("subjects")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id);

    const hasSubjects = !subjectsError && (count ?? 0) > 0;

    if (!hasSubjects && pathname !== ONBOARDING) {
      return redirectPreservingCookies(ONBOARDING);
    }
    if (hasSubjects && pathname === ONBOARDING) {
      return redirectPreservingCookies(HOME_BY_ROLE.student);
    }
  } else if (userRole === "educator") {
    // Educators must submit evidence and be approved before any educator
    // tools are reachable. Rejected or not-yet-submitted applicants return
    // to the application form; submitted applicants see the pending page.
    const { data: setup, error: setupError } = await supabase
      .from("educator_verifications")
      .select("educator_verification_status, educator_submitted_at")
      .eq("user_id", user.id)
      .single();

    const isVerified =
      !setupError && setup?.educator_verification_status === "verified";
    const isPending =
      !setupError &&
      setup?.educator_verification_status === "pending" &&
      Boolean(setup.educator_submitted_at);

    if (isVerified && (pathname === EDUCATOR_ONBOARDING || pathname === EDUCATOR_PENDING)) {
      return redirectPreservingCookies(HOME_BY_ROLE.educator);
    }
    if (!isVerified) {
      const requiredPath = isPending ? EDUCATOR_PENDING : EDUCATOR_ONBOARDING;
      if (pathname !== requiredPath) return redirectPreservingCookies(requiredPath);
    }
    // Student-only flow: educators never see the subject picker.
    if (pathname === ONBOARDING) {
      return redirectPreservingCookies(HOME_BY_ROLE.educator);
    }
  } else if (userRole === "admin") {
    if (pathname === ONBOARDING || pathname === EDUCATOR_ONBOARDING) {
      return redirectPreservingCookies(HOME_BY_ROLE.admin);
    }
  }

  // Fully set-up account: keep them out of the auth pages and send them to
  // their role's home (educators to the educator dashboard, not /dashboard).
  if (isAuthPage) {
    return redirectPreservingCookies(HOME_BY_ROLE[userRole]);
  }

  // /dashboard is the post-login landing spot (LoginForm pushes it): route
  // it by role so educators land in their own dashboard instead.
  if (pathname === "/dashboard" && (userRole === "educator" || userRole === "admin")) {
    return redirectPreservingCookies(HOME_BY_ROLE[userRole]);
  }

  return supabaseResponse;
}
