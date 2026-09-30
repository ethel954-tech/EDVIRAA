"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  FieldLabel,
  PasswordInput,
  SubmitButton,
  TextInput,
} from "@/components/auth/form-fields";
import {
  RoleSelect,
  roleMeta,
  type Role,
} from "@/components/auth/role-select";
import { RoleConfirmDialog } from "@/components/auth/role-confirm-dialog";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthCardFooterLink } from "@/components/auth/auth-card";

type Step = "details" | "role" | "check-email";

export function SignUpForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDetailsStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setStep("role");
  }

  async function handleSignUp() {
    if (!role) return;
    setBusy(true);
    setConfirmError(null);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Role + display name travel in signup metadata; the
          // on_auth_user_created trigger writes them into public.profiles
          // (see supabase/migrations/20250921000002_auth_role_finalization.sql).
          data: { role, display_name: displayName.trim() },
          emailRedirectTo: `${location.origin}/auth/callback?next=/dashboard`,
        },
      });

      if (error) {
        setError(error.message);
        setStep("details");
        return;
      }
      // Email confirmation ON: no session yet — show "check your inbox";
      // the user returns through /auth/callback. Confirmation OFF: the
      // session is active immediately, so go straight into the app (the
      // middleware funnels new students to /onboarding).
      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setStep("check-email");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setStep("details");
    } finally {
      setBusy(false);
    }
  }

  function handleGoogle() {
    setError(null);
    const supabase = createClient();
    void supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Google sign-ups pick their role after the redirect, at /auth/role.
        redirectTo: `${location.origin}/auth/callback?next=/auth/role`,
      },
    });
  }

  if (step === "check-email") {
    return (
      <div className="w-full max-w-md rounded-card border border-primary-100 bg-surface p-8 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-primary-600" />
        <h1 className="mt-4 text-xl font-semibold text-ink">
          Check your inbox
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          We sent a confirmation link to <strong>{email}</strong>. Confirm your
          email to finish creating your account.
        </p>
        <div className="mt-6">
          <AuthCardFooterLink
            text="Didn't get it or already confirmed?"
            linkText="Back to log in"
            href="/auth/login"
          />
        </div>
      </div>
    );
  }

  if (step === "role") {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-card border border-primary-100 bg-surface p-8">
          <StepIndicator current={2} />
          <h1 className="text-xl font-semibold text-ink">
            How will you use Study Assistant?
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            Pick your account type. This choice is permanent.
          </p>

          <div className="mt-6">
            <RoleSelect
              value={role}
              onChange={(r) => {
                setRole(r);
                setConfirmError(null);
              }}
              disabled={busy}
            />
          </div>

          <div className="mt-6 space-y-3">
            <AuthError message={confirmError} />
            <SubmitButton
              busy={busy}
              onClick={() => role && setConfirming(true)}
            >
              {role
                ? `Continue as ${roleMeta[role].label}`
                : "Select a role to continue"}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setStep("details")}
              disabled={busy}
              className="w-full rounded-btn px-4 py-2 text-sm font-medium text-ink/60 transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </div>

        {role && confirming ? (
          <RoleConfirmDialog
            role={role}
            busy={busy}
            error={confirmError}
            onCancel={() => {
              if (busy) return;
              setConfirming(false);
              setConfirmError(null);
            }}
            onConfirm={() => {
              setConfirming(false);
              void handleSignUp();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-card border border-primary-100 bg-surface p-8">
        <StepIndicator current={1} />
        <h1 className="text-xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-ink/60">
          Personalized studying, grounded in your own notes.
        </p>

        <form onSubmit={handleDetailsStep} className="mt-6 space-y-4">
          <div>
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            <TextInput
              id="display-name"
              type="text"
              autoComplete="name"
              placeholder="Alex Chen"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <TextInput
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <AuthError message={error} />
          <SubmitButton busy={busy}>Continue</SubmitButton>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs font-medium text-ink/40">
          <span className="h-px flex-1 bg-primary-100" />
          OR
          <span className="h-px flex-1 bg-primary-100" />
        </div>

        <GoogleButton onClick={handleGoogle} label="Sign up with Google" />

        <div className="mt-6">
          <AuthCardFooterLink
            text="Already have an account?"
            linkText="Log in"
            href="/auth/login"
          />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-ink/40">
        Step 2 of 2: you&apos;ll choose Student or Educator — permanently.
      </p>
    </div>
  );
}

function StepIndicator({ current }: { current: 1 | 2 }) {
  return (
    <div className="mb-4 flex items-center gap-1.5" aria-hidden="true">
      <span
        className={
          current === 1
            ? "h-1.5 w-8 rounded-full bg-primary-600"
            : "h-1.5 w-8 rounded-full bg-primary-100"
        }
      />
      <span
        className={
          current === 2
            ? "h-1.5 w-8 rounded-full bg-primary-600"
            : "h-1.5 w-8 rounded-full bg-primary-100"
        }
      />
    </div>
  );
}
