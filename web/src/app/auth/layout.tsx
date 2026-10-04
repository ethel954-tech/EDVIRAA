import { LanguageSwitcher } from "@/components/language-switcher";

/**
 * Auth pages (/auth/*) render standalone — no sidebar, centered card.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <LanguageSwitcher compact />
      {children}
    </div>
  );
}
