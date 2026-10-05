"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ClipboardList,
  GripVertical,
  Plus,
  TextCursorInput,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthError, SubmitButton } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type ExamQuestionDraft = {
  id: string; // client-side key
  kind: "multiple_choice" | "short_answer";
  prompt: string;
  options: string[];
  answerKey: string;
  points: number;
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function emptyQuestion(kind: ExamQuestionDraft["kind"]): ExamQuestionDraft {
  return {
    id: crypto.randomUUID(),
    kind,
    prompt: "",
    options: kind === "multiple_choice" ? ["", "", "", ""] : [],
    answerKey: "",
    points: 1,
  };
}

export function ExamBuilder({
  roomId,
  roomName,
  exam,
}: {
  roomId: string;
  roomName: string;
  exam: {
    id: string;
    title: string;
    description: string;
    questions: ExamQuestionDraft[];
  } | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(exam?.title ?? "");
  const [description, setDescription] = useState(exam?.description ?? "");
  const [questions, setQuestions] = useState<ExamQuestionDraft[]>(
    exam?.questions ?? [emptyQuestion("multiple_choice")],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalPoints = useMemo(
    () => questions.reduce((s, q) => s + (Number.isFinite(q.points) ? q.points : 0), 0),
    [questions],
  );

  function updateQuestion(id: string, next: Partial<ExamQuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...next } : q)));
  }

  function moveQuestion(index: number, dir: -1 | 1) {
    setQuestions((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  function setOption(qid: string, idx: number, value: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qid
          ? { ...q, options: q.options.map((o, i) => (i === idx ? value : o)) }
          : q,
      ),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (title.trim().length === 0) {
      setError("Give the exam a title.");
      return;
    }

    const mc = questions.filter((q) => q.kind === "multiple_choice");
    if (mc.some((q) => q.prompt.trim() === "" || q.options.some((o) => o.trim() === "") || q.answerKey === "")) {
      setError("Every multiple-choice question needs a prompt, all its options filled, and a correct answer marked.");
      return;
    }
    if (questions.some((q) => q.kind === "short_answer" && (q.prompt.trim() === "" || q.answerKey.trim() === ""))) {
      setError("Every short-answer question needs a prompt and an expected answer.");
      return;
    }
    if (questions.length === 0) {
      setError("Add at least one question.");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      let examId = exam?.id ?? null;

      const payload = {
        room_id: roomId,
        title: title.trim(),
        description: description.trim(),
      };

      if (examId) {
        const { error: upErr } = await supabase.from("exams").update(payload).eq("id", examId);
        if (upErr) throw new Error(upErr.message);
        // Rewrite the question set on every save (simplest correct sync).
        const { error: delErr } = await supabase
          .from("exam_questions")
          .delete()
          .eq("exam_id", examId);
        if (delErr) throw new Error(delErr.message);
      } else {
        const { data, error: insErr } = await supabase.from("exams").insert(payload).select("id").single();
        if (insErr) throw new Error(insErr.message);
        examId = data.id as string;
      }

      const rows = questions.map((q, i) => ({
        exam_id: examId,
        kind: q.kind,
        prompt: q.prompt.trim(),
        options:
          q.kind === "multiple_choice"
            ? q.options
                .map((text, j) => ({ key: LETTERS[j], text: text.trim() }))
                .filter((o) => o.text !== "")
            : [],
        answer_key: q.answerKey,
        points: Math.min(100, Math.max(1, Math.round(q.points) || 1)),
        order_index: i,
      }));
      const { error: qErr } = await supabase.from("exam_questions").insert(rows);
      if (qErr) throw new Error(qErr.message);

      router.push(`/exams/${examId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the exam.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
          <ClipboardList className="h-4 w-4 text-[var(--teal)]" />
          Exam for <span className="font-medium text-[var(--ink)]">{roomName}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--ink)]">
          {exam ? "Edit exam" : "Build an exam"}
        </h1>
      </div>

      <AuthError message={error} />

      <div className="rounded-card border border-[var(--border)] bg-[var(--surface)] p-5">
        <label
          htmlFor="exam-title"
          className="mb-1.5 block text-sm font-medium text-[var(--ink-soft)]"
        >
          Title
        </label>
        <input
          id="exam-title"
          value={title}
          maxLength={160}
          placeholder="e.g. Cell biology — mid-unit check"
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none"
        />
        <div className="mt-3">
          <label
            htmlFor="exam-desc"
            className="mb-1.5 block text-sm font-medium text-[var(--ink-soft)]"
          >
            Description (optional)
          </label>
          <textarea
            id="exam-desc"
            value={description}
            rows={2}
            maxLength={500}
            placeholder="What this exam covers, instructions…"
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none"
          />
        </div>
      </div>

      {/* -------------------------------------------------------------- Questions */}
      <div className="rounded-card border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between">
          <label className="mb-1.5 block text-sm font-medium text-[var(--ink-soft)]">
            Questions ({questions.length}) · {totalPoints} points
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setQuestions((prev) => [...prev, emptyQuestion("multiple_choice")])}
              className="flex items-center gap-1 rounded-[12px] border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
            >
              <CheckSquare className="h-3.5 w-3.5" /> Multiple choice
            </button>
            <button
              type="button"
              onClick={() => setQuestions((prev) => [...prev, emptyQuestion("short_answer")])}
              className="flex items-center gap-1 rounded-[12px] border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--ink)]"
            >
              <TextCursorInput className="h-3.5 w-3.5" /> Short answer
            </button>
          </div>
        </div>

        <ol className="mt-4 space-y-3">
          {questions.map((q, i) => (
            <li key={q.id} className="rounded-card border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-[var(--ink-soft)]" />
                <span className="text-sm font-semibold text-[var(--ink)]">Q{i + 1}</span>
                <span className="rounded-full bg-[var(--teal-pale)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink)]">
                  {q.kind === "multiple_choice" ? "Multiple choice" : "Short answer"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <label className="flex items-center gap-1 text-xs text-[var(--ink-soft)]">
                    pts
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={q.points}
                      onChange={(e) => updateQuestion(q.id, { points: Number(e.target.value) })}
                      className="h-8 w-16 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--ink)] focus:border-[var(--teal)] focus:outline-none"
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveQuestion(i, -1)}
                    className="rounded-[12px] p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)] disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === questions.length - 1}
                    onClick={() => moveQuestion(i, 1)}
                    className="rounded-[12px] p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)] disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove question"
                    onClick={() => setQuestions((prev) => prev.filter((x) => x.id !== q.id))}
                    className="rounded-[12px] p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--amber)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <textarea
                value={q.prompt}
                rows={2}
                maxLength={1000}
                placeholder={
                  q.kind === "multiple_choice"
                    ? "Ask a question with one correct answer…"
                    : "Ask a question with a short expected answer…"
                }
                onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })}
                className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none"
              />

              {q.kind === "multiple_choice" ? (
                <div className="mt-3 space-y-2">
                  {q.options.map((opt, j) => {
                    const isKey = q.answerKey === LETTERS[j];
                    return (
                      <div key={j} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQuestion(q.id, { answerKey: LETTERS[j] })}
                          title={isKey ? "Correct answer" : "Mark as the correct answer"}
                          aria-label={`Mark option ${LETTERS[j]} correct`}
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                            isKey
                              ? "border-primary-600 bg-primary-600 text-white"
                              : "border-[var(--border)] text-[var(--ink-soft)] hover:border-[var(--teal)]",
                          )}
                        >
                          {LETTERS[j]}
                        </button>
                        <input
                          value={opt}
                          maxLength={200}
                          placeholder={`Option ${LETTERS[j]}`}
                          onChange={(e) => setOption(q.id, j, e.target.value)}
                          className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none"
                        />
                        {q.options.length > 2 ? (
                          <button
                            type="button"
                            aria-label="Remove option"
                            onClick={() =>
                              setQuestions((prev) =>
                                prev.map((x) => {
                                  if (x.id !== q.id) return x;
                                  // Re-map the answer key when the removed
                                  // option sat before it (letters shift up).
                                  const keyIdx = LETTERS.indexOf(x.answerKey);
                                  let answerKey = x.answerKey;
                                  if (keyIdx === j) answerKey = "";
                                  else if (keyIdx > j) answerKey = LETTERS[keyIdx - 1];
                                  return {
                                    ...x,
                                    options: x.options.filter((_, k) => k !== j),
                                    answerKey,
                                  };
                                }),
                              )
                            }
                            className="rounded-[12px] p-1.5 text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--amber)]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {q.options.length < 6 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setQuestions((prev) =>
                          prev.map((x) =>
                            x.id === q.id ? { ...x, options: [...x.options, ""] } : x,
                          ),
                        )
                      }
                      className="flex items-center gap-1 text-xs font-medium text-[var(--teal)] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add option
                    </button>
                  ) : null}
                  <p className="text-xs text-[var(--ink-soft)]">
                    Correct answer:{" "}
                    <span className="font-semibold text-[var(--ink)]">
                      {q.answerKey || "not marked yet"}
                    </span>
                  </p>
                </div>
              ) : (
                <div className="mt-3">
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink-soft)]">
                    Expected answer (graded case-insensitively)
                  </label>
                  <input
                    value={q.answerKey}
                    maxLength={300}
                    placeholder="e.g. mitochondria"
                    onChange={(e) => updateQuestion(q.id, { answerKey: e.target.value })}
                    className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none"
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
        {questions.length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--ink-soft)]">
            No questions yet — add multiple-choice or short-answer questions above.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton busy={saving} disabled={saving}>
          {exam ? "Save changes" : "Publish exam"}
        </SubmitButton>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-[var(--ink-soft)] hover:text-[var(--ink)] hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
