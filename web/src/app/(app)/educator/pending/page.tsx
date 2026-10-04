import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock3, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Educator verification" };

export default async function EducatorVerificationPendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const [{ data: profile }, { data: verification }] = await Promise.all([
    supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single(),
    supabase
      .from("educator_verifications")
      .select("educator_verification_status, educator_submitted_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  if (profile?.role !== "educator") redirect("/dashboard");
  if (verification?.educator_verification_status === "verified") redirect("/educator");
  if (!verification?.educator_submitted_at) redirect("/onboarding/educator");

  return (
    <div className="mx-auto flex min-h-full max-w-[760px] items-center px-5 py-12">
      <section className="w-full border-l-4 border-[var(--amber)] bg-[var(--surface)] px-6 py-8 sm:px-9">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--amber)]/15 text-[var(--amber)]">
          <Clock3 className="h-6 w-6" />
        </div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--amber)]">
          Verification in progress
        </p>
        <h1 className="font-fraunces text-[28px] font-semibold text-[var(--ink)]">
          Your educator application is under review
        </h1>
        <p className="mt-3 max-w-[560px] text-[14px] leading-6 text-[var(--ink-soft)]">
          Educator tools will become available after an administrator reviews your institution details and supporting document.
        </p>
        <div className="mt-6 flex items-center gap-2 border-t border-[var(--border)] pt-4 text-[12px] text-[var(--ink-soft)]">
          <ShieldCheck className="h-4 w-4 text-[var(--teal)]" />
          Your evidence is private and visible only to you and authorized administrators.
        </div>
      </section>
    </div>
  );
}
