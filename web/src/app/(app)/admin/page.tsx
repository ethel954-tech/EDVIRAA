import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { AdminDashboard } from "./admin-dashboard";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboardPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (!profile?.role) redirect("/auth/role");
  if (profile.role !== "admin") redirect("/dashboard");

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin account management.");
  }

  const authAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const [
    profilesResult,
    pendingResult,
    totalUsersResult,
    totalStudentsResult,
    totalEducatorsResult,
    totalAdminsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, subject_area, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("educator_verifications")
      .select("user_id, educator_institution, educator_work_email, educator_evidence_path, educator_submitted_at")
      .eq("educator_verification_status", "pending")
      .not("educator_submitted_at", "is", null)
      .order("educator_submitted_at", { ascending: true })
      .limit(50),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "student"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "educator"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin"),
  ]);

  const { data: authUsersResult } = await authAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const authUsersById = new Map(
    (authUsersResult?.users ?? []).map((authUser) => [authUser.id, authUser]),
  );

  const profiles = (profilesResult.data ?? []).map((row) => {
    const authUser = authUsersById.get(row.id);
    return {
      ...row,
      email: authUser?.email ?? null,
      accountActive: authUser ? !authUser.banned_until : null,
    };
  });
  const applicantIds = (pendingResult.data ?? []).map((application) => application.user_id);
  const { data: applicantProfiles } = applicantIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, subject_area")
        .in("id", applicantIds)
    : { data: [] };
  const applicantsById = new Map((applicantProfiles ?? []).map((profile) => [profile.id, profile]));
  const pendingEducators = await Promise.all(
    (pendingResult.data ?? []).map(async (application) => {
      const { data: evidence } = application.educator_evidence_path
        ? await authAdmin.storage
            .from("educator-verification")
            .createSignedUrl(application.educator_evidence_path, 600)
        : { data: null };
      const profile = applicantsById.get(application.user_id);
      return {
        id: application.user_id,
        display_name: profile?.display_name ?? null,
        subject_area: profile?.subject_area ?? null,
        educator_institution: application.educator_institution,
        educator_work_email: application.educator_work_email,
        educator_submitted_at: application.educator_submitted_at,
        evidenceUrl: evidence?.signedUrl ?? null,
      };
    }),
  );
  // Real totals from exact counts; a failed count logs its code and yields
  // null, which the UI renders as "—" instead of a misleading number.
  const countOrNull = (
    result: { count: number | null; error: { code?: string } | null },
    label: string,
  ) => {
    if (result.error) {
      console.error(`Failed to count ${label}`, { code: result.error.code });
      return null;
    }
    return result.count ?? null;
  };

  const totals = {
    totalUsers: countOrNull(totalUsersResult, "users"),
    totalStudents: countOrNull(totalStudentsResult, "students"),
    totalEducators: countOrNull(totalEducatorsResult, "educators"),
    totalAdmins: countOrNull(totalAdminsResult, "admins"),
  };

  return (
    <AdminDashboard
      userName={profile.display_name ?? "Admin"}
      currentAdminId={user.id}
      initialProfiles={profiles}
      pendingEducators={pendingEducators}
      totals={totals}
    />
  );
}
