-- Seed data, deliberately NOT a migration: these are rows a copy edit or a
-- balance tweak will touch, and neither should be a schema change.
--
-- Only ids and an enabled flag live here. Every achievement's name,
-- description, icon and unlock rule lives in the game's own code - see
-- lib/progression/achievements.ts.

insert into public.games (slug) values ('math-blaster')
  on conflict (slug) do nothing;

insert into public.achievements (key, game_slug) values
  -- Waves. The number that means something in an endless run.
  ('first-blood',        'math-blaster'),
  ('wave-10',            'math-blaster'),
  ('wave-25',            'math-blaster'),
  ('wave-50',            'math-blaster'),
  -- Bosses. DEFEATED, never escaped - `boss-defeated` fires on both routes and
  -- only `by = 'mastery'` counts. Outlasting a boss pays nothing, and an
  -- achievement is a payment.
  ('boss-slayer',        'math-blaster'),
  ('boss-slayer-5',      'math-blaster'),
  ('flawless-finish',    'math-blaster'),
  -- Answering well, in the units the game actually runs on.
  ('exact-streak-10',    'math-blaster'),
  ('clean-sweep',        'math-blaster'),
  ('shield-breaker-25',  'math-blaster'),
  -- Cross-game: mastery is not keyed by game, so neither are these.
  ('topic-explorer-5',    null),
  ('topic-explorer-15',   null)
on conflict (key) do nothing;
