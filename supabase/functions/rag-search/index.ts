// ============================================================================
// rag-search — retrieval edge function (Task 7)
//
// Given a query + subject_id: embed the query with Qwen, run the subject-scoped
// pgvector cosine search RPC (search_document_chunks, ownership-enforced),
// and return the top chunks with similarity scores. The tutor chat (and the
// shared API layer generally) calls this before prompting Qwen.
//
// Deploy:  supabase functions deploy rag-search
// Secrets: supabase secrets set LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=...
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { embedTexts } from "../_shared/qwen.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SearchRequest {
  query: string;
  subjectId: string;
  matchCount?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, subjectId, matchCount } = (await req.json()) as SearchRequest;

    if (!query?.trim()) {
      return json({ error: "query is required" }, 400);
    }
    if (!subjectId) {
      return json({ error: "subjectId is required" }, 400);
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

    // Embed the query with the SAME model as the chunks — mixing embedding
    // models silently destroys retrieval quality.
    const [queryEmbedding] = await embedTexts([query.trim()]);

    // RLS-safe RPC: SECURITY DEFINER but pinned to student_id = auth.uid(),
    // scoped to the subject, over 'ready' documents only.
    const { data: matches, error } = await supabase.rpc(
      "search_document_chunks",
      {
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_subject_id: subjectId,
        p_match_count: matchCount ?? 8,
      },
    );

    if (error) {
      return json({ error: `Search failed: ${error.message}` }, 500);
    }

    return json({
      ok: true,
      results: (matches ?? []).map(
        (m: {
          chunk_id: string;
          document_id: string;
          document_title: string;
          chunk_index: number;
          content: string;
          similarity: number;
        }) => ({
          chunkId: m.chunk_id,
          documentId: m.document_id,
          documentTitle: m.document_title,
          chunkIndex: m.chunk_index,
          content: m.content,
          // Rounded so the UI can show "0.82" style relevance.
          similarity: Number(m.similarity.toFixed(4)),
        }),
      ),
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Search failed." },
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
