/**
 * Wave-based spawning. Enemies used to arrive as an unstructured trickle:
 * one grunt every `spawnInterval` seconds at a uniformly random lane,
 * capped by maxConcurrent. That produced no rhythm - no build, no lull,
 * nothing to read ahead of.
 *
 * A level now authors a sequence of *waves*, each a formation released at
 * once, with an explicit gap after it. The shapes are computed rather
 * than hand-placed so a wave stays one compact line of level data, and
 * they're fully deterministic (no Math.random) - the same wave index
 * always produces the same formation, which is what makes a level
 * learnable and these functions testable.
 */

import type { EnemyArchetypeId } from './enemyArchetypes';
import { clampLane } from './enemyArchetypes';

export type FormationShape =
  /** Evenly spread across the field, all released level. */
  | 'line'
  /** Evenly spread, but staggered into a downward-pointing V so the
   * centre reaches the player first. */
  | 'vee'
  /** Single lane, stacked vertically - a sustained squeeze on one column
   * that punishes staying put. */
  | 'column'
  /** Split to the far edges, leaving the middle open. Forces a choice
   * about which side to commit to. */
  | 'pincer'
  /** Spread across the field at irregular lanes and depths. Still
   * deterministic - "scatter" describes the look, not the method. */
  | 'scatter';

export interface WaveSpec {
  shape: FormationShape;
  /**
   * One entry per slot in the formation - its length IS the formation
   * size, and the entries decide what fills each slot. Mixing archetypes
   * in one wave is the point (a shielded sentinel escorted by spores
   * reads very differently from either alone).
   */
  archetypes: EnemyArchetypeId[];
  /** Seconds to wait after releasing this wave before the next one. */
  gapSec: number;
  /**
   * Vertical spacing between staggered slots, in y-percent. Slots offset
   * this way start *above* the top of the screen (negative y) and simply
   * aren't drawn until they descend into view.
   */
  staggerPct?: number;
}

export interface WavePlan {
  waves: WaveSpec[];
  /**
   * Index to loop back to once the authored waves are exhausted. Levels
   * end on an enemy quota, not on running out of waves, so there always
   * has to be something after the last one - looping from a later index
   * lets the opening waves stay introductory and never repeat.
   */
  loopFrom: number;
}

export interface FormationSlot {
  archetype: EnemyArchetypeId;
  xPct: number;
  /** Starting vertical position. 0 is the top of the screen; negative
   * values are a head-start delay expressed as distance. */
  y: number;
}

/** Formations are laid out inside these bounds rather than the full 0-100
 * so edge slots stay comfortably reachable. */
const SPREAD_MIN_PCT = 14;
const SPREAD_MAX_PCT = 86;
const DEFAULT_STAGGER_PCT = 8;
/** How far from the edges a pincer's prongs sit. */
const PINCER_INSET_PCT = 16;

/** Evenly spaces `count` slots across the spread, centring a lone slot. */
function spreadLanes(count: number): number[] {
  if (count <= 1) return [(SPREAD_MIN_PCT + SPREAD_MAX_PCT) / 2];
  const step = (SPREAD_MAX_PCT - SPREAD_MIN_PCT) / (count - 1);
  return Array.from({ length: count }, (_, i) => SPREAD_MIN_PCT + step * i);
}

/**
 * A small integer hash, used for the 'scatter' shape. A seeded hash
 * rather than Math.random keeps every formation reproducible: the same
 * wave index always scatters the same way, so a level plays the same
 * twice and tests can assert on exact positions.
 */
function hash(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function laneFor(shape: FormationShape, index: number, count: number, waveIndex: number): number {
  switch (shape) {
    case 'line':
    case 'vee':
      return spreadLanes(count)[index];
    case 'column':
      // The lane itself shifts wave to wave, so a repeating column plan
      // doesn't drill the same spot forever.
      return SPREAD_MIN_PCT + hash(waveIndex) * (SPREAD_MAX_PCT - SPREAD_MIN_PCT);
    case 'pincer': {
      const half = Math.ceil(count / 2);
      const onLeft = index < half;
      const withinSide = onLeft ? index : index - half;
      const sideCount = onLeft ? half : count - half;
      const spacing = sideCount > 1 ? 10 : 0;
      return onLeft
        ? PINCER_INSET_PCT + withinSide * spacing
        : 100 - PINCER_INSET_PCT - withinSide * spacing;
    }
    case 'scatter':
      return SPREAD_MIN_PCT + hash(waveIndex * 31 + index) * (SPREAD_MAX_PCT - SPREAD_MIN_PCT);
  }
}

function depthFor(shape: FormationShape, index: number, count: number, waveIndex: number, stagger: number): number {
  switch (shape) {
    case 'line':
    case 'pincer':
      return 0;
    case 'vee': {
      // Distance from the centre slot, so the middle of the V leads.
      const centre = (count - 1) / 2;
      return -Math.abs(index - centre) * stagger;
    }
    case 'column':
      return -index * stagger;
    case 'scatter':
      return -hash(waveIndex * 17 + index * 7) * stagger * count;
  }
}

/**
 * Turns one authored wave into concrete spawn positions. `waveIndex` only
 * feeds the deterministic variation in 'column' and 'scatter'; the other
 * shapes ignore it entirely.
 */
export function buildFormation(spec: WaveSpec, waveIndex: number): FormationSlot[] {
  const count = spec.archetypes.length;
  const stagger = spec.staggerPct ?? DEFAULT_STAGGER_PCT;

  return spec.archetypes.map((archetype, index) => ({
    archetype,
    xPct: clampLane(laneFor(spec.shape, index, count, waveIndex)),
    y: depthFor(spec.shape, index, count, waveIndex, stagger),
  }));
}

/** The wave to release at `index`, guarding against a plan whose index has
 * drifted out of range. */
export function waveAt(plan: WavePlan, index: number): WaveSpec {
  return plan.waves[index] ?? plan.waves[plan.loopFrom] ?? plan.waves[0];
}

/** Where the plan goes after `index` - onward through the authored list,
 * then back to `loopFrom` forever. */
export function nextWaveIndex(plan: WavePlan, index: number): number {
  const next = index + 1;
  if (next < plan.waves.length) return next;
  return Math.min(plan.loopFrom, plan.waves.length - 1);
}
