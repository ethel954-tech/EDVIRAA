/**
 * Onboarding pages (/onboarding/*) render standalone — no sidebar, centered
 * card, matching the auth pages' look. First-run users shouldn't see app
 * chrome yet, and the middleware would bounce them from app pages anyway.
 */
export default function OnboardingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      {children}
    </div>
  );
}
