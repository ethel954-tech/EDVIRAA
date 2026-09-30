"use client";

import { GraduationCap, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

export type Role = "student" | "educator";

export const roleDescriptions: Record<Role, string> = {
  student:
    "Upload your own study materials, get an AI tutor grounded in your notes, flashcards and quizzes, an adaptive roadmap, and peer study rooms.",
  educator:
    "Create teacher-led rooms, build lessons and exams, grade students, and see class-wide knowledge gaps — no student features are shown.",
};

export const roleMeta: Record<
  Role,
  { label: string; icon: typeof GraduationCap }
> = {
  student: { label: "Student", icon: GraduationCap },
  educator: { label: "Educator", icon: Presentation },
};

export function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role | null;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Account type"
      className="grid gap-3 sm:grid-cols-2"
    >
      {(Object.keys(roleMeta) as Role[]).map((role) => {
        const { label, icon: Icon } = roleMeta[role];
        const selected = value === role;
        return (
          <button
            key={role}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(role)}
            className={cn(
              "rounded-card border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-60",
              selected
                ? "border-primary-600 bg-primary-50 ring-1 ring-primary-600"
                : "border-primary-100 bg-surface hover:border-primary-300 hover:bg-primary-50/40",
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-btn",
                  selected
                    ? "bg-primary-600 text-white"
                    : "bg-primary-100 text-primary-700",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="font-semibold text-ink">{label}</span>
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-ink/60">
              {roleDescriptions[role]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
