import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExamBuilder, type ExamQuestionDraft } from "@/components/exams/exam-builder";

export const metadata: Metadata = { title: "Edit exam" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditExamPage({
  params,
}: {
  params: Promise<{ "exam-id": string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { "exam-id": examId } = await params;
  if (!UUID_RE.test(examId)) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "educator") redirect("/dashboard");

  // RLS: only the creator can select the exam row here.
  const { data: exam } = await supabase
    .from("exams")
    .select("id, room_id, created_by, title, description")
    .eq("id", examId)
    .single();
  if (!exam || exam.created_by !== user.id) notFound();

  const [{ data: roomRow }, { data: questions }] = await Promise.all([
    supabase.from("rooms").select("name").eq("id", exam.room_id).single(),
    supabase
      .from("exam_questions")
      .select("id, kind, prompt, options, answer_key, points, order_index")
      .eq("exam_id", examId)
      .order("order_index", { ascending: true }),
  ]);

  const drafts: ExamQuestionDraft[] = (questions ?? []).map((q) => ({
    // Existing DB id doubles as the client key; retyped questions keep their
    // identity only within this editing session.
    id: q.id,
    kind: q.kind === "multiple_choice" ? "multiple_choice" : "short_answer",
    prompt: q.prompt,
    options: Array.isArray(q.options)
      ? (q.options as { key: string; text: string }[]).map((o) => o.text)
      : [],
    answerKey: q.answer_key,
    points: q.points,
  }));

  return (
    <ExamBuilder
      roomId={exam.room_id}
      roomName={roomRow?.name ?? "Room"}
      exam={{
        id: exam.id,
        title: exam.title,
        description: exam.description,
        questions: drafts,
      }}
    />
  );
}
