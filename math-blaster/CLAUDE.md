# Pixel Math Blaster

Pixel-art arcade math shooter for K-3 kids, set in space. Svelte 5 (runes) +
TypeScript + Vite.
Gameplay renders on `<canvas>`; Svelte owns UI chrome only.

Commands: `npm run dev` / `npm run build` / `npm run preview` / `npm run check`
/ `npm test` / `npm run sprites`. `check` = svelte-check + tsc; `sprites`
regenerates the APNG art from `tools/` (see the sprite conventions at the
bottom). Always run `npm run check` AND `npm test` after edits - CI gates both,
and the whole codebase currently passes with 0 errors/warnings; keep it that
way.

## Architecture

Layered by design, not by accident - each layer only knows about the one below it:

```
lib/math/          MathValue, ProblemDefinition, evaluator - pure, no game state.
                    evaluator classifies exact/equivalent/close/partial/incorrect/
                    invalid. It has NO opinion on damage or consequences.

lib/levels/         enemyArchetypes.ts = the LEAF module: sprite-kind vocabulary,
                    the archetype registry (movement/layers/shield/split), and
                    pure stepMovement(). Everything else here depends on it.
                    waves.ts (formation GEOMETRY only - shapes and
                    buildFormation, fully deterministic, no Math.random),
                    Curriculum now carries `id` (the join key mastery is
                    recorded against) and an optional `standardCode`.
                    waveProgression.ts (THE PROGRESSION SPINE: turns a wave
                    number into a formation, a difficulty, a curriculum, a
                    boss and a backdrop. Also pure and deterministic),
                    LevelDefinition (curriculum + arcade difficulty + wave plan +
                    backdrop + boss rules incl. BossPhase, kept as separate
                    dimensions on purpose),
                    gameLevels.ts (7 authored bundles, K-3, plus the ladders
                    waveProgression reads them through),
                    gradeTree.ts (K-3 curriculum-unlock nodes, built on SkillTree),
                    problemGenerators.ts (generated + authored problems)

lib/skills/         SkillTree.ts = generic, content-free engine (nodes, prereqs,
                    costPerLevel, purchase logic). baseSkillTree.ts = the concrete
                    combat/economy nodes. SkillTreeScreen.svelte = the shop UI.

lib/progression/     THE PERSISTENCE SEAM, and the mastery one.
                    MasteryRecorder subscribes to gameEvents and tallies
                    per-topic attempts/correct for a run - a subscriber like
                    audio.ts, never a participant. ProgressionStore/Codec/Handle:
                    WHERE profile state lives (a store) is separated from what
                    it MEANS (a codec). profileCodec.ts owns the merge, and
                    PlayerProfile.ts owns validation. Boot is synchronous
                    through it - there is no 'loading' phase and there must
                    not become one.
                    TWO STORES, AND THE SECOND WRAPS THE FIRST.
                    localStorageStore.ts is the cache and the boot path;
                    supabaseStore.ts composes it and keeps a remote copy in
                    step, so `current` is still synchronous and a signed-out
                    or offline player gets exactly the local game. It talks to
                    the RemoteProgression.ts port, never to Supabase directly -
                    supabaseRemote.ts is the only file that imports
                    @supabase/*, which is what lets supabaseStore.test.ts run
                    under testEnvironment node with no network.
                    runQueue.ts is the OTHER writer, and it is separate on
                    purpose: a profile is merged state, a run is an append-only
                    event. It persists a finished run BEFORE touching the
                    network and owns the idempotency key submit_run() dedupes
                    on.

lib/runtime/         RuntimeState (resets every run) vs PlayerProfile (currency +
                    skill levels, PERSISTS across runs through lib/progression -
                    these were once the same object; keep them separate).
                    PlayerProfile.ts is now PURE - the type and
                    normalizeProfile(), touching no storage at all.
                    gameFlow.ts owns the loop and MUTATES state/profile directly
                    (unlike the pure layers above) - that's deliberate, matches
                    how Svelte's $state gets consumed.

lib/combat.ts        Takes an AnswerResult, decides knockback/shield/layer/
                    reinforcement/defeat for grunts, and timer-cut/combo/
                    shield outcomes for bosses. NOTHING has hp to damage.
lib/targeting.ts     resolveTarget() - single source of truth for "what's the
                    player lined up on", used by BOTH the canvas reticle and
                    gameFlow's fire resolution. Never duplicate this logic.
lib/events.ts        GameEvent union + a shared EventBus (gameEvents). gameFlow
                    emits; GameCanvas and audio.ts independently subscribe.

lib/render/           GameCanvas.svelte draws the scene from (runtime, theme)
                    props alone, and manages its OWN transient FX (float text,
                    hit-flash, shake, one-shot sprite FX, the banner, and the
                    parallax starfield) by subscribing to gameEvents - it never
                    touches gameplay logic. spriteAtlas.ts owns what art
                    exists and which frame of it to draw; apng.ts decodes the
                    APNGs at boot; apngParse.ts is the pure byte half of that.

tools/                THE ART SOURCE, run at build time, not shipped.
                    spriteFrames.mjs holds the pixel grids and per-frame
                    animation; apngEncode.mjs writes APNGs; buildSprites.mjs
                    emits public/sprites/*.apng (`npm run sprites`).

lib/input/            InputManager abstracts keyboard/touch/future-gamepad into
                    one action vocabulary (move/moveTo/digit/backspace/fire/skill).

lib/Game.svelte       Top-level orchestrator: phases (boot/skillTree/runSetup/
                    countdown/playing/gameover - the full list is `GamePhase`
                    in lib/types.ts), HUD, wires InputManager, runs the
                    SIMULATION rAF loop, mounts GameCanvas + SkillTreeScreen.

                    THERE ARE TWO INDEPENDENT rAF LOOPS: this one advances
                    `tick()` and GameCanvas runs its own for drawing. Keep
                    that straight when debugging timing. The simulation
                    clamps its delta to 50ms per frame (so a backgrounded tab
                    can't teleport the world), which means an unfocused
                    window - where the browser throttles rAF hard - makes the
                    game advance in slow motion, while anything drawn from
                    absolute `performance.now()` (the starfield, the pulses)
                    keeps moving at full speed. That combination looks
                    convincingly like `tick()` has thrown when it hasn't.
App.svelte           A plain container around Game. It used to be an arcade
                    cabinet - marquee, bulbs, CRT bezel, scanlines, vignette,
                    vents - and all of that is deliberately gone. The pixel art
                    is still pixel art ('Press Start 2P', nearest-neighbour
                    scaling); it was the fake glass that went.
```

**Do not collapse these layers.** If you're tempted to have `evaluator.ts` decide
consequences, or `gameFlow.ts` call `sfx.*()` directly, or `GameCanvas` read game rules
instead of events - stop, that's the exact coupling this structure exists to avoid.

## Core mechanics

- **Targeting is positional.** Player moves horizontally along the bottom; you
  must line up under an enemy (or the boss) to hit it. `resolveTarget()` picks
  the nearest-to-impact aligned enemy, falling back to the boss only when
  nothing else is aligned. A *shielded* boss also exposes a weak point, which
  outranks its body and answers to a tighter tolerance
  (`WEAK_POINT_TOLERANCE_PCT`). `weakPointXPct()` is exported so the renderer
  draws the marker in exactly the spot targeting tests against.
- **`GLOBAL_FALL_SPEED_MULTIPLIER` is the one knob for descent pacing.**
  Applied in `spawnEnemy()` on top of the level's authored `fallSpeed` range
  and the archetype's own `speedMultiplier`, so it reaches wave spawns, boss
  adds and splitter debris alike. Tune global pacing here, not by editing ten
  authored ranges - that reshapes the between-level difficulty curve as a side
  effect. `gameFlow.test.ts` pins the wiring for both spawn paths.
- **NOTHING in this game has health.** Not the player, not bosses, not enemies.
  This is a hard invariant, not a current state of affairs - if you find yourself
  adding an hp field, a damage number, a max-health stat or a health bar to
  anything, stop. Every consequence in the game is expressed in *time* or in
  *questions answered*. `EnemyInstance` has no `hp`/`maxHp`; `GruntTarget` is
  `{ layersRemaining, shielded }` and that is the whole of an enemy's durability.
- **Enemies are archetypes, not sprites.** The three grunt sprites
  (drone/swarmer/hulk) used to be purely cosmetic. Now `EnemyArchetype` owns movement (straight/weave/dive), how many
  *layers* (= separate problems) it takes to kill, whether it starts shielded,
  whether it splits on death, and whether the kill counts toward the level
  quota. A **layer IS a question**, not a health pool with a question painted on
  it: only exact/equivalent clears one, and clearing a non-final layer mints a
  fresh problem instead of killing the enemy.
- **Close and partial answers knock enemies back up the screen** rather than
  chipping anything. `KNOCKBACK_CLOSE_PCT` (18) is deliberately larger than
  `KNOCKBACK_PARTIAL_MAX_PCT` (11), so a close answer out-pushes *any* partial
  one no matter how many digits that partial matched - a player is never
  rewarded for guessing digits over reasoning toward the answer. The reward for
  a near-miss is time, which is the only resource a run spends.
  `combat.test.ts` pins the close-beats-every-partial property and the fact that
  repeated close answers can never accumulate into a kill (which is exactly what
  half-damage used to do).
- **A shield is a gate, not a reduction.** Only exact/equivalent strips one, and
  doing so consumes the whole shot (nothing else lands that turn - not a layer,
  not a knockback). This is the one place in the game where "close" earns
  literally nothing. Shields are *not* health: they are an exactness gate, which
  is why they survive the no-health rule.
- **A RUN IS AN ENDLESS SEQUENCE OF DISCRETE WAVES.** There are no worlds, no
  stages, no `stageIndex`, and no victory. `RuntimeState.waveNumber` is the
  run's entire sense of position. A wave is announced, its breather runs, the
  whole formation arrives at once, and the next wave starts only once the board
  is **empty** - `state.enemies.length === 0` is what ends a wave. That always
  happens: an enemy is either answered or it crosses the impact line and is
  removed, so a wave cannot stall. Reinforcements are capped per wave
  (`MAX_REINFORCEMENTS_PER_WAVE`) precisely because they extend the board a
  player has to clear before moving on.
- **The backdrop is how progress is shown, and it moves every wave.**
  `backdropForWave()` blends continuously along `BACKDROP_LADDER` rather than
  switching between palettes - a set change reads as "somewhere else", a
  gradient reads as travel, and the wave number already covers "where am I".
  It holds at the last rung instead of wrapping (putting low orbit
  back on screen at wave 90 would read as losing progress), and a boss wave
  with no authored palette of its own darkens where it is rather than jumping
  somewhere unrelated. Colour parsing falls back to an unblended end rather
  than to black, so a malformed palette can't paint the scene out.
  **The ten rungs are spaced roughly EVENLY in colour, and that is a
  constraint rather than an aesthetic.** Because each blend runs over
  `WAVES_PER_BACKDROP` waves, one outsized gap between adjacent rungs reads
  mid-run as a lurch rather than as travel - `waveProgression.test.ts` pins
  that no single wave jumps a whole rung's worth, measuring against the gap
  between the first two. A draft of the space ladder had two nearly identical
  navy rungs followed by a violet-to-orange jump three times their size, and
  failed it. Every rung is dark at the BOTTOM and coloured at the TOP, so
  enemies descend out of a nebula into empty space and the white-and-cyan
  player ship always sits against the dark band.
- **On a dark backdrop, a sprite's darkest tone must stay lighter than the
  sky.** The enemy palettes were first picked against pastel daytime
  backdrops; carried onto a starfield, the near-black shades let a silhouette
  break apart - the leviathan lost its shoulder pods and landing struts
  entirely and read as a floating visor. Hues also carry meaning: the player
  is the only white-and-cyan thing on screen, enemies run warm or violet, and
  a shield bubble's cyan is deliberately not an enemy hull colour.
- **DIFFICULTY OF THE MATHS IS THE PLAYER'S GRADE, NOT THE WAVE NUMBER.**
  `gradeTree.ts` is the curriculum spine (it was dead code; now everything is
  drawn through it). `curriculumLadderForGrade()` gives a run that grade's
  topics *and nothing harder*, and `curriculumForWave` holds at the last rung -
  so a six-year-old having an excellent run gets faster and busier waves, never
  times tables. `gameFlow.curriculumLadder()` is the single seam every problem
  comes through; `gradeTree.test.ts` and `gameFlow.test.ts` both pin the
  containment property out past wave 300. Arcade difficulty still scales with
  the wave number - that separation is the point.
  A **grade-K exception is planned here** (not in the boss numbers) to absorb
  the boss-economy regression on the youngest players - see the grade-K note
  under "Known gaps" for what was measured and why the boss knobs are the
  wrong place for it.
- **Boss scope is cumulative, wave scope is not.** `cumulativeScopeForGrade()`
  spans K up through the run's grade, because waves teach this grade and bosses
  test everything up to it. It must stay ordered easiest-first:
  `generateBossProblem` weights selection toward the end of the array as a
  fight goes on, so an out-of-order scope would make a fight get *easier*.
- **A boss's maths gets harder with the wave number ONLY UP TO THE GRADE
  CEILING, and that is not a shortfall.** `BossRules.scopeBias` (from the boss
  ordinal) is where a fight *starts* on the easy-to-hard slope
  `generateBossProblem` already walks, so a wave-40 boss opens leaning hard
  instead of sampling its scope as evenly as wave 5's did, and the finale is
  picked by ordinal rather than by roster entry so a later boss never inherits
  an earlier one's easier finale. But the scope itself is still capped by
  `cumulativeScopeForGrade()`, so all of this escalates *within* the grade and
  then holds. A wave-60 G1 boss is longer, faster, more phased and leaning at
  the hard end of G1 - and still never asks times tables. That is the
  grade-not-wave rule above doing its job, not this one failing.
- **`resolveGrade()` in `gradeSource.ts` is the only place the grade is
  decided**, and it exists to be swapped: the grade is meant to come from a
  service that already knows it, and that function's body is all that should
  change. Treat that future answer as untrusted the way the current one is -
  validate against `GRADE_ORDER` and fall back to a real grade, never let an
  unknown value reach the ladder.
- **`waveProgression.ts` is the only place a wave number becomes anything.**
  Formation, fall speed, concurrency, curriculum, boss, backdrop - all of it
  from `waveNumber`, all pure and deterministic. Wave 12 must be wave 12 every
  time, or the wave number stops being meaningful (and a checkpoint that starts
  you at wave 15 stops meaning anything). Past the authored material the ladder
  cycles its hardest stretch, widening formations and tightening gaps, so an
  endless run escalates rather than plateauing or running dry.
- **`maxConcurrent` both TRIMS and WIDENS a formation, and that's the whole
  difficulty curve.** Below `AUTHORED_CEILING` (the widest formation anyone
  authored) it trims: the ramp opens at 2, so wave 3's authored trio arrives as
  a pair. Above it, `waveSpecFor` adds slots by repeating the formation's own
  archetypes. Widening does *not* wait for the authored specs to run out - it
  used to, which made the cap inert for the entire mid-game, because every
  authored formation already fitted inside it and nothing changed until the
  tail began cycling ~30 waves in. It adds the same *number* of slots to every
  formation rather than filling each to the cap, so a wave authored as a lone
  bulwark still reads as a lull deep into a run.
- **`gameLevels.ts` is source material, not a sequence.** Its 7 bundles are
  read through the ladders it exports (`CURRICULUM_LADDER`, `WAVE_PLAN_LADDER`,
  `BACKDROP_LADDER`, `BOSS_ROSTER`). Nothing indexes `GAME_LEVELS` to decide
  where the player is. Their easiest-first *order* is load-bearing.
- **Formations are deterministic on purpose** - that's what makes a wave
  learnable and `buildFormation` testable. `waves.ts` owns geometry only;
  `WavePlan` has no `loopFrom` any more (each plan is one stretch of a single
  long ladder, so its opener plays exactly once and the run moves on - which is
  what looping was there to arrange).
- **The run clock is the game's only resource, and it is EARNED BACK.**
  `timeRemainingMs` starts at 50s (+ More Time) and drains continuously, but
  clearing a wave pays time back: a flat `WAVE_CLEAR_BONUS_MS` plus
  `WAVE_CLEAR_PER_KILL_BONUS_MS` per qualifying kill, and `BOSS_CLEAR_BONUS_MS`
  for *defeating* a boss (the mastery route only - see below). That's what makes a long run possible at all - as a
  drain-only budget it ran out around wave 4 and no player ever saw a boss.
  Every payout goes through `addRunTime()`, so the ceiling can't be bypassed by
  a new one forgetting about it, and it returns what was *actually* granted -
  callers report that, never the nominal figure, so the HUD can't promise time
  the player didn't get.
- **The clock's ceiling is RELATIVE to the player's starting clock**
  (`startingTimeMs + BANKABLE_HEADROOM_MS`), not a flat number. A flat cap at
  base + a maxed More Time pinned a fully upgraded player to the ceiling from
  wave 1, silently discarded every payout, and turned More Time into "start at
  the cap" rather than an upgrade that keeps paying. Keep it relative if you
  retune either number.
- **A strong player reaching the ceiling is the design, not a bug.** No single
  flat-plus-per-kill payout can break even for both a 6.5s-per-problem child
  and a 3.2s one - the rate that keeps the slow player alive necessarily
  overpays the quick one, who then climbs to the ceiling and sits there. The
  ceiling is the valve on that surplus. What matters is *when*: it used to
  arrive at wave 6 of a ~30-wave run, leaving most of the run with an inert
  clock and no feedback for good play. If you want to remove the dead feeling
  rather than delay it, the fix is to give the surplus somewhere else to go
  (score, currency) - not to shrink the payout, which just re-walls the
  youngest players.
- **Leaking an enemy costs the bonus as well as the penalty.** A wave that
  clears because everything landed pays much less than one answered out, which
  is what stops standing still being a free way to skip a wave you can't
  answer. Enemy impacts cut the clock: **Dodge** is a chance to fully negate the
  penalty; **Armor** reduces the penalty's magnitude when it isn't dodged. These
  are independent rolls, not combined into one "avoidance chance" (an earlier,
  wrong interpretation - see git history/conversation if curious why it changed).
- **Currency is separate from score.** `score` is the per-run arcade number shown
  on the HUD and end-of-run screen only - it isn't persisted. `PlayerProfile.currency`
  is the persistent spendable resource, earned per kill (`Bounty` skill increases
  the flat amount) and spent in the Base skill tree shop between runs.
- **ONLY DEFEATING A BOSS PAYS, AND DEFEATING MEANS THE COMBO.** Outlasting the
  survive clock is *escaping* a boss, not killing it - the player never answered
  it down, so `onBossDefeated` grants neither bounty nor run time on the
  `survival` route. The cost of failing to defeat a boss is the half-minute
  spent on it for nothing; there is deliberately no extra penalty stacked on
  top, and the run still advances either way. `BOSS_CLEAR_BONUS_MS` was halved
  (25s -> 12.5s) at the same time so the two changes don't compound into a
  wall - it has since gone back up to 18s, for the reason in the grade-K note
  below, so don't read 12.5 as the current value.
  The bounty is a *multiplier* on the ordinary per-kill amount
  (`BOSS_BOUNTY_MULTIPLIER` + `BOSS_BOUNTY_MULTIPLIER_PER_FIGHT` per boss
  ordinal, plus `MASTERY_BOUNTY_MULTIPLIER`) rather than its own flat figure,
  so it goes through `awardCurrency` and the `Bounty` skill keeps applying to
  the one kill that matters most. `boss-defeated` carries `bountyEarned` and
  `timeBonusMs` as *actually granted* - the clock has a ceiling, and the banner
  must not promise time the player didn't get.
  This costs the youngest players the most, on purpose but not to a settled
  degree - see the grade-K note under "Known gaps" before retuning any of it.
- **A boss is a kind of wave**, arriving on every `WAVE_BOSS_INTERVAL`th one
  (5). The `BOSS_ROSTER` supplies **identity only** - name, sprite, theme, and
  the phase *names* that give a fight its voice (plus a tier prefix on each
  pass through it). Boss *maths* arrives separately as `scope`. That split
  is what lets a boss appear on wave 5 for any curriculum - only 2 of the 7
  authored bundles wrote a boss at all. Because the rules are generated rather
  than authored per stage, the run holds them in `RuntimeState.bossRules` for
  the duration of the fight; there is no level to look them up on.
  Problems are drawn from a *cumulative* scope, weighted progressively harder
  as the fight goes on, culminating in an authored finale problem for the last
  15% of the survive timer.
- **EVERY NUMBER THAT DECIDES HOW HARD A BOSS IS COMES FROM THE WAVE NUMBER**,
  not from which roster entry it is. `bossRulesFor` generates `surviveSec`,
  `comboToDefeat`, the whole `phases` ladder, the finale and `scopeBias`; the
  roster contributes none of them. It used to contribute all of them, and
  because the roster cycles and its three entries are ordered easiest-first,
  **difficulty went backwards every third fight**: wave 15 fought a 3-phase
  boss at `surviveSec` 28, then wave 20 fought "Elder Sum Reactor" with 2
  phases, `surviveSec` 24 and an easier finale. Don't move any of these back
  onto the roster. `waveProgression.test.ts` pins monotonicity out past
  ordinal 24, that the opening phase is never shielded, and that adds are
  never `bulwark`/`sentinel`.
- **Three boss constants are DERIVED, and the derivation is the point.**
  `BOSS_MIN_FIGHT_CAP_SEC` = survive cap / headroom factor, and
  `BOSS_COMBO_CAP` = floor cap / `BOSS_SEC_PER_COMBO_ANSWER`. Both encode a
  *relationship* that silently breaks if either side is hand-set:
  - Collapse `surviveSec` onto the fight's floor and timer cuts go inert -
    there's no headroom left to cut, so "good answers shorten the fight"
    stops being true while still looking implemented.
  - Let the combo cap exceed what the floor permits and the deepest bosses
    become unkillable, leaving only the endurance route.
  To allow a longer combo, raise `BOSS_SURVIVE_CAP_SEC` - that is the actual
  constraint.
- **Beating a boss drops straight into the next wave.** No stage-clear screen,
  no Continue button, no victory state. The banner in GameCanvas is the only
  thing that reports how the fight was won, so don't remove it - and since
  escaping a boss pays nothing, the banner is also the only place that *says*
  so (no float text appears for a payout that never happened). `audio.ts`
  reads the same distinction independently: the victory sting is reserved for
  a mastery finish, an escape takes the ordinary wave-clear cue.
- **Bosses have NO health bar.** Don't add one back. A fight ends one of two
  ways: the player outlasts `surviveSec`, or lands `comboToDefeat` consecutive
  exact/equivalent answers (the mastery route - anything less than exact resets
  the combo to 0). Good answers *cut the survive clock*, so the two routes are
  the same activity at different intensities rather than separate systems -
  that's what `BOSS_CUT_*_MS` in combat.ts replaced the old damage percentages
  with (bosses lost their health long before grunts did). `BossState.defeatedBy` records which route won.
- **Boss phases are gated on elapsed survive time, not damage** (there is none
  to gate on). `phaseIndexForProgress()` normalises `BossPhase.weight` into
  proportions of the fight. Entering a phase deliberately reopens the boss and
  resets its shield window, so a phase change is a window rather than an
  ambush - tests that set up a shield state must let the phase change land
  first or it overwrites them.
- **A FIGHT HAS A MINIMUM DURATION, AND CUTS COMPRESS IT RATHER THAN SKIPPING
  IT.** `BossState.minFightMs` (from `bossMinFightSec`) is the floor
  `cutSurviveClock()` clamps against, so a player answering perfectly walks
  the *whole* phase ladder inside that window instead of seeing only the
  opening phase - `progress` still moves on every cut, which is what makes
  that work. Two things to keep straight:
  - `BossState.elapsedMs` is **not** derivable from
    `surviveTotalMs - surviveRemainingMs`; cuts inflate that difference, so it
    measures progress through a fight, not time spent in one. The floor needs
    the latter, which is why the field exists. Advance it from the tick alone.
  - The floor is on **outlasting** a boss, not on killing one. Reaching
    `comboRequired` ends the fight immediately whatever the floor says.
  `boss-timer-cut` reports what a cut *actually took*, since the floor can
  absorb it and the HUD must not count down time the fight didn't lose.
- **`BOSS_SEC_PER_COMBO_ANSWER` is what makes the mastery route reachable at
  all**, and it is the least obvious number in the boss code. The floor is
  `comboToDefeat` x this, because a fight has to leave room to actually finish
  a combo. Before it existed the mastery route was *arithmetically impossible
  at every wave*: each exact answer cut 2.6s off a 20s clock on top of the
  seconds the player spent thinking, so answering well raced the player into
  the endurance ending. The balance harness measured a 0% mastery rate for all
  three modelled players. Set this below a real child's think time and the
  mastery route silently becomes decorative again.
- **Boss adds are ordinary enemies.** Shooting one no longer damages the boss
  (it used to). They matter because they threaten the run clock, nothing else.
- **A REINFORCEMENT IS THE CONSEQUENCE OF DISENGAGING, AND NOTHING ELSE.**
  There is no timed add stream during a boss fight - `updateBossPhase` only
  counts a cooldown down, and `tryReinforce` is the sole path an add reaches
  the board by. A player answering the boss (even nearly) fights it on an
  empty screen; one who has stopped answering gets a rising stream. Two
  halves to keep together:
  - **What counts as answering.** exact/equivalent/close/partial all reset
    the escalation; only incorrect/invalid build it, the first miss is free,
    and the chance climbs per consecutive miss thereafter. The streak
    deliberately SURVIVES a reinforcement firing - resetting it there would
    sawtooth the pressure back to zero exactly when it should be mounting.
    The old rule was backwards: `close` rolled 50% and `partial` 35% while a
    single wrong answer rolled nothing, so reasoning to within one of the
    answer was punished harder than guessing.
  - **Adds are much easier than the fight they arrive in**, on all three axes
    that make an enemy hard: their problem comes from the *easiest* rung of
    the boss's scope (not `generateBossProblem`), their archetype from
    `BOSS_ADD_LADDER`, and their speed is scaled by
    `BOSS_ADD_SPEED_MULTIPLIER`. An add used to inherit the boss's own
    cumulative scope weighted toward its hard end, which handed a player
    already failing the boss's maths more of the same maths to fail - a bad
    patch became unrecoverable instead of something to climb out of.
  A wave keeps `MAX_REINFORCEMENTS_PER_WAVE` instead of a cooldown, because
  what a spare enemy costs differs: during a wave it extends the board that
  must be cleared before the run moves on, during a boss fight the fight ends
  on its own clock. `SpawnOptions.problem`/`.speedMultiplier` exist for this
  and keep speed composed in one place - don't mutate `enemy.speed` after
  spawning.
- **Partial credit uses place-value digit matching** (ones/tens/etc. compared by
  position), not "contains these digits somewhere" - e.g. 24 vs 42 scores zero
  matching digits despite sharing digits, because place value is the point.

## Known gaps / deliberate scope boundaries

Don't "fix" these without checking - they're intentional stopping points, not bugs:

- **THE YOUNGEST PLAYERS REGRESSED WHEN ONLY BOSS KILLS STARTED PAYING, AND
  THE FIX IS COMING FROM THE CURRICULUM, NOT FROM THE BOSS NUMBERS.**
  Making the mastery route the only paying one cost the weakest modelled
  player most: K slow's median run went from wave 10 to 6, and 62% get past
  wave 5 where 80% did. That is the intended shape of the change - a boss you
  cannot answer down costs you the ~45s you spent on it - but the size of it
  on grade K is not settled, and **an exception for grade K's curricula is
  planned to absorb it.** A K player's problem is accuracy: at ~0.72 exact
  they master 11% of fights, so they almost never collect. Raising what a kill
  pays cannot reach them; giving them maths they can actually chain answers on
  can.
  So do NOT "fix" this by retuning the boss economy. Both obvious knobs have
  already been measured against the harness:
  - `BOSS_CLEAR_BONUS_MS` 12.5s -> 18s moved G1 15->16 and G3 26->27 and left
    K slow **identical on every figure**. It is mastery-gated, so at an 11%
    mastery rate it is worth about 0.6s per fight to them - it pays the
    players who could already afford bosses. (It is at 18s for that reason,
    not this one.)
  - `BOSS_COMBO_BASE` 5 -> 4 *is* effective (K slow mastery 11% -> 24%, past
    wave 10 0% -> 5%, G3 back to baseline 28) and costs no fight length, since
    the floor is `max(30, comboToDefeat * BOSS_SEC_PER_COMBO_ANSWER)`. It is
    deliberately NOT taken: the grade-K curriculum exception is the intended
    lever, and lowering the combo for everyone to rescue one grade would flatten
    the mastery requirement for the grades that don't need it.
  The remaining levers after that are shortening the fight
  (`BOSS_MIN_SURVIVE_SEC`, currently the stated 30s minimum) or paying the
  survival route something - and the latter is the distinction the whole boss
  economy rests on, so it isn't available.
- **Grades 4-12 are typed but unauthored.** `GRADE_ORDER` runs to 12;
  `GRADE_TOPICS` only has K-3. The grade picker offers only grades with topics,
  and `curriculumLadderForGrade` falls back to every authored curriculum for a
  grade with none - a run with no problems in it is a far worse failure than a
  run at the wrong difficulty. Adding a grade is a data addition to
  `GRADE_TOPICS`; Grades 4-5 would also need fraction/decimal *generation*.
- **Gamepad isn't implemented.** `InputManager` has a doc-comment constraint
  (dedicated buttons per action category, never overloaded) for whenever it is.
- **Base skill tree unlocks through five branch gates.** The free root reveals
  only the five category gates (`branch-economy`/`-movement`/`-defense`/`-firing`
  /`-active` in `baseSkillTree.ts`), each a one-click purchase that opens just
  that category's skills - the player picks one branch at a time instead of
  being shown ten skills at once. Gates carry a `{ kind: 'branch' }` effect
  that grants nothing; they exist purely to pace the shop. Armor behind Dodge
  Lv.1 is the only skill-to-skill chain. `baseSkillTree.test.ts` pins down what
  is reachable at each stage - update it if you rewire prerequisites.
- **Grades 4-5 don't exist.** Would need fraction/decimal problem *generation*
  (the evaluator already supports fraction/decimal `MathValue`s - the generator
  in `problemGenerators.ts` only ever produces integers).
- **Health Pool is gone.** It granted bonus lives, then (when lives became the
  timer) bonus starting time in exchange for tougher enemies. Once enemy health
  was removed there was nothing left for that trade to be made of, so its time
  value was folded into `more-time` (now `level * 6000`) and the node was
  deleted. Legacy profiles may still carry `health-pool` levels; nothing reads
  them, which is why the storage key stayed at `v1`. If you see references to
  "bonus lives", "Health Pool" or `enemyHpMultiplier` anywhere, they're stale.
- **The `bomb` skill strips layers, it doesn't deal damage.** `layersStripped`
  is 1, rising to 2 at Lv.4 - which is the point at which a bomb finally
  answers a bulwark or an unshielded sentinel outright. It still skips shielded
  enemies entirely.
- **The pacing numbers are tuned against a SIMULATION, not against children.**
  `runtime/balanceSim.ts` drives the real `tick`/`handleInputAction` with
  modelled players (a think-time and an accuracy per player) and reports where
  runs end; `balanceReport.test.ts` prints it (opt-in:
  `BALANCE_REPORT=1 npx jest balanceReport`). The
  run clock, its ceiling, the wave payouts, the impact penalty,
  `GLOBAL_FALL_SPEED_MULTIPLIER` and the concurrency ramp were all set from it,
  and they interact - re-run the harness after touching any one of them rather
  than reasoning about it alone. Current measured medians, un-upgraded:
  wave 6 for a slow K player, 16 for a typical G1, 27 for a quick G3. (These
  are the post-boss-economy figures - the grade-K note below is where the
  drop from 10 to 6 is discussed. If you change them, change them here too:
  this line said ~10/~20/~28 for several releases after it stopped being
  true.)
  The player model is the assumption to argue with; the numbers only mean as
  much as it does, and no real child has played this yet.
- **Still untuned placeholders**: skill costs and the currency rate (a weak
  run earns ~55, against 60 for one More Time level - so the shop is roughly
  two runs per early upgrade, which nobody has checked is right), knockback
  distances, the boss timer-cut amounts, and the boss bounty multipliers.
  `surviveSec`/`comboToDefeat` are no longer placeholders and no longer
  authored - they are derived in `waveProgression.ts` against the harness (see
  the boss-escalation block there for what each number answers).
- **A boss fight can still be arithmetically unwinnable by endurance**, and
  that's deliberate: walk in with less clock than its `surviveSec` and the
  combo is the only way out. Wave-clear payouts make that recoverable rather
  than a dead end, which is the point - don't "fix" it by topping the clock up
  when a boss starts.
- **Freeze does not pause a boss's survive clock.** Freezing the adds buys
  breathing room; stalling the fight it's meant to win would make the skill a
  self-nerf during exactly the moment you'd want it.
- **Only two boss sprites exist** in `tools/spriteFrames.mjs`, so the roster's
  three fights share them - "Carrier Hydra" reuses `dreadnought` with a
  different name/theme/phases.
  A cycled roster makes this more visible than it was, which is why repeat
  visits take a tier prefix ("Elder", "Ancient", "Eternal").
- **Shields, weak points and layer pips are drawn, not sprited.** GameCanvas
  composes them from canvas primitives so they work over every silhouette
  without new pixel art. If you add archetype-specific art later, that's where
  it goes - not into new EnemyInstance fields.
- **The starfield is seeded and pre-rendered, and the backdrop gradients are
  cached.** Three parallax layers are rasterized once into offscreen canvases
  at mount and then scrolled with `drawImage`; the sky and nebula gradients are
  rebuilt only when the theme colours actually change (a few times a run),
  where the old code rebuilt the sky gradient every frame. The starfield uses a
  seeded PRNG - `Math.random()` there would make the sky boil.

## Conventions worth keeping

- **A CURRICULUM'S `id` IS THE TOPIC'S ONE TRUE NAME**, and it equals the id
  of the `gradeTree` node that teaches it. Mastery is recorded against that
  string, so a topic with two ids splits one child's practice across two rows
  that never add up - and nothing throws to tell you. That is why `gradeTree.ts`
  takes its curricula from the level objects rather than restating them: three
  nodes used to carry byte-identical copies, which was harmless only while a
  curriculum was anonymous. `gradeTree.test.ts` pins that a node and its
  curriculum agree, and that no id is claimed by two different shapes.
  `standardCode` is the EXTERNAL name and plays by different rules: optional,
  changeable, and shared by two topics already (both grade-1 nodes are 1.OA.6,
  because the standard is coarser than the game's split). Never join on it.
- **Attribute the problem that was ANSWERED, not the one on the enemy.**
  Breaking a shield and clearing a non-final layer both mint a *fresh* problem
  on the same enemy, so `applyHitToEnemy` captures `enemy.problem` before
  resolving. Read it at emit time instead and every multi-layer enemy is
  mis-filed, silently and plausibly.
- **An authored problem carries no topic, and that absence is deliberate.**
  A boss finale is written by hand rather than drawn from a curriculum, so
  `buildAuthoredProblem` stamps nothing and `MasteryRecorder` skips what it
  cannot attribute. A fiction in a mastery record is worse than a gap, because
  a person may eventually act on it.
- **Only exact/equivalent count as `correct`** in the mastery tally - the same
  bar that clears a layer and strips a shield. close/partial earn a player
  TIME, which is the game's reward for reasoning toward an answer; they are not
  evidence of knowing it, and a signal a teacher may act on must not say so.
- **THE SUPABASE CLIENT IS FREE UNTIL CONFIGURED, THEN IT IS A SIDE CHUNK, AND
  BOTH PROPERTIES ARE FRAGILE.** Vite inlines `import.meta.env.*` as literals,
  and Rollup folds constants **within a function body but not across a function
  boundary**. Everything follows from that one fact:
  - No credentials: the guard in `getSupabaseClient` folds to an unconditional
    `throw`, the `await import('@supabase/supabase-js')` after it is dead code,
    and the package is dropped entirely. One chunk, 126.42 kB / 44.70 kB gzip.
  - With credentials: it becomes a lazily-fetched chunk, so the game is playable
    while it loads. Main bundle 127.78 kB / 45.35 kB gzip plus a 208.65 kB /
    53.98 kB gzip side chunk - against 335.19 kB / 98.70 kB in one bundle when
    it was a static import.
  **THE GUARD MUST STAY IN THE SAME FUNCTION BODY AS THE `import()`.** An
  intermediate version of this put the check in a `readSupabaseConfig()` helper
  and the import in `getSupabaseClient()`, and the 208 kB chunk was emitted on
  every build even with no credentials - unreachable at runtime, but shipped,
  and invisible unless you count the files. That is also why the guard is
  duplicated in `isSupabaseConfigured()` (which `Game.svelte` needs
  synchronously) rather than shared: two folds in two bodies, not one helper.
  Do not "clean this up".
- **A FINISHED RUN IS PERSISTED BEFORE THE NETWORK IS TOUCHED, AND ITS
  IDEMPOTENCY KEY IS GENERATED ONCE.** Both halves are load-bearing and both
  fail silently. Persisting first is what makes a closed tab survivable - the
  run lands on the next boot; submitting first and saving only on failure would
  lose exactly the runs a flaky connection makes most likely to fail. And the
  key must travel with the run through every retry, because `submit_run()` is
  unique on `(profile_id, idempotency_key)`: a fresh key per attempt turns the
  server's dedupe into a no-op and doubles a child's practice record. That is
  why `runQueue` owns the key rather than accepting one from the caller.
  There are THREE submit outcomes, not two: `submitted` and `rejected` both drop
  the run, `unavailable` keeps it. Without a terminal-failure outcome one
  malformed run would retry forever and every later run would queue behind it.
- **`bosses_defeated` counts the MASTERY route only.** Outlasting a boss's
  survive clock is escaping it, not killing it - the economy already refuses to
  pay bounty or run time for that, and the session row must not disagree with
  the economy about what a defeat is.
- **COMPARE PROGRESSION STATE BY VALUE, NEVER BY `JSON.stringify`.** The
  Supabase store decides whether to push by comparing the merge result against
  what the server sent. `JSON.stringify` looks right and is not: `profileCodec`'s
  `parse` builds its object opening with `currency` while its `merge` opens with
  `earnedTotal`, so two semantically identical profiles produce different text.
  The guard never fired and every signed-in player pushed a redundant write on
  every boot - harmless to the data, because the triggers are monotone, but it
  burned a revision each time, which makes genuine conflict detection noisier,
  and it silently removed the only property the guard exists for. Use
  `stableStringify` in `supabaseStore.ts`. The unit tests missed this because the
  test codec emitted its keys in the same order from both methods; it is caught
  now, and the test codec deliberately disagrees with itself on key order.
- **`.env.local` lives at the REPO ROOT, and `vite.config.ts` needs
  `envDir: '..'` for that to work.** Without it every `import.meta.env.VITE_*`
  reads `undefined`, the client returns null, and the game falls back to
  local-only - which looks exactly like working software. `src/vite-env.d.ts`
  declares the two vars so a typo is a type error rather than the same silent
  fallback.
- Skill effects are a discriminated union (`BaseSkillEffect`) with `effectAtLevel(0)`
  always meaning "not purchased yet" - safe to call before any purchase exists.
- New `GameEvent` variants: add the type, then update both `GameCanvas.svelte`'s
  and `audio.ts`'s event handlers (they interpret independently; neither should
  need the other to know a new event exists).
- Persisted localStorage key in use: `pixelMathBlaster.profile.v1` (currency,
  lifetime earned/spent totals, skill progress, selected grade, furthest wave
  reached). Every field added since v1 has been additive with a validated
  fallback, which is why the suffix hasn't moved - bump it only for a change
  that makes an old profile *wrong* rather than incomplete. The key now lives
  in `progression/profileCodec.ts` and is passed INTO the store rather than
  derived from the game slug: it predates the namespacing convention, and
  moving it would strand every current player's currency and skills.
- **`currency` is a balance; `earnedTotal`/`spentTotal` are MONOTONE.** The
  invariant `currency === earnedTotal - spentTotal` holds everywhere, and every
  path that moves currency maintains both sides - `awardCurrency()` in gameFlow,
  both purchase paths in Game.svelte, and devTools. They exist because a merge
  needs something `max` is meaningful on, and `max` of two *balances* hands back
  money that was already spent. A spend that forgets its `spentTotal += n`
  fails silently and locally; it reappears as free money the first time two
  copies of a profile meet.
- **Saves are DEBOUNCED, and the profile is MUTATED IN PLACE.** The game calls
  `progress.put(profile)` on every kill and the store decides when that reaches
  storage (~2s trailing, ~15s ceiling, immediate on purchases, grade changes,
  game-over and `pagehide` - never `beforeunload`, which is unreliable on iOS
  Safari and blocks bfcache). Never reassign `profile`: `installSkillTreeDebug-
  Tools` captured it by reference, so a reassignment leaves the dev console
  silently editing a detached object. Use `Object.assign(profile, next)`.
  There is no leaderboard/high-score persistence - a run ends at a "Play Again"
  / "Skill Tree" choice, nothing is saved beyond the profile. The end-of-run
  screen reports the wave reached, which is the number that means something in
  an endless run.
- **Sprites are animated APNGs, decoded once at boot.** The art is still
  composed from numeric pixel grids + a palette, but that now happens at BUILD
  time in `tools/spriteFrames.mjs`, which emits `public/sprites/*.apng` via
  `npm run sprites`. The generated files are committed, so neither the build nor
  CI depends on the tool running. At runtime `spriteAtlas.ts` fetches and decodes
  them; nothing is rasterized per frame. Don't add `fillRect` loops for entities,
  use `drawSprite()`.
  - **APNG is the only animated format, and there is no GIF fallback.** When a
    sprite fails to decode, `spriteAtlas` draws a plain silhouette rect so the
    game stays playable - the fallback for broken art is a canvas primitive,
    never a different image format.
  - **Assets are fetched by URL from `public/`, never `import`ed.** An asset
    import in any `.ts` under `src/` breaks `npm test`, because
    `tsconfig.jest.json` overrides `types` and drops `vite/client`'s asset module
    declarations - and Vite's default `assetsInlineLimit` would base64 the small
    ones into the JS bundle.
  - **ANIMATION STATE LIVES IN `render/`, NEVER ON GAME STATE.** Which frame an
    enemy shows is a pure function of the clock and the enemy's `uid`
    (`spritePhase()`, which is what stops a formation of identical enemies
    animating in lockstep). `EnemyInstance` has no `frame` field and must not
    grow one - the renderer stays a pure function of `(runtime, theme, nowMs)`.
  - **`spriteSize()` returns the ON-SCREEN footprint and works before the art
    loads.** Every overlay - problem label, reticle box, shield bubble, layer
    pips, boss weak point - is positioned from it, so native sizes are declared
    statically in `SPRITE_META` rather than read off the decoded images. If they
    came from the images the whole HUD would jump when decoding finished.
  - **Scales are integers.** The old pipeline rasterized at fractional sizes
    (grunts were 4.5), which is fine for rectangles but gives a scaled bitmap
    unevenly doubled pixel columns. Draw positions are rounded for the same
    reason.
  - The player sprite is deliberately only 19 rows tall: it is drawn
    top-anchored at 88% of a 320-tall canvas, so ~38px is all that is ever
    visible. The old 12-row sprite had its bottom quarter clipped off screen
    unnoticed, which is where a thruster would have gone.
- **One-shot sprite FX are driven by `gameEvents`, like every other bit of
  presentation.** `enemy-defeated` plays an explosion, `shot-fired` a muzzle
  flash and a rising bolt, `shield-broken` a hue-shifted explosion. These events
  were always on the bus with nothing listening. The bolt is cosmetic only -
  shots resolve instantly in the rules, so nothing waits for it to arrive.