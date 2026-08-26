-- The identity indirection, and the two functions every policy is built on.
--
-- An auth subject is a MUTABLE POINTER at a profile. Swapping Supabase auth
-- for VT third-party JWTs or a token-exchange Edge Function is one row per
-- user in this table and zero policy edits.

create table public.profile_identities (
  -- 'supabase' today; 'vt' when a real identity provider arrives. Part of the
  -- key so the same subject string from two providers cannot collide.
  provider   text not null default 'supabase',
  subject    text not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index profile_identities_profile_idx on public.profile_identities (profile_id);

-- Who is asking, as OUR profile id.
--
-- SECURITY DEFINER because `profile_identities` is deny-all: RLS is enabled on
-- it with zero policies, so no client can read it and only functions like this
-- one can resolve an identity. `search_path = ''` is not optional - without it
-- the caller controls name resolution and a helper becomes an escalation path.
--
-- Returns null for an unauthenticated caller, which makes every policy that
-- calls it fail closed rather than erroring.
create function public.current_profile_id() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.profile_id
    from public.profile_identities i
   where i.provider = 'supabase'
     and i.subject  = (select auth.uid())::text;
$$;

-- May the caller read this profile's data?
--
-- EVERY read policy in this schema routes through this, including the ones
-- that only check self-ownership. That is the whole point: "add tutor access"
-- becomes an edit to this function instead of a rewrite of eight tables'
-- policies.
--
-- Always call it as `(select public.can_read_profile(x))`, never bare. The
-- subquery form lets Postgres hoist it into an InitPlan and evaluate it once
-- per query instead of once per row.
create function public.can_read_profile(target uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null
     and (
       target = (select public.current_profile_id())
       or exists (
         select 1
           from public.guardianships g
          where g.ward_profile_id     = target
            and g.guardian_profile_id = (select public.current_profile_id())
            and g.revoked_at is null
       )
     );
$$;

-- A caller may only ever WRITE its own rows. Guardians read; they do not play
-- on someone else's behalf, and conflating the two would let a write policy
-- inherit read's future looseness by accident.
create function public.owns_profile(target uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target is not null and target = (select public.current_profile_id());
$$;
