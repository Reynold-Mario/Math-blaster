import type { ProblemDefinition } from '../math/ProblemDefinition';
import type { GruntKind, BossSpriteKind } from '../levels/LevelDefinition';
import type { EnemyArchetypeId } from '../levels/enemyArchetypes';

/** A grunt enemy actually on screen. References its ProblemDefinition and
 * its EnemyArchetype rather than duplicating either, and carries only what
 * changes moment to moment. Used both for ordinary level grunts and for
 * the reinforcement adds that appear during a boss fight - the boss itself
 * is not an EnemyInstance, see BossState. */
export interface EnemyInstance {
  uid: number;
  /** The mechanical identity: movement, layers, shield, split behaviour.
   * Everything about *how* this enemy behaves is looked up from here. */
  archetype: EnemyArchetypeId;
  /** Which sprite to draw - copied from the archetype at spawn so the
   * render layer never has to resolve an archetype itself. */
  kind: GruntKind;
  mini: boolean;
  problem: ProblemDefinition;
  /** Health of the *current layer only*, not of the whole enemy. */
  hp: number;
  maxHp: number;
  /** Layers still standing, including the one currently being chipped.
   * Emptying a layer while others remain mints a fresh problem rather
   * than killing the enemy - a multi-layer enemy is multiple questions. */
  layersRemaining: number;
  layersTotal: number;
  /** True while an intact shield is deflecting everything short of an
   * exact answer. Set from the archetype at spawn, cleared permanently
   * once broken. */
  shielded: boolean;
  xPct: number;
  /** The lane this enemy was released into. Weaving oscillates around
   * this anchor rather than integrating drift into xPct, so a weaver can
   * never wander off course. */
  anchorXPct: number;
  /** 0-1 offset into the weave cycle, so enemies released together as a
   * formation don't move in lockstep. */
  wavePhase: number;
  y: number;
  speed: number;
  frozen: boolean;
  /** Enemy is slowed while now < burnUntilMs; 0 means not currently
   * burning. Set by the Burn skill's on-hit chance. */
  burnUntilMs: number;
}

/** The player's own runtime state. Movement is restricted to horizontal,
 * along the bottom of the screen; position is what determines which
 * enemy - or the boss, or its exposed weak point - is currently targeted. */
export interface PlayerState {
  xPct: number;
  movingLeft: boolean;
  movingRight: boolean;
  inputBuffer: string;
  /** Milliseconds until the next shot can be fired - Firing Speed reduces
   * the baseline this counts down from. */
  fireCooldownRemainingMs: number;
}

/** How a boss fight ended. 'survival' is outlasting the clock; 'mastery'
 * is ending it early with a run of consecutive exact answers. */
export type BossDefeatCause = 'survival' | 'mastery';

/**
 * The boss's runtime state while its phase is active. The boss is a single
 * persistent target with its own position and current problem, separate
 * from the reinforcement EnemyInstances that appear alongside it. It
 * drifts horizontally so lining-up-to-fire stays meaningful during boss
 * fights too, not just ordinary levels.
 *
 * There is no hp here on purpose. A boss is defeated by outlasting
 * `surviveRemainingMs` or by reaching `comboRequired` consecutive exact
 * answers - correct answers cut the timer down rather than draining a
 * health bar, so the two routes are the same activity at different
 * intensities rather than two separate systems.
 */
export interface BossState {
  name: string;
  sprite: BossSpriteKind;
  /** Milliseconds left to survive. Ticks down on its own and is cut
   * further by good answers; reaching 0 wins the fight. */
  surviveRemainingMs: number;
  surviveTotalMs: number;
  /** Consecutive exact/equivalent answers landed on the boss. Anything
   * less than exact resets it to 0. */
  combo: number;
  /** Combo length that ends the fight outright. */
  comboRequired: number;
  /** Highest combo reached this fight - kept for the end-of-fight
   * readout, and unaffected by the reset. */
  bestCombo: number;
  /** Which BossPhase of the level's rules is currently running. */
  phaseIndex: number;
  /** False while the shield is up: the body is immune and the only way in
   * is the exposed weak point. */
  vulnerable: boolean;
  /** Milliseconds until the current vulnerable/shielded window flips. */
  stateRemainingMs: number;
  /** Where the weak point sits relative to the boss's own xPct while
   * shielded. Re-rolled every time the shield goes up, so the player has
   * to re-aim rather than parking in one spot. */
  weakPointOffsetPct: number;
  xPct: number;
  driftDirection: 1 | -1;
  driftSpeed: number;
  problem: ProblemDefinition;
  /** How far into the fight this is (0-1), measured against the survive
   * timer. Drives both phase selection and problem difficulty. */
  progress: number;
  /** Consecutive non-exact answers against the boss - the trigger for
   * calling in a reinforcement (see the combat system). */
  missStreak: number;
  /** True once the fight has moved past generated problems onto the
   * authored climactic finale. */
  inFinale: boolean;
  /** Set only at the moment of defeat, so the presentation layer can say
   * how the fight was won. */
  defeatedBy: BossDefeatCause | null;
}

export type StagePhase = 'level' | 'boss';

/**
 * Everything that changes during a single run, as opposed to the static
 * LevelDefinition/ProblemDefinition data describing the rules, and as
 * opposed to PlayerProfile, which persists *across* runs (currency,
 * purchased skill levels). This resets every time a run starts.
 */
export interface RuntimeState {
  stageIndex: number;
  stagePhase: StagePhase;
  score: number;
  /** Milliseconds left on the clock - the run ends at 0. Replaces the
   * earlier discrete-lives model with a single depleting time budget;
   * enemy impacts cut into it instead of costing a life. Distinct from
   * BossState.surviveRemainingMs, which is that fight's own clock. */
  timeRemainingMs: number;
  enemies: EnemyInstance[];
  player: PlayerState;
  /** Present only while stagePhase is 'boss'. */
  boss: BossState | null;
  /** Counts only kills that qualify toward the level quota - see the
   * archetype's countsTowardClear. */
  enemiesDefeated: number;
  /** Seconds until the next wave is released (level phase) or the next
   * add is called in (boss phase). */
  spawnTimer: number;
  /** Position in the current level's WavePlan. Advances past the authored
   * waves and then loops, so a level always has something to send next. */
  waveIndex: number;
  /** Consecutive incorrect/invalid answers during level play (resets on
   * any exact/equivalent/close/partial verdict) - the level-phase
   * counterpart to BossState.missStreak, gating the "repeated mistakes"
   * reinforcement rule outside of boss fights. */
  missStreak: number;
  /** Remaining cooldown (ms) before each active ability (by node id) can
   * be used again. Per-run, unlike the purchased levels themselves. */
  skillCooldowns: Record<string, number>;
  /** All enemies are frozen while now < freezeUntilMs; 0 means not
   * currently frozen. */
  freezeUntilMs: number;
}
