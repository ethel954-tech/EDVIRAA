import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LessonBuilder } from "@/components/lessons/lesson-builder";
import { LessonViewer } from "@/components/lessons/lesson-viewer";
import type { LessonBlock } from "@/components/lessons/lesson-builder";

export const metadata: Metadata = { title: "Lesson" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LessonPage({
  params,
}: {
  params: Promise<{ "lesson-id": string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { "lesson-id": lessonId } = await params;
  if (!UUID_RE.test(lessonId)) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile?.role) redirect("/auth/role");

  // RLS: members of the lesson's room (incl. the creator) can select it.
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, room_id, created_by, title, lesson_blocks")
    .eq("id", lessonId)
    .single();
  if (!lesson) notFound();

  const [{ data: roomRow }, { data: docRows }] = await Promise.all([
    supabase.from("rooms").select("id, name").eq("id", lesson.room_id).single(),
    supabase
      .from("lesson_documents")
      .select("position, documents(id, title, storage_path)")
      .eq("lesson_id", lessonId)
      .order("position", { ascending: true }),
  ]);

  const attachedDocs = (docRows ?? [])
    .map((r) => {
      const d = Array.isArray(r.documents) ? r.documents[0] : r.documents;
      return d ? { id: d.id, title: d.title, storagePath: d.storage_path } : null;
    })
    .filter((d): d is { id: string; title: string; storagePath: string } => d !== null);

  // Creator gets the editor; students get the reader.
  if (lesson.created_by === user.id && profile.role === "educator") {
    const { data: allDocs } = await supabase
      .from("documents")
      .select("id, title")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    return (
      <LessonBuilder
        roomId={lesson.room_id}
        roomName={roomRow?.name ?? "Room"}
        documents={(allDocs ?? []).map((d) => ({ id: d.id, title: d.title }))}
        lesson={{
          id: lesson.id,
          title: lesson.title,
          blocks: (Array.isArray(lesson.lesson_blocks) ? lesson.lesson_blocks : []) as LessonBlock[],
          docIds: attachedDocs.map((d) => d.id),
        }}
      />
    );
  }

  return (
    <LessonViewer
      title={lesson.title}
      roomName={roomRow?.name ?? "Room"}
      blocks={(Array.isArray(lesson.lesson_blocks) ? lesson.lesson_blocks : []) as LessonBlock[]}
      documents={attachedDocs}
    />
  );
}
