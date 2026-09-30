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
