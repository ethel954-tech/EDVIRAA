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
