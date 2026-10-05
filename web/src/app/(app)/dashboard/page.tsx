import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Flame, Zap, Lock, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const [profileResult, subjectsResult, stateResult, membershipsResult, gamificationResult, sessionsResult, quizzesResult, badgesResult, sessionsThisWeekResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("student_state").select("active_subject_id").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("room_members")
      .select("joined_at, rooms(id, name, type, created_at)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false }),
    supabase.from("gamification").select("xp, current_streak").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("study_sessions")
      .select("id, summary, started_at, xp_earned")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("quiz_attempts")
      .select("id, score, created_at, quizzes(title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("user_badges").select("badge_id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("study_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("started_at", weekStart.toISOString()),
  ]);

  const subjects = subjectsResult.data ?? [];
  const subject =
    subjects.find((item) => item.id === stateResult.data?.active_subject_id) ??
    subjects[0] ??
    null;
  const rooms = (membershipsResult.data ?? [])
    .map((membership) =>
      Array.isArray(membership.rooms) ? membership.rooms[0] : membership.rooms,
    )
    .filter((room): room is NonNullable<typeof room> => Boolean(room));
  const roomIds = rooms.map((room) => room.id);
  const { data: roomRoster } = roomIds.length
    ? await supabase.from("room_members").select("room_id").in("room_id", roomIds)
    : { data: [] };
  const membersByRoom = new Map<string, number>();
  for (const member of roomRoster ?? []) {
    membersByRoom.set(member.room_id, (membersByRoom.get(member.room_id) ?? 0) + 1);
  }

  const { data: modules } = subject
    ? await supabase
        .from("modules")
        .select("id, title, order_index, status, topics(id, title, order_index, completed_at)")
        .eq("subject_id", subject.id)
        .order("order_index", { ascending: true })
    : { data: [] };
  const sortedModules = (modules ?? []).map((module) => ({
    ...module,
    topics: [...(module.topics ?? [])].sort((left, right) => left.order_index - right.order_index),
  }));
  const allTopics = sortedModules.flatMap((module) => module.topics);
  const completedTopics = allTopics.filter((topic) => topic.completed_at).length;
  const roadmapPercent = allTopics.length
    ? Math.round((completedTopics / allTopics.length) * 100)
    : null;
  const currentModule =
    sortedModules.find((module) => module.status !== "complete") ?? sortedModules[0] ?? null;

  const recentActivities = [
    ...(sessionsResult.data ?? []).map((session) => ({
      id: `session-${session.id}`,
      title: session.summary?.trim() || "Study session",
      detail: session.xp_earned > 0 ? `${session.xp_earned} XP earned` : null,
      createdAt: session.started_at,
    })),
    ...(quizzesResult.data ?? []).map((attempt) => {
      const quiz = Array.isArray(attempt.quizzes) ? attempt.quizzes[0] : attempt.quizzes;
      return {
        id: `quiz-${attempt.id}`,
        title: quiz?.title ?? "Quiz attempt",
        detail: `${attempt.score}% score`,
        createdAt: attempt.created_at,
      };
    }),
  ]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-10 md:py-8">
      {/* Topline Header */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-3xl font-semibold tracking-tight text-[var(--ink)]">
            {profileResult.data?.display_name
              ? `Welcome back, ${profileResult.data.display_name}`
              : "Welcome back"}
          </h1>
          <p className="mt-1 text-[14.5px] text-[var(--ink-soft)]">
            {subject?.name ?? "No subjects yet"} · {subjects.length} subject{subjects.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="pill-tag pill-amber">
            <Flame className="h-4 w-4 fill-amber-500 stroke-amber-600" />
            <span>{gamificationResult.data?.current_streak ?? 0} day streak</span>
          </div>
          <div className="pill-tag pill-teal">
            <Zap className="h-4 w-4 fill-teal-600 stroke-teal-700" />
            <span>{gamificationResult.data?.xp ?? 0} XP</span>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-5.5 lg:grid-cols-[1.35fr_1fr]">
        {/* Left Column Stack */}
        <div className="flex flex-col gap-5.5 lg:col-span-1">
          {/* Hero Continuation Card */}
          <div className="card-study animate-rise flex flex-col items-center gap-7 sm:flex-row">
            <div className="ring-progress shadow-sm" style={{ "--pct": roadmapPercent ?? 0 } as React.CSSProperties}>
              <div className="hole">
                <b>{roadmapPercent === null ? "—" : `${roadmapPercent}%`}</b>
                <span>{allTopics.length ? `${completedTopics}/${allTopics.length} topics` : "No roadmap"}</span>
              </div>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="text-[13px] font-medium text-[var(--ink-soft)]">
                {subject ? `${subject.name} · Roadmap` : "Choose a subject to begin"}
              </div>
              <h2 className="font-fraunces text-[24px] font-semibold text-[var(--ink)] my-1.5">
                {currentModule?.title ?? (subject ? "No roadmap yet" : "No subjects yet")}
              </h2>
              <Link href={subject ? `/roadmap?subject=${subject.id}` : "/documents"} className="btn-primary">
                <span>{subject ? "Open roadmap" : "Add a subject"}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Quick Stat Strip */}
          <div className="grid grid-cols-3 gap-3.5">
            <div className="card-study !p-4">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">{sessionsThisWeekResult.count ?? 0}</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Sessions this week</span>
            </div>
            <Link href="/progress" className="card-study !p-4 block hover:border-[var(--teal)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">{badgesResult.count ?? 0}</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Badges earned</span>
            </Link>
            <Link href="/progress" className="card-study !p-4 block hover:border-[var(--teal)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">{completedTopics}</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Topics completed</span>
            </Link>
          </div>

          {/* Roadmap Summary Card */}
          <div className="card-study">
            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-4">
              {subject ? `${subject.name} roadmap` : "Your roadmap"}
            </h3>
            <div className="divide-y divide-[var(--border)]">
              {sortedModules.length ? sortedModules.slice(0, 3).map((module) => {
                const done = module.topics.filter((topic) => topic.completed_at).length;
                const total = module.topics.length;
                return (
                  <Link key={module.id} href={subject ? `/roadmap?subject=${subject.id}` : "/roadmap"} className="flex items-center gap-3.5 py-3.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--teal-pale)] text-[var(--teal-dark)]">
                      {module.status === "complete" ? <Check className="h-4 w-4 stroke-[2.5]" /> : module.status === "locked" ? <Lock className="h-3.5 w-3.5" /> : "•"}
                    </div>
                    <div className="flex-1">
                      <b className="block text-[14px] font-semibold text-[var(--ink)]">{module.title}</b>
                      <span className="text-[12px] text-[var(--ink-soft)]">{done} of {total} topics complete</span>
                    </div>
                    <span className="text-[13px] font-semibold text-[var(--ink-soft)]">{total ? `${Math.round((done / total) * 100)}%` : "—"}</span>
                  </Link>
                );
              }) : (
                <p className="py-3 text-sm text-[var(--ink-soft)]">
                  {subject ? "No roadmap yet" : "No subjects yet"}
                </p>
              )}
            </div>
          </div>

          <div className="card-study">
            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-3">Recent activity</h3>
            {recentActivities.length ? (
              <div className="divide-y divide-[var(--border)]">
                {recentActivities.map((activity) => {
                  const href = activity.id.startsWith("quiz-")
                    ? "/quiz"
                    : activity.id.startsWith("session-")
                      ? "/progress"
                      : null;
                  const row = (
                    <>
                      <div className="min-w-0">
                        <b className="block truncate text-[14px] font-semibold text-[var(--ink)]">{activity.title}</b>
                        <span className="text-[12px] text-[var(--ink-soft)]">{new Date(activity.createdAt).toLocaleDateString()}</span>
                      </div>
                      {activity.detail ? <span className="shrink-0 text-[12px] text-[var(--ink-soft)]">{activity.detail}</span> : null}
                    </>
                  );
                  return href ? (
                    <Link key={activity.id} href={href} className="flex items-center justify-between gap-3 py-3 hover:border-[var(--teal)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2">
                      {row}
                    </Link>
                  ) : (
                    <div key={activity.id} className="flex items-center justify-between gap-3 py-3">
                      {row}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[var(--ink-soft)]">No recent activity</p>}
          </div>
        </div>

        {/* Right Side Column */}
        <div className="flex flex-col gap-5.5 lg:col-span-1">
          <div className="card-study h-full">
            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-4">
              Your rooms
            </h3>
            
            {rooms.length ? rooms.slice(0, 4).map((room, index) => (
              <Link key={room.id} href={`/rooms/${room.id}`} className={`mb-3 flex items-center justify-between rounded-r-[10px] border-l-[3.5px] ${index % 2 ? "border-[var(--teal)]" : "border-[var(--violet)]"} bg-surface py-2.5 pl-3.5`}>
                <div>
                  <b className="block text-[14px] font-semibold text-[var(--ink)]">{room.name}</b>
                  <span className="text-[12px] text-[var(--ink-soft)]">{membersByRoom.get(room.id) ?? 0} members · {room.type === "teacher" ? "Teacher room" : "Peer study"}</span>
                </div>
              </Link>
            )) : <p className="text-sm text-[var(--ink-soft)]">No rooms yet</p>}

            <Link href="/rooms" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--teal)]">
              View rooms <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

