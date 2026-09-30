Master Build Prompt: Study Assistant Platform (Web + Mobile)
Feed this to an AI coding tool (Lovable, Rork, Claude Code, Cursor, etc.) as the master brief. It covers both the Next.js web app and the Expo SDK 51 mobile app, sharing one Supabase backend. Feed the shared sections (1–6) first, then the platform-specific sections (7 for web, 8 for mobile) depending on which build you're working on.

1. Project Overview
Build [App Name] — a study assistant platform for personalized learning, available on web and mobile, sharing one backend. Students upload their own study materials (PDFs); the app generates a personalized learning experience: an AI tutor grounded in their notes (RAG), auto-generated flashcards/quizzes, a modular adaptive roadmap, and social study rooms for peer and teacher-led group study. Teachers get a separate dashboard to build lessons/exams and grade students inside rooms they create.

Differentiator: unlike typical note-digitizing tools, this focuses on making notes understandable in whatever form helps a student (text, voice, and eventually music/comics/podcasts), and makes studying social through student- and teacher-created rooms.

2. Tech Stack
Shared backend (single source of truth for both apps):

Supabase: PostgreSQL, Auth, Storage, Realtime, pgvector (embeddings)
Qwen AI (free tier) for AI tutor responses and content generation, called through a shared API layer (see Section 6) so both apps hit the same logic
Web:

Next.js (App Router), TypeScript, Tailwind CSS
Mobile — Expo SDK 51, precisely:

Expo SDK 51 (React Native 0.74)
Expo Router v3 for file-based navigation — bottom tab navigator via a (tabs) route group, matching the web sidebar's sections (Home, Roadmap, Tutor, Rooms, Progress)
TypeScript throughout
@supabase/supabase-js for the client, with:
react-native-url-polyfill/auto imported at the app entry (required for Supabase to work in RN)
@react-native-async-storage/async-storage passed as Supabase's storage option, so auth sessions persist across app restarts
Styling: NativeWind v4 (Tailwind syntax for React Native, compatible with Expo SDK 51) so design tokens/colors can be kept consistent with the web Tailwind config — alternative is plain StyleSheet if NativeWind setup proves troublesome under time pressure
expo-document-picker — PDF upload from device
expo-file-system — reading the picked file before upload to Supabase Storage
expo-speech — text-to-speech (tutor reading responses aloud)
expo-av — audio recording for voice input/voice notes (SDK 51's stable audio API; do not reach for expo-audio, which is still experimental at this SDK)
expo-notifications — optional, for streak/reminder pushes if time allows
3. Design System (shared across both platforms)
Primary color: Teal — calm, focused, deliberately not the generic ed-tech blue/purple
Secondary/accent: Purple — AI/tutor-related elements
Highlight: Coral — gamification (XP, streaks, badges) and to mark the current user's own messages/selections
Rounded corners (10–12px), generous whitespace, minimal clutter
Web: persistent left sidebar nav (Home, Roadmap, Tutor, Rooms, Progress, Settings)
Mobile: bottom tab bar with the same five core sections (icons: home, map, message-circle, users, activity), matching web's information architecture so the product feels like one app on two surfaces
Keep a single shared color/spacing token definition (e.g., a theme.ts with hex values and radii) that both the Tailwind config (web) and NativeWind config (mobile) reference, so a color change only happens in one place
4. User Roles & Auth (shared logic, platform-specific UI)
Two account types: Student and Educator
Role chosen at signup, permanently locked — no switching later. Show a confirmation dialog before finalizing ("This can't be changed later") on both platforms
Supabase Auth: email/password + Google SSO on both web and mobile (use expo-auth-session for the mobile OAuth flow)
Student onboarding: role → class/subject selection (student-defined, not tied to any institution) → optional diagnostic assessment per class → roadmap generated
Educator onboarding: role → profile setup (name, subject area) → educator dashboard empty state prompting room creation
Teacher and student sides are not automatically linked; a teacher only sees a given student once that student joins a room the teacher created
5. Data Model (Supabase — identical for both apps)
profiles — id (references auth.users), role ('student' | 'educator'), display_name, created_at
classes — id, student_id, name, created_at
documents — id, student_id, class_id, title, storage_path, created_at
document_chunks — id, document_id, content, embedding (vector), chunk_index
modules — id, class_id, title, order_index, status ('locked' | 'in_progress' | 'complete')
topics — id, module_id, title, order_index
study_sessions — id, user_id, started_at, ended_at, xp_earned, summary
quiz_attempts — id, user_id, topic_id, score, mistakes (jsonb), created_at
error_journal_entries — id, user_id, topic_id, question, correct_answer, user_answer, created_at
rooms — id, created_by, creator_role ('student' | 'educator'), name, type ('teacher' | 'peer'), created_at
room_members — room_id, user_id, joined_at
room_messages — id, room_id, user_id, content, created_at
gamification — user_id, xp, level, current_streak, longest_streak, last_active_date
badges — id, user_id, badge_key, earned_at
Enable Row Level Security: users read/write only their own rows; room-scoped policies grant access to room_members of that room for room_messages and shared room content.

6. Shared API/Logic Layer
Build the AI calls (tutor response, quiz/flashcard generation, module auto-splitting, RAG retrieval) as Supabase Edge Functions (or a small separate Node API) rather than duplicating logic in both the Next.js app and the Expo app. Both frontends call the same endpoints. This also means:

Swapping Qwen for a paid provider later only requires changing the edge function, not both apps
RAG retrieval (embed query → pgvector similarity search → return chunks → prompt Qwen) lives here once, shared by web and mobile
7. Web App Structure (Next.js)
Pages
/auth — sign up (role lock warning), log in
/onboarding — class selection, diagnostic assessment
/dashboard — home: streak, XP this week, active rooms, continue-roadmap card, joined rooms list
/tutor — chat interface (teal = assistant, purple = user), mic button for voice input, quick-action chips (ELI5, make a quiz)
/documents — upload zone (drag-and-drop), processing status, document list per class
/roadmap — module cards (locked/in-progress/complete) per class, drill into topics/activities
/rooms — room list, create room, room detail (chat, shared quiz, presence, member avatars); teacher rooms show lesson/exam builder + grading view
/progress — overall completion, streak calendar, weak spots list, XP trend chart, per-class breakdown
/educator — educator-only dashboard: created rooms, lesson builder, exam builder, grading view, class-wide gap analytics
/settings
8. Mobile App Structure (Expo Router v3)
app/
  (auth)/
    sign-in.tsx
    sign-up.tsx
  (onboarding)/
    select-classes.tsx
    assessment.tsx
  (tabs)/
    index.tsx          -> Home/Dashboard
    roadmap.tsx
    tutor.tsx
    rooms/
      index.tsx         -> room list
      [roomId].tsx       -> room detail
    progress.tsx
  educator/
    index.tsx           -> educator dashboard (only reachable if role === 'educator')
    lesson-builder.tsx
    exam-builder.tsx
    grading/[roomId].tsx
  settings.tsx
Gate the (tabs) layout vs a role-specific stack using the profiles.role value fetched right after auth — students land in (tabs), educators land in an educator-specific stack (their own bottom-tab or stack navigator, no student tabs shown)
Document upload uses expo-document-picker to select a PDF, then uploads to Supabase Storage the same way as web (shared upload function in the API layer)
Voice input: record with expo-av's Audio.Recording, upload the audio, send to a transcription step in the tutor edge function (or use device speech-to-text if available); voice output via expo-speech's Speech.speak() reading the tutor's text response
Study rooms: Supabase Realtime channels work the same way as web — subscribe to room_messages inserts and presence for the room the user is viewing
9. Feature Details (apply to both platforms; UI adapts to each)
AI Tutor
RAG-grounded chat, per-class scoped retrieval
Modes: default, ELI5/peer/professor toggle, explain-it-back, debate mode
Auto-logs mistakes to the error journal
Roadmap/Modules
Auto-generated from document headings where possible, else sequential split
Visual states: locked (grey, lock icon), in-progress (purple, progress bar), complete (teal, checkmark)
Study Rooms
One shared primitive; creator's role determines available tools
Peer rooms: chat, shared quiz/flashcards, presence, member avatars
Teacher rooms: peer-room features plus lesson/exam assignment and grading, visible only to the teacher for their own room
Gamification
XP for real engagement (topic complete, session finished, quiz performance weighted toward correct-after-struggling, weak-spot review)
Streaks with a weekly grace/freeze mechanic
Badges for milestones, surfaced as a toast/notification and listed on Progress
Leaderboards scoped per room/class, never global
Progress/Analytics
Overall completion, streak calendar, weak spots list, XP trend, per-class breakdown
Educator Tools
Lesson builder, exam builder (matches the teacher's own format), grading with AI-suggested feedback + manual override, class-wide knowledge-gap view aggregated from students in that room
10. Build Order (both platforms, risk-first)
Supabase schema + RLS policies (shared foundation)
Auth + role lock + class selection — web first, then mirror in Expo
Document upload + RAG pipeline as an edge function — build once, verify retrieval quality, then wire both frontends to it
AI Tutor chat (text) on web, then mobile
Flashcard/quiz generation, roadmap/module auto-split
Study rooms (peer rooms first) — web, then mobile (Realtime logic is nearly identical)
Gamification (XP, streaks, badges)
Progress/analytics page
Educator dashboard (lesson/exam builder, grading)
Voice input/output — Web Speech API + MediaRecorder on web, expo-av + expo-speech on mobile
Polish, seed demo data, integration testing on both platforms
11. Notes for the AI Builder
Treat the Supabase schema and edge functions as the single source of truth; never let web and mobile diverge in business logic — only UI code should differ between them
Do not hardcode any school/institution concept — classes belong to individual students
On mobile, confirm expo-av (not the newer, still-experimental expo-audio) is used for SDK 51 to avoid compatibility issues
Favor simple, fully working versions of each feature over partially built advanced ones — this is a time-constrained build
Keep components modular on both platforms (dashboard, tutor, roadmap, rooms, educator views separable) so pieces can be built and tested independently