-- Achievements: ids and unlocks only.
--
-- Name, description, icon and the unlock RULE all live in the game's code.
-- They are what a copy edit or a balance tweak touches, and putting them in
-- Postgres turns each one into a migration and a deploy. The database stores
-- what only it can: that this profile unlocked this key, once, at this time.

create table public.achievements (
  key       text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Null means cross-game: "practised 5 topics" is not math-blaster's to own.
  game_slug text references public.games(slug),
  -- The one piece of state that earns a column. Retiring an achievement that
  -- turns out to be broken or unreachable must not need a client release.
  enabled   boolean not null default true
);

create table public.profile_achievements (
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null references public.achievements(key),
  unlocked_at     timestamptz not null default now(),
  -- For the incremental ones - those that accumulate rather than fire once.
  -- Rises only. NO EXAMPLE ON PURPOSE: what may count toward an achievement
  -- is an open decision (ROADMAP.md PR 3), and boss outcomes and topic
  -- completion are both already ruled out. A comment naming a criterion is
  -- how an undecided one starts getting treated as settled.
  progress        int not null default 0 check (progress >= 0),
  primary key (profile_id, achievement_key)
);

-- FIRST UNLOCK WINS. An achievement records when something first happened, so
-- a replayed offline write, a re-derivation after a client update, or a merge
-- from a second device must never move the date forward.
create function public.tg_achievement_first_unlock_wins() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.unlocked_at := least(old.unlocked_at, coalesce(new.unlocked_at, old.unlocked_at));
  new.progress    := greatest(old.progress, coalesce(new.progress, old.progress));
  return new;
end;
$$;

create trigger profile_achievements_first_unlock_wins
  before update on public.profile_achievements
  for each row execute function public.tg_achievement_first_unlock_wins();
