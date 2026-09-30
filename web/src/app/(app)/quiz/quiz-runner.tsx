"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckCircle2,
  FileText,
  ListChecks,
  RotateCcw,
  Trophy,
  Wand2,
  XCircle,
} from "lucide-react";
import { callEdgeFunction } from "@/lib/edge";
import { createClient } from "@/lib/supabase/client";
import { celebrate } from "@/components/ui/toast";
import { AuthError } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

type QuizSummary = {
  id: string;
  title: string;
  questionCount: number;
  attemptCount: number;
  bestScore: number | null;
};

type DocWithQuizzes = {
  id: string;
  title: string;
  quizzes: QuizSummary[];
};

type Letter = "A" | "B" | "C" | "D";
const LETTERS: Letter[] = ["A", "B", "C", "D"];

type LoadedQuestion = {
  id: string;
  question: string;
  options: Record<Letter, string>;
};

type ReviewQuestion = LoadedQuestion & {
  correct_answer: string;
  explanation: string | null;
};

type Results = {
  quizId: string;
  correct: number;
  total: number;
  review: ReviewQuestion[];
};

type Phase = "idle" | "taking" | "submitting" | "results";

export function QuizRunner({ documents }: { documents: DocWithQuizzes[] }) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizTitle, setQuizTitle] = useState("");
  const [questions, setQuestions] = useState<LoadedQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, Letter>>({});
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  function resetToDocs() {
    setPhase("idle");
    setQuizId(null);
    setQuizTitle("");
    setQuestions([]);
    setAnswers({});
    setResults(null);
    setError(null);
  }

  async function loadQuiz(id: string, title: string) {
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("quiz_questions")
        .select("id, question, options")
        .eq("quiz_id", id)
        .order("order_index", { ascending: true });

      if (error) throw new Error(error.message);

      const parsed = (data ?? []).map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options as Record<Letter, string>,
      }));
      if (parsed.length === 0) throw new Error("This quiz has no questions.");

      setQuizId(id);
      setQuizTitle(title);
      setQuestions(parsed);
      setAnswers({});
      setResults(null);
      setPhase("taking");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that quiz.");
    } finally {
      setBusy(false);
    }
  }

  async function generateQuiz(doc: DocWithQuizzes) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await callEdgeFunction<{ quizId?: string }>(
        "generate-study-materials",
        { documentId: doc.id, kind: "quiz" },
      );

      router.refresh();
      if (payload.quizId) {
        await loadQuiz(payload.quizId, `${doc.title} — quiz`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quiz generation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!quizId || phase !== "taking") return;
    setPhase("submitting");
    setError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("submit_quiz_attempt", {
        p_quiz_id: quizId,
        p_answers: answers,
      });

      if (error) throw new Error(error.message);

      const attempt = Array.isArray(data) ? data[0] : data;
      if (!attempt) throw new Error("Grading failed — please try again.");

      // Gamification: weighted XP (+ recovery bonus) and any new badge.
      celebrate(attempt);

      // Refetch with the answer key + explanations for the review screen.
      const { data: reviewRows, error: reviewError } = await supabase
        .from("quiz_questions")
        .select("id, question, options, correct_answer, explanation")
        .eq("quiz_id", quizId)
        .order("order_index", { ascending: true });

      if (reviewError) throw new Error(reviewError.message);

      setResults({
        quizId,
        correct: attempt.score,
        total: attempt.total,
        review: (reviewRows ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options as Record<Letter, string>,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
        })),
      });
      setPhase("results");
      router.refresh();
    } catch (e) {
      setPhase("taking");
      setError(e instanceof Error ? e.message : "Grading failed — please try again.");
    }
  }

  // ---------------------------------------------------------------- Idle: docs + their quizzes
  if (phase === "idle") {
    return (
      <div className="mx-auto max-w-[960px] space-y-8 animate-rise py-2">
        <header className="rounded-[16px] border border-[var(--border)] bg-gradient-to-r from-[var(--surface)] via-[var(--surface)] to-[var(--violet-pale)]/30 p-6 shadow-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--violet-pale)] px-3 py-1 text-xs font-semibold text-[var(--violet-dark)] mb-2">
            <ListChecks className="h-3.5 w-3.5" />
            Adaptive Quiz Center
          </span>
          <h1 className="font-fraunces text-[26px] font-bold text-[var(--ink)]">Document Quizzes</h1>
          <p className="mt-1 text-[14px] text-[var(--ink-soft)] leading-relaxed">
            Generate multiple-choice quizzes automatically from your uploaded notes. Missed questions are logged to your Error Journal for targeted review.
          </p>
        </header>

        <AuthError message={error} />

        {documents.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center text-sm text-[var(--ink-soft)] shadow-xs">
            No processed documents yet — upload a PDF in Documents first to create quizzes.
          </div>
        ) : (
          <ul className="space-y-5">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xs transition-all hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--teal-pale)] text-[var(--teal)] font-bold">
                      <FileText className="h-5 w-5" />
                    </span>
                    <span className="truncate text-base font-bold text-[var(--ink)]">{doc.title}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => generateQuiz(doc)}
                    disabled={busy}
                    className="btn-primary !px-4 !py-2 !text-xs !rounded-[10px] shadow-sm hover:shadow-md transition-all shrink-0"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Generate New Quiz
                  </button>
                </div>

                {doc.quizzes.length > 0 ? (
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {doc.quizzes.map((quiz) => (
                      <li key={quiz.id}>
                        <button
                          type="button"
                          onClick={() => loadQuiz(quiz.id, quiz.title)}
                          disabled={busy}
                          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)]/50 p-4 text-left transition-all hover:border-[var(--teal)] hover:bg-[var(--surface)] hover:shadow-xs disabled:opacity-60 group"
                        >
                          <span className="block truncate text-[14.5px] font-bold text-[var(--ink)] group-hover:text-[var(--teal)] transition-colors">
                            {quiz.title}
                          </span>
                          <div className="mt-2 flex items-center justify-between text-xs text-[var(--ink-soft)] font-medium">
                            <span>{quiz.questionCount} questions · {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? "" : "s"}</span>
                            {quiz.bestScore !== null ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 text-[10.5px]">
                                {quiz.bestScore}% Best
                              </span>
                            ) : (
                              <span className="text-[10.5px] text-[var(--ink-soft)] italic">Not taken yet</span>
                            )}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs font-medium text-[var(--ink-soft)] italic">
                    No quizzes generated yet for this document. Click &apos;Generate New Quiz&apos; above.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- Results
  if (phase === "results" && results) {
    const percent = results.total > 0
      ? Math.round((results.correct / results.total) * 100)
      : 0;
    return (
      <div className="mx-auto max-w-[800px] space-y-8 animate-rise py-4">
        <section className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm">
          <div
            className={cn(
              "mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] shadow-sm",
              percent >= 70
                ? "bg-[var(--teal-pale)] text-[var(--teal)]"
                : "bg-amber-100 text-amber-800",
            )}
          >
            {percent >= 70 ? (
              <Trophy className="h-8 w-8 text-[var(--teal)]" />
            ) : (
              <RotateCcw className="h-8 w-8 text-amber-700" />
            )}
          </div>
          <h1 className="mt-4 font-fraunces text-[28px] font-bold text-[var(--ink)]">
            {results.correct} / {results.total} Correct
          </h1>
          <p className="mt-1 text-[14.5px] font-semibold text-[var(--ink-soft)]">
            {quizTitle} · <span className="text-[var(--teal-dark)] font-bold">{percent}% Score</span>
          </p>
          {results.correct < results.total ? (
            <p className="mx-auto mt-2 max-w-md text-xs text-[var(--ink-soft)] leading-relaxed bg-[var(--bg)] px-4 py-2 rounded-[10px]">
              Missed items have been automatically recorded in your Error Journal with detailed explanation notes.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setAnswers({});
                setResults(null);
                setPhase("taking");
              }}
              className="btn-primary !px-5 !py-2.5 !text-xs !rounded-[10px] shadow-sm hover:shadow-md transition-all"
            >
              <RotateCcw className="h-4 w-4" />
              Retake Quiz
            </button>
            <button
              type="button"
              onClick={resetToDocs}
              className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold text-[var(--ink)] shadow-xs transition-colors hover:bg-[var(--bg)]"
            >
              Back to Quiz List
            </button>
          </div>
        </section>

        <section aria-label="Review" className="space-y-4">
          <h2 className="font-fraunces text-xl font-bold text-[var(--ink)]">Detailed Question Review</h2>
          {results.review.map((q, i) => {
            const given = answers[q.id];
            const correctLetter = q.correct_answer as Letter;
            const isRight = given === correctLetter;
            return (
              <div
                key={q.id}
                className={cn(
                  "rounded-[16px] border bg-[var(--surface)] p-6 shadow-xs",
                  isRight ? "border-emerald-200" : "border-rose-200 bg-rose-50/10",
                )}
              >
                <div className="flex items-start gap-3">
                  {isRight ? (
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-[var(--ink)]">
                      {i + 1}. {q.question}
                    </p>
                    <div className="mt-3 space-y-2 text-sm">
                      {LETTERS.map((letter) => {
                        const isCorrectLetter = letter === correctLetter;
                        const isGiven = letter === given;
                        return (
                          <div
                            key={letter}
                            className={cn(
                              "rounded-[10px] px-3.5 py-2.5 text-[13.5px] font-medium flex items-center justify-between border",
                              isCorrectLetter
                                ? "bg-emerald-50 border-emerald-300 font-bold text-emerald-900"
                                : isGiven
                                  ? "bg-rose-50 border-rose-200 text-rose-800"
                                  : "border-[var(--border)] text-[var(--ink-soft)] bg-[var(--surface)]",
                            )}
                          >
                            <span>
                              <span className="font-bold mr-1.5">{letter}.</span>
                              {q.options[letter]}
                            </span>
                            {isCorrectLetter ? (
                              <span className="text-emerald-700 font-bold text-xs">✓ Correct Answer</span>
                            ) : isGiven ? (
                              <span className="text-rose-600 font-bold text-xs">✗ Your Selection</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {!isRight && q.explanation ? (
                      <div className="mt-3 rounded-[10px] bg-[var(--teal-pale)]/50 p-3 text-xs leading-relaxed text-[var(--ink)] border border-[var(--teal)]/20">
                        <span className="font-bold text-[var(--teal-dark)]">Explanation: </span>
                        {q.explanation}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------- Taking
  return (
    <div className="mx-auto max-w-[800px] space-y-6 animate-rise py-2">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--teal)] uppercase tracking-wider mb-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Quiz in progress
          </span>
          <h1 className="truncate font-fraunces text-[24px] font-bold text-[var(--ink)]">{quizTitle}</h1>
          <p className="mt-1 text-xs font-semibold text-[var(--ink-soft)]">
            Answered {answeredCount} of {questions.length} questions
          </p>
        </div>
        <button
          type="button"
          onClick={resetToDocs}
          disabled={phase === "submitting"}
          className="rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink-soft)] shadow-xs transition-colors hover:bg-[var(--bg)] disabled:opacity-50"
        >
          Cancel Quiz
        </button>
      </header>

      <AuthError message={error} />

      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xs">
            <p className="text-[15.5px] font-bold text-[var(--ink)] leading-relaxed">
              {i + 1}. {q.question}
            </p>
            <fieldset className="mt-4 space-y-2.5">
              <legend className="sr-only">Answer for question {i + 1}</legend>
              {LETTERS.map((letter) => {
                const isSelected = answers[q.id] === letter;
                return (
                  <label
                    key={letter}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-[12px] border p-3.5 text-[14px] transition-all",
                      isSelected
                        ? "border-[var(--teal)] bg-[var(--teal-pale)]/50 shadow-xs font-semibold text-[var(--ink)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--teal)]/40 hover:bg-[var(--bg)] text-[var(--ink-soft)]",
                    )}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={letter}
                      checked={isSelected}
                      disabled={phase === "submitting"}
                      onChange={() =>
                        setAnswers((prev) => ({ ...prev, [q.id]: letter }))
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--teal)]"
                    />
                    <span>
                      <span className="font-bold mr-1.5">{letter}.</span> {q.options[letter]}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          onClick={submit}
          disabled={!allAnswered || phase === "submitting"}
          className="btn-primary !px-6 !py-3 !text-sm !rounded-[12px] shadow-sm hover:shadow-md transition-all disabled:opacity-40"
        >
          <ListChecks className="h-4 w-4" />
          {phase === "submitting" ? "Grading Answers…" : "Submit Quiz"}
        </button>
        <p className="text-xs font-semibold text-[var(--ink-soft)]">
          {allAnswered
            ? "Ready! Server will grade your attempt instantly."
            : `Please answer all ${questions.length} questions to enable submission (${answeredCount}/${questions.length} completed).`}
        </p>
      </div>
    </div>
  );
}
