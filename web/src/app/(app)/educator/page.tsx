import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Presentation } from "lucide-react";
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
      supabase.from("lessons").select("id, room_id").eq("created_by", user.id),
      supabase.from("exams").select("id, room_id").eq("created_by", user.id),
    ]);

  const roomList = rooms ?? [];

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8">
      {/* Title */}
      <h1 className="font-fraunces text-[26px] font-semibold text-[var(--ink)]">
        Educator dashboard
      </h1>
      <p className="text-[14px] text-[var(--ink-soft)] mb-6">
        {profile.display_name} · {profile.subject_area}
      </p>

      {/* Violet Hero Grading Banner */}
      <div className="rounded-[14px] bg-[var(--violet-pale)] p-6 flex items-center gap-[22px] mb-[26px]">
        <b className="font-fraunces text-[34px] text-[var(--violet-dark)] leading-none">
          12
        </b>
        <div>
          <h2 className="font-fraunces text-[19px] font-semibold text-[var(--ink)] mb-0.5">
            Submissions need grading
          </h2>
          <p className="text-[13px] text-[var(--ink-soft)] margin-0">
            Chem exam prep · assigned 2 days ago
          </p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[20px]">
        {/* Your Rooms Card */}
        <div className="card-study">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)]">
              Your rooms
            </h3>
            <CreateRoomDialog compact />
          </div>
          {roomList.length === 0 ? (
            <p className="text-[13px] text-[var(--ink-soft)] py-4">No rooms created yet.</p>
          ) : (
            <div className="divide-y divide-[var(--border)] text-[13.5px]">
              {roomList.map((room) => (
                <div key={room.id} className="flex items-center justify-between py-2.5">
                  <Link
                    href={`/rooms/${room.id}`}
                    className="font-medium text-[var(--ink)] hover:text-[var(--violet)] hover:underline truncate max-w-[70%]"
                  >
                    {room.name}
                  </Link>
                  <span className="text-[12px] text-[var(--ink-soft)]">
                    {room.type === "teacher" ? "Teacher-led" : "Peer space"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Class Knowledge Gaps Card */}
        <div className="card-study">
          <h3 className="font-sans text-[14.5px] font-semibold text-[var(--ink)] mb-3.5">
            Class knowledge gaps
          </h3>
          <div className="space-y-3 text-[13px]">
            <div>
              <div className="flex justify-between mb-1">
                <span>Membrane transport</span>
                <span className="font-semibold text-[var(--violet)]">68%</span>
              </div>
              <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--violet)] rounded-full" style={{ width: "68%" }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Cell division</span>
                <span className="font-semibold text-[var(--violet)]">41%</span>
              </div>
              <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--violet)] rounded-full" style={{ width: "41%" }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span>Photosynthesis</span>
                <span className="font-semibold text-[var(--violet)]">22%</span>
              </div>
              <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--violet)] rounded-full" style={{ width: "22%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Build a New Exam Quick Card */}
      <div className="card-study mt-5">
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
  );
}

