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
