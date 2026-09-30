import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LessonBuilder } from "@/components/lessons/lesson-builder";

export const metadata: Metadata = { title: "New lesson" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewLessonPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { room } = await searchParams;
  if (!room || !UUID_RE.test(room)) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "educator") redirect("/dashboard");

  // RLS: the creator can select their room; anyone else 404s here.
  const { data: roomRow } = await supabase
    .from("rooms")
    .select("id, name")
    .eq("id", room)
    .single();
  if (!roomRow) notFound();

  // Attachable documents: everything the educator uploaded themselves.
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <LessonBuilder
      roomId={roomRow.id}
      roomName={roomRow.name}
      documents={(docs ?? []).map((d) => ({ id: d.id, title: d.title }))}
      lesson={null}
    />
  );
}
