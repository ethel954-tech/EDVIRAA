// ============================================================================
// backfill-summary — opt-in per-document summary generation (Phase 4 item 2)
//
// Existing 'ready' documents created before the summary feature have
// summary IS NULL. This function lets the owner generate one on demand:
//   1. Verifies the caller (JWT) and that the document belongs to them (RLS).
//   2. Consumes 1 unit of the 'backfill-summary' daily quota (30/day,
//      seeded in 20261001000002_document_summary.sql) — before any model call.
//   3. Reads the document's chunks, samples evenly (shared _shared/summary.ts),
//      prompts the model with <document>-wrapped untrusted text.
//   4. Writes summary / summary_status='ready' / summary_partial via the
//      service-role client.
//
// On ANY failure (provider 429, timeout, quota) the function returns an HTTP
// error and leaves summary NULL so the attempt is retryable. The document
// row's status is never touched.
//
// Deploy:  supabase functions deploy backfill-summary
// Secrets: same LLM_API_KEY / LLM_BASE_URL / LLM_MODEL as the other functions.
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { chatCompletion } from "../_shared/qwen.ts";
// @ts-ignore: same as above.
import { checkAiQuota } from "../_shared/ai-quota.ts";
// @ts-ignore: same as above.
import {
  buildSummaryMessages,
  extractSummaryText,
  samplePassages,
  type ChunkLike,
} from "../_shared/summary.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUMMARY_TIMEOUT_MS = 15_000;

interface BackfillRequest {
  documentId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const { documentId } = (await req.json()) as BackfillRequest;
    if (!documentId) {
      return json({ error: "documentId is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const quotaFailure = await checkAiQuota(
      () =>
        supabase.rpc("consume_ai_quota", {
          p_fn: "backfill-summary",
          p_max: null,
        }),
      "backfill-summary",
    );
    if (quotaFailure) {
      return json({ error: quotaFailure.message }, quotaFailure.status);
    }

    // RLS-scoped select proves ownership and readiness in one query.
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, status, summary")
      .eq("id", documentId)
      .single();

    if (docError || !document) {
      return json({ error: "Document not found" }, 404);
    }
    if (document.status !== "ready") {
      return json({ error: "Document is not processed yet." }, 409);
    }
    if (document.summary) {
      return json({ ok: true, alreadySummarized: true });
    }

    const { data: chunks, error: chunksError } = await supabase
      .from("document_chunks")
      .select("chunk_index, content")
      .eq("document_id", document.id)
      .order("chunk_index", { ascending: true });

    if (chunksError) {
      console.error(
        "[backfill-summary] chunks query failed:",
        chunksError.message,
      );
      return json(
        { error: `Could not read content: ${chunksError.message}` },
        500,
      );
    }
    if (!chunks || chunks.length === 0) {
      return json({ error: "This document has no processed content." }, 409);
    }

    const sample = samplePassages(chunks as ChunkLike[]);
    const completion = await chatCompletion(buildSummaryMessages(sample), {
      maxTokens: 400,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    const summaryText = extractSummaryText(completion.content);
    if (!summaryText) {
      return json(
        { error: "The model returned an empty summary. Please try again." },
        502,
      );
    }

    // Service-role write: the row update rides on documents' existing
    // owner policies for reads, but writes here must not depend on RLS
    // column visibility (same pattern as process-document's chunk inserts).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { error: writeError } = await supabaseAdmin
      .from("documents")
      .update({
        summary: summaryText,
        summary_status: "ready",
        summary_partial: sample.partial,
        summary_created_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    if (writeError) {
      console.error(
        "[backfill-summary] summary write failed:",
        writeError.message,
      );
      return json(
        { error: `Could not store the summary: ${writeError.message}` },
        500,
      );
    }

    return json({ ok: true, partial: sample.partial });
  } catch (err) {
    console.error(
      "[backfill-summary] request failed:",
      err instanceof Error ? err.message : err,
    );
    return json(
      {
        error:
          err instanceof Error ? err.message : "Summary generation failed.",
      },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
