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
  /**
   * WHICH TOPIC THIS IS, and the join key mastery is recorded against.
   *
   * It matches the id of the `gradeTree` topic node that teaches this
   * curriculum, because that tree is the curriculum spine and a topic
   * must not have two names depending on which path a problem arrived
   * through. Deliberately internal and ours: `standardCode` is the
   * external name, and it is allowed to be absent, to change, or to be
   * shared by two topics. This is not.
   */
  id: string;
  /**
   * The Common Core code, where the topic has one. **Optional and always
   * will be** - a topic without a standard is still a topic, and nothing
   * in a run may depend on the mapping existing. These were comments in
   * `gradeTree.ts` until they became data.
   */
  standardCode?: string;
  operations: Operator[];
  numberRange: [number, number];
}

/** The arcade/gameplay dimension: how intense play feels, independent of
 * how hard the math is. `maxConcurrent` caps how much can be on screen at
 * once - which for a discrete wave means its formation size, and during a
 * boss fight means how many adds can pile up. */
export interface ArcadeDifficulty {
  fallSpeed: [number, number];
  maxConcurrent: number;
}

/** A backdrop palette. Was `StageTheme` back when a run moved through
 * discrete stages; a run is now one continuous wave sequence, and these
 * are the rungs the backdrop travels along to show progress. */
export interface Backdrop {
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
 * Boss rules. A boss is a kind of WAVE, arriving on every
 * `WAVE_BOSS_INTERVAL`th one rather than when some quota is cleared - the
 * quota it used to wait on is gone along with stages. These authored bundles
 * are read as templates by `waveProgression.bossRulesFor()`, which generates
 * every number that decides how hard a fight is from the wave number; the
 * roster supplies identity only (name, sprite, theme, phase names).
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
  /**
   * How hard this fight's problems lean from the FIRST one, 0-1, on top of
   * the progressive weighting every fight already applies as its clock runs
   * down. A deep boss should not open as gently as wave 5's.
   *
   * Optional because the authored bundles don't set it - they are read as
   * templates by `waveProgression`, which always does. Absent means 0,
   * i.e. the original behaviour of opening evenly across the scope.
   */
  scopeBias?: number;
  /** The climactic final attack, staying within `scope` rather than
   * reaching outside it. Presented for the last stretch of the fight,
   * when the boss drops its shield and goes berserk. */
  finaleProblem: AuthoredProblemRecipe;
  /** Optional distinct backdrop for the boss phase (e.g. a sunset
   * showdown). Falls back to the level's own theme when omitted. */
  theme?: Backdrop;
}

/**
 * A bundle of authored source data: a curriculum, an arcade difficulty, a
 * wave plan, a backdrop palette, and optionally a boss.
 *
 * This is NO LONGER a stage the player travels to. A run is one continuous
 * sequence of waves; `waveProgression.ts` reads these bundles as the
 * material it builds that sequence out of - the curriculum ladder, the
 * wave-plan ladder, the backdrop ladder and the boss roster are all
 * assembled from them. Nothing indexes into `GAME_LEVELS` to decide "where
 * the player is" any more, and the `world` label and `enemiesToClear`
 * quota that used to encode exactly that are gone.
 */
export interface LevelDefinition {
  id: string;
  name: string;
  theme: Backdrop;
  curriculum: Curriculum;
  arcadeDifficulty: ArcadeDifficulty;
  /** What arrives and in what shape. Which archetypes appear is a property
   * of the waves, so one bundle can mix several. */
  waves: WavePlan;
  /** Present only on bundles that author a boss. */
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
