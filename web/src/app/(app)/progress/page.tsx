import { cache } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProgressView, type ProgressData, type WeakSpot } from "./progress-view";

export const metadata: Metadata = { title: "Progress" };

const DAY_MS = 86_400_000;
const CALENDAR_DAYS = 84; // 12 weeks x 7 — GitHub-style grid

/**
 * Request-scoped clock: the React Compiler purity rule forbids `Date.now()` in
 * component bodies; wrapping it in `cache()` keeps a single consistent time for
 * the whole render (calendar, trend buckets, labels) and satisfies the linter.
 */
const nowMs = cache(() => Date.now());

/** Shape of the error-journal rows (embedded join; untyped DB until codegen). */
type JournalRow = {
  id: string;
  question: string;
  correct_answer: string;
  user_answer: string | null;
  created_at: string;
  quiz_id: string | null;
  quizzes:
    | Array<{
        documents: {
          id: string;
          title: string;
          subject_id: string | null;
          subjects: { id: string; name: string } | null;
        } | null;
      }>
    | null;
};

export default async function ProgressPage() {
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

  const now = nowMs();
  const since = new Date(now - (CALENDAR_DAYS - 1) * DAY_MS);
  since.setHours(0, 0, 0, 0);

  // Round 1 — everything independent.
  const [gamification, subjectsRes, xpRes, journalRes] = await Promise.all([
    supabase
      .from("gamification")
      .select("xp, current_streak, longest_streak")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("subjects")
      .select("id, name")
      .eq("student_id", user.id)
      .order("name"),
    supabase
      .from("xp_events")
      .select("kind, amount, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true }),
    supabase
      .from("error_journal_entries")
      .select(
        "id, question, correct_answer, user_answer, created_at, quiz_id, " +
          "quizzes(documents(id, title, subject_id, subjects(id, name)))",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const subjectList = subjectsRes.data ?? [];
  const subjectIds = subjectList.map((s) => s.id as string);

  // Round 2 — topic completion per subject (needs the subject ids).
  const moduleRows = subjectIds.length
    ? (
        await supabase
          .from("modules")
          .select("subject_id, topics(completed_at)")
          .in("subject_id", subjectIds)
      ).data
    : [];

  // ---- Per-subject topic completion ----
  const perSubject = new Map<string, { done: number; total: number }>(
    subjectIds.map((id) => [id, { done: 0, total: 0 }]),
  );
  for (const m of moduleRows ?? []) {
    const agg = perSubject.get(m.subject_id as string);
    if (!agg) continue;
    const topics = (m.topics ?? []) as { completed_at: string | null }[];
    agg.total += topics.length;
    agg.done += topics.filter((t) => t.completed_at).length;
  }

  const subjectBreakdown = subjectList.map((s) => {
    const agg = perSubject.get(s.id as string) ?? { done: 0, total: 0 };
    return {
      id: s.id as string,
      name: s.name as string,
      topicsDone: agg.done,
      topicsTotal: agg.total,
    };
  });
  const topicsDone = subjectBreakdown.reduce((s, c) => s + c.topicsDone, 0);
  const topicsTotal = subjectBreakdown.reduce((s, c) => s + c.topicsTotal, 0);

  // ---- XP events -> calendar days + weekly trend buckets ----
  const byDay = new Map<string, number>();
  for (const e of xpRes.data ?? []) {
    const day = String(e.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(e.amount ?? 0));
  }
  const days: ProgressData["days"] = [];
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    const d = new Date(since.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, xp: byDay.get(key) ?? 0 });
  }

  // Weekly buckets ending today (oldest -> newest).
  const trend: ProgressData["trend"] = [];
  for (let w = 11; w >= 0; w--) {
    const start = now - (w * 7 + 6) * DAY_MS;
    const end = now - w * 7 * DAY_MS;
    let sum = 0;
    for (const [day, xp] of byDay) {
      const t = new Date(day + "T00:00:00").getTime();
      if (t >= start && t <= end) sum += xp;
    }
    trend.push({
      // Label = the week's ending day (MM/DD).
      date: new Date(end).toISOString().slice(5, 10).replace("-", "/"),
      xp: sum,
    });
  }

  // ---- Weak spots from the error journal ----
  const weakSpots: WeakSpot[] = ((journalRes.data ?? []) as unknown as JournalRow[])
    .map((e) => {
      const quiz = Array.isArray(e.quizzes) ? e.quizzes[0] : null;
      const doc = quiz?.documents ?? null;
      return {
        id: e.id as string,
        question: e.question as string,
        correct: e.correct_answer as string,
        given: (e.user_answer as string) ?? "(no answer)",
        when: String(e.created_at ?? ""),
        subjectId: (doc?.subject_id as string | null) ?? null,
        documentTitle: (doc?.title as string | null) ?? null,
      };
    })
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 4);

  const data: ProgressData = {
    xpTotal: Number(gamification.data?.xp ?? 0),
    streak: {
      current: Number(gamification.data?.current_streak ?? 0),
      longest: Number(gamification.data?.longest_streak ?? 0),
    },
    days,
    trend,
    subjects: subjectBreakdown,
    weakSpots,
    totals: { topicsDone, topicsTotal },
  };

  return <ProgressView data={data} />;
}
