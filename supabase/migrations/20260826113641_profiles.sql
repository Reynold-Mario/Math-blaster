-- Profiles, and the profile-to-profile access edges.
--
-- `profiles.id` is OUR uuid. It is never `auth.users.id`, and nothing in this
-- schema has a foreign key to `auth.users` - with third-party JWTs there is no
-- `auth.users` row to reference at all. That is the invariant that makes the
-- identity provider swappable later without a data migration.
--
-- There are no name, email or date-of-birth columns, and adding one is a
-- decision that needs the minors question answered first (ROADMAP.md, "Open
-- questions for Varsity Tutors"). Absence here is the enforcement.

-- gen_random_uuid() is core Postgres from 13 onward, so this needs no
-- extension and no schema qualification - it resolves out of pg_catalog even
-- under `search_path = ''`.
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  -- Mirrors GRADE_ORDER in games/math-blaster/src/lib/levels/gradeTree.ts.
  -- `resolveGrade()` validates against the same list on the way in; this is
  -- the database refusing to hold a grade the game could not run.
  grade_level  text not null default 'K'
               check (grade_level in ('K','1','2','3','4','5','6','7','8','9','10','11','12')),
  -- 'self' = the player picked it in the grade picker. 'platform' = it came
  -- from an identity provider that already knew. The distinction decides
  -- whether the picker may overwrite it.
  grade_source text not null default 'self' check (grade_source in ('self','platform')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Ships empty. It costs nothing now and saves rewriting every read policy in
-- the schema on the day a tutor or parent needs access - `can_read_profile()`
-- consults it from the start, so that day is a data change, not a migration.
create table public.guardianships (
  guardian_profile_id uuid not null references public.profiles(id) on delete cascade,
  ward_profile_id     uuid not null references public.profiles(id) on delete cascade,
  relationship        text not null default 'guardian'
                      check (relationship in ('guardian','tutor')),
  granted_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  primary key (guardian_profile_id, ward_profile_id),
  constraint guardianship_is_not_self check (guardian_profile_id <> ward_profile_id)
);

create index guardianships_ward_idx on public.guardianships (ward_profile_id)
  where revoked_at is null;

create function public.tg_touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.tg_touch_updated_at();
