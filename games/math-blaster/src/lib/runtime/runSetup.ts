import type { PlayerProfile } from './PlayerProfile';
import { currentEffect } from '../skills/SkillTree';
import { findBaseSkillNode } from '../skills/baseSkillTree';
import { WAVE_BOSS_INTERVAL, isBossWave } from '../levels/waveProgression';

/**
 * Deciding where a run starts.
 *
 * Two ways to skip ahead, deliberately different in kind:
 *
 * - The **Checkpoint** skill is bought once and applies forever. It's the
 *   answer to "I have mastered the first ten waves, stop making me replay
 *   them" - a permanent floor, free at the point of use.
 * - A **paid skip** is bought per run, out of the same currency the skill
 *   tree wants. It's the answer to "just this once, get me to the boss" and
 *   it costs every time, so it never becomes the default way to play.
 *
 * Both are clamped by `highestWaveReached`, so neither can put a player
 * into a wave they have not personally reached. Skipping skips ground
 * already covered; it never buys access to unseen content.
 *
 * Pure - every function here takes a profile and returns numbers or a new
 * profile. The Svelte layer owns the mutation, as it does for purchases.
 */

/** Currency charged per wave skipped beyond the free checkpoint. */
export const SKIP_COST_PER_WAVE = 12;
/** Paid skips move in whole boss intervals, so a skip always lands the
 * player on a boss wave rather than somewhere arbitrary. */
export const SKIP_STEP_WAVES = WAVE_BOSS_INTERVAL;

/**
 * The wave the Checkpoint skill grants, before the reached-wave clamp.
 *
 * Exported so the UI can tell "hasn't bought Checkpoint" apart from "bought
 * it but hasn't reached that wave yet" - those need different words, and
 * only the clamped figure can't distinguish them.
 */
export function checkpointWave(profile: PlayerProfile): number {
  const effect = currentEffect(findBaseSkillNode('checkpoint')!, profile.skillProgress);
  return effect.kind === 'checkpoint' ? effect.startWave : 1;
}

/** The wave the Checkpoint skill entitles this player to start from. */
export function freeStartWave(profile: PlayerProfile): number {
  return clampToReached(profile, checkpointWave(profile));
}

/** The furthest wave this player may start from by any means. */
export function maxStartWave(profile: PlayerProfile): number {
  return Math.max(1, Math.floor(profile.highestWaveReached));
}

function clampToReached(profile: PlayerProfile, wave: number): number {
  return Math.min(maxStartWave(profile), Math.max(1, Math.floor(wave)));
}

/**
 * What a paid skip from `fromWave` to `toWave` costs. Zero when it isn't
 * actually a skip forward, so a caller can price a no-op without
 * special-casing it.
 */
export function skipCost(fromWave: number, toWave: number): number {
  const waves = Math.floor(toWave) - Math.floor(fromWave);
  return waves <= 0 ? 0 : waves * SKIP_COST_PER_WAVE;
}

/** The next wave a paid skip could reach from here, or null when the
 * player has already reached their ceiling. */
export function nextSkipTarget(profile: PlayerProfile, fromWave: number): number | null {
  const target = Math.floor(fromWave) + SKIP_STEP_WAVES;
  return target > maxStartWave(profile) ? null : target;
}

export interface SkipPurchase {
  profile: PlayerProfile;
  startWave: number;
  spent: number;
}

/**
 * Charges a paid skip. Returns null - changing nothing - when the target is
 * unreachable or unaffordable, so a caller can offer the button without
 * having to re-derive whether it is legal.
 */
export function purchaseSkip(profile: PlayerProfile, fromWave: number, toWave: number): SkipPurchase | null {
  const from = clampToReached(profile, fromWave);
  const to = Math.floor(toWave);
  if (to <= from || to > maxStartWave(profile)) return null;

  const cost = skipCost(from, to);
  if (cost > profile.currency) return null;

  return {
    profile: { ...profile, currency: profile.currency - cost },
    startWave: to,
    spent: cost,
  };
}

/**
 * Records how far a run has got. Called as each wave begins, so the ceiling
 * tracks waves *reached* rather than waves survived - arriving at a wave is
 * what proves the player can get there.
 *
 * Returns the same object when nothing changed, so callers can skip a save.
 */
export function recordWaveReached(profile: PlayerProfile, waveNumber: number): PlayerProfile {
  const wave = Math.max(1, Math.floor(waveNumber));
  if (wave <= profile.highestWaveReached) return profile;
  return { ...profile, highestWaveReached: wave };
}

/** Whether starting here drops the player straight into a boss fight -
 * used by the run-setup screen to label a checkpoint honestly. */
export function startsOnBoss(waveNumber: number): boolean {
  return isBossWave(waveNumber);
}
