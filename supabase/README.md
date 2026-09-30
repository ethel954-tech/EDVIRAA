# Database

Supabase migrations for the Study Assistant platform.

## Migrations

- **`20250921000000_init_schema.sql`** — all 14 app tables, enums, triggers, indexes, and Row Level Security
- **`20250921000001_storage_documents.sql`** — private `documents` storage bucket for PDF uploads
- **`20250921000002_auth_role_finalization.sql`** — role-selection finalization for OAuth signups: `profiles.role` becomes nullable (`NULL` = pending choice), adds `role_confirmed_at`, the `enforce_role_lock` trigger (role writes require recorded confirmation and are one-time only), and the `finalize_role(chosen_role)` RPC the client calls after the "This can't be changed later" dialog
- **`20250921000003_educator_onboarding.sql`** — `profiles.subject_area` (free text, nullable; set during educator onboarding, its presence marks completed educator setup) and a `profile_label()` helper ("Dr. Chen — Mathematics")
- **`20250921000004_document_status.sql`** — `document_status` enum (`processing | ready | failed`), `documents.status` (default `processing`, so uploads show "Processing..." until the RAG ingestion edge function marks them ready via `mark_document_ready()`)
- **`20250921000005_rag_search_function.sql`** — `search_document_chunks(query_embedding, p_subject_id, match_count)` RPC: subject-scoped pgvector cosine top-k over `ready` documents, SECURITY DEFINER with an explicit `student_id = auth.uid()` ownership check (no cross-student leakage)
- **`20250921000006_tutor_chat.sql`** — AI tutor chat persistence (Task 8): `tutor_conversations` (owner, optional class scope, activity-sorted via `updated_at`) and immutable `tutor_messages` (both turns of every exchange, so chats can be resumed); messages inherit ownership through the parent conversation
- **`20250921000007_flashcards_quizzes.sql`** — generated study material (Task 9): `flashcards` (per-document Q&A pairs), `quizzes` + `quiz_questions` (MCQs with the answer key), `submit_quiz_attempt(quiz_id, answers)` SECURITY DEFINER grading RPC (server-side scoring + automatic error-journal logging of every miss); relaxes `quiz_attempts.topic_id` / `error_journal_entries.topic_id` to nullable with `ON DELETE SET NULL` FKs, and links attempts/journal entries back to quizzes via `quiz_id` + `quiz_question_id`
- **`20250921000008_roadmap.sql`** — roadmap (Task 10): `topics.completed_at` and the `toggle_topic_completion(topic_id, completed)` SECURITY DEFINER RPC, which recomputes the module's status atomically (all topics done → `complete`, some → `in_progress`, none → `locked`); module rows are created by the `generate-roadmap` function, which seeds the first module as `in_progress`
- **`20250921000009_study_rooms.sql`** — study rooms core (Task 11): `rooms.invite_code` (unique 8-char join code, backfilled, server-generated only), `create_room(p_name)` RPC (room **type is derived from the creator's role** server-side: student → `peer`, educator → `teacher`), `join_room_by_code(p_code)` RPC (the code is the join capability), `profiles.avatar_color` (deterministic palette index for member avatars, assigned at signup + backfilled), realtime publication for `room_messages` + `room_members`, and a roster RLS fix (room members see the full roster, needed for avatars)
- **`20250921000010_room_activities.sql`** — shared room activities (Task 12): `room_sessions` (host, kind quiz/flashcards, `current_item_index`, status), `room_session_items` (frozen snapshot of the host's quiz questions or flashcards — members never touch the host's private material), `room_session_answers` (one per member per item, quiz answers graded server-side via `submit_room_session_answer`); RPCs `start_room_session` (any member shares their own quiz/deck), `set_room_session_item` (host moves everyone to the same item at the same time), `get_room_session_feedback` (correct key + explanation unlocked only after you answer — the key never ships with the question), `end_room_session`; `room_sessions` + `room_session_answers` are in the realtime publication for live sync
- **`20250921000011_gamification.sql`** — gamification (Task 13): `gamification` (xp, `current_streak`/`longest_streak`/`last_active_date`, `grace_used_date`), an append-only `xp_events` ledger (unique per user+kind+ref, so every award is idempotent — replays and re-completions never double-award), and `badges` + `user_badges`. XP: topic completion **+50**, room-session completion **+40** for every member who answered ≥1 item, room creation **+15**, quiz **+10 per correct answer** but **+20 when that question was missed on a previous attempt** (recovery beats first-try-easy, per spec). Streaks: one active day per date; a single missed day is forgiven at most once per 7 days (`grace_used_date`), any longer gap resets to 1, `longest_streak` never decreases. Badges: `first_module_complete`, `first_room_created`, `streak_7` — the four trusted RPCs (`toggle_topic_completion`, `submit_quiz_attempt`, `create_room`, `end_room_session`) now return `xp_awarded` + `new_badges` so the client can toast them
- **`20250921000012_lessons_exams.sql`** — lessons & exams attached to rooms (Task 15): `lessons` (jsonb `lesson_blocks` — shape-validated heading/paragraph/callout/list — plus `lesson_documents` attachments), `exams` + `exam_questions` (multiple-choice with option keys, short-answer; `answer_key` never readable by students), `exam_attempts`/`exam_answers` (one attempt per student, retakes replace). RPCs: `get_exam_questions` (safe take view, member-only, no answer key), `submit_exam_attempt` (SECURITY DEFINER server-side grading — MC exact key match, short answers case/whitespace-insensitive — plus weighted XP: +10 per correct, +10 bonus for questions previously missed, +15 completion), `get_exam_review` (my answers + correct answers, only with an attempt). `is_room_member`/`is_room_creator` RLS helpers; lessons/exams published for realtime classwork refresh; a documents + storage policy lets room members read exactly the documents attached to their room's lessons
- **`20250921000013_grading_analytics.sql`** — grading & analytics (Task 16): `exam_attempts.final_grade` / `final_feedback` / `graded_at` (the educator's finalized, human-decided grade), the `finalize_exam_grade(attempt, grade, feedback)` RPC (creator-only, grade clamped to the exam's max points), and `get_room_knowledge_gaps(room)` — aggregates `error_journal_entries` (quiz → document → class → room member) and wrong exam answers (exam → room) into coarse topic labels with struggle counts/rates. Returns aggregates only, never per-student rows, and requires the caller to belong to the room

## Tables

`profiles, subjects, documents, document_chunks, modules, topics, study_sessions, quiz_attempts, error_journal_entries, rooms, room_members, room_messages, gamification, badges, tutor_conversations, tutor_messages, flashcards, quizzes, quiz_questions, lessons, lesson_documents, exams, exam_questions, exam_attempts, exam_answers`

- `profiles` is 1:1 with `auth.users` and auto-created by the `on_auth_user_created` trigger, which also seeds a `gamification` row and reads `role` + `display_name` from signup metadata (`options.data` in `auth.signUp`). OAuth (Google) signups carry no metadata, so their profile is created with `role = NULL` and the user finalizes it at `/auth/role` via `finalize_role()`
- `document_chunks.embedding` is `vector(1024)` (pgvector, installed into the `extensions` schema) — sized for Qwen `text-embedding-v3`. If you switch embedding models, change the dimension here **before** inserting data
- `modules.status` uses the `module_status` enum (`locked | in_progress | complete`); `rooms.type` uses `room_type` (`peer | teacher`)

## RLS model

- RLS is **enabled on every table**. Default: users read/write only their own rows (`auth.uid()` scoping)
- `document_chunks`, `modules`, and `topics` inherit ownership from their parent (document → class → module chains)
- Room access: `rooms`, `room_members`, and `room_messages` are visible to room members via the `SECURITY DEFINER` helpers `is_room_member()` / `is_room_creator()` / `shares_room_with()` (definer functions keep the membership check from recursing into `room_members`' own RLS)
- `profiles.role` is permanently locked after signup by the `enforce_role_lock` trigger (spec section 4): a role can be written exactly once, and only together with `role_confirmed_at` — the client never writes the column directly, it calls the `finalize_role()` RPC
- Room membership: the invite code is the capability — `join_room_by_code` (SECURITY DEFINER) resolves exactly one room for code holders without exposing room enumeration; room members can see the room's full roster (member avatars)
- Gamification totals are server-computed only: `gamification`, `xp_events`, and `user_badges` have **select-only** RLS, and the internal helpers (`award_xp`, `award_xp_for`, `touch_streak`, `check_badges`) are **revoked from client roles** — only the trusted RPCs can award XP
- Exams: `exam_questions` is creator-writable only; students read questions exclusively through `get_exam_questions` (no `answer_key`), and grading happens in `submit_exam_attempt`. Attempts/answers are visible to the student and the exam's creator

## Edge functions

- **`process-document`** — RAG ingestion (Task 7): extract → chunk → embed → store, flips `status` to `ready`/`failed`
- **`rag-search`** — retrieval (Task 7): embeds the query, returns class-scoped top chunks
- **`tutor-chat`** — AI tutor (Task 8): resolves/creates the conversation, loads history, embeds the question, retrieves via `search_document_chunks`, prompts Qwen with a grounding system prompt (cite sources, admit when the context lacks the answer), persists both turns, returns reply + cited sources. Retrieval failures degrade to an ungrounded answer instead of breaking the chat
- **`generate-study-materials`** — flashcards & quizzes (Task 9): reads the document's stored chunks, prompts Qwen to extract key concepts as Q&A pairs (`kind: "flashcards"`, replaces the document's cards) or multiple-choice questions (`kind: "quiz"`, creates a new quiz each run so attempt history is preserved); parses/validates the JSON reply defensively and keeps the answer key server-side (quiz questions load without `correct_answer` while taking)
- **`generate-roadmap`** — roadmap (Task 10): builds a structure outline from the class's documents (titles + chunk sequence), prompts Qwen to split it into an ordered learning path (3–8 modules × 2–6 topics), and replaces the class's `modules`/`topics` rows; the first module starts `in_progress` so the student has a visible starting point
- **`suggest-exam-feedback`** — AI grading suggestion (Task 16): reads ONE attempt (questions, student answers, machine-graded correctness) through the educator's own RLS session and prompts Qwen for a suggested grade + feedback addressed to the student. **Nothing is persisted** — the suggestion is a draft the educator accepts, edits, or discards before `finalize_exam_grade` commits the human decision

All five use `DASHSCOPE_API_KEY` (`supabase secrets set DASHSCOPE_API_KEY=sk-...`) and share the Qwen API layer in `web/src/lib/rag/qwen.ts` (`embedTexts`, `chatCompletion`). The chat model defaults to `qwen-plus` (override with `QWEN_CHAT_MODEL`).

## Applying

**Option A — Supabase CLI**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B — Dashboard**

SQL Editor → paste the full contents of every migration file (in filename order) → Run.

## Validated

Every migration parses cleanly against the real Postgres parser (`libpg-query`, PG17 grammar). Statements in the init migration: 14 `CREATE TABLE`, 15 indexes, 3 enums, 6 functions, 3 triggers, 14 `ENABLE ROW LEVEL SECURITY`, 47 policies. Live execution against a real Postgres instance was not possible in this environment (no Docker/psql), so if `supabase db push` reports an error, check it against this file first.
