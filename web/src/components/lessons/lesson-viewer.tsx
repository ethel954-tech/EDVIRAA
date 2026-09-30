"use client";

import { useState } from "react";
import { BookOpen, Download, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { LessonBlock } from "@/components/lessons/lesson-builder";

const CALLOUT_STYLES: Record<string, string> = {
  info: "border-primary-200 bg-primary-50 text-ink",
  tip: "border-secondary-200 bg-secondary-50 text-ink",
  warning: "border-accent-200 bg-accent-50 text-ink",
};

const CALLOUT_LABEL: Record<string, string> = {
  info: "Note",
  tip: "Tip",
  warning: "Important",
};

export type ViewerDoc = { id: string; title: string; storagePath: string };

function DocDownload({ doc }: { doc: ViewerDoc }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage
        .from("documents")
        .download(doc.storagePath);
      if (error || !data) throw new Error(error?.message ?? "Download failed");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="flex w-full items-center gap-2.5 rounded-btn border border-primary-100 px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-primary-50 disabled:opacity-60"
    >
      <FileText className="h-4 w-4 shrink-0 text-primary-600" />
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      <span className="shrink-0 text-xs font-medium text-primary-600">
        {error ? "failed" : busy ? "…" : <Download className="h-4 w-4" />}
      </span>
    </button>
  );
}

export function LessonViewer({
  title,
  roomName,
  blocks,
  documents,
}: {
  title: string;
  roomName: string;
  blocks: LessonBlock[];
  documents: ViewerDoc[];
}) {
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="flex items-center gap-2 text-sm text-ink/60">
          <BookOpen className="h-4 w-4 text-primary-600" />
          Lesson · <span className="font-medium text-ink">{roomName}</span>
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">{title}</h1>
      </header>

      {blocks.length === 0 ? (
        <p className="rounded-card border border-dashed border-primary-200 px-4 py-10 text-center text-sm text-ink/50">
          This lesson has no content yet.
        </p>
      ) : (
        <div className="space-y-4">
          {blocks.map((block, i) => {
            switch (block.type) {
              case "heading":
                return block.level === 1 ? (
                  <h2 key={i} className="pt-2 text-2xl font-semibold text-ink">
                    {block.text}
                  </h2>
                ) : block.level === 2 ? (
                  <h3 key={i} className="pt-2 text-xl font-semibold text-ink">
                    {block.text}
                  </h3>
                ) : (
                  <h4 key={i} className="pt-1 text-lg font-semibold text-ink">
                    {block.text}
                  </h4>
                );
              case "paragraph":
                return (
                  <p key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink/80">
                    {block.text}
                  </p>
                );
              case "callout":
                return (
                  <aside
                    key={i}
                    className={`rounded-card border px-4 py-3 ${CALLOUT_STYLES[block.tone] ?? CALLOUT_STYLES.info}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                      {CALLOUT_LABEL[block.tone] ?? "Note"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{block.text}</p>
                  </aside>
                );
              case "list":
                return (
                  <ol key={i} className="list-decimal space-y-1.5 pl-6 text-[15px] leading-relaxed text-ink/80">
                    {block.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ol>
                );
            }
          })}
        </div>
      )}

      {documents.length > 0 ? (
        <section className="rounded-card border border-primary-100 bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Attached documents
          </h2>
          <ul className="mt-3 space-y-1.5">
            {documents.map((d) => (
              <li key={d.id}>
                <DocDownload doc={d} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
