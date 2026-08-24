import { createInitialRuntimeState, beginWave, resetRun, tick, handleInputAction } from './gameFlow';
import { createEmptyProfile, type PlayerProfile } from './PlayerProfile';
import type { RuntimeState, EnemyInstance } from './RuntimeState';
import { gameEvents, type GameEvent } from '../events';
import { weakPointXPct } from '../targeting';
import {
  enemyArchetype,
  GLOBAL_FALL_SPEED_MULTIPLIER,
  type EnemyArchetypeId,
} from '../levels/enemyArchetypes';
import {
  WAVE_BOSS_INTERVAL,
  arcadeDifficultyFor,
  isBossWave,
  waveSpecFor,
} from '../levels/waveProgression';
import { cumulativeScopeForGrade, type GradeLevel } from '../levels/gradeTree';
import { toNumber } from '../math/MathValue';
import type { ProblemDefinition } from '../math/ProblemDefinition';

/**
 * Integration coverage for the orchestration layer - the one place where
 * archetypes, waves, the combat rules and the boss's two win conditions
 * are actually wired together. The pure layers below it are unit-tested on
 * their own; what these tests are for is the wiring.
 */

let events: GameEvent[] = [];
let unsubscribe = () => {};

beforeEach(() => {
  events = [];
  unsubscribe = gameEvents.on((e) => events.push(e));
});
afterEach(() => unsubscribe());

function eventsOfType<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function startAtWave(waveNumber: number): { state: RuntimeState; profile: PlayerProfile } {
  const state = createInitialRuntimeState();
  const profile = createEmptyProfile();
  beginWave(state, waveNumber);
  events = [];
  return { state, profile };
}

/**
 * The first ordinary wave that sends this archetype. Searched rather than
 * hard-coded: which wave sends what is a property of the progression
 * ladder, and these tests are about the wiring, not the tuning.
 */
function waveSending(archetype: EnemyArchetypeId): number {
  for (let wave = 1; wave <= 400; wave++) {
    if (isBossWave(wave)) continue;
    if (waveSpecFor(wave).archetypes.includes(archetype)) return wave;
  }
  throw new Error(`No wave in the ladder sends a ${archetype}.`);
}

function startAtArchetype(archetype: EnemyArchetypeId): { state: RuntimeState; profile: PlayerProfile } {
  return startAtWave(waveSending(archetype));
}

/** Ticks in small steps until `done`, so spawn timers and drift advance
 * the way they would in a real frame loop. Fails loudly rather than
 * hanging if the condition never comes true. */
function tickUntil(state: RuntimeState, profile: PlayerProfile, done: () => boolean, label: string): void {
  for (let i = 0; i < 2000; i++) {
    if (done()) return;
    // The run clock is generous here on purpose - these tests are about
    // mechanics, not about the 30-second budget.
    state.timeRemainingMs = 60000;
    tick(state, profile, 1 / 30);
  }
  throw new Error(`tickUntil never satisfied: ${label}`);
}

function correctAnswer(problem: ProblemDefinition): string {
  return String(toNumber(problem.answer));
}

/** Lines the player up on a target and fires one shot at it, bypassing the
 * fire cooldown so a test can take several shots in a row. */
function shoot(state: RuntimeState, profile: PlayerProfile, xPct: number, guess: string): void {
  state.player.xPct = xPct;
  state.player.fireCooldownRemainingMs = 0;
  state.player.inputBuffer = guess;
  handleInputAction(state, profile, { type: 'fire' });
}

function shootExactly(state: RuntimeState, profile: PlayerProfile, target: EnemyInstance): void {
  shoot(state, profile, target.xPct, correctAnswer(target.problem));
}

/** Keeps answering an enemy correctly until it's gone - however many
 * shields and layers that happens to take for its archetype. */
function destroy(state: RuntimeState, profile: PlayerProfile, target: EnemyInstance): void {
  for (let i = 0; i < 8 && state.enemies.includes(target); i++) {
    shootExactly(state, profile, target);
  }
  expect(state.enemies).not.toContain(target);
}

function spawnUntil(
  state: RuntimeState,
  profile: PlayerProfile,
  archetype: string
): EnemyInstance {
  tickUntil(state, profile, () => state.enemies.some((e) => e.archetype === archetype), `a ${archetype} to spawn`);
  return state.enemies.find((e) => e.archetype === archetype)!;
}

describe('starting a run further in', () => {
  it('starts at wave 1 by default', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    expect(state.waveNumber).toBe(1);
  });

  it('starts wherever it is told to', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile, 11);
    expect(state.waveNumber).toBe(11);
  });

  it('drops straight into a boss when started on a boss wave', () => {
    // The whole reason a checkpoint lands on a multiple of the interval.
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile, WAVE_BOSS_INTERVAL);
    tickUntil(state, profile, () => state.boss !== null, 'the boss');
    expect(state.runPhase).toBe('boss');
  });

  it('refuses a nonsense start wave rather than breaking the run', () => {
    for (const requested of [0, -3, 0.5]) {
      const state = createInitialRuntimeState();
      const profile = createEmptyProfile();
      resetRun(state, profile, requested);
      expect(state.waveNumber).toBe(1);
    }
  });

  it('gives a skipped-to run the same clock as any other', () => {
    // Starting at wave 20 must not also mean starting with wave 20's worth
    // of banked time, or the skip would be a double reward.
    const early = createInitialRuntimeState();
    const lateState = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(early, profile, 1);
    resetRun(lateState, profile, 20);
    expect(lateState.timeRemainingMs).toBe(early.timeRemainingMs);
  });
});

describe('the reached-wave record', () => {
  it('records the wave a run starts on', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile, 9);
    expect(profile.highestWaveReached).toBe(9);
    expect(eventsOfType('wave-record')).toHaveLength(1);
  });

  it('records each new wave as the run advances', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');
    for (const enemy of [...state.enemies]) destroy(state, profile, enemy);
    tickUntil(state, profile, () => state.waveNumber === 2, 'wave 2');

    expect(profile.highestWaveReached).toBe(2);
  });

  it('never lowers the record by starting an earlier run', () => {
    const profile = createEmptyProfile();
    profile.highestWaveReached = 30;
    const state = createInitialRuntimeState();
    resetRun(state, profile, 1);
    expect(profile.highestWaveReached).toBe(30);
  });

  it('only announces an actual record, not every wave', () => {
    const profile = createEmptyProfile();
    profile.highestWaveReached = 30;
    const state = createInitialRuntimeState();
    events = [];
    resetRun(state, profile, 5);
    expect(eventsOfType('wave-record')).toHaveLength(0);
  });
});

describe('grade scoping', () => {
  /** Collects the problems a run at this grade actually puts on screen,
   * across enough waves to walk the whole ladder and past its end. */
  function problemsAtGrade(grade: GradeLevel, waves: number[]): ProblemDefinition[] {
    const profile = createEmptyProfile();
    profile.selectedGrade = grade;
    const seen: ProblemDefinition[] = [];

    for (const wave of waves) {
      const state = createInitialRuntimeState();
      beginWave(state, wave);
      tickUntil(state, profile, () => state.enemies.length > 0 || state.boss !== null, `wave ${wave}`);
      for (const enemy of state.enemies) seen.push(enemy.problem);
      if (state.boss) seen.push(state.boss.problem);
    }
    return seen;
  }

  /** A problem's operator. It lives on the expression rather than the
   * problem, so that a problem could one day be a non-arithmetic form. */
  function operatorOf(problem: ProblemDefinition): string {
    return problem.expression.operator;
  }

  /** Every operator the grade is allowed to ask about, waves and boss alike. */
  function allowedOperators(grade: GradeLevel): Set<string> {
    return new Set(cumulativeScopeForGrade(grade).flatMap((c) => c.operations));
  }

  it('asks a Kindergarten run nothing but addition and subtraction', () => {
    // Times tables must not turn up because a K player had a long run.
    const problems = problemsAtGrade('K', [1, 2, 3, 4, 6, 7, 12, 30, 61, 120]);
    expect(problems.length).toBeGreaterThan(5);
    for (const problem of problems) {
      expect(['+', '-']).toContain(operatorOf(problem));
    }
  });

  it('keeps a Kindergarten boss inside Kindergarten maths too', () => {
    const problems = problemsAtGrade('K', [WAVE_BOSS_INTERVAL, WAVE_BOSS_INTERVAL * 4]);
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(['+', '-']).toContain(operatorOf(problem));
    }
  });

  it('holds every grade to its own cumulative scope', () => {
    for (const grade of ['K', '1', '2', '3'] as GradeLevel[]) {
      const allowed = allowedOperators(grade);
      for (const problem of problemsAtGrade(grade, [1, 5, 9, 20, 55])) {
        expect(allowed).toContain(operatorOf(problem));
      }
    }
  });

  it('does reach multiplication for a Grade 3 run', () => {
    // The flip side of the containment guarantee: scoping must not
    // accidentally pin every grade to the easiest material.
    const operators = new Set(problemsAtGrade('3', [1, 2, 3, 4, 6, 7, 8, 9, 11, 12]).map((p) => operatorOf(p)));
    expect(operators.has('×') || operators.has('÷')).toBe(true);
  });

  it('takes the grade from resolveGrade, not from the wave number', () => {
    // A run's difficulty is a property of who is playing, which is what
    // makes the endless ladder safe for a six-year-old.
    const early = problemsAtGrade('K', [1]);
    const late = problemsAtGrade('K', [200]);
    for (const problem of [...early, ...late]) expect(['+', '-']).toContain(operatorOf(problem));
  });
});

describe('the run clock', () => {
  /**
   * Plays the current wave out to its end, answering everything correctly -
   * and, on a boss wave, letting the survive clock run down to finish the
   * fight. Deliberately does NOT reset the run clock the way `tickUntil`
   * does: these tests are about the clock, so nothing may top it up behind
   * their back.
   */
  function clearWave(state: RuntimeState, profile: PlayerProfile): void {
    const wave = state.waveNumber;
    for (let i = 0; i < 900; i++) {
      for (const enemy of [...state.enemies]) {
        for (let shot = 0; shot < 8 && state.enemies.includes(enemy); shot++) {
          shootExactly(state, profile, enemy);
        }
      }
      // Take the endurance route on a boss wave rather than answering it out.
      if (state.boss) state.boss.surviveRemainingMs = Math.min(state.boss.surviveRemainingMs, 40);
      tick(state, profile, 1 / 30);
      if (state.waveNumber !== wave) return;
    }
    throw new Error(`wave ${wave} never ended`);
  }

  it('starts a run on the base clock plus the More Time bonus only', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    expect(state.timeRemainingMs).toBe(45000);
  });

  it('pays time back for clearing a wave', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);

    // Spend the clock down first, so the payout has room to land and isn't
    // silently swallowed by the cap.
    state.timeRemainingMs = 20000;
    const before = state.timeRemainingMs;
    clearWave(state, profile);

    expect(state.timeRemainingMs).toBeGreaterThan(before);
    const cleared = eventsOfType('wave-cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0].bonusMs).toBeGreaterThan(0);
    expect(eventsOfType('time-gained')).toHaveLength(1);
  });

  it('pays a wave answered out more than one let through', () => {
    // Leaking has to cost the bonus, not just the impact penalty - otherwise
    // standing still would be a free way to skip a wave you can't answer.
    //
    // Both runs hold their clock at a fixed value every tick, so the only
    // thing being compared is the payout itself: the drain rate and the
    // impact penalties would otherwise muddy it (and are covered separately
    // by the impact tests).
    function payoutFor(answer: boolean): number {
      events = [];
      const state = createInitialRuntimeState();
      const profile = createEmptyProfile();
      resetRun(state, profile);

      for (let i = 0; i < 900 && state.waveNumber === 1; i++) {
        state.timeRemainingMs = 40000;
        if (answer) {
          for (const enemy of [...state.enemies]) {
            for (let shot = 0; shot < 8 && state.enemies.includes(enemy); shot++) {
              shootExactly(state, profile, enemy);
            }
          }
        }
        tick(state, profile, 1 / 30);
      }

      const cleared = eventsOfType('wave-cleared');
      expect(cleared).toHaveLength(1);
      return cleared[0].bonusMs;
    }

    const answered = payoutFor(true);
    const leaked = payoutFor(false);

    expect(leaked).toBeLessThan(answered);
    expect(eventsOfType('time-lost').length).toBeGreaterThan(0);
  });

  it('never lets the clock exceed its ceiling', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);

    for (let wave = 0; wave < 6; wave++) {
      clearWave(state, profile);
      expect(state.timeRemainingMs).toBeLessThanOrEqual(75000);
    }
  });

  it('keeps the ceiling above the starting clock, so More Time never goes dead', () => {
    // A flat ceiling would sit exactly at base + a maxed More Time, pinning a
    // fully upgraded player to it from wave 1 and silently discarding every
    // payout for the rest of the run.
    const maxed = createEmptyProfile();
    maxed.skillProgress = { 'skills-root': 1, 'branch-economy': 1, 'more-time': 5 };

    const state = createInitialRuntimeState();
    resetRun(state, maxed);
    const start = state.timeRemainingMs;
    expect(start).toBeGreaterThan(45000);

    // Spend a little, then clear a wave: the payout has to actually land.
    state.timeRemainingMs = start - 5000;
    clearWave(state, maxed);
    expect(eventsOfType('wave-cleared')[0].bonusMs).toBeGreaterThan(0);
    expect(state.timeRemainingMs).toBeGreaterThan(start - 5000);
  });

  it('reports what a capped payout actually granted, not what it offered', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    // Near the ceiling, so the payout cannot land in full. (It can't be
    // pinned exactly: the clock drains while the wave is being played, which
    // is itself the reason the granted figure has to be measured, not assumed.)
    // 75s is base 45s + the 30s of bankable headroom, with no More Time bought.
    state.timeRemainingMs = 74000;

    clearWave(state, profile);

    const granted = eventsOfType('wave-cleared')[0].bonusMs;
    expect(state.timeRemainingMs).toBe(75000);
    // The flat part of the payout alone is 12s; the event must not claim it.
    expect(granted).toBeLessThan(12000);
  });

  it('pays out for surviving a boss wave', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    beginWave(state, WAVE_BOSS_INTERVAL);
    state.timeRemainingMs = 20000;
    events = [];

    tickUntil(state, profile, () => state.boss !== null, 'the boss');
    state.timeRemainingMs = 20000;
    state.boss!.surviveRemainingMs = 40;
    events = [];

    for (let i = 0; i < 200 && state.boss; i++) tick(state, profile, 1 / 30);

    expect(eventsOfType('boss-defeated')).toHaveLength(1);
    expect(eventsOfType('time-gained').length).toBeGreaterThan(0);
    expect(state.timeRemainingMs).toBeGreaterThan(20000);
  });
});

describe('game over', () => {
  // The fail condition had no coverage at all before the clock became the
  // thing a run is actually built around.
  it('ends the run when the clock drains', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    state.timeRemainingMs = 100;

    for (let i = 0; i < 20 && state.timeRemainingMs > 0; i++) tick(state, profile, 1 / 30);

    expect(state.timeRemainingMs).toBe(0);
    expect(eventsOfType('game-over')).toHaveLength(1);
  });

  it('ends the run when an impact empties the clock', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    tickUntil(state, profile, () => state.enemies.length > 0, 'a formation');

    state.timeRemainingMs = 1000;
    for (const enemy of state.enemies) enemy.y = 99;
    tick(state, profile, 1 / 30);

    expect(state.timeRemainingMs).toBe(0);
    expect(eventsOfType('game-over')).toHaveLength(1);
  });

  it('emits game-over exactly once when several enemies land together', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    // A wave wide enough that more than one can cross the line at once.
    beginWave(state, 3);
    tickUntil(state, profile, () => state.enemies.length > 1, 'a wide formation');

    state.timeRemainingMs = 1000;
    for (const enemy of state.enemies) enemy.y = 99;
    events = [];
    tick(state, profile, 1 / 30);

    expect(eventsOfType('game-over')).toHaveLength(1);
  });

  it('stops simulating once the clock is gone', () => {
    const state = createInitialRuntimeState();
    const profile = createEmptyProfile();
    resetRun(state, profile);
    state.timeRemainingMs = 0;
    const wave = state.waveNumber;

    events = [];
    for (let i = 0; i < 60; i++) tick(state, profile, 1 / 30);

    expect(state.waveNumber).toBe(wave);
    expect(events).toHaveLength(0);
  });
});

describe('wave spawning', () => {
  it('releases the whole formation at once rather than a trickle', () => {
    const { state, profile } = startAtWave(1);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');

    const released = eventsOfType('wave-incoming');
    expect(released).toHaveLength(1);
    expect(released[0].count).toBe(state.enemies.length);
    expect(released[0].count).toBe(waveSpecFor(1).archetypes.length);
    expect(state.waveSize).toBe(state.enemies.length);
  });

  it('announces a wave before it arrives, so nothing starts mid-screen', () => {
    const { state, profile } = startAtWave(1);
    // beginWave announces; the formation lands only once the breather ends.
    expect(state.enemies).toHaveLength(0);
    tick(state, profile, 1 / 30);
    expect(state.enemies).toHaveLength(0);

    tickUntil(state, profile, () => state.enemies.length > 0, 'the formation');
    expect(state.enemies.every((e) => e.y < 20)).toBe(true);
  });

  it('holds the next wave until the board is empty', () => {
    const { state, profile } = startAtWave(1);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');

    // Tick long enough that the old gapSec-driven release would have fired
    // several more waves by now.
    for (let i = 0; i < 200 && state.enemies.length > 1; i++) {
      state.timeRemainingMs = 60000;
      tick(state, profile, 1 / 30);
    }
    expect(state.waveNumber).toBe(1);
    expect(eventsOfType('wave-incoming')).toHaveLength(1);
  });

  it('moves to the next wave once the board empties, and says so', () => {
    const { state, profile } = startAtWave(1);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');
    for (const enemy of [...state.enemies]) destroy(state, profile, enemy);

    tickUntil(state, profile, () => state.waveNumber === 2, 'the next wave');

    const cleared = eventsOfType('wave-cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0].waveNumber).toBe(1);
    expect(cleared[0].defeated).toBe(cleared[0].released);
  });

  it('spawns exactly the archetypes the wave ladder authors', () => {
    const { state, profile } = startAtWave(1);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');
    expect(state.enemies.map((e) => e.archetype).sort()).toEqual([...waveSpecFor(1).archetypes].sort());
  });

  it('applies the global fall-speed brake on top of wave and archetype speeds', () => {
    // The brake is the one knob for global pacing - if a spawn path stops
    // honouring it, descent speed silently doubles for those enemies.
    const wave = 8;
    const { state, profile } = startAtWave(wave);
    tickUntil(state, profile, () => state.enemies.length > 0, 'a formation');

    const [min, max] = arcadeDifficultyFor(wave).fallSpeed;
    for (const enemy of state.enemies) {
      const archetype = enemyArchetype(enemy.archetype).speedMultiplier;
      expect(enemy.speed).toBeGreaterThanOrEqual(min * archetype * GLOBAL_FALL_SPEED_MULTIPLIER);
      expect(enemy.speed).toBeLessThanOrEqual(max * archetype * GLOBAL_FALL_SPEED_MULTIPLIER);
    }
  });

  it('brakes split debris too, not just wave spawns', () => {
    const wave = waveSending('splitter');
    const { state, profile } = startAtArchetype('splitter');
    const splitter = spawnUntil(state, profile, 'splitter');
    shootExactly(state, profile, splitter);

    const [min, max] = arcadeDifficultyFor(wave).fallSpeed;
    const spore = enemyArchetype('spore').speedMultiplier;
    const debris = state.enemies.filter((e) => e.archetype === 'spore');
    expect(debris.length).toBeGreaterThan(0);
    for (const d of debris) {
      expect(d.speed).toBeGreaterThanOrEqual(min * spore * GLOBAL_FALL_SPEED_MULTIPLIER);
      expect(d.speed).toBeLessThanOrEqual(max * spore * GLOBAL_FALL_SPEED_MULTIPLIER);
    }
  });

  it('never lets a formation exceed the wave maxConcurrent', () => {
    for (const wave of [1, 7, 13, 29, 60, 140]) {
      if (isBossWave(wave)) continue;
      expect(waveSpecFor(wave).archetypes.length).toBeLessThanOrEqual(
        arcadeDifficultyFor(wave).maxConcurrent
      );
    }
  });

  it('caps how far reinforcements can extend one wave', () => {
    // A wave ends when the board empties. Unbounded reinforcements would
    // let a player who keeps answering badly never reach the next wave.
    const { state, profile } = startAtWave(1);
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');

    const target = state.enemies[0];
    // Every wrong answer builds toward the miss-streak reinforcement.
    for (let i = 0; i < 40; i++) shoot(state, profile, target.xPct, '99999');

    expect(state.reinforcementsThisWave).toBeLessThanOrEqual(3);
  });
});

describe('knockback', () => {
  /** A guess that lands as `close` on this problem: one off the answer. */
  function nearMiss(target: EnemyInstance): string {
    return String(toNumber(target.problem.answer) + 1);
  }

  it('shoves an enemy back up the screen on a close answer', () => {
    const { state, profile } = startAtWave(1);
    const enemy = spawnUntil(state, profile, 'drifter');
    tickUntil(state, profile, () => enemy.y > 20, 'the enemy to descend');
    const before = enemy.y;

    shoot(state, profile, enemy.xPct, nearMiss(enemy));

    expect(enemy.y).toBeLessThan(before);
    expect(state.enemies).toContain(enemy);
    expect(eventsOfType('enemy-knockback')).toHaveLength(1);
  });

  it('does not move an enemy on an exact answer - it removes it', () => {
    const { state, profile } = startAtWave(1);
    const enemy = spawnUntil(state, profile, 'drifter');

    shootExactly(state, profile, enemy);

    expect(state.enemies).not.toContain(enemy);
    expect(eventsOfType('enemy-knockback')).toHaveLength(0);
  });

  it('never pushes an enemy past the ceiling, however many times it lands', () => {
    // Otherwise a player parked under one enemy could shove it far enough
    // off-screen that it effectively stops existing.
    const { state, profile } = startAtWave(1);
    const enemy = spawnUntil(state, profile, 'drifter');

    for (let i = 0; i < 20; i++) shoot(state, profile, enemy.xPct, nearMiss(enemy));

    expect(state.enemies).toContain(enemy);
    expect(enemy.y).toBeGreaterThan(-20);
  });
});

describe('multi-problem enemies', () => {
  it('survives its first exact answer and presents a fresh problem', () => {
    const { state, profile } = startAtArchetype('bulwark');
    const bulwark = spawnUntil(state, profile, 'bulwark');
    const firstProblem = bulwark.problem.id;
    expect(bulwark.layersTotal).toBe(2);

    shootExactly(state, profile, bulwark);

    expect(state.enemies).toContain(bulwark);
    expect(bulwark.layersRemaining).toBe(1);
    expect(bulwark.problem.id).not.toBe(firstProblem);
    expect(eventsOfType('enemy-layer-broken')).toHaveLength(1);
  });

  it('dies to the answer that empties its last layer', () => {
    const { state, profile } = startAtArchetype('bulwark');
    const bulwark = spawnUntil(state, profile, 'bulwark');

    shootExactly(state, profile, bulwark);
    shootExactly(state, profile, bulwark);

    expect(state.enemies).not.toContain(bulwark);
    expect(eventsOfType('enemy-defeated')).toHaveLength(1);
  });
});

describe('shielded enemies', () => {
  it('deflects a wrong answer without letting anything through', () => {
    const { state, profile } = startAtArchetype('sentinel');
    const sentinel = spawnUntil(state, profile, 'sentinel');
    expect(sentinel.shielded).toBe(true);
    const startY = sentinel.y;

    shoot(state, profile, sentinel.xPct, '99999');

    expect(sentinel.shielded).toBe(true);
    expect(sentinel.layersRemaining).toBe(2);
    expect(sentinel.y).toBe(startY);
    expect(eventsOfType('shield-blocked')).toHaveLength(1);
  });

  it('yields to an exact answer, then behaves like any other enemy', () => {
    const { state, profile } = startAtArchetype('sentinel');
    const sentinel = spawnUntil(state, profile, 'sentinel');

    shootExactly(state, profile, sentinel);
    expect(sentinel.shielded).toBe(false);
    expect(eventsOfType('shield-broken')).toHaveLength(1);
    // Breaking through costs the shot - the layer underneath is untouched.
    expect(sentinel.layersRemaining).toBe(2);

    shootExactly(state, profile, sentinel);
    expect(sentinel.layersRemaining).toBe(1);
  });
});

describe('splitters', () => {
  it('breaks into debris that does not count toward the level quota', () => {
    const { state, profile } = startAtArchetype('splitter');
    const splitter = spawnUntil(state, profile, 'splitter');
    const before = state.enemiesDefeated;

    shootExactly(state, profile, splitter);
    expect(state.enemiesDefeated).toBe(before + 1);
    const spores = state.enemies.filter((e) => e.archetype === 'spore');
    expect(spores.length).toBeGreaterThan(0);
    expect(eventsOfType('enemy-split')).toHaveLength(1);

    const afterSplit = state.enemiesDefeated;
    shootExactly(state, profile, spores[0]);
    expect(state.enemies).not.toContain(spores[0]);
    expect(state.enemiesDefeated).toBe(afterSplit);
  });
});

describe('boss fights', () => {
  /** Drops the player into a boss fight the way the run does: by arriving
   * on a wave whose number is a multiple of the boss interval. */
  function enterBossFight(waveNumber = WAVE_BOSS_INTERVAL) {
    expect(isBossWave(waveNumber)).toBe(true);
    const { state, profile } = startAtWave(waveNumber);

    tickUntil(state, profile, () => state.boss !== null, 'the boss to arrive');

    expect(state.runPhase).toBe('boss');
    return { state, profile, boss: state.boss!, rules: state.bossRules! };
  }

  it('starts with a survive clock and an empty combo, not a health bar', () => {
    const { boss, rules } = enterBossFight();
    expect(boss.surviveTotalMs).toBe(rules.surviveSec * 1000);
    expect(boss.surviveRemainingMs).toBe(boss.surviveTotalMs);
    expect(boss.comboRequired).toBe(rules.comboToDefeat);
    expect(boss.combo).toBe(0);
    expect(boss).not.toHaveProperty('hp');
  });

  it('opens unshielded so the player gets a clean look at the fight', () => {
    const { boss } = enterBossFight();
    expect(boss.vulnerable).toBe(true);
  });

  it('cuts the survive clock on an exact answer and advances the combo', () => {
    const { state, profile, boss } = enterBossFight();
    state.enemies = [];
    const before = boss.surviveRemainingMs;

    shoot(state, profile, boss.xPct, correctAnswer(boss.problem));

    expect(boss.surviveRemainingMs).toBeLessThan(before);
    expect(boss.combo).toBe(1);
    expect(eventsOfType('boss-timer-cut')).toHaveLength(1);
  });

  it('lets a close answer make progress without advancing the combo', () => {
    const { state, profile, boss } = enterBossFight();
    state.enemies = [];
    boss.combo = 2;
    const before = boss.surviveRemainingMs;

    // One away from correct is "close", not exact.
    shoot(state, profile, boss.xPct, String(toNumber(boss.problem.answer) + 1));

    expect(boss.surviveRemainingMs).toBeLessThan(before);
    expect(boss.combo).toBe(0);
    expect(eventsOfType('boss-combo-broken')).toHaveLength(1);
  });

  it('ends the fight by mastery on a full run of exact answers', () => {
    const { state, profile, boss } = enterBossFight();
    state.enemies = [];

    for (let i = 0; i < boss.comboRequired; i++) {
      if (!state.boss) break;
      state.enemies = [];
      shoot(state, profile, state.boss.xPct, correctAnswer(state.boss.problem));
    }

    const defeated = eventsOfType('boss-defeated');
    expect(defeated).toHaveLength(1);
    expect(defeated[0].by).toBe('mastery');
    expect(defeated[0].bestCombo).toBe(boss.comboRequired);
    expect(state.boss).toBeNull();
    expect(state.bossRules).toBeNull();
    // Ending a fight early drops straight into the next wave - there is no
    // stage-clear screen left to pass through.
    expect(state.waveNumber).toBe(WAVE_BOSS_INTERVAL + 1);
  });

  it('ends the fight by survival when the clock runs out first', () => {
    const { state, profile, boss } = enterBossFight();
    boss.surviveRemainingMs = 40;

    tickUntil(state, profile, () => state.boss === null, 'the survive clock to expire');

    const defeated = eventsOfType('boss-defeated');
    expect(defeated).toHaveLength(1);
    expect(defeated[0].by).toBe('survival');
  });

  it('pays a mastery finish better than an endurance one', () => {
    const mastered = enterBossFight();
    mastered.state.enemies = [];
    const startCurrency = mastered.profile.currency;
    for (let i = 0; i < mastered.boss.comboRequired; i++) {
      if (!mastered.state.boss) break;
      mastered.state.enemies = [];
      shoot(mastered.state, mastered.profile, mastered.state.boss.xPct, correctAnswer(mastered.state.boss.problem));
    }
    expect(mastered.profile.currency).toBeGreaterThan(startCurrency);
  });

  describe('shields and weak points', () => {
    it('blocks body shots while shielded, leaving a standing combo alone', () => {
      const { state, profile, boss } = enterBossFight();
      state.enemies = [];
      boss.combo = 2;
      boss.vulnerable = false;
      boss.weakPointOffsetPct = 12;
      const before = boss.surviveRemainingMs;

      shoot(state, profile, boss.xPct, correctAnswer(boss.problem));

      expect(eventsOfType('shield-blocked')).toHaveLength(1);
      expect(boss.surviveRemainingMs).toBe(before);
      expect(boss.combo).toBe(2);
    });

    it('drops the shield when the weak point takes an exact answer', () => {
      const { state, profile, boss } = enterBossFight();
      state.enemies = [];
      boss.vulnerable = false;
      boss.weakPointOffsetPct = 12;
      const before = boss.surviveRemainingMs;

      shoot(state, profile, weakPointXPct(boss), correctAnswer(boss.problem));

      expect(boss.vulnerable).toBe(true);
      expect(boss.surviveRemainingMs).toBeLessThan(before);
      expect(eventsOfType('shield-broken')).toHaveLength(1);
    });

    /** Parks the fight partway into a shielded phase, far enough from the
     * finale that the shield cycle is the only thing that can flip the
     * boss's state - otherwise a phase change or the finale gets there
     * first and the test is really measuring the schedule, not the cycle. */
    function parkInShieldedPhase(waveNumber = WAVE_BOSS_INTERVAL) {
      const fight = enterBossFight(waveNumber);
      const shieldedPhase = fight.rules.phases.findIndex((p) => p.shieldedSec > 0);
      expect(shieldedPhase).toBeGreaterThan(-1);

      const weights = fight.rules.phases.map((p) => p.weight);
      const total = weights.reduce((a, b) => a + b, 0);
      const startOfPhase = weights.slice(0, shieldedPhase).reduce((a, b) => a + b, 0) / total;
      const endOfPhase = startOfPhase + weights[shieldedPhase] / total;
      const progress = (startOfPhase + endOfPhase) / 2;

      fight.boss.surviveRemainingMs = fight.boss.surviveTotalMs * (1 - progress);

      // Let the phase change land before the test sets anything up:
      // entering a phase deliberately reopens the boss and resets its
      // shield window, which would otherwise overwrite the setup.
      tick(fight.state, fight.profile, 1 / 60);
      expect(fight.boss.phaseIndex).toBe(shieldedPhase);
      expect(fight.boss.inFinale).toBe(false);

      fight.state.enemies = [];
      events = [];
      return fight;
    }

    it('raises its shield when a shielded phase runs out of open time', () => {
      const { state, profile, boss } = parkInShieldedPhase();
      boss.vulnerable = true;
      boss.stateRemainingMs = 50;

      tickUntil(state, profile, () => state.boss !== null && !state.boss.vulnerable, 'the shield to go up');

      expect(eventsOfType('boss-shield-raised')).toHaveLength(1);
      // A weak point is only meaningful if it's actually off-centre.
      expect(Math.abs(boss.weakPointOffsetPct)).toBeGreaterThan(0);
    });

    it('drops it again when the shield window expires', () => {
      const { state, profile, boss } = parkInShieldedPhase();
      boss.vulnerable = false;
      boss.stateRemainingMs = 50;

      tickUntil(state, profile, () => state.boss !== null && state.boss.vulnerable, 'the shield to come back down');

      expect(eventsOfType('boss-shield-dropped')).toHaveLength(1);
    });
  });

  it('walks through its phases as the survive clock drains', () => {
    const { state, profile, rules } = enterBossFight(WAVE_BOSS_INTERVAL * 2);
    expect(rules.phases.length).toBeGreaterThan(1);

    tickUntil(state, profile, () => state.boss === null, 'the fight to finish');
    const phases = eventsOfType('boss-phase-changed').map((e) => e.phaseIndex);

    expect(phases[0]).toBe(0);
    expect(Math.max(...phases)).toBe(rules.phases.length - 1);
    // Phases only ever move forward.
    expect([...phases].sort((a, b) => a - b)).toEqual(phases);
  });

  it('drops its shield for good once the finale begins', () => {
    const { state, profile } = enterBossFight();
    tickUntil(state, profile, () => !state.boss || state.boss.inFinale, 'the finale');
    expect(state.boss?.inFinale).toBe(true);
    expect(state.boss?.vulnerable).toBe(true);
    expect(eventsOfType('boss-finale-started')).toHaveLength(1);

    // "For good" is the claim worth pinning: the shield cycle stops, so the
    // boss stays open for however long the rest of the fight runs. Asserting
    // an empty board here instead would be flaky - the finale does clear it,
    // but the same tick can go on to spawn the next add.
    events = [];
    for (let i = 0; i < 200 && state.boss; i++) {
      state.timeRemainingMs = 60000;
      tick(state, profile, 1 / 30);
      if (state.boss) expect(state.boss.vulnerable).toBe(true);
    }
    expect(eventsOfType('boss-shield-raised')).toHaveLength(0);
  });

  it('presents the authored finale problem for the last stretch', () => {
    const { state, profile, rules } = enterBossFight();
    tickUntil(state, profile, () => !state.boss || state.boss.inFinale, 'the finale');
    expect(state.boss!.problem.source).toBe('authored');
    expect(state.boss!.problem.displayText).toBe(
      `${rules.finaleProblem.left} ${rules.finaleProblem.operator} ${rules.finaleProblem.right}`
    );
  });
});
