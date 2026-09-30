-- ============================================================================
-- Grading & analytics (Task 16)
--
--   * exam_attempts.final_grade / final_feedback / graded_at
--       The educator's finalized grade + feedback per attempt. AI feedback
--       (suggested by the suggest-exam-feedback edge function) is only a
--       SUGGESTION — it lives client-side until the educator accepts/edits
--       and finalizes, so nothing model-generated is ever persisted without
--       a human decision.
--   * finalize_exam_grade(attempt, grade, feedback)
--       Creator-only RPC; clamps the grade to the exam's max points.
--   * get_room_knowledge_gaps(room)
--       Aggregates error_journal_entries (via quiz → document → class) and
--       wrong exam answers (via exam → room) across ALL students in the
--       room, ranked by struggle rate. Rows are coarse topic labels (first
--       8 words of the question), never raw student data — the educator
--       sees what the group struggles with, not who struggled.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Grading columns
-- ----------------------------------------------------------------------------
alter table public.exam_attempts
  add column if not exists final_grade int,
  add column if not exists final_feedback text,
  add column if not exists graded_at timestamptz;

-- The educator's final grade/feedback is their private grading data; both
-- parties can read it (student sees their finalized grade).
drop policy if exists "exam_attempts_update_examiner" on public.exam_attempts;
create policy "exam_attempts_update_examiner" on public.exam_attempts
  for update using (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- finalize_exam_grade: the educator commits a grade (+ feedback) for one
-- student attempt. Grade is clamped to [0, exam max points].
-- ----------------------------------------------------------------------------
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

revoke execute on function public.finalize_exam_grade(uuid, int, text) from anon;
revoke execute on function public.finalize_exam_grade(uuid, int, text) from public;

-- ----------------------------------------------------------------------------
-- get_room_knowledge_gaps: which topics is the GROUP struggling with?
-- Combines two signals across every room member:
--   * error_journal_entries — quiz misses, joined to the room through
--     quiz -> document -> class (documents.class_id == classes.id)
--   * exam_answers with is_correct = false — joined through exam -> room
-- Struggle rate = wrong events / attempts; ranked worst first. Only
-- aggregates (labels + counts) are returned — never per-student rows.
--
-- Guard: this SQL-language body references documents.class_id, which
-- migration 14 renames (recreating the function under the new names).
-- Skip on post-rename re-runs so the combined file stays idempotent.
-- ----------------------------------------------------------------------------
do $do$
begin
  if to_regclass('public.documents') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'class_id'
  ) then

create or replace function public.get_room_knowledge_gaps(p_room_id uuid)
returns table (
  topic text,
  struggles int,
  attempts int,
  source text
)
language sql
security definer
set search_path = public
as $$
  -- Guard: caller must belong to the room (educators are members/creators).
  with caller_ok as (
    select 1
    where public.is_room_member(p_room_id)
  ),
  quiz_gaps as (
    select
      left(regexp_replace(trim(j.question), '\s+', ' ', 'g'), 60) as topic,
      count(*)::int as struggles,
      count(*)::int as attempts,
      'quiz' as source
    from public.error_journal_entries j
    join public.quizzes qz on qz.id = j.quiz_id
    join public.documents d on d.id = qz.document_id
    join public.classes c on c.id = d.class_id
    join public.room_members rm on rm.user_id = c.student_id
    where rm.room_id = p_room_id
    group by 1
  ),
  exam_gaps as (
    select
      left(regexp_replace(trim(q.prompt), '\s+', ' ', 'g'), 60) as topic,
      count(*) filter (where not a.is_correct)::int as struggles,
      count(*)::int as attempts,
      'exam' as source
    from public.exam_answers a
    join public.exam_questions q on q.id = a.question_id
    join public.exams e on e.id = q.exam_id
    where e.room_id = p_room_id
    group by 1
  )
  select g.topic, g.struggles, g.attempts, g.source
  from caller_ok
  cross join (
    select topic, struggles, attempts, source from quiz_gaps
    union all
    select topic, struggles, attempts, source from exam_gaps
  ) g
  where g.attempts >= 1
  order by g.struggles desc, g.attempts asc
  limit 20;
$$;

revoke execute on function public.get_room_knowledge_gaps(uuid) from anon;
revoke execute on function public.get_room_knowledge_gaps(uuid) from public;

  end if;
end
$do$;
