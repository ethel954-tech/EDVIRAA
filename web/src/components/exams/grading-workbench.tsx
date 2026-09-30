"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Sparkles, Users, X } from "lucide-react";
import { callEdgeFunction } from "@/lib/edge";
import { createClient } from "@/lib/supabase/client";
import { AuthError, FieldLabel, SubmitButton } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type Submission = {
  attemptId: string;
  studentName: string;
  score: number;
  total: number;
  submittedAt: string;
  finalGrade: number | null;
  finalFeedback: string | null;
  gradedAt: string | null;
};

type Suggestion = {
  attemptId: string;
  studentName: string;
  machineScore: number;
  maxPoints: number;
  suggestedGrade: number;
  suggestedFeedback: string;
};

function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  onAccept: (grade: number, feedback: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mt-3 rounded-card border border-secondary-200 bg-secondary-50 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-secondary-700">
        <Sparkles className="h-3.5 w-3.5" /> AI suggestion
      </p>
      <p className="mt-2 text-sm text-ink">
        Grade: <span className="font-semibold">{suggestion.suggestedGrade}</span>
        <span className="text-ink/50"> / {suggestion.maxPoints}</span>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
        {suggestion.suggestedFeedback}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() =>
            onAccept(suggestion.suggestedGrade, suggestion.suggestedFeedback)
          }
          className="flex items-center gap-1.5 rounded-btn bg-secondary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-secondary-700"
        >
          <Check className="h-3.5 w-3.5" /> Use this
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex items-center gap-1.5 rounded-btn border border-secondary-200 px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-surface"
        >
          <X className="h-3.5 w-3.5" /> Dismiss
        </button>
      </div>
    </div>
  );
}

function GradeForm({
  submission,
  maxPoints,
}: {
  submission: Submission;
  maxPoints: number;
}) {
  const router = useRouter();
  const [grade, setGrade] = useState(
    submission.finalGrade !== null ? String(submission.finalGrade) : String(submission.score),
  );
  const [feedback, setFeedback] = useState(submission.finalFeedback ?? "");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    if (suggesting) return;
    setError(null);
    setSuggesting(true);
    try {
      const data = await callEdgeFunction<Suggestion>("suggest-exam-feedback", {
        attemptId: submission.attemptId,
      });
      setSuggestion(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get an AI suggestion.");
    } finally {
      setSuggesting(false);
    }
  }

  async function finalize(e: React.FormEvent) {
    e.preventDefault();
    if (finalizing) return;
    setError(null);
    setSaved(false);

    const g = Math.round(Number(grade));
    if (!Number.isFinite(g) || g < 0 || g > maxPoints) {
      setError(`Grade must be between 0 and ${maxPoints}.`);
      return;
    }

    setFinalizing(true);
    try {
      const supabase = createClient();
      const { error: rpcErr } = await supabase.rpc("finalize_exam_grade", {
        p_attempt_id: submission.attemptId,
        p_grade: g,
        p_feedback: feedback,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the grade.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <form onSubmit={finalize} className="rounded-card border border-primary-100 bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-ink">{submission.studentName}</p>
        <p className="shrink-0 text-sm text-ink/50">
          auto-graded {submission.score}/{submission.total}
          {submission.finalGrade !== null ? (
            <span
              className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-xs font-semibold",
                saved ? "bg-primary-50 text-primary-700" : "bg-secondary-50 text-secondary-700",
              )}
            >
              final {submission.finalGrade}
            </span>
          ) : null}
        </p>
      </div>

      <AuthError message={error} />

      {suggestion && suggestion.attemptId === submission.attemptId ? (
        <SuggestionCard
          suggestion={suggestion}
          onAccept={(g, f) => {
            setGrade(String(g));
            setFeedback(f);
            setSuggestion(null);
          }}
          onDismiss={() => setSuggestion(null)}
        />
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
        <div>
          <FieldLabel htmlFor={`grade-${submission.attemptId}`}>
            Final grade
          </FieldLabel>
          <input
            id={`grade-${submission.attemptId}`}
            type="number"
            min={0}
            max={maxPoints}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="h-10 w-full rounded-btn border border-primary-200 bg-surface px-3 text-sm text-ink focus:border-primary-400 focus:outline-none"
          />
        </div>
        <div>
          <FieldLabel htmlFor={`feedback-${submission.attemptId}`}>
            Feedback to the student
          </FieldLabel>
          <textarea
            id={`feedback-${submission.attemptId}`}
            value={feedback}
            rows={3}
            maxLength={2000}
            placeholder="What they did well, what to review next…"
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full rounded-btn border border-primary-200 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-primary-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SubmitButton busy={finalizing} disabled={finalizing}>
          {submission.finalGrade !== null ? "Update final grade" : "Finalize grade"}
        </SubmitButton>
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting}
          className="flex items-center gap-1.5 rounded-btn border border-secondary-200 px-3 py-2 text-sm font-medium text-secondary-700 transition-colors hover:bg-secondary-50 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {suggesting ? "Thinking…" : suggestion ? "Re-suggest" : "Suggest with AI"}
        </button>
        {saved ? (
          <span className="flex items-center gap-1 text-xs font-medium text-primary-700">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function GradingWorkbench({
  examTitle,
  roomName,
  maxPoints,
  submissions,
}: {
  examTitle: string;
  roomName: string;
  maxPoints: number;
  submissions: Submission[];
}) {
  return (
    <div className="space-y-6">
      <header>
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Users className="h-4 w-4 text-primary-600" />
          Grading · <span className="font-medium text-ink">{examTitle}</span>
          <span className="text-ink/40">· {roomName}</span>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Submissions</h1>
        <p className="mt-1 text-sm text-ink/60">
          Auto-graded scores below. Accept an AI feedback suggestion or write
          your own, then finalize the grade the student sees.
        </p>
      </header>

      {submissions.length === 0 ? (
        <p className="rounded-card border border-dashed border-primary-200 px-4 py-12 text-center text-sm text-ink/50">
          No submissions yet.
        </p>
      ) : (
        <div className="space-y-4">
          {submissions.map((s) => (
            <GradeForm key={s.attemptId} submission={s} maxPoints={maxPoints} />
          ))}
        </div>
      )}
    </div>
  );
}
