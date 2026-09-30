import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EducatorOnboardingForm } from "./educator-onboarding-form";

export const metadata: Metadata = { title: "Set up your educator profile" };

export default async function EducatorOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Direct-visit safety net on top of the middleware gating: educators only.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, subject_area")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "educator") redirect("/dashboard");

  const { data: profileName } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // Already set up: middleware normally handles this; belt and braces.
  if (typeof profile.subject_area === "string") redirect("/educator");

  return (
    <EducatorOnboardingForm
      defaultDisplayName={profileName?.display_name ?? ""}
    />
  );
}
