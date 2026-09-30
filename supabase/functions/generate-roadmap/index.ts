// ============================================================================
// generate-roadmap — module/topic generation (Task 10)
//
// Takes a class, reads its documents' structure (titles + chunk sequence in
// reading order from Task 7 ingestion), and prompts Qwen to split the
// material into an ordered learning path of modules with topics. Stores rows
// in `modules` + `topics`; the first module starts as 'in_progress'.
//
// Regeneration replaces the class's roadmap (topics cascade; past attempts
// keep their rows via ON DELETE SET NULL on topic_id).
//
// Deploy:  supabase functions deploy generate-roadmap
// Secrets: supabase secrets set LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=...
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { chatCompletion, type ChatMessage } from "../_shared/qwen.ts";
// @ts-ignore: same as above.
import { GENERATION_TIMEOUT_MS } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Per-document structure preview fed to the model. */
const MAX_DOCS = 12;
const MAX_CHUNKS_PER_DOC = 25;
const CHUNK_PREVIEW_CHARS = 160;

interface RoadmapRequest {
  subjectId: string;
}

const SYSTEM_PROMPT = `You are a curriculum designer. You read a student's study material outline and output ONLY valid JSON — no markdown fences, no commentary.

Rules:
- Build a sequential learning path: foundational concepts first, advanced later.
- Every topic must map to something actually present in the material; never invent sections.
- Module and topic titles are short (max ~60 chars) and student-friendly.
- Match the material's language.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const { subjectId } = (await req.json()) as RoadmapRequest;
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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id;
    if (!userId) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // RLS-scoped select proves subject ownership.
    const { data: subject, error: subjectError } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("id", subjectId)
      .single();

    if (subjectError || !subject) {
      return json({ error: "Subject not found" }, 404);
    }

    const { data: documents, error: docsError } = await supabase
      .from("documents")
      .select("id, title")
      .eq("student_id", userId)
      .eq("subject_id", subjectId)
      .eq("status", "ready")
      .order("created_at", { ascending: true })
      .limit(MAX_DOCS);

    if (docsError) {
      return json({ error: `Could not read documents: ${docsError.message}` }, 500);
    }
    if (!documents || documents.length === 0) {
      return json(
        { error: "No processed documents in this subject yet — upload PDFs first." },
        400,
      );
    }

    // ------------------------------------------------------------------
    // Structure outline: each document's chunks in reading order, as short
    // previews, so the model can see the topical flow of the material.
    // ------------------------------------------------------------------
    const docIds = documents.map((d: { id: string }) => d.id);
    const { data: chunks, error: chunksError } = await supabase
      .from("document_chunks")
      .select("document_id, chunk_index, content")
      .in("document_id", docIds)
      .order("chunk_index", { ascending: true });

    if (chunksError) {
      return json({ error: `Could not read content: ${chunksError.message}` }, 500);
    }

    const byDoc = new Map<string, string[]>();
    for (const c of chunks ?? []) {
      const list = byDoc.get(c.document_id) ?? [];
      if (list.length < MAX_CHUNKS_PER_DOC) {
        list.push(c.content.replace(/\s+/g, " ").slice(0, CHUNK_PREVIEW_CHARS));
      }
      byDoc.set(c.document_id, list);
    }

    const outline = documents
      .map((d: { id: string; title: string }, i: number) => {
        const previews = byDoc.get(d.id) ?? [];
        if (previews.length === 0) return null;
        return [
          `DOCUMENT ${i + 1}: "${d.title}"`,
          ...previews.map((p, j) => `  passage ${j + 1}: ${p}${p.length >= CHUNK_PREVIEW_CHARS ? "…" : ""}`),
        ].join("\n");
      })
      .filter(Boolean)
      .join("\n\n");

    if (!outline) {
      return json({ error: "This class's documents have no processed content yet." }, 400);
    }

    // ------------------------------------------------------------------
    // Prompt Qwen for the structured roadmap.
    // ------------------------------------------------------------------
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `STUDY MATERIAL OUTLINE for the subject "${subject.name}":
"""
${outline}
"""

Split this material into a sequential learning path.

Return JSON exactly in this shape:
{"modules":[{"title":"...","topics":["...","..."]}]}

- 3 to 8 modules; 2 to 6 topics per module.
- Order modules so each builds on the previous ones.`,
      },
    ];

    const completion = await chatCompletion(messages, {
      temperature: 0.3,
      maxTokens: 2000,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });

    // ------------------------------------------------------------------
    // Parse + validate.
    // ------------------------------------------------------------------
    let parsed: {
      modules?: Array<{ title?: unknown; topics?: unknown }>;
    };
    try {
      const withoutFences = completion.content.replace(/```(?:json)?/gi, "");
      const start = withoutFences.indexOf("{");
      const end = withoutFences.lastIndexOf("}");
      parsed = JSON.parse(withoutFences.slice(start, end + 1));
    } catch {
      return json(
        { error: "The model returned an unexpected format. Please try again." },
        502,
      );
    }

    const modules = (parsed.modules ?? [])
      .map((m) => {
        const title =
          typeof m.title === "string" ? m.title.trim().replace(/\s+/g, " ").slice(0, 80) : "";
        const topics = Array.isArray(m.topics)
          ? m.topics
              .map((t) =>
                typeof t === "string" ? t.trim().replace(/\s+/g, " ").slice(0, 120) : "",
              )
              .filter(Boolean)
              .slice(0, 8)
          : [];
        return title && topics.length > 0 ? { title, topics } : null;
      })
      .filter((m): m is { title: string; topics: string[] } => m !== null)
      .slice(0, 10);

    if (modules.length < 2) {
      return json(
        { error: "The model couldn't build a valid roadmap. Please try again." },
        502,
      );
    }

    // ------------------------------------------------------------------
    // Store: replace the class's roadmap (topics cascade with modules).
    // ------------------------------------------------------------------
    await supabase.from("modules").delete().eq("subject_id", subjectId);

    const moduleRows = modules.map((m, i) => ({
      subject_id: subjectId,
      title: m.title,
      order_index: i,
      // The student always has a visible starting point.
      status: i === 0 ? "in_progress" : "locked",
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("modules")
      .insert(moduleRows)
      .select("id, order_index");

    if (insertError || !inserted) {
      return json({ error: `Could not save the roadmap: ${insertError?.message}` }, 500);
    }

    const topicRows = inserted.flatMap((row: { id: string; order_index: number }) =>
      modules[row.order_index].topics.map((title, j) => ({
        module_id: row.id,
        title,
        order_index: j,
      })),
    );

    const { error: topicsError } = await supabase
      .from("topics")
      .insert(topicRows);

    if (topicsError) {
      return json({ error: `Could not save topics: ${topicsError.message}` }, 500);
    }

    return json({
      ok: true,
      subjectId,
      modules: inserted.length,
      topics: topicRows.length,
    });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Roadmap generation failed." },
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
