import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import { LocaleProvider } from "@/components/locale-provider";
import { LocaleDocumentSync } from "@/lib/locale-store";
import "./globals.css";

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
      <body className="min-h-full font-sans bg-[var(--bg)] text-[var(--ink)]">
        <LocaleProvider>
          <LocaleDocumentSync />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
