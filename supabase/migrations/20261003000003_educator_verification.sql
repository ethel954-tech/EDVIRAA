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