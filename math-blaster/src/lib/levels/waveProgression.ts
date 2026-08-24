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
/**
 * Waves spent travelling between two backdrop rungs.
 *
 * Deliberately not equal to WAVES_PER_CURRICULUM, so the look and the maths
 * don't change in lockstep - the backdrop reads as distance travelled
 * rather than as a label for what you're being asked.
 */
const WAVES_PER_BACKDROP = 3;
/** How far the backdrop darkens during a boss wave. The authored boss
 * palettes still override this entirely; this is what a *generated* boss
 * wave gets when its roster entry didn't author one. */
const BOSS_BACKDROP_DARKEN = 0.22;

// --- Difficulty ramp. Fall speed traces the curve the authored bundles
// described ([8,12] up to [13,18]) and then keeps creeping, because an
// endless run has to stay able to out-scale the player.
//
// Concurrency deliberately does NOT trace that curve. The bundles opened at
// 3 on screen, which measured as the single harshest number in the game for
// the audience it is for: a child who needs most of a descent to answer one
// problem leaks everything past the first, so the third arrival was pure
// clock penalty rather than difficulty. It opens at 2 and climbs past where
// the bundles ended instead, which puts the pressure in the middle of a run
// where a player has upgrades and reading speed to meet it. ---

const RAMP_START: ArcadeDifficulty = { fallSpeed: [8, 12], maxConcurrent: 2 };
const RAMP_END: ArcadeDifficulty = { fallSpeed: [13, 18], maxConcurrent: 6 };
/** Wave at which the ramp reaches RAMP_END. */
const RAMP_WAVES = 26;
/** Fall speed added per wave once past the ramp. */
const ENDLESS_SPEED_CREEP = 0.16;
/** Waves past the ramp per additional concurrent enemy. */
const WAVES_PER_EXTRA_SLOT = 10;
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
 * The widest formation anyone ever authored. It's the line between "this
 * wave is as the designer wrote it" and "the ladder has run out of authored
 * material and is now generating escalation", which is what
 * `waveSpecFor` uses to decide whether widening is allowed at all.
 */
const AUTHORED_CEILING: number = AUTHORED_SPECS.reduce((n, s) => Math.max(n, s.archetypes.length), 1);

/**
 * The formation this wave sends, always capped by the wave's own
 * maxConcurrent so it stays readable.
 *
 * `maxConcurrent` is a two-sided knob here, and the two sides matter at
 * opposite ends of a run:
 *
 * - Below `AUTHORED_CEILING` it TRIMS. The early ramp starts under the
 *   width of the authored openers, so wave 3's trio arrives as a pair -
 *   which is the whole early-game difficulty curve, because a child who
 *   can only answer one problem per descent leaks every enemy past the
 *   first regardless of how many were sent.
 * - Above it, it WIDENS, by repeating the formation's own archetypes
 *   rather than splicing in new ones: a wider version of a wave you have
 *   learned to read is an escalation, an unfamiliar mix is a different
 *   wave.
 *
 * Widening deliberately does NOT wait for the authored specs to run out.
 * It used to, and that made the cap inert for the whole mid-game - every
 * authored formation is at most `AUTHORED_CEILING` wide, so raising the
 * ramp changed nothing until the tail began cycling some thirty waves in,
 * and a player quick enough to clear four enemies simply coasted until
 * then. Tying it to the cap instead means the ramp is what escalates the
 * mid-game, and the authored waves are still authored right up until the
 * point the ramp asks for more than anyone wrote.
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

  // Two independent reasons to widen: the ramp has outgrown the authored
  // material, or the tail is on a repeat pass. Whichever asks for more wins.
  const extraSlots = Math.max(cycles, cap - AUTHORED_CEILING);

  const archetypes = [...base.archetypes];
  for (let i = 0; i < extraSlots && archetypes.length < cap; i++) {
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

// --- Backdrop interpolation. Progress is the one thing a player can't
// read off the HUD at a glance - a wave number tells you where you are but
// not how far you've come. The backdrop is what carries that, which is why
// it moves continuously rather than switching between palettes: a set
// change reads as "somewhere else", a gradient reads as travel. ---

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parses #rgb or #rrggbb. Returns null for anything else, so a malformed
 * authored palette degrades to "don't interpolate" rather than to black. */
function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace('#', '');
  if (raw.length === 3) {
    const [r, g, b] = raw.split('').map((c) => parseInt(c + c, 16));
    return [r, g, b].some(Number.isNaN) ? null : [r, g, b];
  }
  if (raw.length === 6) {
    const parts = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)].map((c) => parseInt(c, 16));
    return parts.some(Number.isNaN) ? null : [parts[0], parts[1], parts[2]];
  }
  return null;
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Blends two colours. Falls back to whichever end is parseable rather
 * than inventing one, so a bad palette can never paint the scene black. */
function mixColor(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a) return to;
  if (!b) return from;
  return toHex([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
}

function darken(hex: string, amount: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex([rgb[0] * (1 - amount), rgb[1] * (1 - amount), rgb[2] * (1 - amount)]);
}

/**
 * The backdrop for this wave: a continuous blend along the palette ladder,
 * so consecutive waves are never quite the same colour and a player can
 * see how far they've come.
 *
 * Holds at the last rung rather than wrapping. A long run should look like
 * it ended up somewhere, not like it went round in a circle - and wrapping
 * would put the opening garden back on screen at wave 90, which reads as
 * losing progress.
 *
 * `name` comes from whichever rung is nearer, so the backdrop always has a
 * sensible label even mid-blend.
 */
export function backdropForWave(waveNumber: number): Backdrop {
  const position = Math.max(0, waveNumber - 1) / WAVES_PER_BACKDROP;
  const index = Math.min(Math.floor(position), BACKDROP_LADDER.length - 1);
  const next = Math.min(index + 1, BACKDROP_LADDER.length - 1);
  const t = index === next ? 0 : position - index;

  const from = BACKDROP_LADDER[index];
  const to = BACKDROP_LADDER[next];
  const blended: Backdrop = {
    name: t < 0.5 ? from.name : to.name,
    sky1: mixColor(from.sky1, to.sky1, t),
    sky2: mixColor(from.sky2, to.sky2, t),
    ground: mixColor(from.ground, to.ground, t),
  };

  // A boss wave whose roster entry authored no backdrop of its own still
  // needs to look like an event, so it darkens where it is rather than
  // jumping to somewhere unrelated.
  if (!isBossWave(waveNumber)) return blended;
  return {
    name: blended.name,
    sky1: darken(blended.sky1, BOSS_BACKDROP_DARKEN),
    sky2: darken(blended.sky2, BOSS_BACKDROP_DARKEN),
    ground: darken(blended.ground, BOSS_BACKDROP_DARKEN),
  };
}

/** The default curriculum ladder - every authored curriculum, easiest
 * first. Callers pass a ladder in rather than having one imposed, so a
 * grade-scoped ladder can be substituted without touching this module. */
export { CURRICULUM_LADDER as DEFAULT_CURRICULUM_LADDER };
