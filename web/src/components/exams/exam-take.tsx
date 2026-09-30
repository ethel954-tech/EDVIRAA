"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ClipboardList, RotateCcw, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { celebrate } from "@/components/ui/toast";
import { AuthError, SubmitButton, TextInput } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type TakeQuestion = {
  id: string;
  kind: "multiple_choice" | "short_answer";
  prompt: string;
  points: number;
  options: { key: string; text: string }[];
};

export type ReviewQuestion = TakeQuestion & {
  myAnswer: string;
  isCorrect: boolean;
  correctAnswer: string;
};

type SubmitResult = {
  attempt_id?: string;
  score?: number;
  total?: number;
  xp_awarded?: number | null;
  new_badges?: unknown;
};

export function ExamTake({
  examId,
  title,
  description,
  roomName,
  questions,
  attempt,
  review,
}: {
  examId: string;
  title: string;
  description: string;
  roomName: string;
  questions: TakeQuestion[];
  attempt: { score: number; total: number; submittedAt: string } | null;
  review: ReviewQuestion[];
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // Retake = local mode switch; the RPC replaces the stored attempt.
  const [retaking, setRetaking] = useState(false);

  const showReview = attempt !== null && review.length > 0 && !retaking;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const unanswered = questions.filter((q) => !answers[q.id]?.trim());
    if (unanswered.length > 0) {
      setError(`${unanswered.length} question${unanswered.length > 1 ? "s" : ""} left unanswered — you can still submit.`);
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("submit_exam_attempt", {
        p_exam_id: examId,
        p_answers: answers,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      // XP + badge toasts (graded server-side).
      celebrate(row);
      setResult(row ?? null);
      setRetaking(false);
      // Re-sync with the server (attempt row + review become available).
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit the exam.");
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------------ Review
  if (showReview) {
    return (
      <article className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="flex items-center gap-2 text-sm text-ink/60">
            <ClipboardList className="h-4 w-4 text-primary-600" />
            Exam · <span className="font-medium text-ink">{roomName}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1>
          <div className="mt-3 inline-flex items-baseline gap-2 rounded-card border border-primary-100 bg-surface px-4 py-2">
            <span className="text-3xl font-semibold text-primary-700">{attempt.score}</span>
            <span className="text-ink/50">/ {attempt.total} points</span>
          </div>
          {result && typeof result.xp_awarded === "number" && result.xp_awarded > 0 ? (
            <p className="mt-2 text-sm font-medium text-secondary-700">
              +{result.xp_awarded} XP earned
            </p>
          ) : null}
        </header>

        <ol className="space-y-4">
          {review.map((q, i) => (
            <li key={q.id} className="rounded-card border border-primary-100 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-ink">
                  <span className="mr-2 text-ink/40">Q{i + 1}</span>
                  {q.prompt}
                </p>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                    q.isCorrect
                      ? "bg-primary-50 text-primary-700"
                      : "bg-accent-50 text-accent-700",
                  )}
                >
                  {q.isCorrect ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {q.points} pt{q.points === 1 ? "" : "s"}
                </span>
              </div>

              <div className="mt-3 space-y-1.5 text-sm">
                <p className="text-ink/70">
                  Your answer:{" "}
                  <span className={q.isCorrect ? "font-medium text-primary-700" : "font-medium text-accent-700"}>
                    {q.myAnswer || "— blank —"}
                  </span>
                </p>
                {!q.isCorrect ? (
                  <p className="text-ink/70">
                    Correct: <span className="font-medium text-primary-700">{q.correctAnswer}</span>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => setRetaking(true)}
          className="flex items-center gap-2 text-sm font-medium text-ink/60 hover:text-ink hover:underline"
        >
          <RotateCcw className="h-4 w-4" /> Retake exam (replaces your previous attempt)
        </button>
      </article>
    );
  }

  // ------------------------------------------------------------- Take/retake
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <ClipboardList className="h-4 w-4 text-primary-600" />
          Exam · <span className="font-medium text-ink">{roomName}</span>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink/60">{description}</p> : null}
        {attempt && !retaking ? (
          <p className="mt-2 rounded-card border border-primary-100 bg-surface px-4 py-2 text-sm text-ink/60">
            You scored <span className="font-semibold text-ink">{attempt.score}/{attempt.total}</span>{" "}
            on your last attempt — retaking replaces it.
          </p>
        ) : null}
      </header>

      <AuthError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <li key={q.id} className="rounded-card border border-primary-100 bg-surface p-4">
              <p className="text-sm font-medium text-ink">
                <span className="mr-2 text-ink/40">Q{i + 1}</span>
                {q.prompt}
                <span className="ml-2 text-xs text-ink/40">
                  ({q.points} pt{q.points === 1 ? "" : "s"})
                </span>
              </p>

              {q.kind === "multiple_choice" ? (
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((opt) => {
                    const selected = answers[q.id] === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.key }))}
                        className={cn(
                          "flex items-center gap-2.5 rounded-btn border px-3 py-2 text-left text-sm transition-colors",
                          selected
                            ? "border-primary-500 bg-primary-50 text-primary-800"
                            : "border-primary-100 text-ink hover:bg-surface-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                            selected
                              ? "border-primary-600 bg-primary-600 text-white"
                              : "border-primary-200 text-ink/50",
                          )}
                        >
                          {opt.key}
                        </span>
                        <span className="min-w-0 flex-1">{opt.text}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3">
                  <TextInput
                    value={answers[q.id] ?? ""}
                    maxLength={2000}
                    placeholder="Type your answer…"
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                    }
                    aria-label={`Answer to question ${i + 1}`}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>

        {questions.length === 0 ? (
          <p className="rounded-card border border-dashed border-primary-200 px-4 py-10 text-center text-sm text-ink/50">
            This exam has no questions yet.
          </p>
        ) : (
          <SubmitButton busy={submitting} disabled={submitting}>
            {attempt ? "Retake — submit new answers" : "Submit exam"}
          </SubmitButton>
        )}
      </form>
    </article>
  );
}
