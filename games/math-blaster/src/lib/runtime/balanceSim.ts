/**
 * Headless balance harness.
 *
 * Balance questions about this game ("is 45s enough?", "are 5 enemies at
 * once readable?") can't be answered by reading the constants, because the
 * run clock, the formation size, the descent speed, the fire cooldown and
 * the player's answering speed all feed back into each other: a leak costs
 * the penalty AND the per-kill bonus AND the seconds spent, so a small
 * change to any one of them moves where a run ends by several waves.
 *
 * So this drives the REAL `tick`/`handleInputAction` with a modelled
 * player instead of guessing. It is a measuring instrument, not gameplay -
 * nothing in `src/lib` imports it, and it must never be the reason a
 * gameplay module grows an export.
 *
 * The player model is the part to argue with. `SimPlayer` is a
 * think-time-and-accuracy stand-in for a 5-9 year old: it picks the
 * nearest-to-impact threat, walks under it, spends `thinkSec` on the
 * arithmetic, and answers with a given chance of being exact. That is a
 * crude model of a child, but it is a *consistent* one, which is what
 * makes two sets of constants comparable.
 */

import type { RuntimeState, EnemyInstance } from './RuntimeState';
import type { PlayerProfile } from './PlayerProfile';
import type { GradeLevel } from '../levels/gradeTree';

import { createEmptyProfile } from './PlayerProfile';
import { createInitialRuntimeState, resetRun, tick, handleInputAction } from './gameFlow';
import { resolveTarget, ALIGNMENT_TOLERANCE_PCT, weakPointXPct } from '../targeting';
import { isBossWave } from '../levels/waveProgression';
import { toNumber } from '../math/MathValue';
import { gameEvents } from '../events';

const DT = 1 / 60;
/** A run longer than this is treated as "survived indefinitely" - the
 * point is to find where runs END, and a run this long has answered the
 * question either way. */
const MAX_SIM_SEC = 900;

// --- Seeded RNG -------------------------------------------------------
// gameFlow legitimately uses Math.random (spawn speeds, dodge rolls, add
// lanes). Replacing it with a seeded generator is what makes a
// before/after comparison mean anything rather than being noise.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal, so think times have a spread rather than every answer
 * taking exactly as long as the last. */
function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// --- The modelled player ---------------------------------------------

export interface SimPlayer {
  name: string;
  grade: GradeLevel;
  /** Mean seconds to read a problem, do the arithmetic and type it. */
  thinkSec: number;
  /** Spread on that, so a run isn't metronomic. */
  thinkSdSec: number;
  /** Chance the answer submitted is the exact one. */
  pExact: number;
  /** Chance it is off by one (a "close" verdict - knockback, no kill). */
  pClose: number;
}

/**
 * Three players spanning the target audience. The numbers are estimates of
 * children, not measurements of them - the value here is the *spread*: a
 * balance change that only helps the strong player hasn't fixed anything.
 */
export const SIM_PLAYERS: SimPlayer[] = [
  { name: 'K slow', grade: 'K', thinkSec: 6.5, thinkSdSec: 2.0, pExact: 0.72, pClose: 0.15 },
  { name: 'G1 typical', grade: '1', thinkSec: 4.5, thinkSdSec: 1.5, pExact: 0.85, pClose: 0.08 },
  { name: 'G3 quick', grade: '3', thinkSec: 3.2, thinkSdSec: 1.0, pExact: 0.93, pClose: 0.05 },
];

interface Intent {
  /** uid of the committed enemy, or 'boss'. */
  id: number | 'boss';
  xPct: number;
  thinkRemaining: number;
}

/** The nearest-to-impact enemy, which is both the most urgent threat and
 * what `resolveTarget` will pick if we stand under it. */
function mostUrgentEnemy(enemies: EnemyInstance[]): EnemyInstance | null {
  if (!enemies.length) return null;
  return enemies.reduce((a, b) => (a.y > b.y ? a : b));
}

/**
 * What the player is trying to shoot. Adds are ordinary enemies that cost
 * clock, so a descending add outranks the boss; otherwise the boss (its
 * weak point when shielded, since that's the only part that answers).
 */
function desiredTarget(state: RuntimeState): { id: number | 'boss'; xPct: number } | null {
  const enemy = mostUrgentEnemy(state.enemies);
  if (state.runPhase === 'boss' && state.boss) {
    const threatening = enemy && enemy.y > 45;
    if (!threatening) {
      const boss = state.boss;
      return { id: 'boss', xPct: boss.vulnerable ? boss.xPct : weakPointXPct(boss) };
    }
  }
  return enemy ? { id: enemy.uid, xPct: enemy.xPct } : null;
}

// --- Per-run instrumentation -----------------------------------------

export interface WaveRecord {
  waveNumber: number;
  isBoss: boolean;
  released: number;
  defeated: number;
  leaked: number;
  /** What the wave-clear payout actually granted, after the clock ceiling.
   * Divergence from the nominal figure is how a pinned clock shows up. */
  bonusMs: number;
  elapsedSec: number;
  clockAtStartSec: number;
  clockAtEndSec: number;
}

export interface RunResult {
  /** The wave the run died on (or reached when it hit MAX_SIM_SEC). */
  finalWave: number;
  survivedToCap: boolean;
  durationSec: number;
  bossesFought: number;
  /** Fights that ENDED, either route - a boss wave the run got through. */
  bossesBeaten: number;
  /** Fights ended on the combo, i.e. actually defeated. Only these pay a
   * bounty or any run time, so this is the number that decides whether a
   * modelled player can sustain a run through bosses at all. */
  bossesMastered: number;
  waves: WaveRecord[];
}

export interface SimOptions {
  /** Skill levels to give the profile, e.g. `{ 'more-time': 2 }`. */
  skills?: Record<string, number>;
  fromWave?: number;
}

export function simulateRun(player: SimPlayer, seed: number, options: SimOptions = {}): RunResult {
  const realRandom = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;

  const profile: PlayerProfile = {
    ...createEmptyProfile(),
    selectedGrade: player.grade,
    skillProgress: { ...(options.skills ?? {}) },
    // The harness may start a run mid-ladder; the profile ceiling must not
    // be what stops it.
    highestWaveReached: Math.max(1, options.fromWave ?? 1),
  };
  const state = createInitialRuntimeState();

  const waves: WaveRecord[] = [];
  let bossesFought = 0;
  let bossesBeaten = 0;
  let bossesMastered = 0;
  let leakedThisWave = 0;
  let waveStartSec = 0;
  let waveStartClockSec = 0;
  let elapsed = 0;

  // Instrumented off the event bus rather than off state, because a wave's
  // released/defeated counters are reset by `beginWave` on the same tick the
  // wave ends - reading them afterwards only ever sees zeroes.
  const unsubscribe = gameEvents.on((event) => {
    switch (event.type) {
      case 'wave-announced':
        leakedThisWave = 0;
        waveStartSec = elapsed;
        waveStartClockSec = state.timeRemainingMs / 1000;
        if (event.isBoss) bossesFought++;
        break;
      case 'time-lost':
      case 'impact-avoided':
        leakedThisWave++;
        break;
      case 'boss-defeated':
        bossesBeaten++;
        if (event.by === 'mastery') bossesMastered++;
        break;
      case 'wave-cleared':
        waves.push({
          waveNumber: event.waveNumber,
          isBoss: isBossWave(event.waveNumber),
          released: event.released,
          defeated: event.defeated,
          leaked: leakedThisWave,
          bonusMs: event.bonusMs,
          elapsedSec: elapsed - waveStartSec,
          clockAtStartSec: waveStartClockSec,
          clockAtEndSec: state.timeRemainingMs / 1000,
        });
        break;
    }
  });

  try {
    resetRun(state, profile, options.fromWave ?? 1);

    const intent: Intent = { id: -1, xPct: 50, thinkRemaining: 0 };

    while (state.timeRemainingMs > 0 && elapsed < MAX_SIM_SEC) {
      // --- decide, then act, then let the world advance ---
      const desired = desiredTarget(state);

      if (!desired) {
        state.player.movingLeft = false;
        state.player.movingRight = false;
        intent.id = -1;
      } else {
        if (desired.id !== intent.id) {
          intent.id = desired.id;
          intent.thinkRemaining = Math.max(
            0.6,
            player.thinkSec + gaussian(rng) * player.thinkSdSec
          );
        }
        intent.xPct = desired.xPct;

        // Walking and thinking happen at the same time, the way they do
        // for a real player.
        const delta = intent.xPct - state.player.xPct;
        state.player.movingLeft = delta < -1;
        state.player.movingRight = delta > 1;
        intent.thinkRemaining -= DT;

        const aligned = Math.abs(delta) <= ALIGNMENT_TOLERANCE_PCT;
        if (intent.thinkRemaining <= 0 && aligned && state.player.fireCooldownRemainingMs <= 0) {
          submitAnswer(state, profile, player, rng);
          intent.id = -1;
        }
      }

      tick(state, profile, DT);
      elapsed += DT;
    }

    return {
      finalWave: state.waveNumber,
      survivedToCap: elapsed >= MAX_SIM_SEC,
      durationSec: elapsed,
      bossesFought,
      bossesBeaten,
      bossesMastered,
      waves,
    };
  } finally {
    unsubscribe();
    Math.random = realRandom;
  }
}

/**
 * Types an answer and fires. Which problem gets answered comes from the
 * game's own `resolveTarget`, not from the player's intent - standing
 * under something you didn't mean to shoot is a real way to waste a shot,
 * and the harness shouldn't paper over it.
 */
function submitAnswer(
  state: RuntimeState,
  profile: PlayerProfile,
  player: SimPlayer,
  rng: () => number
): void {
  const target = resolveTarget(state.player, state.enemies, state.boss);
  let problem = null;
  if (target.kind === 'enemy') problem = target.enemy.problem;
  else if (target.kind === 'boss' || target.kind === 'boss-weak-point') problem = state.boss!.problem;
  if (!problem) return;

  const answer = toNumber(problem.answer);
  const roll = rng();
  let submitted: number;
  if (roll < player.pExact) submitted = answer;
  else if (roll < player.pExact + player.pClose) submitted = answer + (rng() < 0.5 ? -1 : 1);
  else submitted = answer + Math.ceil(rng() * 9) * (rng() < 0.5 ? -1 : 1);

  const text = String(Math.max(0, Math.round(submitted)));
  for (const digit of text) handleInputAction(state, profile, { type: 'digit', digit });
  handleInputAction(state, profile, { type: 'fire' });
}

// --- Aggregation ------------------------------------------------------

export interface Summary {
  player: string;
  runs: number;
  medianWave: number;
  p10Wave: number;
  p90Wave: number;
  meanWave: number;
  /** Share of runs that got past wave 5, i.e. beat one boss. */
  pastFirstBoss: number;
  pastSecondBoss: number;
  reachedCap: number;
  /** Share of fights the run got through at all. */
  bossWinRate: number;
  /** Share of fights actually DEFEATED on the combo. The gap between this
   * and bossWinRate is fights escaped for no reward. */
  bossMasteryRate: number;
  meanRunSec: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

export function summarize(player: SimPlayer, runs: RunResult[]): Summary {
  const finals = runs.map((r) => r.finalWave).sort((a, b) => a - b);
  const fought = runs.reduce((n, r) => n + r.bossesFought, 0);
  const beaten = runs.reduce((n, r) => n + r.bossesBeaten, 0);
  const mastered = runs.reduce((n, r) => n + r.bossesMastered, 0);
  return {
    player: player.name,
    runs: runs.length,
    medianWave: quantile(finals, 0.5),
    p10Wave: quantile(finals, 0.1),
    p90Wave: quantile(finals, 0.9),
    meanWave: finals.reduce((a, b) => a + b, 0) / finals.length,
    pastFirstBoss: runs.filter((r) => r.finalWave > 5).length / runs.length,
    pastSecondBoss: runs.filter((r) => r.finalWave > 10).length / runs.length,
    reachedCap: runs.filter((r) => r.survivedToCap).length / runs.length,
    bossWinRate: fought ? beaten / fought : 0,
    bossMasteryRate: fought ? mastered / fought : 0,
    meanRunSec: runs.reduce((n, r) => n + r.durationSec, 0) / runs.length,
  };
}

export function sweep(runsPerPlayer: number, options: SimOptions = {}): Summary[] {
  return SIM_PLAYERS.map((player) => {
    const runs: RunResult[] = [];
    for (let i = 0; i < runsPerPlayer; i++) runs.push(simulateRun(player, 1000 + i * 7919, options));
    return summarize(player, runs);
  });
}

/** Per-wave averages across runs, for reading where a run turns. */
export function waveProfile(runs: RunResult[], upTo = 14): WaveRecord[] {
  const out: WaveRecord[] = [];
  for (let wave = 1; wave <= upTo; wave++) {
    const records = runs.flatMap((r) => r.waves.filter((w) => w.waveNumber === wave));
    if (!records.length) continue;
    const mean = (pick: (w: WaveRecord) => number) =>
      records.reduce((n, w) => n + pick(w), 0) / records.length;
    out.push({
      waveNumber: wave,
      isBoss: wave % 5 === 0,
      released: mean((w) => w.released),
      defeated: mean((w) => w.defeated),
      leaked: mean((w) => w.leaked),
      bonusMs: mean((w) => w.bonusMs),
      elapsedSec: mean((w) => w.elapsedSec),
      clockAtStartSec: mean((w) => w.clockAtStartSec),
      clockAtEndSec: mean((w) => w.clockAtEndSec),
    });
  }
  return out;
}
