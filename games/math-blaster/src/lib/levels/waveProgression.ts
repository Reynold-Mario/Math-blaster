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

import type {
  ArcadeDifficulty,
  AuthoredProblemRecipe,
  Backdrop,
  BossPhase,
  BossRules,
  Curriculum,
} from './LevelDefinition';
import type { EnemyArchetypeId } from './enemyArchetypes';
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

/** Prefixes for repeat visits from the same boss, so a cycled roster still
 * announces itself as an escalation rather than a repeat. */
const BOSS_TIER_PREFIXES = ['', 'Elder ', 'Ancient ', 'Eternal '];

// --- Boss escalation. ALL OF IT COMES FROM THE WAVE NUMBER, and that is
// the point of this block.
//
// It used to ride the roster: `bossRulesFor` picked `BOSS_ROSTER[ordinal %
// 3]` and took that entry's phases, surviveSec, comboToDefeat and finale
// along with its name. Because the roster cycles and its three entries are
// ordered easiest-first, difficulty went BACKWARDS every third fight -
// wave 15 fought a 3-phase boss at surviveSec 28, then wave 20 fought
// "Elder Sum Slime King" with 2 phases, surviveSec 24 and an easier
// finale. A run got easier at wave 20 than it had been at wave 15.
//
// So the roster now supplies IDENTITY only - name, sprite, theme, and the
// phase names that give a fight its voice - and every number that decides
// how hard the fight is comes from the wave. This is the existing
// identity/maths split (see `scope`) taken one step further to cover
// behaviour, not a new idea. ---

/**
 * No boss fight is ever shorter than this, however well it's answered.
 *
 * A boss is the point of a run; one that flashes past in twelve seconds
 * isn't an event. But see `bossMinFightSec` - the real floor is usually
 * driven by the combo requirement rather than by this number, because a
 * floor that doesn't leave room to actually land the combo makes the
 * mastery route unreachable, which is the bug this replaced.
 */
export const BOSS_MIN_SURVIVE_SEC = 30;
/**
 * Seconds of fight guaranteed per answer the combo asks for.
 *
 * THIS IS WHAT MAKES THE MASTERY ROUTE REACHABLE AT ALL, and it is the
 * single least obvious number here. Before it existed, a fight ended by
 * survival long before a combo could be strung together: each exact answer
 * cuts `BOSS_CUT_EXACT_MS` off the survive clock *on top of* the seconds
 * the player spent thinking, so answering well actively raced the player
 * into the endurance ending. Measured against the balance harness, the
 * mastery rate was 0% for every modelled player at every wave - a wave-5
 * boss wanted 5 exact answers in a row (~22s of play) and its clock
 * permitted about 3.
 *
 * Multiplying the combo requirement by a per-answer allowance is what
 * guarantees the room. Set it below a real child's think time and the
 * mastery route silently becomes decorative again.
 */
const BOSS_SEC_PER_COMBO_ANSWER = 5.5;
/**
 * How much longer the ENDURANCE route runs than the compressed minimum.
 *
 * These two numbers have to stay apart, and it is easy to collapse them by
 * accident. Set `surviveSec` equal to the floor and timer cuts become
 * inert - there is no headroom left to cut, so "good answers shorten the
 * fight" quietly stops being true and every fight runs exactly the minimum
 * however it is played. The gap between them IS the reward for answering
 * well, and it is also what makes outlasting a boss the tedious route the
 * design wants it to be.
 */
const BOSS_SURVIVE_HEADROOM_FACTOR = 1.5;
/** However deep a run goes, a single fight never runs longer than this. */
const BOSS_SURVIVE_CAP_SEC = 60;
/**
 * The floor's own ceiling, derived so that headroom SURVIVES THE CAP.
 *
 * Capping the survive clock without capping the floor lets the two meet
 * again at the deep end, which re-creates exactly the collapse the headroom
 * factor exists to prevent - cuts go inert, and only in the late game where
 * it is hardest to notice. Deriving it keeps the two in step whatever
 * either number is retuned to.
 */
const BOSS_MIN_FIGHT_CAP_SEC = BOSS_SURVIVE_CAP_SEC / BOSS_SURVIVE_HEADROOM_FACTOR;

/** Added to the fight's floor per fight deep, so consecutive bosses are
 * never structurally identical even between combo/phase steps. */
const BOSS_MIN_PER_FIGHT_SEC = 0.75;

const BOSS_COMBO_BASE = 5;
const FIGHTS_PER_EXTRA_COMBO = 3;
/**
 * DERIVED, not chosen: the largest combo that still fits inside the longest
 * compressed fight the caps allow.
 *
 * The mastery route has to stay reachable at every wave, and that is a
 * relationship between three numbers rather than a property of any one of
 * them - the combo asks for `combo * BOSS_SEC_PER_COMBO_ANSWER` seconds of
 * play, and cuts can compress a fight to at most `BOSS_MIN_FIGHT_CAP_SEC`.
 * Pick the combo cap by hand and the two drift apart silently: a combo of
 * 10 needs 55s of play inside a 40s floor, so the deepest bosses go back to
 * being unkillable and only the endurance route is left.
 *
 * If a longer combo is wanted, raise `BOSS_SURVIVE_CAP_SEC` - that is the
 * actual constraint, and this makes the dependency explicit instead of
 * leaving it to be rediscovered. `waveProgression.test.ts` pins the
 * reachability property itself.
 */
const BOSS_COMBO_CAP = Math.floor(BOSS_MIN_FIGHT_CAP_SEC / BOSS_SEC_PER_COMBO_ANSWER);

const BOSS_PHASE_COUNT_MIN = 2;
const BOSS_PHASE_COUNT_MAX = 5;
const FIGHTS_PER_EXTRA_PHASE = 2;

/** How fast the boss slides side to side, opening phase to closing one. */
const BOSS_DRIFT_START = 11;
const BOSS_DRIFT_END = 26;
const BOSS_DRIFT_PER_FIGHT = 0.5;
const BOSS_DRIFT_CAP = 40;

// Shield windows. The OPENING PHASE NEVER SHIELDS - every authored boss was
// written that way so the mechanic is introduced rather than sprung, and
// generating the phases must not quietly drop that.
const BOSS_SHIELDED_SEC_START = 3.5;
const BOSS_SHIELDED_SEC_END = 6;
const BOSS_SHIELDED_PER_FIGHT = 0.15;
const BOSS_SHIELDED_CAP = 8;
/** How long the boss stays open to fire. Shrinks as a fight and a run go
 * on - a narrower window, not a tougher boss. */
const BOSS_VULNERABLE_SEC_START = 6.5;
const BOSS_VULNERABLE_SEC_END = 4;
const BOSS_VULNERABLE_PER_FIGHT = 0.1;
const BOSS_VULNERABLE_MIN_SEC = 2.5;

/** Seconds between reinforcements the boss may call. */
const BOSS_ADD_INTERVAL_START: [number, number] = [3.2, 4.2];
const BOSS_ADD_INTERVAL_END: [number, number] = [2, 2.8];
const BOSS_ADD_INTERVAL_TIGHTEN_PER_FIGHT = 0.02;
const BOSS_ADD_INTERVAL_MIN_SEC = 1.2;

/**
 * What a boss calls in, easiest first.
 *
 * Deliberately the WEAK END of the registry, and deliberately missing
 * `bulwark` and `sentinel`: a reinforcement is a consequence of the player
 * not engaging with the maths, so it has to be answerable. A two-layer
 * bulwark or a shielded sentinel is a second problem stacked on the one the
 * player is already failing, which is the opposite of the point.
 */
const BOSS_ADD_LADDER: EnemyArchetypeId[] = ['spore', 'drifter', 'weaver', 'splitter'];
/** Fights before the add ladder steps up a rung. */
const FIGHTS_PER_ADD_STEP = 4;

/** Suffixes for phases past the ones the roster entry named. */
const PHASE_REPEAT_NUMERALS = ['', ' II', ' III', ' IV', ' V'];

/** How much harder a fight's FIRST problem leans, per fight deep. Without
 * it every boss opens sampling its scope evenly, so a wave-40 fight starts
 * as gently as wave 5's and only hardens as its own clock runs down. */
const BOSS_SCOPE_BIAS_PER_FIGHT = 0.12;
const BOSS_SCOPE_BIAS_CAP = 0.8;

/** Boss adds fall slower than the wave's own enemies. The authored roster
 * had them FASTER ([15,20] against a wave's [8,12]-[13,18]), which is again
 * the opposite of what a reinforcement is for. */
const BOSS_ADD_SPEED_SOFTEN = 0.85;

/** Every boss finale, in the roster's own easiest-first order. Selected by
 * how many bosses deep the run is rather than by which boss it happens to
 * be - that swap is what stops wave 20 inheriting wave 5's finale. */
const FINALE_LADDER: AuthoredProblemRecipe[] = BOSS_ROSTER.map((b) => b.finaleProblem);

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

/** Consecutive exact answers that end this wave's fight outright. */
export function bossComboFor(waveNumber: number): number {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  return Math.min(BOSS_COMBO_CAP, BOSS_COMBO_BASE + Math.floor((ordinal - 1) / FIGHTS_PER_EXTRA_COMBO));
}

/**
 * The shortest this wave's fight may last, in seconds - the floor that
 * timer cuts clamp against, so answering well compresses a fight rather
 * than skipping it.
 *
 * Derived from the combo requirement, not flat. A flat floor sounds like
 * the same thing and isn't: `comboToDefeat` grows with the wave, so a
 * fixed 30s would leave a late boss asking for 8 exact answers inside a
 * window that only fits 6, and the mastery route would go back to being
 * unreachable exactly where it matters most.
 */
export function bossMinFightSec(waveNumber: number): number {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  const needed = bossComboFor(waveNumber) * BOSS_SEC_PER_COMBO_ANSWER;
  const creep = (ordinal - 1) * BOSS_MIN_PER_FIGHT_SEC;
  return Math.min(
    BOSS_MIN_FIGHT_CAP_SEC,
    Math.round((Math.max(BOSS_MIN_SURVIVE_SEC, needed) + creep) * 10) / 10
  );
}

/**
 * How long the player must last if they never answer the boss down.
 *
 * Deliberately well above `bossMinFightSec`: the gap is the headroom timer
 * cuts work in, so a player answering well compresses the fight toward the
 * floor while one who can't answer it endures the whole thing. That gap is
 * also what made the mastery route reachable again - the old 20s clock was
 * shorter than the ~22s of play a 5-combo needs, so the fight always ended
 * by survival first, whatever the player did.
 */
export function bossSurviveSecFor(waveNumber: number): number {
  return Math.min(
    BOSS_SURVIVE_CAP_SEC,
    Math.round(bossMinFightSec(waveNumber) * BOSS_SURVIVE_HEADROOM_FACTOR * 10) / 10
  );
}

/** How many segments this wave's fight is cut into. */
export function bossPhaseCountFor(waveNumber: number): number {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  return Math.min(
    BOSS_PHASE_COUNT_MAX,
    BOSS_PHASE_COUNT_MIN + Math.floor((ordinal - 1) / FIGHTS_PER_EXTRA_PHASE)
  );
}

/** Keeps a fight's authored voice past the phases the roster entry named,
 * rather than falling back to generic labels. */
function phaseNameFor(template: BossRules, index: number): string {
  const base = template.phases[index % template.phases.length].name;
  const pass = Math.floor(index / template.phases.length);
  return `${base}${PHASE_REPEAT_NUMERALS[Math.min(pass, PHASE_REPEAT_NUMERALS.length - 1)]}`;
}

/**
 * The phase ladder for this wave's fight, generated rather than authored.
 *
 * Two escalations compose here, and they're independent on purpose: `t`
 * walks from the opening phase to the closing one WITHIN a fight, and the
 * ordinal makes every one of those positions harsher as the run goes on.
 * That's what makes wave 40's opening phase tougher than wave 5's closing
 * one, which is what "correlated to the wave number" has to mean if the
 * run is to keep escalating past the authored material.
 */
export function bossPhasesFor(waveNumber: number, template: BossRules): BossPhase[] {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  const count = bossPhaseCountFor(waveNumber);
  const deep = ordinal - 1;

  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    // The opening phase never shields - see the constants above.
    const opening = i === 0;

    return {
      name: phaseNameFor(template, i),
      // Later phases occupy slightly more of the fight, so the hard part
      // is also the long part.
      weight: 1 + i * 0.1,
      driftSpeed: Math.min(
        BOSS_DRIFT_CAP,
        lerp(BOSS_DRIFT_START, BOSS_DRIFT_END, t) + deep * BOSS_DRIFT_PER_FIGHT
      ),
      addInterval: [
        Math.max(
          BOSS_ADD_INTERVAL_MIN_SEC,
          lerp(BOSS_ADD_INTERVAL_START[0], BOSS_ADD_INTERVAL_END[0], t) *
            (1 - Math.min(0.5, deep * BOSS_ADD_INTERVAL_TIGHTEN_PER_FIGHT))
        ),
        Math.max(
          BOSS_ADD_INTERVAL_MIN_SEC,
          lerp(BOSS_ADD_INTERVAL_START[1], BOSS_ADD_INTERVAL_END[1], t) *
            (1 - Math.min(0.5, deep * BOSS_ADD_INTERVAL_TIGHTEN_PER_FIGHT))
        ),
      ],
      addArchetype:
        BOSS_ADD_LADDER[
          Math.min(BOSS_ADD_LADDER.length - 1, i + Math.floor(deep / FIGHTS_PER_ADD_STEP))
        ],
      vulnerableSec: Math.max(
        BOSS_VULNERABLE_MIN_SEC,
        lerp(BOSS_VULNERABLE_SEC_START, BOSS_VULNERABLE_SEC_END, t) - deep * BOSS_VULNERABLE_PER_FIGHT
      ),
      shieldedSec: opening
        ? 0
        : Math.min(
            BOSS_SHIELDED_CAP,
            lerp(BOSS_SHIELDED_SEC_START, BOSS_SHIELDED_SEC_END, t) + deep * BOSS_SHIELDED_PER_FIGHT
          ),
    };
  });
}

/**
 * The boss for this wave.
 *
 * The roster supplies IDENTITY - name, sprite, theme, and the phase names
 * that give a fight its voice. Everything that decides how hard the fight
 * is comes from the wave number: survive clock, combo requirement, phase
 * ladder, finale, and how hard its first problem leans. See the escalation
 * block above for why that split had to be drawn here rather than left on
 * the roster.
 *
 * The maths still arrives separately as `scope`, which is what lets a boss
 * appear on wave 5 regardless of curriculum - the roster's three fights
 * were authored on three different bundles, and only two of the seven
 * bundles authored one at all.
 */
export function bossRulesFor(waveNumber: number, scope: Curriculum[]): BossRules {
  const ordinal = Math.max(1, bossOrdinal(waveNumber));
  const template = BOSS_ROSTER[(ordinal - 1) % BOSS_ROSTER.length];
  const cycle = Math.floor((ordinal - 1) / BOSS_ROSTER.length);
  const prefix = BOSS_TIER_PREFIXES[Math.min(cycle, BOSS_TIER_PREFIXES.length - 1)];
  const wave = arcadeDifficultyFor(waveNumber);

  return {
    ...template,
    name: `${prefix}${template.name}`,
    scope,
    surviveSec: bossSurviveSecFor(waveNumber),
    comboToDefeat: bossComboFor(waveNumber),
    phases: bossPhasesFor(waveNumber, template),
    finaleProblem: FINALE_LADDER[Math.min(ordinal - 1, FINALE_LADDER.length - 1)],
    scopeBias: Math.min(BOSS_SCOPE_BIAS_CAP, (ordinal - 1) * BOSS_SCOPE_BIAS_PER_FIGHT),
    arcadeDifficulty: {
      maxConcurrent: wave.maxConcurrent,
      fallSpeed: [
        wave.fallSpeed[0] * BOSS_ADD_SPEED_SOFTEN,
        wave.fallSpeed[1] * BOSS_ADD_SPEED_SOFTEN,
      ],
    },
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
