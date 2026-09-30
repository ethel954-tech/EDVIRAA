-- ============================================================================
-- Study rooms: shared activities (Task 12)
--
-- A "session" is a shared activity inside a room: the host (any member who
-- starts it) picks one of THEIR OWN quizzes or flashcard decks, and the RPC
-- copies the questions/cards into room_session_items — a frozen snapshot.
-- Members never need access to the host's private study material; they only
-- touch the session tables (RLS-scoped to room membership).
--
-- Live sync:
--   room_sessions       in the realtime publication — members receive INSERT
--                       (session started) and UPDATE (current_item_index /
--                       status) events, so everyone sees the same item at
--                       the same time without polling.
--   room_session_answers in the publication (denormalized room_id so the
--                       subscription filter is direct) — live answer tally.
-- ============================================================================

create table if not exists public.room_sessions (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms (id) on delete cascade,
  host_id            uuid not null references public.profiles (id) on delete cascade,
  kind               text not null check (kind in ('quiz', 'flashcards')),
  source_id          uuid,  -- host's quiz or document the snapshot came from
  source_title       text not null default '',
  current_item_index int not null default 0 check (current_item_index >= 0),
  status             text not null default 'active' check (status in ('active', 'ended')),
  created_at         timestamptz not null default now(),
  ended_at           timestamptz
);

create index if not exists idx_room_sessions_room
  on public.room_sessions (room_id, created_at desc);

create table if not exists public.room_session_items (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.room_sessions (id) on delete cascade,
  order_index    int not null default 0,
  prompt         text not null,              -- question text / card front
  reveal         text not null default '',   -- explanation / card back
  options        jsonb not null default '[]'::jsonb,  -- quiz: [{key:'A',text:...},...]
  correct_key    text                        -- quiz: 'A'..'D'; flashcards: null
);

create index if not exists idx_room_session_items_session
  on public.room_session_items (session_id, order_index);

create table if not exists public.room_session_answers (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.room_sessions (id) on delete cascade,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  item_id    uuid not null references public.room_session_items (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  answer     text not null,               -- quiz: chosen key; flashcards: got_it|missed_it
  is_correct boolean,                     -- quiz only (graded server-side)
  created_at timestamptz not null default now(),
  unique (item_id, user_id)
);

create index if not exists idx_room_session_answers_session
  on public.room_session_answers (session_id, item_id);

-- ----------------------------------------------------------------------------
-- RLS: visibility for room members; ALL writes go through the RPCs below.
-- ----------------------------------------------------------------------------
alter table public.room_sessions        enable row level security;
alter table public.room_session_items   enable row level security;
alter table public.room_session_answers enable row level security;

drop policy if exists "room_sessions_select_members" on public.room_sessions;
create policy "room_sessions_select_members" on public.room_sessions
  for select to authenticated
  using (public.is_room_member(room_id) or public.is_room_creator(room_id));

drop policy if exists "room_session_items_select_members" on public.room_session_items;
create policy "room_session_items_select_members" on public.room_session_items
  for select to authenticated
  using (exists (
    select 1 from public.room_sessions s
    where s.id = session_id
      and (public.is_room_member(s.room_id) or public.is_room_creator(s.room_id))
  ));

drop policy if exists "room_session_answers_select_members" on public.room_session_answers;
create policy "room_session_answers_select_members" on public.room_session_answers
  for select to authenticated
  using (public.is_room_member(room_id) or public.is_room_creator(room_id));

-- ----------------------------------------------------------------------------
-- Realtime publication
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.room_sessions;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.room_session_answers;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ----------------------------------------------------------------------------
-- start_room_session: snapshot the host's quiz or flashcard deck into items.
-- Any room member may start an activity.
-- ----------------------------------------------------------------------------
create or replace function public.start_room_session(
  p_room_id uuid,
  p_kind text,
  p_source_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session_id uuid;
  src record;
  max_items int;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_kind not in ('quiz', 'flashcards') then
    raise exception 'kind must be quiz or flashcards';
  end if;
  if not public.is_room_member(p_room_id) and not public.is_room_creator(p_room_id) then
    raise exception 'Room not found';
  end if;

  if p_kind = 'quiz' then
    -- Host's own quiz (RLS-equivalent ownership check).
    select q.id, q.title into src
    from public.quizzes q
    where q.id = p_source_id and q.student_id = v_user;
    if src is null then
      raise exception 'Quiz not found';
    end if;
    max_items := 12;
  else
    -- Host's own document with generated flashcards.
    select d.id, d.title into src
    from public.documents d
    where d.id = p_source_id and d.student_id = v_user;
    if src is null then
      raise exception 'Document not found';
    end if;
    max_items := 20;
  end if;

  insert into public.room_sessions (room_id, host_id, kind, source_id, source_title)
  values (p_room_id, v_user, p_kind, p_source_id, src.title)
  returning id into v_session_id;

  if p_kind = 'quiz' then
    insert into public.room_session_items (session_id, order_index, prompt, reveal, options, correct_key)
    select v_session_id,
           qq.order_index,
           qq.question,
           coalesce(qq.explanation, ''),
           (
             select jsonb_agg(jsonb_build_object('key', letter, 'text', qq.options ->> letter) order by letter)
             from unnest(array['A','B','C','D']) as letter
           ),
           qq.correct_answer
    from public.quiz_questions qq
    where qq.quiz_id = p_source_id
    order by qq.order_index
    limit max_items;
  else
    insert into public.room_session_items (session_id, order_index, prompt, reveal)
    select v_session_id,
           row_number() over (order by f.created_at) - 1,
           f.question,
           f.answer
    from public.flashcards f
    where f.document_id = p_source_id
    order by f.created_at
    limit max_items;
  end if;

  if not exists (select 1 from public.room_session_items where session_id = v_session_id) then
    delete from public.room_sessions where id = v_session_id;
    raise exception 'That source has no items to share';
  end if;

  return v_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- set_room_session_item: host moves everyone to an item (same question at
-- the same time). Also used for flashcard card position.
-- ----------------------------------------------------------------------------
create or replace function public.set_room_session_item(
  p_session_id uuid,
  p_index int
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.room_sessions
    where id = p_session_id and host_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Only the session host can do that';
  end if;

  select count(*) into v_total
  from public.room_session_items where session_id = p_session_id;

  if p_index < 0 or p_index >= v_total then
    raise exception 'Item index out of range';
  end if;

  update public.room_sessions
  set current_item_index = p_index
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- submit_room_session_answer: one answer per member per item, graded
-- server-side for quizzes (the key is already in the item row).
-- ----------------------------------------------------------------------------
create or replace function public.submit_room_session_answer(
  p_session_id uuid,
  p_item_id uuid,
  p_answer text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.room_sessions;
  v_item public.room_session_items;
  v_correct boolean := null;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session from public.room_sessions where id = p_session_id;
  if v_session is null or v_session.status <> 'active' then
    raise exception 'Activity is not active';
  end if;
  if not (public.is_room_member(v_session.room_id) or public.is_room_creator(v_session.room_id)) then
    raise exception 'Room not found';
  end if;

  select * into v_item from public.room_session_items
  where id = p_item_id and session_id = p_session_id;
  if v_item is null then
    raise exception 'Question not found';
  end if;

  p_answer := nullif(trim(coalesce(p_answer, '')), '');
  if p_answer is null then
    raise exception 'Answer is required';
  end if;

  if v_session.kind = 'quiz' then
    p_answer := upper(left(p_answer, 1));
    if p_answer not in ('A', 'B', 'C', 'D') then
      raise exception 'Invalid answer';
    end if;
    v_correct := (p_answer = upper(v_item.correct_key));
  else
    if p_answer not in ('got_it', 'missed_it') then
      raise exception 'Invalid response';
    end if;
  end if;

  insert into public.room_session_answers
    (session_id, room_id, item_id, user_id, answer, is_correct)
  values
    (p_session_id, v_session.room_id, p_item_id, v_user, p_answer, v_correct)
  on conflict (item_id, user_id) do update
    set answer = excluded.answer,
        is_correct = excluded.is_correct,
        created_at = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- get_room_session_feedback: the correct key + explanation for an item are
-- unlocked ONLY after the caller has answered it (quiz items carry the key
-- in the DB; the client never receives it with the question).
-- ----------------------------------------------------------------------------
create or replace function public.get_room_session_feedback(
  p_session_id uuid,
  p_item_id uuid
)
returns table (correct_key text, reveal text)
language plpgsql security definer
set search_path = public
as $$
declare
  v_session public.room_sessions;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_session from public.room_sessions where id = p_session_id;
  if v_session is null then
    raise exception 'Activity not found';
  end if;
  if not (public.is_room_member(v_session.room_id) or public.is_room_creator(v_session.room_id)) then
    raise exception 'Room not found';
  end if;

  -- Feedback is earned: you must have answered this item yourself.
  if not exists (
    select 1 from public.room_session_answers
    where session_id = p_session_id and item_id = p_item_id and user_id = auth.uid()
  ) then
    raise exception 'Answer first to see the feedback';
  end if;

  select correct_key, reveal
  into correct_key, reveal
  from public.room_session_items
  where id = p_item_id and session_id = p_session_id;

  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- end_room_session: host (or room creator) closes the activity.
-- ----------------------------------------------------------------------------
-- Migration 11 later replaces this function with an XP+badge version
-- (return changes void -> table). Drop first so re-runs after 11 don't fail
-- with 42P13 (cannot change return type of existing function).
drop function if exists public.end_room_session(uuid);

create or replace function public.end_room_session(p_session_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.room_sessions s
    join public.rooms r on r.id = s.room_id
    where s.id = p_session_id
      and (s.host_id = auth.uid() or r.created_by = auth.uid())
  ) then
    raise exception 'Only the session host can end it';
  end if;

  update public.room_sessions
  set status = 'ended', ended_at = now()
  where id = p_session_id and status = 'active';
end;
$$;
