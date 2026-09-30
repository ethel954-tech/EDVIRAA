"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthError, SubmitButton } from "@/components/auth/form-fields";
import { RoleSelect, roleMeta, type Role } from "@/components/auth/role-select";
import { RoleConfirmDialog } from "@/components/auth/role-confirm-dialog";
import { AuthCardFooterLink } from "@/components/auth/auth-card";

/**
 * Shown after the FIRST Google sign-in when the profile has no role yet
 * (role is NULL = "pending"). The dialog comes before the RPC call that
 * finalizes it — the database refuses a role change afterwards, and the
 * client never writes the role column directly.
 */
export function RoleForm() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinalize() {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("finalize_role", {
        chosen_role: role,
      });
      if (error) {
        setError(error.message);
        return;
      }
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
              setError(null);
            }}
            disabled={busy}
          />
        </div>

        <div className="mt-6 space-y-3">
          <AuthError message={error} />
          <SubmitButton
            busy={busy}
            onClick={() => {
              if (role) setConfirming(true);
            }}
          >
            {role
              ? `Continue as ${roleMeta[role].label}`
              : "Select a role to continue"}
          </SubmitButton>
        </div>

        <div className="mt-6">
          <AuthCardFooterLink
            text="Changed your mind about Google?"
            linkText="Use email and password instead"
            href="/auth/sign-up"
          />
        </div>
      </div>

      {role && confirming ? (
        <RoleConfirmDialog
          role={role}
          busy={busy}
          error={error}
          onCancel={() => {
            if (busy) return;
            setConfirming(false);
            setError(null);
          }}
          onConfirm={() => {
            setConfirming(false);
            void handleFinalize();
          }}
        />
      ) : null}
    </div>
  );
}
