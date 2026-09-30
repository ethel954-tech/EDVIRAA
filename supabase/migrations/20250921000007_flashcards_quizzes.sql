-- ============================================================================
-- Flashcards & quizzes generated from documents (Task 9)
--
-- Generation (edge function `generate-study-materials`) turns a document's
-- stored RAG chunks into:
--   * flashcards  — key-concept Q&A pairs the student studies directly
--   * quizzes     — multiple-choice questions with an answer key + explanation
--
-- quiz_questions.correct_answer holds the letter ('A'..'D'); grading happens
-- server-side in submit_quiz_attempt() — the client never sees the key
-- (protects quiz integrity and gives one grading source of truth).
--
-- Schema adjustments:
--   * quiz_attempts.topic_id / error_journal_entries.topic_id become
--     nullable (document-generated material has no roadmap topic) and their
--     FKs switch to ON DELETE SET NULL so removing a topic keeps study
--     history.
--   * quiz_attempts gains quiz_id + raw_score + total_questions; a percent
--     stays in the original score column.
--   * error_journal_entries gains quiz_id + quiz_question_id so wrong
--     answers link back to the exact question.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Relax topic linkage (document-generated attempts have no topic)
-- ----------------------------------------------------------------------------
alter table public.quiz_attempts alter column topic_id drop not null;
alter table public.quiz_attempts drop constraint if exists quiz_attempts_topic_id_fkey;
alter table public.quiz_attempts
  add constraint quiz_attempts_topic_id_fkey
  foreign key (topic_id) references public.topics (id) on delete set null;

alter table public.error_journal_entries alter column topic_id drop not null;
alter table public.error_journal_entries drop constraint if exists error_journal_entries_topic_id_fkey;
alter table public.error_journal_entries
  add constraint error_journal_entries_topic_id_fkey
  foreign key (topic_id) references public.topics (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Flashcards: key concepts as Q&A pairs, per document
-- ----------------------------------------------------------------------------
create table if not exists public.flashcards (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  question    text not null,
  answer      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_flashcards_document
  on public.flashcards (document_id, created_at);
create index if not exists idx_flashcards_student
  on public.flashcards (student_id);

-- ----------------------------------------------------------------------------
-- Quizzes + questions
-- ----------------------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  title       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_quizzes_document on public.quizzes (document_id, created_at desc);
create index if not exists idx_quizzes_student on public.quizzes (student_id);

create table if not exists public.quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes (id) on delete cascade,
  question       text not null,
  options        jsonb not null default '[]'::jsonb,
  correct_answer text not null check (correct_answer in ('A', 'B', 'C', 'D')),
  explanation    text,
  order_index    int not null default 0
);

create index if not exists idx_quiz_questions_quiz
  on public.quiz_questions (quiz_id, order_index);

-- ----------------------------------------------------------------------------
-- Attempt + journal linkage to generated quizzes
-- ----------------------------------------------------------------------------
alter table public.quiz_attempts
  add column if not exists quiz_id uuid references public.quizzes (id) on delete set null,
  add column if not exists raw_score int check (raw_score >= 0),
  add column if not exists total_questions int check (total_questions >= 0);

create index if not exists idx_quiz_attempts_quiz
  on public.quiz_attempts (quiz_id, created_at desc);

alter table public.error_journal_entries
  add column if not exists quiz_id uuid references public.quizzes (id) on delete set null,
  add column if not exists quiz_question_id uuid references public.quiz_questions (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Server-side grading: scores the submitted answers, records the attempt,
-- and logs every miss into error_journal_entries — atomically.
-- SECURITY DEFINER so the journal insert and question reads happen in one
-- transaction without exposing quiz_questions' answer key through RLS reads;
-- ownership is enforced by the explicit student_id check below.
-- ----------------------------------------------------------------------------
-- Migration 11 later replaces this function with a weighted-XP version
-- (extended return row). Drop first so re-runs after 11 don't fail with
-- 42P13 (cannot change return type of existing function).
drop function if exists public.submit_quiz_attempt(uuid, jsonb);

create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
  p_answers jsonb
)
returns table (attempt_id uuid, score int, total int)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_total int;
  v_correct int := 0;
  v_mistakes jsonb := '[]'::jsonb;
  v_given text;
  v_attempt_id uuid;
  q record;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'p_answers must be a JSON object mapping question id -> answer letter';
  end if;

  -- Ownership: only the quiz's student can attempt it.
  if not exists (
    select 1 from public.quizzes
    where id = p_quiz_id and student_id = v_user
  ) then
    raise exception 'Quiz not found';
  end if;

  select count(*) into v_total
  from public.quiz_questions
  where quiz_id = p_quiz_id;

  if v_total = 0 then
    raise exception 'Quiz has no questions';
  end if;

  for q in
    select qq.id, qq.question, qq.correct_answer, qq.explanation
    from public.quiz_questions qq
    where qq.quiz_id = p_quiz_id
  loop
    v_given := nullif(trim(coalesce(p_answers ->> q.id::text, '')), '');

    if v_given is not null and upper(v_given) = upper(q.correct_answer) then
      v_correct := v_correct + 1;
    else
      -- Spec: incorrect answers are logged to the error journal.
      insert into public.error_journal_entries
        (user_id, topic_id, question, correct_answer, user_answer, quiz_id, quiz_question_id)
      values
        (v_user, null, q.question,
         q.correct_answer || coalesce(' — ' || q.explanation, ''),
         coalesce(v_given, '(no answer)'),
         p_quiz_id, q.id);

      v_mistakes := v_mistakes || jsonb_build_object(
        'questionId', q.id,
        'given', v_given,
        'correct', q.correct_answer
      );
    end if;
  end loop;

  insert into public.quiz_attempts
    (user_id, topic_id, quiz_id, score, raw_score, total_questions, mistakes)
  values
    (v_user, null, p_quiz_id,
     round(v_correct * 100.0 / v_total)::int,
     v_correct, v_total, v_mistakes)
  returning id into v_attempt_id;

  return query select v_attempt_id, v_correct, v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.flashcards     enable row level security;
alter table public.quizzes        enable row level security;
alter table public.quiz_questions enable row level security;

drop policy if exists "flashcards_select_own" on public.flashcards;
create policy "flashcards_select_own" on public.flashcards
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "flashcards_insert_own" on public.flashcards;
create policy "flashcards_insert_own" on public.flashcards
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "flashcards_delete_own" on public.flashcards;
create policy "flashcards_delete_own" on public.flashcards
  for delete to authenticated using (student_id = auth.uid());

drop policy if exists "quizzes_select_own" on public.quizzes;
create policy "quizzes_select_own" on public.quizzes
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "quizzes_insert_own" on public.quizzes;
create policy "quizzes_insert_own" on public.quizzes
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "quizzes_delete_own" on public.quizzes;
create policy "quizzes_delete_own" on public.quizzes
  for delete to authenticated using (student_id = auth.uid());

-- Questions ride the parent quiz's ownership (answer key is readable only by
-- the owner — other students can't even see the quiz).
drop policy if exists "quiz_questions_select_via_quiz" on public.quiz_questions;
create policy "quiz_questions_select_via_quiz" on public.quiz_questions
  for select to authenticated
  using (exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and q.student_id = auth.uid()
  ));

drop policy if exists "quiz_questions_insert_via_quiz" on public.quiz_questions;
create policy "quiz_questions_insert_via_quiz" on public.quiz_questions
  for insert to authenticated
  with check (exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and q.student_id = auth.uid()
  ));

-- Attempts: NO update policy on purpose — grading is server-side only
-- (submit_quiz_attempt), so scores can't be tampered with from the client.
-- Init already provides select/insert/delete policies scoped to user_id.
