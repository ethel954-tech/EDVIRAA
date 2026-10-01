import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UploadZone } from "./upload-zone";
import { DocumentDeleteActions } from "./documents-list";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "educator") redirect("/educator");
  if (!profile?.role) redirect("/auth/role");

  const [{ data: subjects }, { data: documents }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name")
      .eq("student_id", user.id)
      .order("name"),
    supabase
      .from("documents")
      .select("id, title, status, storage_path, created_at, subjects(name)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const subjectList = subjects ?? [];
  const documentRows = (documents ?? []).map((doc) => {
    const subj = Array.isArray(doc.subjects) ? doc.subjects[0] : doc.subjects;
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      storage_path: doc.storage_path,
      created_at: doc.created_at,
      subject_name: subj?.name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-[820px] px-4 py-8 space-y-6">
      <header>
        <h1 className="font-fraunces text-[26px] font-semibold text-[var(--ink)]">Documents</h1>
        <p className="mt-1 text-[14px] text-[var(--ink-soft)]">
          Upload your own study materials (PDFs). Everything you upload powers
          your AI tutor, flashcards, quizzes, and roadmap.
        </p>
      </header>

      <UploadZone subjects={subjectList} />

      {documentRows.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href="/flashcards"
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-dark)]"
          >
            <Layers className="h-3.5 w-3.5 text-[var(--teal)]" />
            Study with flashcards
          </Link>
          <Link
            href="/quiz"
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-dark)]"
          >
            <ListChecks className="h-3.5 w-3.5 text-[var(--teal)]" />
            Take a quiz
          </Link>
        </div>
      ) : null}

      <DocumentDeleteActions documents={documentRows} />
    </div>
  );
}
