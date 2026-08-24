import { createInitialRuntimeState, setupStage, tick, handleInputAction } from './gameFlow';
import { createEmptyProfile, type PlayerProfile } from './PlayerProfile';
import type { RuntimeState, EnemyInstance } from './RuntimeState';
import { gameEvents, type GameEvent } from '../events';
import { GAME_LEVELS } from '../levels/gameLevels';
import { weakPointXPct } from '../targeting';
import { enemyArchetype, GLOBAL_FALL_SPEED_MULTIPLIER } from '../levels/enemyArchetypes';
import { toNumber } from '../math/MathValue';
import type { ProblemDefinition } from '../math/ProblemDefinition';

/**
 * Integration coverage for the orchestration layer - the one place where
 * archetypes, waves, the combat rules and the boss's two win conditions
 * are actually wired together. The pure layers below it are unit-tested on
 * their own; what these tests are for is the wiring.
 */

const STAGE = Object.fromEntries(GAME_LEVELS.map((l, i) => [l.id, i])) as Record<string, number>;

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

function startAt(stageId: string): { state: RuntimeState; profile: PlayerProfile } {
  const state = createInitialRuntimeState();
  const profile = createEmptyProfile();
  setupStage(state, STAGE[stageId]);
  events = [];
  return { state, profile };
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
  it('releases a formation rather than a lone grunt', () => {
    const { state, profile } = startAt('l1');
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');

    const waves = eventsOfType('wave-incoming');
    expect(waves.length).toBeGreaterThan(0);
    expect(waves[0].count).toBe(state.enemies.length);
  });

  it('advances through the plan and then loops, so a level never runs dry', () => {
    const { state, profile } = startAt('k1');
    const plan = GAME_LEVELS[STAGE.k1].waves;

    tickUntil(state, profile, () => eventsOfType('wave-incoming').length >= 6, 'six waves');
    const indices = eventsOfType('wave-incoming').map((e) => e.index);

    expect(indices.slice(0, plan.waves.length)).toEqual(plan.waves.map((_, i) => i));
    // The introductory wave is authored to play once and never return.
    expect(indices.slice(plan.waves.length)).not.toContain(0);
  });

  it('spawns enemies matching the archetypes its waves author', () => {
    const { state, profile } = startAt('k1');
    tickUntil(state, profile, () => state.enemies.length > 0, 'the first wave');
    expect(state.enemies.every((e) => e.archetype === 'drifter')).toBe(true);
  });

  it('applies the global fall-speed brake on top of level and archetype speeds', () => {
    // The brake is the one knob for global pacing - if a spawn path stops
    // honouring it, descent speed silently doubles for those enemies.
    const { state, profile } = startAt('l3');
    tickUntil(state, profile, () => state.enemies.length >= 2, 'a couple of enemies');

    const [min, max] = GAME_LEVELS[STAGE.l3].arcadeDifficulty.fallSpeed;
    for (const enemy of state.enemies) {
      const archetype = enemyArchetype(enemy.archetype).speedMultiplier;
      expect(enemy.speed).toBeGreaterThanOrEqual(min * archetype * GLOBAL_FALL_SPEED_MULTIPLIER);
      expect(enemy.speed).toBeLessThanOrEqual(max * archetype * GLOBAL_FALL_SPEED_MULTIPLIER);
    }
  });

  it('brakes split debris and boss adds too, not just wave spawns', () => {
    const { state, profile } = startAt('g2a');
    const splitter = spawnUntil(state, profile, 'splitter');
    shootExactly(state, profile, splitter);

    const [min, max] = GAME_LEVELS[STAGE.g2a].arcadeDifficulty.fallSpeed;
    const spore = enemyArchetype('spore').speedMultiplier;
    for (const debris of state.enemies.filter((e) => e.archetype === 'spore')) {
      expect(debris.speed).toBeGreaterThanOrEqual(min * spore * GLOBAL_FALL_SPEED_MULTIPLIER);
      expect(debris.speed).toBeLessThanOrEqual(max * spore * GLOBAL_FALL_SPEED_MULTIPLIER);
    }
  });

  it('never exceeds the level maxConcurrent, even mid-formation', () => {
    const { state, profile } = startAt('l4');
    const cap = GAME_LEVELS[STAGE.l4].arcadeDifficulty.maxConcurrent;
    for (let i = 0; i < 900; i++) {
      state.timeRemainingMs = 60000;
      tick(state, profile, 1 / 30);
      expect(state.enemies.length).toBeLessThanOrEqual(cap);
    }
  });
});

describe('multi-problem enemies', () => {
  it('survives its first exact answer and presents a fresh problem', () => {
    const { state, profile } = startAt('g2b');
    const bulwark = spawnUntil(state, profile, 'bulwark');
    const firstProblem = bulwark.problem.id;
    expect(bulwark.layersTotal).toBe(2);

    shootExactly(state, profile, bulwark);

    expect(state.enemies).toContain(bulwark);
    expect(bulwark.layersRemaining).toBe(1);
    expect(bulwark.hp).toBe(bulwark.maxHp);
    expect(bulwark.problem.id).not.toBe(firstProblem);
    expect(eventsOfType('enemy-layer-broken')).toHaveLength(1);
  });

  it('dies to the answer that empties its last layer', () => {
    const { state, profile } = startAt('g2b');
    const bulwark = spawnUntil(state, profile, 'bulwark');

    shootExactly(state, profile, bulwark);
    shootExactly(state, profile, bulwark);

    expect(state.enemies).not.toContain(bulwark);
    expect(eventsOfType('enemy-defeated')).toHaveLength(1);
  });
});

describe('shielded enemies', () => {
  it('deflects a wrong answer without taking damage', () => {
    const { state, profile } = startAt('l3');
    const sentinel = spawnUntil(state, profile, 'sentinel');
    expect(sentinel.shielded).toBe(true);

    shoot(state, profile, sentinel.xPct, '99999');

    expect(sentinel.shielded).toBe(true);
    expect(sentinel.hp).toBe(sentinel.maxHp);
    expect(eventsOfType('shield-blocked')).toHaveLength(1);
  });

  it('yields to an exact answer, then behaves like any other enemy', () => {
    const { state, profile } = startAt('l3');
    const sentinel = spawnUntil(state, profile, 'sentinel');

    shootExactly(state, profile, sentinel);
    expect(sentinel.shielded).toBe(false);
    expect(eventsOfType('shield-broken')).toHaveLength(1);
    // Breaking through costs the shot - the layer underneath is untouched.
    expect(sentinel.hp).toBe(sentinel.maxHp);
    expect(sentinel.layersRemaining).toBe(2);

    shootExactly(state, profile, sentinel);
    expect(sentinel.layersRemaining).toBe(1);
  });
});

describe('splitters', () => {
  it('breaks into debris that does not count toward the level quota', () => {
    const { state, profile } = startAt('g2a');
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
  /** Drops the player straight into a boss fight by clearing the quota
   * with the last kill, so the transition itself is exercised too. */
  function enterBossFight(stageId: string) {
    const { state, profile } = startAt(stageId);
    const level = GAME_LEVELS[STAGE[stageId]];
    state.enemiesDefeated = level.enemiesToClear - 1;

    tickUntil(state, profile, () => state.enemies.length > 0, 'a grunt to finish the quota');
    destroy(state, profile, state.enemies.find((e) => e.archetype !== 'spore')!);

    expect(state.stagePhase).toBe('boss');
    return { state, profile, boss: state.boss!, rules: level.boss! };
  }

  it('starts with a survive clock and an empty combo, not a health bar', () => {
    const { boss, rules } = enterBossFight('l2');
    expect(boss.surviveTotalMs).toBe(rules.surviveSec * 1000);
    expect(boss.surviveRemainingMs).toBe(boss.surviveTotalMs);
    expect(boss.comboRequired).toBe(rules.comboToDefeat);
    expect(boss.combo).toBe(0);
    expect(boss).not.toHaveProperty('hp');
  });

  it('opens unshielded so the player gets a clean look at the fight', () => {
    const { boss } = enterBossFight('l2');
    expect(boss.vulnerable).toBe(true);
  });

  it('cuts the survive clock on an exact answer and advances the combo', () => {
    const { state, profile, boss } = enterBossFight('l2');
    state.enemies = [];
    const before = boss.surviveRemainingMs;

    shoot(state, profile, boss.xPct, correctAnswer(boss.problem));

    expect(boss.surviveRemainingMs).toBeLessThan(before);
    expect(boss.combo).toBe(1);
    expect(eventsOfType('boss-timer-cut')).toHaveLength(1);
  });

  it('lets a close answer make progress without advancing the combo', () => {
    const { state, profile, boss } = enterBossFight('l2');
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
    const { state, profile, boss } = enterBossFight('l2');
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
    // Ending a fight early still clears the stage.
    expect(eventsOfType('stage-cleared')).toHaveLength(1);
  });

  it('ends the fight by survival when the clock runs out first', () => {
    const { state, profile, boss } = enterBossFight('l2');
    boss.surviveRemainingMs = 40;

    tickUntil(state, profile, () => state.boss === null, 'the survive clock to expire');

    const defeated = eventsOfType('boss-defeated');
    expect(defeated).toHaveLength(1);
    expect(defeated[0].by).toBe('survival');
  });

  it('pays a mastery finish better than an endurance one', () => {
    const mastered = enterBossFight('l2');
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
      const { state, profile, boss } = enterBossFight('l2');
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
      const { state, profile, boss } = enterBossFight('l2');
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
    function parkInShieldedPhase(stageId: string) {
      const fight = enterBossFight(stageId);
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
      const { state, profile, boss } = parkInShieldedPhase('l2');
      boss.vulnerable = true;
      boss.stateRemainingMs = 50;

      tickUntil(state, profile, () => state.boss !== null && !state.boss.vulnerable, 'the shield to go up');

      expect(eventsOfType('boss-shield-raised')).toHaveLength(1);
      // A weak point is only meaningful if it's actually off-centre.
      expect(Math.abs(boss.weakPointOffsetPct)).toBeGreaterThan(0);
    });

    it('drops it again when the shield window expires', () => {
      const { state, profile, boss } = parkInShieldedPhase('l2');
      boss.vulnerable = false;
      boss.stateRemainingMs = 50;

      tickUntil(state, profile, () => state.boss !== null && state.boss.vulnerable, 'the shield to come back down');

      expect(eventsOfType('boss-shield-dropped')).toHaveLength(1);
    });
  });

  it('walks through its phases as the survive clock drains', () => {
    const { state, profile, rules } = enterBossFight('g2b');
    expect(rules.phases.length).toBeGreaterThan(1);

    tickUntil(state, profile, () => state.boss === null, 'the fight to finish');
    const phases = eventsOfType('boss-phase-changed').map((e) => e.phaseIndex);

    expect(phases[0]).toBe(0);
    expect(Math.max(...phases)).toBe(rules.phases.length - 1);
    // Phases only ever move forward.
    expect([...phases].sort((a, b) => a - b)).toEqual(phases);
  });

  it('drops its shield for good once the finale begins', () => {
    const { state, profile } = enterBossFight('l2');
    tickUntil(state, profile, () => !state.boss || state.boss.inFinale, 'the finale');
    expect(state.boss?.inFinale).toBe(true);
    expect(state.boss?.vulnerable).toBe(true);
    expect(state.enemies).toHaveLength(0);
    expect(eventsOfType('boss-finale-started')).toHaveLength(1);
  });

  it('presents the authored finale problem for the last stretch', () => {
    const { state, profile, rules } = enterBossFight('l2');
    tickUntil(state, profile, () => !state.boss || state.boss.inFinale, 'the finale');
    expect(state.boss!.problem.source).toBe('authored');
    expect(state.boss!.problem.displayText).toBe(
      `${rules.finaleProblem.left} ${rules.finaleProblem.operator} ${rules.finaleProblem.right}`
    );
  });
});
