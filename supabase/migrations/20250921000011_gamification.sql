-- ============================================================================
-- Gamification (Task 13)
--
-- XP, streaks and badges — all computed server-side so clients can't mint XP:
--   * gamification — one row per user: xp, current/longest streak,
--     last_active_date, grace_used_date (the once-per-week missed-day pardon)
--   * xp_events    — append-only ledger; unique (user, kind, ref) makes every
--                    award idempotent (re-completing a topic or re-taking a
--                    quiz can never double-award)
--   * badges / user_badges — milestone catalog + earned rows
--
-- XP rules:
--   * Topic completion          +50 XP
--   * Room session completion   +40 XP for every member who answered at
--                               least one shared item
--   * Room creation             +15 XP
--   * Quiz performance          +10 XP per correct answer, but +20 XP when
--                               that question was missed on a PREVIOUS
--                               attempt (it lives in error_journal_entries) —
--                               recovery is worth more than first-try-easy.
-- Streak: any awarded activity touches the streak. Missing exactly one day
-- is forgiven at most once per 7 days (grace_used_date); otherwise the
-- streak resets to 1. longest_streak never decreases.
--
-- Badges (toast surfaced by the client when its RPC returns new_badges):
--   first_module_complete, first_room_created, streak_7
--
-- Internal helpers (award_xp, award_xp_for, touch_streak, check_badges) are
-- REVOKED from client roles — only the four trusted SECURITY DEFINER RPCs
-- call them, so users can never award themselves XP directly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- gamification: 20250921000000_init_schema.sql already creates this table
-- (user_id, xp, level, current_streak, longest_streak, last_active_date) and
-- its signup trigger seeds it. This migration EXTENDS that shape: add the
-- once-per-week grace column and the updated_at maintenance timestamp when
-- missing. create-table-if-not-exists alone would silently leave a fresh DB
-- with the old shape and the RPCs below would fail at runtime.
-- ----------------------------------------------------------------------------
create table if not exists public.gamification (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  xp               int not null default 0 check (xp >= 0),
  level            int not null default 1 check (level >= 1),
  current_streak   int not null default 0 check (current_streak >= 0),
  longest_streak   int not null default 0 check (longest_streak >= 0),
  last_active_date date,
  grace_used_date  date,  -- the last day a missed-day pardon was spent
  updated_at       timestamptz not null default now()
);

alter table public.gamification add column if not exists grace_used_date date;
alter table public.gamification add column if not exists updated_at
  timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- badges: 20250921000000_init_schema.sql creates a DIFFERENT per-user table
-- with the same name (id uuid, user_id, badge_key). Task 13 replaced that
-- design with a catalog (fixed milestone ids) + user_badges join. On a DB
-- where 00 already ran, rebuild the table: the legacy rows were never read
-- by any client code, so dropping them is safe (fresh DBs skip this).
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'badges'
      and column_name = 'badge_key'
  ) then
    drop table public.badges cascade;  -- legacy shape (uuid id, badge_key)
  end if;
end
$$;

create table if not exists public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('topic', 'quiz', 'session', 'room',
                                            'exam_question', 'exam_recovered', 'exam_complete')),
  ref_key    text not null,
  amount     int not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_key)
);

create index if not exists idx_xp_events_user
  on public.xp_events (user_id, created_at desc);

-- Guard for drift on xp_events.kind: exam XP kinds (migration 12) must be
-- accepted. to_regclass() is NULL-safe when the table doesn't exist yet —
-- fresh DBs take the widened inline CHECK above instead.
do $$
begin
  if to_regclass('public.xp_events') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = to_regclass('public.xp_events')
         and conname = 'xp_events_kind_check'
         and pg_get_constraintdef(oid) like '%exam_question%'
     ) then
    alter table public.xp_events drop constraint if exists xp_events_kind_check;
    alter table public.xp_events add constraint xp_events_kind_check
      check (kind in ('topic', 'quiz', 'session', 'room',
                      'exam_question', 'exam_recovered', 'exam_complete'));
  end if;
end
$$;

create table if not exists public.badges (
  id          text primary key,
  name        text not null,
  description text not null,
  icon        text not null default 'award'
);

create table if not exists public.user_badges (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  badge_id  text not null references public.badges (id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

insert into public.badges (id, name, description, icon) values
  ('first_module_complete', 'Module Master',     'Completed your first roadmap module', 'trophy'),
  ('first_room_created',    'Community Builder', 'Created your first study room',       'users'),
  ('streak_7',              'On Fire',           'Studied 7 days in a row',             'flame')
on conflict (id) do nothing;

-- Backfill rows for users created before this migration (handle_new_user in
-- 20250921000009 already seeds new signups).
insert into public.gamification (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- ----------------------------------------------------------------------------
-- RLS: reads for the owner; ALL writes happen through the definer RPCs, so
-- there are no insert/update/delete policies on any of these tables.
-- ----------------------------------------------------------------------------
alter table public.gamification enable row level security;
alter table public.xp_events    enable row level security;
alter table public.badges       enable row level security;
alter table public.user_badges  enable row level security;

drop policy if exists "gamification_select_own" on public.gamification;
create policy "gamification_select_own" on public.gamification
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "xp_events_select_own" on public.xp_events;
create policy "xp_events_select_own" on public.xp_events
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "badges_select_all" on public.badges;
create policy "badges_select_all" on public.badges
  for select to authenticated using (true);

drop policy if exists "user_badges_select_own" on public.user_badges;
create policy "user_badges_select_own" on public.user_badges
  for select to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- touch_streak: one active day per date; the once-per-week grace day forgives
-- a single missed day (last grace spent more than 7 days ago). Any longer
-- gap resets the streak to 1. longest_streak never decreases.
-- ----------------------------------------------------------------------------
create or replace function public.touch_streak(
  p_user uuid,
  p_today date default current_date
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_last date;
  v_streak int;
  v_grace date;
  v_skip_days int;
begin
  insert into public.gamification (user_id) values (p_user)
  on conflict (user_id) do nothing;

  select last_active_date, current_streak, grace_used_date
  into v_last, v_streak, v_grace
  from public.gamification
  where user_id = p_user
  for update;

  if v_last = p_today then
    return;  -- already counted today
  end if;

  v_skip_days := coalesce(p_today - v_last, 0) - 1;  -- days missed since last

  if v_last is null or v_skip_days = 0 then
    v_streak := v_streak + 1;
  elsif v_skip_days = 1 and (v_grace is null or v_grace < p_today - 7) then
    -- Missed exactly one day and the weekly grace is available: keep the streak.
    v_streak := v_streak + 1;
    update public.gamification set grace_used_date = p_today where user_id = p_user;
  else
    v_streak := 1;  -- gap too long (or grace already spent this week): restart
  end if;

  update public.gamification
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_streak),
      last_active_date = p_today,
      updated_at = now()
  where user_id = p_user;
end;
$$;

-- ----------------------------------------------------------------------------
-- award_xp_for: idempotent XP grant (the ledger's unique key dedupes), plus a
-- streak touch — every XP-worthy action counts as being active that day.
-- Returns the amount awarded, or null when it was a duplicate.
-- ----------------------------------------------------------------------------
create or replace function public.award_xp_for(
  p_user uuid,
  p_kind text,
  p_ref_key text,
  p_amount int
)
returns int
language plpgsql security definer
set search_path = public
as $$
begin
  if p_user is null or p_amount is null or p_amount <= 0 then
    return null;
  end if;

  insert into public.xp_events (user_id, kind, ref_key, amount)
  values (p_user, p_kind, p_ref_key, p_amount)
  on conflict (user_id, kind, ref_key) do nothing;

  if not found then
    return null;  -- already awarded for this reference
  end if;

  perform public.touch_streak(p_user);

  update public.gamification
  set xp = xp + p_amount, updated_at = now()
  where user_id = p_user;

  return p_amount;
end;
$$;

-- Caller-scoped convenience used inside the trusted RPCs.
create or replace function public.award_xp(
  p_kind text,
  p_ref_key text,
  p_amount int
)
returns int
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  return public.award_xp_for(auth.uid(), p_kind, p_ref_key, p_amount);
end;
$$;

-- ----------------------------------------------------------------------------
-- check_badges: evaluates every milestone and inserts anything newly earned.
-- Returns the full badge rows inserted THIS call (empty set = nothing new) so
-- the calling RPC can surface them to the client for a toast.
-- ----------------------------------------------------------------------------
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
    join public.classes c on c.id = m.class_id
    where c.student_id = p_user and m.status = 'complete'
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

-- The helpers are internal — only the trusted RPCs below may call them.
do $$ begin
  revoke execute on function public.award_xp(text, text, int) from public;
  revoke execute on function public.award_xp(text, text, int) from anon;
  revoke execute on function public.award_xp(text, text, int) from authenticated;
exception when others then null; end $$;

do $$ begin
  revoke execute on function public.award_xp_for(uuid, text, text, int) from public;
  revoke execute on function public.award_xp_for(uuid, text, text, int) from anon;
  revoke execute on function public.award_xp_for(uuid, text, text, int) from authenticated;
exception when others then null; end $$;

do $$ begin
  revoke execute on function public.touch_streak(uuid, date) from public;
  revoke execute on function public.touch_streak(uuid, date) from anon;
  revoke execute on function public.touch_streak(uuid, date) from authenticated;
exception when others then null; end $$;

do $$ begin
  revoke execute on function public.check_badges(uuid) from public;
  revoke execute on function public.check_badges(uuid) from anon;
  revoke execute on function public.check_badges(uuid) from authenticated;
exception when others then null; end $$;

-- ============================================================================
-- Hook 1/4 — Topic completion (Task 10's toggle_topic_completion): +50 XP on
-- completion (deduped per topic), badges re-evaluated, results returned for
-- the toast. Return type changed -> drop, then recreate.
-- ============================================================================
drop function if exists public.toggle_topic_completion(uuid, boolean);

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
  join public.classes c on c.id = m.class_id
  where t.id = p_topic_id
    and c.student_id = auth.uid();

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

-- ============================================================================
-- Hook 2/4 — Quiz performance (Task 9's submit_quiz_attempt): weighted XP.
--   first-try-easy correct      -> 10 XP
--   correct-after-previous-wrong -> 20 XP  (question sits in the student's
--                                  error_journal_entries from an earlier
--                                  attempt)
-- Recovery is deliberately worth double: getting it right AFTER struggling
-- counts for more than an easy first-try hit.
-- ============================================================================
drop function if exists public.submit_quiz_attempt(uuid, jsonb);

create or replace function public.submit_quiz_attempt(
  p_quiz_id uuid,
  p_answers jsonb
)
returns table (attempt_id uuid, score int, total int, xp_awarded int, new_badges jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_total int;
  v_correct int := 0;
  v_recovered int := 0;
  v_xp int := 0;
  v_was_wrong boolean;
  v_mistakes jsonb := '[]'::jsonb;
  v_given text;
  v_attempt_id uuid;
  v_badges jsonb;
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

      -- Recovery weighting: was this question missed on a previous attempt?
      -- (Journal rows for THIS attempt's misses are inserted below, after the
      -- correctness branch, so a miss can never pay for itself.)
      select exists (
        select 1 from public.error_journal_entries e
        where e.user_id = v_user and e.quiz_question_id = q.id
      ) into v_was_wrong;
      if v_was_wrong then
        v_recovered := v_recovered + 1;
        v_xp := v_xp + 20;
      else
        v_xp := v_xp + 10;
      end if;
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

  -- XP: this attempt is the ledger reference, so retaking can't double-award.
  if v_xp > 0 then
    v_xp := public.award_xp('quiz', v_attempt_id::text, v_xp);
  else
    v_xp := null;
  end if;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
  into v_badges
  from public.check_badges(v_user) b;

  return query select v_attempt_id, v_correct, v_total, v_xp, coalesce(v_badges, '[]'::jsonb);
end;
$$;

-- ============================================================================
-- Hook 3/4 — Room creation (Task 11's create_room): +15 XP + the
-- first_room_created badge check.
-- ============================================================================
drop function if exists public.create_room(text);

create or replace function public.create_room(p_name text)
returns table (room_id uuid, xp_awarded int, new_badges jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_room_id uuid;
  v_code text;
  v_xp int;
  v_badges jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  p_name := nullif(trim(coalesce(p_name, '')), '');
  if p_name is null then
    raise exception 'Room name is required';
  end if;
  if length(p_name) > 80 then
    raise exception 'Room name is too long (max 80 characters)';
  end if;

  select role into v_role from public.profiles where id = v_user;
  if v_role is null then
    raise exception 'Pick your role before creating a room';
  end if;

  v_code := public.generate_invite_code();

  -- Spec: type is set from the creator's role (student -> 'peer',
  -- educator -> 'teacher'). The enum values differ from role names, so map
  -- explicitly instead of casting.
  insert into public.rooms (created_by, creator_role, name, type, invite_code)
  values (
    v_user,
    v_role,
    p_name,
    case when v_role = 'educator' then 'teacher'::public.room_type else 'peer'::public.room_type end,
    v_code
  )
  returning id into v_room_id;

  v_xp := public.award_xp('room', v_room_id::text, 15);
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
  into v_badges
  from public.check_badges(v_user) b;

  return query select v_room_id, v_xp, coalesce(v_badges, '[]'::jsonb);
end;
$$;

-- ============================================================================
-- Hook 4/4 — Room session completion (Task 12's end_room_session): every
-- member who answered at least one shared item earns +40 XP (deduped per
-- session, so ending twice awards nobody twice). Other participants' badge
-- toasts surface on their next awarding action; the host sees theirs here.
-- ============================================================================
drop function if exists public.end_room_session(uuid);

create or replace function public.end_room_session(p_session_id uuid)
returns table (xp_awarded int, new_badges jsonb)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_host_ok boolean;
  v_participant uuid;
  v_participants int := 0;
  v_my_amount int := null;
  v_my_badges jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.room_sessions s
    where s.id = p_session_id
      and (s.host_id = v_user or exists (
        select 1 from public.rooms r
        where r.id = s.room_id and r.created_by = v_user
      ))
  ) then
    raise exception 'Only the session host can end it';
  end if;

  update public.room_sessions
  set status = 'ended', ended_at = now()
  where id = p_session_id and status = 'active';

  -- Completion XP for every participant who answered at least one item.
  for v_participant in
    select distinct a.user_id
    from public.room_session_answers a
    where a.session_id = p_session_id
  loop
    v_participants := v_participants + 1;
    if v_participant = v_user then
      v_my_amount := public.award_xp_for(v_participant, 'session', p_session_id::text, 40);
    else
      perform public.award_xp_for(v_participant, 'session', p_session_id::text, 40);
    end if;
  end loop;

  -- Only the caller's new badges go back for a toast (others surface on
  -- their own next activity).
  if v_participants > 0 then
    select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
    into v_my_badges
    from public.check_badges(v_user) b;
  end if;

  return query select v_my_amount, coalesce(v_my_badges, '[]'::jsonb);
end;
$$;
