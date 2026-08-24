# Pixel Math Blaster

A pixel-art arcade math shooter for kids — line up, type the answer, fire.
Built to feel like a genuine arcade game first, with the math practice
built directly into the mechanics rather than bolted on as quiz screens
between "real" gameplay.

## What this is

You pilot a ship along the bottom of the screen while formations of enemies
carrying math problems descend toward you (or, during a boss fight, a boss
drifts overhead firing problems of its own). Your horizontal position *is*
your aim — line up under a target, type the number you think is the answer,
and fire.

The game grades answers on a spectrum, not just right/wrong:

| Verdict | What it means | What happens |
|---|---|---|
| **Exact** | Correct, as written | Answers the enemy's problem outright — it's gone |
| **Equivalent** | Correct, different form (e.g. a fraction equal to the target) | Same as exact |
| **Close** | Numerically near | Shoves the enemy back up the screen, buying you time; chance of a reinforcement enemy |
| **Partial** | Some digits right (by place value) | A smaller shove, scaled to how much matched, shown with the matched digits highlighted |
| **Incorrect** | Wrong | Nothing happens, no direct penalty — but repeated misses eventually call in a reinforcement |
| **Invalid** | Unparseable input | No effect either way |

Nothing in the game has health. An enemy is a stack of problems, and only a
fully correct answer clears one. A close answer can never accumulate into a
kill — what it buys is *time*, which is the only resource a run actually
spends.

Nothing about answering wrong costs you anything *directly*. The pressure
comes from the clock and from enemies that reach the bottom, not from
punishing a bad guess — the goal is to keep trying feeling safe, while
still making genuine mastery matter for how well a run goes.

## Design philosophy

- **Non-punitive mistakes, real consequences.** Wrong answers don't cost
  time or score by themselves; the *situation* (more enemies on screen, the
  clock running down) is where the pressure comes from.
- **Partial credit is informative, not just forgiving.** A "partial" hit
  shows exactly which digits of the correct answer you already had right.
- **Accuracy gates progression; speed feeds score.** Clearing a level
  requires actually answering enough problems correctly — there's no way
  to out-speed the math. Score rewards doing that quickly, but never at
  the expense of the underlying accuracy requirement.
- **The math is real curriculum**, not arbitrary difficulty scaling — level
  content maps to specific K-3 arithmetic standards, and boss fights are
  built to review everything learned *so far* rather than testing brand
  new material at the worst possible moment.
- **Incremental-style meta-progression.** You earn currency from every
  defeated enemy and spend it between runs on permanent upgrades — the
  loop is meant to reward repeated play, not just a single sitting.
- **Nothing has health.** Not the player, not the bosses, not the enemies.
  What makes one enemy harder than another is how it moves, how many
  problems it takes, and whether it will accept anything less than an
  exact answer — never a number being ground down.

## Core gameplay loop

1. **Line up.** Drag, tap the ◀▶ buttons, or use arrow keys to move under
   a descending enemy or the boss.
2. **Type and fire.** Type your answer on the keypad and hit FIRE.
3. **Read the wave.** Enemies arrive as formations, not a random trickle,
   and each kind behaves differently — see below.
4. **Survive the clock.** You have 30 seconds (plus any skill bonuses) —
   not lives. Letting an enemy reach the bottom costs a chunk of that
   time, unless Dodge fully avoids it or Armor softens it.
5. **Clear the level.** Defeat enough enemies to trigger that world's
   boss — a rapid-fire fight drawing on everything the level (and every
   level before it) has taught, ending in a climactic authored finale
   problem.
6. **Bank currency, spend it.** Between runs, the skill tree shop is where
   currency earned from kills becomes permanent upgrades — for the *next*
   run, not the current one.

## Enemies

Every enemy is an *archetype* — a distinct set of behaviours, not a
recoloured sprite:

| Enemy | Behaviour |
|---|---|
| **Drifter** | Falls straight down its lane. The baseline. |
| **Weaver** | Sine-weaves across lanes, so you have to lead it. |
| **Diver** | Hangs back near the top, then commits and accelerates hard. |
| **Bulwark** | Takes two problems, not one — a fresh question appears when you break its first layer. |
| **Sentinel** | Two layers *behind a shield*. Only an exact answer strips the shield, and that costs the whole shot. |
| **Splitter** | Breaks into two fast-weaving spores when destroyed. The debris doesn't count toward clearing the level. |

Enemies descend far slower than the difficulty numbers alone would
suggest — with this much to read on screen, time to think is the thing
that makes the variety playable rather than chaotic. A single global
brake (`GLOBAL_FALL_SPEED_MULTIPLIER`) scales every enemy's descent, so
overall pacing can be tuned in one place without disturbing the relative
difficulty between levels.

## Boss fights

Bosses have no health bar either. A fight ends one of two ways:

- **Outlast it.** Survive the fight's timer and the boss goes down.
  Every correct answer shortens that timer, so close and partial answers
  still make real progress toward the win.
- **Master it.** Land a run of consecutive *exact* answers — five to
  seven depending on the boss — and the fight ends immediately. Anything
  less than exact resets the run to zero. This is the one place in the
  game that asks for mastery rather than effort, and it pays accordingly.

Fights move through **phases** as their timer drains, each with its own
drift speed, reinforcements, and shield behaviour. Past the opening
phase a boss periodically raises a **shield**: its body becomes immune,
and the only way through is a **weak point** that appears off-centre and
moves every time the shield goes up. Hitting it takes tighter positioning
*and* an exact answer, and it takes the biggest chunk off the clock in
the game. For the last stretch the shield drops for good, reinforcements
go berserk, and the authored finale problem appears.

## World / level structure

| World | Grade | Levels | Curriculum | Boss |
|---|---|---|---|---|
| 1 · Sprout Garden | K | Sprout Sums | +/− within 5 | — |
| 2 · Sunny Meadow | 1 | Meadow Muddle, Cave Carry | +/− within 10, then 10–20 (regrouping) | Sum Slime King |
| 3 · Golden Fields | 2 | Century Count, Grouping Grove | +/− within 100, ×2–3 foundations | Hundred Hydra |
| 4 · Whispering Forest | 3 | Forest Factors, Sky Division | ×2–5, then ×÷6–10 | The Math Overlord |

A full run currently plays straight through all four worlds in order —
grade *selection* (picking just one grade's worth of content for a
session) is designed for but not wired up yet; see Current Status.

## Progression systems

**Base Skill Tree** — combat/economy upgrades, purchased with currency
between runs: Economy (Bounty, More Time), Movement (Player Speed, Enemy
Slowdown), Defense (Dodge, Armor), Firing (Piercing Shots,
Burn, Firing Speed), and two unlockable Active Abilities (Freeze, Bomb).
Multi-level skills render as a chain of nodes in the shop — the next
level only becomes visible once the previous one is bought, and a node
gated behind another skill (like Armor needing Dodge) stays invisible
until that prerequisite is met.

**Grade Tree** — a separate, curriculum-unlock tree (not a combat one):
topics unlock progressively within a selected grade, gated by mastery
rather than currency. Currently authored for grades K–3, structured to
extend to K–12 without any engine changes.

## Current status

**Fully playable:** the entire loop above — movement/targeting, all six
answer verdicts, all six enemy archetypes, wave-based spawning, timer-based
survival with Dodge/Armor, currency and the Base skill tree shop, all four
worlds and three phased boss fights with both win conditions.

**Built but not yet wired into the session flow:**
- Grade selection — the data and unlock logic exist (`gradeTree.ts`); a
  session always plays the full K–3 sequence rather than a chosen grade.
- Grades 4–5 content — would need fraction/decimal problem *generation*
  (the answer evaluator already supports fractions/decimals; the problem
  generator only produces integers so far).
- Gamepad input — the input system is built to support it cleanly
  whenever it's added, but no gamepad code exists yet.

**Not yet tuned:** skill costs, knockback distances, fall speeds, wave gaps, the
30-second timer, the 5-second impact penalty, and every boss's survive
duration and combo requirement are all reasonable placeholders, not numbers
validated by real play.

**Worth knowing:** the 30-second clock covers the *whole run*, not each
stage. Reach a boss with less time left than its survive duration and
outlasting it is arithmetically impossible — the combo becomes your only
way out. That's deliberate, but it's the first thing to revisit if runs
feel unfair rather than tight.

## Tech stack

Svelte 5 (runes) + TypeScript + Vite. Gameplay renders on `<canvas>`;
Svelte handles menus, HUD, and the skill tree shop. See `CLAUDE.md` for
the full architectural breakdown.

## Running it

```
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

`npm run build` produces a production bundle; `npm run check` runs the
full type-check (svelte-check + tsc).