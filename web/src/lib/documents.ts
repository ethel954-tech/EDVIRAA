import { createClient } from "@/lib/supabase/client";

export type DeleteFailure = { id: string; title: string; error: string };

export type DeleteResult = {
  deleted: string[];
  failures: DeleteFailure[];
};

export type DeletableDocument = {
  id: string;
  title?: string;
  storage_path?: string | null;
};

/**
 * Deletes one document: storage object first, then the row. Storage-first
 * means a failed storage call leaves the row visible and retryable instead
 * of orphaning the file; a missing object is treated as already deleted.
 * Chunks, flashcards, quizzes and lesson_documents go with the row via
 * ON DELETE CASCADE. RLS (`documents_delete_own`, `documents_storage_delete_own`)
 * scopes every call to the signed-in user's own rows/files.
 */
async function deleteOne(
  supabase: ReturnType<typeof createClient>,
  doc: DeletableDocument,
): Promise<void> {
  if (doc.storage_path) {
    const { error: storageError } = await supabase.storage
      .from("documents")
      .remove([doc.storage_path]);
    if (storageError) throw new Error(storageError.message);
  }

  const { error, count } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .eq("id", doc.id);
  if (error) throw new Error(error.message);
  if (count === 0) {
    throw new Error("Document not found — it may already have been deleted.");
  }
}

/**
 * Deletes the given documents sequentially, continuing past individual
 * failures so one bad row doesn't block the rest.
 */
export async function deleteDocuments(
  docs: DeletableDocument[],
  onProgress?: (done: number, total: number) => void,
): Promise<DeleteResult> {
  const supabase = createClient();
  const deleted: string[] = [];
  const failures: DeleteFailure[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    try {
      await deleteOne(supabase, doc);
      deleted.push(doc.id);
    } catch (err) {
      failures.push({
        id: doc.id,
        title: doc.title ?? doc.id,
        error: err instanceof Error ? err.message : "Delete failed",
      });
    }
    onProgress?.(i + 1, docs.length);
  }

  return { deleted, failures };
}
