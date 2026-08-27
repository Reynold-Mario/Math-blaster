import type { ProblemDefinition } from '../math/ProblemDefinition';
import type { BossRules, GruntKind, BossSpriteKind } from '../levels/LevelDefinition';
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
  /** Layers still standing, including the one currently being answered.
   * There is no health behind a layer - a layer IS the question, and only
   * an exact/equivalent answer clears one. Answering a layer while others
   * remain mints a fresh problem rather than killing the enemy, so a
   * multi-layer enemy is simply multiple questions. */
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
  /**
   * Real milliseconds this fight has been on screen. Advanced from the tick
   * only, never touched by timer cuts.
   *
   * NOT derivable from `surviveTotalMs - surviveRemainingMs`, which is the
   * whole reason it exists: cuts inflate that difference, so it measures
   * "progress through the fight", not "time spent in it". The minimum-
   * duration floor needs the latter.
   */
  elapsedMs: number;
  /**
   * The shortest this fight may last. Timer cuts clamp against it, so
   * answering well compresses the phase ladder into this window rather
   * than skipping past it - and the combo stays landable, which it is not
   * if good answers can end a fight before the combo has room to finish.
   *
   * The combo route is deliberately exempt: reaching `comboRequired` ends
   * the fight immediately whatever this says. That is what defeating a
   * boss means.
   */
  minFightMs: number;
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

/** What the run is currently doing. A boss is a *kind of wave* now, not a
 * phase of a stage - there are no stages left to be a phase of. */
export type RunPhase = 'wave' | 'boss';

/**
 * Everything that changes during a single run, as opposed to the authored
 * LevelDefinition/ProblemDefinition data it is built from, and as opposed
 * to PlayerProfile, which persists *across* runs (currency, purchased
 * skill levels). This resets every time a run starts.
 */
export interface RuntimeState {
  /** Which wave the run is on, 1-based and global. This is the run's whole
   * sense of position - there is no stage index any more, and the number
   * is what the HUD shows, what the boss cadence divides, and what a
   * checkpoint starts you at. */
  waveNumber: number;
  runPhase: RunPhase;
  score: number;
  /** Milliseconds left on the clock - the run ends at 0. Replaces the
   * earlier discrete-lives model with a single depleting time budget;
   * enemy impacts cut into it instead of costing a life. Distinct from
   * BossState.surviveRemainingMs, which is that fight's own clock. */
  timeRemainingMs: number;
  enemies: EnemyInstance[];
  player: PlayerState;
  /** Present only while runPhase is 'boss'. */
  boss: BossState | null;
  /** The rules the current fight is running under. Bosses are generated
   * from a wave number now rather than authored on a stage, so the run has
   * to hold onto the ones it generated - there's no level to look them up
   * on. Present exactly when `boss` is. */
  bossRules: BossRules | null;
  /** Qualifying kills this run, for score and end-of-run readout only. It
   * no longer gates anything: the boss cadence is a wave count. */
  enemiesDefeated: number;
  /** Qualifying kills in the current wave - what the wave-clear payout is
   * measured against, so leaking enemies costs the bonus as well as the
   * clock. */
  enemiesDefeatedThisWave: number;
  /** Reinforcements called in during the current wave. Capped, because a
   * wave ends when the board empties and unbounded reinforcements could
   * keep one going indefinitely. */
  reinforcementsThisWave: number;
  /** How many enemies the current wave released, so the HUD can show
   * progress through it. */
  waveSize: number;
  /**
   * Seconds before the boss may call in another reinforcement. Boss-phase
   * only - an ordinary wave releases once, all at once.
   *
   * A COOLDOWN, NOT A SPAWN CLOCK. Reaching zero doesn't summon anything;
   * it only means the next failed answer is allowed to. It used to be a
   * spawn clock, which meant adds arrived on a timer regardless of how the
   * player was doing - reinforcements now come only from the player
   * disengaging, and this is what stops a run of bad answers dumping the
   * whole screenful at once.
   */
  bossReinforceCooldownSec: number;
  /** Seconds before the current wave releases. Every wave opens with one
   * of these, so a wave arrives as an announced event and the countdown
   * never hands the player a formation already halfway down the screen. */
  waveBreatherSec: number;
  /** Consecutive incorrect/invalid answers during wave play (resets on
   * any exact/equivalent/close/partial verdict) - the wave-phase
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
