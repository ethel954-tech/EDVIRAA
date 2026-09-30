import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  RoomView,
  type ChatMessage,
  type RoomExam,
  type RoomLesson,
  type RoomMember,
  type SharedActivity,
} from "./room-view";

export const metadata: Metadata = { title: "Room" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomDetailPage({
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

  // RLS: only members/creators can select the room — a non-member 404s.
  const { data: room } = await supabase
    .from("rooms")
    .select("id, name, type, invite_code, created_by")
    .eq("id", roomId)
    .single();

  if (!room) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, avatar_color")
    .eq("id", user.id)
    .single();

  // Roster (RLS: members see the whole room's roster) for avatars + names.
  const { data: roster } = await supabase
    .from("room_members")
    .select("user_id, joined_at, profiles(display_name, avatar_color)")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  const members: RoomMember[] = (roster ?? []).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return {
      userId: m.user_id,
      name: p?.display_name ?? "Member",
      color: p?.avatar_color ?? null,
      isYou: m.user_id === user.id,
      isOwner: m.user_id === room.created_by,
    };
  });

  // Recent history; realtime takes over from here.
  const { data: history } = await supabase
    .from("room_messages")
    .select("id, user_id, content, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(60);

  const messages: ChatMessage[] = (history ?? [])
    .map((m) => {
      const member = members.find((x) => x.userId === m.user_id);
      return {
        id: m.id,
        userId: m.user_id,
        name: member?.name ?? "Member",
        color: member?.color ?? null,
        content: m.content,
        createdAt: m.created_at,
        isYou: m.user_id === user.id,
      };
    })
    .reverse();

  // Active shared activity (Task 12): one per room at a time. The answer key
  // (correct_key) is deliberately NOT selected — grading/feedback comes from
  // the server-graded answers, so the key never reaches the client.
  const { data: activeSession } = await supabase
    .from("room_sessions")
    .select("id, host_id, kind, source_title, current_item_index, status")
    .eq("room_id", roomId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let activity: SharedActivity | null = null;
  if (activeSession) {
    const [{ data: items }, { data: answers }] = await Promise.all([
      supabase
        .from("room_session_items")
        .select("id, order_index, prompt, reveal, options")
        .eq("session_id", activeSession.id)
        .order("order_index", { ascending: true }),
      supabase
        .from("room_session_answers")
        .select("item_id, user_id, answer, is_correct")
        .eq("session_id", activeSession.id),
    ]);

    activity = {
      sessionId: activeSession.id,
      hostId: activeSession.host_id,
      kind: activeSession.kind === "quiz" ? "quiz" : "flashcards",
      sourceTitle: activeSession.source_title,
      currentIndex: activeSession.current_item_index,
      status: "active",
      items: (items ?? []).map((i) => ({
        id: i.id,
        prompt: i.prompt,
        reveal: i.reveal,
        options: Array.isArray(i.options)
          ? (i.options as { key: string; text: string }[])
          : [],
      })),
      answers: (answers ?? []).map((a) => ({
        itemId: a.item_id,
        userId: a.user_id,
        answer: a.answer,
        isCorrect: a.is_correct,
      })),
    };
  }

  // What the current user can share as an activity: their quizzes and their
  // flashcard decks (only your own material can be snapshotted into a room).
  const [{ data: myQuizzes }, { data: myDocs }] = await Promise.all([
    supabase
      .from("quizzes")
      .select("id, title, quiz_questions(count)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("documents")
      .select("id, title, flashcards(count)")
      .eq("student_id", user.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const sharable = {
    quizzes: (myQuizzes ?? []).map((q) => ({
      id: q.id,
      title: q.title,
      count: Array.isArray(q.quiz_questions) ? (q.quiz_questions[0]?.count ?? 0) : 0,
    })),
    decks: (myDocs ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      count: Array.isArray(d.flashcards) ? (d.flashcards[0]?.count ?? 0) : 0,
    })),
  };

  // Classwork assigned to this room (Task 15): lessons + exams. Every member
  // can read them (RLS); the creator additionally gets edit links in the UI.
  const [{ data: roomLessons }, { data: roomExams }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, title, created_by, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("exams")
      .select("id, title, description, created_by, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const materials: { lessons: RoomLesson[]; exams: RoomExam[] } = {
    lessons: (roomLessons ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      createdAt: l.created_at,
      isMine: l.created_by === user.id,
    })),
    exams: (roomExams ?? []).map((x) => ({
      id: x.id,
      title: x.title,
      description: x.description,
      createdAt: x.created_at,
      isMine: x.created_by === user.id,
    })),
  };

  return (
    <RoomView
      roomId={room.id}
      roomName={room.name}
      roomType={room.type}
      inviteCode={room.invite_code}
      currentUserId={user.id}
      you={{ name: profile?.display_name ?? "You", color: profile?.avatar_color ?? null }}
      members={members}
      initialMessages={messages}
      initialActivity={activity}
      sharable={sharable}
      materials={materials}
    />
  );
}
