"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

export const themes = ["light", "dark", "system"] as const;

export const themeLabels: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const themeEvent = "preferred-theme-change";
const STORAGE_KEY = "preferred-theme";
const DEFAULT_THEME: Theme = "system";

function normalize(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME;
}

function applyToDocument(theme: Theme) {
  // "system" removes the attribute so the prefers-color-scheme media query
  // in globals.css applies; explicit choices set it so they win over the OS.
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    return normalize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function subscribeToTheme(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(themeEvent, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(themeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribeToTheme,
    getPreferredTheme,
    () => DEFAULT_THEME,
  );
}

export function setTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode, quota) — still apply for this session.
  }
  applyToDocument(theme);
  window.dispatchEvent(new Event(themeEvent));
}

/** One-time sync of the stored preference onto <html> after hydration. */
export function ThemeDocumentSync() {
  const theme = useTheme();

  useEffect(() => {
    // Read the stored value directly: the hook's snapshot is "system" on the
    // server, and re-applying that here would strip the data-theme attribute
    // the inline script set before hydration (flashing the wrong theme).
    applyToDocument(getPreferredTheme());
  }, [theme]);

  return null;
}
