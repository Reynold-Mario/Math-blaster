-- RLS and grants, last, and in that order.
--
-- The publishable key ships inside the JS bundle. Anyone can read it out of
-- devtools and open a client against this database, so RLS and these grants
-- are not one layer of defence among several - they are the only layer.
--
-- Two rules that are easy to get wrong and expensive to get wrong quietly:
--   1. Revoke the blanket grants FIRST. Supabase's default privileges hand
--      anon and authenticated access to every new table in `public`, so a
--      table added later is exposed by default rather than protected by it.
--   2. Always `(select public.can_read_profile(x))`, never a bare call. The
--      subquery form lets Postgres hoist it into an InitPlan and evaluate it
--      once per query instead of once per row.

-- 1. Take everything away, including from tables that do not exist yet.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- `anon` is granted nothing anywhere in this file. There is no unauthenticated
-- surface: the prototype signs in, and anonymous sessions were rejected.

-- 2. Enable RLS everywhere, without exception.
alter table public.profiles             enable row level security;
alter table public.profile_identities   enable row level security;
alter table public.guardianships        enable row level security;
alter table public.games                enable row level security;
alter table public.game_progress        enable row level security;
alter table public.game_sessions        enable row level security;
alter table public.currency_balances    enable row level security;
alter table public.skill_mastery        enable row level security;
alter table public.achievements         enable row level security;
alter table public.profile_achievements enable row level security;
alter table public.leaderboard_entries  enable row level security;

-- profile_identities gets RLS AND NO POLICIES. Deny-all: the only things that
-- may resolve an identity are the SECURITY DEFINER functions. Do not add a
-- policy here, however convenient it looks.

-- 3. The helper functions the policies are built from.
grant execute on function public.current_profile_id()        to authenticated;
grant execute on function public.can_read_profile(uuid)      to authenticated;
grant execute on function public.owns_profile(uuid)          to authenticated;

-- 4. Policies.

-- profiles: read through can_read_profile even though the check is currently
-- just self-ownership. That indirection is the point - adding tutor access
-- later edits one function instead of eleven policies.
create policy profiles_read on public.profiles
  for select to authenticated
  using ((select public.can_read_profile(id)));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select public.owns_profile(id)))
  with check ((select public.owns_profile(id)));

-- No insert policy. Profiles are created by `ensure_profile()`, a SECURITY
-- DEFINER function, so that creating a profile and creating its identity
-- mapping cannot come apart.

create policy guardianships_read on public.guardianships
  for select to authenticated
  using (
    (select public.owns_profile(guardian_profile_id))
    or (select public.owns_profile(ward_profile_id))
  );

-- games / achievements: the enabled-id catalogues. No profile involved.
create policy games_read_enabled on public.games
  for select to authenticated using (enabled);

create policy achievements_read_enabled on public.achievements
  for select to authenticated using (enabled);

-- game_progress and currency_balances are the client-authoritative pair: the
-- client writes them directly, and the CHECK constraints plus the monotone
-- triggers do the cheap 80% without duplicating baseSkillTree.ts in PL/pgSQL.
create policy game_progress_read on public.game_progress
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

create policy game_progress_insert_own on public.game_progress
  for insert to authenticated
  with check ((select public.owns_profile(profile_id)));

create policy game_progress_update_own on public.game_progress
  for update to authenticated
  using ((select public.owns_profile(profile_id)))
  with check ((select public.owns_profile(profile_id)));

create policy currency_read on public.currency_balances
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

create policy currency_insert_own on public.currency_balances
  for insert to authenticated
  with check ((select public.owns_profile(profile_id)));

create policy currency_update_own on public.currency_balances
  for update to authenticated
  using ((select public.owns_profile(profile_id)))
  with check ((select public.owns_profile(profile_id)));

-- Read-only for clients. `submit_run()` (a SECURITY DEFINER RPC, arriving in
-- its own PR) is the sole writer of all four, so that one idempotent call
-- lands a whole run or none of it.
create policy sessions_read on public.game_sessions
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

create policy mastery_read on public.skill_mastery
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

create policy profile_achievements_read on public.profile_achievements
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

-- A player sees their OWN board entry and nobody else's. This is deliberately
-- narrower than a leaderboard needs to be: a public board is blocked on
-- whether these users are minors, and until that is answered the database - not
-- a forgotten `if` in a component - is what stops another player's row being
-- rendered. Widening this policy IS the public-leaderboard change.
create policy leaderboard_read_own on public.leaderboard_entries
  for select to authenticated
  using ((select public.can_read_profile(profile_id)));

-- 5. Grants, matched to the policies above and no wider.
--
-- UPDATE is granted per COLUMN rather than per table. A policy controls which
-- ROWS a caller may touch; only a column grant controls which FIELDS. Without
-- these, a client passing the row-ownership check could still rewrite its own
-- `profile_id` or hand-set `revision` to defeat the concurrency check.
grant select on public.profiles             to authenticated;
grant select on public.guardianships        to authenticated;
grant select on public.games                to authenticated;
grant select on public.achievements         to authenticated;
grant select on public.game_sessions        to authenticated;
grant select on public.skill_mastery        to authenticated;
grant select on public.profile_achievements to authenticated;
grant select on public.leaderboard_entries  to authenticated;

grant update (grade_level, grade_source) on public.profiles to authenticated;

-- `revision` is absent on purpose: the trigger owns it, and the client's only
-- legitimate use for it is in a WHERE clause, which needs SELECT and not UPDATE.
grant select, insert                              on public.game_progress to authenticated;
grant update (state, state_version, furthest)     on public.game_progress to authenticated;

-- `balance` is generated and cannot be written at all; naming the two counters
-- explicitly says so at the grant rather than at the error.
grant select, insert          on public.currency_balances to authenticated;
grant update (earned, spent)  on public.currency_balances to authenticated;

-- profile_identities: no grant, no policy, no access. That is the design.
