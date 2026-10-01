import { Sidebar, type AppRole } from "@/components/layout/sidebar";
import { ToastHost } from "@/components/ui/toast";
import { FocusMusicPlayer } from "@/components/focus-music-player";

export function AppShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role: AppRole;
}) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg)]">
      <Sidebar role={role} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <ToastHost />
      <FocusMusicPlayer />
    </div>
  );
}

