// ============================================================================
// suggest-exam-feedback — AI grading suggestion (Task 16)
//
// Educator opens the grading workbench, clicks "Suggest with AI": this reads
// ONE attempt (questions, the student's answers, server-graded correctness)
// through the educator's own RLS session, prompts Qwen for a suggested grade
// + feedback, and returns both. NOTHING is persisted — the educator accepts,
// edits, or discards it, and finalize_exam_grade commits the human decision.
//
// Authorization: the caller's own Supabase session (Authorization header).
// RLS examiner policies make the attempt invisible unless the caller created
// the exam, so this function needs no service role.
//
// Deploy:  supabase functions deploy suggest-exam-feedback
// Secrets: supabase secrets set LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=...
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { chatCompletion, type ChatMessage } from "../_shared/qwen.ts";
// @ts-ignore: same as above.
import { DEFAULT_TIMEOUT_MS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FeedbackRequest {
  attemptId: string;
}

const SYSTEM_PROMPT = `You are an assistant teacher helping an educator grade a student's exam attempt. Output ONLY valid JSON — no markdown fences, no commentary.

Rules:
- You receive the questions, the student's answers, and which answers the grader marked correct/incorrect.
- "suggested_grade" must be an integer between 0 and the provided "max_points".
- Multiple-choice questions were machine-graded and should normally stay as-is; short-answer questions may deserve partial credit — use it sparingly and say why.
- "feedback" is 2-5 sentences addressed to the student: start with what they did well, name the 1-2 specific misconceptions behind their wrong answers, and end with one concrete, actionable study step. Plain text, no markdown.
- JSON shape: {"suggested_grade": <int>, "feedback": "<string>"} with nothing else.`;

interface QwenGrade {
  suggested_grade: number;
  feedback: string;
}

function parseGradeReply(raw: string, maxPoints: number): QwenGrade {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model reply contained no JSON object");
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<QwenGrade>;
  if (
    typeof parsed.suggested_grade !== "number" ||
    !Number.isFinite(parsed.suggested_grade)
  ) {
    throw new Error("suggested_grade missing or not a number");
  }
  const grade = Math.max(0, Math.min(maxPoints, Math.round(parsed.suggested_grade)));
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
  if (!feedback) throw new Error("feedback missing");
  return { suggested_grade: grade, feedback: feedback.slice(0, 2000) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const { attemptId } = (await req.json()) as FeedbackRequest;
    if (!attemptId) {
      return json({ error: "attemptId is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    // The educator's own session: RLS examiner policies scope every read to
    // attempts of exams they created, so a foreign attempt 404s here.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // -------------------------------------------------------------- Attempt
    const { data: attempt, error: attemptErr } = await supabase
      .from("exam_attempts")
      .select("id, exam_id, score, total, student_id, profiles(display_name)")
      .eq("id", attemptId)
      .maybeSingle();

    if (attemptErr || !attempt) {
      return json({ error: "Attempt not found" }, 404);
    }

    const [{ data: exam }, { data: questions }, { data: answers }] =
      await Promise.all([
        supabase
          .from("exams")
          .select("id, title, description")
          .eq("id", attempt.exam_id)
          .single(),
        supabase
          .from("exam_questions")
          .select("id, kind, prompt, options, answer_key, points")
          .eq("exam_id", attempt.exam_id)
          .order("order_index", { ascending: true }),
        supabase
          .from("exam_answers")
          .select("question_id, answer, is_correct")
          .eq("attempt_id", attempt.id),
      ]);

    if (!exam || !questions) {
      return json({ error: "Exam not found" }, 404);
    }

    const maxPoints = questions.reduce((s, q) => s + (q.points ?? 0), 0);
    const answerByQid = new Map(
      (answers ?? []).map((a) => [a.question_id, a]),
    );

    // ----------------------------------------------------------- Qwen call
    const lines: string[] = [
      `Exam: ${exam.title}${exam.description ? ` — ${exam.description}` : ""}`,
      `Max points: ${maxPoints}`,
      `Machine-graded score: ${attempt.score}/${attempt.total} questions correct`,
      "",
    ];

    for (const q of questions) {
      const a = answerByQid.get(q.id);
      const given = a?.answer?.trim() ? a.answer.trim() : "(no answer)";
      const correct = a?.is_correct === true;
      const keyText =
        q.kind === "multiple_choice"
          ? `correct option: ${q.answer_key}`
          : `expected answer: ${q.answer_key}`;
      lines.push(
        `[${correct ? "CORRECT" : "WRONG"}] (${q.points} pts, ${q.kind}) ${q.prompt}`,
      );
      if (Array.isArray(q.options) && q.options.length > 0) {
        lines.push(
          `  options: ${(q.options as { key: string; text: string }[])
            .map((o) => `${o.key}) ${o.text}`)
            .join(" | ")}`,
        );
      }
      lines.push(`  ${keyText}`);
      lines.push(`  student answered: ${given}`);
      lines.push("");
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: lines.join("\n").slice(0, 24000),
      },
    ];

    const reply = await chatCompletion(messages, {
      temperature: 0.2,
      maxTokens: 700,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

    let suggestion: QwenGrade;
    try {
      suggestion = parseGradeReply(reply.content, maxPoints);
    } catch (err) {
      console.error("[suggest-exam-feedback] model response parse failed:", err);
      return json(
        { error: "The model returned an unexpected reply. Try again." },
        502,
      );
    }

    const profile = Array.isArray(attempt.profiles)
      ? attempt.profiles[0]
      : attempt.profiles;

    return json({
      attemptId: attempt.id,
      studentName: profile?.display_name ?? "Student",
      machineScore: attempt.score,
      maxPoints,
      suggestedGrade: suggestion.suggested_grade,
      suggestedFeedback: suggestion.feedback,
    });
  } catch (e) {
    console.error("[suggest-exam-feedback] request failed:", e);
    return json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      500,
    );
  }
});
