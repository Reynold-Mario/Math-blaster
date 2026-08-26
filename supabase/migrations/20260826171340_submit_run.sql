-- submit_run(): a finished run lands in ONE idempotent write, or not at all.
--
-- The sole writer of `game_sessions`, `skill_mastery` and `profile_achievements`.
-- Clients hold read-only policies on all three, so this function is the only
-- door - which is what makes "a partial run never lands" enforceable rather
-- than merely intended.
--
-- THE SESSION INSERT IS THE IDEMPOTENCY GATE, and the ordering is the whole
-- design. `game_sessions` is unique on (profile_id, idempotency_key), so a
-- replayed submission conflicts, inserts nothing, and returns before touching
-- mastery or achievements. That is what makes replaying an offline queue exact
-- rather than doubling a child's practice record. Do not move the mastery write
-- above it, and do not "helpfully" upsert the session row.
--
-- It does NOT re-derive achievements. It cannot: the rules live in the client,
-- the same posture as client-authoritative currency, and it carries the same
-- revisit trigger. What it does enforce is what the database can enforce
-- cheaply and without reimplementing baseSkillTree.ts in PL/pgSQL:
-- `correct <= attempts`, first-unlock-wins, and the monotone counters.
--
-- CLAMPS RATHER THAN REJECTS on a bad payload. A `correct` above `attempts`
-- would violate the CHECK constraint and abort the transaction, costing the
-- player the whole run over a client arithmetic bug. Losing a little signal is
-- the better failure: the run still lands, and the tally stays internally
-- consistent.
create function public.submit_run(
  p_game_slug       text,
  p_idempotency_key text,
  p_grade_level     text,
  p_wave_reached    int,
  p_score           int     default 0,
  p_bosses_defeated int     default 0,
  p_duration_ms     int     default 0,
  -- [{ "topic_id": "...", "standard_code": "..."|null, "attempts": n, "correct": n }]
  p_mastery         jsonb   default '[]'::jsonb,
  p_achievements    text[]  default '{}'
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_session_id uuid;
begin
  v_profile_id := (select public.current_profile_id());
  if v_profile_id is null then
    -- Loud, not null: this is an explicit write path, so an unauthenticated
    -- caller is a client bug rather than an ordinary state to absorb.
    raise exception 'submit_run() requires an authenticated caller'
      using errcode = '28000';
  end if;

  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'submit_run() requires an idempotency key'
      using errcode = '22023';
  end if;

  insert into public.game_sessions (
    profile_id, game_slug, idempotency_key, grade_level,
    wave_reached, score, bosses_defeated, duration_ms
  )
  values (
    v_profile_id, p_game_slug, p_idempotency_key, p_grade_level,
    greatest(coalesce(p_wave_reached, 1), 1),
    greatest(coalesce(p_score, 0), 0),
    greatest(coalesce(p_bosses_defeated, 0), 0),
    greatest(coalesce(p_duration_ms, 0), 0)
  )
  on conflict (profile_id, idempotency_key) do nothing
  returning id into v_session_id;

  if v_session_id is null then
    -- Already applied. Return the existing id and touch NOTHING else.
    select s.id into v_session_id
      from public.game_sessions s
     where s.profile_id = v_profile_id
       and s.idempotency_key = p_idempotency_key;
    return v_session_id;
  end if;

  -- Mastery accumulates. The table's trigger only takes `greatest`, so adding
  -- has to happen here: writing the delta raw would leave the counter stuck at
  -- the largest single run instead of a lifetime total.
  --
  -- Aggregated by topic first. A payload naming the same topic twice would
  -- otherwise fail with "ON CONFLICT DO UPDATE cannot affect row a second
  -- time" and take the whole run down with it.
  insert into public.skill_mastery as sm (profile_id, topic_id, standard_code, attempts, correct)
  select v_profile_id,
         d.topic_id,
         min(d.standard_code),
         sum(d.attempts),
         least(sum(d.correct), sum(d.attempts))
    from (
      select nullif(e->>'topic_id', '')                              as topic_id,
             nullif(e->>'standard_code', '')                         as standard_code,
             greatest(coalesce((e->>'attempts')::bigint, 0), 0)      as attempts,
             greatest(coalesce((e->>'correct')::bigint, 0), 0)       as correct
        from jsonb_array_elements(coalesce(p_mastery, '[]'::jsonb)) as e
    ) d
   where d.topic_id is not null
   group by d.topic_id
  on conflict (profile_id, topic_id) do update
    set attempts = sm.attempts + excluded.attempts,
        correct  = sm.correct  + excluded.correct,
        -- A topic can gain a standard code later; it must never lose one.
        standard_code = coalesce(excluded.standard_code, sm.standard_code);

  -- Achievements. The `profile_achievements` trigger owns first-unlock-wins, so
  -- a re-submission cannot move `unlocked_at` forward. Unknown or retired keys
  -- are dropped rather than erroring - retiring a broken achievement must not
  -- start failing every run that still remembers it.
  insert into public.profile_achievements (profile_id, achievement_key)
  select v_profile_id, k
    from unnest(coalesce(p_achievements, '{}')) as k
   where exists (
     select 1 from public.achievements a where a.key = k and a.enabled
   )
  on conflict (profile_id, achievement_key) do nothing;

  return v_session_id;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, and anon inherits it
-- from there - the hole 20260826114032 exists to close. Revoke explicitly
-- rather than trusting the default privileges to match.
revoke all on function public.submit_run(text, text, text, int, int, int, int, jsonb, text[]) from public;
grant execute on function public.submit_run(text, text, text, int, int, int, int, jsonb, text[]) to authenticated;
