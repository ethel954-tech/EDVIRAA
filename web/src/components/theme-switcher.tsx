"use client";

import { setTheme, themeLabels, themes, useTheme } from "@/lib/theme-store";

export function ThemeSwitcher() {
  const theme = useTheme();

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-3 text-sm font-medium text-[var(--ink)]">Theme</div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Theme preference"
      >
        {themes.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTheme(option)}
            aria-pressed={theme === option}
            aria-label={`Use ${themeLabels[option].toLowerCase()} theme`}
            className={[
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              theme === option
                ? "border-[var(--teal)] bg-[var(--teal-pale)] text-[var(--ink)]"
                : "border-[var(--border)] bg-[var(--bg)] text-[var(--ink-soft)] hover:border-[var(--teal)]",
            ].join(" ")}
          >
            {themeLabels[option]}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--ink-soft)]">
        System follows your device appearance.
      </p>
    </div>
  );
}
