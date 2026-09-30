"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Baby,
  BookOpen,
  FileText,
  ListChecks,
  MessagesSquare,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  UserRound,
  Volume2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  dictationSupported,
  readAloudSupported,
  speak,
  startDictation,
  stopSpeaking,
} from "@/lib/speech";
import { AuthError, TextInput } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

type SubjectOption = { id: string; name: string };

type ConversationSummary = {
  id: string;
  title: string;
  subjectId: string | null;
  updatedAt: string;
};

type SourceRef = { documentTitle: string; chunkIndex: number; similarity: number };

type ChatUIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceRef[];
  contextUsed?: boolean;
  pending?: boolean;
};

/** Quick-action chips (spec: shown above the input). */
const QUICK_ACTIONS = [
  {
    label: "Explain like I'm 5",
    icon: Baby,
    message:
      "Explain the main ideas in my documents for this subject like I'm 5, with a simple example.",
  },
  {
    label: "Make a quiz",
    icon: ListChecks,
    message:
      "Make a short quiz from my documents for this subject — numbered questions, answer key at the end.",
  },
] as const;

export function TutorChat({
  subjects,
  conversations,
  initialSubjectId = null,
  initialAsk = null,
}: {
  subjects: SubjectOption[];
  conversations: ConversationSummary[];
  initialSubjectId?: string | null;
  initialAsk?: string | null;
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatUIMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeSubjectId, setActiveSubjectId] = useState<string | null>(initialSubjectId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [micOn, setMicOn] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speechReady, setSpeechReady] = useState(false);

  const stopMicRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSpeechReady(true), 0);
    return () => {
      window.clearTimeout(t);
      stopMicRef.current?.();
      stopSpeaking();
    };
  }, []);

  function toggleMic() {
    if (micOn) {
      stopMicRef.current?.();
      stopMicRef.current = null;
      setMicOn(false);
      return;
    }
    setVoiceError(null);
    const stop = startDictation({
      onText: (text) => setInput(text),
      onEnd: () => {
        stopMicRef.current = null;
        setMicOn(false);
      },
      onError: (message) => setVoiceError(message),
    });
    if (stop) {
      stopMicRef.current = stop;
      setMicOn(true);
    } else {
      setVoiceError("Voice input isn't supported in this browser.");
    }
  }

  function toggleReadAloud(m: ChatUIMessage) {
    if (speakingId === m.id) {
      stopSpeaking();
      setSpeakingId(null);
      return;
    }
    const started = speak(m.content, () => setSpeakingId(null));
    setSpeakingId(started ? m.id : null);
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const activeSubject = subjects.find((s) => s.id === activeSubjectId) ?? null;

  const initialAskSent = useRef(false);
  useEffect(() => {
    if (initialAskSent.current || !initialAsk) return;
    initialAskSent.current = true;
    const t = window.setTimeout(() => void send(initialAsk), 0);
    return () => window.clearTimeout(t);
  }, []);

  function startNewChat() {
    if (busy || loadingHistory) return;
    setActiveConversationId(null);
    setActiveSubjectId(null);
    setMessages([]);
    setError(null);
  }

  async function openConversation(id: string) {
    if (busy || loadingHistory || id === activeConversationId) return;
    setError(null);
    setLoadingHistory(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tutor_messages")
        .select("id, role, content")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);

      setMessages(
        (data ?? []).map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      );
      setActiveConversationId(id);
      setActiveSubjectId(conversations.find((c) => c.id === id)?.subjectId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that conversation.");
    } finally {
      setLoadingHistory(false);
    }
  }

  async function send(rawText: string) {
    const text = rawText.trim();
    if (!text || busy || loadingHistory) return;

    if (!activeConversationId && !activeSubjectId) {
      setError("Pick a subject first — the tutor answers from that subject's documents.");
      return;
    }

    const userTempId = crypto.randomUUID();
    const assistantTempId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userTempId, role: "user", content: text },
      { id: assistantTempId, role: "assistant", content: "", pending: true },
    ]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Your session expired. Please log in again.");

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/tutor-chat`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: text,
            conversationId: activeConversationId ?? undefined,
            subjectId: activeConversationId ? undefined : activeSubjectId,
          }),
        },
      );

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        conversationId?: string;
        subjectId?: string | null;
        reply?: string;
        sources?: SourceRef[];
        contextUsed?: boolean;
      };

      if (!response.ok || payload.error || !payload.reply) {
        throw new Error(payload.error ?? `Tutor request failed (${response.status}).`);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantTempId
            ? {
                ...m,
                content: payload.reply!,
                sources: payload.sources,
                contextUsed: payload.contextUsed,
                pending: false,
              }
            : m,
        ),
      );
      setActiveConversationId(payload.conversationId ?? activeConversationId);
      setActiveSubjectId(payload.subjectId ?? activeSubjectId);
      router.refresh();
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantTempId));
      setInput(text);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-1px)] max-w-[960px] gap-4 p-4 md:p-6">
      {/* Sidebar history */}
      <aside className="hidden w-64 shrink-0 flex-col rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 md:flex">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="font-fraunces text-sm font-semibold text-[var(--ink)]">Your chats</h2>
          <button
            type="button"
            onClick={startNewChat}
            disabled={busy || loadingHistory}
            className="flex items-center gap-1 rounded-[8px] bg-[var(--teal)] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--teal-dark)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-1 py-6 text-center text-xs text-[var(--ink-soft)]">
              No chats yet — ask your first question.
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                disabled={busy || loadingHistory}
                className={cn(
                  "w-full rounded-[8px] px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                  c.id === activeConversationId
                    ? "bg-[var(--teal-pale)] text-[var(--teal-dark)] font-medium"
                    : "text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)]",
                )}
              >
                <span className="block truncate text-xs font-semibold">{c.title}</span>
                <span className="block truncate text-[11px] opacity-75">
                  {formatRelative(c.updatedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat View */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="pb-4">
          <div className="flex items-center justify-between">
            <h2 className="font-fraunces text-[22px] font-semibold text-[var(--ink)]">
              {activeConversation?.title ?? (activeSubject ? `${activeSubject.name}` : "AI Tutor")}
            </h2>
            {subjects.length > 0 && !activeConversation ? (
              <select
                value={activeSubjectId ?? ""}
                onChange={(e) => {
                  setActiveSubjectId(e.target.value || null);
                  setError(null);
                }}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--ink)] outline-none"
              >
                <option value="" disabled>
                  Select subject…
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13.5px] text-[var(--ink-soft)]">
            Grounded in your uploaded notes & documents
          </p>
        </div>

        {/* Message Thread */}
        <div ref={scrollRef} className="flex-1 space-y-3.5 overflow-y-auto pr-1">
          {loadingHistory ? (
            <p className="py-10 text-center text-sm text-[var(--ink-soft)]">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--teal-pale)] text-[var(--teal)]">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="font-fraunces text-[20px] font-semibold text-[var(--ink)] mt-3">
                Ask your study companion
              </h3>
              <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-[var(--ink-soft)]">
                Pick a subject and ask any question based on your uploaded study notes.
              </p>
            </div>
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[76%] rounded-[16px] rounded-br-[4px] bg-[var(--violet-pale)] px-4 py-3 text-[14.5px] leading-[1.55] text-[var(--ink)]">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col items-start gap-1">
                  <div className="max-w-[76%] rounded-[16px] rounded-bl-[4px] bg-[var(--teal-pale)] px-4 py-3 text-[14.5px] leading-[1.55] text-[var(--ink)]">
                    {m.pending ? (
                      <span className="flex items-center gap-1 py-1">
                        <Dot delay="0ms" />
                        <Dot delay="150ms" />
                        <Dot delay="300ms" />
                      </span>
                    ) : (
                      m.content
                    )}
                  </div>
                  {!m.pending && m.sources && m.sources.length > 0 ? (
                    <div className="ml-1 flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-soft)]">
                        Sources:
                      </span>
                      {m.sources.slice(0, 4).map((s, i) => (
                        <span
                          key={`${m.id}-src-${i}`}
                          className="flex max-w-[200px] items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]"
                        >
                          <FileText className="h-3 w-3 shrink-0 text-[var(--teal)]" />
                          <span className="truncate">{s.documentTitle}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {!m.pending && m.content && speechReady && readAloudSupported() ? (
                    <button
                      type="button"
                      onClick={() => toggleReadAloud(m)}
                      className="ml-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--ink-soft)] hover:text-[var(--teal)]"
                    >
                      {speakingId === m.id ? (
                        <>
                          <Square className="h-3 w-3" /> Stop
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3 w-3" /> Listen
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
              )
            )
          )}
        </div>

        {/* Quick Chips & Input Bar */}
        <div className="pt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {QUICK_ACTIONS.map(({ label, icon: Icon, message }) => (
              <button
                key={label}
                type="button"
                disabled={busy || loadingHistory}
                onClick={() => send(message)}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--ink-soft)] transition-colors hover:border-[var(--teal)] hover:text-[var(--teal-dark)] disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <AuthError message={error} />
          {voiceError ? (
            <p className="mb-2 rounded-[8px] bg-red-50 px-3 py-1.5 text-xs text-red-600">
              {voiceError}
            </p>
          ) : null}

          <form
            className="flex items-center gap-2.5 rounded-full border border-[var(--border)] bg-[var(--surface)] p-2 pl-4 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              value={input}
              placeholder={
                micOn
                  ? "Listening… speak now"
                  : activeConversation || activeSubjectId
                    ? "Ask about your notes…"
                    : "Pick a subject above to ask questions…"
              }
              maxLength={4000}
              disabled={busy || loadingHistory}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 border-none bg-transparent text-[14px] text-[var(--ink)] placeholder-[var(--ink-soft)] outline-none"
            />
            {speechReady && dictationSupported() ? (
              <button
                type="button"
                onClick={toggleMic}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  micOn
                    ? "animate-pulse bg-red-100 text-red-600"
                    : "bg-[var(--violet-pale)] text-[var(--violet)] hover:opacity-80",
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy || loadingHistory || input.trim() === ""}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--teal)] text-white transition-colors hover:bg-[var(--teal-dark)] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--teal)]"
      style={{ animationDelay: delay }}
    />
  );
}

function formatRelative(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

