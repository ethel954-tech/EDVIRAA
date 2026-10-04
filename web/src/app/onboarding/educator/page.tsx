import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EducatorOnboardingForm } from "./educator-onboarding-form";

export const metadata: Metadata = { title: "Educator verification" };

export default async function EducatorOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Direct-visit safety net on top of the middleware gating: educators only.
  const [{ data: profile }, { data: verification }] = await Promise.all([
    supabase
    .from("profiles")
    .select("role, subject_area, display_name")
    .eq("id", user.id)
    .single(),
    supabase
      .from("educator_verifications")
      .select("educator_verification_status, educator_submitted_at, educator_institution, educator_work_email, educator_review_note")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "educator") redirect("/dashboard");

  if (verification?.educator_verification_status === "verified") redirect("/educator");
  if (
    verification?.educator_verification_status === "pending" &&
    verification.educator_submitted_at
  ) {
    redirect("/educator/pending");
  }

  return (
    <EducatorOnboardingForm
      defaultDisplayName={profile.display_name ?? ""}
      defaultSubjectArea={profile.subject_area ?? ""}
      defaultInstitution={verification?.educator_institution ?? ""}
      defaultWorkEmail={verification?.educator_work_email ?? ""}
      rejectionNote={
        verification?.educator_verification_status === "rejected"
          ? verification.educator_review_note
          : null
      }
    />
  );
}
