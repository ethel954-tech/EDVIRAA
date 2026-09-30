"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Copy, ListChecks, Send, Sparkles, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { celebrate } from "@/components/ui/toast";
import { AuthError, TextInput } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type RoomMember = {
  userId: string;
  name: string;
  color: number | null;
  isYou: boolean;
  isOwner: boolean;
};

export type ChatMessage = {
  id: string;
  userId: string;
  name: string;
  color: number | null;
  content: string;
  createdAt: string;
  isYou: boolean;
};

export type SharedActivityItem = {
  id: string;
  prompt: string;
  reveal: string;
  options: { key: string; text: string }[];
};

export type SharedActivityAnswer = {
  itemId: string;
  userId: string;
  answer: string;
  isCorrect: boolean | null;
};

export type SharedActivity = {
  sessionId: string;
  hostId: string;
  kind: "quiz" | "flashcards";
  sourceTitle: string;
  currentIndex: number;
  status: "active" | "ended";
  items: SharedActivityItem[];
  answers: SharedActivityAnswer[];
};

export type SharableMaterial = {
  quizzes: { id: string; title: string; count: number }[];
  decks: { id: string; title: string; count: number }[];
};

export type RoomLesson = { id: string; title: string; createdAt: string; isMine: boolean };
export type RoomExam = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  isMine: boolean;
};

const AVATAR_STYLES = [
  "bg-primary-100 text-primary-700",
  "bg-secondary-100 text-secondary-700",
  "bg-accent-100 text-accent-700",
  "bg-primary-200 text-primary-800",
  "bg-secondary-200 text-secondary-800",
  "bg-accent-200 text-accent-800",
  "bg-surface-muted text-ink/70",
  "bg-primary-50 text-primary-600",
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function RoomView({
  roomId,
  roomName,
  roomType,
  inviteCode,
  currentUserId,
  you,
  members,
  initialMessages,
  initialActivity,
  sharable,
  materials,
}: {
  roomId: string;
  roomName: string;
  roomType: "peer" | "teacher";
  inviteCode: string | null;
  currentUserId: string;
  you: { name: string; color: number | null };
  members: RoomMember[];
  initialMessages: ChatMessage[];
  initialActivity: SharedActivity | null;
  sharable: SharableMaterial;
  materials: { lessons: RoomLesson[]; exams: RoomExam[] };
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "live">("connecting");

  // ---- Shared activity state (Task 12) ----
  const [activity, setActivity] = useState<SharedActivity | null>(initialActivity);
  // Feedback for the item I answered; itemId-gated so it can never leak to
  // another item when the host moves everyone on.
  const [feedback, setFeedback] = useState<{
    itemId: string;
    correctKey: string | null;
    reveal: string;
  } | null>(null);
  // Flashcard flip is keyed by item id, so it resets when the item changes
  // without any effect (derived value falls back to false for new items).
  const [flip, setFlip] = useState<{ itemId: string; flipped: boolean }>({
    itemId: "",
    flipped: false,
  });
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [busyActivity, setBusyActivity] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"members" | "activity" | "classroom">(
    initialActivity ? "activity" : "members",
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, rosterOpen]);

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );

  const activityItem = activity?.items[activity.currentIndex] ?? null;
  const isHost = activity?.hostId === currentUserId;

  // My answer + answered-ness derive straight from the shared answers (the
  // realtime broadcast and the optimistic update both feed the same list),
  // so there is no per-item state to reset when the host moves everyone on.
  const myItemAnswer =
    activity && activityItem
      ? (activity.answers.find(
          (a) => a.itemId === activityItem.id && a.userId === currentUserId,
        ) ?? null)
      : null;
  const answered = myItemAnswer !== null;
  const itemFlipped =
    activityItem !== null && flip.itemId === activityItem.id && flip.flipped;

  // Adopt a hydrated session after router.refresh() (someone started an
  // activity): render-time adjustment, the React-endorsed replacement for
  // setState-in-effect.
  const [prevInitialActivity, setPrevInitialActivity] = useState(initialActivity);
  if (initialActivity !== prevInitialActivity) {
    setPrevInitialActivity(initialActivity);
    if (
      initialActivity &&
      initialActivity.sessionId !== activity?.sessionId
    ) {
      setActivity(initialActivity);
      setSidebarTab("activity");
    }
  }

  const fetchFeedback = useCallback(
    async (sessionId: string, itemId: string) => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("get_room_session_feedback", {
          p_session_id: sessionId,
          p_item_id: itemId,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        setFeedback({
          itemId,
          correctKey: row?.correct_key ?? null,
          reveal: row?.reveal ?? "",
        });
      } catch {
        setFeedback(null);
      }
    },
    [],
  );

  // -------------------------------------------------------------- Realtime
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            user_id: string;
            content: string;
            created_at: string;
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev; // dedupe
            const member = memberNames.get(row.user_id);
            return [
              ...prev,
              {
                id: row.id,
                userId: row.user_id,
                name: member?.name ?? "Member",
                color: member?.color ?? null,
                content: row.content,
                createdAt: row.created_at,
                isYou: row.user_id === currentUserId,
              },
            ];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          // New member joined: refresh the server roster (cheap RSC re-render).
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_sessions",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          // Someone started a shared activity: hydrate via the server page.
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lessons",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          // Educator assigned a lesson: refresh the classwork lists.
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "exams",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          // Educator assigned an exam: refresh the classwork lists.
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "room_sessions",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          // Host moved everyone to another item, or ended the activity.
          const row = payload.new as {
            id: string;
            current_item_index: number;
            status: string;
          };
          setActivity((prev) =>
            prev && prev.sessionId === row.id
              ? {
                  ...prev,
                  currentIndex: row.current_item_index,
                  status: row.status === "ended" ? "ended" : "active",
                }
              : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_session_answers",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          // Live answer tally (INSERT or re-answer UPDATE).
          const row = payload.new as {
            session_id: string;
            item_id: string;
            user_id: string;
            answer: string;
            is_correct: boolean | null;
          };
          setActivity((prev) => {
            if (!prev || prev.sessionId !== row.session_id) return prev;
            const others = prev.answers.filter(
              (a) => !(a.itemId === row.item_id && a.userId === row.user_id),
            );
            return {
              ...prev,
              answers: [
                ...others,
                {
                  itemId: row.item_id,
                  userId: row.user_id,
                  answer: row.answer,
                  isCorrect: row.is_correct,
                },
              ],
            };
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("live");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // memberNames/currentUserId are stable for the room's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---------------------------------------------------------------- Send
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    // Optimistic bubble; replaced when the INSERT event echoes back.
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        userId: currentUserId,
        name: you.name,
        color: you.color,
        content: text,
        createdAt: new Date().toISOString(),
        isYou: true,
      },
    ]);
    setInput("");

    try {
      const supabase = createClient();
      const { error } = await supabase.from("room_messages").insert({
        room_id: roomId,
        user_id: currentUserId,
        content: text,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text);
      setError(e instanceof Error ? e.message : "Message failed to send.");
    } finally {
      setSending(false);
    }
  }

  // ---------------------------------------------------- Shared activities
  async function startSession(kind: "quiz" | "flashcards", sourceId: string) {
    setError(null);
    setBusyActivity(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("start_room_session", {
        p_room_id: roomId,
        p_kind: kind,
        p_source_id: sourceId,
      });
      if (error) throw new Error(error.message);
      setSharePickerOpen(false);
      // The realtime INSERT event triggers router.refresh(); the effect below
      // adopts the hydrated session. This refresh is the no-realtime fallback.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the activity.");
    } finally {
      setBusyActivity(false);
    }
  }

  async function submitAnswer(value: string) {
    if (!activity || !activityItem || answered) return;
    setError(null);
    // Optimistic: upsert my answer into the shared list; the realtime event
    // (server-graded) replaces it.
    const itemId = activityItem.id;
    setActivity((prev) =>
      prev
        ? {
            ...prev,
            answers: [
              ...prev.answers.filter(
                (a) => !(a.itemId === itemId && a.userId === currentUserId),
              ),
              { itemId, userId: currentUserId, answer: value, isCorrect: null },
            ],
          }
        : prev,
    );
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_room_session_answer", {
        p_session_id: activity.sessionId,
        p_item_id: itemId,
        p_answer: value,
      });
      if (error) throw new Error(error.message);
      void fetchFeedback(activity.sessionId, itemId);
    } catch (e) {
      // Roll back the optimistic answer.
      setActivity((prev) =>
        prev
          ? {
              ...prev,
              answers: prev.answers.filter(
                (a) => !(a.itemId === itemId && a.userId === currentUserId),
              ),
            }
          : prev,
      );
      setError(e instanceof Error ? e.message : "Could not record your answer.");
    }
  }

  async function gotoItem(index: number) {
    if (!activity || !isHost) return;
    setBusyActivity(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_room_session_item", {
        p_session_id: activity.sessionId,
        p_index: index,
      });
      if (error) throw new Error(error.message);
      setActivity((prev) => (prev ? { ...prev, currentIndex: index } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the question.");
    } finally {
      setBusyActivity(false);
    }
  }

  async function endSession() {
    if (!activity) return;
    setBusyActivity(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("end_room_session", {
        p_session_id: activity.sessionId,
      });
      if (error) throw new Error(error.message);
      // Gamification: session-completion XP + any new badge (host's toast).
      celebrate(Array.isArray(data) ? data[0] : data);
      setActivity((prev) => (prev ? { ...prev, status: "ended" } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the activity.");
    } finally {
      setBusyActivity(false);
    }
  }

  async function copyInvite() {
    if (!inviteCode) return;
    const url = `${window.location.origin}/rooms/join?code=${inviteCode}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard may be blocked; the code alone is still shareable.
      await navigator.clipboard.writeText(inviteCode).catch(() => {});
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface)] shadow-md lg:flex-row animate-rise">
      {/* ------------------------------------------------------------- Main Chat */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-gradient-to-r from-[var(--surface)] via-[var(--surface)] to-[var(--teal-pale)]/30 px-5 py-3.5 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-[var(--teal-pale)] to-[var(--violet-pale)] text-[var(--teal)] shadow-xs">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-base font-bold text-[var(--ink)]">{roomName}</p>
                <span className="rounded-md bg-[var(--teal-pale)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--teal-dark)]">
                  {roomType === "teacher" ? "Class" : "Peer Study"}
                </span>
              </div>
              <p className="truncate text-xs text-[var(--ink-soft)] mt-0.5 flex items-center gap-1.5">
                <span className={cn("inline-block h-2 w-2 rounded-full", connection === "live" ? "bg-emerald-500 animate-pulse" : "bg-amber-400")} />
                {connection === "live" ? "Live session active" : "Connecting..."} · {members.length} member{members.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {inviteCode ? (
              <button
                type="button"
                onClick={copyInvite}
                className="flex items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] shadow-xs transition-all hover:bg-[var(--bg)] hover:border-[var(--teal)]"
                title="Click to copy invite link"
              >
                <span className="font-mono text-[11px] tracking-wider uppercase text-[var(--teal-dark)]">{inviteCode}</span>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-[var(--ink-soft)]" />}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setRosterOpen((v) => !v)}
              className="flex shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] transition-colors hover:bg-[var(--bg)] lg:hidden"
            >
              <Users className="h-3.5 w-3.5" />
              {members.length}
            </button>
          </div>
        </header>

        {/* Messages Thread */}
        <div ref={scrollRef} className="flex-1 space-y-3.5 overflow-y-auto px-5 py-5 bg-[var(--bg)]/40">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--teal-pale)] text-[var(--teal)] shadow-xs">
                <Send className="h-7 w-7" />
              </span>
              <h3 className="font-fraunces text-lg font-bold text-[var(--ink)] mt-3">Welcome to {roomName}</h3>
              <p className="mt-1 max-w-sm text-xs text-[var(--ink-soft)] leading-relaxed">
                Send a message to start studying together! Anyone with the invite code <code className="font-mono font-bold text-[var(--teal)]">{inviteCode}</code> can join this room.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex items-end gap-2.5",
                  m.isYou ? "justify-end" : "justify-start",
                )}
              >
                {!m.isYou ? (
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold shadow-xs",
                      AVATAR_STYLES[(m.color ?? 0) % AVATAR_STYLES.length],
                    )}
                  >
                    {initials(m.name)}
                  </span>
                ) : null}
                <div className={cn("max-w-[76%]", m.isYou && "text-right")}>
                  {!m.isYou ? (
                    <p className="mb-1 text-[11px] font-semibold text-[var(--ink-soft)] px-1">
                      {m.name}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      "inline-block whitespace-pre-wrap rounded-[16px] px-4 py-2.5 text-[14px] leading-relaxed shadow-2xs",
                      m.isYou
                        ? "rounded-br-[4px] bg-[var(--teal)] text-white font-normal"
                        : "rounded-bl-[4px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]",
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Message Composer */}
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-4 pt-3">
          <AuthError message={error} />
          <form
            className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--bg)] p-1.5 pl-4 shadow-2xs focus-within:border-[var(--teal)] focus-within:ring-2 focus-within:ring-[var(--teal-pale)] transition-all"
            onSubmit={handleSend}
          >
            <input
              value={input}
              placeholder="Message the room..."
              maxLength={2000}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Message the room"
              className="flex-1 border-none bg-transparent text-[14px] text-[var(--ink)] placeholder-[var(--ink-soft)] outline-none"
            />
            <button
              type="submit"
              disabled={sending || input.trim() === ""}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal)] text-white transition-all hover:bg-[var(--teal-dark)] disabled:opacity-40 shadow-xs"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </section>

      {/* ----------------------------------------------------------- Roster */}
      <aside
        className={cn(
          "shrink-0 border-primary-100 lg:flex lg:w-64 lg:flex-col lg:border-l",
          rosterOpen
            ? "flex flex-col border-t"
            : "hidden",
        )}
      >
        <div className="flex gap-1 px-3 pt-3">
          {(
            [
              ["members", `Members (${members.length})`],
              ["activity", "Activity"],
              ["classroom", `Classwork (${materials.lessons.length + materials.exams.length})`],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSidebarTab(tab)}
              className={cn(
                "flex-1 rounded-btn px-2 py-1.5 text-xs font-semibold transition-colors",
                sidebarTab === tab
                  ? "bg-primary-50 text-primary-700"
                  : "text-ink/50 hover:bg-surface-muted hover:text-ink",
              )}
            >
              {label}
              {tab === "activity" && activity?.status === "active" ? " ●" : ""}
            </button>
          ))}
        </div>

        {sidebarTab === "members" ? (
          <ul className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-2.5 rounded-btn px-2 py-2"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    AVATAR_STYLES[(m.color ?? 0) % AVATAR_STYLES.length],
                  )}
                >
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {m.name}
                    {m.isYou ? " (you)" : ""}
                  </span>
                  {m.isOwner ? (
                    <span className="block text-[11px] text-secondary-600">
                      {roomType === "teacher" ? "Educator" : "Creator"}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : sidebarTab === "activity" ? (
          <ActivityPanel
            activity={activity}
            isHost={isHost}
            currentUserId={currentUserId}
            members={members}
            myAnswer={myItemAnswer?.answer ?? null}
            answered={answered}
            feedback={
              activityItem && feedback?.itemId === activityItem.id ? feedback : null
            }
            cardFlipped={itemFlipped}
            onFlip={() =>
              activityItem && setFlip({ itemId: activityItem.id, flipped: true })
            }
            busy={busyActivity}
            onAnswer={submitAnswer}
            onGoto={gotoItem}
            onEnd={endSession}
            onStartShare={() => setSharePickerOpen(true)}
          />
        ) : (
          <ClassroomPanel
            roomId={roomId}
            roomType={roomType}
            canBuild={
              roomType === "teacher" &&
              (members.find((m) => m.isOwner)?.isYou ?? false)
            }
            lessons={materials.lessons}
            exams={materials.exams}
          />
        )}

        {inviteCode ? (
          <div className="border-t border-primary-100 p-4">
            <p className="text-xs font-medium text-ink/60">Invite code</p>
            <button
              type="button"
              onClick={copyInvite}
              className="mt-1.5 flex w-full items-center justify-between rounded-btn border border-primary-100 bg-surface px-3 py-2 font-mono text-sm tracking-widest text-ink transition-colors hover:bg-primary-50"
              title="Copy invite link"
            >
              {inviteCode}
              {copied ? (
                <Check className="h-4 w-4 text-primary-600" />
              ) : (
                <Copy className="h-4 w-4 text-ink/40" />
              )}
            </button>
            <p className="mt-1.5 text-[11px] text-ink/40">
              {copied
                ? "Invite link copied!"
                : "Click to copy the invite link — anyone with it can join."}
            </p>
          </div>
        ) : null}
      </aside>

      {sharePickerOpen ? (
        <SharePickerModal
          sharable={sharable}
          busy={busyActivity}
          onClose={() => setSharePickerOpen(false)}
          onStart={startSession}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Classwork panel: lessons & exams assigned to this room (Task 15).
// ----------------------------------------------------------------------------
function ClassroomPanel({
  roomId,
  roomType,
  canBuild,
  lessons,
  exams,
}: {
  roomId: string;
  roomType: "peer" | "teacher";
  canBuild: boolean;
  lessons: RoomLesson[];
  exams: RoomExam[];
}) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
      <section>
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Lessons
          </h3>
          {canBuild ? (
            <Link
              href={`/lessons/new?room=${roomId}`}
              className="text-xs font-medium text-primary-600 hover:underline"
            >
              + New
            </Link>
          ) : null}
        </div>
        {lessons.length === 0 ? (
          <p className="mt-1.5 rounded-btn border border-dashed border-primary-100 px-3 py-3 text-[11px] leading-relaxed text-ink/40">
            {roomType === "teacher"
              ? "No lessons assigned yet."
              : "Lessons appear here when assigned."}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/lessons/${l.id}`}
                  className="flex items-center gap-2 rounded-btn px-2 py-2 text-sm text-ink transition-colors hover:bg-primary-50"
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-primary-600" />
                  <span className="min-w-0 flex-1 truncate">{l.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Exams
          </h3>
          {canBuild ? (
            <Link
              href={`/exams/new?room=${roomId}`}
              className="text-xs font-medium text-primary-600 hover:underline"
            >
              + New
            </Link>
          ) : null}
        </div>
        {canBuild ? (
          <Link
            href={`/rooms/${roomId}/insights`}
            className="mt-2 block rounded-btn border border-primary-100 px-3 py-2 text-xs font-medium text-ink/70 transition-colors hover:bg-primary-50 hover:text-primary-700"
          >
            View class knowledge gaps →
          </Link>
        ) : null}
        {exams.length === 0 ? (
          <p className="mt-1.5 rounded-btn border border-dashed border-primary-100 px-3 py-3 text-[11px] leading-relaxed text-ink/40">
            {roomType === "teacher"
              ? "No exams assigned yet."
              : "Exams appear here when assigned."}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {exams.map((x) => (
              <li key={x.id}>
                <Link
                  href={`/exams/${x.id}`}
                  className="flex items-center gap-2 rounded-btn px-2 py-2 text-sm text-ink transition-colors hover:bg-primary-50"
                >
                  <ListChecks className="h-4 w-4 shrink-0 text-secondary-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{x.title}</span>
                    {x.description ? (
                      <span className="block truncate text-[11px] text-ink/40">
                        {x.description}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared activity panel: everyone sees the same item; answers tally live.
// ----------------------------------------------------------------------------
function ActivityPanel({
  activity,
  isHost,
  currentUserId,
  members,
  myAnswer,
  answered,
  feedback,
  cardFlipped,
  onFlip,
  busy,
  onAnswer,
  onGoto,
  onEnd,
  onStartShare,
}: {
  activity: SharedActivity | null;
  isHost: boolean;
  currentUserId: string;
  members: RoomMember[];
  myAnswer: string | null;
  answered: boolean;
  feedback: { correctKey: string | null; reveal: string } | null;
  cardFlipped: boolean;
  onFlip: () => void;
  busy: boolean;
  onAnswer: (value: string) => void;
  onGoto: (index: number) => void;
  onEnd: () => void;
  onStartShare: () => void;
}) {
  if (!activity || activity.status !== "active" || activity.items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-card bg-primary-50 text-primary-600">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="mt-3 text-xs leading-relaxed text-ink/50">
          No shared activity running. Share one of your quizzes or flashcard
          decks with the room — everyone answers the same question at the same
          time.
        </p>
        <button
          type="button"
          onClick={onStartShare}
          className="mt-4 rounded-btn bg-primary-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-700"
        >
          Share an activity
        </button>
      </div>
    );
  }

  const item = activity.items[activity.currentIndex];
  if (!item) return null;

  const itemAnswers = activity.answers.filter((a) => a.itemId === item.id);
  const answeredCount = itemAnswers.length;
  const nameOf = (userId: string) =>
    members.find((m) => m.userId === userId)?.name ??
    (userId === currentUserId ? "You" : "Member");

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink/40">
          {activity.kind === "quiz" ? "Shared quiz" : "Shared flashcards"} ·{" "}
          {activity.sourceTitle}
        </p>
        {isHost ? (
          <button
            type="button"
            onClick={onEnd}
            disabled={busy}
            title="End activity for everyone"
            className="shrink-0 rounded-btn p-1 text-ink/40 transition-colors hover:bg-accent-50 hover:text-accent-600 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {/* Progress dots */}
      <div className="flex flex-wrap items-center gap-1">
        {activity.items.map((_, i) => (
          <button
            key={i}
            type="button"
            disabled={!isHost || busy}
            onClick={() => onGoto(i)}
            title={isHost ? `Go to item ${i + 1}` : undefined}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === activity.currentIndex
                ? "w-5 bg-secondary-500"
                : "w-1.5 bg-ink/15",
              isHost && "hover:bg-secondary-300",
            )}
          />
        ))}
        <span className="ml-1 text-[11px] text-ink/40">
          {activity.currentIndex + 1}/{activity.items.length}
        </span>
      </div>

      {/* The shared item */}
      <div className="rounded-card border border-primary-100 bg-surface p-3">
        <p className="text-sm font-medium leading-relaxed text-ink">{item.prompt}</p>

        {activity.kind === "quiz" ? (
          <div className="mt-2.5 space-y-1.5">
            {item.options.map((opt) => {
              const picked = myAnswer === opt.key;
              const correct = feedback?.correctKey ?? null;
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={answered || busy}
                  onClick={() => onAnswer(opt.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-btn border px-2.5 py-1.5 text-left text-xs transition-colors",
                    answered && correct && opt.key === correct
                      ? "border-primary-500 bg-primary-50 font-medium text-primary-800"
                      : picked
                        ? "border-secondary-500 bg-secondary-50 text-secondary-800"
                        : "border-primary-100 hover:bg-surface-muted",
                    answered && !picked && opt.key !== correct && "opacity-60",
                  )}
                >
                  <span className="font-semibold">{opt.key}.</span> {opt.text}
                </button>
              );
            })}
            {answered && feedback ? (
              <p
                className={cn(
                  "rounded-btn px-2.5 py-1.5 text-xs leading-relaxed",
                  feedback.correctKey === myAnswer
                    ? "bg-primary-50 text-primary-800"
                    : "bg-accent-50 text-accent-700",
                )}
              >
                {feedback.correctKey === myAnswer
                  ? "Correct! "
                  : `The answer was ${feedback.correctKey}. `}
                {feedback.reveal}
              </p>
            ) : null}
          </div>
        ) : (
          // Flashcards: self-assessed flip, synced by the host's position.
          <div className="mt-2.5">
            {cardFlipped || answered ? (
              <div className="rounded-btn border border-secondary-200 bg-secondary-50 px-2.5 py-2 text-xs leading-relaxed text-ink">
                {item.reveal}
              </div>
            ) : (
              <button
                type="button"
                onClick={onFlip}
                className="w-full rounded-btn border border-primary-100 px-2.5 py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-surface-muted"
              >
                Tap to reveal the answer
              </button>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={answered || busy}
                onClick={() => onAnswer("got_it")}
                className={cn(
                  "flex-1 rounded-btn border px-2 py-1.5 text-xs font-medium transition-colors",
                  myAnswer === "got_it"
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-primary-100 hover:bg-primary-50",
                  answered && myAnswer !== "got_it" && "opacity-60",
                )}
              >
                Got it
              </button>
              <button
                type="button"
                disabled={answered || busy}
                onClick={() => onAnswer("missed_it")}
                className={cn(
                  "flex-1 rounded-btn border px-2 py-1.5 text-xs font-medium transition-colors",
                  myAnswer === "missed_it"
                    ? "border-accent-400 bg-accent-50 text-accent-700"
                    : "border-primary-100 hover:bg-accent-50",
                  answered && myAnswer !== "missed_it" && "opacity-60",
                )}
              >
                Missed it
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Live tally: who answered and (for the host) what they picked. */}
      <div className="rounded-card border border-primary-100 bg-surface p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink/40">
          Answers ({answeredCount}/{members.length})
        </p>
        {answeredCount === 0 ? (
          <p className="mt-1.5 text-xs text-ink/40">Waiting for answers…</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {itemAnswers.map((a) => (
              <li
                key={a.userId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate text-ink/70">{nameOf(a.userId)}</span>
                {activity.kind === "quiz" ? (
                  a.isCorrect === null ? null : a.isCorrect ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-accent-500" />
                  )
                ) : (
                  <span
                    className={cn(
                      "shrink-0 font-medium",
                      a.answer === "got_it" ? "text-primary-600" : "text-accent-500",
                    )}
                  >
                    {a.answer === "got_it" ? "got it" : "missed it"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Host navigation */}
      {isHost ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || activity.currentIndex === 0}
            onClick={() => onGoto(activity.currentIndex - 1)}
            className="flex-1 rounded-btn border border-primary-100 px-2 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            ← Prev
          </button>
          {activity.currentIndex < activity.items.length - 1 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onGoto(activity.currentIndex + 1)}
              className="flex-1 rounded-btn bg-primary-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-40"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onEnd}
              className="flex-1 rounded-btn bg-accent-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-40"
            >
              Finish
            </button>
          )}
        </div>
      ) : (
        <p className="text-center text-[11px] text-ink/40">
          {activity.kind === "quiz"
            ? "Answer to see the tally update live."
            : "Everyone is on this card — reveal and self-assess."}
        </p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Picker for what to share (host's own material only).
// ----------------------------------------------------------------------------
function SharePickerModal({
  sharable,
  busy,
  onClose,
  onStart,
}: {
  sharable: SharableMaterial;
  busy: boolean;
  onClose: () => void;
  onStart: (kind: "quiz" | "flashcards", sourceId: string) => void;
}) {
  const [kind, setKind] = useState<"quiz" | "flashcards" | null>(null);
  const list =
    kind === "quiz"
      ? sharable.quizzes.map((q) => ({ ...q, icon: ListChecks }))
      : kind === "flashcards"
        ? sharable.decks.map((d) => ({ ...d, icon: BookOpen }))
        : [];
  const nothingToShare =
    sharable.quizzes.length === 0 && sharable.decks.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share an activity"
    >
      <div className="w-full max-w-md rounded-card border border-primary-100 bg-surface p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-ink">Share an activity</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-btn px-2 py-1 text-sm text-ink/40 transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {nothingToShare ? (
          <p className="mt-4 text-sm leading-relaxed text-ink/60">
            You have no quizzes or flashcards yet. Generate them from your
            documents first (Flashcards or Quiz pages), then share them here.
          </p>
        ) : kind === null ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setKind("quiz")}
              disabled={sharable.quizzes.length === 0}
              className="rounded-card border border-primary-100 p-4 text-center transition-colors hover:bg-primary-50 disabled:opacity-40"
            >
              <ListChecks className="mx-auto h-6 w-6 text-primary-600" />
              <span className="mt-2 block text-sm font-medium text-ink">Quiz</span>
              <span className="block text-xs text-ink/40">
                {sharable.quizzes.length} available
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("flashcards")}
              disabled={sharable.decks.length === 0}
              className="rounded-card border border-primary-100 p-4 text-center transition-colors hover:bg-primary-50 disabled:opacity-40"
            >
              <BookOpen className="mx-auto h-6 w-6 text-primary-600" />
              <span className="mt-2 block text-sm font-medium text-ink">Flashcards</span>
              <span className="block text-xs text-ink/40">
                {sharable.decks.length} available
              </span>
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setKind(null)}
              className="mt-3 text-xs font-medium text-primary-600 hover:underline"
            >
              ← Back
            </button>
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {list.map(({ id, title, count, icon: Icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    disabled={busy || count === 0}
                    onClick={() => onStart(kind, id)}
                    className="flex w-full items-center gap-2.5 rounded-btn border border-primary-100 px-3 py-2.5 text-left transition-colors hover:bg-primary-50 disabled:opacity-50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-primary-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {title}
                      </span>
                      <span className="block text-xs text-ink/40">
                        {count} item{count === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
