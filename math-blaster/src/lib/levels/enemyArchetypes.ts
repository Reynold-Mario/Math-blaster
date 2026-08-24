/**
 * What an enemy *is*, as opposed to where it currently is. Sprite choice
 * used to be the only thing separating one grunt from another - every
 * grunt fell straight down, carried one problem, and died to a single
 * exact answer regardless of which sprite it wore. An archetype is the
 * mechanical identity instead: how it moves, how many problems it takes
 * to bring down, whether it hides behind a shield, and what it leaves
 * behind when it dies.
 *
 * This module is a leaf - it owns the sprite-kind vocabulary rather than
 * importing it, so LevelDefinition can depend on archetypes without a
 * cycle. Pure data plus pure movement math; nothing here touches runtime
 * state.
 */

export type GruntKind = 'slime' | 'bat' | 'robot';
export type BossSpriteKind = 'boss1' | 'boss2';

/** How an enemy travels down the screen. Since aiming *is* horizontal
 * position, movement is the main lever on how hard something is to hit -
 * there is no health to make it tougher with instead. */
export type EnemyMovement =
  /** Straight down the lane it spawned in. */
  | 'straight'
  /** Sine-weaves around its spawn lane, so the player has to lead it. */
  | 'weave'
  /** Loiters near the top, then accelerates hard past the midline. */
  | 'dive';

export type EnemyArchetypeId =
  | 'drifter'
  | 'weaver'
  | 'diver'
  | 'bulwark'
  | 'sentinel'
  | 'splitter'
  | 'spore';

export interface EnemyArchetype {
  id: EnemyArchetypeId;
  /** Player-facing name, used by presentation code only. */
  label: string;
  sprite: GruntKind;
  movement: EnemyMovement;
  /**
   * How many problems must be worked through to destroy it, and the whole
   * of its durability - there is no health behind a layer. Each answered
   * layer mints a *fresh* problem, so a 2-layer enemy is two questions,
   * which is the point. Only exact/equivalent clears one; close and
   * partial answers knock the enemy back up the screen instead, so they
   * can never accumulate into a kill.
   */
  layers: number;
  /** Multiplies the level's authored fallSpeed range. */
  speedMultiplier: number;
  /** Drawn at the smaller pixel scale. */
  mini: boolean;
  /**
   * Starts behind a shield that only an exact/equivalent answer strips.
   * Every other verdict bounces off for nothing - the one place in the
   * game where being close genuinely isn't good enough.
   */
  shielded: boolean;
  /** How many `spore` minis it breaks into when destroyed. 0 = none. */
  splitsInto: number;
  /**
   * Whether killing it counts toward the level's enemiesToClear quota.
   * Split debris deliberately doesn't - otherwise a splitter would be
   * three cheap points of progress instead of a complication.
   */
  countsTowardClear: boolean;
  /** Scales both score and currency awarded for the kill. */
  bountyMultiplier: number;
}

// --- Movement tuning. Deliberately expressed against `y` rather than
// elapsed time, so a weave is a fixed shape in space no matter what the
// fall speed or frame rate is - and so it's testable without a clock. ---

/** Horizontal swing to either side of the spawn lane, in xPct. */
export const WEAVE_AMPLITUDE_PCT = 12;
/** Vertical distance (in y-percent) covered by one full left-right cycle. */
export const WEAVE_PERIOD_PCT = 30;
/** Below this y-percent, a diver commits and accelerates. */
export const DIVE_TRIGGER_Y_PCT = 44;
/** Speed multiplier applied to a diver once past the trigger line. */
export const DIVE_SPEED_MULTIPLIER = 2.4;
/** And before it - divers hang back at first, which is what makes the
 * commit read as a dive rather than just "fast". */
export const DIVE_APPROACH_MULTIPLIER = 0.55;

/**
 * One global brake on how fast everything descends, applied on top of each
 * level's authored fallSpeed range and each archetype's own multiplier.
 *
 * This exists as a single knob on purpose: descent speed is the pacing
 * lever for the whole game, and it needs to be tunable without touching
 * ten authored ranges and accidentally reshaping the difficulty curve
 * between levels. Lower it to give more reading time everywhere; the
 * relative pacing between levels and between archetypes is preserved
 * either way. Applied at spawn, so it reaches level grunts, boss adds and
 * splitter debris alike.
 */
export const GLOBAL_FALL_SPEED_MULTIPLIER = 0.7;

/** Enemies stay inside these lanes so a weaver can never drift somewhere
 * the player (clamped to 4-96) can't line up under. */
export const LANE_MIN_PCT = 8;
export const LANE_MAX_PCT = 92;

export function clampLane(xPct: number): number {
  return Math.max(LANE_MIN_PCT, Math.min(LANE_MAX_PCT, xPct));
}

const ARCHETYPE_LIST: EnemyArchetype[] = [
  {
    id: 'drifter',
    label: 'Drifter',
    sprite: 'slime',
    movement: 'straight',
    layers: 1,
    speedMultiplier: 1,
    mini: false,
    shielded: false,
    splitsInto: 0,
    countsTowardClear: true,
    bountyMultiplier: 1,
  },
  {
    id: 'weaver',
    label: 'Weaver',
    sprite: 'bat',
    movement: 'weave',
    layers: 1,
    speedMultiplier: 1.1,
    mini: false,
    shielded: false,
    splitsInto: 0,
    countsTowardClear: true,
    bountyMultiplier: 1.4,
  },
  {
    id: 'diver',
    label: 'Diver',
    sprite: 'bat',
    movement: 'dive',
    layers: 1,
    speedMultiplier: 1,
    mini: false,
    shielded: false,
    splitsInto: 0,
    countsTowardClear: true,
    bountyMultiplier: 1.4,
  },
  {
    id: 'bulwark',
    label: 'Bulwark',
    sprite: 'robot',
    movement: 'straight',
    layers: 2,
    speedMultiplier: 0.7,
    mini: false,
    shielded: false,
    splitsInto: 0,
    countsTowardClear: true,
    bountyMultiplier: 2,
  },
  {
    id: 'sentinel',
    label: 'Sentinel',
    sprite: 'robot',
    movement: 'straight',
    layers: 2,
    speedMultiplier: 0.6,
    mini: false,
    shielded: true,
    splitsInto: 0,
    countsTowardClear: true,
    bountyMultiplier: 2.6,
  },
  {
    id: 'splitter',
    label: 'Splitter',
    sprite: 'slime',
    movement: 'straight',
    layers: 1,
    speedMultiplier: 0.8,
    mini: false,
    shielded: false,
    splitsInto: 2,
    countsTowardClear: true,
    bountyMultiplier: 1.5,
  },
  {
    id: 'spore',
    label: 'Spore',
    sprite: 'slime',
    movement: 'weave',
    layers: 1,
    speedMultiplier: 1.25,
    mini: true,
    shielded: false,
    splitsInto: 0,
    countsTowardClear: false,
    bountyMultiplier: 0.5,
  },
];

export const ENEMY_ARCHETYPES: Record<EnemyArchetypeId, EnemyArchetype> = ARCHETYPE_LIST.reduce(
  (acc, archetype) => {
    acc[archetype.id] = archetype;
    return acc;
  },
  {} as Record<EnemyArchetypeId, EnemyArchetype>
);

export function enemyArchetype(id: EnemyArchetypeId): EnemyArchetype {
  return ENEMY_ARCHETYPES[id];
}

/** The moving parts of an enemy that its movement pattern actually reads.
 * Passing primitives rather than an EnemyInstance keeps this module free
 * of any runtime-state dependency (and trivially testable). */
export interface MovementInput {
  movement: EnemyMovement;
  /** Current vertical position, 0-100. */
  y: number;
  /** The lane the enemy was released into - a weave oscillates around
   * this, it doesn't accumulate drift. */
  anchorXPct: number;
  /** 0-1 offset into the weave cycle, so a formation of weavers doesn't
   * move as one rigid block. */
  wavePhase: number;
  /** Fall speed in y-percent per second, already scaled by archetype and
   * skill multipliers. */
  speed: number;
  dtSec: number;
}

/**
 * One frame of movement for one enemy. Pure: takes where it is, returns
 * where it now is. Horizontal position is always derived from `y` and the
 * anchor rather than integrated frame by frame, so the path is identical
 * at any frame rate and can't accumulate rounding drift.
 */
export function stepMovement(input: MovementInput): { y: number; xPct: number } {
  const { movement, anchorXPct, wavePhase, speed, dtSec } = input;

  if (movement === 'dive') {
    const committed = input.y >= DIVE_TRIGGER_Y_PCT;
    const factor = committed ? DIVE_SPEED_MULTIPLIER : DIVE_APPROACH_MULTIPLIER;
    return { y: input.y + speed * factor * dtSec, xPct: anchorXPct };
  }

  const y = input.y + speed * dtSec;

  if (movement === 'weave') {
    const cycles = y / WEAVE_PERIOD_PCT + wavePhase;
    return { y, xPct: clampLane(anchorXPct + Math.sin(cycles * Math.PI * 2) * WEAVE_AMPLITUDE_PCT) };
  }

  return { y, xPct: anchorXPct };
}
