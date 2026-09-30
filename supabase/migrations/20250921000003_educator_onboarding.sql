-- ============================================================================
-- Educator onboarding: subject area on profiles (Task 5)
--
-- Spec section 4: "Educator onboarding: role -> profile setup (name,
-- subject area) -> educator dashboard empty state prompting room creation".
--
-- display_name already exists; subject_area is new. It stays NULL until the
-- educator completes onboarding at /onboarding/educator (students leave it
-- NULL forever). Free text by design — educators describe their subject
-- area in their own words; no fixed taxonomy is imposed.
-- ============================================================================

alter table public.profiles
  add column if not exists subject_area text;

-- Convenience for the educator dashboard: "Dr. Chen — Mathematics".
create or replace function public.profile_label()
returns text
language sql stable
as $$
  select case
    when subject_area is not null and subject_area <> ''
    then display_name || ' — ' || subject_area
    else display_name
  end
  from public.profiles
  where id = auth.uid();
$$;
