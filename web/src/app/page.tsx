import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BookOpen, Sparkles, Users, Zap, CheckCircle2 } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--amber)] font-fraunces text-base font-bold text-[#3A2A0F] shadow-xs">
            S
          </div>
          <span className="font-fraunces text-xl font-semibold tracking-tight text-[var(--ink)]">
            Study Assistant
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-[14px] font-medium text-[var(--ink-soft)]">
          <a href="#features" className="hover:text-[var(--teal)] transition-colors">Features</a>
          <a href="#roadmap" className="hover:text-[var(--teal)] transition-colors">Roadmap</a>
          <a href="#rooms" className="hover:text-[var(--teal)] transition-colors">Study Rooms</a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="rounded-[9px] px-4 py-2 text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/auth/sign-up"
            className="btn-primary !px-4 !py-2 !text-sm !rounded-[9px]"
          >
            Get Started Free
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="mx-auto max-w-[1200px] px-6 pt-10 pb-16 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--teal-pale)] px-4 py-1.5 text-xs font-semibold text-[var(--teal-dark)] mb-6 animate-rise">
            <Sparkles className="h-3.5 w-3.5 fill-[var(--teal)]" />
            <span>Your Intelligent Academic Study Companion</span>
          </div>

          <h1 className="mx-auto max-w-4xl font-fraunces text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.12] text-[var(--ink)] mb-6">
            Master your subjects with AI grounded in your own notes.
          </h1>

          <p className="mx-auto max-w-2xl text-base sm:text-lg text-[var(--ink-soft)] mb-8 leading-relaxed">
            Personalized roadmaps, interactive study rooms, instant AI tutoring, and adaptive quizzes tailored directly to your coursework and uploaded documents.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-14">
            <Link href="/auth/sign-up" className="btn-primary !px-6 !py-3 !text-base">
              <span>Start Learning Now</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/auth/login"
              className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-6 py-3 text-base font-semibold text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
            >
              Sign in to account
            </Link>
          </div>

          {/* Hero Banner Image */}
          <div className="relative mx-auto max-w-[1020px] overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl">
            <div className="relative w-full aspect-[16/9] rounded-[14px] overflow-hidden">
              <Image
                src="/landing_hero.png"
                alt="Study Assistant Platform Preview"
                fill
                priority
                className="object-cover object-top"
              />
            </div>
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section id="features" className="bg-[var(--surface)] border-t border-[var(--border)] py-20">
          <div className="mx-auto max-w-[1140px] px-6">
            <div className="text-center mb-14">
              <h2 className="font-fraunces text-3xl sm:text-4xl font-semibold text-[var(--ink)] mb-3">
                Built for deep, academic focus
              </h2>
              <p className="text-[15px] text-[var(--ink-soft)] max-w-xl mx-auto">
                No generic SaaS templates. A warm, structured environment designed for real comprehension and exam success.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="card-study flex flex-col justify-between">
                <div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[var(--teal-pale)] text-[var(--teal)] mb-4">
                    <BookOpen className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="font-fraunces text-xl font-semibold text-[var(--ink)] mb-2">
                    AI Tutor Grounded in Notes
                  </h3>
                  <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed mb-4">
                    Ask questions and get answers strictly grounded in your own documents with exact source citations.
                  </p>
                </div>
                <ul className="space-y-2 text-[13px] text-[var(--ink-soft)] pt-4 border-t border-[var(--border)]">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--teal)]" />
                    <span>Explain like I&apos;m 5 mode</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--teal)]" />
                    <span>Voice dictation & read aloud</span>
                  </li>
                </ul>
              </div>

              {/* Card 2 */}
              <div className="card-study flex flex-col justify-between">
                <div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[var(--violet-pale)] text-[var(--violet)] mb-4">
                    <Zap className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="font-fraunces text-xl font-semibold text-[var(--ink)] mb-2">
                    Interactive Roadmap
                  </h3>
                  <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed mb-4">
                    Watch your progress unfold module by module with visual progress rings, streaks, and XP points.
                  </p>
                </div>
                <ul className="space-y-2 text-[13px] text-[var(--ink-soft)] pt-4 border-t border-[var(--border)]">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--violet)]" />
                    <span>Automatic topic extraction</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--violet)]" />
                    <span>Streak tracking & badges</span>
                  </li>
                </ul>
              </div>

              {/* Card 3 */}
              <div className="card-study flex flex-col justify-between">
                <div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-[var(--amber-pale)] text-[var(--amber)] mb-4">
                    <Users className="h-5.5 w-5.5" />
                  </div>
                  <h3 className="font-fraunces text-xl font-semibold text-[var(--ink)] mb-2">
                    Live Study Rooms
                  </h3>
                  <p className="text-[14px] text-[var(--ink-soft)] leading-relaxed mb-4">
                    Collaborate with peers or join teacher-led rooms to tackle shared quizzes and exam prep together.
                  </p>
                </div>
                <ul className="space-y-2 text-[13px] text-[var(--ink-soft)] pt-4 border-t border-[var(--border)]">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--amber)]" />
                    <span>Peer & Teacher rooms</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--amber)]" />
                    <span>Shared real-time quizzes</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] bg-[var(--bg)] py-8 text-center text-xs text-[var(--ink-soft)]">
        <div className="mx-auto max-w-[1200px] px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--amber)] font-fraunces text-xs font-bold text-[#3A2A0F]">
              S
            </div>
            <span className="font-fraunces text-sm font-semibold text-[var(--ink)]">Study Assistant</span>
          </div>
          <p>© {new Date().getFullYear()} Study Assistant. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
