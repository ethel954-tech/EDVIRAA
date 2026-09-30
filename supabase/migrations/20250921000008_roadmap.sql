-- ============================================================================
-- Roadmap & modules (Task 10)
--
-- modules + topics already exist (20250921000000_init_schema.sql); the
-- roadmap is generated per class by the `generate-roadmap` edge function,
-- which has Qwen split the class's document structure into an ordered
-- learning path and stores it here.
--
-- This migration adds topic completion tracking and the server-side toggle
-- that keeps modules.status truthful:
--   all topics complete  -> 'complete'
--   some topics complete -> 'in_progress'
--   none complete        -> 'locked'
-- (the generator seeds the first module as 'in_progress' so the student
-- always has a visible starting point).
-- ============================================================================

alter table public.topics add column if not exists completed_at timestamptz;

-- ----------------------------------------------------------------------------
-- Toggle a topic's completion and recompute its module's status atomically.
-- SECURITY DEFINER so the whole chain (topic -> module -> class -> student)
-- is checked in one place; the explicit student_id check below keeps it
-- owner-only.
-- ----------------------------------------------------------------------------
-- Migration 11 later replaces this function with an XP+badge version
-- (return changes void -> table). Drop first so re-runs after 11 don't fail
-- with 42P13 (cannot change return type of existing function).
drop function if exists public.toggle_topic_completion(uuid, boolean);

create or replace function public.toggle_topic_completion(
  p_topic_id uuid,
  p_completed boolean
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_total int;
  v_done int;
begin
  if p_completed is null then
    raise exception 'p_completed is required';
  end if;

  select m.id into v_module_id
  from public.topics t
  join public.modules m on m.id = t.module_id
  join public.classes c on c.id = m.class_id
  where t.id = p_topic_id
    and c.student_id = auth.uid();

  if v_module_id is null then
    raise exception 'Topic not found';
  end if;

  update public.topics
  set completed_at = case when p_completed then now() else null end
  where id = p_topic_id;

  select
    count(*),
    count(*) filter (where completed_at is not null)
  into v_total, v_done
  from public.topics
  where module_id = v_module_id;

  update public.modules
  set status = case
    when v_total = 0 then status  -- empty module: nothing to derive from
    when v_done = v_total then 'complete'::public.module_status
    when v_done > 0 then 'in_progress'::public.module_status
    else 'locked'::public.module_status
  end
  where id = v_module_id;
end;
$$;
