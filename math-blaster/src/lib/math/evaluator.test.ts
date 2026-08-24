import { parseInput, closeTolerance, evaluateAnswer } from './evaluator';
import { integer, fraction, decimal } from './MathValue';
import { arithmeticProblem } from './ProblemDefinition';

describe('parseInput', () => {
  it('parses a plain integer, including negatives', () => {
    expect(parseInput('7')).toEqual(integer(7));
    expect(parseInput('-3')).toEqual(integer(-3));
  });

  it('parses a decimal and records its digit count', () => {
    expect(parseInput('1.50')).toEqual(decimal(1.5, 2));
  });

  it('parses a fraction', () => {
    expect(parseInput('3/4')).toEqual(fraction(3, 4));
  });

  it('rejects a zero-denominator fraction', () => {
    expect(parseInput('3/0')).toBeNull();
  });

  it('returns null for empty or non-numeric input', () => {
    expect(parseInput('')).toBeNull();
    expect(parseInput('   ')).toBeNull();
    expect(parseInput('abc')).toBeNull();
  });
});

describe('closeTolerance', () => {
  it('is clamped to a minimum of 1 for small answers', () => {
    expect(closeTolerance(2)).toBe(1);
  });

  it('is clamped to a maximum of 4 for large answers', () => {
    expect(closeTolerance(1000)).toBe(4);
  });

  it('scales with the answer magnitude within the clamp', () => {
    expect(closeTolerance(20)).toBe(2); // round(20 * 0.12) = 2
  });
});

describe('evaluateAnswer', () => {
  const problem = arithmeticProblem('+', 2, 3); // answer: 5

  it('classifies an exact structural match as exact', () => {
    const result = evaluateAnswer('5', problem);
    expect(result.verdict).toBe('exact');
    expect(result.distance).toBe(0);
  });

  it('classifies a mathematically-equal but differently-shaped answer as equivalent', () => {
    const divisionProblem = arithmeticProblem('÷', 1, 2); // answer: fraction 1/2
    const result = evaluateAnswer('0.5', divisionProblem);
    expect(result.verdict).toBe('equivalent');
  });

  it('classifies an answer within tolerance as close', () => {
    // answer 5, closeTolerance(5) = max(1, min(4, round(0.6))) = 1
    const result = evaluateAnswer('6', problem);
    expect(result.verdict).toBe('close');
    expect(result.distance).toBe(1);
  });

  it('classifies an answer with some matching digits (but out of close range) as partial', () => {
    const bigProblem = arithmeticProblem('+', 20, 4); // answer: 24
    const result = evaluateAnswer('54', bigProblem); // shares the ones digit '4'
    expect(result.verdict).toBe('partial');
    expect(result.digitMatch?.matches).toEqual([false, true]);
  });

  it('classifies a completely wrong answer with no matching digits as incorrect', () => {
    const bigProblem = arithmeticProblem('+', 20, 4); // answer: 24
    const result = evaluateAnswer('99', bigProblem);
    expect(result.verdict).toBe('incorrect');
  });

  it('classifies unparseable input as invalid, with no guess', () => {
    const result = evaluateAnswer('not a number', problem);
    expect(result.verdict).toBe('invalid');
    expect(result.guess).toBeUndefined();
  });
});
