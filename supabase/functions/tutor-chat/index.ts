// ============================================================================
// tutor-chat — AI Tutor chat edge function (Task 8)
//
// Flow per user message:
//   1. Verify the caller (JWT); resolve/launch their conversation (RLS).
//   2. Load the recent conversation history so chats can be resumed.
//   3. Embed the user's message and retrieve grounded context for the
//      selected class via search_document_chunks (ownership-enforced, Task 7).
//   4. Send system prompt + context + history to Qwen (chat completions).
//   5. Persist both turns and return the reply + cited sources.
//
// Retrieval failures degrade gracefully (the model answers ungrounded with a
// caveat) instead of killing the chat.
//
// Deploy:  supabase functions deploy tutor-chat
// Secrets: supabase secrets set DASHSCOPE_API_KEY=sk-...
// ============================================================================

// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: same as above.
import { embedTexts, type ChatMessage } from "../_shared/qwen.ts";
import { chat } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** History window sent to the model (token budget: qwen-plus handles far more). */
const HISTORY_WINDOW = 20;
const MAX_QUESTION_LENGTH = 2000;
/** Retrieved passages handed to the model as context. */
const CONTEXT_CHUNKS = 8;

interface ChatRequest {
  message: string;
  /** Omit to start a new conversation. */
  conversationId?: string;
  /** Required for a new conversation; ignored when resuming (that conversation's subject wins). */
  subjectId?: string;
}

type RetrievedChunk = {
  content: string;
  document_title: string;
  chunk_index: number;
  similarity: number;
};

const SYSTEM_PROMPT = `You are the Study Assistant tutor: a patient, encouraging teacher for one student.

Grounding rules:
- Answer using the PROVIDED CONTEXT (passages retrieved from the student's own uploaded documents) whenever it is relevant to the question.
- Cite what you used inline like [Source: <document title>] so the student can go back to their material.
- If the context does not contain the answer, say so plainly, then offer your best general knowledge clearly labeled as not coming from their materials.
- Never invent quotes, page numbers, or citations that are not in the context.
- Match the student's language. Prefer short paragraphs, bullet points, and one worked example over long walls of text.
- When the student asks for a quiz, produce numbered questions and put the answer key at the end under "Answers".`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const { message, conversationId, subjectId } = (await req.json()) as ChatRequest;

    if (!message?.trim()) {
      return json({ error: "message is required" }, 400);
    }

    if (message.trim().length > MAX_QUESTION_LENGTH) {
      return json({ error: "Message exceeds maximum length" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const dashscopeApiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!dashscopeApiKey) {
      return json({ error: "Service configuration error" }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      },
    );

    // RLS proves the session is valid; the id scopes every write below.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id;
    if (!userId) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // ------------------------------------------------------------------
    // Resolve the conversation (resume) or create one (new chat).
    // ------------------------------------------------------------------
    let activeConversationId = conversationId ?? null;
    let activeSubjectId = subjectId ?? null;

    if (activeConversationId) {
      const { data: conversation, error } = await supabase
        .from("tutor_conversations")
        .select("id, subject_id")
        .eq("id", activeConversationId)
        .single();

      if (error || !conversation) {
        return json({ error: "Conversation not found" }, 404);
      }
      // Resuming keeps that conversation's subject; subjectId can't smuggle a
      // conversation out of its grounding scope.
      activeSubjectId = conversation.subject_id;
    } else {
      if (!activeSubjectId) {
        return json({ error: "subjectId is required to start a conversation" }, 400);
      }
      // Ownership check on the subject happens via this RLS-scoped select.
      const { data: subject } = await supabase
        .from("subjects")
        .select("id, name")
        .eq("id", activeSubjectId)
        .single();
      if (!subject) {
        return json({ error: "Subject not found" }, 404);
      }

      const { data: created, error } = await supabase
        .from("tutor_conversations")
        .insert({ student_id: userId, subject_id: activeSubjectId, title: buildTitle(message) })
        .select("id")
        .single();

      if (error || !created) {
        return json({ error: `Could not start conversation: ${error.message}` }, 500);
      }
      activeConversationId = created.id;
    }

    // ------------------------------------------------------------------
    // Resume support: recent turns, oldest -> newest.
    // ------------------------------------------------------------------
    const { data: history } = await supabase
      .from("tutor_messages")
      .select("role, content")
      .eq("conversation_id", activeConversationId)
      .order("created_at", { ascending: true });

    const recent = (history ?? []).slice(-HISTORY_WINDOW);

    // ------------------------------------------------------------------
    // Retrieval (Task 7 RPC): ground the answer in the class's documents.
    // ------------------------------------------------------------------
    let context: RetrievedChunk[] = [];
    let retrievalError: string | null = null;

    try {
      const [queryEmbedding] = await embedTexts([message.trim()], { apiKey: dashscopeApiKey });

      const { data: matches, error } = await supabase.rpc(
        "search_document_chunks",
        {
          p_query_embedding: JSON.stringify(queryEmbedding),
          p_subject_id: activeSubjectId,
          p_match_count: CONTEXT_CHUNKS,
        },
      );

      if (error) {
        retrievalError = error.message;
      } else {
        context = (matches ?? []) as RetrievedChunk[];
      }
    } catch (err) {
      retrievalError = err instanceof Error ? err.message : "Retrieval failed";
    }

    // ------------------------------------------------------------------
    // Prompt: system rules + retrieved context + history + new question.
    // ------------------------------------------------------------------
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: contextBlock(context),
      },
      ...recent.map<ChatMessage>((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      { role: "user", content: message.trim() },
    ];

    const completion = await chat(messages);

    // ------------------------------------------------------------------
    // Persist both turns (immutable once stored).
    // ------------------------------------------------------------------
    const { error: persistError } = await supabase.from("tutor_messages").insert([
      { conversation_id: activeConversationId, role: "user", content: message.trim() },
      { conversation_id: activeConversationId, role: "assistant", content: completion.content },
    ]);

    if (persistError) {
      // Reply still returns; only resume-ability of this turn is affected.
      console.error("Failed to persist turns:", persistError.message);
    }

    return json({
      ok: true,
      conversationId: activeConversationId,
      subjectId: activeSubjectId,
      reply: completion.content,
      sources: context.map((c) => ({
        documentTitle: c.document_title,
        chunkIndex: c.chunk_index,
        similarity: Number(c.similarity.toFixed(4)),
      })),
      contextUsed: context.length > 0,
      retrievalError,
    });
  } catch (err) {
    console.error("Tutor chat failed:", err);
    return json(
      { error: "Internal server error" },
      500,
    );
  }
});

function contextBlock(context: RetrievedChunk[]): string {
  if (context.length === 0) {
    return "PROVIDED CONTEXT: (none — no passages matched from this student's documents for this class. If the question relies on their materials, say you could not find it there.)";
  }
  const passages = context
    .map(
      (c, i) =>
        `[] Source: "${c.document_title}" (chunk ${c.chunk_index}, relevance ${c.similarity.toFixed(4)})\n${c.content}`,
    )
    .join("\n\n---\n\n");
  return `PROVIDED CONTEXT (passages from this student's uploaded documents; cite like [Source: <title>]):\n\n${passages}`;
}

/** First message becomes the sidebar title, trimmed to a sane length. */
function buildTitle(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length <= 60 ? clean || "New chat" : `${clean.slice(0, 60)}…`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
