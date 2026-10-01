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
