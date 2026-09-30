// Subject helpers (Task 25/26): shared lookup of the student's subjects and
// their last-active subject (persisted server-side via set_active_subject).
import { supabase } from "./supabase";

export type Subject = { id: string; name: string };

/** All of the signed-in student's subjects, newest first. */
export async function listSubjects(): Promise<Subject[]> {
  const { data, error } = await supabase
    .from("subjects")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Subject[];
}

/** The persisted active subject, falling back to the student's first subject. */
export async function getActiveSubject(): Promise<Subject | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: state } = await supabase
    .from("student_state")
    .select("active_subject_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (state?.active_subject_id) {
    const { data: subject } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("id", state.active_subject_id)
      .maybeSingle();
    if (subject) return subject as Subject;
  }
  const subjects = await listSubjects();
  return subjects[0] ?? null;
}

/** Persist the student's active subject (server-enforced ownership). */
export async function setActiveSubject(subjectId: string): Promise<void> {
  const { error } = await supabase.rpc("set_active_subject", {
    p_subject_id: subjectId,
  });
  if (error) throw new Error(error.message);
}
