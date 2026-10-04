import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  ClipboardList,
  Presentation,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateRoomDialog } from "./create-room-dialog";

export const metadata: Metadata = { title: "Educator dashboard" };

export default async function EducatorDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, subject_area")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "educator") redirect("/dashboard");
  if (typeof profile.subject_area !== "string") {
    redirect("/onboarding/educator");
  }

  const [{ data: rooms }, { data: lessonRows }, { data: examRows }] =
    await Promise.all([
      supabase
        .from("rooms")
        .select("id, name, type, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("lessons")
        .select("id, room_id, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("exams")
        .select("id, room_id, created_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false }),
    ]);

  const roomList = rooms ?? [];
  const lessonList = lessonRows ?? [];
  const examList = examRows ?? [];
  const lessonCount = lessonList.length;
  const examCount = examList.length;
  const totalClasswork = lessonCount + examCount;
  const formatShortDate = (value: string | null | undefined) => {
    if (!value) return "Recently";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Recently" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const activityBuckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const bucketKey = date.toISOString().slice(0, 10);
    const count = [...roomList, ...lessonList, ...examList].filter((entry) =>
      typeof entry.created_at === "string" && entry.created_at.slice(0, 10) === bucketKey,
    ).length;
    return {
      key: bucketKey,
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      count,
    };
  });
  const maxBucketCount = Math.max(...activityBuckets.map((bucket) => bucket.count), 1);
  const recentActivity = [...
    roomList.map((room) => ({
      title: `Room created: ${room.name}`,
      time: room.created_at,
      tone: "violet",
    })),
    ...lessonList.map((lesson) => ({
      title: "Lesson published",
      time: lesson.created_at,
      tone: "teal",
    })),
    ...examList.map((exam) => ({
      title: "Exam published",
      time: exam.created_at,
      tone: "amber",
    })),
  ]
    .sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime())
    .slice(0, 5);
  const quickActions = [
    {
      label: "New lesson",
      href: "/lessons/new",
      icon: BookOpen,
      tone: "teal",
      helper: "Build a guided lesson",
    },
    {
      label: "New exam",
      href: "/exams/new",
      icon: ClipboardList,
      tone: "violet",
      helper: "Launch an assessment",
    },
    {
      label: "Rooms",
      href: "/rooms",
      icon: Users,
      tone: "amber",
      helper: "Open your classroom hubs",
    },
  ];

  return (
    <div className="mx-auto max-w-[980px] px-4 py-8">
      <div className="mb-7 flex flex-col gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--violet)]">
          Classroom overview
        </p>
        <h1 className="font-fraunces text-[30px] font-semibold text-[var(--ink)]">
          Educator dashboard
        </h1>
        <p className="text-[14px] text-[var(--ink-soft)]">
          {profile.display_name} · {profile.subject_area}
        </p>
      </div>

      <div className="mb-6 rounded-[20px] bg-[radial-gradient(circle_at_top_left,_rgba(114,99,255,0.18),_transparent_35%),linear-gradient(135deg,_rgba(101,90,255,0.12),_rgba(15,23,42,0.02))] border border-[var(--border)] p-6 shadow-[0_14px_32px_rgba(42,35,79,0.08)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--violet)]/20 bg-[var(--violet-pale)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--violet-dark)]">
              <Sparkles className="h-3.5 w-3.5" />
              Active coaching pulse
            </div>
            <div className="text-[52px] font-fraunces leading-none text-[var(--ink)]">
              {Math.max(roomList.length * 2 + totalClasswork, 8)}
            </div>
            <div className="mt-1 text-[13px] text-[var(--ink-soft)]">
              learning actions across your rooms this week
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[16px] border border-[var(--border)] bg-white/60 p-3.5 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">Rooms</div>
              <div className="mt-2 text-[24px] font-fraunces text-[var(--ink)]">{roomList.length}</div>
            </div>
            <div className="rounded-[16px] border border-[var(--border)] bg-white/60 p-3.5 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">Lessons</div>
              <div className="mt-2 text-[24px] font-fraunces text-[var(--ink)]">{lessonCount}</div>
            </div>
            <div className="rounded-[16px] border border-[var(--border)] bg-white/60 p-3.5 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">Exams</div>
              <div className="mt-2 text-[24px] font-fraunces text-[var(--ink)]">{examCount}</div>
            </div>
            <div className="rounded-[16px] border border-[var(--border)] bg-white/60 p-3.5 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">Tasks</div>
              <div className="mt-2 text-[24px] font-fraunces text-[var(--ink)]">{totalClasswork}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {quickActions.map(({ label, href, icon: Icon, tone, helper }) => (
          <Link
            key={label}
            href={href}
            className={[
              "group rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-[0_8px_22px_rgba(17,24,39,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(17,24,39,0.08)]",
              tone === "teal" ? "bg-[linear-gradient(135deg,rgba(18,166,130,0.08),rgba(255,255,255,0.8))]" : "",
              tone === "violet" ? "bg-[linear-gradient(135deg,rgba(104,95,255,0.08),rgba(255,255,255,0.8))]" : "",
              tone === "amber" ? "bg-[linear-gradient(135deg,rgba(247,187,81,0.08),rgba(255,255,255,0.8))]" : "",
            ].join(" ")}
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--bg)] text-[var(--ink)]">
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold text-[var(--ink)]">{label}</div>
                <div className="mt-1 text-[12px] text-[var(--ink-soft)]">{helper}</div>
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--ink-soft)] transition group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="card-study">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Presentation className="h-4 w-4 text-[var(--violet)]" />
              <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)]">Your rooms</h3>
            </div>
            <CreateRoomDialog compact />
          </div>

          {roomList.length === 0 ? (
            <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--bg)] p-5 text-center">
              <div className="mb-2 text-[13px] font-medium text-[var(--ink)]">No rooms yet</div>
              <p className="text-[12.5px] text-[var(--ink-soft)]">
                Create a room to launch your next lesson or class check-in.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {roomList.map((room) => (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className="group flex items-center justify-between rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-3 transition hover:border-[var(--violet)]/50 hover:bg-[var(--violet-pale)]/30"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{room.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-[var(--ink-soft)]">
                      {room.type === "teacher" ? "Teacher-led" : "Peer space"}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[var(--ink-soft)] transition group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card-study">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[var(--teal)]" />
            <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)]">Classroom pulse</h3>
          </div>
          <div className="mb-4 flex h-[72px] items-end gap-2">
            {activityBuckets.map((bucket) => {
              const height = Math.max(16, (bucket.count / maxBucketCount) * 100);
              return (
                <div key={bucket.key} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div className="w-full rounded-t-[8px] bg-[linear-gradient(180deg,_rgba(104,95,255,0.8),_rgba(18,166,130,0.85))]" style={{ height: `${height}%` }} />
                  <span className="text-[10px] text-[var(--ink-soft)]">{bucket.label.slice(0, 1)}</span>
                </div>
              );
            })}
          </div>
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--ink-soft)]">
                <span>Lesson pipeline</span>
                <span className="font-semibold text-[var(--ink)]">{lessonCount}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div className="h-full rounded-full bg-[var(--teal)]" style={{ width: `${Math.min(100, lessonCount * 25 || 18)}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-[12px] text-[var(--ink-soft)]">
                <span>Assessment flow</span>
                <span className="font-semibold text-[var(--ink)]">{examCount}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div className="h-full rounded-full bg-[var(--violet)]" style={{ width: `${Math.min(100, examCount * 30 || 20)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card-study">
          <div className="mb-4 flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[var(--amber)]" />
            <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)]">Recent activity</h3>
          </div>
          <div className="space-y-3">
            {recentActivity.map((entry, index) => (
              <div key={`${entry.title}-${index}`} className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={[
                      "inline-flex h-2.5 w-2.5 rounded-full",
                      entry.tone === "violet" ? "bg-[var(--violet)]" : "",
                      entry.tone === "teal" ? "bg-[var(--teal)]" : "",
                      entry.tone === "amber" ? "bg-[var(--amber)]" : "",
                    ].join(" ")}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-[var(--ink)]">{entry.title}</div>
                    <div className="text-[11.5px] text-[var(--ink-soft)]">{formatShortDate(entry.time)}</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--ink-soft)]" />
              </div>
            ))}
          </div>
        </div>

        <div className="card-study">
          <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)] mb-3.5">
            Build a new exam
          </h3>
          <form className="space-y-3.5">
            <div>
              <label className="text-[12px] font-medium text-[var(--ink-soft)] block mb-1">
                Title
              </label>
              <input
                placeholder="Midterm — Cell Biology"
                className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] text-[13.5px] text-[var(--ink)] outline-none"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[var(--ink-soft)] block mb-1">
                Assign to room
              </label>
              <select className="w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] text-[13.5px] text-[var(--ink)] outline-none">
                {roomList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-violet">
              Create exam
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

