"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, LoaderCircle, X } from "lucide-react";
import { uploadAndProcessPdf } from "@/lib/document-upload";
import { cn } from "@/lib/utils";

type SubjectOption = { id: string; name: string };

type UploadItem = {
  key: string;
  name: string;
  percent: number;
  error?: string;
  done?: boolean;
};

export function UploadZone({ subjects }: { subjects: SubjectOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inFlight = uploads.some((u) => !u.done && !u.error);
  const recentlyFinished = uploads.some((u) => u.done && !u.error);

  useEffect(() => {
    if (inFlight) {
      const timer = setInterval(() => router.refresh(), 4000);
      return () => clearInterval(timer);
    }
    if (recentlyFinished) {
      const timer = setTimeout(() => router.refresh(), 4000);
      return () => clearTimeout(timer);
    }
  }, [inFlight, recentlyFinished, router]);

  async function handleFiles(fileList: FileList | null) {
    setError(null);
    if (!subjectId) {
      setError("Pick a subject for these documents first.");
      return;
    }
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    for (const file of files) {
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploads((prev) => [...prev, { key, name: file.name, percent: 0 }]);

      const result = await uploadAndProcessPdf({
        file,
        subjectId,
        onProgress: (percent) =>
          setUploads((prev) =>
            prev.map((u) => (u.key === key ? { ...u, percent } : u)),
          ),
      });

      if (result.ok) {
        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { ...u, done: true } : u)),
        );
      } else {
        setUploads((prev) =>
          prev.map((u) =>
            u.key === key ? { ...u, error: result.error } : u,
          ),
        );
      }
    }

    router.refresh();
  }

  function dismissUpload(key: string) {
    setUploads((prev) => prev.filter((u) => u.key !== key));
  }

  return (
    <section aria-label="Upload documents" className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label
          htmlFor="subject-select"
          className="text-xs font-semibold text-[var(--ink-soft)]"
        >
          Upload to subject:
        </label>
        <select
          id="subject-select"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={subjects.length === 0}
          className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] outline-none disabled:opacity-60"
        >
          {subjects.length === 0 ? (
            <option value="">No subjects yet</option>
          ) : (
            subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload PDFs: drag and drop or click to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging
            ? "border-[var(--teal)] bg-[var(--teal-pale)]"
            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--teal)] hover:bg-[var(--bg)]",
          subjects.length === 0 && "pointer-events-none opacity-60",
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--teal-pale)] text-[var(--teal)] mb-2">
          <CloudUpload className="h-5 w-5" />
        </div>
        <p className="text-[13.5px] font-semibold text-[var(--ink)]">
          Drag & drop PDFs here, or <span className="text-[var(--teal)] underline">browse</span>
        </p>
        <p className="mt-0.5 text-[11.5px] text-[var(--ink-soft)]">
          PDFs up to 50 MB, stored privately in your account
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="space-y-2 pt-1">
          {uploads.map((upload) => (
            <li
              key={upload.key}
              className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <FileText className="h-4 w-4 shrink-0 text-[var(--teal)]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-[var(--ink)]">
                    {upload.name}
                  </p>
                  <span className="shrink-0 text-[11px] text-[var(--ink-soft)] font-medium">
                    {upload.error ? "Failed" : upload.done ? "Uploaded" : `${upload.percent}%`}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      upload.error ? "bg-red-500" : "bg-[var(--teal)]",
                    )}
                    style={{
                      width: upload.error ? "100%" : `${upload.percent}%`,
                    }}
                  />
                </div>
                {upload.error ? (
                  <p className="mt-1 text-[11px] text-red-600">{upload.error}</p>
                ) : null}
              </div>
              {upload.done || upload.error ? (
                <button
                  type="button"
                  onClick={() => dismissUpload(upload.key)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-[6px] p-1 text-[var(--ink-soft)] hover:bg-[var(--bg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--teal)]" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

