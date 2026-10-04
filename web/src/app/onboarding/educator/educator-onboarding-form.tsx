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
  defaultSubjectArea,
  defaultInstitution,
  defaultWorkEmail,
  rejectionNote,
}: {
  defaultDisplayName: string;
  defaultSubjectArea: string;
  defaultInstitution: string;
  defaultWorkEmail: string;
  rejectionNote: string | null;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [subjectArea, setSubjectArea] = useState(defaultSubjectArea);
  const [institution, setInstitution] = useState(defaultInstitution);
  const [workEmail, setWorkEmail] = useState(defaultWorkEmail);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    const subject = subjectArea.trim();
    const school = institution.trim();
    const email = workEmail.trim();
    if (name.length === 0) {
      setError("Please enter your name — students will see it in your rooms.");
      return;
    }
    if (subject.length === 0) {
      setError("Please enter your subject area.");
      return;
    }
    if (school.length < 2 || email.length < 5) {
      setError("Enter your school or institution and your work email.");
      return;
    }
    if (!evidenceFile) {
      setError("Upload a school ID, employment letter, or other proof of employment.");
      return;
    }

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(evidenceFile.type) || evidenceFile.size > 5 * 1024 * 1024) {
      setError("Evidence must be a PDF, JPG, or PNG no larger than 5 MB.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setError("Your session expired. Please sign in again.");
        return;
      }

      const extension = evidenceFile.type === "application/pdf"
        ? "pdf"
        : evidenceFile.type === "image/jpeg"
          ? "jpg"
          : "png";
      const evidencePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("educator-verification")
        .upload(evidencePath, evidenceFile, { contentType: evidenceFile.type });

      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const { error: submitError } = await supabase.rpc(
        "submit_educator_verification",
        {
          p_display_name: name,
          p_subject_area: subject,
          p_institution: school,
          p_work_email: email,
          p_evidence_path: evidencePath,
        },
      );

      if (submitError) {
        await supabase.storage.from("educator-verification").remove([evidencePath]);
        setError(submitError.message);
        return;
      }

      router.replace("/educator/pending");
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
          Apply for educator access
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Educator access requires admin review of your school details and proof of employment.
        </p>

        {rejectionNote && (
          <p role="alert" className="mt-4 rounded-[12px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Application not approved: {rejectionNote}
          </p>
        )}

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

          <div>
            <FieldLabel htmlFor="institution">School or institution</FieldLabel>
            <TextInput
              id="institution"
              required
              maxLength={160}
              placeholder="e.g. Northview Secondary School"
              value={institution}
              disabled={busy}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="work-email">School or institutional email</FieldLabel>
            <TextInput
              id="work-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="name@school.edu"
              value={workEmail}
              disabled={busy}
              onChange={(e) => setWorkEmail(e.target.value)}
            />
          </div>

          <div>
            <FieldLabel htmlFor="evidence">Proof of educator employment</FieldLabel>
            <input
              id="evidence"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              required
              disabled={busy}
              onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-btn border border-primary-100 bg-surface p-2 text-sm text-ink/70 file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700"
            />
            <p className="mt-1 text-xs text-ink/50">PDF, JPG, or PNG; maximum 5 MB.</p>
          </div>

          <AuthError message={error} />
          <SubmitButton busy={busy}>Submit for review</SubmitButton>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-ink/40">
        Your evidence is visible only to you and authorized administrators.
      </p>
    </div>
  );
}
