-- =====================================================================
-- EDVIRAA — Combined Supabase migrations
-- GENERATED from supabase/migrations/*.sql (do not hand-edit).
-- Contains the full current migration set (21 files, 20250921000000_init_schema.sql .. 20261003000003_educator_verification.sql), in filename order.
-- Each section below is the exact content of one migration file.
-- Intended for one-shot pasting into the Supabase SQL Editor.
-- =====================================================================

-- =====================================================================
-- Migration: 20250921000000_init_schema.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20250921000001_storage_documents.sql
-- =====================================================================
-- ============================================================================
-- Storage: private 'documents' bucket for uploaded PDFs (spec section 5/7).
-- Object path convention: {user_id}/{document_id}.pdf — the first folder is
-- the owner's auth uid, which the policies below enforce.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Owners may read, upload, replace, and delete files inside their own folder.
-- Drop-first keeps re-runs idempotent (no CREATE POLICY IF NOT EXISTS).
drop policy if exists "documents_storage_select_own" on storage.objects;
create policy "documents_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_insert_own" on storage.objects;
create policy "documents_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_update_own" on storage.objects;
create policy "documents_storage_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_delete_own" on storage.objects;
create policy "documents_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- =====================================================================
-- Migration: 20250921000002_auth_role_finalization.sql
-- =====================================================================
-- ============================================================================
-- Auth: role selection finalization for OAuth signups (Task 3 — Auth)
--
-- Email/password signups choose their role BEFORE the account exists, so
-- supabase.auth.signUp(options: { data: { role, display_name } }) carries it
-- in raw_user_meta_data and the existing on_auth_user_created trigger
-- (20250921000000_init_schema.sql) writes profiles.role directly.
--
-- Google (OAuth) signups create the account on Google's side with no role,
-- so the user finalizes it after first login at /auth/role. Until then their
-- profile has role = NULL ("pending"). Finalization is server-authoritative
-- (the client never writes the role column): it flips NULL -> chosen role in
-- the same transaction that records the explicit confirmation.
--
-- The email/password path keeps the pre-selection dialog; the DB-level
-- one-time lock below means either path can only ever set the role once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles.role becomes nullable: NULL = pending role selection (OAuth only).
-- role_confirmed_at records the explicit user confirmation; the lock trigger
-- refuses any role write that doesn't carry it.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists role_confirmed_at timestamptz,
  alter column role drop default,
  alter column role drop not null;

-- ----------------------------------------------------------------------------
-- Keep the post-signup trigger tolerant of OAuth users that arrive without a
-- role in metadata: insert NULL instead of coercing to 'student', and never
-- overwrite an existing profile (re-login after a soft delete, etc.).
-- ----------------------------------------------------------------------------
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
    v_role := null;  -- OAuth signup: role chosen later at /auth/role
  end;

  insert into public.profiles (id, role, role_confirmed_at, display_name)
  values (
    new.id,
    v_role,
    -- Email/password signups choose (and confirm) their role in the signup
    -- dialog BEFORE the account exists, so the trigger's role write carries
    -- the confirmation. OAuth signups get NULL/NULL (pending) instead.
    case when v_role is not null then now() end,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.gamification (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- DB-level one-time role lock (defense in depth on top of the RLS rules):
-- once set, the role can never change again, and every write must carry the
-- explicit user confirmation (role_confirmed_at is not null).
-- ----------------------------------------------------------------------------
create or replace function public.enforce_role_lock()
returns trigger
language plpgsql
as $$
begin
  -- A non-null role must always arrive with recorded confirmation. NULL-role
  -- inserts (OAuth signup, pending choice) are allowed.
  if new.role is not null and new.role_confirmed_at is null then
    raise exception 'Role change requires explicit confirmation (role_confirmed_at)';
  end if;

  -- Once set, the role is permanently locked (spec section 4). Only the
  -- NULL -> role finalization (finalize_role RPC) may ever set it.
  if tg_op = 'UPDATE' and old.role is not null and new.role is distinct from old.role then
    raise exception 'Role is permanently locked after signup';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_role_lock on public.profiles;
create trigger enforce_role_lock
  before insert or update on public.profiles
  for each row execute function public.enforce_role_lock();

-- The old update-only trigger is superseded by enforce_role_lock.
drop trigger if exists protect_profile_role on public.profiles;
drop function if exists public.protect_profile_role();

-- ----------------------------------------------------------------------------
-- Finalization RPC: callable exactly once per user, server-side. The client
-- UI asks "This can't be changed later — are you sure?" BEFORE calling this.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_role(chosen_role public.user_role)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_current public.user_role;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if chosen_role not in ('student', 'educator') then
    raise exception 'Invalid role';
  end if;

  select role into v_current from public.profiles where id = auth.uid();

  if v_current is not null then
    raise exception 'Role already set and cannot be changed';
  end if;

  -- Normally the profile row already exists (created by the signup trigger);
  -- the upsert is a defensive fallback so a missing profile can never leave
  -- the user stuck in the role-selection loop.
  insert into public.profiles (id, role, role_confirmed_at, display_name)
  values (
    auth.uid(),
    chosen_role,
    now(),
    coalesce(
      (
        select raw_user_meta_data ->> 'display_name'
        from auth.users
        where id = auth.uid()
      ),
      split_part(
        coalesce((select email from auth.users where id = auth.uid()), ''),
        '@',
        1
      )
    )
  )
  on conflict (id) do update
    set role = excluded.role,
        role_confirmed_at = excluded.role_confirmed_at
    -- Only ever fill in a pending (NULL) role; a set role is untouchable.
    where public.profiles.role is null;

  -- The signup trigger normally seeds this too; same defensive fallback.
  insert into public.gamification (user_id) values (auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- RLS: nobody reads a roleless profile row except its owner, and the client
-- can only write display_name (role/role_confirmed_at are RPC-only).
-- The select policy replaces the one from the init schema (role-gated now);
-- drop-first keeps this migration idempotent (no CREATE POLICY IF NOT EXISTS
-- in Postgres).
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_roommates" on public.profiles;
create policy "profiles_select_own_or_roommates" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (
      role is not null
      and public.shares_room_with(id)
    )
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- =====================================================================
-- Migration: 20250921000003_educator_onboarding.sql
-- =====================================================================
-- ============================================================================
-- Educator onboarding: subject area on profiles (Task 5)
--
-- Spec section 4: "Educator onboarding: role -> profile setup (name,
-- subject area) -> educator dashboard empty state prompting room creation".
--
-- display_name already exists; subject_area is new. It stays NULL until the
-- educator completes onboarding at /onboarding/educator (students leave it
-- NULL forever). Free text by design — educators describe their subject
-- area in their own words; no fixed taxonomy is imposed.
-- ============================================================================

alter table public.profiles
  add column if not exists subject_area text;

-- Convenience for the educator dashboard: "Dr. Chen — Mathematics".
create or replace function public.profile_label()
returns text
language sql stable
as $$
  select case
    when subject_area is not null and subject_area <> ''
    then display_name || ' — ' || subject_area
    else display_name
  end
  from public.profiles
  where id = auth.uid();
$$;


-- =====================================================================
-- Migration: 20250921000004_document_status.sql
-- =====================================================================
-- ============================================================================
-- Documents: processing lifecycle (Task 6)
--
-- Uploads are two-phase: the browser uploads the PDF to Storage, then the
-- RAG ingestion edge function (Task 7) parses/chunks/embeds it and marks the
-- row ready. Until then the document shows "Processing..." in the UI and is
-- excluded from retrieval.
--
-- Statuses:
--   processing -> parse + chunk + embed in flight (initial state on insert)
--   ready      -> chunks embedded, document is searchable
--   failed     -> ingestion errored (user may retry / re-upload)
-- ============================================================================

do $$ begin
  create type public.document_status as enum ('processing', 'ready', 'failed');
exception when duplicate_object then null; end $$;

alter table public.documents
  add column if not exists status public.document_status not null default 'processing';

-- RAG ingestion edge function flips this when chunking/embedding completes.
-- (function body filled in by the ingestion function task; safe no-op now)
create or replace function public.mark_document_ready(p_document_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.documents
  set status = 'ready'
  where id = p_document_id
    and student_id = auth.uid();
end;
$$;


-- =====================================================================
-- Migration: 20250921000005_rag_search_function.sql
-- =====================================================================
-- ============================================================================
-- RAG retrieval: class-scoped pgvector similarity search (Task 7)
--
-- Given a query embedding and a class, return the top-k most similar
-- document chunks belonging to that class's documents. SECURITY DEFINER so
-- the ownership check (document -> student) can't recurse through the
-- document_chunks RLS policies; ownership is still enforced row-by-row by
-- checking student_id = auth.uid(), so a user can never retrieve another
-- student's chunks.
--
-- The embedding dimension must match document_chunks.embedding (vector(1024)
-- for Qwen text-embedding-v3; see 20250921000000_init_schema.sql).
-- ============================================================================

-- Guard: this SQL-language function body references documents.class_id,
-- which migration 14 renames to subject_id (and recreates this function
-- under the new name). Skip on post-rename re-runs so the combined file
-- stays idempotent.
do $do$
begin
  if to_regclass('public.documents') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'class_id'
  ) then

create or replace function public.search_document_chunks(
  p_query_embedding extensions.vector(1024),
  p_class_id uuid,
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
    and d.class_id = p_class_id
    and d.status = 'ready'
    and dc.embedding is not null
  order by dc.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

  end if;
end
$do$;


-- =====================================================================
-- Migration: 20250921000006_tutor_chat.sql
-- =====================================================================
-- ============================================================================
-- AI Tutor chat persistence (Task 8)
--
-- Conversations live per student, optionally scoped to a class (the tutor is
-- grounded in that class's documents via search_document_chunks). Messages
-- store both turns of every exchange so a conversation can be resumed later.
--
-- RLS: conversations are owner-only; messages are readable/writable only
-- through their parent conversation (ownership flows via the join), so
-- students can never read another student's chat history.
-- ============================================================================

create table if not exists public.tutor_conversations (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  class_id   uuid references public.classes (id) on delete set null,
  title      text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tutor_conversations_student
  on public.tutor_conversations (student_id, updated_at desc);

create table if not exists public.tutor_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.tutor_conversations (id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_tutor_messages_conversation
  on public.tutor_messages (conversation_id, created_at);

-- Keep the list sorted by activity: every message bumps the conversation.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tutor_conversations_touch on public.tutor_conversations;
create trigger tutor_conversations_touch
  before update on public.tutor_conversations
  for each row execute function public.touch_updated_at();

-- Bump the parent conversation on every new message so the conversation
-- list sorts by actual activity.
create or replace function public.touch_parent_conversation()
returns trigger
language plpgsql
as $$
begin
  update public.tutor_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists tutor_messages_touch_parent on public.tutor_messages;
create trigger tutor_messages_touch_parent
  after insert on public.tutor_messages
  for each row execute function public.touch_parent_conversation();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.tutor_conversations enable row level security;
alter table public.tutor_messages       enable row level security;

drop policy if exists "tutor_conversations_select_own" on public.tutor_conversations;
create policy "tutor_conversations_select_own" on public.tutor_conversations
  for select to authenticated using (student_id = auth.uid());
drop policy if exists "tutor_conversations_insert_own" on public.tutor_conversations;
create policy "tutor_conversations_insert_own" on public.tutor_conversations
  for insert to authenticated with check (student_id = auth.uid());
drop policy if exists "tutor_conversations_update_own" on public.tutor_conversations;
create policy "tutor_conversations_update_own" on public.tutor_conversations
  for update to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());
drop policy if exists "tutor_conversations_delete_own" on public.tutor_conversations;
create policy "tutor_conversations_delete_own" on public.tutor_conversations
  for delete to authenticated using (student_id = auth.uid());

-- Messages inherit ownership from the parent conversation (read + write only;
-- no update/delete policies — stored turns are immutable, conversations go
-- away by deleting the whole conversation).
drop policy if exists "tutor_messages_select_via_conversation" on public.tutor_messages;
create policy "tutor_messages_select_via_conversation" on public.tutor_messages
  for select to authenticated
  using (exists (
    select 1 from public.tutor_conversations tc
    where tc.id = conversation_id and tc.student_id = auth.uid()
  ));

drop policy if exists "tutor_messages_insert_via_conversation" on public.tutor_messages;
create policy "tutor_messages_insert_via_conversation" on public.tutor_messages
  for insert to authenticated
  with check (exists (
    select 1 from public.tutor_conversations tc
    where tc.id = conversation_id and tc.student_id = auth.uid()
  ));


-- =====================================================================
-- Migration: 20250921000007_flashcards_quizzes.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20250921000008_roadmap.sql
-- =====================================================================
-- ============================================================================
-- Roadmap & modules (Task 10)
--
-- modules + topics already exist (20250921000000_init_schema.sql); the
-- roadmap is generated per class by the `generate-roadmap` edge function,
-- which has Qwen split the class's document structure into an ordered
-- learning path and stores it here.
--
-- This migration adds topic completion tracking and the server-side toggle
-- that keeps modules.status truthful:
--   all topics complete  -> 'complete'
--   some topics complete -> 'in_progress'
--   none complete        -> 'locked'
-- (the generator seeds the first module as 'in_progress' so the student
-- always has a visible starting point).
-- ============================================================================

alter table public.topics add column if not exists completed_at timestamptz;

-- ----------------------------------------------------------------------------
-- Toggle a topic's completion and recompute its module's status atomically.
-- SECURITY DEFINER so the whole chain (topic -> module -> class -> student)
-- is checked in one place; the explicit student_id check below keeps it
-- owner-only.
-- ----------------------------------------------------------------------------
-- Migration 11 later replaces this function with an XP+badge version
-- (return changes void -> table). Drop first so re-runs after 11 don't fail
-- with 42P13 (cannot change return type of existing function).
drop function if exists public.toggle_topic_completion(uuid, boolean);

create or replace function public.toggle_topic_completion(
  p_topic_id uuid,
  p_completed boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_total int;
  v_done int;
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
end;
$$;


-- =====================================================================
-- Migration: 20250921000009_study_rooms.sql
-- =====================================================================
-- ============================================================================
-- Study rooms: core (Task 11)
--
-- rooms / room_members / room_messages already exist (init schema) with RLS:
-- members see their rooms, creators own them, messages are member-scoped.
--
-- This migration adds:
--   * rooms.invite_code       — short join code; the capability to join
--   * create_room(p_name)     — RPC; type is DERIVED from the creator's role
--                               server-side (student -> 'peer',
--                               educator -> 'teacher'), per spec section 4
--   * join_room_by_code(p_code) — RPC; the code is the capability
--   * profiles.avatar_color   — deterministic palette index for member
--                               avatars (assigned at signup, backfilled)
--   * realtime publication    — room_messages + room_members for live chat
--   * roster visibility fix   — room members can see the full roster (needed
--                               for member avatars), not just their own row
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Invite code: unambiguous alphabet (no 0/O/1/I), 8 chars.
-- ----------------------------------------------------------------------------
alter table public.rooms add column if not exists invite_code text;

create unique index if not exists idx_rooms_invite_code
  on public.rooms (invite_code);

-- Codes are server-generated only (never client-writable).
create or replace function public.generate_invite_code()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  attempts int := 0;
begin
  loop
    attempts := attempts + 1;
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    end loop;
    exit when not exists (
      select 1 from public.rooms where invite_code = candidate
    ) or attempts > 20;
  end loop;
  return candidate;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_room: name-only creation (spec). Room type is derived from the
-- creator's role — never accepted from the client. The existing
-- on_room_created trigger adds the creator as a member.
-- ----------------------------------------------------------------------------
-- Migration 11 later replaces this function with an XP+badge version
-- (return changes uuid -> table). Drop first so re-runs after 11 don't fail
-- with 42P13 (cannot change return type of existing function).
drop function if exists public.create_room(text);

create or replace function public.create_room(p_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_room_id uuid;
  v_code text;
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

  return v_room_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- join_room_by_code: the code is the capability. Resolves code -> room and
-- adds the caller as a member (idempotent).
-- SECURITY DEFINER on purpose: rooms are only visible to members (RLS), but
-- anyone holding a code may resolve it to exactly that one room — and never
-- enumerate others.
-- ----------------------------------------------------------------------------
create or replace function public.join_room_by_code(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  p_code := nullif(upper(trim(coalesce(p_code, ''))), '');
  if p_code is null then
    raise exception 'Enter an invite code';
  end if;

  select id into v_room_id
  from public.rooms
  where invite_code = p_code;

  if v_room_id is null then
    raise exception 'No room found for that code';
  end if;

  insert into public.room_members (room_id, user_id)
  values (v_room_id, v_user)
  on conflict (room_id, user_id) do nothing;

  return v_room_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Avatar palette: deterministic per-user color for member avatars.
-- Assigned at signup and backfilled for existing profiles.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_color smallint
  check (avatar_color between 0 and 7);

create or replace function public.avatar_palette_index(p_id uuid)
returns smallint
language sql immutable
as $$
  select (('x' || substr(md5(p_id::text), 1, 8))::bit(32)::bigint % 8)::smallint;
$$;

-- (handle_new_user rewritten again — keep in sync with 20250921000002.)
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
    v_role := null;  -- OAuth signup: role chosen later at /auth/role
  end;

  insert into public.profiles (id, role, role_confirmed_at, display_name, avatar_color)
  values (
    new.id,
    v_role,
    case when v_role is not null then now() end,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    public.avatar_palette_index(new.id)
  )
  on conflict (id) do nothing;

  insert into public.gamification (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

update public.profiles
set avatar_color = public.avatar_palette_index(id)
where avatar_color is null;

-- ----------------------------------------------------------------------------
-- Realtime: live chat + roster updates.
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.room_messages;
exception when duplicate_object then null;
when undefined_object then null;  -- publication missing (self-hosted without realtime)
end $$;

do $$ begin
  alter publication supabase_realtime add table public.room_members;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Roster visibility: members see who else is in the room (member avatars).
-- Supersedes the init policy (own row or creator-only).
-- ----------------------------------------------------------------------------
drop policy if exists "room_members_select_own_or_creator" on public.room_members;
drop policy if exists "room_members_select_own_or_member" on public.room_members;
create policy "room_members_select_own_or_member" on public.room_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_member(room_id)
    or public.is_room_creator(room_id)
  );

-- ----------------------------------------------------------------------------
-- Existing rooms: backfill invite codes (generate_invite_code is
-- security-definer, so the update below can't recurse through RLS).
-- ----------------------------------------------------------------------------
update public.rooms
set invite_code = public.generate_invite_code()
where invite_code is null;


-- =====================================================================
-- Migration: 20250921000010_room_activities.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20250921000011_gamification.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20250921000012_lessons_exams.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20250921000013_grading_analytics.sql
-- =====================================================================
-- ============================================================================
-- Grading & analytics (Task 16)
--
--   * exam_attempts.final_grade / final_feedback / graded_at
--       The educator's finalized grade + feedback per attempt. AI feedback
--       (suggested by the suggest-exam-feedback edge function) is only a
--       SUGGESTION — it lives client-side until the educator accepts/edits
--       and finalizes, so nothing model-generated is ever persisted without
--       a human decision.
--   * finalize_exam_grade(attempt, grade, feedback)
--       Creator-only RPC; clamps the grade to the exam's max points.
--   * get_room_knowledge_gaps(room)
--       Aggregates error_journal_entries (via quiz → document → class) and
--       wrong exam answers (via exam → room) across ALL students in the
--       room, ranked by struggle rate. Rows are coarse topic labels (first
--       8 words of the question), never raw student data — the educator
--       sees what the group struggles with, not who struggled.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Grading columns
-- ----------------------------------------------------------------------------
alter table public.exam_attempts
  add column if not exists final_grade int,
  add column if not exists final_feedback text,
  add column if not exists graded_at timestamptz;

-- The educator's final grade/feedback is their private grading data; both
-- parties can read it (student sees their finalized grade).
drop policy if exists "exam_attempts_update_examiner" on public.exam_attempts;
create policy "exam_attempts_update_examiner" on public.exam_attempts
  for update using (
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

-- ----------------------------------------------------------------------------
-- finalize_exam_grade: the educator commits a grade (+ feedback) for one
-- student attempt. Grade is clamped to [0, exam max points].
-- ----------------------------------------------------------------------------
create or replace function public.finalize_exam_grade(
  p_attempt_id uuid,
  p_grade int,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_max int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_grade is null or p_grade < 0 then
    raise exception 'Grade must be a non-negative number';
  end if;

  select e.id, coalesce(sum(q.points), 0)
  into v_exam, v_max
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.exam_questions q on q.exam_id = e.id
  where a.id = p_attempt_id
    and e.created_by = auth.uid()
  group by e.id;

  if v_exam is null then
    raise exception 'Attempt not found';
  end if;
  if p_grade > v_max then
    raise exception 'Grade cannot exceed the exam maximum (%)', v_max;
  end if;

  update public.exam_attempts
  set final_grade = p_grade,
      final_feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      graded_at = now()
  where id = p_attempt_id;
end;
$$;

revoke execute on function public.finalize_exam_grade(uuid, int, text) from anon;
revoke execute on function public.finalize_exam_grade(uuid, int, text) from public;

-- ----------------------------------------------------------------------------
-- get_room_knowledge_gaps: which topics is the GROUP struggling with?
-- Combines two signals across every room member:
--   * error_journal_entries — quiz misses, joined to the room through
--     quiz -> document -> class (documents.class_id == classes.id)
--   * exam_answers with is_correct = false — joined through exam -> room
-- Struggle rate = wrong events / attempts; ranked worst first. Only
-- aggregates (labels + counts) are returned — never per-student rows.
--
-- Guard: this SQL-language body references documents.class_id, which
-- migration 14 renames (recreating the function under the new names).
-- Skip on post-rename re-runs so the combined file stays idempotent.
-- ----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.documents') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'class_id'
  ) then

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
    join public.classes c on c.id = d.class_id
    join public.room_members rm on rm.user_id = c.student_id
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
$$;

revoke execute on function public.get_room_knowledge_gaps(uuid) from anon;
revoke execute on function public.get_room_knowledge_gaps(uuid) from public;

  end if;
end
$do$;


-- =====================================================================
-- Migration: 20250921000014_rename_classes_to_subjects.sql
-- =====================================================================
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


-- =====================================================================
-- Migration: 20261001000000_room_membership_policy.sql
-- =====================================================================
-- ============================================================================
-- Room membership write protection and authenticated lesson-document reads.
--
-- Changes:
--   * Removes direct self-insertion into arbitrary room_members rows.
--   * Leaves membership creation to create_room's creator trigger and
--     join_room_by_code; both are SECURITY DEFINER and run as the table owner.
--   * Restricts documents_select_lesson_members to authenticated users.
--
-- Rollback (intentionally security-preserving):
--   This drops the explicit denial policy but does NOT restore the former
--   arbitrary self-join policy. With no INSERT policy, authenticated direct
--   inserts remain denied. Dropping the lesson-member policy removes that
--   added read path while retaining owner-private document access.
--
--   DROP POLICY IF EXISTS room_members_insert_via_join_flow_only
--     ON public.room_members;
--   DROP POLICY IF EXISTS documents_select_lesson_members
--     ON public.documents;
--
-- SQL Editor test (replace USER_A_UUID and USER_B_UUID with two existing
-- test auth.users UUIDs; this transaction rolls back its test room):
--
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', 'USER_A_UUID', true);
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"USER_A_UUID","role":"authenticated"}', true);
-- DO $test$
-- DECLARE v_room_id uuid; v_invite_code text;
-- BEGIN
--   SELECT r.room_id INTO v_room_id
--   FROM public.create_room('RLS membership test') AS r;
--   SELECT invite_code INTO v_invite_code
--   FROM public.rooms WHERE id = v_room_id;
--   IF NOT EXISTS (
--     SELECT 1 FROM public.room_members
--     WHERE room_id = v_room_id AND user_id = 'USER_A_UUID'::uuid
--   ) THEN RAISE EXCEPTION 'FAIL: creator trigger did not add user A'; END IF;
--
--   PERFORM set_config('request.jwt.claim.sub', 'USER_B_UUID', true);
--   PERFORM set_config('request.jwt.claims',
--     '{"sub":"USER_B_UUID","role":"authenticated"}', true);
--   BEGIN
--     INSERT INTO public.room_members (room_id, user_id)
--     VALUES (v_room_id, auth.uid());
--     RAISE EXCEPTION 'FAIL: direct membership insert was allowed';
--   EXCEPTION WHEN insufficient_privilege THEN NULL;
--   END;
--
--   IF public.join_room_by_code(v_invite_code) IS DISTINCT FROM v_room_id THEN
--     RAISE EXCEPTION 'FAIL: join_room_by_code returned the wrong room';
--   END IF;
--   IF NOT EXISTS (
--     SELECT 1 FROM public.room_members
--     WHERE room_id = v_room_id AND user_id = 'USER_B_UUID'::uuid
--   ) THEN RAISE EXCEPTION 'FAIL: invite-code join did not add user B'; END IF;
-- END;
-- $test$;
-- ROLLBACK;
--
-- For the lesson-document policy, attach a non-owned test document to a
-- lesson in a test room; as authenticated user B run
--   SELECT count(*) FROM public.documents WHERE id = 'TEST_DOCUMENT_UUID';
-- It must be 0 before B joins and 1 after B joins. Inspect the role scope with
--   SELECT policyname, roles, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='documents'
--     AND policyname='documents_select_lesson_members';
-- Expected roles: {authenticated}. Verify no unsafe insert policy remains:
--   SELECT policyname, roles, qual, with_check FROM pg_policies
--   WHERE schemaname='public' AND tablename='room_members' AND cmd='INSERT';
-- Only room_members_insert_via_join_flow_only with a false check should exist.
-- ============================================================================

-- Fail safely if an existing database has drifted from the SECURITY DEFINER
-- insert paths this policy intentionally preserves.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_class t on t.oid = 'public.rooms'::regclass
    where p.oid = 'public.create_room(text)'::regprocedure
      and p.prosecdef
      and p.proowner = t.relowner
  ) then
    raise exception 'create_room must be SECURITY DEFINER owned by the rooms table owner';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_class t on t.oid = 'public.room_members'::regclass
    where p.oid = 'public.handle_new_room()'::regprocedure
      and p.prosecdef
      and p.proowner = t.relowner
  ) then
    raise exception 'handle_new_room must be SECURITY DEFINER owned by the room_members table owner';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.rooms'::regclass
      and t.tgname = 'on_room_created'
      and not t.tgisinternal
      and t.tgfoid = 'public.handle_new_room()'::regprocedure
  ) then
    raise exception 'on_room_created trigger must call handle_new_room';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_class t on t.oid = 'public.room_members'::regclass
    where p.oid = 'public.join_room_by_code(text)'::regprocedure
      and p.prosecdef
      and p.proowner = t.relowner
  ) then
    raise exception 'join_room_by_code must be SECURITY DEFINER owned by the room_members table owner';
  end if;

  if exists (
    select 1 from pg_class
    where oid = 'public.room_members'::regclass and relforcerowsecurity
  ) then
    raise exception 'room_members has FORCE ROW LEVEL SECURITY; SECURITY DEFINER inserts require an explicit reviewed policy';
  end if;
end;
$$;

-- Replace the unsafe policy. The explicit false policy documents the rule;
-- SECURITY DEFINER functions owned by the table owner bypass ordinary RLS.
drop policy if exists room_members_insert_via_join_flow_only
  on public.room_members;
create policy room_members_insert_via_join_flow_only
  on public.room_members
  for insert to authenticated
  with check (false);

drop policy if exists room_members_insert_self on public.room_members;

drop policy if exists documents_select_lesson_members on public.documents;
create policy documents_select_lesson_members on public.documents
  for select to authenticated
  using (
    exists (
      select 1
      from public.lesson_documents ld
      join public.lessons l on l.id = ld.lesson_id
      where ld.document_id = documents.id
        and public.is_room_member(l.room_id)
    )
  );


-- =====================================================================
-- Migration: 20261001000001_ai_usage_daily.sql
-- =====================================================================
-- ============================================================================
-- Daily AI quota accounting for authenticated users.
--
-- Changes:
--   * Adds ai_usage_daily, readable by its owner and not directly writable by
--     client roles.
--   * Adds ai_quota_limits as the single source of truth for per-function caps.
--     Change a cap with UPDATE public.ai_quota_limits; seed conflicts preserve
--     operator edits on migration re-runs.
--   * Adds consume_ai_quota(p_fn, p_max), an atomic SECURITY DEFINER upsert.
--     p_max is an optional stricter cap; it can never raise the configured
--     daily limit. The day boundary is UTC.
--
-- Rollback order:
--   First redeploy the pre-quota versions of all six functions so no live
--   function calls this RPC. Then run:
--
--   DROP FUNCTION IF EXISTS public.consume_ai_quota(text, integer);
--   DROP POLICY IF EXISTS ai_usage_daily_select_own ON public.ai_usage_daily;
--   DROP TABLE IF EXISTS public.ai_usage_daily;
--   DROP TABLE IF EXISTS public.ai_quota_limits;
--
-- SQL Editor test (replace USER_A_UUID and USER_B_UUID with two existing
-- test auth.users UUIDs; all writes below roll back):
--
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claim.sub', 'USER_A_UUID', true);
-- SELECT set_config('request.jwt.claims',
--   '{"sub":"USER_A_UUID","role":"authenticated"}', true);
-- DO $test$
-- DECLARE v_count integer; v_visible integer;
-- BEGIN
--   v_count := public.consume_ai_quota('tutor-chat', 2);
--   IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: first count was %', v_count; END IF;
--   v_count := public.consume_ai_quota('tutor-chat', 2);
--   IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL: second count was %', v_count; END IF;
--   BEGIN
--     PERFORM public.consume_ai_quota('tutor-chat', 2);
--     RAISE EXCEPTION 'FAIL: quota did not reject the third call';
--   EXCEPTION WHEN raise_exception THEN
--     IF SQLERRM <> 'Daily limit reached' THEN RAISE; END IF;
--   END;
--
--   PERFORM set_config('request.jwt.claim.sub', 'USER_B_UUID', true);
--   PERFORM set_config('request.jwt.claims',
--     '{"sub":"USER_B_UUID","role":"authenticated"}', true);
--   SELECT count(*) INTO v_visible FROM public.ai_usage_daily
--   WHERE user_id = 'USER_A_UUID'::uuid;
--   IF v_visible <> 0 THEN RAISE EXCEPTION 'FAIL: user B read user A usage'; END IF;
--   v_count := public.consume_ai_quota('tutor-chat', 2);
--   IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: user B did not get an independent quota'; END IF;
--
--   BEGIN
--     INSERT INTO public.ai_usage_daily (user_id, fn, day, count)
--     VALUES (auth.uid(), 'rag-search', (now() at time zone 'UTC')::date, 999);
--     RAISE EXCEPTION 'FAIL: direct quota INSERT was allowed';
--   EXCEPTION WHEN insufficient_privilege THEN NULL;
--   END;
--   BEGIN
--     UPDATE public.ai_usage_daily SET count = 0 WHERE user_id = auth.uid();
--     RAISE EXCEPTION 'FAIL: direct quota UPDATE was allowed';
--   EXCEPTION WHEN insufficient_privilege THEN NULL;
--   END;
--   BEGIN
--     DELETE FROM public.ai_usage_daily WHERE user_id = auth.uid();
--     RAISE EXCEPTION 'FAIL: direct quota DELETE was allowed';
--   EXCEPTION WHEN insufficient_privilege THEN NULL;
--   END;
-- END;
-- $test$;
-- ROLLBACK;
--
-- Concurrency test: after the rollback above, open two SQL Editor sessions,
-- run this in both at nearly the same time (use the same test user's UUID):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', 'USER_A_UUID', true);
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"USER_A_UUID","role":"authenticated"}', true);
--   SELECT public.consume_ai_quota('rag-search', 1);
--   COMMIT;
-- Exactly one returns 1; the other raises 'Daily limit reached'. Repeat with
-- USER_B_UUID to verify user isolation. With the owner role, inspect the
-- central caps using SELECT fn, daily_limit FROM public.ai_quota_limits ORDER BY fn;
-- ============================================================================

create table if not exists public.ai_quota_limits (
  fn text primary key,
  daily_limit integer not null check (daily_limit > 0)
);

insert into public.ai_quota_limits (fn, daily_limit) values
  ('tutor-chat', 100),
  ('rag-search', 300),
  ('process-document', 20),
  ('generate-roadmap', 10),
  ('generate-study-materials', 30),
  ('suggest-exam-feedback', 30)
on conflict (fn) do nothing;

create table if not exists public.ai_usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  fn text not null references public.ai_quota_limits (fn) on delete cascade,
  day date not null,
  count integer not null check (count >= 0),
  primary key (user_id, fn, day)
);

alter table public.ai_quota_limits enable row level security;
alter table public.ai_usage_daily enable row level security;

revoke all privileges on table public.ai_quota_limits from anon, authenticated;
revoke all privileges on table public.ai_usage_daily from anon, authenticated;
grant select on table public.ai_usage_daily to authenticated;

drop policy if exists ai_usage_daily_select_own on public.ai_usage_daily;
create policy ai_usage_daily_select_own on public.ai_usage_daily
  for select to authenticated
  using (user_id = auth.uid());

create or replace function public.consume_ai_quota(
  p_fn text,
  p_max integer default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_fn text := lower(trim(coalesce(p_fn, '')));
  v_day date := (now() at time zone 'UTC')::date;
  v_configured_limit integer;
  v_effective_limit integer;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_fn = '' then
    raise exception 'AI function name is required' using errcode = '22023';
  end if;
  if p_max is not null and p_max < 1 then
    raise exception 'p_max must be positive when provided' using errcode = '22023';
  end if;

  select daily_limit into v_configured_limit
  from public.ai_quota_limits
  where fn = v_fn;

  if not found then
    raise exception 'AI quota is not configured for this function' using errcode = '22023';
  end if;

  v_effective_limit := case
    when p_max is null then v_configured_limit
    else least(v_configured_limit, p_max)
  end;

  -- One conflict-locked upsert serializes concurrent calls for the same
  -- user/function/day; at the cap, the WHERE clause returns no row.
  insert into public.ai_usage_daily (user_id, fn, day, count)
  values (v_user_id, v_fn, v_day, 1)
  on conflict (user_id, fn, day) do update
    set count = ai_usage_daily.count + 1
    where ai_usage_daily.count < v_effective_limit
  returning count into v_count;

  if not found then
    raise exception 'Daily limit reached' using errcode = 'P0001';
  end if;

  return v_count;
end;
$$;

revoke all privileges on function public.consume_ai_quota(text, integer) from public;
grant execute on function public.consume_ai_quota(text, integer) to authenticated;


-- =====================================================================
-- Migration: 20261001000002_document_summary.sql
-- =====================================================================
-- ============================================================================
-- Document summaries (Phase 4 item 2 — DESIGN approved, NOT applied).
--
-- Changes:
--   * Adds four nullable columns to documents for the AI-generated summary:
--       summary           text      — the stored summary (≤ 2,000 chars)
--       summary_status    text      — 'pending' | 'ready' | 'failed'
--       summary_partial   boolean   — true when the summary was built from an
--                                     even sample of a long document
--       summary_created_at timestamptz
--   * Seeds the ai_quota_limits row for the opt-in backfill-summary edge
--     function (30/day; on conflict preserves operator edits).
--
-- Semantics:
--   summary IS NULL AND status='ready'  => "not summarized yet" (normal state,
--   not an error). summary_status is independent of documents.status so a
--   failed summary can never make a working document look broken.
--
-- MIGRATION ORDER: apply AFTER all Phase 3 migrations — 20250921000001…14,
-- then 20261001000000_room_membership_policy.sql, then
-- 20261001000001_ai_usage_daily.sql (this file's quota seed references
-- ai_quota_limits, created there), then THIS file.
--
-- Rollback:
--   delete from public.ai_quota_limits where fn = 'backfill-summary';
--   alter table public.documents
--     drop column if exists summary_created_at,
--     drop column if exists summary_partial,
--     drop column if exists summary_status,
--     drop column if exists summary;
--
-- SQL Editor test (all roll back):
--   BEGIN;
--   -- 1) columns exist:
--   DO $t$ DECLARE n int; BEGIN
--     SELECT count(*) INTO n FROM information_schema.columns
--     WHERE table_name='documents'
--       AND column_name IN ('summary','summary_status','summary_partial','summary_created_at');
--     IF n <> 4 THEN RAISE EXCEPTION 'FAIL: expected 4 summary columns, got %', n; END IF;
--   END $t$;
--   -- 2) existing rows unaffected:
--   IF EXISTS (SELECT 1 FROM public.documents WHERE summary IS NOT NULL) THEN
--     RAISE EXCEPTION 'FAIL: summary should be NULL everywhere right after migration';
--   END IF;
--   -- 3) check constraint holds:
--   BEGIN
--     UPDATE public.documents SET summary_status='broken' WHERE false;
--     -- (update matches no rows, so this only proves parse; force a real one:)
--     UPDATE public.documents SET summary_status='broken'
--     WHERE id = (SELECT id FROM public.documents LIMIT 1);
--     RAISE EXCEPTION 'FAIL: invalid summary_status was accepted';
--   EXCEPTION WHEN check_violation THEN NULL;
--   END;
--   ROLLBACK;
--   -- (If there are no documents rows yet, insert a scratch row first inside
--   -- the transaction to exercise the check constraint.)
-- ============================================================================

alter table public.documents
  add column if not exists summary text,
  add column if not exists summary_status text
    check (summary_status in ('pending', 'ready', 'failed')),
  add column if not exists summary_partial boolean,
  add column if not exists summary_created_at timestamptz;

insert into public.ai_quota_limits (fn, daily_limit) values
  ('backfill-summary', 30)
on conflict (fn) do nothing;


-- =====================================================================
-- Migration: 20261003000001_admin_role_enum.sql
-- =====================================================================
-- Adds the admin role label. It does not grant admin status to any account.
alter type public.user_role add value if not exists 'admin';

-- Rollback: PostgreSQL cannot remove an enum value directly. To undo this,
-- rebuild public.user_role after demoting/removing all admin-role rows.

/* SQL Editor test (run after all three migrations; paste without these comment delimiters).
begin;
select set_config('edvira.test_student', (select id::text from public.profiles where role = 'student' limit 1), true);
select set_config('edvira.test_educator', (select id::text from public.profiles where role = 'educator' limit 1), true);
select set_config('edvira.test_admin', (select id::text from public.profiles where role = 'admin' limit 1), true);
do $$ begin
  if current_setting('edvira.test_student', true) is null
     or current_setting('edvira.test_educator', true) is null
     or current_setting('edvira.test_admin', true) is null then
    raise exception 'Create student, educator, and admin accounts before running this test';
  end if;
end $$;
update public.profiles
set role = null, role_confirmed_at = null
where id = current_setting('edvira.test_student')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_student'), true);
do $$ begin
  begin
    update public.profiles set role = 'admin', role_confirmed_at = now() where id = auth.uid();
    raise exception 'Self-promotion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'Only an admin or database owner%' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    update public.profiles set role_confirmed_at = now() where id = auth.uid();
    raise exception 'Direct role_confirmed_at update unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'role_confirmed_at is managed%' then raise; end if;
  end;
end $$;
do $$ begin
  if exists (select 1 from public.educator_verifications
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Student can read another user verification row';
  end if;
end $$;
reset role;
update public.profiles
set role = 'admin', role_confirmed_at = now()
where id = current_setting('edvira.test_student')::uuid;
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_student')::uuid and role = 'admin') then
    raise exception 'Database owner could not assign the admin role';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_educator'), true);
do $$ begin
  if not exists (select 1 from public.educator_verifications where user_id = auth.uid()) then
    raise exception 'Educator cannot read their own verification row';
  end if;
end $$;
do $$ begin
  if exists (select 1 from public.educator_verification_reviewers
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Educator can read reviewer identity';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_admin'), true);
update public.educator_verifications
set educator_verification_status = 'rejected', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test rejection'
where user_id = current_setting('edvira.test_educator')::uuid;
update public.educator_verifications
set educator_verification_status = 'verified', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test approval'
where user_id = current_setting('edvira.test_educator')::uuid;
do $$ begin
  if not exists (select 1 from public.educator_verifications
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and educator_verification_status = 'verified') then
    raise exception 'Admin could not verify the educator';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from public.educator_verification_reviewers
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and reviewer_id = auth.uid()) then
    raise exception 'Admin review identity was not recorded';
  end if;
end $$;
rollback;
*/


-- =====================================================================
-- Migration: 20261003000002_admin_role_policies.sql
-- =====================================================================
-- Adds admin detection and admin access to profiles without allowing users
-- to promote themselves or read private educator verification fields.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Rollback (run only after rolling back the educator-verification migration):
--   drop policy if exists profiles_update_admin on public.profiles;
--   drop policy if exists profiles_select_admin on public.profiles;
--   drop function if exists public.is_admin();

/* SQL Editor test (run after all three migrations; paste without these comment delimiters).
begin;
select set_config('edvira.test_student', (select id::text from public.profiles where role = 'student' limit 1), true);
select set_config('edvira.test_educator', (select id::text from public.profiles where role = 'educator' limit 1), true);
select set_config('edvira.test_admin', (select id::text from public.profiles where role = 'admin' limit 1), true);
do $$ begin
  if current_setting('edvira.test_student', true) is null
     or current_setting('edvira.test_educator', true) is null
     or current_setting('edvira.test_admin', true) is null then
    raise exception 'Create student, educator, and admin accounts before running this test';
  end if;
end $$;
update public.profiles
set role = null, role_confirmed_at = null
where id = current_setting('edvira.test_student')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_student'), true);
do $$ begin
  begin
    update public.profiles set role = 'admin', role_confirmed_at = now() where id = auth.uid();
    raise exception 'Self-promotion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'Only an admin or database owner%' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    update public.profiles set role_confirmed_at = now() where id = auth.uid();
    raise exception 'Direct role_confirmed_at update unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'role_confirmed_at is managed%' then raise; end if;
  end;
end $$;
do $$ begin
  if exists (select 1 from public.educator_verifications
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Student can read another user verification row';
  end if;
end $$;
reset role;
update public.profiles
set role = 'admin', role_confirmed_at = now()
where id = current_setting('edvira.test_student')::uuid;
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_student')::uuid and role = 'admin') then
    raise exception 'Database owner could not assign the admin role';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_educator'), true);
do $$ begin
  if not exists (select 1 from public.educator_verifications where user_id = auth.uid()) then
    raise exception 'Educator cannot read their own verification row';
  end if;
end $$;
do $$ begin
  if exists (select 1 from public.educator_verification_reviewers
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Educator can read reviewer identity';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_admin'), true);
update public.educator_verifications
set educator_verification_status = 'rejected', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test rejection'
where user_id = current_setting('edvira.test_educator')::uuid;
update public.educator_verifications
set educator_verification_status = 'verified', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test approval'
where user_id = current_setting('edvira.test_educator')::uuid;
do $$ begin
  if not exists (select 1 from public.educator_verifications
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and educator_verification_status = 'verified') then
    raise exception 'Admin could not verify the educator';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from public.educator_verification_reviewers
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and reviewer_id = auth.uid()) then
    raise exception 'Admin review identity was not recorded';
  end if;
end $$;
rollback;
*/


-- =====================================================================
-- Migration: 20261003000003_educator_verification.sql
-- =====================================================================
-- Stores educator verification data privately, gates educator writes and
-- grading on approval, and restricts admin-role assignment.

create table public.educator_verifications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  educator_verification_status text not null default 'pending'
    check (educator_verification_status in ('pending', 'verified', 'rejected')),
  educator_institution text,
  educator_work_email text,
  educator_evidence_path text,
  educator_submitted_at timestamptz,
  educator_reviewed_at timestamptz,
  educator_review_note text
);

alter table public.educator_verifications enable row level security;
revoke all on public.educator_verifications from public, anon, authenticated, service_role;
grant select (
  user_id, educator_verification_status, educator_institution, educator_work_email,
  educator_evidence_path, educator_submitted_at, educator_reviewed_at, educator_review_note
) on public.educator_verifications to authenticated;
grant update (
  educator_verification_status, educator_reviewed_at, educator_review_note
) on public.educator_verifications to authenticated;

create policy educator_verifications_select_owner on public.educator_verifications
  for select to authenticated using (user_id = auth.uid());
create policy educator_verifications_select_admin on public.educator_verifications
  for select to authenticated using (public.is_admin());
create policy educator_verifications_update_admin on public.educator_verifications
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table public.educator_verification_reviewers (
  user_id uuid primary key references public.educator_verifications(user_id) on delete cascade,
  reviewer_id uuid references public.profiles(id) on delete set null
);
alter table public.educator_verification_reviewers enable row level security;
revoke all on public.educator_verification_reviewers from public, anon, authenticated, service_role;
grant select on public.educator_verification_reviewers to authenticated;
create policy educator_verification_reviewers_select_admin on public.educator_verification_reviewers
  for select to authenticated using (public.is_admin());

create or replace function public.record_educator_verification_reviewer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.educator_verification_status in ('verified', 'rejected')
     and new.educator_verification_status is distinct from old.educator_verification_status then
    insert into public.educator_verification_reviewers (user_id, reviewer_id)
    values (new.user_id, auth.uid())
    on conflict (user_id) do update set reviewer_id = excluded.reviewer_id;
  end if;
  return new;
end;
$$;

revoke all on function public.record_educator_verification_reviewer() from public, anon, authenticated, service_role;

create trigger educator_verifications_record_reviewer
  after update of educator_verification_status on public.educator_verifications
  for each row execute function public.record_educator_verification_reviewer();

create or replace function public.initialize_educator_verification_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.role = 'educator' then
    insert into public.educator_verifications (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.initialize_educator_verification_status() from public, anon, authenticated, service_role;

drop trigger if exists profiles_educator_verification_insert on public.profiles;
create trigger profiles_educator_verification_insert
  after insert on public.profiles
  for each row execute function public.initialize_educator_verification_status();
drop trigger if exists profiles_educator_verification_role on public.profiles;
create trigger profiles_educator_verification_role
  after update of role on public.profiles
  for each row execute function public.initialize_educator_verification_status();

insert into public.educator_verifications (user_id)
select id from public.profiles where role = 'educator'
on conflict (user_id) do nothing;

-- Signup metadata is untrusted: only student and educator are accepted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role public.user_role;
begin
  v_role := case new.raw_user_meta_data ->> 'role'
    when 'student' then 'student'::public.user_role
    when 'educator' then 'educator'::public.user_role
    else null
  end;

  insert into public.profiles (id, role, role_confirmed_at, display_name, avatar_color)
  values (
    new.id,
    v_role,
    case when v_role is not null then now() end,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    public.avatar_palette_index(new.id)
  )
  on conflict (id) do nothing;

  insert into public.gamification (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

create or replace function public.guard_profile_admin_role()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.role = 'admin'
     and current_user not in ('postgres', 'service_role')
     and not public.is_admin() then
    raise exception 'Only an admin or database owner can assign the admin role';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_admin_role on public.profiles;
create trigger guard_profile_admin_role
  before insert or update of role on public.profiles
  for each row execute function public.guard_profile_admin_role();

-- The database owner and service role may bootstrap or repair roles. All other
-- callers retain the original one-time role lock.
create or replace function public.enforce_role_lock()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated')
       or current_user not in (
         select pg_catalog.pg_get_userbyid(proowner)
         from pg_catalog.pg_proc
         where oid in (
           'public.handle_new_user()'::regprocedure,
           'public.finalize_role(public.user_role)'::regprocedure
         )
       ) then
      raise exception 'Profile role inserts are restricted to trusted signup/finalization functions';
    end if;
    return new;
  end if;

  if new.role_confirmed_at is distinct from old.role_confirmed_at
     and new.role is not distinct from old.role then
    raise exception 'role_confirmed_at is managed by role finalization';
  end if;

  if new.role = 'admin'
     and new.role_confirmed_at is not null
     and public.is_admin() then
    return new;
  end if;

  if old.role is null
     and new.role in ('student', 'educator')
     and (current_user in ('anon', 'authenticated') or current_user <> (
       select pg_catalog.pg_get_userbyid(proowner)
       from pg_catalog.pg_proc
       where oid = 'public.finalize_role(public.user_role)'::regprocedure
     )) then
    raise exception 'Role must be assigned by finalize_role';
  end if;

  if new.role is not null and new.role_confirmed_at is null then
    raise exception 'Role change requires explicit confirmation (role_confirmed_at)';
  end if;

  if tg_op = 'UPDATE' and old.role is not null and new.role is distinct from old.role then
    raise exception 'Role is permanently locked after signup';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_role_lock on public.profiles;
create trigger enforce_role_lock
  before insert or update on public.profiles
  for each row execute function public.enforce_role_lock();

create or replace function public.is_verified_educator()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.educator_verifications v on v.user_id = p.id
    where p.id = auth.uid()
      and p.role = 'educator'
      and v.educator_verification_status = 'verified'
  );
$$;

revoke all on function public.is_verified_educator() from public, anon;
grant execute on function public.is_verified_educator() to authenticated;

create or replace function public.guard_educator_verification_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_user in ('postgres', 'service_role') or auth.uid() is null then
    return new;
  end if;
  if current_user = pg_get_userbyid((
    select proowner
    from pg_catalog.pg_proc
    where oid = 'public.submit_educator_verification(text,text,text,text,text)'::regprocedure
  )) then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  if new.educator_verification_status is distinct from old.educator_verification_status
     and new.educator_verification_status is distinct from 'pending' then
    raise exception 'Only an admin can approve or reject educator verification';
  end if;

  if new.educator_reviewed_at is distinct from old.educator_reviewed_at
     or new.educator_review_note is distinct from old.educator_review_note then
    raise exception 'Only an admin can update educator review details';
  end if;

  if old.educator_verification_status = 'verified'
     and (new.educator_verification_status is distinct from old.educator_verification_status
       or new.educator_institution is distinct from old.educator_institution
       or new.educator_work_email is distinct from old.educator_work_email
       or new.educator_evidence_path is distinct from old.educator_evidence_path
       or new.educator_submitted_at is distinct from old.educator_submitted_at) then
    raise exception 'Verified educator details cannot be changed';
  end if;

  return new;
end;
$$;

create trigger educator_verifications_guard_update
  before update on public.educator_verifications
  for each row execute function public.guard_educator_verification_fields();

create or replace function public.submit_educator_verification(
  p_display_name text,
  p_subject_area text,
  p_institution text,
  p_work_email text,
  p_evidence_path text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles p
    left join public.educator_verifications v on v.user_id = p.id
    where p.id = caller_id and p.role = 'educator'
      and coalesce(v.educator_verification_status, 'pending') <> 'verified'
  ) then
    raise exception 'This account cannot submit educator verification';
  end if;

  if length(trim(coalesce(p_display_name, ''))) not between 1 and 60
     or length(trim(coalesce(p_subject_area, ''))) not between 1 and 80
     or length(trim(coalesce(p_institution, ''))) not between 2 and 160
     or length(trim(coalesce(p_work_email, ''))) not between 5 and 254
     or p_work_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Complete all educator verification fields with valid values';
  end if;

  if p_evidence_path is null
     or split_part(p_evidence_path, '/', 1) <> caller_id::text
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'educator-verification' and name = p_evidence_path
     ) then
    raise exception 'Upload your supporting evidence before submitting';
  end if;

  update public.profiles
  set display_name = trim(p_display_name), subject_area = trim(p_subject_area)
  where id = caller_id;

  insert into public.educator_verifications (
    user_id, educator_institution, educator_work_email, educator_evidence_path,
    educator_submitted_at, educator_verification_status, educator_reviewed_at, educator_review_note
  ) values (
    caller_id, trim(p_institution), lower(trim(p_work_email)), p_evidence_path,
    now(), 'pending', null, null
  )
  on conflict (user_id) do update set
    educator_institution = excluded.educator_institution,
    educator_work_email = excluded.educator_work_email,
    educator_evidence_path = excluded.educator_evidence_path,
    educator_submitted_at = excluded.educator_submitted_at,
    educator_verification_status = 'pending',
    educator_reviewed_at = null,
    educator_review_note = null;
end;
$$;

revoke all on function public.submit_educator_verification(text, text, text, text, text) from public, anon;
grant execute on function public.submit_educator_verification(text, text, text, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('educator-verification', 'educator-verification', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists educator_evidence_select_owner_or_admin on storage.objects;
create policy educator_evidence_select_owner_or_admin on storage.objects
  for select to authenticated using (
    bucket_id = 'educator-verification'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
drop policy if exists educator_evidence_insert_owner on storage.objects;
create policy educator_evidence_insert_owner on storage.objects
  for insert to authenticated with check (
    bucket_id = 'educator-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists educator_evidence_update_owner on storage.objects;
create policy educator_evidence_update_owner on storage.objects
  for update to authenticated
  using (bucket_id = 'educator-verification' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'educator-verification' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists educator_evidence_delete_owner on storage.objects;
create policy educator_evidence_delete_owner on storage.objects
  for delete to authenticated using (
    bucket_id = 'educator-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.enforce_verified_educator_room()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.creator_role = 'educator' and not exists (
    select 1
    from public.profiles p
    join public.educator_verifications v on v.user_id = p.id
    where p.id = new.created_by and p.role = 'educator'
      and v.educator_verification_status = 'verified'
  ) then
    raise exception 'Educator verification is required to create teacher rooms';
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_require_verified_educator on public.rooms;
drop trigger if exists rooms_require_verified_educator_insert on public.rooms;
create trigger rooms_require_verified_educator_insert
  before insert on public.rooms
  for each row execute function public.enforce_verified_educator_room();
drop trigger if exists rooms_require_verified_educator_update on public.rooms;
create trigger rooms_require_verified_educator_update
  before update of creator_role, created_by on public.rooms
  for each row execute function public.enforce_verified_educator_room();

drop policy if exists rooms_insert_own on public.rooms;
create policy rooms_insert_own on public.rooms
  for insert to authenticated with check (
    created_by = auth.uid()
    and creator_role = (select role from public.profiles where id = auth.uid())
    and (creator_role <> 'educator' or public.is_verified_educator())
  );
drop policy if exists rooms_update_creator on public.rooms;
create policy rooms_update_creator on public.rooms
  for update to authenticated
  using (created_by = auth.uid() and (creator_role <> 'educator' or public.is_verified_educator()))
  with check (created_by = auth.uid() and (creator_role <> 'educator' or public.is_verified_educator()));
drop policy if exists rooms_delete_creator on public.rooms;
create policy rooms_delete_creator on public.rooms
  for delete to authenticated using (
    created_by = auth.uid() and (creator_role <> 'educator' or public.is_verified_educator())
  );

drop policy if exists lessons_insert_creator on public.lessons;
create policy lessons_insert_creator on public.lessons
  for insert to authenticated with check (
    public.is_room_creator(room_id) and created_by = auth.uid() and public.is_verified_educator()
  );
drop policy if exists lessons_update_creator on public.lessons;
create policy lessons_update_creator on public.lessons
  for update to authenticated
  using (created_by = auth.uid() and public.is_verified_educator() and public.is_room_creator(room_id))
  with check (created_by = auth.uid() and public.is_verified_educator() and public.is_room_creator(room_id));
drop policy if exists lessons_delete_creator on public.lessons;
create policy lessons_delete_creator on public.lessons
  for delete to authenticated using (created_by = auth.uid() and public.is_verified_educator());

drop policy if exists lesson_documents_write_creator on public.lesson_documents;
create policy lesson_documents_write_creator on public.lesson_documents
  for insert to authenticated with check (
    public.is_verified_educator()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.created_by = auth.uid())
  );
drop policy if exists lesson_documents_delete_creator on public.lesson_documents;
create policy lesson_documents_delete_creator on public.lesson_documents
  for delete to authenticated using (
    public.is_verified_educator()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.created_by = auth.uid())
  );

drop policy if exists exams_insert_creator on public.exams;
create policy exams_insert_creator on public.exams
  for insert to authenticated with check (
    public.is_room_creator(room_id) and created_by = auth.uid() and public.is_verified_educator()
  );
drop policy if exists exams_update_creator on public.exams;
create policy exams_update_creator on public.exams
  for update to authenticated
  using (created_by = auth.uid() and public.is_verified_educator() and public.is_room_creator(room_id))
  with check (created_by = auth.uid() and public.is_verified_educator() and public.is_room_creator(room_id));
drop policy if exists exams_delete_creator on public.exams;
create policy exams_delete_creator on public.exams
  for delete to authenticated using (created_by = auth.uid() and public.is_verified_educator());

drop policy if exists exam_questions_creator_all on public.exam_questions;
create policy exam_questions_creator_all on public.exam_questions
  for all to authenticated
  using (public.is_verified_educator() and exists (
    select 1 from public.exams e where e.id = exam_id and e.created_by = auth.uid()
  ))
  with check (public.is_verified_educator() and exists (
    select 1 from public.exams e where e.id = exam_id and e.created_by = auth.uid()
  ));

drop policy if exists exam_attempts_select_examiner on public.exam_attempts;
create policy exam_attempts_select_examiner on public.exam_attempts
  for select to authenticated using (
    public.is_verified_educator()
    and exists (select 1 from public.exams e where e.id = exam_id and e.created_by = auth.uid())
  );
drop policy if exists exam_attempts_update_examiner on public.exam_attempts;
create policy exam_attempts_update_examiner on public.exam_attempts
  for update to authenticated
  using (public.is_verified_educator() and exists (
    select 1 from public.exams e where e.id = exam_id and e.created_by = auth.uid()
  ))
  with check (public.is_verified_educator() and exists (
    select 1 from public.exams e where e.id = exam_id and e.created_by = auth.uid()
  ));
drop policy if exists exam_answers_select_examiner on public.exam_answers;
create policy exam_answers_select_examiner on public.exam_answers
  for select to authenticated using (
    public.is_verified_educator() and exists (
      select 1 from public.exam_attempts a
      join public.exams e on e.id = a.exam_id
      where a.id = attempt_id and e.created_by = auth.uid()
    )
  );

-- This preserves the earlier grading function body; verification is the only
-- added check. The maximum-grade validation is unchanged.
create or replace function public.finalize_exam_grade(
  p_attempt_id uuid,
  p_grade int,
  p_feedback text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_max int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_verified_educator() then
    raise exception 'Educator verification is required to grade exams';
  end if;
  if p_grade is null or p_grade < 0 then
    raise exception 'Grade must be a non-negative number';
  end if;

  select e.id, coalesce(sum(q.points), 0)
  into v_exam, v_max
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.exam_questions q on q.exam_id = e.id
  where a.id = p_attempt_id
    and e.created_by = auth.uid()
  group by e.id;

  if v_exam is null then
    raise exception 'Attempt not found';
  end if;
  if p_grade > v_max then
    raise exception 'Grade cannot exceed the exam maximum (%)', v_max;
  end if;

  update public.exam_attempts
  set final_grade = p_grade,
      final_feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      graded_at = now()
  where id = p_attempt_id;
end;
$$;

do $$
declare
  grading_owner name;
begin
  select r.rolname into grading_owner
  from pg_catalog.pg_proc f
  join pg_catalog.pg_roles r on r.oid = f.proowner
  where f.oid = 'public.finalize_exam_grade(uuid,integer,text)'::regprocedure;
  execute format(
    'grant execute on function public.is_verified_educator() to %I',
    grading_owner
  );
end $$;

-- Rollback: this removes verification data and restores the earlier signup,
-- grading, room and write-policy definitions. Export any needed verification
-- records first; restore the old function/policy bodies from migrations
-- 20250921000002, 20250921000012 and 20250921000013 before dropping the table.
-- Existing SELECT policies on rooms, lessons, exams, lesson_documents,
-- exam_attempts and exam_answers are deliberately not dropped here.
-- Also drop educator_verifications_record_reviewer, record_educator_verification_reviewer(),
-- educator_verification_reviewers and educator_verifications during rollback.

/* SQL Editor test (run after all three migrations; uses existing role accounts).
begin;
select set_config('edvira.test_student', (select id::text from public.profiles where role = 'student' limit 1), true);
select set_config('edvira.test_educator', (select id::text from public.profiles where role = 'educator' limit 1), true);
select set_config('edvira.test_admin', (select id::text from public.profiles where role = 'admin' limit 1), true);
do $$ begin
  if current_setting('edvira.test_student', true) is null
     or current_setting('edvira.test_educator', true) is null
     or current_setting('edvira.test_admin', true) is null then
    raise exception 'Create student, educator, and admin accounts before running this test';
  end if;
end $$;
update public.profiles
set role = null, role_confirmed_at = null
where id = current_setting('edvira.test_student')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_student'), true);
-- profiles_update_own and its WITH CHECK admit this own-row update; the
-- expected error must therefore come from guard_profile_admin_role().
do $$ begin
  begin
    update public.profiles set role = 'admin', role_confirmed_at = now() where id = auth.uid();
    raise exception 'Self-promotion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'Only an admin or database owner%' then raise; end if;
  end;
end $$;
select public.finalize_role('student'::public.user_role);
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'student' and role_confirmed_at is not null) then
    raise exception 'finalize_role could not complete NULL-to-student selection';
  end if;
end $$;
do $$ begin
  begin
    update public.profiles set role_confirmed_at = now() + interval '1 second' where id = auth.uid();
    raise exception 'Direct role_confirmed_at update unexpectedly succeeded';
  exception when others then
    if sqlerrm not like 'role_confirmed_at is managed%' then raise; end if;
  end;
end $$;
do $$ begin
  if exists (select 1 from public.educator_verifications
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Student can read another user verification row';
  end if;
end $$;
reset role;
update public.profiles
set role = 'admin', role_confirmed_at = now()
where id = current_setting('edvira.test_student')::uuid;
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_student')::uuid and role = 'admin') then
    raise exception 'Database owner could not assign the admin role';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_educator'), true);
do $$ begin
  if not exists (select 1 from public.educator_verifications where user_id = auth.uid()) then
    raise exception 'Educator cannot read their own verification row';
  end if;
end $$;
do $$
declare
  changed_rows integer;
begin
  update public.educator_verifications
  set educator_verification_status = case
    when educator_verification_status = 'verified' then 'rejected'
    else 'verified'
  end
  where user_id = auth.uid();
  get diagnostics changed_rows = row_count;
  if changed_rows <> 0 then
    raise exception 'Educator changed admin review status';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_admin'), true);
update public.educator_verifications
set educator_verification_status = 'rejected', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test rejection'
where user_id = current_setting('edvira.test_educator')::uuid;
update public.educator_verifications
set educator_verification_status = 'verified', educator_reviewed_at = now(),
    educator_review_note = 'SQL Editor test approval'
where user_id = current_setting('edvira.test_educator')::uuid;
do $$ begin
  if not exists (select 1 from public.educator_verifications
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and educator_verification_status = 'verified') then
    raise exception 'Admin could not verify the educator';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from public.educator_verification_reviewers
                 where user_id = current_setting('edvira.test_educator')::uuid
                   and reviewer_id = auth.uid()) then
    raise exception 'Admin review identity was not recorded';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_educator'), true);
do $$ begin
  if exists (select 1 from public.educator_verification_reviewers
             where user_id = current_setting('edvira.test_educator')::uuid) then
    raise exception 'Educator can read reviewer identity';
  end if;
end $$;
select set_config('request.jwt.claim.sub', current_setting('edvira.test_admin'), true);
update public.profiles
set role = 'admin', role_confirmed_at = coalesce(role_confirmed_at, now())
where id = current_setting('edvira.test_educator')::uuid;
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_educator')::uuid and role = 'admin')
     or not exists (select 1 from public.educator_verifications
                    where user_id = current_setting('edvira.test_educator')::uuid
                      and educator_verification_status = 'verified')
     or not exists (select 1 from public.educator_verification_reviewers
                    where user_id = current_setting('edvira.test_educator')::uuid
                      and reviewer_id = current_setting('edvira.test_admin')::uuid) then
    raise exception 'Admin promotion did not preserve educator verification history';
  end if;
end $$;
reset role;
update public.profiles
set role = 'student', role_confirmed_at = now()
where id = current_setting('edvira.test_student')::uuid;
update public.profiles
set role = 'educator', role_confirmed_at = now()
where id = current_setting('edvira.test_educator')::uuid;
do $$ begin
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_student')::uuid and role = 'student') then
    raise exception 'Test student role was not restored before rollback';
  end if;
  if not exists (select 1 from public.profiles
                 where id = current_setting('edvira.test_educator')::uuid and role = 'educator') then
    raise exception 'Test educator role was not restored before rollback';
  end if;
end $$;
rollback;
*/


