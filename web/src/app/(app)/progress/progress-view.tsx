"use client";

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type WeakSpot = {
  id: string;
  question: string;
  correct: string;
  given: string;
  when: string;
  subjectId: string | null;
  documentTitle: string | null;
};

export type ProgressData = {
  xpTotal: number;
  streak: { current: number; longest: number };
  days: { date: string; xp: number }[];
  trend: { date: string; xp: number }[];
  subjects: { id: string; name: string; topicsDone: number; topicsTotal: number }[];
  weakSpots: WeakSpot[];
  totals: { topicsDone: number; topicsTotal: number };
  /** Real user_badges count, or null for "none yet / error" (shown as —). */
  badges: number | null;
  /** Average of non-null quiz_attempts.score, rounded; null = none yet / error. */
  accuracy: number | null;
};

function reviewHref(spot: WeakSpot): string {
  const ask = `Help me understand this question I got wrong: "${spot.question}" (my answer was ${spot.given}; correct: ${spot.correct})`;
  const params = new URLSearchParams({ ask });
  if (spot.subjectId) params.set("subject", spot.subjectId);
  return `/tutor?${params.toString()}`;
}

export function ProgressView({ data }: { data: ProgressData }) {
  const pct =
    data.totals.topicsTotal > 0
      ? Math.round((data.totals.topicsDone / data.totals.topicsTotal) * 100)
      : 0;

  const visibleWeakSpots = data.weakSpots.slice(0, 4);
  const compactQuestion = (question: string) =>
    question.length > 90 ? `${question.slice(0, 87)}...` : question;

  const sparkPoints = data.trend.slice(-7).map((t, i) => {
    const x = i * 30 + 10;
    const maxXP = Math.max(...data.trend.slice(-7).map((d) => d.xp), 100);
    const y = 50 - Math.round((t.xp / maxXP) * 40);
    return `${x},${y}`;
  }).join(" ");
  const sparkHasData = data.trend.slice(-7).some((d) => d.xp > 0);

  return (
    <div className="mx-auto max-w-[820px] px-4 py-8">
      {/* Title */}
      <h1 className="font-fraunces text-[26px] font-semibold text-[var(--ink)] mb-[22px]">
        Your progress
      </h1>

      {/* Hero Header */}
      <div className="mb-7 flex flex-wrap items-end gap-8">
        <div>
          <b className="font-fraunces text-[52px] leading-none text-[var(--teal-dark)] block">
            {data.totals.topicsTotal > 0 ? `${pct}%` : "—"}
          </b>
          <span className="text-[13px] text-[var(--ink-soft)]">
            {data.totals.topicsTotal > 0 ? "Overall completion" : "Add a subject to see your progress"}
          </span>
        </div>
        <div className="flex gap-6 pb-1.5">
          <div>
            <b className="font-fraunces text-[18px] text-[var(--ink)] block">{data.badges ?? "—"}</b>
            <span className="text-[11.5px] text-[var(--ink-soft)]">Badges</span>
          </div>
          <div>
            <b className="font-fraunces text-[18px] text-[var(--ink)] block">
              {data.accuracy === null ? "—" : `${data.accuracy}%`}
            </b>
            <span className="text-[11.5px] text-[var(--ink-soft)]">Quiz accuracy</span>
          </div>
          <div>
            <b className="font-fraunces text-[18px] text-[var(--ink)] block">
              {data.streak.current}
            </b>
            <span className="text-[11.5px] text-[var(--ink-soft)]">Day streak</span>
          </div>
        </div>
      </div>

      {/* Grid: Streak Calendar + XP Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div className="card-study">
          <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)] mb-3.5">
            Streak calendar
          </h3>
          <div className="grid grid-cols-7 gap-1.5">
            {data.days.slice(-14).map((d, i) => (
              <div
                key={i}
                title={`${d.date}: ${d.xp} XP`}
                className={cn(
                  "aspect-square rounded-[5px] transition-colors",
                  d.xp > 50
                    ? "bg-[var(--teal)]"
                    : d.xp > 0
                      ? "bg-[var(--teal-pale)]"
                      : "bg-[var(--border)]"
                )}
              />
            ))}
          </div>
        </div>

        <div className="card-study">
          <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)] mb-3.5">
            XP trend (7 days)
          </h3>
          <svg className="w-full h-[60px]" viewBox="0 0 200 60" preserveAspectRatio="none">
            {sparkHasData ? (
              <polyline
                points={sparkPoints}
                fill="none"
                stroke="var(--teal)"
                strokeWidth="3"
              />
            ) : (
              <line x1="0" y1="45" x2="200" y2="45" stroke="var(--border)" strokeWidth="2" />
            )}
          </svg>
          {sparkHasData ? null : (
            <p className="mt-1 text-[12.5px] text-[var(--ink-soft)]">No XP yet this week</p>
          )}
        </div>
      </div>

      {/* Weak Spots List */}
      <div className="card-study">
        <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)] mb-3.5">
          Weak spots
        </h3>
        <div className="divide-y divide-[var(--border)] text-[13.5px]">
          {visibleWeakSpots.length === 0 ? (
            <div className="py-3 text-[var(--ink-soft)]">
              No weak spots detected — great job on your quizzes!
            </div>
          ) : (
            visibleWeakSpots.map((spot) => (
              <div key={spot.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[var(--ink)] max-w-[78%] truncate">
                  {compactQuestion(spot.question)}
                </span>
                <Link
                  href={reviewHref(spot)}
                  className="text-[12.5px] font-semibold text-[var(--violet)] hover:underline shrink-0"
                >
                  Review →
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

