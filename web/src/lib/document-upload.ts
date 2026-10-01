"use client";

import { createClient } from "@/lib/supabase/client";
import { uploadPdfWithProgress, validatePdf } from "@/lib/upload";

/**
 * Shared PDF ingestion flow used by the Documents page and the tutor chat
 * attachments. Reuses the existing pipeline and security model unchanged:
 *
 *  1. validatePdf (PDF only, non-empty, <= 50 MB — same as the Documents page)
 *  2. insert documents row (storage_path "pending", status "processing")
 *     — RLS (`documents_insert_own`) scopes this to the signed-in user
 *  3. upload to the private `documents` bucket at {user_id}/{document_id}.pdf
 *     (storage RLS `documents_storage_*_own` matches the path to the caller)
 *  4. update the row's real storage_path
 *  5. invoke the process-document edge function (extract → chunk → embed)
 *
 * Error semantics (same as the original upload-zone flow): if the upload
 * itself fails the DB row is deleted; once the file is stored the row is the
 * retry handle, so an invoke failure marks the row "failed" instead.
 */
export async function uploadAndProcessPdf({
  file,
  subjectId,
  onProgress,
  onStage,
  signal,
}: {
  file: File;
  subjectId: string;
  onProgress?: (percent: number) => void;
  onStage?: (stage: "uploading" | "processing") => void;
  signal?: AbortSignal;
}): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const validationError = validatePdf(file);
  if (validationError) return { ok: false, error: validationError };

  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const user = session?.user;
  if (!token || !user) {
    return { ok: false, error: "Your session expired. Please log in again." };
  }

  let documentId: string | null = null;
  let uploaded = false;

  try {
    onStage?.("uploading");

    const { data: inserted, error: insertError } = await supabase
      .from("documents")
      .insert({
        student_id: user.id,
        subject_id: subjectId,
        title: file.name.replace(/\.pdf$/i, ""),
        storage_path: "pending",
        status: "processing" as const,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        insertError?.message ?? "Could not create the document record.",
      );
    }
    documentId = inserted.id as string;
    // Alias so TS can narrow away the `null` branch at the success return.
    const createdDocumentId: string = documentId;

    const path = `${user.id}/${documentId}.pdf`;
    await uploadPdfWithProgress({
      file,
      path,
      token,
      onProgress: (percent) => onProgress?.(percent),
      signal,
    });

    const { error: updateError } = await supabase
      .from("documents")
      .update({ storage_path: path })
      .eq("id", documentId);
    if (updateError) throw new Error(updateError.message);
    uploaded = true;

    onStage?.("processing");

    // Fire-and-forget, but not failure-and-forget: if the invoke itself
    // fails (offline, 401, edge down) nothing would flip the row out of
    // "processing" and the UI would spin forever. Mark it failed so the
    // user sees the truth and can retry.
    const { error: invokeError } = await supabase.functions.invoke(
      "process-document",
      { body: { documentId } },
    );
    if (invokeError) {
      await supabase
        .from("documents")
        .update({ status: "failed" as const })
        .eq("id", documentId);
      throw new Error(`Could not start processing: ${invokeError.message}`);
    }

    return { ok: true, documentId: createdDocumentId };
  } catch (err) {
    // Only clean up the DB row when the upload itself failed. Once the
    // file is stored, the row (and any "failed" status we just set) is
    // the user's retry handle — deleting it would orphan the object.
    if (documentId && !uploaded) {
      void supabase.from("documents").delete().eq("id", documentId);
    }
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Upload failed. Please try again.",
    };
  }
}

/**
 * Poll a document row until it leaves "processing" (or a cap is hit).
 * Returns the final status. `isCancelled` lets callers stop the poll when
 * the chip is removed or the component unmounts.
 */
export async function pollDocumentStatus(
  documentId: string,
  isCancelled: () => boolean,
  { intervalMs = 3000, maxAttempts = 100 } = {},
): Promise<"ready" | "failed" | "timeout"> {
  const supabase = createClient();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (isCancelled()) return "timeout";
    const { data } = await supabase
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();
    if (data?.status === "ready") return "ready";
    if (data?.status === "failed") return "failed";
  }
  return "timeout";
}
