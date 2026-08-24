import type { Operator } from '../math/ProblemDefinition';
import type { EnemyArchetypeId, GruntKind, BossSpriteKind } from './enemyArchetypes';
import type { WavePlan } from './waves';

// Sprite-kind vocabulary now lives with the archetypes that reference it
// (enemyArchetypes.ts is the leaf module), re-exported here so everything
// that already imported these types from LevelDefinition still can.
export type { GruntKind, BossSpriteKind };

/** The mathematical dimension of a level: what kinds of problems it draws
 * from. Kept separate from ArcadeDifficulty so either can be tuned without
 * affecting the other. */
export interface Curriculum {
  operations: Operator[];
  numberRange: [number, number];
}

/** The arcade/gameplay dimension: how intense the level feels to play,
 * independent of how hard the math is. Spawn *timing* has moved out to
 * the wave plan - what's left here is how fast things fall once released
 * and how much can be on screen at once. */
export interface ArcadeDifficulty {
  fallSpeed: [number, number];
  maxConcurrent: number;
}

export interface StageTheme {
  name: string;
  sky1: string;
  sky2: string;
  ground: string;
}

/** A hand-placed recipe for a specific problem - not yet a built
 * ProblemDefinition, since building one mints a runtime id. The boss
 * finale is authored here as data; something in the game-flow layer turns
 * it into a real problem only when the finale actually begins. */
export interface AuthoredProblemRecipe {
  operator: Operator;
  left: number;
  right: number;
}

/**
 * One segment of a boss fight. Phases are gated on how much of the
 * survive timer has elapsed rather than on damage dealt, since the boss
 * has no health to gate on - each phase owns a slice of the fight and
 * decides how the boss behaves during it.
 */
export interface BossPhase {
  name: string;
  /** Relative share of the survive timer this phase occupies. Weights are
   * normalised across the phase list, so they read as proportions rather
   * than needing to sum to anything in particular. */
  weight: number;
  /** How fast the boss slides side to side during this phase. */
  driftSpeed: number;
  /** Seconds between reinforcement adds while this phase is running. */
  addInterval: [number, number];
  /** What it calls in. Escalating this across phases is the main way a
   * fight ramps. */
  addArchetype: EnemyArchetypeId;
  /** Seconds the boss stays open to fire before raising its shield again.
   * Only meaningful when shieldedSec > 0. */
  vulnerableSec: number;
  /**
   * Seconds the shield holds if its weak point is never hit. 0 means this
   * phase never shields at all - the opening phase of every fight is
   * deliberately shield-free so the mechanic is introduced, not sprung.
   */
  shieldedSec: number;
}

/**
 * Embedded boss rules for a level. A boss phase begins automatically once
 * the level's own enemy quota is cleared - it is not a separate stage in
 * its own right.
 *
 * Bosses have no health bar. A fight ends one of two ways: the player
 * outlasts `surviveSec`, or they string together `comboToDefeat`
 * consecutive exact answers, which ends it immediately. The first is the
 * endurance route, the second is the mastery route - answering correctly
 * also shaves time off the survive clock, so playing well makes the
 * endurance route shorter rather than being a separate activity from it.
 */
export interface BossRules {
  name: string;
  sprite: BossSpriteKind;
  /** How long the player must last. Correct answers cut into this, so
   * it's a ceiling on the fight's length, not a fixed duration. */
  surviveSec: number;
  /** Consecutive exact/equivalent answers that end the fight outright.
   * Anything less than exact breaks the run - this is the one place the
   * game asks for mastery rather than effort. */
  comboToDefeat: number;
  /** Cumulative curriculum the boss may draw from - typically this level's
   * own curriculum plus every earlier level's, so the fight reviews
   * everything learned so far rather than only the newest material. The
   * fight is expected to draw progressively from the harder end of this
   * scope as it goes on, rather than sampling it uniformly throughout. */
  scope: Curriculum[];
  /** Governs the adds a boss calls in, not the boss itself. */
  arcadeDifficulty: ArcadeDifficulty;
  /** Ordered easiest-to-hardest; the fight walks through them as the
   * survive timer drains. Must not be empty. */
  phases: BossPhase[];
  /** The climactic final attack, staying within `scope` rather than
   * reaching outside it. Presented for the last stretch of the fight,
   * when the boss drops its shield and goes berserk. */
  finaleProblem: AuthoredProblemRecipe;
  /** Optional distinct backdrop for the boss phase (e.g. a sunset
   * showdown). Falls back to the level's own theme when omitted. */
  theme?: StageTheme;
}

/**
 * A modular level definition: curriculum, arcade difficulty, wave
 * structure, progression, and boss rules, each independently specified.
 * This describes the rules governing a level, not its current running
 * state - runtime models (enemy positions, defeat counts, boss timer
 * remaining) live separately.
 */
export interface LevelDefinition {
  id: string;
  name: string;
  world: string;
  theme: StageTheme;
  curriculum: Curriculum;
  arcadeDifficulty: ArcadeDifficulty;
  /** What arrives, in what shape, and how often. Replaces the old single
   * `grunt` sprite kind - which archetypes a level uses is now a property
   * of its waves, so one level can mix several. */
  waves: WavePlan;
  /** How many qualifying grunts must be defeated before the embedded boss
   * phase begins. Split debris doesn't qualify - see the archetype's
   * countsTowardClear. */
  enemiesToClear: number;
  /** Present only on levels that culminate in a boss fight. */
  boss?: BossRules;
}

/** Convenience for building a boss's cumulative scope from the levels that
 * precede it (and itself), so level data doesn't need to hand-copy
 * curricula when wiring up a boss. */
export function cumulativeScope(...levels: LevelDefinition[]): Curriculum[] {
  return levels.map((l) => l.curriculum);
}

/**
 * Which phase a fight is in, given how much of the survive timer has
 * elapsed (0-1). Weights are treated as proportions of the whole fight.
 * Pure, so the phase schedule can be reasoned about without running a
 * fight.
 */
export function phaseIndexForProgress(phases: BossPhase[], progress: number): number {
  if (phases.length === 0) throw new Error('Boss has no phases.');
  const totalWeight = phases.reduce((sum, p) => sum + p.weight, 0);
  if (totalWeight <= 0) return 0;

  const clamped = Math.max(0, Math.min(1, progress));
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    acc += phases[i].weight / totalWeight;
    if (clamped < acc) return i;
  }
  return phases.length - 1;
}
