-- ============================================================================
-- RAG retrieval: class-scoped pgvector similarity search (Task 7)
--
-- Given a query embedding and a class, return the top-k most similar
-- document chunks belonging to that class's documents. SECURITY DEFINER so
-- the ownership check (document -> student) can't recurse through the
-- document_chunks RLS policies; ownership is still enforced row-by-row by
-- checking student_id = auth.uid(), so a user can never retrieve another
-- student's chunks.
--
-- The embedding dimension must match document_chunks.embedding (vector(1024)
-- for Qwen text-embedding-v3; see 20250921000000_init_schema.sql).
-- ============================================================================

-- Guard: this SQL-language function body references documents.class_id,
-- which migration 14 renames to subject_id (and recreates this function
-- under the new name). Skip on post-rename re-runs so the combined file
-- stays idempotent.
do $do$
begin
  if to_regclass('public.documents') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'class_id'
  ) then

create or replace function public.search_document_chunks(
  p_query_embedding extensions.vector(1024),
  p_class_id uuid,
  p_match_count int default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  chunk_index int,
  content text,
  similarity float
)
language sql stable security definer
set search_path = public, extensions
as $$
  select
    dc.id as chunk_id,
    dc.document_id,
    d.title as document_title,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> p_query_embedding) as similarity
  from public.document_chunks dc
  join public.documents d on d.id = dc.document_id
  where d.student_id = auth.uid()
    and d.class_id = p_class_id
    and d.status = 'ready'
    and dc.embedding is not null
  order by dc.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

  end if;
end
$do$;
