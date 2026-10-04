"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  FileCheck2,
  Filter,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";

type ProfileRow = {
  id: string;
  display_name: string | null;
  role: "student" | "educator" | "admin";
  subject_area: string | null;
  created_at: string | null;
  email: string | null;
  accountActive: boolean | null;
};

type EducatorApplication = {
  id: string;
  display_name: string | null;
  subject_area: string | null;
  educator_institution: string | null;
  educator_work_email: string | null;
  educator_submitted_at: string | null;
  evidenceUrl: string | null;
};

export function AdminDashboard({
  userName,
  currentAdminId,
  initialProfiles,
  pendingEducators,
  totals,
}: {
  userName: string;
  currentAdminId: string;
  initialProfiles: ProfileRow[];
  pendingEducators: EducatorApplication[];
  totals: {
    totalUsers: number | null;
    totalStudents: number | null;
    totalEducators: number | null;
    totalAdmins: number | null;
  };
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [applications, setApplications] = useState(pendingEducators);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ProfileRow["role"]>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNoteById, setReviewNoteById] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const filteredProfiles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      const matchesRole = roleFilter === "all" || profile.role === roleFilter;
      const haystack = [profile.display_name, profile.subject_area, profile.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesQuery = !normalized || haystack.includes(normalized);
      return matchesRole && matchesQuery;
    });
  }, [profiles, query, roleFilter]);

  const updateAccountStatus = async (id: string, active: boolean) => {
    setUpdatingId(id);
    setStatusError(null);
    try {
      const response = await fetch(`/api/admin/users/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const result = (await response.json()) as { active?: boolean; error?: string };

      if (!response.ok) {
        setStatusError(result.error ?? "Could not update this account.");
        return;
      }

      setProfiles((current) =>
        current.map((profile) =>
          profile.id === id ? { ...profile, accountActive: result.active ?? active } : profile,
        ),
      );
    } catch {
      setStatusError("Could not reach the server. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  const reviewApplication = async (
    applicationId: string,
    decision: "verified" | "rejected",
  ) => {
    const note = reviewNoteById[applicationId]?.trim() ?? "";
    if (decision === "rejected" && !note) {
      setReviewError("Add a reason before rejecting an application.");
      return;
    }

    setReviewingId(applicationId);
    setReviewError(null);
    try {
      const response = await fetch(
        `/api/admin/educators/${applicationId}/verification`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, note }),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setReviewError(result.error ?? "Could not update this application.");
        return;
      }

      setApplications((current) =>
        current.filter((application) => application.id !== applicationId),
      );
    } catch {
      setReviewError("Could not reach the server. Please try again.");
    } finally {
      setReviewingId(null);
    }
  };

  const statCards = [
    {
      label: "Total users",
      value: totals.totalUsers,
      icon: Users,
      accent: "text-[var(--indigo)]",
    },
    {
      label: "Students",
      value: totals.totalStudents,
      icon: Briefcase,
      accent: "text-[var(--teal)]",
    },
    {
      label: "Educators",
      value: totals.totalEducators,
      icon: Building2,
      accent: "text-[var(--violet)]",
    },
    {
      label: "Admins",
      value: totals.totalAdmins,
      icon: ShieldCheck,
      accent: "text-[var(--amber)]",
    },
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8">
      <div className="mb-6 flex flex-col gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--indigo)]">
          System control
        </p>
        <h1 className="font-fraunces text-[30px] font-semibold text-[var(--ink)]">
          Admin dashboard
        </h1>
        <p className="text-[14px] text-[var(--ink-soft)]">
          Welcome back, {userName}. Monitor roles, campuses, and core engagement.
        </p>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, accent }) => (
          <div
            key={label}
            className="rounded-[20px] border border-[var(--border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.7),rgba(248,250,252,0.8))] p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                {label}
              </span>
              <span className={`rounded-full bg-[var(--bg)] p-2 ${accent}`}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="text-[30px] font-fraunces text-[var(--ink)]">
              {value ?? "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <div className="rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_10px_28px_rgba(17,24,39,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--amber)]" />
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">Admin actions</h2>
          </div>
          <div className="space-y-3 text-[13px] text-[var(--ink-soft)]">
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-3">Review educator verification applications</div>
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-3">Audit educator room creation</div>
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] p-3">Manage membership and access</div>
          </div>
        </div>
      </div>

      <section
        id="educator-applications"
        className="mb-6 rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_10px_28px_rgba(17,24,39,0.04)]"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-[var(--teal)]" />
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">
              Educator verification queue
            </h2>
          </div>
          <span className="rounded-full bg-[var(--bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-soft)]">
            {applications.length} pending
          </span>
        </div>

        {reviewError && (
          <p role="alert" className="mb-3 rounded-[12px] border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            {reviewError}
          </p>
        )}

        {applications.length === 0 ? (
          <p className="rounded-[12px] bg-[var(--bg)] p-4 text-[12.5px] text-[var(--ink-soft)]">
            No educator applications are waiting for review.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {applications.map((application) => (
              <article key={application.id} className="grid gap-4 py-4 lg:grid-cols-[1fr_1.2fr_auto] lg:items-center">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--ink)]">
                    {application.display_name || "Unnamed applicant"}
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--ink-soft)]">
                    {application.educator_institution || "Institution not provided"}
                  </p>
                  <p className="text-[12px] text-[var(--ink-soft)]">
                    {application.educator_work_email || "Work email not provided"} · {application.subject_area || "Subject not provided"}
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--ink-soft)]">
                    Submitted {application.educator_submitted_at
                      ? new Date(application.educator_submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "date unavailable"}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {application.evidenceUrl ? (
                    <a
                      href={application.evidenceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--ink)] hover:border-[var(--teal)]"
                    >
                      Open evidence
                    </a>
                  ) : (
                    <span className="text-[11px] text-red-700">Evidence unavailable</span>
                  )}
                  <textarea
                    value={reviewNoteById[application.id] ?? ""}
                    onChange={(event) =>
                      setReviewNoteById((current) => ({
                        ...current,
                        [application.id]: event.target.value,
                      }))
                    }
                    maxLength={1000}
                    rows={2}
                    placeholder="Rejection reason, if needed"
                    className="min-w-0 flex-1 resize-y rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--teal)]"
                  />
                </div>

                <div className="flex gap-2 lg:flex-col">
                  <button
                    type="button"
                    disabled={!application.evidenceUrl || reviewingId === application.id}
                    onClick={() => void reviewApplication(application.id, "verified")}
                    className="rounded-full bg-emerald-700 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reviewingId === application.id ? "Saving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === application.id}
                    onClick={() => void reviewApplication(application.id, "rejected")}
                    className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[0_14px_32px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--indigo)]" />
            <h2 className="text-[14px] font-semibold text-[var(--ink)]">User management</h2>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users"
                className="w-full rounded-full border border-[var(--border)] bg-[var(--bg)] py-2 pl-9 pr-3 text-[12.5px] text-[var(--ink)] outline-none transition focus:border-[var(--indigo)] sm:w-[220px]"
              />
            </label>

            <label className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--ink-soft)]">
              <Filter className="h-3.5 w-3.5" />
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                className="bg-transparent text-[var(--ink)] outline-none"
              >
                <option value="all">All roles</option>
                <option value="student">Student</option>
                <option value="educator">Educator</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
        </div>

        {statusError && (
          <p role="alert" className="mb-3 rounded-[12px] border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            {statusError}
          </p>
        )}

        <p className="mb-3 text-[12px] text-[var(--ink-soft)]">
          Showing the 50 most recent users
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                <th className="pb-3 pr-4 font-medium">User</th>
                <th className="pb-3 pr-4 font-medium">Role</th>
                <th className="pb-3 pr-4 font-medium">Account</th>
                <th className="pb-3 pr-4 font-medium">Area</th>
                <th className="pb-3 pr-4 font-medium">Joined</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[12.5px] text-[var(--ink-soft)]">
                    No users match your current filters.
                  </td>
                </tr>
              ) : (
                filteredProfiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-[var(--border)]/80 align-middle">
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-[var(--ink)]">
                        {profile.display_name ?? "Unnamed user"}
                      </div>
                      <div className="text-[11.5px] text-[var(--ink-soft)]">
                        {profile.email ?? profile.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11px] font-medium capitalize text-[var(--ink)]">
                        {profile.role}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium",
                          profile.accountActive === true
                            ? "bg-emerald-100 text-emerald-800"
                            : profile.accountActive === false
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-700",
                        ].join(" ")}
                      >
                        {profile.accountActive === true
                          ? "Active"
                          : profile.accountActive === false
                            ? "Deactivated"
                            : "Unavailable"}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[var(--ink-soft)]">
                      {profile.subject_area ?? "—"}
                    </td>
                    <td className="py-3 pr-4 text-[var(--ink-soft)]">
                      {profile.created_at
                        ? new Date(profile.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        disabled={
                          profile.accountActive === null ||
                          profile.id === currentAdminId ||
                          updatingId === profile.id
                        }
                        onClick={() =>
                          updateAccountStatus(profile.id, profile.accountActive === false)
                        }
                        className={[
                          "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                          profile.accountActive
                            ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                        ].join(" ")}
                        title={
                          profile.id === currentAdminId
                            ? "You cannot deactivate your own account"
                            : undefined
                        }
                      >
                        {updatingId === profile.id
                          ? "Updating..."
                          : profile.accountActive === true
                            ? "Deactivate"
                            : profile.accountActive === false
                              ? "Activate"
                              : "Unavailable"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
