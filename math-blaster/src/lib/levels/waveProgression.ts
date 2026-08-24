/**
 * The endless wave ladder: everything that used to be answered by "which
 * stage are we on" is answered here by "which wave number is this".
 *
 * A run used to walk a fixed array of seven stages, each with its own
 * curriculum, fall speeds, wave plan and boss, separated by a blocking
 * "Stage Clear" screen. That structure is gone. A run is now one
 * uninterrupted stream of numbered waves, and this module is the single
 * place that turns a wave number into what that wave actually is.
 *
 * Everything here is pure and deterministic - no Math.random, no state -
 * for the same reason `waves.ts` is: wave 12 must be wave 12 every time,
 * or the wave number stops being a meaningful thing to talk about (and
 * the checkpoint that starts you at wave 15 stops meaning anything).
 *
 * The authored bundles in `gameLevels.ts` are the raw material. This
 * module reads their ladders; it never treats one as a place the player
 * has arrived at.
 */

import type { ArcadeDifficulty, Backdrop, BossRules, Curriculum } from './LevelDefinition';
import type { WaveSpec } from './waves';
import {
  BACKDROP_LADDER,
  BOSS_ROSTER,
  CURRICULUM_LADDER,
  WAVE_PLAN_LADDER,
} from './gameLevels';

/** A boss arrives on every Nth wave. Frequent on purpose: a boss is the
 * point of a run, and the old structure buried the first one behind three
 * stages of grinding that nobody ever got through. */
export const WAVE_BOSS_INTERVAL = 5;

/** Waves spent on one curriculum before the run steps up to the next. */
const WAVES_PER_CURRICULUM = 4;
/** Waves spent on one backdrop rung. Deliberately not equal to
 * WAVES_PER_CURRICULUM, so the look and the maths don't change in
 * lockstep and the backdrop reads as travel rather than as a label for
 * what you're being asked. */
const WAVES_PER_BACKDROP = 3;

// --- Difficulty ramp. The authored bundles ran from [8,12] fall speed and
// 3 concurrent up to [13,18] and 5; the ramp reproduces that curve across
// its first stretch and then keeps creeping, because an endless run has
// to stay able to out-scale the player. ---

const RAMP_START: ArcadeDifficulty = { fallSpeed: [8, 12], maxConcurrent: 3 };
const RAMP_END: ArcadeDifficulty = { fallSpeed: [13, 18], maxConcurrent: 5 };
/** Wave at which the ramp reaches RAMP_END. */
const RAMP_WAVES = 30;
/** Fall speed added per wave once past the ramp. */
const ENDLESS_SPEED_CREEP = 0.12;
/** Waves past the ramp per additional concurrent enemy. */
const WAVES_PER_EXTRA_SLOT = 12;
/** However long a run goes on, a formation never gets wider than this -
 * past it the screen stops being readable, which isn't difficulty. */
const MAX_CONCURRENT_CAP = 8;

/** Seconds each boss cycle adds to the survive clock, and the combo grows
 * by one per cycle alongside it. */
const BOSS_SURVIVE_STEP_SEC = 4;
/** Prefixes for repeat visits from the same boss, so a cycled roster still
 * announces itself as an escalation rather than a repeat. */
const BOSS_TIER_PREFIXES = ['', 'Elder ', 'Ancient ', 'Eternal '];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/** Picks from an easiest-first ladder by wave number, holding at the last
 * rung forever rather than wrapping - a run that goes long should stay at
 * its hardest, not reset to the tutorial. */
function rungFor<T>(ladder: T[], waveNumber: number, wavesPerRung: number): T {
  const index = Math.floor(Math.max(0, waveNumber - 1) / wavesPerRung);
  return ladder[Math.min(index, ladder.length - 1)];
}

export function isBossWave(waveNumber: number): boolean {
  return waveNumber > 0 && waveNumber % WAVE_BOSS_INTERVAL === 0;
}

/** Which boss fight this is, 1-based. Only meaningful on a boss wave. */
export function bossOrdinal(waveNumber: number): number {
  return Math.floor(waveNumber / WAVE_BOSS_INTERVAL);
}

/**
 * How many ordinary combat waves precede this one, 0-based - i.e. this
 * wave's index into the wave-plan ladder. Boss waves consume a number in
 * the sequence without consuming a formation, so this is *not* just
 * `waveNumber - 1`.
 */
function combatWaveIndex(waveNumber: number): number {
  const bossesBefore = Math.floor(Math.max(0, waveNumber - 1) / WAVE_BOSS_INTERVAL);
  return Math.max(0, waveNumber - 1 - bossesBefore);
}

export function arcadeDifficultyFor(waveNumber: number): ArcadeDifficulty {
  const t = clamp01((waveNumber - 1) / (RAMP_WAVES - 1));
  const beyond = Math.max(0, waveNumber - RAMP_WAVES);
  const creep = beyond * ENDLESS_SPEED_CREEP;

  return {
    fallSpeed: [
      lerp(RAMP_START.fallSpeed[0], RAMP_END.fallSpeed[0], t) + creep,
      lerp(RAMP_START.fallSpeed[1], RAMP_END.fallSpeed[1], t) + creep,
    ],
    maxConcurrent: Math.min(
      MAX_CONCURRENT_CAP,
      Math.round(lerp(RAMP_START.maxConcurrent, RAMP_END.maxConcurrent, t)) +
        Math.floor(beyond / WAVES_PER_EXTRA_SLOT)
    ),
  };
}

/** Flattens the authored plans into one easiest-first list of formations.
 * Each plan contributes its waves in order, so a bundle's introductory
 * wave still leads its own stretch. */
const AUTHORED_SPECS: WaveSpec[] = WAVE_PLAN_LADDER.flatMap((plan) => plan.waves);

/** The stretch the endless tail cycles once the authored specs run out -
 * the hardest third, so a long run keeps facing late-game formations
 * rather than looping back through the gentle ones. */
const TAIL_SPECS: WaveSpec[] = AUTHORED_SPECS.slice(Math.floor((AUTHORED_SPECS.length * 2) / 3));

/**
 * The formation this wave sends. Runs through every authored wave once,
 * then cycles the hardest stretch, widening it and tightening its gap on
 * each pass so the tail escalates instead of plateauing. Always capped by
 * the wave's own maxConcurrent, so it stays readable.
 */
export function waveSpecFor(waveNumber: number): WaveSpec {
  const index = combatWaveIndex(waveNumber);
  const cap = arcadeDifficultyFor(waveNumber).maxConcurrent;

  const base =
    index < AUTHORED_SPECS.length
      ? AUTHORED_SPECS[index]
      : TAIL_SPECS[(index - AUTHORED_SPECS.length) % TAIL_SPECS.length];

  const cycles =
    index < AUTHORED_SPECS.length
      ? 0
      : Math.floor((index - AUTHORED_SPECS.length) / TAIL_SPECS.length) + 1;

  // Grow by repeating the formation's own archetypes rather than splicing
  // in new ones: a wider version of a wave you've learned to read is an
  // escalation, an unfamiliar mix is a different wave.
  const archetypes = [...base.archetypes];
  for (let i = 0; i < cycles && archetypes.length < cap; i++) {
    archetypes.push(base.archetypes[i % base.archetypes.length]);
  }

  return {
    ...base,
    archetypes: archetypes.slice(0, Math.max(1, cap)),
    gapSec: Math.max(1.6, base.gapSec - cycles * 0.2),
  };
}

/** The curriculum this wave's problems are drawn from. Walks up an
 * easiest-first ladder and then holds - it never reaches past the ladder
 * it was handed, which is what keeps a run inside the maths the player is
 * actually meant to be practising. */
export function curriculumForWave(ladder: Curriculum[], waveNumber: number): Curriculum {
  return rungFor(ladder, waveNumber, WAVES_PER_CURRICULUM);
}

/** Everything from the ladder up to and including this wave's rung, so a
 * boss reviews what has been played rather than only the newest material.
 * Ordered easiest-first, which `generateBossProblem` relies on. */
export function bossScopeForWave(ladder: Curriculum[], waveNumber: number): Curriculum[] {
  const index = Math.floor(Math.max(0, waveNumber - 1) / WAVES_PER_CURRICULUM);
  return ladder.slice(0, Math.min(index, ladder.length - 1) + 1);
}

/**
 * The boss for this wave. Identity (name, sprite, phases, finale) is
 * cycled from the authored roster; the maths comes in as `scope`, and the
 * numbers that decide how hard the fight is scale with how many bosses
 * deep the run has got.
 *
 * Splitting it this way is what lets a boss appear on wave 5 regardless of
 * curriculum - the roster's three fights were authored on three different
 * bundles, and only two of the seven bundles authored one at all.
 */
export function bossRulesFor(waveNumber: number, scope: Curriculum[]): BossRules {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  const template = BOSS_ROSTER[(ordinal - 1) % BOSS_ROSTER.length];
  const cycle = Math.floor((ordinal - 1) / BOSS_ROSTER.length);
  const prefix = BOSS_TIER_PREFIXES[Math.min(cycle, BOSS_TIER_PREFIXES.length - 1)];

  return {
    ...template,
    name: `${prefix}${template.name}`,
    scope,
    surviveSec: template.surviveSec + cycle * BOSS_SURVIVE_STEP_SEC,
    comboToDefeat: template.comboToDefeat + cycle,
    arcadeDifficulty: arcadeDifficultyFor(waveNumber),
  };
}

/** The backdrop for this wave. A step per rung for now; it becomes a
 * continuous transition so the backdrop reads as distance travelled. */
export function backdropForWave(waveNumber: number): Backdrop {
  return rungFor(BACKDROP_LADDER, waveNumber, WAVES_PER_BACKDROP);
}

/** The default curriculum ladder - every authored curriculum, easiest
 * first. Callers pass a ladder in rather than having one imposed, so a
 * grade-scoped ladder can be substituted without touching this module. */
export { CURRICULUM_LADDER as DEFAULT_CURRICULUM_LADDER };
