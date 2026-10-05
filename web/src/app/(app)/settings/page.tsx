import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-8">
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Settings</h1>
        <p className="mt-2 text-[var(--ink-soft)]">
          Profile, account, and preferences will live here.
        </p>
      </div>

      <div className="mt-6 space-y-6">
        <ThemeSwitcher />
        <LanguageSwitcher />
      </div>
    </div>
  );
}
