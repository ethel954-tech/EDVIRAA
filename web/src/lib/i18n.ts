export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];

export const localeLabels: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

export const messages = {
  en: {
    settings: "Settings",
    language: "Language",
    chooseLanguage: "Choose your language",
    appLanguage: "App language",
    profileAccount: "Profile, account, and preferences",
    english: "English",
    french: "Français",
    saveNotice: "Your language choice is saved on this device.",
  },
  fr: {
    settings: "Paramètres",
    language: "Langue",
    chooseLanguage: "Choisissez votre langue",
    appLanguage: "Langue de l'application",
    profileAccount: "Profil, compte et préférences",
    english: "Anglais",
    french: "Français",
    saveNotice: "Votre choix de langue est enregistré sur cet appareil.",
  },
} as const;

export type MessageKey = keyof (typeof messages)["en"];

export function getMessage(locale: Locale, key: MessageKey) {
  return messages[locale][key];
}
