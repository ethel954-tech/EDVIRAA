"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileText,
  Heading1,
  Link2,
  ListOrdered,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthError, FieldLabel, SubmitButton, TextInput } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type LessonBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "callout"; text: string; tone: "info" | "tip" | "warning" }
  | { type: "list"; items: string[] };

export type LessonDocOption = { id: string; title: string };

const BLOCK_KINDS = [
  { type: "heading", label: "Heading", icon: Heading1 },
  { type: "paragraph", label: "Paragraph", icon: StickyNote },
  { type: "callout", label: "Callout", icon: Link2 },
  { type: "list", label: "List", icon: ListOrdered },
] as const;

function newBlock(type: LessonBlock["type"]): LessonBlock {
  switch (type) {
    case "heading":
      return { type: "heading", text: "", level: 2 };
    case "paragraph":
      return { type: "paragraph", text: "" };
    case "callout":
      return { type: "callout", text: "", tone: "tip" };
    case "list":
      return { type: "list", items: [""] };
  }
}

/** Blocks must be non-empty before saving (the DB validator enforces shapes). */
function blocksAreValid(blocks: LessonBlock[]): boolean {
  return blocks.every((b) => {
    switch (b.type) {
      case "heading":
      case "paragraph":
      case "callout":
        return b.text.trim().length > 0;
      case "list":
        return b.items.some((i) => i.trim().length > 0);
    }
  });
}

function cleanBlocks(blocks: LessonBlock[]) {
  return blocks.map((b) => {
    if (b.type === "list") {
      return { type: b.type, items: b.items.map((i) => i.trim()).filter(Boolean) };
    }
    if (b.type === "heading") {
      return { type: b.type, text: b.text.trim(), level: b.level };
    }
    if (b.type === "callout") {
      return { type: b.type, text: b.text.trim(), tone: b.tone };
    }
    return { type: b.type, text: b.text.trim() };
  });
}

type CalloutTone = "info" | "tip" | "warning";

const CALLOUT_STYLES: Record<CalloutTone, string> = {
  info: "border-primary-200 bg-primary-50 text-ink",
  tip: "border-secondary-200 bg-secondary-50 text-ink",
  warning: "border-accent-200 bg-accent-50 text-ink",
};

export function LessonBuilder({
  roomId,
  roomName,
  documents,
  lesson,
}: {
  roomId: string;
  roomName: string;
  documents: LessonDocOption[];
  lesson: {
    id: string;
    title: string;
    blocks: LessonBlock[];
    docIds: string[];
  } | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [blocks, setBlocks] = useState<LessonBlock[]>(lesson?.blocks ?? []);
  const [docIds, setDocIds] = useState<Set<string>>(new Set(lesson?.docIds ?? []));
  const [docSearch, setDocSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return q ? documents.filter((d) => d.title.toLowerCase().includes(q)) : documents;
  }, [documents, docSearch]);

  function updateBlock(index: number, next: LessonBlock) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? next : b)));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  function toggleDoc(id: string) {
    setDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    if (title.trim().length === 0) {
      setError("Give the lesson a title.");
      return;
    }
    if (blocks.length === 0 || !blocksAreValid(blocks)) {
      setError("Every block needs content (headings, paragraphs, callouts, and lists can't be empty).");
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      let lessonId = lesson?.id ?? null;

      if (lessonId) {
        const { error: upErr } = await supabase
          .from("lessons")
          .update({ title: title.trim(), lesson_blocks: cleanBlocks(blocks) })
          .eq("id", lessonId);
        if (upErr) throw new Error(upErr.message);
        // Rewrite attachments (creator RLS allows delete + insert).
        const { error: delErr } = await supabase
          .from("lesson_documents")
          .delete()
          .eq("lesson_id", lessonId);
        if (delErr) throw new Error(delErr.message);
      } else {
        const { data, error: insErr } = await supabase
          .from("lessons")
          .insert({ room_id: roomId, title: title.trim(), lesson_blocks: cleanBlocks(blocks) })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        lessonId = data.id as string;
      }

      if (docIds.size > 0) {
        const rows = [...docIds].map((document_id, i) => ({
          lesson_id: lessonId,
          document_id,
          position: i,
        }));
        const { error: docErr } = await supabase.from("lesson_documents").insert(rows);
        if (docErr) throw new Error(docErr.message);
      }

      router.push(`/lessons/${lessonId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the lesson.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-ink/60">
          <BookOpen className="h-4 w-4 text-primary-600" />
          Lesson for <span className="font-medium text-ink">{roomName}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          {lesson ? "Edit lesson" : "Build a lesson"}
        </h1>
      </div>

      <AuthError message={error} />

      <div className="rounded-card border border-primary-100 bg-surface p-5">
        <FieldLabel htmlFor="lesson-title">Title</FieldLabel>
        <TextInput
          id="lesson-title"
          value={title}
          maxLength={160}
          placeholder="e.g. Photosynthesis — the light reactions"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* ------------------------------------------------------- Content blocks */}
      <div className="rounded-card border border-primary-100 bg-surface p-5">
        <div className="flex items-center justify-between">
          <FieldLabel>Content blocks</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_KINDS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => setBlocks((prev) => [...prev, newBlock(type)])}
                className="flex items-center gap-1 rounded-btn border border-primary-100 px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-primary-50 hover:text-primary-700"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {blocks.length === 0 ? (
          <p className="mt-4 rounded-card border border-dashed border-primary-200 px-4 py-8 text-center text-sm text-ink/50">
            No blocks yet — add headings, paragraphs, callouts, or lists above.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {blocks.map((block, i) => (
              <li key={i} className="rounded-card border border-primary-100 bg-surface p-3">
                <div className="mb-2 flex items-center gap-1">
                  <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-ink/40">
                    {block.type}
                  </span>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveBlock(i, -1)}
                    className="rounded-btn p-1.5 text-ink/40 transition-colors hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === blocks.length - 1}
                    onClick={() => moveBlock(i, 1)}
                    className="rounded-btn p-1.5 text-ink/40 transition-colors hover:bg-primary-50 hover:text-ink disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove block"
                    onClick={() => setBlocks((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-btn p-1.5 text-ink/40 transition-colors hover:bg-accent-50 hover:text-accent-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {block.type === "heading" ? (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Heading level"
                      value={block.level}
                      onChange={(e) =>
                        updateBlock(i, { ...block, level: Number(e.target.value) })
                      }
                      className="h-10 rounded-btn border border-primary-200 bg-surface px-2 text-sm text-ink"
                    >
                      <option value={1}>H1</option>
                      <option value={2}>H2</option>
                      <option value={3}>H3</option>
                    </select>
                    <TextInput
                      value={block.text}
                      maxLength={200}
                      placeholder="Section heading"
                      onChange={(e) => updateBlock(i, { ...block, text: e.target.value })}
                    />
                  </div>
                ) : block.type === "paragraph" ? (
                  <textarea
                    value={block.text}
                    rows={3}
                    maxLength={5000}
                    placeholder="Write the lesson text…"
                    onChange={(e) => updateBlock(i, { ...block, text: e.target.value })}
                    className="w-full rounded-btn border border-primary-200 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-primary-400 focus:outline-none"
                  />
                ) : block.type === "callout" ? (
                  <div className="space-y-2">
                    <select
                      aria-label="Callout tone"
                      value={block.tone}
                      onChange={(e) =>
                        updateBlock(i, {
                          ...block,
                          tone: e.target.value as "info" | "tip" | "warning",
                        })
                      }
                      className="h-10 rounded-btn border border-primary-200 bg-surface px-2 text-sm text-ink"
                    >
                      <option value="info">Info</option>
                      <option value="tip">Tip</option>
                      <option value="warning">Warning</option>
                    </select>
                    <textarea
                      value={block.text}
                      rows={2}
                      maxLength={1000}
                      placeholder="Something worth highlighting…"
                      onChange={(e) => updateBlock(i, { ...block, text: e.target.value })}
                      className="w-full rounded-btn border border-primary-200 bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink/30 focus:border-primary-400 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {block.items.map((item, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-medium text-ink/40">
                          {j + 1}.
                        </span>
                        <TextInput
                          value={item}
                          maxLength={500}
                          placeholder={`List item ${j + 1}`}
                          onChange={(e) =>
                            updateBlock(i, {
                              ...block,
                              items: block.items.map((it, k) => (k === j ? e.target.value : it)),
                            })
                          }
                        />
                        <button
                          type="button"
                          aria-label="Remove item"
                          onClick={() =>
                            updateBlock(i, {
                              ...block,
                              items: block.items.filter((_, k) => k !== j),
                            })
                          }
                          className="rounded-btn p-1.5 text-ink/40 hover:bg-accent-50 hover:text-accent-700"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateBlock(i, { ...block, items: [...block.items, ""] })
                      }
                      className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add item
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ------------------------------------------------------ Attach documents */}
      <div className="rounded-card border border-primary-100 bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>Attached documents ({docIds.size})</FieldLabel>
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/30" />
            <input
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              placeholder="Search your documents…"
              className="h-9 w-full rounded-btn border border-primary-200 bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink/30 focus:border-primary-400 focus:outline-none"
            />
          </div>
        </div>
        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">
            You haven&apos;t uploaded any documents yet — upload them from your
            student-style Documents page, then attach them here.
          </p>
        ) : (
          <ul className="mt-3 grid max-h-56 gap-1.5 overflow-y-auto pr-1">
            {filteredDocs.map((d) => {
              const attached = docIds.has(d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => toggleDoc(d.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-btn border px-3 py-2 text-left text-sm transition-colors",
                      attached
                        ? "border-primary-300 bg-primary-50 text-primary-800"
                        : "border-transparent text-ink hover:bg-surface-muted",
                    )}
                  >
                    <FileText
                      className={cn(
                        "h-4 w-4 shrink-0",
                        attached ? "text-primary-600" : "text-ink/30",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    {attached ? <span className="text-xs font-medium">attached</span> : null}
                  </button>
                </li>
              );
            })}
            {filteredDocs.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink/40">No documents match.</li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton busy={saving} disabled={saving}>
          {lesson ? "Save changes" : "Publish lesson"}
        </SubmitButton>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-medium text-ink/60 hover:text-ink hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Re-exported for the student-facing viewer.
export { CALLOUT_STYLES };
