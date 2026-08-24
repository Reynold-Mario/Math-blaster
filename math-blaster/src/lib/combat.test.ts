import { resolveGruntHit, resolveBossHit } from './combat';
import type { AnswerResult } from './math/evaluator';
import { integer } from './math/MathValue';

function result(verdict: AnswerResult['verdict'], extra: Partial<AnswerResult> = {}): AnswerResult {
  return { verdict, rawInput: '', ...extra };
}

describe('resolveGruntHit', () => {
  it('deals full hp damage and defeats on an exact answer', () => {
    const outcome = resolveGruntHit(result('exact'), { hp: 10, maxHp: 10 }, 0);
    expect(outcome.damage).toBe(10);
    expect(outcome.defeated).toBe(true);
    expect(outcome.missStreak).toBe(0);
  });

  it('deals half damage on a close answer', () => {
    const outcome = resolveGruntHit(result('close'), { hp: 10, maxHp: 10 }, 0);
    expect(outcome.damage).toBe(5);
  });

  it('scales partial damage by the fraction of matching digits', () => {
    const digitMatch = { guessDigits: '4', answerDigits: '24', matches: [false, true] };
    const outcome = resolveGruntHit(result('partial', { digitMatch }), { hp: 10, maxHp: 10 }, 0);
    // round(10 * 0.7 * 0.5) = 4
    expect(outcome.damage).toBe(4);
  });

  it('deals zero damage and does not defeat on incorrect or invalid', () => {
    const outcome = resolveGruntHit(result('incorrect'), { hp: 10, maxHp: 10 }, 0);
    expect(outcome.damage).toBe(0);
    expect(outcome.defeated).toBe(false);
  });

  it('never reports the target as defeated below zero remaining hp', () => {
    const outcome = resolveGruntHit(result('exact'), { hp: 1, maxHp: 10 }, 0);
    expect(outcome.defeated).toBe(true);
  });

  describe('reinforcement', () => {
    let randomSpy: jest.SpyInstance;
    afterEach(() => randomSpy.mockRestore());

    it('forces a reinforcement on a close answer when the roll succeeds', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.5 chance
      const outcome = resolveGruntHit(result('close'), { hp: 10, maxHp: 10 }, 0);
      expect(outcome.reinforce).toBe(true);
      expect(outcome.missStreak).toBe(0);
    });

    it('does not reinforce a close answer when the roll fails', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9); // > 0.5 chance
      const outcome = resolveGruntHit(result('close'), { hp: 10, maxHp: 10 }, 0);
      expect(outcome.reinforce).toBe(false);
    });

    it('resets the miss streak on exact/equivalent even without reinforcing', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const outcome = resolveGruntHit(result('exact'), { hp: 10, maxHp: 10 }, 2);
      expect(outcome.reinforce).toBe(false);
      expect(outcome.missStreak).toBe(0);
    });

    it('builds a miss streak on repeated incorrect answers without reinforcing early', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const first = resolveGruntHit(result('incorrect'), { hp: 10, maxHp: 10 }, 0);
      expect(first.reinforce).toBe(false);
      expect(first.missStreak).toBe(1);

      const second = resolveGruntHit(result('incorrect'), { hp: 10, maxHp: 10 }, first.missStreak);
      expect(second.reinforce).toBe(false);
      expect(second.missStreak).toBe(2);
    });

    it('forces a reinforcement once the miss streak threshold is reached, and resets it', () => {
      randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const outcome = resolveGruntHit(result('invalid'), { hp: 10, maxHp: 10 }, 2);
      expect(outcome.reinforce).toBe(true);
      expect(outcome.missStreak).toBe(0);
    });
  });
});

describe('resolveBossHit', () => {
  it('deals a fraction of max hp on an exact answer, not full damage', () => {
    const outcome = resolveBossHit(result('exact'), { hp: 100, maxHp: 100 }, 0);
    expect(outcome.damage).toBe(16); // round(100 * 0.16)
    expect(outcome.defeated).toBe(false);
  });

  it('deals less damage on a close answer than an exact one', () => {
    const outcome = resolveBossHit(result('close'), { hp: 100, maxHp: 100 }, 0);
    expect(outcome.damage).toBe(6); // round(100 * 0.06)
  });

  it('defeats the boss once accumulated damage meets remaining hp', () => {
    const outcome = resolveBossHit(result('exact'), { hp: 10, maxHp: 100 }, 0);
    expect(outcome.defeated).toBe(true);
  });
});
