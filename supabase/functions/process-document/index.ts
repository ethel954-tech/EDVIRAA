// ============================================================================
// process-document — RAG ingestion edge function (Task 7)
//
// 1. Verifies the caller (JWT) and that the document belongs to them.
// 2. Downloads the PDF from the private `documents` bucket.
// 3. Extracts text (pdfjs-dist), chunks into passages (shared chunker).
// 4. Embeds all chunks with the configured embedding model (1024 dims).
// 5. Inserts document_chunks rows and flips documents.status -> 'ready'.
//
// Any failure marks the document 'failed' so the UI stops saying Processing.
// Deploy:  supabase functions deploy process-document
// Secrets: supabase secrets set LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=...
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { chunkPassages } from "../_shared/chunker.ts";
// @ts-ignore: same as above.
import { extractTextFromPdf, PdfPageLimitError } from "../_shared/pdf.ts";
// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createQwenEmbedder, EMBEDDING_DIMENSIONS } from "../_shared/qwen.ts";
import { checkAiQuota } from "../_shared/ai-quota.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Supabase allows 2s CPU per request. The default of 8 pages uses about 0.96s
// at the rough upper estimate of 120ms/page, leaving time for initialization
// and chunking. MAX_PDF_PAGES can tune this per deployment.
const DEFAULT_MAX_PDF_PAGES = 8;
const MAX_EXTRACTED_CHARS = 150_000;
const MAX_CHUNKS = 120;

function getMaxPdfPages(): number {
  const configured = Number(Deno.env.get("MAX_PDF_PAGES"));
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_PDF_PAGES;
}

interface ProcessRequest {
  documentId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let documentId: string | undefined;
  let supabaseAdmin: SupabaseClient | null = null;

  try {
    const { documentId: docId } = (await req.json()) as ProcessRequest;
    documentId = docId;
    if (!documentId) {
      return json({ error: "documentId is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client: RLS applies, used for ownership checks + inserts.
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const quotaFailure = await checkAiQuota(
      () => supabase.rpc("consume_ai_quota", { p_fn: "process-document", p_max: null }),
      "process-document",
    );
    if (quotaFailure) {
      const { error: updateError } = await supabase
        .from("documents")
        .update({ status: "failed" })
        .eq("id", documentId);
      if (updateError) {
        console.error("[process-document] quota failure status update failed:", updateError.message);
      }
      return json({ error: quotaFailure.message }, quotaFailure.status);
    }

    // Service client ONLY for cleanup paths that must never be skipped.
    supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // The user-scoped select both proves ownership (RLS) and fetches the path.
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, student_id, subject_id, storage_path, status")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      return json({ error: "Document not found" }, 404);
    }
    if (document.status === "ready") {
      return json({ ok: true, alreadyReady: true, chunks: 0 });
    }

    // Download the PDF with the user's token (storage RLS enforces the
    // owner-folder policy).
    const { data: file, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !file) {
      throw new Error(`Could not download the uploaded file: ${downloadError?.message ?? "not found"}`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    // ---------------------------------------------------------------
    // Extract -> chunk -> embed
    // ---------------------------------------------------------------
    let pageCount: number | null = null;
    const extractionStartedAt = performance.now();
    let text: string;
    try {
      text = await extractTextFromPdf(bytes, getMaxPdfPages(), (count) => {
        pageCount = count;
      });
    } finally {
      console.info("[process-document] PDF extraction metrics:", {
        pageCount,
        elapsedMs: Math.round(performance.now() - extractionStartedAt),
      });
    }
    const passages = chunkPassages(text);
    if (passages.length === 0) {
      throw new Error("No extractable content found in this PDF.");
    }

    if (text.length > MAX_EXTRACTED_CHARS || passages.length > MAX_CHUNKS) {
      // Flip to failed via the user-scoped client (documents_update_own) so
      // the UI stops saying Processing, then explain the limit.
      await supabase
        .from("documents")
        .update({ status: "failed" })
        .eq("id", document.id);
      return json(
        {
          error:
            "This PDF is too large to process. Split it into smaller parts and upload them separately.",
        },
        413,
      );
    }

    const embedder = createQwenEmbedder();

    // Batched embedding (text-embedding-v3 accepts batched input).
    const embeddings = await embedder.embedMany(
      passages.map((p) => p.content),
    );

    const rows = passages.map((p, i) => {
      const embedding = embeddings[i];
      if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${embedding?.length ?? 0}`,
        );
      }
      return {
        document_id: document.id,
        chunk_index: p.chunk_index,
        content: p.content,
        embedding: JSON.stringify(embedding),
      };
    });

    // Replace any partial results from a previous failed attempt.
    await supabaseAdmin.from("document_chunks").delete().eq("document_id", document.id);
    const { error: insertError } = await supabaseAdmin
      .from("document_chunks")
      .insert(rows);

    if (insertError) {
      throw new Error(`Could not store chunks: ${insertError.message}`);
    }

    // status flips to 'ready' via the ownership-checked SECURITY DEFINER RPC
    // (added in 20250921000004_document_status.sql).
    const { error: readyError } = await supabase.rpc("mark_document_ready", {
      p_document_id: document.id,
    });
    if (readyError) {
      throw new Error(`Could not finalize status: ${readyError.message}`);
    }

    return json({ ok: true, chunks: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingestion failed.";
    const status = err instanceof PdfPageLimitError ? 413 : 500;
    console.error("[process-document] ingestion failed:", documentId, message);

    // Never leave a document stuck on Processing: with the service client,
    // flip the row to 'failed' so the UI shows the truth.
    if (documentId && supabaseAdmin) {
      await supabaseAdmin
        .from("documents")
        .update({ status: "failed" })
        .eq("id", documentId);
    }

    return json({ error: message }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
