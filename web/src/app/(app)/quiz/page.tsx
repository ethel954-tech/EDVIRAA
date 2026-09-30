import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuizRunner } from "./quiz-runner";

export const metadata: Metadata = { title: "Quiz" };

export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; subject?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Student-only surface.
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
    .select(
      "id, title, subject_id, status, quizzes(id, title, created_at, quiz_questions(count), quiz_attempts(score, created_at))",
    )
    .eq("student_id", user.id)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const docs = (documents ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    subjectId: d.subject_id,
    quizzes: (d.quizzes ?? [])
      .map((q) => {
        const attempts = (q.quiz_attempts ?? []).map((a) => a.score);
        const questionCount = Array.isArray(q.quiz_questions)
          ? (q.quiz_questions[0]?.count ?? 0)
          : 0;
        return {
          id: q.id,
          title: q.title,
          questionCount,
          attemptCount: attempts.length,
          bestScore: attempts.length > 0 ? Math.max(...attempts) : null,
        };
      })
      .sort((a, b) => (a.title < b.title ? -1 : 1)),
  }));

  // Deep-link support (?doc= / ?subject= from the roadmap): focus the suggested
  // document by pre-sorting it to the top of the list.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requestedDoc =
    params.doc && UUID_RE.test(params.doc)
      ? params.doc
      : null;
  const requestedSubject =
    params.subject && UUID_RE.test(params.subject) ? params.subject : null;
  const focusDocId =
    (requestedDoc && docs.some((d) => d.id === requestedDoc) && requestedDoc) ||
    docs.find((d) => requestedSubject && d.subjectId === requestedSubject)?.id ||
    null;
  const sortedDocs = focusDocId
    ? [...docs].sort((a, b) => (a.id === focusDocId ? -1 : b.id === focusDocId ? 1 : 0))
    : docs;

  return <QuizRunner documents={sortedDocs} />;
}
