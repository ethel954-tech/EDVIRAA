"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  FieldLabel,
  SubmitButton,
  TextInput,
} from "@/components/auth/form-fields";

/** Max subjects a student can add during onboarding; table allows more later. */
const MAX_SUBJECTS = 12;

export function OnboardingForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [names, setNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAddMore = names.length < MAX_SUBJECTS;

  function addDraft() {
    const name = draft.trim().replace(/\s+/g, " ");
    setError(null);
    if (!name) return;
    if (
      names.some((n) => n.toLowerCase() === name.toLowerCase())
    ) {
      setError(`"${name}" is already on your list.`);
      return;
    }
    if (!canAddMore) {
      setError(`You can add up to ${MAX_SUBJECTS} subjects here.`);
      return;
    }
    setNames((prev) => [...prev, name]);
    setDraft("");
    inputRef.current?.focus();
  }

  function removeName(name: string) {
    setNames((prev) => prev.filter((n) => n !== name));
    setError(null);
  }

  async function handleContinue() {
    if (names.length === 0) {
      setError("Add at least one subject to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session expired. Please log in again.");
        return;
      }

      // subjects.student_id + name is unique, so a retry after a partial
      // failure skips rows that were already saved.
      const { error } = await supabase
        .from("subjects")
        .upsert(
          names.map((name) => ({ student_id: user.id, name })),
          { onConflict: "student_id,name", ignoreDuplicates: true },
        );

      if (error) {
        setError(error.message);
        return;
      }

      // Middleware now sees >= 1 subject and lets the dashboard through.
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-card border border-primary-100 bg-surface p-8">
        <h1 className="text-xl font-semibold text-ink">
          What are you studying?
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Add the subjects you want help with. Type anything — there&apos;s no
          fixed list. You can always change these later.
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            addDraft();
          }}
        >
          <FieldLabel htmlFor="subject-name">Subject</FieldLabel>
          <div className="flex gap-2">
            <TextInput
              id="subject-name"
              ref={inputRef}
              placeholder="e.g. IB Biology, Calculus, Spanish"
              value={draft}
              maxLength={80}
              disabled={!canAddMore || busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              disabled={!canAddMore || busy || draft.trim() === ""}
              className="shrink-0 rounded-btn bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>

        {names.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            {names.map((name) => (
              <li
                key={name}
                className="flex items-center gap-1.5 rounded-btn bg-primary-50 py-1.5 pl-3 pr-1.5 text-sm font-medium text-primary-700"
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeName(name)}
                  aria-label={`Remove ${name}`}
                  disabled={busy}
                  className="rounded-full p-0.5 text-primary-500 transition-colors hover:bg-primary-100 hover:text-primary-700 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-xs text-ink/40">
            Nothing added yet — one subject is enough to start.
          </p>
        )}

        <div className="mt-6 space-y-3">
          <AuthError message={error} />
          <SubmitButton
            busy={busy}
            disabled={names.length === 0}
            onClick={handleContinue}
            type="button"
          >
            {busy
              ? "Setting up…"
              : names.length === 1
                ? "Continue with 1 subject"
                : `Continue with ${names.length} subjects`}
          </SubmitButton>
        </div>
      </div>
    </div>
  );
}
