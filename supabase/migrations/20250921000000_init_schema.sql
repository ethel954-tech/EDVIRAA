-- ============================================================================
-- Study Assistant — initial schema (spec section 5)
-- Tables, enums, triggers, indexes, and Row Level Security.
--
-- Apply with either:
--   a) Supabase CLI:   supabase link --project-ref <ref> && supabase db push
--   b) Dashboard:      SQL Editor -> paste this file -> Run
--
-- Conventions:
--   * All app tables live in schema `public`.
--   * Every table has RLS enabled. Default: users see only their own rows.
--     Room-scoped access (room_messages, rooms, room_members) is granted to
--     members of that room via SECURITY DEFINER helpers so RLS inside policy
--     subqueries cannot recurse.
--   * profile.role is locked after signup (trigger) per spec section 4.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('student', 'educator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.module_status as enum ('locked', 'in_progress', 'complete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.room_type as enum ('peer', 'teacher');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- profiles: 1:1 with auth.users, created by trigger (see bottom of file)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'student',
  display_name text not null default '',
  created_at  timestamptz not null default now()
);

-- classes: student-defined, never institution-linked (spec section 11)
create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (student_id, name)
);
-- Idempotency guards: migrations 11 (badges rebuild) and 14 (classes ->
-- subjects rename) reshape/rename objects this file created. Every statement
-- below that touches those shapes is guarded so re-running the combined file
-- never errors after a later migration has landed.

do $$ begin
  if to_regclass('public.classes') is not null then
    create index if not exists idx_classes_student on public.classes (student_id);
  end if;
end $$;

-- documents: uploaded PDFs metadata
create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles (id) on delete cascade,
  class_id     uuid not null references public.classes (id) on delete cascade,
  title        text not null,
  storage_path text not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_documents_student on public.documents (student_id);
do $$ begin
  if to_regclass('public.documents') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'class_id'
  ) then
    create index if not exists idx_documents_class on public.documents (class_id);
  end if;
end $$;

-- document_chunks: RAG chunks with pgvector embeddings.
-- IMPORTANT: dimension must match the embedding model used by the RAG edge
-- function (spec section 6). 1024 = Qwen/DashScope text-embedding-v3.
-- Change here AND in the embedder before any data is inserted.
create table if not exists public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content     text not null,
  embedding   extensions.vector(1024),
  chunk_index int not null,
  unique (document_id, chunk_index)
);
create index if not exists idx_document_chunks_document
  on public.document_chunks (document_id, chunk_index);
-- HNSW: usable on empty tables, better recall than ivfflat at this scale.
create index if not exists idx_document_chunks_embedding
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- modules: adaptive roadmap steps per class
create table if not exists public.modules (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  title       text not null,
  order_index int not null default 0,
  status      public.module_status not null default 'locked'
);
do $$ begin
  if to_regclass('public.modules') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'modules'
      and column_name = 'class_id'
  ) then
    create index if not exists idx_modules_class on public.modules (class_id, order_index);
  end if;
end $$;

create table if not exists public.topics (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.modules (id) on delete cascade,
  title       text not null,
  order_index int not null default 0
);
create index if not exists idx_topics_module on public.topics (module_id, order_index);

create table if not exists public.study_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  xp_earned  int not null default 0 check (xp_earned >= 0),
  summary    text,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists idx_study_sessions_user
  on public.study_sessions (user_id, started_at desc);

create table if not exists public.quiz_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  topic_id   uuid not null references public.topics (id) on delete cascade,
  score      int not null default 0 check (score >= 0),
  mistakes   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_quiz_attempts_user on public.quiz_attempts (user_id, created_at desc);
create index if not exists idx_quiz_attempts_topic on public.quiz_attempts (topic_id);

create table if not exists public.error_journal_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  topic_id       uuid not null references public.topics (id) on delete cascade,
  question       text not null,
  correct_answer text not null,
  user_answer    text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_error_journal_user on public.error_journal_entries (user_id, topic_id);

-- rooms: one shared primitive; creator_role determines available tools
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.profiles (id) on delete cascade,
  creator_role public.user_role not null,
  name         text not null,
  type         public.room_type not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_rooms_creator on public.rooms (created_by);

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists idx_room_members_user on public.room_members (user_id);

create table if not exists public.room_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_room_messages_room
  on public.room_messages (room_id, created_at);

create table if not exists public.gamification (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  xp               int not null default 0 check (xp >= 0),
  level            int not null default 1 check (level >= 1),
  current_streak   int not null default 0 check (current_streak >= 0),
  longest_streak   int not null default 0 check (longest_streak >= 0),
  last_active_date date
);

create table if not exists public.badges (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  badge_key text not null,
  earned_at timestamptz not null default now(),
  unique (user_id, badge_key)
);
-- (No idx_badges_user here: the legacy shape's unique (user_id, badge_key)
-- constraint provides its own index, and the post-migration-11 catalog shape
-- is a tiny lookup table that needs none.)

-- ----------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so policy subqueries see room
-- membership without recursing into room_members' own RLS)
-- ----------------------------------------------------------------------------
create or replace function public.is_room_member(target_room uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = target_room and user_id = auth.uid()
  );
$$;

create or replace function public.is_room_creator(target_room uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms
    where id = target_room and created_by = auth.uid()
  );
$$;

-- True when the current user shares at least one room with `other` —
-- lets roommates read each other's profiles (display names/avatars).
create or replace function public.shares_room_with(other uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_members a
    join public.room_members b on b.room_id = a.room_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------

-- Auto-create profile + gamification row on signup. Reads `role` from
-- signup metadata (options.data in supabase.auth.signUp); defaults student.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  exception when others then
    v_role := 'student';
  end;

  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.gamification (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Room creator automatically becomes a member
create or replace function public.handle_new_room()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.room_members (room_id, user_id)
  values (new.id, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_room_created on public.rooms;
create trigger on_room_created
  after insert on public.rooms
  for each row execute function public.handle_new_room();

-- Role lock: permanent after signup (spec section 4)
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Role is permanently locked after signup';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- subjects is the post-migration-14 name of classes; enable RLS on whichever
-- exists (fresh DBs have classes here, migration 14 renames it later).
alter table public.profiles             enable row level security;
do $$ begin
  if to_regclass('public.classes') is not null then
    alter table public.classes enable row level security;
  end if;
  if to_regclass('public.subjects') is not null then
    alter table public.subjects enable row level security;
  end if;
end $$;
alter table public.documents            enable row level security;
alter table public.document_chunks      enable row level security;
alter table public.modules              enable row level security;
alter table public.topics               enable row level security;
alter table public.study_sessions       enable row level security;
alter table public.quiz_attempts        enable row level security;
alter table public.error_journal_entries enable row level security;
alter table public.rooms                enable row level security;
alter table public.room_members         enable row level security;
alter table public.room_messages        enable row level security;
alter table public.gamification         enable row level security;
alter table public.badges               enable row level security;

-- profiles -------------------------------------------------------------------
-- Read: own profile, or profiles of users you share a room with (member
-- avatars). No delete policy: accounts are removed via auth.users (cascade).
drop policy if exists "profiles_select_own_or_roommates" on public.profiles;
create policy "profiles_select_own_or_roommates" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_room_with(id));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Strictly personal tables (owner = user_id / student_id) --------------------
-- classes policies only apply while the table is still named classes
-- (migration 14 renames it and recreates these as subjects_* policies).
do $$ begin
if to_regclass('public.classes') is not null then

drop policy if exists "classes_select_own" on public.classes;
create policy "classes_select_own" on public.classes
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "classes_insert_own" on public.classes;
create policy "classes_insert_own" on public.classes
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "classes_update_own" on public.classes;
create policy "classes_update_own" on public.classes
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "classes_delete_own" on public.classes;
create policy "classes_delete_own" on public.classes
  for delete to authenticated using (student_id = auth.uid());

end if;
end $$;

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own" on public.documents
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own" on public.documents
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own" on public.documents
  for delete to authenticated using (student_id = auth.uid());

-- Chunks inherit ownership through the parent document
drop policy if exists "document_chunks_select_via_document" on public.document_chunks;
create policy "document_chunks_select_via_document" on public.document_chunks
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and d.student_id = auth.uid()
  ));
drop policy if exists "document_chunks_insert_via_document" on public.document_chunks;
create policy "document_chunks_insert_via_document" on public.document_chunks
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
    where d.id = document_id and d.student_id = auth.uid()
  ));
drop policy if exists "document_chunks_delete_via_document" on public.document_chunks;
create policy "document_chunks_delete_via_document" on public.document_chunks
  for delete to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and d.student_id = auth.uid()
  ));

-- Roadmap policies reference public.classes (renamed to subjects by
-- migration 14) — guard the whole block so re-runs after the rename skip it.
do $$ begin
if to_regclass('public.classes') is not null then

-- Roadmap: ownership flows class -> module -> topic
drop policy if exists "modules_select_via_class" on public.modules;
create policy "modules_select_via_class" on public.modules
  for select to authenticated
  using (exists (
    select 1 from public.classes c
    where c.id = class_id and c.student_id = auth.uid()
  ));
drop policy if exists "modules_insert_via_class" on public.modules;
create policy "modules_insert_via_class" on public.modules
  for insert to authenticated
  with check (exists (
    select 1 from public.classes c
    where c.id = class_id and c.student_id = auth.uid()
  ));
drop policy if exists "modules_update_via_class" on public.modules;
create policy "modules_update_via_class" on public.modules
  for update to authenticated
  using (exists (
    select 1 from public.classes c
    where c.id = class_id and c.student_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.classes c
    where c.id = class_id and c.student_id = auth.uid()
  ));
drop policy if exists "modules_delete_via_class" on public.modules;
create policy "modules_delete_via_class" on public.modules
  for delete to authenticated
  using (exists (
    select 1 from public.classes c
    where c.id = class_id and c.student_id = auth.uid()
  ));

drop policy if exists "topics_select_via_module" on public.topics;
create policy "topics_select_via_module" on public.topics
  for select to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.classes c on c.id = m.class_id
    where m.id = module_id and c.student_id = auth.uid()
  ));
drop policy if exists "topics_insert_via_module" on public.topics;
create policy "topics_insert_via_module" on public.topics
  for insert to authenticated
  with check (exists (
    select 1
    from public.modules m
    join public.classes c on c.id = m.class_id
    where m.id = module_id and c.student_id = auth.uid()
  ));
drop policy if exists "topics_update_via_module" on public.topics;
create policy "topics_update_via_module" on public.topics
  for update to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.classes c on c.id = m.class_id
    where m.id = module_id and c.student_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.modules m
    join public.classes c on c.id = m.class_id
    where m.id = module_id and c.student_id = auth.uid()
  ));
drop policy if exists "topics_delete_via_module" on public.topics;
create policy "topics_delete_via_module" on public.topics
  for delete to authenticated
  using (exists (
    select 1
    from public.modules m
    join public.classes c on c.id = m.class_id
    where m.id = module_id and c.student_id = auth.uid()
  ));

end if;
end $$;

drop policy if exists "study_sessions_select_own" on public.study_sessions;
create policy "study_sessions_select_own" on public.study_sessions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "study_sessions_insert_own" on public.study_sessions;
create policy "study_sessions_insert_own" on public.study_sessions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "study_sessions_update_own" on public.study_sessions;
create policy "study_sessions_update_own" on public.study_sessions
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "study_sessions_delete_own" on public.study_sessions;
create policy "study_sessions_delete_own" on public.study_sessions
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "quiz_attempts_select_own" on public.quiz_attempts;
create policy "quiz_attempts_select_own" on public.quiz_attempts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "quiz_attempts_insert_own" on public.quiz_attempts;
create policy "quiz_attempts_insert_own" on public.quiz_attempts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "quiz_attempts_delete_own" on public.quiz_attempts;
create policy "quiz_attempts_delete_own" on public.quiz_attempts
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "error_journal_select_own" on public.error_journal_entries;
create policy "error_journal_select_own" on public.error_journal_entries
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "error_journal_insert_own" on public.error_journal_entries;
create policy "error_journal_insert_own" on public.error_journal_entries
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "error_journal_delete_own" on public.error_journal_entries;
create policy "error_journal_delete_own" on public.error_journal_entries
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "gamification_select_own" on public.gamification;
create policy "gamification_select_own" on public.gamification
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "gamification_update_own" on public.gamification;
create policy "gamification_update_own" on public.gamification
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- badges policies only apply to the legacy per-user shape (id uuid,
-- user_id, badge_key); migration 11 rebuilds it as a catalog + user_badges
-- with its own policies. Guard so re-runs after 11 skip these.
do $$ begin
if to_regclass('public.badges') is not null and exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'badges'
    and column_name = 'badge_key'
) then

drop policy if exists "badges_select_own" on public.badges;
create policy "badges_select_own" on public.badges
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "badges_insert_own" on public.badges;
create policy "badges_insert_own" on public.badges
  for insert to authenticated with check (user_id = auth.uid());

end if;
end $$;

-- Rooms ----------------------------------------------------------------------
drop policy if exists "rooms_select_member_or_creator" on public.rooms;
create policy "rooms_select_member_or_creator" on public.rooms
  for select to authenticated
  using (created_by = auth.uid() or public.is_room_member(id));

drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own" on public.rooms
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and creator_role = (select role from public.profiles where id = auth.uid())
  );

drop policy if exists "rooms_update_creator" on public.rooms;
create policy "rooms_update_creator" on public.rooms
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "rooms_delete_creator" on public.rooms;
create policy "rooms_delete_creator" on public.rooms
  for delete to authenticated using (created_by = auth.uid());

-- Membership: see your own memberships, or the roster of rooms you own.
-- Join: any authenticated user may join any visible room (invite tokens can
-- tighten this later). Leave/removed: self, or the room creator.
drop policy if exists "room_members_select_own_or_creator" on public.room_members;
create policy "room_members_select_own_or_creator" on public.room_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_room_creator(room_id));

drop policy if exists "room_members_insert_self" on public.room_members;
create policy "room_members_insert_self" on public.room_members
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "room_members_delete_self_or_creator" on public.room_members;
create policy "room_members_delete_self_or_creator" on public.room_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_creator(room_id));

-- Messages: visible/writable by room members; authors edit their own;
-- creator may moderate (delete) any message in their room.
drop policy if exists "room_messages_select_members" on public.room_messages;
create policy "room_messages_select_members" on public.room_messages
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists "room_messages_insert_members" on public.room_messages;
create policy "room_messages_insert_members" on public.room_messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists "room_messages_update_author" on public.room_messages;
create policy "room_messages_update_author" on public.room_messages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "room_messages_delete_author_or_creator" on public.room_messages;
create policy "room_messages_delete_author_or_creator" on public.room_messages
  for delete to authenticated
  using (user_id = auth.uid() or public.is_room_creator(room_id));
