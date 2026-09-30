"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  FieldLabel,
  PasswordInput,
  SubmitButton,
  TextInput,
} from "@/components/auth/form-fields";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthCardFooterLink } from "@/components/auth/auth-card";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "Incorrect email or password."
            : error.message,
        );
        return;
      }
      // Success: middleware sees the session cookie on the next navigation
      // and routes by profile state (pending role -> /auth/role, else app).
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleGoogle() {
    setError(null);
    const supabase = createClient();
    // Existing Google users go straight to the app; new ones land on
    // /auth/role because their profile has no role yet (middleware).
    void supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=/dashboard`,
      },
    });
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-card border border-primary-100 bg-surface p-8">
        <h1 className="text-xl font-semibold text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink/60">
          Log in to continue studying.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              autoComplete="current-password"
              required
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <AuthError message={error} />
          <SubmitButton busy={busy}>Log in</SubmitButton>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs font-medium text-ink/40">
          <span className="h-px flex-1 bg-primary-100" />
          OR
          <span className="h-px flex-1 bg-primary-100" />
        </div>

        <GoogleButton onClick={handleGoogle} label="Log in with Google" />

        <div className="mt-6">
          <AuthCardFooterLink
            text="New to Study Assistant?"
            linkText="Create an account"
            href="/auth/sign-up"
          />
        </div>
      </div>
    </div>
  );
}
