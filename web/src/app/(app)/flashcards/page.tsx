import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FlashcardStudy } from "./flashcard-study";

export const metadata: Metadata = { title: "Flashcards" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; subject?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Student-only surface (educators don't upload study materials).
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role === "educator") redirect("/educator");

  const params = await searchParams;

  const { data: documents } = await supabase
    .from("documents")
    .select("id, title, subject_id, flashcards(count)")
    .eq("student_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const docs = (documents ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    subjectId: d.subject_id,
    cardCount: Array.isArray(d.flashcards) ? (d.flashcards[0]?.count ?? 0) : 0,
  }));

  // Deep-link support (?doc= from the roadmap): ownership validated here.
  const validDocIds = new Set(docs.map((d) => d.id));
  const requestedDoc =
    params.doc && UUID_RE.test(params.doc) && validDocIds.has(params.doc)
      ? params.doc
      : null;
  // Fallback: first ready document of the preselected subject (?subject=).
  const requestedSubject =
    params.subject && UUID_RE.test(params.subject) ? params.subject : null;
  const preselect =
    requestedDoc ??
    docs.find((d) => requestedSubject && d.subjectId === requestedSubject)?.id ??
    null;

  return <FlashcardStudy documents={docs} initialDocId={preselect} />;
}
