-- Per-game state, run sessions, and the currency counters.

-- Ids and an on/off switch. ALL copy - title, blurb, thumbnail - lives in the
-- code manifest, because a DB-backed name turns a wording fix into a migration
-- and a deploy.
create table public.games (
  slug       text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

-- A JSONB blob per game, not typed tables. The client profile is already a
-- validated blob with a documented versioning rule; the boot read is a single
-- primary-key lookup where typed tables would make the hottest path a wide
-- join; and game #2 needs no DDL at all.
--
-- The escalation trigger is a QUERY, not a size. Promote a field to a
-- generated column, then to a real column, and only give it its own table
-- when two independent writers touch it. `furthest` is the one field that has
-- already earned promotion.
create table public.game_progress (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  game_slug     text not null references public.games(slug),
  state         jsonb not null default '{}'::jsonb,
  -- Mirrors ProgressionCodec.stateVersion. The client owns migration of the
  -- blob's shape; this records which shape is in there.
  state_version int   not null default 1,
  -- Optimistic concurrency. A client updates `where revision = <what it read>`
  -- and re-merges on zero rows affected. The trigger below bumps it, so the
  -- client never sets it.
  revision      bigint not null default 1,
  -- Promoted out of the blob because it gates where a run may START, so it is
  -- the one value a client merge bug must not be able to lose.
  furthest      int not null default 1 check (furthest >= 1),
  updated_at    timestamptz not null default now(),
  primary key (profile_id, game_slug)
);

-- The load-bearing trick. The database enforces monotonicity independently of
-- whatever the client's merge believes, so a merge bug degrades to "lost some
-- currency" and never to "lost a record".
create function public.tg_game_progress_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.furthest   := greatest(old.furthest, coalesce(new.furthest, old.furthest));
  new.revision   := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger game_progress_guard
  before update on public.game_progress
  for each row execute function public.tg_game_progress_guard();

-- One row per run. `idempotency_key` is what makes replaying an offline queue
-- exact rather than doubling a run.
--
-- Note what is NOT here: no hp, no damage, no health. Nothing in this game has
-- any, and a schema is a good place for that invariant to stay true.
create table public.game_sessions (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  game_slug       text not null references public.games(slug),
  idempotency_key text not null,
  grade_level     text not null,
  -- The number that means something in an endless run.
  wave_reached    int not null check (wave_reached >= 1),
  score           int not null default 0 check (score >= 0),
  -- Defeated, not escaped. Outlasting a boss is not killing it.
  bosses_defeated int not null default 0 check (bosses_defeated >= 0),
  duration_ms     int not null default 0 check (duration_ms >= 0),
  created_at      timestamptz not null default now(),
  unique (profile_id, idempotency_key)
);

create index game_sessions_profile_recent_idx
  on public.game_sessions (profile_id, created_at desc);

-- Two MONOTONE counters, not a mutable balance. A balance that can be set is a
-- balance a bug can silently rewrite; two counters that only ever rise make
-- every write an increment and the balance a consequence.
--
-- Currency is client-authoritative on purpose (see ROADMAP.md) - these
-- constraints do the cheap 80% without reimplementing baseSkillTree.ts's cost
-- and installment logic in PL/pgSQL.
create table public.currency_balances (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  earned     bigint not null default 0 check (earned >= 0),
  spent      bigint not null default 0 check (spent  >= 0),
  balance    bigint generated always as (earned - spent) stored,
  updated_at timestamptz not null default now(),
  constraint currency_spent_within_earned check (spent <= earned)
);

create function public.tg_currency_monotone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.earned     := greatest(old.earned, coalesce(new.earned, old.earned));
  new.spent      := greatest(old.spent,  coalesce(new.spent,  old.spent));
  new.updated_at := now();
  return new;
end;
$$;

create trigger currency_balances_monotone
  before update on public.currency_balances
  for each row execute function public.tg_currency_monotone();
