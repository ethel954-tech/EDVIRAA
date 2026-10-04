"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { getMessage, messages, type Locale, type MessageKey } from "@/lib/i18n";
import {
  getPreferredLocale,
  localize,
  setPreferredLocale,
  subscribeToLocale,
} from "@/lib/locale-store";

const translations: Record<string, readonly [string, string]> = {
  incorrectCredentials: [
    "Incorrect email or password.",
    "Adresse e-mail ou mot de passe incorrect.",
  ],
  tryAgain: [
    "Something went wrong. Please try again.",
    "Une erreur s'est produite. Veuillez réessayer.",
  ],
  loginTitle: ["Welcome back", "Bon retour"],
  loginPrompt: ["Log in to continue learning.", "Connectez-vous pour continuer à apprendre."],
  email: ["Email", "E-mail"],
  password: ["Password", "Mot de passe"],
  passwordPlaceholder: ["Your password", "Votre mot de passe"],
  login: ["Log in", "Se connecter"],
  or: ["OR", "OU"],
  googleLogin: ["Continue with Google", "Continuer avec Google"],
  newToApp: ["New to Study Assistant?", "Nouveau sur Study Assistant ?"],
  createAccountLink: ["Create an account", "Créer un compte"],
};

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore<Locale>(
    subscribeToLocale,
    getPreferredLocale,
    () => "en",
  );

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: setPreferredLocale,
      t: (key: string) => {
        const translatedEntry = translations[key];
        if (translatedEntry) {
          return localize(locale, translatedEntry[0], translatedEntry[1]);
        }

        if (key in messages.en) {
          return getMessage(locale, key as MessageKey);
        }

        return key;
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }

  return context;
}