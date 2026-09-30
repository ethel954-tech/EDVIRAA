"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  FieldLabel,
  SubmitButton,
  TextInput,
} from "@/components/auth/form-fields";

/** Quick picks shown as chips; the field stays free text. */
const SUBJECT_SUGGESTIONS = [
  "Mathematics",
  "Biology",
  "Chemistry",
  "Physics",
  "History",
  "English",
  "Computer Science",
  "Languages",
];

/**
 * Educator profile setup (spec section 4: role -> profile setup -> educator
 * dashboard). Writes display_name + subject_area to the educator's own
 * profile row — allowed by the existing profiles_update_own RLS policy.
 */
export function EducatorOnboardingForm({
  defaultDisplayName,
}: {
  defaultDisplayName: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [subjectArea, setSubjectArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    const subject = subjectArea.trim();
    if (name.length === 0) {
      setError("Please enter your name — students will see it in your rooms.");
      return;
    }
    if (subject.length === 0) {
      setError("Please enter your subject area.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name, subject_area: subject })
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");

      if (error) {
        setError(error.message);
        return;
      }

      // Middleware now sees subject_area set and routes /educator normally.
      router.replace("/educator");
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
          Set up your educator profile
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Tell us who you are and what you teach. You&apos;ll create rooms for
          your students next.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <FieldLabel htmlFor="display-name">Your name</FieldLabel>
            <TextInput
              id="display-name"
              autoComplete="name"
              placeholder="e.g. Dr. Alex Chen"
              value={displayName}
              maxLength={60}
              disabled={busy}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="subject-area">Subject area</FieldLabel>
            <TextInput
              id="subject-area"
              placeholder="e.g. High school biology"
              value={subjectArea}
              maxLength={80}
              disabled={busy}
              onChange={(e) => setSubjectArea(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUBJECT_SUGGESTIONS.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  disabled={busy}
                  onClick={() => setSubjectArea(subject)}
                  className="rounded-full border border-primary-100 bg-surface px-2.5 py-1 text-xs font-medium text-ink/70 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-60"
                >
                  {subject}
                </button>
              ))}
            </div>
          </div>

          <AuthError message={error} />
          <SubmitButton busy={busy}>Continue to dashboard</SubmitButton>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-ink/40">
        You can update your name and subject later in Settings.
      </p>
    </div>
  );
}
