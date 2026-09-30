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
