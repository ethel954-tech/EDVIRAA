import Link from "next/link";
import { ArrowRight, Flame, Zap, Lock, Check } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-10 md:py-8">
      {/* Topline Header */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-3xl font-semibold tracking-tight text-[var(--ink)]">
            Good afternoon, Amara
          </h1>
          <p className="mt-1 text-[14.5px] text-[var(--ink-soft)]">
            Biology 101 · 3 subjects in progress
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="pill-tag pill-amber">
            <Flame className="h-4 w-4 fill-amber-500 stroke-amber-600" />
            <span>6 day streak</span>
          </div>
          <div className="pill-tag pill-teal">
            <Zap className="h-4 w-4 fill-teal-600 stroke-teal-700" />
            <span>340 XP this week</span>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-5.5 lg:grid-cols-[1.35fr_1fr]">
        {/* Left Column Stack */}
        <div className="flex flex-col gap-5.5 lg:col-span-1">
          {/* Hero Continuation Card */}
          <div className="card-study animate-rise flex flex-col items-center gap-7 sm:flex-row">
            <div className="ring-progress shadow-sm" style={{ "--pct": 62 } as React.CSSProperties}>
              <div className="hole">
                <b>62%</b>
                <span>Module 2</span>
              </div>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <div className="text-[13px] font-medium text-[var(--ink-soft)]">
                Biology 101 · Continue your roadmap
              </div>
              <h2 className="font-fraunces text-[24px] font-semibold text-[var(--ink)] my-1.5">
                Cell Structure
              </h2>
              <Link href="/roadmap" className="btn-primary">
                <span>Continue studying</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Quick Stat Strip */}
          <div className="grid grid-cols-3 gap-3.5">
            <div className="card-study !p-4">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">12</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Sessions this week</span>
            </div>
            <div className="card-study !p-4">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">4</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Badges earned</span>
            </div>
            <div className="card-study !p-4">
              <b className="font-fraunces text-[22px] text-[var(--ink)]">87%</b>
              <span className="text-[12.5px] text-[var(--ink-soft)]">Quiz accuracy</span>
            </div>
          </div>

          {/* Roadmap Summary Card */}
          <div className="card-study">
            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-4">
              Biology 101 roadmap
            </h3>
            <div className="divide-y divide-[var(--border)]">
              <div className="flex items-center gap-3.5 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--teal-pale)] text-[13px] font-bold text-[var(--teal-dark)]">
                  <Check className="h-4 w-4 stroke-[2.5]" />
                </div>
                <div className="flex-1">
                  <b className="block text-[14px] font-semibold text-[var(--ink)]">Intro to Cells</b>
                  <span className="text-[12px] text-[var(--ink-soft)]">Module 1</span>
                </div>
                <span className="text-[13px] font-semibold text-[var(--ink-soft)]">100%</span>
              </div>

              <div className="flex items-center gap-3.5 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--violet-pale)] text-[13px] font-bold text-[var(--violet)]">
                  ●
                </div>
                <div className="flex-1">
                  <b className="block text-[14px] font-semibold text-[var(--ink)]">Cell Structure</b>
                  <span className="text-[12px] text-[var(--ink-soft)]">Module 2 · in progress</span>
                </div>
                <span className="text-[13px] font-semibold text-[var(--violet)]">62%</span>
              </div>

              <div className="flex items-center gap-3.5 py-3.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--border)] text-[13px] font-bold text-[var(--ink-soft)]">
                  <Lock className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <b className="block text-[14px] font-semibold text-[var(--ink)]">Membrane Transport</b>
                  <span className="text-[12px] text-[var(--ink-soft)]">Module 3</span>
                </div>
                <span className="text-[13px] font-semibold text-[var(--ink-soft)]">—</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side Column */}
        <div className="flex flex-col gap-5.5 lg:col-span-1">
          <div className="card-study h-full">
            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-4">
              Your rooms
            </h3>
            
            <div className="mb-3 flex items-center justify-between rounded-r-[10px] border-l-[3.5px] border-[var(--violet)] bg-surface py-2.5 pl-3.5">
              <div>
                <b className="block text-[14px] font-semibold text-[var(--ink)]">Chem exam prep</b>
                <span className="text-[12px] text-[var(--ink-soft)]">3 members · live now</span>
              </div>
              <span className="h-2 w-2 rounded-full bg-[var(--teal)] animate-pulse" />
            </div>

            <div className="mb-6 flex items-center justify-between rounded-r-[10px] border-l-[3.5px] border-[var(--teal)] bg-surface py-2.5 pl-3.5">
              <div>
                <b className="block text-[14px] font-semibold text-[var(--ink)]">Physics group</b>
                <span className="text-[12px] text-[var(--ink-soft)]">5 members</span>
              </div>
            </div>

            <h3 className="font-fraunces text-[17px] font-semibold text-[var(--ink)] mb-3 mt-6">
              Weak spots
            </h3>

            <div className="divide-y divide-[var(--border)]">
              <div className="flex items-center justify-between py-3">
                <span className="text-[14px] text-[var(--ink)]">Cell membrane transport</span>
                <Link href="/tutor" className="text-[12.5px] font-semibold text-[var(--violet)] hover:underline">
                  Review →
                </Link>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-[14px] text-[var(--ink)]">Osmosis vs diffusion</span>
                <Link href="/tutor" className="text-[12.5px] font-semibold text-[var(--violet)] hover:underline">
                  Review →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

