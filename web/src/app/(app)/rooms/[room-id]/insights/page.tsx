import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MessageCircle, TrendingDown, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Room insights" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Gap = { topic: string; struggles: number; attempts: number; source: string };

export default async function RoomInsightsPage({
  params,
}: {
  params: Promise<{ "room-id": string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { "room-id": roomId } = await params;
  if (!UUID_RE.test(roomId)) notFound();

  // RLS: members only (educators are members/creators of their rooms).
  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, created_by")
    .eq("id", roomId)
    .single();
  if (!room) notFound();

  const [{ data: gaps, error }, { data: roster }] = await Promise.all([
    supabase.rpc("get_room_knowledge_gaps", { p_room_id: roomId }),
    supabase
      .from("room_members")
      .select("user_id, profiles(display_name)")
      .eq("room_id", roomId),
  ]);

  if (error) notFound();

  const rows = (gaps ?? []) as unknown as Gap[];
  const maxStruggles = Math.max(1, ...rows.map((r) => r.struggles));
  const memberCount = roster?.length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <Users className="h-4 w-4 text-primary-600" />
          Insights · <span className="font-medium text-ink">{room.name}</span>
          <span className="text-ink/40">· {memberCount} members</span>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Knowledge gaps</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/60">
          Topics the group as a whole is struggling with, aggregated from quiz
          mistakes and wrong exam answers across everyone in this room. Shown
          as counts only — never individual students.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-primary-200 px-4 py-12 text-center text-sm text-ink/50">
          Not enough data yet — gaps appear once students take quizzes or exams.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((g, i) => {
            const rate = g.attempts > 0 ? Math.round((g.struggles / g.attempts) * 100) : 0;
            return (
              <li
                key={`${g.source}-${g.topic}-${i}`}
                className="rounded-card border border-primary-100 bg-surface p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {g.topic}
                  </p>
                  <span className="shrink-0 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold text-accent-700">
                    {g.struggles} miss{g.struggles === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-accent-500"
                    style={{ width: `${Math.round((g.struggles / maxStruggles) * 100)}%` }}
                  />
                </div>
                <p className="mt-1.5 flex items-center gap-3 text-xs text-ink/50">
                  <span className="flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5 text-accent-600" />
                    {rate}% wrong ({g.attempts} {g.attempts === 1 ? "attempt" : "attempts"})
                  </span>
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 font-medium text-primary-700">
                    from {g.source === "exam" ? "exams" : "quizzes"}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm text-ink/60">
        Want to re-teach a gap?{" "}
        <Link
          href={`/lessons/new?room=${room.id}`}
          className="inline-flex items-center gap-1 font-medium text-primary-600 hover:underline"
        >
          <MessageCircle className="h-4 w-4" />
          Build a lesson for the room
        </Link>
      </p>
    </div>
  );
}
