import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your subjects" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Direct-visit safety net on top of the middleware gating.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");

  const { count } = await supabase
    .from("subjects")
    .select("id", { count: "exact", head: true })
    .eq("student_id", user.id);

  if ((count ?? 0) > 0) redirect("/dashboard");

  return <OnboardingForm />;
}
