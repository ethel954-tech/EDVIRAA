"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  FileText,
  Home,
  Layers,
  ListChecks,
  Map,
  MessageCircle,
  Presentation,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AppRole = "student" | "educator";

const studentNav = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/roadmap", label: "Roadmap", icon: Map },
  { href: "/tutor", label: "Tutor", icon: MessageCircle },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/flashcards", label: "Flashcards", icon: Layers },
  { href: "/quiz", label: "Quiz", icon: ListChecks },
  { href: "/rooms", label: "Rooms", icon: Users },
  { href: "/progress", label: "Progress", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const educatorNav = [
  { href: "/educator", label: "Home", icon: Presentation },
  { href: "/rooms", label: "Rooms", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const navItems = role === "educator" ? educatorNav : studentNav;
  const isEducator = role === "educator";

  return (
    <aside
      className={cn(
        "flex h-full w-[76px] shrink-0 flex-col items-center gap-[26px] py-[20px] pb-[calc(20px+env(safe-area-inset-bottom,0px))]",
        isEducator ? "bg-[var(--violet-dark)]" : "bg-[var(--teal-dark)]"
      )}
    >
      <Link href={isEducator ? "/educator" : "/dashboard"} className="logo w-[34px] h-[34px] rounded-[9px] bg-[var(--amber)] flex items-center justify-center font-fraunces font-bold text-[#3A2A0F] text-[16px]">
        S
      </Link>

      <nav className="flex flex-1 flex-col gap-[14px]">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== "/dashboard" && href !== "/educator" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "w-[40px] h-[40px] rounded-[10px] flex items-center justify-center transition-colors",
                isEducator ? "text-[#D8CCF2]" : "text-[#BFE3D6]",
                isActive
                  ? "bg-white/15 text-white shadow-sm"
                  : "hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="w-[20px] h-[20px]" strokeWidth={isActive ? 2.2 : 1.8} />
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

