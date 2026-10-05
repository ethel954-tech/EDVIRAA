"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const INPUT_CLASS =
  "w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:border-[var(--teal)] focus:outline-none";
const LABEL_CLASS = "mb-1 block text-sm text-[var(--ink-soft)]";

export function AccountCard() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  const canSubmit =
    !saving &&
    newPassword.length >= 8 &&
    confirmPassword.length >= 8 &&
    newPassword === confirmPassword;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        console.error(updateError.code);
        setError("Could not update your password. Sign in again and retry.");
        return;
      }
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password updated.");
    } catch {
      setError("Could not update your password. Sign in again and retry.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 text-sm font-medium text-[var(--ink)]">Account</div>

      <div>
        <span className={LABEL_CLASS}>Email</span>
        <p className="text-sm text-[var(--ink)]">{email ?? "—"}</p>
      </div>

      <form onSubmit={handleChangePassword} className="mt-5 space-y-4">
        <div>
          <label htmlFor="new-password" className={LABEL_CLASS}>
            New password
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            className={INPUT_CLASS}
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className={LABEL_CLASS}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            className={INPUT_CLASS}
            placeholder="Repeat your new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {newPassword.length > 0 &&
          confirmPassword.length > 0 &&
          newPassword !== confirmPassword ? (
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              Passwords do not match.
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full bg-[var(--teal)] px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving…" : "Change password"}
        </button>
        {notice ? <p className="text-sm text-[var(--ink)]">{notice}</p> : null}
        {error ? (
          <p className="text-sm text-[var(--ink-soft)]">{error}</p>
        ) : null}
      </form>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm text-[var(--ink-soft)] transition-colors hover:border-[var(--teal)] disabled:opacity-50"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
