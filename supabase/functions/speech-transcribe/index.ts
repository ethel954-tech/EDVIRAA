/// <reference path="../deno-types.d.ts" />
// ============================================================================
// speech-transcribe — voice note → text for the AI Tutor (Task 24)
//
// Receives a multipart/form-data upload with an "audio" file part, sends it
// to Qwen's audio understanding endpoint (qwen2-audio-asr) and returns the
// transcript. The caller (mobile app) then sends the transcript to tutor-chat
// as a normal text message.
//
// Deploy:  supabase functions deploy speech-transcribe
// Secrets: supabase secrets set DASHSCOPE_API_KEY=sk-...
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const apiKey = Deno.env.get("DASHSCOPE_API_KEY");
    if (!apiKey) {
      console.error("[speech-transcribe] provider API key is not configured");
      return json({ error: "DASHSCOPE_API_KEY is not configured" }, 500);
    }

    // The mobile client sends JSON with the recording as base64 (RN FormData
    // multipart is unreliable across platforms, so base64 is simplest).
    const { audio_base64, mime_type } = (await req.json()) as TranscribeRequest;
    if (!audio_base64) {
      return json({ error: "audio_base64 is required" }, 400);
    }

    const bytes = base64ToBytes(audio_base64);
    if (bytes.length === 0) {
      return json({ error: "Empty audio upload" }, 400);
    }

    // Convert to base64 data URI for the DashScope API
    const dataUri = `data:${mime_type || "audio/mp4"};base64,${bytesToBase64(bytes)}`;

    // DashScope qwen2-audio transcription (OpenAI-compatible endpoint)
    const res = await fetch(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen2-audio-asr",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: dataUri, format: "mp4" },
                },
                {
                  type: "text",
                  text: "Transcribe this audio exactly as spoken.",
                },
              ],
            },
          ],
          modalities: ["text"],
        }),
      },
    );

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
      500,
    );
  }
});

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
