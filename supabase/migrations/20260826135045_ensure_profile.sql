-- ensure_profile(): the only thing that ever writes profile_identities.
--
-- `profiles` has RLS with a read and an update policy and NO INSERT POLICY, and
-- `profile_identities` has RLS with no policies at all. That is deliberate: a
-- profile and its identity mapping must be created together or not at all, so
-- no client is allowed to create either one. This function is the single door.
--
-- Called once after sign-in. Idempotent - a second call for the same auth
-- subject returns the existing profile id rather than minting a second profile,
-- which matters because the client calls it on every boot, not only on the
-- first one.
--
-- SECURITY DEFINER, so it runs as the owner and bypasses the policies above.
-- `search_path = ''` is not optional: without it the caller controls name
-- resolution and a definer function becomes an escalation path. Same reasoning
-- as current_profile_id() in 20260826113701_identity.sql.
--
-- It takes NO ARGUMENTS, and specifically not a grade. `profiles.grade_level`
-- defaults to 'K' with `grade_source = 'self'`, and the game's grade picker
-- updates it through `profiles_update_own`. Accepting a grade here would let a
-- client assert one at creation time, ahead of any platform that actually knows
-- it - and `grade_source` exists precisely to keep those two apart.

create function public.ensure_profile() returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Matches current_profile_id()'s lookup exactly. If these two ever disagree
  -- about what identifies a caller, a player gets a second profile.
  subject_id text := (select auth.uid())::text;
  pid        uuid;
  inserted   int;
begin
  -- Fail closed and LOUDLY. current_profile_id() returns null for an
  -- anonymous caller because a policy needs to fail closed silently, but this
  -- is a write path called explicitly: a client that reaches it unauthenticated
  -- has a bug, and returning null would hand it a null profile id to carry
  -- around instead of telling it.
  if subject_id is null then
    raise exception 'ensure_profile() requires an authenticated caller'
      using errcode = '28000';
  end if;

  select i.profile_id into pid
    from public.profile_identities i
   where i.provider = 'supabase'
     and i.subject  = subject_id;

  if pid is not null then
    return pid;
  end if;

  insert into public.profiles default values returning id into pid;

  -- THE RACE IS REAL: two tabs signing in at once both miss the select above.
  -- The primary key on (provider, subject) is what actually decides it; this
  -- just has to lose gracefully.
  insert into public.profile_identities (provider, subject, profile_id)
  values ('supabase', subject_id, pid)
  on conflict (provider, subject) do nothing;

  get diagnostics inserted = row_count;

  if inserted = 0 then
    -- The other session won. Drop the profile this one just made, or it is an
    -- orphan no identity points at and nothing will ever clean it up, then
    -- return the winner's. Deleting is safe because it is one statement old and
    -- unreachable: nothing references it yet.
    delete from public.profiles where id = pid;

    select i.profile_id into pid
      from public.profile_identities i
     where i.provider = 'supabase'
       and i.subject  = subject_id;
  end if;

  return pid;
end;
$$;

-- Postgres grants EXECUTE on every new function to the PUBLIC pseudo-role, and
-- `anon` inherits from there - the hole 20260826114032 exists to close. The
-- `alter default privileges` in that migration should already cover this
-- function, but only for objects created by the role that ran it, so revoke
-- explicitly rather than trusting that they match.
revoke all on function public.ensure_profile() from public;
grant execute on function public.ensure_profile() to authenticated;
