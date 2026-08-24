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
                    waves.ts (formation shapes + WavePlan traversal, fully
                    deterministic - no Math.random, so a wave index always
                    builds the same formation),
                    LevelDefinition (curriculum + arcade difficulty + wave plan +
                    progression + embedded boss rules incl. BossPhase, kept as
                    separate dimensions on purpose),
                    gameLevels.ts (the actual 7 authored levels, K-3),
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
                    playing/stageClear/gameover/victory), HUD, wires InputManager,
                    runs the rAF loop, mounts GameCanvas + SkillTreeScreen.
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
- **Spawning is wave-based.** Levels author a `WavePlan` of formations
  (line/vee/column/pincer/scatter) with explicit gaps, instead of the old
  random per-enemy trickle. Plans loop from `loopFrom` (not index 0), so the
  introductory wave plays once and a long level escalates rather than resetting
  to its own tutorial. Formations are deterministic on purpose - that's what
  makes a level learnable and `buildFormation` testable.
- **Survival is timer-based, not lives.** `RuntimeState.timeRemainingMs` starts
  at 30s (+ the More Time skill bonus) and ticks down continuously.
  Enemy impacts cut into it: **Dodge** is a chance to fully negate the penalty;
  **Armor** reduces the penalty's magnitude when it isn't dodged. These are
  independent rolls, not combined into one "avoidance chance" (an earlier,
  wrong interpretation - see git history/conversation if curious why it changed).
- **Currency is separate from score.** `score` is the per-run arcade number shown
  on the HUD and end-of-run screen only - it isn't persisted. `PlayerProfile.currency`
  is the persistent spendable resource, earned per kill (`Bounty` skill increases
  the flat amount) and spent in the Base skill tree shop between runs.
- **Boss fights are embedded in a level**, not a separate stage type. A boss
  phase auto-starts once `enemiesToClear` is hit. Its problems are drawn from a
  *cumulative* scope (this level's curriculum + every earlier one), weighted
  progressively harder as the fight goes on, culminating in an authored finale
  problem for the last 15% of the survive timer.
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

- **No grade-select screen.** `gradeTree.ts` (K-3 curriculum unlock data) is real
  and functional but nothing reads it yet - `GAME_LEVELS` in `gameLevels.ts` is
  still one flat 7-level sequence (K through Grade 3) every session plays in
  full. Wiring grade selection means deriving the session's level list from
  `topicsForGrade()` instead of the flat array.
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
- **Balance numbers are placeholders** - skill costs, knockback distances, fall
  speeds, the 30s timer, the 5s impact penalty, boss surviveSec/comboToDefeat,
  the boss timer-cut amounts. None of this has been tuned via real play; expect
  to need to adjust based on feedback, not treat as final.
- **The run clock is still global, not per-stage.** `timeRemainingMs` is set
  once in `resetRun()` and never refilled between stages - a run is meant to be
  short, with death expected and currency banked for the next attempt. This
  interacts with boss survive timers on purpose: enter a fight with less clock
  left than `surviveSec` and the endurance route is arithmetically impossible,
  leaving the combo as the only way out. That's a feature, not an oversight -
  don't "fix" it by refilling the clock per stage without deciding that's the
  design you want.
- **Freeze does not pause a boss's survive clock.** Freezing the adds buys
  breathing room; stalling the fight it's meant to win would make the skill a
  self-nerf during exactly the moment you'd want it.
- **Only 4 of 7 levels have unique art direction** in the sense of a distinct
  boss sprite - Grade 2's boss ("Hundred Hydra") reuses the boss1 sprite with a
  different name/theme/scope, since only two boss sprites exist in `sprites.ts`.
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
- Persisted localStorage key in use: `pixelMathBlaster.profile.v1` (currency +
  skill progress). Bump the version suffix if you change its shape incompatibly.
  There is no leaderboard/high-score persistence - a gameover/victory run ends
  at a "Play Again" / "Skill Tree" choice, nothing is saved beyond the profile.
- Pixel sprites are plain numeric grids + a palette (`sprites.ts`), rasterized
  once per size via `spriteCanvas.ts`'s cache - don't add per-frame `fillRect`
  loops for enemies, use `drawSprite()`.