import type { ProblemDefinition } from '../math/ProblemDefinition';
import type { GruntKind, BossSpriteKind } from '../levels/LevelDefinition';

/** A grunt enemy actually on screen. References its ProblemDefinition
 * rather than duplicating it, and carries only what changes moment to
 * moment. Used both for ordinary level grunts and for the reinforcement
 * adds that can appear during a boss fight - the boss itself is not an
 * EnemyInstance, see BossState. */
export interface EnemyInstance {
  uid: number;
  kind: GruntKind;
  mini: boolean;
  problem: ProblemDefinition;
  hp: number;
  maxHp: number;
  xPct: number;
  y: number;
  speed: number;
  frozen: boolean;
  /** Enemy is slowed while now < burnUntilMs; 0 means not currently
   * burning. Set by the Burn skill's on-hit chance. */
  burnUntilMs: number;
}

/** The player's own runtime state. Movement is restricted to horizontal,
 * along the bottom of the screen; position is what determines which
 * enemy - or the boss - is currently targeted. */
export interface PlayerState {
  xPct: number;
  movingLeft: boolean;
  movingRight: boolean;
  inputBuffer: string;
  /** Milliseconds until the next shot can be fired - Firing Speed reduces
   * the baseline this counts down from. */
  fireCooldownRemainingMs: number;
}

/** The boss's runtime state while its phase is active. The boss is a
 * single persistent target with its own position and current problem,
 * separate from any reinforcement EnemyInstances that appear alongside
 * it. It drifts horizontally so lining-up-to-fire stays meaningful during
 * boss fights too, not just ordinary levels. */
export interface BossState {
  name: string;
  sprite: BossSpriteKind;
  hp: number;
  maxHp: number;
  xPct: number;
  driftDirection: 1 | -1;
  driftSpeed: number;
  problem: ProblemDefinition;
  /** How far into the fight this is (0-1), used to bias problem
   * difficulty upward as the fight progresses. */
  progress: number;
  /** Consecutive non-exact answers against the boss - the trigger for
   * calling in a reinforcement (see the combat system). */
  missStreak: number;
  /** True once the fight has moved past generated problems onto the
   * authored climactic finale. */
  inFinale: boolean;
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
   * enemy impacts cut into it instead of costing a life. */
  timeRemainingMs: number;
  enemies: EnemyInstance[];
  player: PlayerState;
  /** Present only while stagePhase is 'boss'. */
  boss: BossState | null;
  enemiesDefeated: number;
  spawnTimer: number;
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
