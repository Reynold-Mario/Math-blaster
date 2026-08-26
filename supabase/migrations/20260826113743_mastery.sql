-- What the player can actually do, independent of where they did it.
--
-- NOT KEYED BY GAME, and that is the entire point. A second game teaching
-- addition should read the same mastery a player built in the first one; the
-- moment a `game_slug` appears in this key, that stops being possible.

create table public.skill_mastery (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  -- The internal topic id from Curriculum.id. Stable, ours, and the join key.
  topic_id      text not null,
  -- The CCSS code, when the curriculum has one. Optional and always will be:
  -- a topic without a standard is still a topic, and a run must never depend
  -- on the mapping existing.
  standard_code text,
  attempts      bigint not null default 0 check (attempts >= 0),
  correct       bigint not null default 0 check (correct  >= 0),
  last_seen_at  timestamptz not null default now(),
  primary key (profile_id, topic_id),
  constraint skill_mastery_correct_within_attempts check (correct <= attempts)
);

create index skill_mastery_standard_idx on public.skill_mastery (standard_code)
  where standard_code is not null;

-- Both counters only rise, for the same reason the currency ones do.
create function public.tg_mastery_monotone() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.attempts     := greatest(old.attempts, coalesce(new.attempts, old.attempts));
  new.correct      := greatest(old.correct,  coalesce(new.correct,  old.correct));
  new.last_seen_at := now();
  return new;
end;
$$;

create trigger skill_mastery_monotone
  before update on public.skill_mastery
  for each row execute function public.tg_mastery_monotone();
