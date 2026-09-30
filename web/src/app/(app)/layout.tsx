import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated app shell (spec section 7): persistent left sidebar +
 * scrollable content area. Auth and onboarding pages live outside this
 * group; navigation is role-aware (students/educators see different
 * sections per spec section 4).
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase.from("profiles").select("role").eq("id", user.id).single()
      ).data
    : null;

  const role = profile?.role === "educator" ? "educator" : "student";

  return <AppShell role={role}>{children}</AppShell>;
}
