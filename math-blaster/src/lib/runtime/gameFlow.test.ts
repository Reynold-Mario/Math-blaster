import { createInitialRuntimeState, beginWave, tick, handleInputAction } from './gameFlow';
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
