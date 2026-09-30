"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ListChecks,
  Lock,
  Map as MapIcon,
  MessageCircle,
  RefreshCw,
  Wand2,
} from "lucide-react";
import { callEdgeFunction } from "@/lib/edge";
import { createClient } from "@/lib/supabase/client";
import { celebrate } from "@/components/ui/toast";
import { AuthError } from "@/components/auth/form-fields";
import { cn } from "@/lib/utils";

export type TopicUI = { id: string; title: string; completed: boolean };

export type ModuleUI = {
  id: string;
  title: string;
  status: "locked" | "in_progress" | "complete";
  topics: TopicUI[];
};

type SubjectOption = { id: string; name: string };

const ACTIVITIES = [
  {
    label: "Tutor",
    icon: MessageCircle,
    href: (subjectId: string) => `/tutor?subject=${subjectId}&ask=explain+the+current+module`,
  },
  {
    label: "Flashcards",
    icon: ListChecks,
    href: (subjectId: string) => `/flashcards?subject=${subjectId}`,
  },
  {
    label: "Quiz",
    icon: Wand2,
    href: (subjectId: string) => `/quiz?subject=${subjectId}`,
  },
] as const;

export function RoadmapView({
  subjects,
  subjectId,
  subjectName,
  modules,
  hasDocuments,
}: {
  subjects: SubjectOption[];
  subjectId: string | null;
  subjectName: string | null;
  modules: ModuleUI[];
  hasDocuments: boolean;
}) {
  const router = useRouter();
  const [openModuleId, setOpenModuleId] = useState<string | null>(
    modules.find((m) => m.status !== "complete")?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchSubject(id: string) {
    router.push(`/roadmap?subject=${id}`);
  }

  async function generateRoadmap() {
    if (!subjectId || generating || busy) return;
    setGenerating(true);
    setError(null);
    try {
      await callEdgeFunction("generate-roadmap", { subjectId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Roadmap generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function toggleTopic(module: ModuleUI, topic: TopicUI) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setLocalTopicCompleted(module.id, topic.id, !topic.completed);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("toggle_topic_completion", {
        p_topic_id: topic.id,
        p_completed: !topic.completed,
      });
      if (error) throw new Error(error.message);
      celebrate(Array.isArray(data) ? data[0] : data);
      router.refresh();
    } catch (e) {
      setLocalTopicCompleted(module.id, topic.id, topic.completed);
      setError(e instanceof Error ? e.message : "Could not update the topic.");
    } finally {
      setBusy(false);
    }
  }

  function setLocalTopicCompleted(moduleId: string, topicId: string, completed: boolean) {
    setModulesOverride((prev) => {
      const base = prev ?? modules;
      return base.map((m) => {
        const topics = m.topics.map((t) =>
          t.id === topicId ? { ...t, completed } : t,
        );
        const status = recomputeStatus(m.id === moduleId ? topics : m.topics);
        return m.id === moduleId ? { ...m, topics, status } : m;
      });
    });
  }

  const [modulesOverride, setModulesOverride] = useState<ModuleUI[] | null>(null);
  useEffect(() => setModulesOverride(null), [modules]);
  const shown = modulesOverride ?? modules;

  const currentModule = shown.find((m) => m.status === "in_progress") ?? shown[0];
  const totalCompletedTopics = shown.reduce(
    (acc, m) => acc + m.topics.filter((t) => t.completed).length,
    0
  );
  const totalTopics = shown.reduce((acc, m) => acc + m.topics.length, 0);
  const overallPct = totalTopics > 0 ? Math.round((totalCompletedTopics / totalTopics) * 100) : 0;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      {/* Top Title & Subject Switcher */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-fraunces text-[26px] font-semibold text-[var(--ink)]">Your roadmap</h1>
          <p className="mt-0.5 text-[14px] text-[var(--ink-soft)]">
            {subjectName ?? "Select a subject to view roadmap"}
          </p>
        </div>
        {subjects.length > 0 ? (
          <select
            value={subjectId ?? ""}
            onChange={(e) => switchSubject(e.target.value)}
            className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] outline-none"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <AuthError message={error} />

      {subjects.length === 0 ? (
        <p className="card-study text-center text-sm text-[var(--ink-soft)]">
          Add a subject during onboarding first — your roadmap is built from your subject documents.
        </p>
      ) : !hasDocuments ? (
        <p className="card-study text-center text-sm text-[var(--ink-soft)]">
          No processed documents in <span className="font-semibold text-[var(--ink)]">{subjectName}</span> yet.
          Upload PDFs in Documents first.
        </p>
      ) : modules.length === 0 ? (
        <section className="card-study text-center py-12">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--teal-pale)] text-[var(--teal)]">
            <MapIcon className="h-6 w-6" />
          </span>
          <h2 className="font-fraunces text-[20px] font-semibold text-[var(--ink)] mt-3">
            Build your learning path
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--ink-soft)]">
            The AI reads your notes and splits them into ordered modules with topics.
          </p>
          <button
            type="button"
            onClick={generateRoadmap}
            disabled={generating}
            className="btn-primary mx-auto mt-5"
          >
            {generating ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            <span>{generating ? "Building roadmap…" : "Generate roadmap"}</span>
          </button>
        </section>
      ) : (
        <>
          {/* Hero In-Progress Card */}
          {currentModule ? (
            <div className="card-study mb-6 flex flex-col items-center gap-6 sm:flex-row">
              <div
                className="ring-progress !h-[110px] !w-[110px]"
                style={{ "--pct": overallPct } as React.CSSProperties}
              >
                <div className="hole !h-[84px] !w-[84px]">
                  <b className="!text-[19px]">{overallPct}%</b>
                  <span className="!text-[10.5px]">Overall</span>
                </div>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <div className="text-[12.5px] font-semibold text-[var(--ink-soft)] mb-0.5">
                  Current focus
                </div>
                <h2 className="font-fraunces text-[21px] font-semibold text-[var(--ink)] mb-2.5">
                  {currentModule.title}
                </h2>
                <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                  {currentModule.topics.map((t) => (
                    <span
                      key={t.id}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[12px] font-semibold",
                        t.completed
                          ? "bg-[var(--teal-pale)] text-[var(--teal-dark)]"
                          : "bg-[var(--violet-pale)] text-[var(--violet)]"
                      )}
                    >
                      {t.title}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Module Rows */}
          <div className="card-study divide-y divide-[var(--border)] !p-0 overflow-hidden">
            {shown.map((module, i) => {
              const done = module.topics.filter((t) => t.completed).length;
              const percent =
                module.topics.length > 0 ? Math.round((done / module.topics.length) * 100) : 0;
              const isOpen = openModuleId === module.id;

              return (
                <div key={module.id} className="transition-colors">
                  <div
                    onClick={() => setOpenModuleId(isOpen ? null : module.id)}
                    className="flex cursor-pointer items-center gap-3.5 p-4 hover:bg-[var(--bg)]"
                  >
                    <StatusBadge status={module.status} />
                    <div className="flex-1 min-w-0">
                      <b className="block text-[14.5px] font-semibold text-[var(--ink)] truncate">
                        {i + 1}. {module.title}
                      </b>
                      <span className="text-[12px] text-[var(--ink-soft)]">
                        {module.status === "complete"
                          ? "Complete"
                          : module.status === "in_progress"
                            ? "In progress"
                            : "Locked"}
                        {" · "}
                        {module.topics.length} topics
                      </span>
                    </div>
                    <span className="text-[13px] font-semibold text-[var(--ink-soft)] mr-1">
                      {module.status === "locked" ? "—" : `${percent}%`}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-[var(--ink-soft)] transition-transform",
                        isOpen && "rotate-180"
                      )}
                    />
                  </div>

                  {isOpen ? (
                    <div className="bg-[var(--bg)] border-t border-[var(--border)] p-4">
                      <ul className="space-y-1.5 mb-3">
                        {module.topics.map((topic, j) => (
                          <li key={topic.id}>
                            <button
                              type="button"
                              onClick={() => toggleTopic(module, topic)}
                              disabled={busy || module.status === "locked"}
                              className="flex w-full items-center gap-2.5 rounded-[8px] p-2 text-left transition-colors hover:bg-[var(--surface)] disabled:opacity-60"
                            >
                              <span
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                                  topic.completed
                                    ? "border-[var(--teal)] bg-[var(--teal)] text-white"
                                    : "border-[var(--border)] bg-[var(--surface)] text-transparent"
                                )}
                              >
                                ✓
                              </span>
                              <span
                                className={cn(
                                  "text-[13.5px]",
                                  topic.completed
                                    ? "text-[var(--ink-soft)] line-through"
                                    : "text-[var(--ink)]"
                                )}
                              >
                                {j + 1}. {topic.title}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>

                      {module.status !== "locked" && subjectId ? (
                        <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border)]">
                          {ACTIVITIES.map(({ label, icon: Icon, href }) => (
                            <Link
                              key={label}
                              href={href(subjectId)}
                              className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)] hover:text-[var(--teal-dark)]"
                            >
                              <Icon className="h-3.5 w-3.5 text-[var(--teal)]" />
                              {label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ModuleUI["status"] }) {
  if (status === "complete") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--teal-pale)] text-[var(--teal-dark)] font-bold text-sm">
        ✓
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--violet-pale)] text-[var(--violet)] font-bold text-sm">
        ●
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[var(--border)] text-[var(--ink-soft)] text-xs">
      <Lock className="h-3.5 w-3.5" />
    </div>
  );
}

function recomputeStatus(topics: TopicUI[]): ModuleUI["status"] {
  if (topics.length === 0) return "locked";
  const done = topics.filter((t) => t.completed).length;
  if (done === topics.length) return "complete";
  if (done > 0) return "in_progress";
  return "locked";
}

