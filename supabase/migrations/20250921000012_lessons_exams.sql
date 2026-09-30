-- ============================================================================
-- Lessons & exams attached to rooms (Task 15 — Educator Dashboard)
--
-- Spec section 5: educator dashboard lists the educator's rooms; lessons and
-- exams are BUILT by the educator and ATTACHED to a room; students in that
-- room see assigned lessons/exams.
--
-- Design notes
--   * lessons.lesson_blocks (jsonb)  — ordered content blocks. Block shapes
--     are validated by a CHECK (heading | paragraph | callout | list) so the
--     builder UI and the student renderer can never drift apart.
--   * lesson_documents               — attached documents. Documents are
--     owned by their uploader (documents.student_id), so educators attach
--     documents they uploaded; RLS lets room members read exactly the
--     documents attached to lessons of rooms they belong to.
--   * exam_questions.answer_key      — NEVER readable by students. Students
--     read exam_questions through exam_questions_safe (a SECURITY INVOKER
--     view without the key); grading happens server-side in
--     submit_exam_attempt.
--   * exam_attempts / exam_answers   — one attempt per student per exam
--     (retakes replace the previous attempt), answers graded at submit.
--   * realtime publication           — lessons + exams for the
--     "new assignment appeared" toast/refresh in rooms.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Lessons
-- ----------------------------------------------------------------------------
create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 160),
  lesson_blocks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lesson_blocks) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_lessons_room on public.lessons (room_id, created_at desc);
create index if not exists idx_lessons_creator on public.lessons (created_by);

-- Ordered content blocks. One shape validator, used by every block type:
--   {"type":"heading","text":string,"level":1|2|3}
--   {"type":"paragraph","text":string}
--   {"type":"callout","text":string,"tone":"info"|"tip"|"warning"}
--   {"type":"list","items":[string,...]}
create or replace function public.is_valid_lesson_block(b jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  if jsonb_typeof(b) <> 'object' then
    return false;
  end if;
  if not (b ? 'type') or jsonb_typeof(b->'type') <> 'string' then
    return false;
  end if;
  case b->>'type'
    when 'heading' then
      return b ? 'text'
        and jsonb_typeof(b->'text') = 'string'
        and coalesce(jsonb_typeof(b->'level'), 'number') = 'number'
        and coalesce((b->>'level')::int, 1) between 1 and 3;
    when 'paragraph' then
      return b ? 'text' and jsonb_typeof(b->'text') = 'string';
    when 'callout' then
      return b ? 'text' and jsonb_typeof(b->'text') = 'string'
        and (b->>'tone') in ('info','tip','warning');
    when 'list' then
      return jsonb_typeof(b->'items') = 'array'
        and (select count(*) from jsonb_array_elements_text(b->'items') x)
            = (select count(*) from jsonb_array_elements_text(b->'items') x
               where length(x) between 1 and 500);
    else
      return false;
  end case;
end;
$$;

-- Length guard only — Postgres forbids subqueries in CHECK constraints, so
-- per-block validation lives in the validate_lesson_blocks trigger below.
alter table public.lessons drop constraint if exists lessons_blocks_max;
alter table public.lessons add constraint lessons_blocks_max
  check (jsonb_array_length(lesson_blocks) <= 100);

-- Attached documents (educator-owned; room members gain read access below).
create table if not exists public.lesson_documents (
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  position    int not null default 0,
  primary key (lesson_id, document_id)
);
create index if not exists idx_lesson_documents_document
  on public.lesson_documents (document_id);

-- ----------------------------------------------------------------------------
-- Exams + questions
-- ----------------------------------------------------------------------------
create table if not exists public.exams (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_exams_room on public.exams (room_id, created_at desc);
create index if not exists idx_exams_creator on public.exams (created_by);

create table if not exists public.exam_questions (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  kind        text not null check (kind in ('multiple_choice', 'short_answer')),
  prompt      text not null check (char_length(prompt) between 1 and 1000),
  options     jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 0 and 6),
  answer_key  text not null default '',
  points      int not null default 1 check (points between 1 and 100),
  order_index int not null default 0
);
create index if not exists idx_exam_questions_exam
  on public.exam_questions (exam_id, order_index);

-- ----------------------------------------------------------------------------
-- Attempts (students) — graded server-side; answers store what was given.
-- One attempt per student per exam: retaking replaces the previous attempt.
-- ----------------------------------------------------------------------------
create table if not exists public.exam_attempts (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  score       int not null default 0,
  total       int not null default 0,
  submitted_at timestamptz not null default now(),
  unique (exam_id, student_id)
);
create index if not exists idx_exam_attempts_student
  on public.exam_attempts (student_id, submitted_at desc);

create table if not exists public.exam_answers (
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  question_id uuid not null references public.exam_questions (id) on delete cascade,
  answer     text not null default '',
  is_correct boolean not null default false,
  primary key (attempt_id, question_id)
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.lessons        enable row level security;
alter table public.lesson_documents enable row level security;
alter table public.exams          enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts  enable row level security;
alter table public.exam_answers   enable row level security;

-- Membership/ownership predicates (single source of truth for the policies).
create or replace function public.is_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    where r.id = target_room
      and (r.created_by = auth.uid()
           or exists (
             select 1 from public.room_members m
             where m.room_id = r.id and m.user_id = auth.uid()
           ))
  );
$$;

create or replace function public.is_room_creator(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms r
    where r.id = target_room and r.created_by = auth.uid()
  );
$$;

-- lessons: room members read; room creators write.
drop policy if exists "lessons_select_members" on public.lessons;
create policy "lessons_select_members" on public.lessons
  for select using (public.is_room_member(room_id));
drop policy if exists "lessons_insert_creator" on public.lessons;
create policy "lessons_insert_creator" on public.lessons
  for insert to authenticated
  with check (public.is_room_creator(room_id) and created_by = auth.uid());
drop policy if exists "lessons_update_creator" on public.lessons;
create policy "lessons_update_creator" on public.lessons
  for update using (created_by = auth.uid() and public.is_room_creator(room_id))
  with check (created_by = auth.uid() and public.is_room_creator(room_id));
drop policy if exists "lessons_delete_creator" on public.lessons;
create policy "lessons_delete_creator" on public.lessons
  for delete using (created_by = auth.uid());

-- lesson_documents: read follows the parent lesson's visibility; writes only
-- for the lesson's creator. (The document itself stays owner-private; the
-- lesson_documents row merely links it.)
drop policy if exists "lesson_documents_select_members" on public.lesson_documents;
create policy "lesson_documents_select_members" on public.lesson_documents
  for select using (
    exists (
      select 1 from public.lessons l
      where l.id = lesson_id and public.is_room_member(l.room_id)
    )
  );
drop policy if exists "lesson_documents_write_creator" on public.lesson_documents;
create policy "lesson_documents_write_creator" on public.lesson_documents
  for insert to authenticated
  with check (
    exists (
      select 1 from public.lessons l
      where l.id = lesson_id and l.created_by = auth.uid()
    )
  );
drop policy if exists "lesson_documents_delete_creator" on public.lesson_documents;
create policy "lesson_documents_delete_creator" on public.lesson_documents
  for delete using (
    exists (
      select 1 from public.lessons l
      where l.id = lesson_id and l.created_by = auth.uid()
    )
  );

-- exams: same shape as lessons.
drop policy if exists "exams_select_members" on public.exams;
create policy "exams_select_members" on public.exams
  for select using (public.is_room_member(room_id));
drop policy if exists "exams_insert_creator" on public.exams;
create policy "exams_insert_creator" on public.exams
  for insert to authenticated
  with check (public.is_room_creator(room_id) and created_by = auth.uid());
drop policy if exists "exams_update_creator" on public.exams;
create policy "exams_update_creator" on public.exams
  for update using (created_by = auth.uid() and public.is_room_creator(room_id))
  with check (created_by = auth.uid() and public.is_room_creator(room_id));
drop policy if exists "exams_delete_creator" on public.exams;
create policy "exams_delete_creator" on public.exams
  for delete using (created_by = auth.uid());

-- exam_questions: educators manage; members read through the SAFE view below.
-- Direct table access for members would expose answer_key, so only creators
-- get a table-level policy.
drop policy if exists "exam_questions_creator_all" on public.exam_questions;
create policy "exam_questions_creator_all" on public.exam_questions
  for all to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  );

-- exam_attempts: students see their own; educators see attempts in their
-- exams (grading overview). Inserts happen exclusively via the RPC.
drop policy if exists "exam_attempts_select_own" on public.exam_attempts;
create policy "exam_attempts_select_own" on public.exam_attempts
  for select using (student_id = auth.uid());
drop policy if exists "exam_attempts_select_examiner" on public.exam_attempts;
create policy "exam_attempts_select_examiner" on public.exam_attempts
  for select using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  );

drop policy if exists "exam_answers_select_own" on public.exam_answers;
create policy "exam_answers_select_own" on public.exam_answers
  for select using (
    exists (
      select 1 from public.exam_attempts a
      where a.id = attempt_id and a.student_id = auth.uid()
    )
  );
drop policy if exists "exam_answers_select_examiner" on public.exam_answers;
create policy "exam_answers_select_examiner" on public.exam_answers
  for select using (
    exists (
      select 1 from public.exam_attempts a
      join public.exams e on e.id = a.exam_id
      where a.id = attempt_id and e.created_by = auth.uid()
    )
  );

-- ============================================================================
-- Student-safe question access: RPCs instead of a view — a parameterized
-- function can verify room membership PER EXAM (a plain view cannot), and
-- answer_key never ships to the client.
--   get_exam_questions: the take view (safe columns, member-only).
--   get_exam_review:    post-attempt review (my answers + correct answers);
--                       requires an attempt by the caller.
-- ============================================================================
create or replace function public.get_exam_questions(p_exam_id uuid)
returns table (
  id uuid, kind text, prompt text, options jsonb, points int, order_index int
)
language sql
security definer
set search_path = public
as $$
  select q.id, q.kind, q.prompt, q.options, q.points, q.order_index
  from public.exam_questions q
  where q.exam_id = p_exam_id
    and exists (
      select 1 from public.exams e
      where e.id = p_exam_id and public.is_room_member(e.room_id)
    )
  order by q.order_index;
$$;

revoke execute on function public.get_exam_questions(uuid) from anon;
revoke execute on function public.get_exam_questions(uuid) from public;

create or replace function public.get_exam_review(p_exam_id uuid)
returns table (
  question_id uuid, kind text, prompt text, options jsonb, points int,
  my_answer text, is_correct boolean, correct_answer text
)
language sql
security definer
set search_path = public
as $$
  select q.id, q.kind, q.prompt, q.options, q.points,
         a.answer, a.is_correct, q.answer_key
  from public.exam_questions q
  join public.exam_attempts att
    on att.exam_id = q.exam_id and att.student_id = auth.uid()
  left join public.exam_answers a
    on a.attempt_id = att.id and a.question_id = q.id
  where q.exam_id = p_exam_id
    and exists (
      select 1 from public.exams e
      where e.id = p_exam_id
        and public.is_room_member(e.room_id)
    )
  order by q.order_index;
$$;

revoke execute on function public.get_exam_review(uuid) from anon;
revoke execute on function public.get_exam_review(uuid) from public;

-- ============================================================================
-- submit_exam_attempt: grades server-side (answer_key never leaves the DB),
-- one attempt per student (retake replaces), records answers, and awards XP:
--   10 XP per correct answer, 20 XP for a question that sits in the
--   student's error journal (correct-after-previously-wrong — same weighting
--   as Task 9), capped by the ledger's idempotency key per exam+question.
-- Returns score + any newly earned badges for the toast.
-- ============================================================================
create or replace function public.submit_exam_attempt(
  p_exam_id uuid,
  p_answers jsonb  -- {"<question_id>": "<answer text>", ...}
)
returns table (attempt_id uuid, score int, total int, xp_awarded int, new_badges jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_total int;
  v_score int := 0;
  v_xp int := 0;
  v_badges jsonb;
  v_q record;
  v_given text;
  v_correct boolean;
  v_attempt uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Answers must be an object keyed by question id';
  end if;

  -- Member of the room the exam is attached to?
  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and public.is_room_member(e.room_id)
  ) then
    raise exception 'Exam not found';
  end if;

  -- Question count (score is summed per-question below; `total` stays the
  -- question count, matching quiz_attempts' semantics).
  select count(*) into v_total
  from public.exam_questions where exam_id = p_exam_id;
  v_total := coalesce(v_total, 0);

  delete from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_user;

  insert into public.exam_attempts (exam_id, student_id, score, total)
  values (p_exam_id, v_user, 0, v_total)
  returning id into v_attempt;

  for v_q in
    select id, kind, answer_key, options, points
    from public.exam_questions
    where exam_id = p_exam_id
  loop
    v_given := coalesce(p_answers ->> v_q.id::text, '');
    v_correct := false;
    if v_q.kind = 'multiple_choice' then
      v_correct := v_given = v_q.answer_key;
    else
      -- Short answers: case/punctuation-insensitive compare.
      v_correct := lower(regexp_replace(trim(v_given), '\s+', ' ', 'g'))
                 = lower(regexp_replace(trim(v_q.answer_key), '\s+', ' ', 'g'))
                   and v_q.answer_key <> '';
    end if;

    insert into public.exam_answers (attempt_id, question_id, answer, is_correct)
    values (v_attempt, v_q.id, left(v_given, 2000), v_correct);

    if v_correct then
      v_score := v_score + v_q.points;
      v_xp := v_xp + coalesce(public.award_xp_for(
        v_user,
        'exam_question',
        p_exam_id::text || ':' || v_q.id::text,
        10
      ), 0);
      -- Recovered question: previously missed in the error journal -> double.
      if exists (
        select 1 from public.error_journal_entries j
        where j.user_id = v_user and j.question = v_q.prompt
      ) then
        v_xp := v_xp + coalesce(public.award_xp_for(
          v_user,
          'exam_recovered',
          p_exam_id::text || ':' || v_q.id::text,
          10
        ), 0);
      end if;
    end if;
  end loop;

  update public.exam_attempts
  set score = v_score
  where id = v_attempt;

  v_xp := v_xp + coalesce(public.award_xp_for(
    v_user, 'exam_complete', p_exam_id::text, 15
  ), 0);

  select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
  into v_badges
  from public.check_badges(v_user) b;

  return query select v_attempt, v_score, v_total, v_xp, coalesce(v_badges, '[]'::jsonb);
end;
$$;

revoke execute on function public.submit_exam_attempt(uuid, jsonb) from anon;
revoke execute on function public.submit_exam_attempt(uuid, jsonb) from public;

-- ============================================================================
-- Realtime: new assignments appear live in rooms.
-- ============================================================================
-- Exception-wrapped like migrations 09/10: re-adding an already-published
-- table throws duplicate_object on re-runs.
do $$ begin
  alter publication supabase_realtime add table public.lessons;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.exams;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ============================================================================
-- Attached documents: room members need to READ the attached documents.
-- documents are owner-private (documents.student_id); these two policies add
-- exactly one more visibility path — documents attached to a lesson of a room
-- you belong to — without opening anything else.
-- ============================================================================
drop policy if exists "documents_select_lesson_members" on public.documents;
create policy "documents_select_lesson_members" on public.documents
  for select using (
    exists (
      select 1
      from public.lesson_documents ld
      join public.lessons l on l.id = ld.lesson_id
      where ld.document_id = documents.id
        and public.is_room_member(l.room_id)
    )
  );

drop policy if exists "documents_storage_select_lesson_members"
  on storage.objects;
create policy "documents_storage_select_lesson_members" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and exists (
      select 1
      from public.documents d
      join public.lesson_documents ld on ld.document_id = d.id
      join public.lessons l on l.id = ld.lesson_id
      where name = d.storage_path  -- object name is exactly "{user}/{doc}.pdf"
        and public.is_room_member(l.room_id)
    )
  );

-- ============================================================================
-- housekeeping: keep updated_at fresh.
-- ============================================================================
create or replace function public.touch_lesson()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lessons_touch_updated_at on public.lessons;
create trigger lessons_touch_updated_at
  before update on public.lessons
  for each row execute function public.touch_lesson();

drop trigger if exists exams_touch_updated_at on public.exams;
create trigger exams_touch_updated_at
  before update on public.exams
  for each row execute function public.touch_lesson();

-- ============================================================================
-- Block validation trigger: runs is_valid_lesson_block over every element on
-- INSERT/UPDATE (a CHECK cannot contain a subquery, so this lives here).
-- ============================================================================
create or replace function public.validate_lesson_blocks()
returns trigger
language plpgsql
as $$
begin
  for i in 0 .. jsonb_array_length(new.lesson_blocks) - 1 loop
    if not public.is_valid_lesson_block(new.lesson_blocks -> i) then
      raise exception
        'lesson_blocks[%] is not a valid block (heading|paragraph|callout|list)', i
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists lessons_validate_blocks on public.lessons;
create trigger lessons_validate_blocks
  before insert or update of lesson_blocks on public.lessons
  for each row
  when (jsonb_array_length(new.lesson_blocks) > 0)
  execute function public.validate_lesson_blocks();
