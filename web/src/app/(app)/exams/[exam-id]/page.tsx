import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardList, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamTake, type ReviewQuestion, type TakeQuestion } from "@/components/exams/exam-take";

export const metadata: Metadata = { title: "Exam" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ExamPage({
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

  // RLS: members of the exam's room (incl. the creator) can select it.
  const { data: exam } = await supabase
    .from("exams")
    .select("id, room_id, created_by, title, description")
    .eq("id", examId)
    .single();
  if (!exam) notFound();

  const { data: roomRow } = await supabase
    .from("rooms")
    .select("name")
    .eq("id", exam.room_id)
    .single();

  // ------------------------------------------------------------- Educator view
  if (exam.created_by === user.id) {
    const [{ data: questions }, { data: attempts }] = await Promise.all([
      supabase
        .from("exam_questions")
        .select("id, points")
        .eq("exam_id", examId)
        .order("order_index", { ascending: true }),
      supabase
        .from("exam_attempts")
        .select("id, student_id, score, total, submitted_at, profiles(display_name)")
        .eq("exam_id", examId)
        .order("submitted_at", { ascending: false }),
    ]);

    const totalPoints = (questions ?? []).reduce((s, q) => s + (q.points ?? 0), 0);

    return (
      <article className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="flex items-center gap-2 text-sm text-ink/60">
            <ClipboardList className="h-4 w-4 text-primary-600" />
            Exam · <span className="font-medium text-ink">{roomRow?.name ?? "Room"}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{exam.title}</h1>
          {exam.description ? (
            <p className="mt-1 text-sm text-ink/60">{exam.description}</p>
          ) : null}
          <p className="mt-2 text-sm text-ink/50">
            {questions?.length ?? 0} questions · {totalPoints} points ·{" "}
            {attempts?.length ?? 0} submissions
          </p>
        </header>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/exams/${examId}/grade`}
            className="rounded-btn bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
          >
            Grade submissions
          </Link>
          <Link
            href={`/exams/${examId}/edit`}
            className="rounded-btn border border-primary-200 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-primary-50"
          >
            Edit exam
          </Link>
        </div>

        <section className="rounded-card border border-primary-100 bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink/50">
            <Users className="h-4 w-4" /> Submissions
          </h2>
          {attempts && attempts.length > 0 ? (
            <ul className="mt-3 divide-y divide-primary-100">
              {attempts.map((a) => {
                const p = Array.isArray(a.profiles) ? a.profiles[0] : a.profiles;
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium text-ink">
                      {p?.display_name ?? "Student"}
                    </span>
                    <span className="shrink-0 text-ink/60">
                      {a.score}/{a.total} ·{" "}
                      {new Date(a.submitted_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink/50">
              No submissions yet — students take the exam from the room sidebar.
            </p>
          )}
        </section>
      </article>
    );
  }

  // -------------------------------------------------------------- Student view
  const [{ data: safeQuestions, error: qErr }, { data: attemptRow }, { data: review }] =
    await Promise.all([
      supabase.rpc("get_exam_questions", { p_exam_id: examId }),
      supabase
        .from("exam_attempts")
        .select("id, score, total, submitted_at")
        .eq("exam_id", examId)
        .eq("student_id", user.id)
        .maybeSingle(),
      supabase.rpc("get_exam_review", { p_exam_id: examId }),
    ]);

  if (qErr || !safeQuestions) notFound();

  // Untyped DB until codegen: pin the RPC row shapes explicitly.
  const safeRows = (safeQuestions ?? []) as Array<{
    id: string;
    kind: string;
    prompt: string;
    options: unknown;
    points: number;
  }>;
  const reviewRows = (review ?? []) as Array<{
    question_id: string;
    kind: string;
    prompt: string;
    options: unknown;
    points: number;
    my_answer: string | null;
    is_correct: boolean | null;
    correct_answer: string | null;
  }>;

  const takeQuestions: TakeQuestion[] = safeRows.map((q) => ({
    id: q.id,
    kind: q.kind === "multiple_choice" ? "multiple_choice" : "short_answer",
    prompt: q.prompt,
    points: q.points,
    options: Array.isArray(q.options)
      ? (q.options as { key: string; text: string }[])
      : [],
  }));

  // A non-empty review result means an attempt exists (retakes replace, so at
  // most one). get_exam_review returns my_answer/is_correct/correct_answer.
  const reviewQuestions: ReviewQuestion[] =
    attemptRow && reviewRows.length > 0
      ? reviewRows.map((r) => ({
          id: r.question_id,
          kind: r.kind === "multiple_choice" ? "multiple_choice" : "short_answer",
          prompt: r.prompt,
          points: r.points,
          options: Array.isArray(r.options)
            ? (r.options as { key: string; text: string }[])
            : [],
          myAnswer: r.my_answer ?? "",
          isCorrect: r.is_correct ?? false,
          correctAnswer: r.correct_answer ?? "",
        }))
      : [];

  return (
    <ExamTake
      examId={exam.id}
      title={exam.title}
      description={exam.description}
      roomName={roomRow?.name ?? "Room"}
      questions={takeQuestions}
      attempt={
        attemptRow
          ? {
              score: attemptRow.score,
              total: attemptRow.total,
              submittedAt: attemptRow.submitted_at,
            }
          : null
      }
      review={reviewQuestions}
    />
  );
}
