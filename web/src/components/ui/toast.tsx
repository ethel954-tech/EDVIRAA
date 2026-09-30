"use client";

import { useEffect, useState } from "react";
import { Award, Flame, Trophy, Users, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal toast system (no external dependency): a module-level event bus +
 * a <ToastHost /> mounted once in the AppShell. Any client component can
 * pushToast(); gamifying RPCs use celebrate() to surface XP gains and newly
 * earned badges.
 */

type ToastVariant = "xp" | "badge" | "error";

type ToastItem = {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  icon?: string; // badge icon name from the badges catalog
};

type BadgeRow = { id?: string; name?: string; description?: string; icon?: string };

/** Shape returned by the gamified RPCs (xp_awarded + new_badges jsonb). */
export type RpcReward = {
  xp_awarded?: number | string | null;
  new_badges?: BadgeRow[] | string | null;
} | null | undefined;

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function pushToast(t: Omit<ToastItem, "id">) {
  const item = { ...t, id: ++seq };
  listeners.forEach((l) => l(item));
}

export function pushErrorToast(title: string, description?: string) {
  pushToast({ variant: "error", title, description });
}

/** Normalize + announce a gamification result: +XP toast, then badge toasts. */
export function celebrate(reward: RpcReward) {
  if (!reward) return;
  const xp = Number(reward.xp_awarded ?? 0);
  if (Number.isFinite(xp) && xp > 0) {
    pushToast({
      variant: "xp",
      title: `+${xp} XP`,
      description: "Every active day keeps your streak alive.",
    });
  }

  // new_badges arrives as a jsonb array; tolerate a JSON string just in case.
  let badges: BadgeRow[] = [];
  const raw = reward.new_badges;
  if (Array.isArray(raw)) badges = raw;
  else if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) badges = parsed as BadgeRow[];
    } catch {
      /* malformed — skip */
    }
  }
  for (const b of badges) {
    if (!b?.name) continue;
    pushToast({
      variant: "badge",
      title: `Badge earned: ${b.name}`,
      description: b.description,
      icon: b.icon,
    });
  }
}

const BADGE_ICONS: Record<string, typeof Award> = {
  trophy: Trophy,
  users: Users,
  flame: Flame,
  award: Award,
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: () => void;
}) {
  // Auto-dismiss after a few seconds; callers can also close manually.
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5200);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const Icon =
    BADGE_ICONS[toast.icon ?? ""] ??
    (toast.variant === "xp" ? Zap : toast.variant === "badge" ? Award : null);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-card border p-4 shadow-lg",
        toast.variant === "xp" && "border-secondary-700 bg-secondary-600 text-white",
        toast.variant === "badge" && "border-primary-700 bg-primary-600 text-white",
        toast.variant === "error" && "border-red-200 bg-white text-red-700",
      )}
    >
      {Icon && (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-btn bg-white/15">
          <Icon className="h-4.5 w-4.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{toast.title}</p>
        {toast.description && (
          <p
            className={cn(
              "mt-0.5 text-xs leading-relaxed",
              toast.variant === "error" ? "text-red-600" : "text-white/80",
            )}
          >
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className={cn(
          "shrink-0 rounded-btn p-1 transition-colors",
          toast.variant === "error"
            ? "text-red-400 hover:text-red-600"
            : "text-white/60 hover:text-white",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (t) =>
      setItems((prev) => [...prev.slice(-4), t]); // keep the newest few
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <ToastCard
          key={t.id}
          toast={t}
          onDismiss={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}
    </div>
  );
}
