"use client";

import { localeLabels, locales, type Locale, getMessage } from "@/lib/i18n";
import { setPreferredLocale, useLocale } from "@/lib/locale-store";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();

  const handleChange = (nextLocale: Locale) => {
    setPreferredLocale(nextLocale);
  };

  return (
    <div className={compact ? "mb-6 flex items-center gap-3" : "rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5"}>
      <div className={compact ? "text-sm font-medium text-ink" : "mb-3 text-sm font-medium text-[var(--ink)]"}>{getMessage(locale, "language")}</div>
      <div className="flex flex-wrap gap-2">
        {locales.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => handleChange(option)}
            className={[
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              locale === option
                ? "border-[var(--teal)] bg-[var(--teal-pale)] text-[var(--ink)]"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--ink-soft)] hover:border-[var(--teal)]",
            ].join(" ")}
          >
            {localeLabels[option]}
          </button>
        ))}
      </div>
      {!compact ? <p className="mt-3 text-xs text-[var(--ink-soft)]">{getMessage(locale, "saveNotice")}</p> : null}
    </div>
  );
}
