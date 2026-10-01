"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, LoaderCircle } from "lucide-react";
import { deleteDocuments } from "@/lib/documents";

type DocumentRow = {
  id: string;
  title: string;
  status: string;
  storage_path: string | null;
  created_at: string;
  subject_name: string | null;
};

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

export function DocumentDeleteActions({ documents }: { documents: DocumentRow[] }) {
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failedDocs = documents.filter((d) => d.status === "failed");

  async function handleDeleteOne(doc: DocumentRow) {
    setError(null);
    setBusyDocId(doc.id);
    try {
      const { failures } = await deleteDocuments([doc]);
      if (failures.length > 0) {
        setError(`Could not delete "${doc.title}": ${failures[0].error}`);
      } else {
        setConfirmingId(null);
      }
      router.refresh();
    } finally {
      setBusyDocId(null);
    }
  }

  async function handleDeleteFailed() {
    setError(null);
    setBulkBusy(true);
    try {
      const { deleted, failures } = await deleteDocuments(failedDocs);
      if (failures.length > 0) {
        setError(
          `Deleted ${deleted.length} of ${failedDocs.length} failed documents. ` +
            failures.map((f) => `"${f.title}" (${f.error})`).join("; "),
        );
      } else {
        setConfirmingBulk(false);
      }
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  if (documents.length === 0) {
    return (
      <p className="card-study text-center text-sm text-[var(--ink-soft)] py-8">
        No documents yet — your uploads will appear here.
      </p>
    );
  }

  return (
    <section aria-label="Uploaded documents">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-sans text-base font-semibold text-[var(--ink)]">
          Your documents
        </h2>
        {failedDocs.length > 0 ? (
          confirmingBulk ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--ink-soft)]">
                Permanently delete {failedDocs.length} failed document
                {failedDocs.length === 1 ? "" : "s"}?
              </span>
              <button
                type="button"
                onClick={() => setConfirmingBulk(false)}
                disabled={bulkBusy}
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteFailed}
                disabled={bulkBusy}
                className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {bulkBusy ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete {failedDocs.length}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingBulk(true)}
              className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete all failed ({failedDocs.length})
            </button>
          )
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {documents.map((doc) => {
          const busy = busyDocId === doc.id;
          const confirming = confirmingId === doc.id;
          return (
            <li
              key={doc.id}
              className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{doc.title}</p>
                <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                  Uploaded {formatDate(doc.created_at)}
                  {doc.subject_name ? ` · ${doc.subject_name}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[doc.status] ?? ""}`}
              >
                {statusLabels[doc.status] ?? doc.status}
              </span>
              {confirming ? (
                <div className="flex w-full items-center justify-end gap-2 border-t border-[var(--border)] pt-2.5">
                  <span className="mr-auto text-xs text-[var(--ink-soft)]">
                    {doc.status === "processing"
                      ? "Still processing — deleting now stops ingestion and removes partial data."
                      : "Deletes the file, its embeddings, and generated flashcards/quizzes."}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={busy}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteOne(doc)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {busy ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${doc.title}`}
                  title="Delete document"
                  onClick={() => {
                    setError(null);
                    setConfirmingId(doc.id);
                  }}
                  className="shrink-0 rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
