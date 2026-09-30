import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Choose your role" };

export default async function RolePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Reached directly without a session (or mid sign-out): start over.
  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Google signups land here with role = NULL ("pending"). Anyone whose role
  // is already locked has nothing to finalize.
  if (profile?.role) redirect("/dashboard");

  return <RoleForm />;
}
