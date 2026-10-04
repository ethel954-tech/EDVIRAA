/// <reference path="../deno-types.d.ts" />
// @ts-ignore: Deno npm: specifier — resolved by the edge runtime, not tsc.
import { createClient } from "npm:@supabase/supabase-js@2";
// ============================================================================
// speech-transcribe — voice note → text for the AI Tutor (Task 24)
//
// Receives JSON with the recording as base64, sends it as an `input_audio`
// content part to the shared OpenAI-compatible LLM endpoint (LLM_BASE_URL /
// LLM_API_KEY — same layer as the other functions, provider Gemini) and
// returns the transcript. The caller (mobile app) then sends the transcript
// to tutor-chat as a normal text message.
//
// Deploy:  supabase functions deploy speech-transcribe
// Secrets: supabase secrets set LLM_API_KEY=... LLM_BASE_URL=...
//          (LLM_TRANSCRIBE_MODEL optional; falls back to LLM_MODEL,
//          then gemini-2.5-flash)
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TranscribeRequest {
  audio_base64: string;
  mime_type?: string;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Hard wall-clock cap on the provider call (hardening: never hang). */
const TRANSCRIBE_TIMEOUT_MS = 30_000;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Audio upload exceeds the 5 MB request limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return json({ error: "Audio upload exceeds the 5 MB request limit." }, 413);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const apiKey = Deno.env.get("LLM_API_KEY");
    const baseUrl = Deno.env.get("LLM_BASE_URL")?.replace(/\/+$/, "");
    const model =
      Deno.env.get("LLM_TRANSCRIBE_MODEL") ??
      Deno.env.get("LLM_MODEL") ??
      "gemini-2.5-flash";
    if (!apiKey || !baseUrl) {
      console.error("[speech-transcribe] LLM configuration missing");
      return json({ error: "Transcription is not configured." }, 500);
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

    // The mobile client sends JSON with the recording as base64 (RN FormData
    // multipart is unreliable across platforms, so base64 is simplest).
    const { audio_base64, mime_type } = await readJsonWithLimit(req);
    if (!audio_base64) {
      return json({ error: "audio_base64 is required" }, 400);
    }

    // The OpenAI-compatible audio content part wants plain base64 plus a
    // short format hint; derive it from the client's MIME type (audio/mp4 ->
    // "mp4", audio/mpeg -> "mpeg", audio/webm -> "webm", fallback "mp4").
    // Strip a data-URI prefix if the client ever sends one.
    const audioB64 = audio_base64.replace(/^data:[^;]+;base64,/, "").trim();
    const bytes = base64ToBytes(audioB64);
    if (bytes.length === 0) {
      return json({ error: "Empty audio upload" }, 400);
    }

    const mimeType = mime_type || "audio/mp4";
    const audioFormat = mimeType.split("/")[1]?.split(";")[0] || "mp4";

    // Shared OpenAI-compatible endpoint (Gemini) — audio in, text out.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: audioB64, format: audioFormat },
                },
                {
                  type: "text",
                  text: "Transcribe this audio exactly as spoken.",
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await res.json().catch((err) => {
      console.error("[speech-transcribe] provider response parse failed:", err);
      return {};
    });
    if (!res.ok) {
      throw new Error(payload?.error?.message || `ASR API error ${res.status}`);
    }

    const transcript: string =
      payload?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!transcript) {
      return json({ error: "No speech detected in the recording." }, 200);
    }

    return json({ ok: true, transcript }, 200);
  } catch (err) {
    console.error("[speech-transcribe] transcription failed:", err);
    return json(
      { error: err instanceof Error ? err.message : "Transcription failed." },
      err instanceof RequestBodyTooLargeError ? 413 : 500,
    );
  }
});

async function readJsonWithLimit(req: Request): Promise<TranscribeRequest> {
  const reader = req.body?.getReader();
  if (!reader) return JSON.parse(await req.text()) as TranscribeRequest;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as TranscribeRequest;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/=+$/, "");
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let u = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = chars.indexOf(clean.charAt(i));
    const e2 = chars.indexOf(clean.charAt(i + 1));
    const e3 = chars.indexOf(clean.charAt(i + 2));
    const e4 = chars.indexOf(clean.charAt(i + 3));
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    bytes[u++] = c1;
    if (e3 !== 64 && e3 !== -1) bytes[u++] = c2;
    if (e4 !== 64 && e4 !== -1) bytes[u++] = c3;
  }
  return bytes.subarray(0, u);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
