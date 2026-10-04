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