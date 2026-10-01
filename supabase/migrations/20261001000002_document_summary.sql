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
