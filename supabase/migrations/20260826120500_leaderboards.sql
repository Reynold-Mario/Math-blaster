-- Highscore boards.
--
-- EVERY BOARD IS GRADE-SCOPED, and the check constraint below is what enforces
-- it. A global board is incoherent in this game rather than merely unfair: the
-- difficulty of the maths is the player's grade and not the wave number, so a
-- grade-3 player and a kindergartener who both reach wave 20 did not do the
-- same thing. Making that a constraint means an unscoped board is a failed
-- insert instead of a plausible-looking bug.
--
-- Two boards, because the game has two numbers and they mean different things.
-- `furthest_wave` is the one the end-of-run screen reports and the one that
-- gates where a future run may start. `score` is the arcade number, and a
-- board is somewhere for a strong player's surplus to go now that the run
-- clock's ceiling absorbs it.

create table public.leaderboard_entries (
  game_slug   text not null references public.games(slug),
  board_key   text not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  value       bigint not null check (value >= 0),
  -- An ARCADE HANDLE, generated and never typed. The format check is the rule:
  -- free text from children is a moderation problem this project has no reason
  -- to acquire, and a real name is something we have already committed to not
  -- storing. Null until a board is actually rendered to anyone.
  handle      text check (handle ~ '^[a-z]+-[a-z]+-[0-9]{2,4}$'),
  achieved_at timestamptz not null default now(),
  primary key (game_slug, board_key, profile_id),
  constraint leaderboard_board_key_is_grade_scoped
    check (board_key ~ '^(furthest_wave|score):(k|[1-9]|1[0-2])$')
);

create index leaderboard_board_rank_idx
  on public.leaderboard_entries (game_slug, board_key, value desc);

-- A submission may only ever raise an entry. The client upserts unconditionally
-- and the database decides whether it was a record - which means a stale offline
-- write replayed a week later cannot lower a standing best.
create function public.tg_leaderboard_high_water() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.value, old.value) <= old.value then
    -- Not a record. Keep everything as it was, including the date.
    return old;
  end if;
  new.achieved_at := now();
  return new;
end;
$$;

create trigger leaderboard_entries_high_water
  before update on public.leaderboard_entries
  for each row execute function public.tg_leaderboard_high_water();
