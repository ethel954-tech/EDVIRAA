"use client";

import { localeLabels, locales, type Locale, getMessage } from "@/lib/i18n";
import { setPreferredLocale, useLocale } from "@/lib/locale-store";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();

  const handleChange = (nextLocale: Locale) => {
    setPreferredLocale(nextLocale);
  };

  return (
    <div className={compact ? "mb-6 flex items-center gap-3" : "rounded-card border border-primary-100 bg-surface p-5"}>
      <div className={compact ? "text-sm font-medium text-ink" : "mb-3 text-sm font-medium text-ink"}>{getMessage(locale, "language")}</div>
      <div className="flex flex-wrap gap-2">
        {locales.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => handleChange(option)}
            className={[
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              locale === option
                ? "border-primary-600 bg-primary-50 text-primary-700"
                : "border-primary-100 bg-white text-ink/70 hover:border-primary-300",
            ].join(" ")}
          >
            {localeLabels[option]}
          </button>
        ))}
      </div>
      {!compact ? <p className="mt-3 text-xs text-ink/60">{getMessage(locale, "saveNotice")}</p> : null}
    </div>
  );
}
