"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/** Password input with show/hide toggle. */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="relative">
      <input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        className={cn(
          "w-full rounded-btn border border-primary-100 bg-surface px-3 py-2.5 pr-10 text-sm text-ink placeholder:text-ink/40 focus:border-primary-400 focus:outline-none",
          className,
        )}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ink/40 transition-colors hover:text-ink/70"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

/** Styled text/email input. */
export function TextInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-btn border border-primary-100 bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-primary-400 focus:outline-none",
        className,
      )}
    />
  );
}

/** Form label with consistent spacing. */
export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-ink/80"
    >
      {children}
    </label>
  );
}

/** Primary submit button with built-in spinner state. */
export function SubmitButton({
  busy,
  disabled,
  children,
  className,
  onClick,
  type = "submit",
}: {
  busy?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-btn bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Error banner for auth failures. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-btn border border-accent-200 bg-accent-50 px-3 py-2 text-sm font-medium text-accent-700"
    >
      {message}
    </p>
  );
}
