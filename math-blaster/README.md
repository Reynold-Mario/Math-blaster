# Pixel Math Blaster

A pixel-art arcade math shooter for kids — line up, type the answer, fire.
Built to feel like a genuine arcade game first, with the math practice
built directly into the mechanics rather than bolted on as quiz screens
between "real" gameplay.

## What this is

You pilot a ship along the bottom of the screen while enemies carrying math
problems fall toward you (or, during a boss fight, a boss drifts overhead
firing problems of its own). Your horizontal position *is* your aim — line
up under a target, type the number you think is the answer, and fire.

The game grades answers on a spectrum, not just right/wrong:

| Verdict | What it means | What happens |
|---|---|---|
| **Exact** | Correct, as written | Big damage |
| **Equivalent** | Correct, different form (e.g. a fraction equal to the target) | Same as exact |
| **Close** | Numerically near | Partial damage, chance of a reinforcement enemy |
| **Partial** | Some digits right (by place value) | Damage scaled to how much matched, shown with the matched digits highlighted |
| **Incorrect** | Wrong | No damage, no direct penalty — but repeated misses eventually call in a reinforcement |
| **Invalid** | Unparseable input | No effect either way |

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

## Core gameplay loop

1. **Line up.** Drag, tap the ◀▶ buttons, or use arrow keys to move under
   a falling enemy or the boss.
2. **Type and fire.** Type your answer on the keypad and hit FIRE.
3. **Survive the clock.** You have 30 seconds (plus any skill bonuses) —
   not lives. Letting an enemy reach the bottom costs a chunk of that
   time, unless Dodge fully avoids it or Armor softens it.
4. **Clear the level.** Defeat enough enemies to trigger that world's
   boss — a rapid-fire fight drawing on everything the level (and every
   level before it) has taught, ending in a climactic authored finale
   problem.
5. **Bank currency, spend it.** Between runs, the skill tree shop is where
   currency earned from kills becomes permanent upgrades — for the *next*
   run, not the current one.

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
Slowdown), Defense (Health Pool, Dodge, Armor), Firing (Piercing Shots,
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
answer verdicts, timer-based survival with Dodge/Armor, currency and the
Base skill tree shop, all four worlds and three boss fights.

**Built but not yet wired into the session flow:**
- Grade selection — the data and unlock logic exist (`gradeTree.ts`); a
  session always plays the full K–3 sequence rather than a chosen grade.
- Grades 4–5 content — would need fraction/decimal problem *generation*
  (the answer evaluator already supports fractions/decimals; the problem
  generator only produces integers so far).
- Gamepad input — the input system is built to support it cleanly
  whenever it's added, but no gamepad code exists yet.

**Not yet tuned:** skill costs, damage numbers, fall speeds, the 30-second
timer, and the 5-second impact penalty are all reasonable placeholders,
not numbers validated by real play.

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