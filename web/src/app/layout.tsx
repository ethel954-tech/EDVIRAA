import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import { LocaleProvider } from "@/components/locale-provider";
import { LocaleDocumentSync } from "@/lib/locale-store";
import { ThemeDocumentSync } from "@/lib/theme-store";
import "./globals.css";

// Runs before first paint: applies the stored theme preference to <html>
// so there is no dark/light flash. "system" removes the attribute so the
// prefers-color-scheme media query in globals.css applies.
const themeInitScript = `(function () {
  try {
    var t = localStorage.getItem("preferred-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.dataset.theme = t;
    } else {
      delete document.documentElement.dataset.theme;
    }
  } catch (e) {}
})();`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Study Assistant",
    template: "%s · Study Assistant",
  },
  description: "Personalized AI study assistant grounded in your own notes",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full font-sans bg-[var(--bg)] text-[var(--ink)]">
        <LocaleProvider>
          <LocaleDocumentSync />
          <ThemeDocumentSync />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
