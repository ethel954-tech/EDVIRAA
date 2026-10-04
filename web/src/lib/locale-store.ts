"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";

const localeEvent = "preferred-locale-change";
const STORAGE_KEY = "preferred-locale";
const DEFAULT_LOCALE: Locale = "en";

export function getPreferredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "fr" ? "fr" : DEFAULT_LOCALE;
}

export function subscribeToLocale(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(localeEvent, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(localeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, getPreferredLocale, () => DEFAULT_LOCALE);
}

export function setPreferredLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, locale);
  window.dispatchEvent(new Event(localeEvent));
}

export function localize(locale: Locale, english: string, french: string) {
  return locale === "fr" ? french : english;
}

export function LocaleDocumentSync() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  return null;
}