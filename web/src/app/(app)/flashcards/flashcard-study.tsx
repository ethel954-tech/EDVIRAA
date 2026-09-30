"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Layers, RefreshCw, Wand2 } from "lucide-react";
import { callEdgeFunction } from "@/lib/edge";
import { createClient } from "@/lib/supabase/client";
import { AuthError } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

type DocOption = { id: string; title: string; cardCount: number };

type Card = { id: string; question: string; answer: string };

export function FlashcardStudy({
  documents,
  initialDocId = null,
}: {
  documents: DocOption[];
  /** Deep-link preselect from the roadmap (?doc= or ?subject=). */
  initialDocId?: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId],
  );

  async function openDocument(id: string) {
    if (busy || loadingCards || id === selectedId) return;
    setError(null);
    setNotice(null);
    setLoadingCards(true);
    setSelectedId(id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("flashcards")
        .select("id, question, answer")
        .eq("document_id", id)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      setCards(data ?? []);
      setFlipped({});
      if ((data ?? []).length === 0) {
        setNotice(
          "No flashcards yet for this document — generate them below.",
        );
      }
    } catch (e) {
      setSelectedId(null);
      setCards([]);
      setError(e instanceof Error ? e.message : "Could not load flashcards.");
    } finally {
      setLoadingCards(false);
    }
  }

  // Roadmap deep link: open the suggested document once on mount. Deferred
  // with a timeout so no setState runs synchronously during the commit
  // (react-hooks/set-state-in-effect).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (initialDocId && documents.some((d) => d.id === initialDocId)) {
      const t = window.setTimeout(() => void openDocument(initialDocId), 0);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await callEdgeFunction("generate-study-materials", {
        documentId: selectedId,
        kind: "flashcards",
      });

      const supabase = createClient();
      const { data, error } = await supabase
        .from("flashcards")
        .select("id, question, answer")
        .eq("document_id", selectedId)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      setCards(data ?? []);
      setFlipped({});
      setNotice(
        `Generated ${data?.length ?? 0} fresh flashcards — flip through them below.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-8 animate-rise py-2">
      <header className="rounded-[16px] border border-[var(--border)] bg-gradient-to-r from-[var(--surface)] via-[var(--surface)] to-[var(--teal-pale)]/30 p-6 shadow-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-pale)] px-3 py-1 text-xs font-semibold text-[var(--teal-dark)] mb-2">
          <Layers className="h-3.5 w-3.5" />
          Active Recall Deck
        </span>
        <h1 className="font-fraunces text-[26px] font-bold text-[var(--ink)]">Flashcard Decks</h1>
        <p className="mt-1 text-[14px] text-[var(--ink-soft)] leading-relaxed">
          Master key concepts from your uploaded study materials. Click any card to trigger a 3D flip and test your memory.
        </p>
      </header>

      {documents.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center text-sm text-[var(--ink-soft)] shadow-xs">
          No processed documents yet — upload a PDF in Documents first, and your flashcards will appear here automatically.
        </p>
      ) : (
        <>
          {/* Document picker */}
          <section aria-label="Choose a document">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--ink-soft)]">
              Select Document Deck ({documents.length})
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => {
                const isSelected = doc.id === selectedId;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => openDocument(doc.id)}
                      disabled={busy || loadingCards}
                      className={cn(
                        "w-full rounded-[14px] border p-4 text-left transition-all duration-200 disabled:opacity-60",
                        isSelected
                          ? "border-[var(--teal)] bg-gradient-to-r from-[var(--teal-pale)]/60 to-[var(--surface)] shadow-sm ring-1 ring-[var(--teal)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--teal)]/40 hover:bg-[var(--bg)]",
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
                          isSelected ? "bg-[var(--teal)] text-white" : "bg-[var(--teal-pale)] text-[var(--teal)]"
                        )}>
                          <Layers className="h-4 w-4" />
                        </span>
                        <span className="truncate text-[14px] font-semibold text-[var(--ink)]">
                          {doc.title}
                        </span>
                      </span>
                      <span className="mt-2.5 block text-xs text-[var(--ink-soft)] font-medium">
                        {doc.cardCount > 0
                          ? `${doc.cardCount} flashcard${doc.cardCount === 1 ? "" : "s"} available`
                          : "No flashcards generated yet"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {selectedDoc ? (
            <section className="space-y-5 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
                <div>
                  <h2 className="font-fraunces text-[22px] font-bold text-[var(--ink)]">{selectedDoc.title}</h2>
                  <p className="text-xs text-[var(--ink-soft)] mt-0.5">{cards.length} cards in this deck</p>
                </div>
                <div className="flex items-center gap-2.5">
                  {cards.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFlipped(
                          Object.fromEntries(cards.map((c) => [c.id, true])),
                        );
                      }}
                      disabled={busy || loadingCards}
                      className="flex items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ink)] shadow-xs transition-colors hover:bg-[var(--bg)] disabled:opacity-50"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--teal)]" />
                      Reveal All Answers
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={busy}
                    className="btn-primary !px-4 !py-2 !text-xs !rounded-[10px] shadow-sm hover:shadow-md transition-all"
                  >
                    {busy ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                    {cards.length > 0 ? "Regenerate Deck" : "Generate Flashcards"}
                  </button>
                </div>
              </div>

              {loadingCards ? (
                <div className="rounded-[18px] bg-[var(--surface)] border border-[var(--border)] px-6 py-14 text-center text-sm text-[var(--ink-soft)] shadow-xs">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto text-[var(--teal)] mb-2" />
                  Loading flashcards...
                </div>
              ) : cards.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center text-sm text-[var(--ink-soft)] shadow-xs">
                  <p>{notice ?? "No flashcards generated yet — click 'Generate Flashcards' above."}</p>
                </div>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card, i) => {
                    const isFlipped = Boolean(flipped[card.id]);
                    return (
                      <li key={card.id} className="h-52 [perspective:1000px]">
                        <button
                          type="button"
                          onClick={() =>
                            setFlipped((prev) => ({ ...prev, [card.id]: !prev[card.id] }))
                          }
                          aria-pressed={isFlipped}
                          className={cn(
                            "relative h-full w-full rounded-[16px] border p-6 text-left shadow-xs transition-all duration-500 [transform-style:preserve-3d]",
                            isFlipped
                              ? "border-[var(--violet)]/30 bg-gradient-to-br from-[var(--violet-pale)] to-[var(--surface)] [transform:rotateY(180deg)]"
                              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--teal)]/40 hover:shadow-md",
                          )}
                        >
                          {/* Front of card (Question) */}
                          <div className={cn(
                            "absolute inset-0 flex flex-col justify-between p-5 [backface-visibility:hidden]",
                            isFlipped && "hidden"
                          )}>
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--teal-pale)] px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--teal-dark)]">
                                Question {i + 1}
                              </span>
                              <p className="mt-3 text-[14.5px] font-semibold leading-relaxed text-[var(--ink)]">
                                {card.question}
                              </p>
                            </div>
                            <span className="text-[11px] font-semibold text-[var(--ink-soft)] flex items-center gap-1">
                              <ArrowLeftRight className="h-3 w-3 text-[var(--teal)]" /> Click to flip answer
                            </span>
                          </div>

                          {/* Back of card (Answer) */}
                          <div className={cn(
                            "absolute inset-0 flex flex-col justify-between p-5 [backface-visibility:hidden] [transform:rotateY(180deg)]",
                            !isFlipped && "hidden"
                          )}>
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--violet-pale)] px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--violet-dark)]">
                                Answer {i + 1}
                              </span>
                              <p className="mt-3 text-[14px] font-medium leading-relaxed text-[var(--ink)]">
                                {card.answer}
                              </p>
                            </div>
                            <span className="text-[11px] font-semibold text-[var(--violet)] flex items-center gap-1">
                              ✓ Mastered concept
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}

      <AuthError message={error} />
    </div>
  );
}
