# Pixel Math Blaster

Pixel-art arcade math shooter for K-3 kids. Svelte 5 (runes) + TypeScript + Vite.
Gameplay renders on `<canvas>`; Svelte owns UI chrome only.

Commands: `npm run dev` / `npm run build` / `npm run preview` / `npm run check`
(`check` = svelte-check + tsc). Always run `npm run check` after edits - the
whole codebase currently passes with 0 errors/warnings; keep it that way.

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

lib/runtime/         RuntimeState (resets every run) vs PlayerProfile (currency +
                    skill levels, PERSISTS across runs via localStorage - these
                    were once the same object; keep them separate).
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
                    hit-flash, shake) by subscribing to gameEvents - it never
                    touches gameplay logic. spriteCanvas.ts rasterizes the
                    pixel-grid SpriteDefs (sprites.ts) onto canvas, cached.

lib/input/            InputManager abstracts keyboard/touch/future-gamepad into
                    one action vocabulary (move/moveTo/digit/backspace/fire/skill).

lib/Game.svelte       Top-level orchestrator: phases (boot/skillTree/countdown/
                    playing/gameover), HUD, wires InputManager, runs the rAF
                    loop, mounts GameCanvas + SkillTreeScreen.
App.svelte           Arcade cabinet chrome (marquee/bezel/scanlines) around Game.
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
- **Enemies are archetypes, not sprites.** Slime/bat/robot used to be purely
  cosmetic. Now `EnemyArchetype` owns movement (straight/weave/dive), how many
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
  It holds at the last rung instead of wrapping (putting the opening garden
  back on screen at wave 90 would read as losing progress), and a boss wave
  with no authored palette of its own darkens where it is rather than jumping
  somewhere unrelated. Colour parsing falls back to an unblended end rather
  than to black, so a malformed palette can't paint the scene out.
- **DIFFICULTY OF THE MATHS IS THE PLAYER'S GRADE, NOT THE WAVE NUMBER.**
  `gradeTree.ts` is the curriculum spine (it was dead code; now everything is
  drawn through it). `curriculumLadderForGrade()` gives a run that grade's
  topics *and nothing harder*, and `curriculumForWave` holds at the last rung -
  so a six-year-old having an excellent run gets faster and busier waves, never
  times tables. `gameFlow.curriculumLadder()` is the single seam every problem
  comes through; `gradeTree.test.ts` and `gameFlow.test.ts` both pin the
  containment property out past wave 300. Arcade difficulty still scales with
  the wave number - that separation is the point.
- **Boss scope is cumulative, wave scope is not.** `cumulativeScopeForGrade()`
  spans K up through the run's grade, because waves teach this grade and bosses
  test everything up to it. It must stay ordered easiest-first:
  `generateBossProblem` weights selection toward the end of the array as a
  fight goes on, so an out-of-order scope would make a fight get *easier*.
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
  for surviving a boss. That's what makes a long run possible at all - as a
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
- **A boss is a kind of wave**, arriving on every `WAVE_BOSS_INTERVAL`th one
  (5). Boss *identity* (name, sprite, phases, finale) cycles the authored
  `BOSS_ROSTER`, escalating `surviveSec`/`comboToDefeat` and taking a tier
  prefix on each pass; boss *maths* arrives separately as `scope`. That split
  is what lets a boss appear on wave 5 for any curriculum - only 2 of the 7
  authored bundles wrote a boss at all. Because the rules are generated rather
  than authored per stage, the run holds them in `RuntimeState.bossRules` for
  the duration of the fight; there is no level to look them up on.
  Problems are drawn from a *cumulative* scope, weighted progressively harder
  as the fight goes on, culminating in an authored finale problem for the last
  15% of the survive timer.
- **Beating a boss drops straight into the next wave.** No stage-clear screen,
  no Continue button, no victory state. The banner in GameCanvas is the only
  thing that reports how the fight was won, so don't remove it.
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
- **Boss adds are ordinary enemies.** Shooting one no longer damages the boss
  (it used to). They matter because they threaten the run clock, nothing else.
- **Partial credit uses place-value digit matching** (ones/tens/etc. compared by
  position), not "contains these digits somewhere" - e.g. 24 vs 42 scores zero
  matching digits despite sharing digits, because place value is the point.

## Known gaps / deliberate scope boundaries

Don't "fix" these without checking - they're intentional stopping points, not bugs:

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
  ~wave 10 for a slow K player, ~20 for a typical G1, ~28 for a quick G3.
  The player model is the assumption to argue with; the numbers only mean as
  much as it does, and no real child has played this yet.
- **Still untuned placeholders**: skill costs and the currency rate (a weak
  run earns ~55, against 60 for one More Time level - so the shop is roughly
  two runs per early upgrade, which nobody has checked is right), knockback
  distances, boss surviveSec/comboToDefeat, the boss timer-cut amounts.
- **A boss fight can still be arithmetically unwinnable by endurance**, and
  that's deliberate: walk in with less clock than its `surviveSec` and the
  combo is the only way out. Wave-clear payouts make that recoverable rather
  than a dead end, which is the point - don't "fix" it by topping the clock up
  when a boss starts.
- **Freeze does not pause a boss's survive clock.** Freezing the adds buys
  breathing room; stalling the fight it's meant to win would make the skill a
  self-nerf during exactly the moment you'd want it.
- **Only two boss sprites exist** in `sprites.ts`, so the roster's three fights
  share them - "Hundred Hydra" reuses boss1 with a different name/theme/phases.
  A cycled roster makes this more visible than it was, which is why repeat
  visits take a tier prefix ("Elder", "Ancient", "Eternal").
- **Shields, weak points and layer pips are drawn, not sprited.** GameCanvas
  composes them from canvas primitives so they work over every silhouette
  without new pixel art. If you add archetype-specific art later, that's where
  it goes - not into new EnemyInstance fields.

## Conventions worth keeping

- Skill effects are a discriminated union (`BaseSkillEffect`) with `effectAtLevel(0)`
  always meaning "not purchased yet" - safe to call before any purchase exists.
- New `GameEvent` variants: add the type, then update both `GameCanvas.svelte`'s
  and `audio.ts`'s event handlers (they interpret independently; neither should
  need the other to know a new event exists).
- Persisted localStorage key in use: `pixelMathBlaster.profile.v1` (currency,
  skill progress, selected grade, furthest wave reached). Every field added
  since v1 has been additive with a validated fallback, which is why the suffix
  hasn't moved - bump it only for a change that makes an old profile *wrong*
  rather than incomplete.
  There is no leaderboard/high-score persistence - a run ends at a "Play Again"
  / "Skill Tree" choice, nothing is saved beyond the profile. The end-of-run
  screen reports the wave reached, which is the number that means something in
  an endless run.
- Pixel sprites are plain numeric grids + a palette (`sprites.ts`), rasterized
  once per size via `spriteCanvas.ts`'s cache - don't add per-frame `fillRect`
  loops for enemies, use `drawSprite()`.