"use client";

import { GoogleIcon } from "@/components/auth/google-icon";

export function GoogleButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 rounded-btn border border-primary-100 bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
    >
      <GoogleIcon className="h-5 w-5" />
      {label}
    </button>
  );
}
