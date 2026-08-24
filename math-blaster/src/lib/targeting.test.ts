import { resolveTarget, ALIGNMENT_TOLERANCE_PCT } from './targeting';
import { arithmeticProblem } from './math/ProblemDefinition';
import type { EnemyInstance, PlayerState, BossState } from './runtime/RuntimeState';

function makePlayer(xPct: number): PlayerState {
  return { xPct, movingLeft: false, movingRight: false, inputBuffer: '', fireCooldownRemainingMs: 0 };
}

function makeEnemy(overrides: Partial<EnemyInstance> & { uid: number; xPct: number; y: number }): EnemyInstance {
  return {
    kind: 'slime',
    mini: false,
    problem: arithmeticProblem('+', 1, 1),
    hp: 10,
    maxHp: 10,
    speed: 1,
    frozen: false,
    burnUntilMs: 0,
    ...overrides,
  };
}

function makeBoss(overrides: Partial<BossState> = {}): BossState {
  return {
    name: 'Test Boss',
    sprite: 'boss1',
    hp: 100,
    maxHp: 100,
    xPct: 50,
    driftDirection: 1,
    driftSpeed: 0,
    problem: arithmeticProblem('+', 1, 1),
    progress: 0,
    missStreak: 0,
    inFinale: false,
    ...overrides,
  };
}

describe('resolveTarget', () => {
  it('targets nothing when no enemies or boss are present', () => {
    expect(resolveTarget(makePlayer(50), [], null)).toEqual({ kind: 'none' });
  });

  it('targets an aligned enemy over an aligned boss', () => {
    const enemy = makeEnemy({ uid: 1, xPct: 50, y: 10 });
    const boss = makeBoss({ xPct: 50 });
    const target = resolveTarget(makePlayer(50), [enemy], boss);
    expect(target).toEqual({ kind: 'enemy', enemy });
  });

  it('falls back to the boss only when nothing else is aligned', () => {
    const enemy = makeEnemy({ uid: 1, xPct: 90, y: 10 });
    const boss = makeBoss({ xPct: 50 });
    const target = resolveTarget(makePlayer(50), [enemy], boss);
    expect(target).toEqual({ kind: 'boss' });
  });

  it('picks the aligned enemy closest to the impact line among several stacked in the same lane', () => {
    const near = makeEnemy({ uid: 1, xPct: 50, y: 90 });
    const far = makeEnemy({ uid: 2, xPct: 50, y: 10 });
    const target = resolveTarget(makePlayer(50), [far, near], null);
    expect(target).toEqual({ kind: 'enemy', enemy: near });
  });

  it('treats positions within tolerance as aligned', () => {
    const enemy = makeEnemy({ uid: 1, xPct: 50 + ALIGNMENT_TOLERANCE_PCT, y: 10 });
    const target = resolveTarget(makePlayer(50), [enemy], null);
    expect(target).toEqual({ kind: 'enemy', enemy });
  });

  it('treats positions just past tolerance as not aligned', () => {
    const enemy = makeEnemy({ uid: 1, xPct: 50 + ALIGNMENT_TOLERANCE_PCT + 1, y: 10 });
    const target = resolveTarget(makePlayer(50), [enemy], null);
    expect(target).toEqual({ kind: 'none' });
  });
});
