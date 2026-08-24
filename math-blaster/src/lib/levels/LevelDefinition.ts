import type { Operator } from '../math/ProblemDefinition';

/** The mathematical dimension of a level: what kinds of problems it draws
 * from. Kept separate from ArcadeDifficulty so either can be tuned without
 * affecting the other. */
export interface Curriculum {
  operations: Operator[];
  numberRange: [number, number];
}

/** The arcade/gameplay dimension: how intense the level feels to play,
 * independent of how hard the math is. */
export interface ArcadeDifficulty {
  fallSpeed: [number, number];
  spawnInterval: [number, number];
  maxConcurrent: number;
}

export type GruntKind = 'slime' | 'bat' | 'robot';
export type BossSpriteKind = 'boss1' | 'boss2';

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

/** Embedded boss rules for a level. A boss phase begins automatically once
 * the level's own enemy quota is cleared - it is not a separate stage in
 * its own right. The boss normally presents itself with no ordinary
 * grunts alongside it; reinforcements only appear as a consequence of
 * repeated wrong, close, or partial answers (see the combat system). */
export interface BossRules {
  name: string;
  sprite: BossSpriteKind;
  hp: number;
  /** Cumulative curriculum the boss may draw from - typically this level's
   * own curriculum plus every earlier level's, so the fight reviews
   * everything learned so far rather than only the newest material. The
   * fight is expected to draw progressively from the harder end of this
   * scope as it goes on, rather than sampling it uniformly throughout. */
  scope: Curriculum[];
  arcadeDifficulty: ArcadeDifficulty;
  /** The climactic final attack, staying within `scope` rather than
   * reaching outside it. */
  finaleProblem: AuthoredProblemRecipe;
  /** Optional distinct backdrop for the boss phase (e.g. a sunset
   * showdown). Falls back to the level's own theme when omitted. */
  theme?: StageTheme;
}

/**
 * A modular level definition: curriculum, arcade difficulty, spawning,
 * progression, and boss rules, each independently specified. This
 * describes the rules governing a level, not its current running state -
 * runtime models (enemy positions, defeat counts, boss hp remaining) live
 * separately.
 */
export interface LevelDefinition {
  id: string;
  name: string;
  world: string;
  theme: StageTheme;
  curriculum: Curriculum;
  arcadeDifficulty: ArcadeDifficulty;
  grunt: GruntKind;
  gruntTint?: string;
  /** How many grunts must be defeated before the embedded boss phase
   * begins. */
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
