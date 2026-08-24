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

lib/levels/         LevelDefinition (curriculum + arcade difficulty + progression +
                    embedded boss rules, kept as separate dimensions on purpose),
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

lib/combat.ts        Takes an AnswerResult, decides damage/reinforcement/defeat.
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
damage, or `gameFlow.ts` call `sfx.*()` directly, or `GameCanvas` read game rules
instead of events - stop, that's the exact coupling this structure exists to avoid.

## Core mechanics

- **Targeting is positional.** Player moves horizontally along the bottom; you
  must line up under an enemy (or the boss) to hit it. `resolveTarget()` picks
  the nearest-to-impact aligned enemy, falling back to the boss only when
  nothing else is aligned.
- **Survival is timer-based, not lives.** `RuntimeState.timeRemainingMs` starts
  at 30s (+ More Time / Health Pool skill bonuses) and ticks down continuously.
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
  problem once boss HP drops below 15%.
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
  being shown eleven skills at once. Gates carry a `{ kind: 'branch' }` effect
  that grants nothing; they exist purely to pace the shop. Armor behind Dodge
  Lv.1 is the only skill-to-skill chain. `baseSkillTree.test.ts` pins down what
  is reachable at each stage - update it if you rewire prerequisites.
- **Grades 4-5 don't exist.** Would need fraction/decimal problem *generation*
  (the evaluator already supports fraction/decimal `MathValue`s - the generator
  in `problemGenerators.ts` only ever produces integers).
- **Health Pool's meaning changed mid-project**: originally granted bonus lives;
  when lives were replaced by the timer, it was repurposed to grant bonus
  starting time instead (keeping its enemy-HP-increase trade-off). If you see
  references to "bonus lives" anywhere, that's stale.
- **Balance numbers are placeholders** - skill costs, damage percentages, fall
  speeds, the 30s timer, the 5s impact penalty. None of this has been tuned via
  real play; expect to need to adjust based on feedback, not treat as final.
- **Only 4 of 7 levels have unique art direction** in the sense of a distinct
  boss sprite - Grade 2's boss ("Hundred Hydra") reuses the boss1 sprite with a
  different name/theme/scope, since only two boss sprites exist in `sprites.ts`.

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