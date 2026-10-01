import { supabase } from '../lib/supabase';
import { getActiveSubject, type Subject } from '../lib/subjects';
import * as FileSystem from 'expo-file-system';

/**
 * Shared PDF ingestion flow used by the mobile Documents screen and the
 * mobile tutor chat attachments. Mirrors the web pipeline exactly:
 *
 *  1. validate (PDF only, non-empty, <= 50 MB — same as the Documents page)
 *  2. resolve the active subject (attachments are filed under it)
 *  3. insert documents row (storage_path "pending", status "processing")
 *     — RLS (`documents_insert_own`) scopes this to the signed-in user
 *  4. upload to the private `documents` bucket at {user_id}/{document_id}.pdf
 *     (storage RLS `documents_storage_*_own` matches the path to the caller)
 *  5. update the row's real storage_path
 *  6. invoke the process-document edge function (extract → chunk → embed)
 *
 * Error semantics (same as the web flow): if the upload itself fails the DB
 * row is deleted; once the file is stored the row is the retry handle, so an
 * invoke failure marks the row "failed" instead.
 *
 * onStage/onProgress keep both call sites' UIs live; resolveSubject lets the
 * documents screen pass its selected subject explicitly while the tutor uses
 * the app-wide active subject.
 */
export const PDF_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Friendly notice mirrored from the process-document edge function. The
 * configured server page limit may differ between deployments.
 */
export const PDF_PAGE_LIMIT_NOTE =
  'This PDF may have too many pages to process. Split it into smaller parts and upload them separately.';

export function validatePdfAsset(file: {
  name?: string | null;
  size?: number | null;
  mimeType?: string | null;
  uri: string;
}): string | null {
  const isPdf =
    (file.mimeType && file.mimeType === 'application/pdf') ||
    (file.name ? file.name.toLowerCase().endsWith('.pdf') : false);
  if (!isPdf) return `"${file.name || 'This file'}" is not a PDF.`;
  if (!file.size) return `"${file.name || 'This file'}" is empty.`;
  if (file.size > PDF_MAX_BYTES) {
    return `"${file.name || 'This file'}" is larger than 50 MB.`;
  }
  return null;
}

export type DocumentUploadResult =
  | { ok: true; documentId: string; subjectId: string }
  | { ok: false; error: string };

export async function uploadAndProcessPdf({
  uri,
  name,
  size,
  mimeType,
  resolveSubject,
  onProgress,
  onStage,
}: {
  uri: string;
  name: string;
  size: number;
  mimeType?: string | null;
  /** Tutor passes the active subject; documents screen passes its own. */
  resolveSubject?: () => Promise<Subject | null>;
  onProgress?: (percent: number) => void;
  onStage?: (stage: 'uploading' | 'processing') => void;
}): Promise<DocumentUploadResult> {
  const validationError = validatePdfAsset({ uri, name, size, mimeType });
  if (validationError) return { ok: false, error: validationError };

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { ok: false, error: 'Your session expired. Please log in again.' };
    }

    const subject = resolveSubject
      ? await resolveSubject()
      : await getActiveSubject();
    if (!subject) {
      return {
        ok: false,
        error:
          'No subject selected — pick a subject first so this PDF lands where the tutor can find it.',
      };
    }

    onStage?.('uploading');

    const base64Data = await readBase64(uri);

    const { data: inserted, error: insertError } = await supabase
      .from('documents')
      .insert({
        student_id: user.id,
        subject_id: subject.id,
        title: name.replace(/\.pdf$/i, ''),
        storage_path: 'pending',
        status: 'processing',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      throw new Error(
        insertError?.message ?? 'Could not create the document record.',
      );
    }
    const documentId = inserted.id as string;

    const storagePath = `${user.id}/${documentId}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, decodeBase64(base64Data), {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (uploadErr) throw new Error(uploadErr.message);

    const { error: updateError } = await supabase
      .from('documents')
      .update({ storage_path: storagePath })
      .eq('id', documentId);
    if (updateError) throw new Error(updateError.message);

    onStage?.('processing');

    const { error: invokeError } = await supabase.functions.invoke(
      'process-document',
      { body: { documentId } },
    );
    if (invokeError) {
      await supabase
        .from('documents')
        .update({ status: 'failed' })
        .eq('id', documentId);
      throw new Error(
        `Could not start processing: ${await getFunctionErrorMessage(invokeError)}`,
      );
    }

    return { ok: true, documentId, subjectId: subject.id };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Upload failed. Please try again.',
    };
  }
}

async function getFunctionErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    const payload = await error.context.clone().json().catch(() => null) as
      | { error?: unknown; message?: unknown }
      | null;
    if (typeof payload?.error === 'string') return payload.error;
    if (typeof payload?.message === 'string') return payload.message;
  }
  return error.message;
}

/**
 * Poll a document row until it leaves "processing" (or a cap is hit).
 * Returns the final status. `isCancelled` lets callers stop the poll when
 * the chip is removed or the screen unmounts.
 */
export async function pollDocumentStatus(
  documentId: string,
  isCancelled: () => boolean,
  { intervalMs = 3000, maxAttempts = 100 } = {},
): Promise<'ready' | 'failed' | 'timeout'> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (isCancelled()) return 'timeout';
    const { data } = await supabase
      .from('documents')
      .select('status')
      .eq('id', documentId)
      .maybeSingle();
    if (data?.status === 'ready') return 'ready';
    if (data?.status === 'failed') return 'failed';
  }
  return 'timeout';
}

async function readBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function decodeBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((str.length * 3) / 4));
  let u = 0;
  for (let i = 0; i < str.length; i += 4) {
    const e1 = chars.indexOf(str.charAt(i));
    const e2 = chars.indexOf(str.charAt(i + 1));
    const e3 = chars.indexOf(str.charAt(i + 2));
    const e4 = chars.indexOf(str.charAt(i + 3));
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    bytes[u++] = c1;
    if (e3 !== 64 && e3 !== -1) bytes[u++] = c2;
    if (e4 !== 64 && e4 !== -1) bytes[u++] = c3;
  }
  return bytes.subarray(0, u);
}
