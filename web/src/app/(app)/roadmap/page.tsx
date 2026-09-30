import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RoadmapView, type ModuleUI } from "./roadmap-view";

export const metadata: Metadata = { title: "Roadmap" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoadmapPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Student-only surface.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role === "educator") redirect("/educator");

  const params = await searchParams;
  const requested = params.subject && UUID_RE.test(params.subject) ? params.subject : null;

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("student_id", user.id)
    .order("name");

  const subjectList = subjects ?? [];
  const selectedSubjectId =
    requested && subjectList.some((s) => s.id === requested)
      ? requested
      : (subjectList[0]?.id ?? null);

  let modules: ModuleUI[] = [];
  let hasDocuments = false;
  let subjectName: string | null = null;

  if (selectedSubjectId) {
    subjectName = subjectList.find((s) => s.id === selectedSubjectId)?.name ?? null;

    const [{ data: moduleRows }, { count }] = await Promise.all([
      supabase
        .from("modules")
        .select(
          "id, title, order_index, status, topics(id, title, order_index, completed_at)",
        )
        .eq("subject_id", selectedSubjectId)
        .order("order_index", { ascending: true }),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("student_id", user.id)
        .eq("subject_id", selectedSubjectId)
        .eq("status", "ready"),
    ]);

    modules = (moduleRows ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      topics: (m.topics ?? [])
        .map((t) => ({
          id: t.id,
          title: t.title,
          completed: t.completed_at !== null,
          order: t.order_index,
        }))
        // Generator's order_index = learning order within the module.
        .sort((a, b) => a.order - b.order)
        .map((t) => ({
          id: t.id,
          title: t.title,
          completed: t.completed,
        })),
    }));

    hasDocuments = (count ?? 0) > 0;
  }

  return (
    <RoadmapView
      subjects={subjectList}
      subjectId={selectedSubjectId}
      subjectName={subjectName}
      modules={modules}
      hasDocuments={hasDocuments}
    />
  );
}
