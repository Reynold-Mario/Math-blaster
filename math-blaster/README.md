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
4. **Clear the wave, earn the clock back.** The run has a clock, not lives.
   It drains constantly, and letting an enemy reach the bottom costs a
   chunk of it (unless Dodge fully avoids it or Armor softens it) — but
   clearing a wave pays time back, more of it the more you actually
   defeated. A run lasts as long as you keep answering.
5. **Face a boss every fifth wave.** A rapid-fire fight drawing on
   everything your grade and the ones below it have taught, ending in a
   climactic authored finale problem. Beat it and you're straight into the
   next wave.
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

## Run structure

There are no worlds, stages or levels. A run is one continuous, endless
sequence of numbered waves, and there is nothing to interrupt it — no
"stage clear" screen, no continue button, no win screen. It ends when the
clock does.

A wave is announced, arrives all at once as a formation, and the next one
only starts when the board is empty. **Every fifth wave is a boss.**
Formations, fall speeds, and how many enemies can be on screen all escalate
with the wave number, and keep escalating past the authored material so a
long run never plateaus.

**The maths, though, comes from the player's grade — not the wave number.**

| Grade | Curriculum a run walks up |
|---|---|
| K | +/− within 5 |
| 1 | +/− within 10, then 10–20 (regrouping) |
| 2 | +/− within 100, then ×2–3 foundations |
| 3 | ×2–5, then ×÷6–10 |

A run holds at the hardest thing its grade teaches and never reaches past
it, so a Kindergartener having an excellent run gets faster and busier
waves — never times tables. Bosses are the exception: they draw on
everything from K up through the run's grade, because waves teach the
current grade and a boss reviews the ground already covered.

The backdrop travels continuously through ten palettes as the wave count
climbs. It's the only thing on screen that shows how far you've come, which
is why it blends rather than switching — and why it settles at the last one
instead of looping back to the opening garden.

## Progression systems

**Base Skill Tree** — upgrades purchased with currency between runs:
Economy (Bounty, More Time), Movement (Player Speed, Enemy Slowdown),
Defense (Dodge, Armor), Firing (Piercing Shots, Burn, Firing Speed), two
unlockable Active Abilities (Freeze, Bomb), and Progression (Checkpoint).

**Getting back to a boss** — Progression is the odd branch out: everything
else changes how a run plays, Checkpoint changes where a run *starts*. Three
levels put your free starting wave at 5, 10, then 15 — each one a boss wave.
On top of that, the pre-run screen sells a one-off skip further ahead,
charged every run so it never becomes the default. Both are capped by the
furthest wave you have actually reached, so skipping only ever skips ground
you have already covered.
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
answer verdicts, all six enemy archetypes, the endless discrete-wave
sequence with its escalating difficulty, the earn-it-back clock with
Dodge/Armor, grade-scoped curriculum with a picker, the travelling backdrop,
currency and the Base skill tree shop, and a boss every fifth wave cycling
three phased fights with both win conditions.

**Built but not yet wired into the session flow:**
- Grades 4–12 — `GRADE_ORDER` runs to 12 but only K–3 have topics authored,
  so the grade picker offers only those. Grades 4–5 would also need
  fraction/decimal problem *generation* (the answer evaluator already
  supports fractions/decimals; the generator only produces integers).
- Grade *source* — the grade is chosen locally on the shop screen for now.
  It's meant to come from a service that already knows the player's grade;
  `resolveGrade()` in `gradeSource.ts` is the single function that changes.
- Gamepad input — the input system is built to support it cleanly
  whenever it's added, but no gamepad code exists yet.

**Not yet tuned:** skill costs, knockback distances, fall speeds, wave gaps,
the starting clock and every wave/boss time payout, the 5-second impact
penalty, and every boss's survive duration and combo requirement are all
reasonable placeholders, not numbers validated by real play.

**Worth knowing:** the clock covers the *whole run*, and you earn it back
by clearing waves — a flat bonus plus a share per enemy actually defeated,
up to a ceiling a little above where you started. Letting enemies through
costs you the bonus as well as the impact, so a run lasts exactly as long
as you keep answering. Reach a boss with less time left than its survive
duration and outlasting it is arithmetically impossible — the combo becomes
your only way out. That's deliberate, but it's the first thing to revisit
if runs feel unfair rather than tight.

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