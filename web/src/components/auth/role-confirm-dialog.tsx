"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Confirmation dialog shown before a role choice is finalized
 * (spec section 4: "This can't be changed later").
 */
export function RoleConfirmDialog({
  role,
  onConfirm,
  onCancel,
  busy,
  error,
}: {
  role: "student" | "educator";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const { locale } = useLocale();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-confirm-title"
    >
      <div className="w-full max-w-md rounded-card border border-primary-100 bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent-100 text-accent-600">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <div>
            <h2 id="role-confirm-title" className="font-semibold text-ink">
              {locale === "fr"
                ? "Ce choix ne pourra plus être modifié — êtes-vous sûr ?"
                : "This can&apos;t be changed later — are you sure?"}
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              {locale === "fr"
                ? "Votre compte sera définitivement configuré en tant que "
                : "Your account will be permanently set up as "}
              <span className="font-medium capitalize text-ink">
                {locale === "fr" ? (role === "student" ? "étudiant" : "éducateur") : role}
              </span>
              {locale === "fr"
                ? ". Les fonctions des étudiants et des éducateurs sont totalement distinctes, et il n'est pas possible de changer ensuite."
                : ". Student and educator features are completely separate, and there is no way to switch afterward."}
            </p>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-btn bg-surface-muted p-3 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 accent-primary-600"
          />
          {locale === "fr" ? "Je comprends que ce choix est définitif." : "I understand this choice is permanent."}
        </label>

        {error ? (
          <p className="mt-3 text-sm font-medium text-accent-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-btn border border-primary-100 px-4 py-2 text-sm font-medium text-ink/70 transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {locale === "fr" ? "Retour" : "Go back"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged || busy}
            className={cn(
              "rounded-btn bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {busy
              ? locale === "fr"
                ? "Configuration…"
                : "Setting up…"
              : locale === "fr"
                ? `Continuer en tant que ${role === "student" ? "étudiant" : "éducateur"}`
                : `Continue as ${role}`}
          </button>
        </div>
      </div>
    </div>
  );
}
