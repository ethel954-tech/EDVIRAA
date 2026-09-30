"use client";

import Link from "next/link";

export function AuthCardHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6 text-center">
      <div className="mb-4 flex items-center justify-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-[var(--amber)] font-fraunces font-bold text-[#3A2A0F] text-lg">
          S
        </div>
        <span className="font-fraunces text-xl font-semibold text-[var(--ink)]">
          Study Assistant
        </span>
      </div>
      <h1 className="font-fraunces text-2xl font-semibold text-[var(--ink)]">{title}</h1>
      {subtitle ? (
        <p className="mt-1 text-sm text-[var(--ink-soft)]">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function AuthCardFooterLink({
  text,
  linkText,
  href,
  className,
}: {
  text: string;
  linkText: string;
  href: string;
  className?: string;
}) {
  return (
    <p className={className ?? "text-center text-sm text-[var(--ink-soft)]"}>
      {text}{" "}
      <Link
        href={href}
        className="font-semibold text-[var(--teal)] hover:text-[var(--teal-dark)] hover:underline"
      >
        {linkText}
      </Link>
    </p>
  );
}

