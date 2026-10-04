"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  FieldLabel,
  SubmitButton,
  TextInput,
} from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

type RoomType = "teacher" | "peer";

const roomTypes: Array<{
  value: RoomType;
  label: string;
  description: string;
}> = [
  {
    value: "teacher",
    label: "Teacher-led",
    description:
      "You get the lesson builder, exam builder, and grading tools for this room.",
  },
  {
    value: "peer",
    label: "Peer study",
    description:
      "A shared space for group study — chat and shared quizzes, without teacher tools.",
  },
];

/**
 * Create-room flow for the educator dashboard. Inserting into `rooms` is
 * enough: RLS checks creator_role matches profiles.role, and the
 * on_room_created trigger adds the creator to room_members.
 */
export function CreateRoomDialog({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<RoomType>("teacher");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Please sign in again.");
        return;
      }
      const { error } = await supabase
        .from("rooms")
        .insert({ name: trimmed, type, creator_role: "educator", created_by: user.id });

      if (error) {
        setError(error.message);
        return;
      }

      setOpen(false);
      setName("");
      setType("teacher");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 rounded-[10px] bg-[var(--teal)] px-4 py-2.5 text-xs font-semibold text-white transition-all shadow-xs hover:bg-[var(--teal-dark)] hover:shadow-sm",
          compact && "px-3 py-2 text-xs",
        )}
      >
        <Plus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Create room
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-md animate-rise"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-room-title"
        >
          <div className="w-full max-w-md rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h2 id="create-room-title" className="font-fraunces text-lg font-bold text-[var(--ink)]">
                Create a Class / Study Room
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                aria-label="Close"
                className="rounded-[8px] h-8 w-8 flex items-center justify-center text-sm font-bold text-[var(--ink-soft)] hover:bg-[var(--bg)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <FieldLabel htmlFor="room-name">Room Name</FieldLabel>
                <TextInput
                  id="room-name"
                  placeholder="e.g. AP Physics — Period 2"
                  value={name}
                  maxLength={60}
                  disabled={busy}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  className="!rounded-[10px]"
                />
              </div>

              <fieldset className="space-y-2.5">
                <legend className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--ink-soft)]">
                  Room Type
                </legend>
                {roomTypes.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[12px] border p-3.5 text-sm transition-all",
                      type === option.value
                        ? "border-[var(--teal)] bg-[var(--teal-pale)]/50 shadow-xs"
                        : "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] hover:border-[var(--teal)]/30",
                    )}
                  >
                    <input
                      type="radio"
                      name="room-type"
                      value={option.value}
                      checked={type === option.value}
                      onChange={() => setType(option.value)}
                      disabled={busy}
                      className="mt-1 h-4 w-4 accent-[var(--teal)]"
                    />
                    <span>
                      <span className="font-bold text-[var(--ink)] block">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--ink-soft)]">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <AuthError message={error} />
              <SubmitButton busy={busy} disabled={name.trim() === ""}>
                {busy ? "Creating Room…" : "Create Room"}
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
