import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  GradingWorkbench,
  type Submission,
} from "@/components/exams/grading-workbench";

export const metadata: Metadata = { title: "Grade exam" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GradeExamPage({
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

  // Creator-only (RLS would 404 non-creators anyway).
  const { data: exam } = await supabase
    .from("exams")
    .select("id, room_id, created_by, title")
    .eq("id", examId)
    .single();
  if (!exam || exam.created_by !== user.id) notFound();

  const [{ data: roomRow }, { data: questions }, { data: attempts }] =
    await Promise.all([
      supabase.from("rooms").select("name").eq("id", exam.room_id).single(),
      supabase
        .from("exam_questions")
        .select("points")
        .eq("exam_id", examId),
      supabase
        .from("exam_attempts")
        .select(
          "id, student_id, score, total, submitted_at, final_grade, final_feedback, graded_at, profiles(display_name)",
        )
        .eq("exam_id", examId)
        .order("submitted_at", { ascending: false }),
    ]);

  const maxPoints = (questions ?? []).reduce((s, q) => s + (q.points ?? 0), 0);

  const submissions: Submission[] = (attempts ?? []).map((a) => {
    const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
    return {
      attemptId: a.id,
      studentName: p?.display_name ?? "Student",
      score: a.score,
      total: a.total,
      submittedAt: a.submitted_at,
      finalGrade: a.final_grade,
      finalFeedback: a.final_feedback,
      gradedAt: a.graded_at,
    };
  });

  return (
    <GradingWorkbench
      examTitle={exam.title}
      roomName={roomRow?.name ?? "Room"}
      maxPoints={maxPoints}
      submissions={submissions}
    />
  );
}
