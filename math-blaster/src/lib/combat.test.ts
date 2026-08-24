import { resolveGruntHit, resolveBossAnswer, type GruntTarget } from './combat';
import type { AnswerResult } from './math/evaluator';

function result(verdict: AnswerResult['verdict'], extra: Partial<AnswerResult> = {}): AnswerResult {
  return { verdict, rawInput: '', ...extra };
}

function grunt(overrides: Partial<GruntTarget> = {}): GruntTarget {
  return { hp: 10, maxHp: 10, layersRemaining: 1, shielded: false, ...overrides };
}

describe('resolveGruntHit', () => {
  it('deals full hp damage and defeats a single-layer enemy on an exact answer', () => {
    const outcome = resolveGruntHit(result('exact'), grunt(), 0);
    expect(outcome.damage).toBe(10);
    expect(outcome.defeated).toBe(true);
    expect(outcome.missStreak).toBe(0);
  });

  it('deals half damage on a close answer', () => {
    expect(resolveGruntHit(result('close'), grunt(), 0).damage).toBe(5);
  });

  it('scales partial damage by the fraction of matching digits', () => {
    const digitMatch = { guessDigits: '4', answerDigits: '24', matches: [false, true] };
    const outcome = resolveGruntHit(result('partial', { digitMatch }), grunt(), 0);
    // round(10 * 0.7 * 0.5) = 4
    expect(outcome.damage).toBe(4);
  });

  it('deals zero damage and does not defeat on incorrect or invalid', () => {
    const outcome = resolveGruntHit(result('incorrect'), grunt(), 0);
    expect(outcome.damage).toBe(0);
    expect(outcome.defeated).toBe(false);
  });

  it('never reports the target as defeated below zero remaining hp', () => {
    expect(resolveGruntHit(result('exact'), grunt({ hp: 1 }), 0).defeated).toBe(true);
  });

  describe('layers', () => {
    it('breaks a layer without defeating a multi-layer enemy', () => {
      const outcome = resolveGruntHit(result('exact'), grunt({ layersRemaining: 2 }), 0);
      expect(outcome.layerBroken).toBe(true);
      expect(outcome.defeated).toBe(false);
    });

    it('defeats a multi-layer enemy once it is down to its last layer', () => {
      const outcome = resolveGruntHit(result('exact'), grunt({ layersRemaining: 1 }), 0);
      expect(outcome.layerBroken).toBe(true);
      expect(outcome.defeated).toBe(true);
    });

    it('does not break a layer when the damage leaves hp behind', () => {
      const outcome = resolveGruntHit(result('close'), grunt({ hp: 10, maxHp: 10, layersRemaining: 2 }), 0);
      expect(outcome.damage).toBe(5);
      expect(outcome.layerBroken).toBe(false);
    });

    it('does not treat a zero-damage answer as breaking an already-empty layer', () => {
      const outcome = resolveGruntHit(result('incorrect'), grunt({ hp: 0 }), 0);
      expect(outcome.layerBroken).toBe(false);
      expect(outcome.defeated).toBe(false);
    });
  });

  describe('shields', () => {
    it('blocks everything short of an exact answer, dealing no damage', () => {
      const outcome = resolveGruntHit(result('close'), grunt({ shielded: true }), 0);
      expect(outcome.blocked).toBe(true);
      expect(outcome.shieldBroken).toBe(false);
      expect(outcome.damage).toBe(0);
    });

    it('breaks on an exact answer without also dealing damage that shot', () => {
      const outcome = resolveGruntHit(result('exact'), grunt({ shielded: true }), 0);
      expect(outcome.blocked).toBe(false);
      expect(outcome.shieldBroken).toBe(true);
      expect(outcome.damage).toBe(0);
      expect(outcome.defeated).toBe(false);
    });

    it('accepts an equivalent answer as readily as an exact one', () => {
      expect(resolveGruntHit(result('equivalent'), grunt({ shielded: true }), 0).shieldBroken).toBe(true);
    });
  });

  describe('reinforcement', () => {
    let randomSpy: jest.SpyInstance;
    afterEach(() => randomSpy.mockRestore());

    it('forces a reinforcement on a close answer when the roll succeeds', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.5 chance
      const outcome = resolveGruntHit(result('close'), grunt(), 0);
      expect(outcome.reinforce).toBe(true);
      expect(outcome.missStreak).toBe(0);
    });

    it('does not reinforce a close answer when the roll fails', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9); // > 0.5 chance
      expect(resolveGruntHit(result('close'), grunt(), 0).reinforce).toBe(false);
    });

    it('resets the miss streak on exact/equivalent even without reinforcing', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const outcome = resolveGruntHit(result('exact'), grunt(), 2);
      expect(outcome.reinforce).toBe(false);
      expect(outcome.missStreak).toBe(0);
    });

    it('builds a miss streak on repeated incorrect answers without reinforcing early', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const first = resolveGruntHit(result('incorrect'), grunt(), 0);
      expect(first.reinforce).toBe(false);
      expect(first.missStreak).toBe(1);

      const second = resolveGruntHit(result('incorrect'), grunt(), first.missStreak);
      expect(second.reinforce).toBe(false);
      expect(second.missStreak).toBe(2);
    });

    it('forces a reinforcement once the miss streak threshold is reached, and resets it', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const outcome = resolveGruntHit(result('invalid'), grunt(), 2);
      expect(outcome.reinforce).toBe(true);
      expect(outcome.missStreak).toBe(0);
    });
  });
});

describe('resolveBossAnswer', () => {
  const vulnerable = { comboRequired: 5, vulnerable: true };
  const shielded = { comboRequired: 5, vulnerable: false };

  let randomSpy: jest.SpyInstance;
  beforeEach(() => {
    // Pin the reinforcement rolls so they never fire - this suite is about
    // timer cuts and combos, not reinforcements.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99);
  });
  afterEach(() => randomSpy.mockRestore());

  describe('against a vulnerable body', () => {
    it('cuts the survive clock on an exact answer and extends the combo', () => {
      const outcome = resolveBossAnswer(result('exact'), vulnerable, 0, 0, false);
      expect(outcome.surviveCutMs).toBe(2600);
      expect(outcome.combo).toBe(1);
      expect(outcome.blocked).toBe(false);
      expect(outcome.masteryAchieved).toBe(false);
    });

    it('cuts less on a close answer, and still makes real progress', () => {
      const outcome = resolveBossAnswer(result('close'), vulnerable, 0, 0, false);
      expect(outcome.surviveCutMs).toBe(900);
      expect(outcome.surviveCutMs).toBeGreaterThan(0);
    });

    it('scales a partial cut by the fraction of matching digits', () => {
      const digitMatch = { guessDigits: '4', answerDigits: '24', matches: [false, true] };
      const outcome = resolveBossAnswer(result('partial', { digitMatch }), vulnerable, 0, 0, false);
      expect(outcome.surviveCutMs).toBe(800); // round(1600 * 0.5)
    });

    it('breaks a standing combo on anything less than exact', () => {
      const outcome = resolveBossAnswer(result('close'), vulnerable, 3, 0, false);
      expect(outcome.combo).toBe(0);
      expect(outcome.comboBroken).toBe(true);
    });

    it('does not report a broken combo when there was none to break', () => {
      expect(resolveBossAnswer(result('incorrect'), vulnerable, 0, 0, false).comboBroken).toBe(false);
    });

    it('ends the fight once the combo reaches the required length', () => {
      const outcome = resolveBossAnswer(result('exact'), vulnerable, 4, 0, false);
      expect(outcome.combo).toBe(5);
      expect(outcome.masteryAchieved).toBe(true);
    });

    it('counts an equivalent answer toward the combo, not just an exact one', () => {
      expect(resolveBossAnswer(result('equivalent'), vulnerable, 2, 0, false).combo).toBe(3);
    });
  });

  describe('against a shielded boss', () => {
    it('blocks a body shot outright', () => {
      const outcome = resolveBossAnswer(result('exact'), shielded, 2, 0, false);
      expect(outcome.blocked).toBe(true);
      expect(outcome.surviveCutMs).toBe(0);
      expect(outcome.shieldBroken).toBe(false);
    });

    it('leaves a standing combo intact when a shot is blocked', () => {
      // Firing into a shield is a shot that never reached the boss - it
      // shouldn't cost a run the player built up.
      const outcome = resolveBossAnswer(result('incorrect'), shielded, 3, 0, false);
      expect(outcome.combo).toBe(3);
      expect(outcome.comboBroken).toBe(false);
    });

    it('blocks a non-exact answer even when it lands on the weak point', () => {
      const outcome = resolveBossAnswer(result('close'), shielded, 0, 0, true);
      expect(outcome.blocked).toBe(true);
      expect(outcome.shieldBroken).toBe(false);
    });

    it('cracks the weak point on an exact answer, cutting more than a body hit would', () => {
      const outcome = resolveBossAnswer(result('exact'), shielded, 0, 0, true);
      expect(outcome.shieldBroken).toBe(true);
      expect(outcome.blocked).toBe(false);
      expect(outcome.surviveCutMs).toBe(4200);
      expect(outcome.surviveCutMs).toBeGreaterThan(
        resolveBossAnswer(result('exact'), vulnerable, 0, 0, false).surviveCutMs
      );
    });

    it('advances the combo on a weak point hit, and can end the fight with one', () => {
      const outcome = resolveBossAnswer(result('exact'), shielded, 4, 0, true);
      expect(outcome.combo).toBe(5);
      expect(outcome.masteryAchieved).toBe(true);
    });
  });
});
