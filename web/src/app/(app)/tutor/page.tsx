import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TutorChat } from "./tutor-chat";

export const metadata: Metadata = { title: "AI Tutor" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TutorPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; ask?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Student-only surface: the tutor is grounded in the student's documents.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role === "educator") redirect("/educator");

  const params = await searchParams;

  const [{ data: subjects }, { data: conversations }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name")
      .eq("student_id", user.id)
      .order("name"),
    supabase
      .from("tutor_conversations")
      .select("id, title, subject_id, updated_at")
      .eq("student_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(30),
  ]);

  const subjectList = subjects ?? [];
  // Deep-link support (?subject=&ask= from the roadmap): only accept a
  // subject the student actually owns.
  const requestedSubject =
    params.subject && UUID_RE.test(params.subject) &&
    subjectList.some((s) => s.id === params.subject)
      ? params.subject
      : null;

  return (
    <TutorChat
      subjects={subjectList}
      conversations={
        (conversations ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          subjectId: c.subject_id,
          updatedAt: c.updated_at,
        }))
      }
      initialSubjectId={requestedSubject}
      initialAsk={params.ask?.trim() || null}
    />
  );
}
