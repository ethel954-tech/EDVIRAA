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