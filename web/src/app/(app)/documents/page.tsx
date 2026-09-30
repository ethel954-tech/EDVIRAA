import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, FileText, Layers, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UploadZone } from "./upload-zone";

export const metadata: Metadata = { title: "Documents" };

const statusStyles: Record<string, string> = {
  ready: "bg-[var(--teal-pale)] text-[var(--teal-dark)]",
  processing: "bg-[var(--violet-pale)] text-[var(--violet)]",
  failed: "bg-red-50 text-red-600",
};

const statusLabels: Record<string, string> = {
  ready: "Ready",
  processing: "Processing…",
  failed: "Failed",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
      .select("id, title, status, created_at, subject_id, subjects(name)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const subjectList = subjects ?? [];
  const documentList = documents ?? [];

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

      {documentList.length > 0 ? (
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

      <section aria-label="Uploaded documents">
        <h2 className="mb-3 font-sans text-base font-semibold text-[var(--ink)]">
          Your documents
        </h2>
        {documentList.length === 0 ? (
          <p className="card-study text-center text-sm text-[var(--ink-soft)] py-8">
            No documents yet — your uploads will appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {documentList.map((doc) => {
              const subj = Array.isArray(doc.subjects) ? doc.subjects[0] : doc.subjects;
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[var(--teal-pale)] text-[var(--teal)]">
                    <FileText className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{doc.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                      Uploaded {formatDate(doc.created_at)}
                    </p>
                  </div>
                  {subj?.name ? (
                    <span className="hidden items-center gap-1 rounded-full bg-[var(--teal-pale)] px-2.5 py-0.5 text-xs font-semibold text-[var(--teal-dark)] sm:flex">
                      <BookOpen className="h-3 w-3" />
                      {subj.name}
                    </span>
                  ) : null}
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[doc.status] ?? ""}`}
                  >
                    {statusLabels[doc.status] ?? doc.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

