"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Plus, Users, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { celebrate } from "@/components/ui/toast";
import { AuthError, FieldLabel, SubmitButton, TextInput } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type RoomSummary = {
  id: string;
  name: string;
  type: "peer" | "teacher";
  createdBy: string;
  creatorRole: "student" | "educator";
  createdAt: string;
  isOwn: boolean;
  members: { name: string; color: number | null }[];
};

const AVATAR_STYLES = [
  "bg-[var(--teal)] text-white",
  "bg-[var(--amber)] text-[#3A2A0F]",
  "bg-[var(--violet)] text-white",
  "bg-[var(--teal-dark)] text-white",
  "bg-[var(--violet-dark)] text-white",
] as const;

export function AvatarStack({
  people,
  max = 5,
}: {
  people: { name: string; color: number | null }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          title={p.name}
          className={cn(
            "flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[var(--surface)] text-[11px] font-bold shadow-xs",
            AVATAR_STYLES[(p.color ?? i) % AVATAR_STYLES.length],
          )}
        >
          {initials(p.name)}
        </div>
      ))}
      {rest > 0 ? (
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--bg)] text-[10px] font-bold text-[var(--ink-soft)]">
          +{rest}
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function RoomsView({
  role,
  rooms,
}: {
  role: "student" | "educator";
  rooms: RoomSummary[];
}) {
  const router = useRouter();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? rooms[0] ?? null;

  return (
    <div className="mx-auto max-w-[960px] px-4 py-8 animate-rise">
      {/* Action Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[var(--border)] bg-gradient-to-r from-[var(--surface)] via-[var(--surface)] to-[var(--teal-pale)]/30 p-6 shadow-sm">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-pale)] px-3 py-1 text-xs font-semibold text-[var(--teal-dark)]">
            <Users className="h-3.5 w-3.5" />
            {role === "educator" ? "Educator Classroom Workspace" : "Collaborative Learning Hub"}
          </span>
          <h1 className="font-fraunces text-[26px] font-bold text-[var(--ink)] mt-2">Study Rooms</h1>
          <p className="text-[14px] text-[var(--ink-soft)] mt-0.5">
            {role === "educator"
              ? "Your classes — manage live study sessions, lessons, and exams"
              : "Join peer study rooms or educator-led classes for real-time collaboration"}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setJoinOpen(true);
              setError(null);
            }}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs font-semibold text-[var(--ink)] shadow-xs transition-all hover:bg-[var(--bg)] hover:border-[var(--teal)] hover:shadow-sm"
          >
            <KeyRound className="h-4 w-4 text-[var(--teal)]" />
            Join with code
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setError(null);
            }}
            className="btn-primary !px-4 !py-2.5 !text-xs !rounded-[10px] shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="h-4 w-4" />
            Create Room
          </button>
        </div>
      </div>

      <AuthError message={error} />

      {rooms.length === 0 ? (
        <section className="rounded-[18px] border border-dashed border-[var(--border)] bg-[var(--surface)] text-center py-16 px-6 shadow-xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[14px] bg-gradient-to-br from-[var(--teal-pale)] to-[var(--violet-pale)] text-[var(--teal)] shadow-xs">
            <Users className="h-7 w-7" />
          </div>
          <h2 className="font-fraunces text-[22px] font-bold text-[var(--ink)] mt-4">No study rooms yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ink-soft)] leading-relaxed">
            Create a room to study live with peers, share flashcards &amp; quizzes, or join an existing room with an invite code.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="btn-primary !px-5 !py-2.5 !text-xs"
            >
              <Plus className="h-4 w-4" />
              Create your first room
            </button>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">
          {/* Left Room List */}
          <div className="space-y-2.5">
            <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-soft)] mb-2">
              Your Rooms ({rooms.length})
            </h2>
            {rooms.map((room) => {
              const isSelected = room.id === selectedRoomId;
              const isTeacher = room.type === "teacher";
              return (
                <div
                  key={room.id}
                  onClick={() => setSelectedRoomId(room.id)}
                  className={cn(
                    "group relative cursor-pointer rounded-[14px] border p-4 transition-all duration-200",
                    isSelected
                      ? "border-[var(--teal)] bg-gradient-to-r from-[var(--teal-pale)]/50 to-[var(--surface)] shadow-sm"
                      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--teal)]/40 hover:bg-[var(--bg)]"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <span className={cn(
                        "inline-block rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide mb-1.5",
                        isTeacher ? "bg-[var(--teal-pale)] text-[var(--teal-dark)]" : "bg-[var(--violet-pale)] text-[var(--violet-dark)]"
                      )}>
                        {isTeacher ? "Teacher-led" : "Peer study"}
                      </span>
                      <b className="block text-[15px] font-semibold text-[var(--ink)] truncate group-hover:text-[var(--teal)] transition-colors">
                        {room.name}
                      </b>
                      <span className="mt-1 flex items-center gap-2 text-[12px] text-[var(--ink-soft)]">
                        <Users className="h-3 w-3" /> {room.members.length} member{room.members.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--teal)] ring-4 ring-[var(--teal-pale)]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Selected Room Detail */}
          {selectedRoom ? (
            <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--border)]">
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--teal)] mb-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Active Room Overview
                    </span>
                    <h2 className="font-fraunces text-[23px] font-bold text-[var(--ink)]">
                      {selectedRoom.name}
                    </h2>
                    <p className="text-[13px] text-[var(--ink-soft)] mt-0.5">
                      {selectedRoom.members.length} participant{selectedRoom.members.length === 1 ? "" : "s"} · {selectedRoom.type === "teacher" ? "Teacher-led class" : "Peer study space"}
                    </p>
                  </div>
                  <Link
                    href={`/rooms/${selectedRoom.id}`}
                    className="btn-primary !px-4 !py-2.5 !text-xs !rounded-[10px] shadow-sm hover:shadow-md transition-all shrink-0"
                  >
                    Enter Room →
                  </Link>
                </div>

                <div className="py-4">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)] mb-2">
                    Room Members
                  </span>
                  <AvatarStack people={selectedRoom.members} max={7} />
                </div>

                {/* Shared Quiz Preview Card */}
                <div className="rounded-[14px] border border-[var(--teal)]/20 bg-gradient-to-br from-[var(--teal-pale)]/60 to-[var(--surface)] p-4 my-3 shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-bold text-[var(--teal-dark)] flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5 text-[var(--teal)]" />
                      Live Activity Preview
                    </span>
                    <span className="text-[11px] font-semibold text-[var(--ink-soft)]">Question 1 of 5</span>
                  </div>
                  <div className="text-[14px] font-semibold text-[var(--ink)] mb-3">
                    What determines an element&apos;s chemical reactivity?
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] text-[var(--ink-soft)]">
                      Atomic mass
                    </div>
                    <div className="rounded-[9px] bg-[var(--teal)] px-3.5 py-2 text-[13px] font-semibold text-white shadow-xs">
                      Valence electrons ✓
                    </div>
                    <div className="rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[13px] text-[var(--ink-soft)]">
                      Number of protons
                    </div>
                  </div>
                </div>

                {/* Chat preview */}
                <div className="space-y-2 mt-4 pt-3 border-t border-[var(--border)]">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)] mb-1">
                    Recent Room Chat
                  </span>
                  <div className="max-w-[85%] rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2 text-[13px] text-[var(--ink)]">
                    <span className="font-semibold text-[var(--ink-soft)] block text-[11px] mb-0.5">Jordan</span>
                    I always mix this one up during quizzes!
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-[12px] bg-[var(--violet-pale)] px-3.5 py-2 text-[13px] text-[var(--ink)]">
                    <span className="font-semibold text-[var(--violet)] block text-[11px] mb-0.5">You</span>
                    Remember, valence electrons drive chemical reactivity!
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {createOpen ? (
        <CreateRoomDialog
          onClose={() => setCreateOpen(false)}
          onDone={(id) => {
            setCreateOpen(false);
            router.refresh();
            router.push(`/rooms/${id}`);
          }}
          setBusy={setBusy}
          setError={setError}
          busy={busy}
        />
      ) : null}

      {joinOpen ? (
        <JoinRoomDialog
          onClose={() => setJoinOpen(false)}
          onDone={(id) => {
            setJoinOpen(false);
            router.refresh();
            router.push(`/rooms/${id}`);
          }}
          setBusy={setBusy}
          setError={setError}
          busy={busy}
        />
      ) : null}
    </div>
  );
}

function CreateRoomDialog({
  busy,
  onDone,
  onClose,
  setBusy,
  setError,
}: {
  busy: boolean;
  onDone: (roomId: string) => void;
  onClose: () => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("create_room", { p_name: trimmed });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      const roomId = row?.room_id as string | undefined;
      if (!roomId) throw new Error("Room creation failed — please try again.");
      celebrate(row);
      onDone(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Room creation failed.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Create a new study room" onClose={onClose} busy={busy}>
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <FieldLabel htmlFor="room-name">Room Name</FieldLabel>
          <TextInput
            id="room-name"
            placeholder="e.g. Organic Chemistry Study Group"
            value={name}
            maxLength={80}
            autoFocus
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            className="!rounded-[10px]"
          />
        </div>
        <SubmitButton busy={busy} disabled={name.trim() === ""}>
          {busy ? "Creating Room…" : "Create Room"}
        </SubmitButton>
      </form>
    </Modal>
  );
}

function JoinRoomDialog({
  busy,
  onDone,
  onClose,
  setBusy,
  setError,
}: {
  busy: boolean;
  onDone: (roomId: string) => void;
  onClose: () => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const [code, setCode] = useState("");

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("join_room_by_code", {
        p_code: trimmed,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Join failed — please try again.");
      onDone(data as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Join room with invite code" onClose={onClose} busy={busy}>
      <form onSubmit={handleJoin} className="space-y-4">
        <div>
          <FieldLabel htmlFor="invite-code">8-Character Invite Code</FieldLabel>
          <TextInput
            id="invite-code"
            placeholder="e.g. K7MQX2PA"
            value={code}
            maxLength={12}
            autoFocus
            disabled={busy}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="font-mono tracking-widest uppercase !rounded-[10px] !text-center !text-[16px] !font-bold"
          />
        </div>
        <SubmitButton busy={busy} disabled={code.trim() === ""}>
          {busy ? "Joining Room…" : "Join Room"}
        </SubmitButton>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-md animate-rise"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
          <h2 className="font-fraunces text-lg font-bold text-[var(--ink)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-[8px] h-8 w-8 flex items-center justify-center text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)] transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

