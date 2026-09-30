"use client";

/**
 * PDF upload to the private `documents` bucket with REAL progress events.
 *
 * supabase-js `upload()` uses fetch and cannot report byte progress, so this
 * posts directly to the Storage REST API with XMLHttpRequest (same auth
 * header, same RLS-enforced path convention from the storage migration:
 * {user_id}/{document_id}.pdf).
 */

const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB — generous for study PDFs

export function validatePdf(file: File): string | null {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return `"${file.name}" is not a PDF.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > PDF_MAX_BYTES) {
    return `"${file.name}" is larger than 50 MB.`;
  }
  return null;
}

export function uploadPdfWithProgress({
  file,
  path,
  token,
  onProgress,
  signal,
}: {
  file: File;
  path: string;
  /** The signed-in user's JWT — storage RLS matches it to the path folder. */
  token: string;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}) {
  return new Promise<void>((resolve, reject) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `${supabaseUrl}/storage/v1/object/documents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      true,
    );
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // x-upsert lets a retry after a network failure overwrite the partial
    // object instead of failing with "Duplicate".
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("content-type", "application/pdf");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        let message = `Upload failed (HTTP ${xhr.status}).`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.message) message = body.message;
        } catch {
          // non-JSON error body — keep the generic message
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new Error("Upload canceled."));

    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
