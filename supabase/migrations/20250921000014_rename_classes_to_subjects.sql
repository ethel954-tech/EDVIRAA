-- ============================================================================
-- Terminology rename (Task 25): classes -> subjects
--
-- The student's private container is now called a "Subject". This is purely a
-- rename — the shape, ownership and RLS semantics are unchanged:
--   * public.classes            -> public.subjects
--   * *.class_id columns        -> *.subject_id
--   * policies / indexes / functions that referenced them are recreated
--
-- The rooms table is intentionally untouched: its type enum already covers
-- Study Rooms ('peer') and Classes ('teacher') — only UI labels change.
--
-- Idempotent: safe to re-run. Uses to_regclass guards so a fresh DB that
-- already has subjects (and no classes) skips cleanly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rename columns BEFORE the table rename (FK constraints follow columns).
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.documents') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'documents'
                   and column_name = 'class_id') then
    alter table public.documents rename column class_id to subject_id;
  end if;
end $$;

do $$ begin
  if to_regclass('public.modules') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'modules'
                   and column_name = 'class_id') then
    alter table public.modules rename column class_id to subject_id;
  end if;
end $$;

do $$ begin
  if to_regclass('public.tutor_conversations') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tutor_conversations'
                   and column_name = 'class_id') then
    alter table public.tutor_conversations rename column class_id to subject_id;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Rename dependent indexes.
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.idx_documents_class') is not null then
    alter index public.idx_documents_class rename to idx_documents_subject;
  end if;
end $$;

do $$ begin
  if to_regclass('public.idx_modules_class') is not null then
    alter index public.idx_modules_class rename to idx_modules_subject;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Rename the table itself. Postgres renames owned constraints/indexes with
--    it (e.g. the unique(student_id, name) constraint keeps its auto-name,
--    which is fine); we only need to handle the named policies/indexes.
-- ----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.classes') is not null then
    alter table public.classes rename to subjects;
  end if;
end $$;

create index if not exists idx_subjects_student on public.subjects (student_id);

-- ----------------------------------------------------------------------------
-- 4. Recreate RLS policies under the new names.
--    (drop-if-exists on BOTH old and new names keeps this idempotent.)
-- ----------------------------------------------------------------------------
alter table public.subjects enable row level security;

drop policy if exists "classes_select_own" on public.subjects;
drop policy if exists "subjects_select_own" on public.subjects;
create policy "subjects_select_own" on public.subjects
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "classes_insert_own" on public.subjects;
drop policy if exists "subjects_insert_own" on public.subjects;
create policy "subjects_insert_own" on public.subjects
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "classes_update_own" on public.subjects;
drop policy if exists "subjects_update_own" on public.subjects;
create policy "subjects_update_own" on public.subjects
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "classes_delete_own" on public.subjects;
drop policy if exists "subjects_delete_own" on public.subjects;
create policy "subjects_delete_own" on public.subjects
  for delete to authenticated using (student_id = auth.uid());

-- Roadmap ownership policies (referenced public.classes inside subqueries).
drop policy if exists "modules_select_via_class" on public.modules;
create policy "modules_select_via_subject" on public.modules
  for select to authenticated
  using (exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.student_id = auth.uid()
  ));
drop policy if exists "modules_insert_via_class" on public.modules;
create policy "modules_insert_via_subject" on public.modules
  for insert to authenticated
  with check (exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.student_id = auth.uid()
  ));
drop policy if exists "modules_update_via_class" on public.modules;
create policy "modules_update_via_subject" on public.modules
  for update to authenticated
  using (exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.student_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.student_id = auth.uid()
  ));
drop policy if exists "modules_delete_via_class" on public.modules;
create policy "modules_delete_via_subject" on public.modules
  for delete to authenticated
  using (exists (
    select 1 from public.subjects s
    where s.id = subject_id and s.student_id = auth.uid()
  ));

-- Topics flow subject -> module -> topic.
drop policy if exists "topics_select_via_module" on public.topics;
create policy "topics_select_via_subject" on public.topics
  for select to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where m.id = module_id and s.student_id = auth.uid()
  ));
drop policy if exists "topics_insert_via_module" on public.topics;
create policy "topics_insert_via_subject" on public.topics
  for insert to authenticated
  with check (exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where m.id = module_id and s.student_id = auth.uid()
  ));
drop policy if exists "topics_update_via_module" on public.topics;
create policy "topics_update_via_subject" on public.topics
  for update to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where m.id = module_id and s.student_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where m.id = module_id and s.student_id = auth.uid()
  ));
drop policy if exists "topics_delete_via_module" on public.topics;
create policy "topics_delete_via_subject" on public.topics
  for delete to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where m.id = module_id and s.student_id = auth.uid()
  ));

-- ----------------------------------------------------------------------------
-- 5. Recreate SECURITY DEFINER functions whose bodies referenced
--    public.classes / class_id (create or replace keeps grants intact).
-- ----------------------------------------------------------------------------

-- RAG search: subject-scoped vector similarity (Task 7). Signature is
-- unchanged from 20250921000005_rag_search_function.sql — Postgres identifies
-- functions by argument TYPES, not names, so `create or replace` with the
-- renamed p_subject_id parameter updates the existing function in place
-- (no stale duplicate to drop).
drop function if exists public.search_document_chunks(extensions.vector(1024), uuid, int);
create or replace function public.search_document_chunks(
  p_query_embedding extensions.vector(1024),
  p_subject_id uuid,
  p_match_count int default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index int,
  content text,
  similarity float
)
language sql stable security definer
set search_path = public, extensions
as $$
  select
    dc.id as chunk_id,
    dc.document_id,
    d.title as document_title,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> p_query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.student_id = auth.uid()
    and d.subject_id = p_subject_id
    and d.status = 'ready'
    and dc.embedding is not null
  order by dc.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

revoke execute on function public.search_document_chunks(extensions.vector(1024), uuid, int) from anon;
revoke execute on function public.search_document_chunks(extensions.vector(1024), uuid, int) from public;

-- Roadmap topic toggle (Task 10 + Task 17 XP hook) — joins through subjects
-- now. Signature must match 20250921000011_gamification.sql.
create or replace function public.toggle_topic_completion(
  p_topic_id uuid,
  p_completed boolean
)
returns table (xp_awarded int, new_badges jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_total int;
  v_done int;
  v_xp int;
  v_badges jsonb;
begin
  if p_completed is null then
    raise exception 'p_completed is required';
  end if;

  select m.id into v_module_id
  from public.topics t
  join public.modules m on m.id = t.module_id
  join public.subjects s on s.id = m.subject_id
  where t.id = p_topic_id
    and s.student_id = auth.uid();

  if v_module_id is null then
    raise exception 'Topic not found';
  end if;

  update public.topics
  set completed_at = case when p_completed then now() else null end
  where id = p_topic_id;

  select
    count(*),
    count(*) filter (where completed_at is not null)
  into v_total, v_done
  from public.topics
  where module_id = v_module_id;

  update public.modules
  set status = case
    when v_total = 0 then status  -- empty module: nothing to derive from
    when v_done = v_total then 'complete'::public.module_status
    when v_done > 0 then 'in_progress'::public.module_status
    else 'locked'::public.module_status
  end
  where id = v_module_id;

  if p_completed then
    v_xp := public.award_xp('topic', p_topic_id::text, 50);
    select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
    into v_badges
    from public.check_badges(auth.uid()) b;
  end if;

  return query select v_xp, coalesce(v_badges, '[]'::jsonb);
end;
$$;

-- Badge evaluator (Task 17) referenced public.classes in the first-module
-- milestone; re-point it at public.subjects. Signature unchanged.
create or replace function public.check_badges(p_user uuid)
returns setof public.badges
language plpgsql security definer
set search_path = public
as $$
declare
  v_badge_id text;
begin
  -- First module complete (roadmap).
  if exists (
    select 1
    from public.modules m
    join public.subjects s on s.id = m.subject_id
    where s.student_id = p_user and m.status = 'complete'
  ) then
    insert into public.user_badges (user_id, badge_id)
    values (p_user, 'first_module_complete')
    on conflict (user_id, badge_id) do nothing
    returning badge_id into v_badge_id;
    if v_badge_id is not null then
      return query select b.* from public.badges b where b.id = v_badge_id;
    end if;
  end if;

  -- First room created.
  if exists (select 1 from public.rooms where created_by = p_user) then
    insert into public.user_badges (user_id, badge_id)
    values (p_user, 'first_room_created')
    on conflict (user_id, badge_id) do nothing
    returning badge_id into v_badge_id;
    if v_badge_id is not null then
      return query select b.* from public.badges b where b.id = v_badge_id;
    end if;
  end if;

  -- 7-day streak.
  if exists (
    select 1 from public.gamification
    where user_id = p_user and longest_streak >= 7
  ) then
    insert into public.user_badges (user_id, badge_id)
    values (p_user, 'streak_7')
    on conflict (user_id, badge_id) do nothing
    returning badge_id into v_badge_id;
    if v_badge_id is not null then
      return query select b.* from public.badges b where b.id = v_badge_id;
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Last-active subject per student (Task 26: subject switcher).
--    Each student can have at most one "current" subject; NULL means none
--    picked yet (the UI then falls back to the first subject).
-- ----------------------------------------------------------------------------
-- A parallel-effort variant of student_state may already exist with a
-- different shape (e.g. student_id instead of user_id) — the policies below
-- reference user_id, so rebuild the table when the shape doesn't match.
-- (Rows hold only a UI convenience pointer; nothing of value is lost.)
do $$
begin
  if to_regclass('public.student_state') is not null and (
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'student_state'
        and column_name = 'user_id'
    )
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'student_state'
        and column_name = 'active_subject_id'
    )
  ) then
    drop table public.student_state cascade;
  end if;
end
$$;

create table if not exists public.student_state (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  active_subject_id uuid references public.subjects (id) on delete set null,
  updated_at        timestamptz not null default now()
);

alter table public.student_state enable row level security;

drop policy if exists "student_state_select_own" on public.student_state;
create policy "student_state_select_own" on public.student_state
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "student_state_insert_own" on public.student_state;
create policy "student_state_insert_own" on public.student_state
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "student_state_update_own" on public.student_state;
create policy "student_state_update_own" on public.student_state
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Track last-active subject without touching a 14-migration-old schema:
-- ownership is enforced by the explicit user_id check (SECURITY DEFINER so
-- the upsert can't be blocked by the select-first upsert RLS gotcha).
create or replace function public.set_active_subject(p_subject_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- The subject must belong to the caller.
  if not exists (
    select 1 from public.subjects
    where id = p_subject_id and student_id = v_user
  ) then
    raise exception 'Subject not found';
  end if;

  insert into public.student_state (user_id, active_subject_id, updated_at)
  values (v_user, p_subject_id, now())
  on conflict (user_id) do update
    set active_subject_id = excluded.active_subject_id,
        updated_at = now();
end;
$$;

revoke execute on function public.set_active_subject(uuid) from anon;
revoke execute on function public.set_active_subject(uuid) from public;

-- ----------------------------------------------------------------------------
-- 7. Knowledge-gaps RPC referenced public.classes inside its body.
-- ----------------------------------------------------------------------------
create or replace function public.get_room_knowledge_gaps(p_room_id uuid)
returns table (
  topic text,
  struggles int,
  attempts int,
  source text
)
language sql
security definer
set search_path = public
as $$
  -- Guard: caller must belong to the room (educators are members/creators).
  with caller_ok as (
    select 1
    where public.is_room_member(p_room_id)
  ),
  quiz_gaps as (
    select
      left(regexp_replace(trim(j.question), '\s+', ' ', 'g'), 60) as topic,
      count(*)::int as struggles,
      count(*)::int as attempts,
      'quiz' as source
    from public.error_journal_entries j
    join public.quizzes qz on qz.id = j.quiz_id
    join public.documents d on d.id = qz.document_id
    join public.subjects s on s.id = d.subject_id
    join public.room_members rm on rm.user_id = s.student_id
    where rm.room_id = p_room_id
    group by 1
  ),
  exam_gaps as (
    select
      left(regexp_replace(trim(q.prompt), '\s+', ' ', 'g'), 60) as topic,
      count(*) filter (where not a.is_correct)::int as struggles,
      count(*)::int as attempts,
      'exam' as source
    from public.exam_answers a
    join public.exam_questions q on q.id = a.question_id
    join public.exams e on e.id = q.exam_id
    where e.room_id = p_room_id
    group by 1
  )
  select g.topic, g.struggles, g.attempts, g.source
  from caller_ok
  cross join (
    select topic, struggles, attempts, source from quiz_gaps
    union all
    select topic, struggles, attempts, source from exam_gaps
  ) g
  where g.attempts >= 1
  order by g.struggles desc, g.attempts asc
  limit 20;
$$;revoke execute on function public.get_room_knowledge_gaps(uuid) from anon;
revoke execute on function public.get_room_knowledge_gaps(uuid) from public;

