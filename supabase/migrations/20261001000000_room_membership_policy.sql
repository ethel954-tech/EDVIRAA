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
